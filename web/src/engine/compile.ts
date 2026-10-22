import { inflectWord } from './inflect.ts';
import { normalize } from './normalize.ts';
import type { CompileOptions, LexiconEntry, Tier } from './types.ts';

export interface CompiledEntry {
  entry: LexiconEntry;
  /** Global regex for the entry (see compileEntry); for word and phrase entries it is
   * built on first access. */
  regex: RegExp;
}

/** An active entry that could not be compiled (invalid regex, empty pattern). */
export interface CompileError {
  entryId: string;
  message: string;
}

export interface CompiledLexicon {
  /** Frozen, like the lexicon object itself: analyze() caches its match plan per lexicon. */
  readonly entries: readonly CompiledEntry[];
  /**
   * Active entries skipped because they failed to compile. One bad entry must not take
   * the whole page down; `npm run validate-lexicon` is where such entries get caught.
   */
  readonly errors?: readonly CompileError[];
}

const DEFAULT_TIERS: readonly Tier[] = ['artifact', 'lexical'];
// Characters that continue a word. Combining marks (\p{M}) are included so a pattern
// never matches the bare base letters of a decomposed word ("cafe" inside "café").
const WORD_CHAR = /^[\p{L}\p{M}\p{N}_]$/u;
const NOT_AFTER_WORD = '(?<![\\p{L}\\p{M}\\p{N}_])';
const NOT_BEFORE_WORD = '(?![\\p{L}\\p{M}\\p{N}_])';
const LEADING_RUN = /^[\p{L}\p{M}\p{N}_]+/u;
// A hyphen between two word characters inside a pattern token ("cutting-edge").
const INNER_HYPHENS = /(?<=[\p{L}\p{M}\p{N}_])-(?=[\p{L}\p{M}\p{N}_])/gu;
// What such a hyphen matches in the text: a hyphen, a whitespace run or nothing, so
// "cutting-edge" also finds "cutting edge", "cuttingedge" and a joined "cutting-\nedge".
const FLEXIBLE_HYPHEN = '(?:-|\\s+)?';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex source for one form of a token, with flexible inner hyphens. */
function formSource(form: string): string {
  return form.split(INNER_HYPHENS).map(escapeRegExp).join(FLEXIBLE_HYPHEN);
}

/** Regex source for one pattern token: the token, or an alternation of its forms. */
function tokenSource(token: string, inflect: boolean): string {
  if (!inflect) return formSource(token);
  const seen = new Set<string>();
  const forms: string[] = [];
  for (const f of inflectWord(token)) {
    const key = f.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      forms.push(f);
    }
  }
  if (forms.length === 1) return formSource(token);
  // Longest first: fewer backtracking steps; the boundaries make the match unique anyway.
  forms.sort((a, b) => b.length - a.length);
  return `(?:${forms.map(formSource).join('|')})`;
}

interface LiteralParts {
  /** The tokens joined by \s+, without boundary assertions. */
  body: string;
  /** The first / last character of the pattern is a word character. */
  wordStart: boolean;
  wordEnd: boolean;
}

function literalParts(pattern: string, inflect: boolean): LiteralParts {
  const p = normalize(pattern).trim();
  if (p === '') throw new Error('empty pattern');
  const body = p
    .split(/\s+/)
    .map((token) => tokenSource(token, inflect))
    .join('\\s+');
  // Edges are taken by code point so an astral letter at either end is recognised.
  // Inflected forms only add letters to letters, so the edges of the plain pattern
  // decide for all forms.
  const chars = Array.from(p);
  return {
    body,
    wordStart: WORD_CHAR.test(chars[0]!),
    wordEnd: WORD_CHAR.test(chars[chars.length - 1]!),
  };
}

/**
 * Builds the regex source for a `word` or `phrase` pattern. With `inflect`, every
 * content token matches any of its forms (see inflectWord). A hyphen between two word
 * characters matches a hyphen, whitespace or nothing. Word boundaries are added only
 * where the pattern edge is a word character, so patterns like "[Insert citation]"
 * still match next to punctuation.
 */
export function literalSource(pattern: string, inflect = false): string {
  const { body, wordStart, wordEnd } = literalParts(pattern, inflect);
  return (wordStart ? NOT_AFTER_WORD : '') + body + (wordEnd ? NOT_BEFORE_WORD : '');
}

/**
 * Compiles one entry. Throws on an invalid regex or an empty pattern.
 * Regex sources are normalised like the input text, so a curly apostrophe written
 * literally in a regex pattern still matches (the text it runs on has straight ones).
 */
export function compileEntry(entry: LexiconEntry): RegExp {
  if (entry.match === 'regex') {
    if (entry.pattern === '') throw new Error('empty pattern');
    return new RegExp(normalize(entry.pattern), 'gimu');
  }
  return new RegExp(literalSource(entry.pattern, entry.inflect === true), 'giu');
}

/**
 * Word and phrase entries get their regex on first access: analyze() finds most of
 * them through the word-run index and never needs it, and V8 is slow to build the
 * Unicode boundary classes (about 0.4 ms per entry), which adds up over hundreds of
 * entries. The source is built right away, so an empty pattern still fails here.
 */
function compiled(entry: LexiconEntry): CompiledEntry {
  if (entry.match === 'regex') return { entry, regex: compileEntry(entry) };
  const source = literalSource(entry.pattern, entry.inflect === true);
  let regex: RegExp | undefined;
  return {
    entry,
    get regex() {
      return (regex ??= new RegExp(source, 'giu'));
    },
  };
}

