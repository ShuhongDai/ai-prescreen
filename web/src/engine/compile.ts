import { normalize } from './normalize.ts';
import type { CompileOptions, LexiconEntry, Tier } from './types.ts';

export interface CompiledEntry {
  entry: LexiconEntry;
  regex: RegExp;
}

/** An active entry that could not be compiled (invalid regex, empty pattern). */
export interface CompileError {
  entryId: string;
  message: string;
}

export interface CompiledLexicon {
  entries: CompiledEntry[];
  /**
   * Active entries skipped because they failed to compile. One bad entry must not take
   * the whole page down; `npm run validate-lexicon` is where such entries get caught.
   */
  errors?: CompileError[];
}

const DEFAULT_TIERS: readonly Tier[] = ['artifact', 'lexical'];
// Characters that continue a word. Combining marks (\p{M}) are included so a pattern
// never matches the bare base letters of a decomposed word ("cafe" inside "café").
const WORD_CHAR = /^[\p{L}\p{M}\p{N}_]$/u;
const NOT_AFTER_WORD = '(?<![\\p{L}\\p{M}\\p{N}_])';
const NOT_BEFORE_WORD = '(?![\\p{L}\\p{M}\\p{N}_])';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds the regex source for a `word` or `phrase` pattern. */
export function literalSource(pattern: string): string {
  const p = normalize(pattern).trim();
  if (p === '') throw new Error('empty pattern');
  const body = p.split(/\s+/).map(escapeRegExp).join('\\s+');
  // Word boundaries only where the pattern edge is a word character, so patterns
  // like "[Insert citation]" still match next to punctuation. Edges are taken by code
  // point so an astral letter at either end is recognised.
  const chars = Array.from(p);
  const pre = WORD_CHAR.test(chars[0]) ? NOT_AFTER_WORD : '';
  const post = WORD_CHAR.test(chars[chars.length - 1]) ? NOT_BEFORE_WORD : '';
  return pre + body + post;
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
  return new RegExp(literalSource(entry.pattern), 'giu');
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
  const compiled: CompiledEntry[] = [];
  const errors: CompileError[] = [];
  for (const entry of entries) {
    if (!isActive(entry, options)) continue;
    try {
      compiled.push({ entry, regex: compileEntry(entry) });
    } catch (err) {
      errors.push({ entryId: entry.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { entries: compiled, errors };
}