export function isActive(entry: LexiconEntry, options: CompileOptions = {}): boolean {
  const tiers = options.tiers ?? DEFAULT_TIERS;
  if (!tiers.includes(entry.tier)) return false;
  switch (entry.status) {
    case 'accepted':
    case 'watch':
      return true;
    case 'candidate':
      return options.includeCandidates === true;
    case 'retired':
      return false;
    default:
      return false;
  }
}

export function compileLexicon(
  entries: readonly LexiconEntry[],
  options: CompileOptions = {},
): CompiledLexicon {
  const result: CompiledEntry[] = [];
  const errors: CompileError[] = [];
  for (const entry of entries) {
    if (!isActive(entry, options)) continue;
    try {
      result.push(compiled(entry));
    } catch (err) {
      errors.push({ entryId: entry.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return Object.freeze({ entries: Object.freeze(result), errors: Object.freeze(errors) });
}

// ---------------------------------------------------------------- matcher

/**
 * Case-insensitive lookup key for a word run. Must give equal keys to any two strings
 * that a regex with the "iu" flags treats as equal (simple case folding). toLowerCase
 * does that for ASCII; for other text, lower-, upper- then lower-casing also merges the
 * letters that fold without being each other's lower case (ſ/s, ς/σ, Kelvin sign/k,
 * ẞ/ß). It may merge MORE strings than the regex does (ß/ss); the regex check that
 * follows every lookup rejects those.
 */
export function foldKey(s: string): string {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return s.toLowerCase().toUpperCase().toLowerCase();
  }
  return s.toLowerCase();
}

/** A word/phrase entry found through the word-run index. */
export interface IndexedEntry {
  entry: LexiconEntry;
  /**
   * The entry's pattern without boundary assertions, sticky: tried only at the start of
   * a word run, where the start boundary holds by definition.
   */
  sticky: RegExp;
  /**
   * The pattern ends with a word character, so the match must not be followed by one.
   * Checked by the caller instead of a lookahead, which V8 is slow to build (see
   * `compiled`). Equivalent: every token form is plain letters and tokens are joined by
   * whitespace, so the match at a given start is unique, and a shorter form that could
   * end the match earlier is always followed by a letter.
   */
  wordEnd: boolean;
  /** Index into the per-analysis "end of this entry's last match" table. */
  slot: number;
}

/**
 * Match plan for a compiled lexicon. Word and phrase patterns that start with a word
 * character can only match where a maximal word run starts, and that run must equal
 * the pattern's first word run (one of its forms when inflected): the pattern either
 * ends there (boundary) or continues with whitespace or punctuation. So instead of
 * scanning the text once per entry, analyze() walks the word runs once, looks each one
 * up here and runs only the regexes of the entries that can start with it.
 */
export interface Matcher {
  byKey: Map<string, IndexedEntry[]>;
  /** Entries that are scanned over the whole text: regexes, and literal patterns that
   * start with punctuation ("[Insert citation]", "**"). */
  scanned: CompiledEntry[];
  slots: number;
}

/**
 * Keys of the first word run of every form of the pattern's first token, or null when
 * the pattern does not start with a word character. With flexible hyphens the first run
 * can also be the joined parts: "cutting-edge" starts "cutting" or "cuttingedge".
 */
function leadingKeys(entry: LexiconEntry): Set<string> | null {
  const p = normalize(entry.pattern).trim();
  const first = p.split(/\s+/)[0]!;
  const firstChar = Array.from(first)[0];
  if (firstChar === undefined || !WORD_CHAR.test(firstChar)) return null;
  const keys = new Set<string>();
  for (const form of entry.inflect === true ? inflectWord(first) : [first]) {
    const parts = form.split(INNER_HYPHENS);
    let joined = '';
    for (const part of parts) {
      joined += part;
      const run = LEADING_RUN.exec(joined);
      if (run === null) return null;
      keys.add(foldKey(run[0]));
      if (run[0].length < joined.length) break; // the run ends inside this part
    }
  }
  return keys;
}

function buildMatcher(entries: readonly CompiledEntry[]): Matcher {
  const byKey = new Map<string, IndexedEntry[]>();
  const scanned: CompiledEntry[] = [];
  let slots = 0;
  for (const item of entries) {
    const { entry } = item;
    const keys = entry.match === 'regex' ? null : leadingKeys(entry);
    if (keys === null) {
      scanned.push(item);
      continue;
    }
    const { body, wordEnd } = literalParts(entry.pattern, entry.inflect === true);
    const indexed: IndexedEntry = { entry, sticky: new RegExp(body, 'iuy'), wordEnd, slot: slots++ };
    for (const key of keys) {
      const list = byKey.get(key);
      if (list) list.push(indexed);
      else byKey.set(key, [indexed]);
    }
  }
  return { byKey, scanned, slots };
}

const matchers = new WeakMap<CompiledLexicon, { entries: readonly CompiledEntry[]; matcher: Matcher }>();

/**
 * The match plan for a compiled lexicon, built on first use and cached per lexicon
 * object. Lexicons from compileLexicon are frozen; for a hand-made one whose `entries`
 * array was replaced, the plan is rebuilt.
 */
export function matcherFor(lexicon: CompiledLexicon): Matcher {
  const cached = matchers.get(lexicon);
  if (cached && cached.entries === lexicon.entries) return cached.matcher;
  const matcher = buildMatcher(lexicon.entries);
  matchers.set(lexicon, { entries: lexicon.entries, matcher });
  return matcher;
}
