import { foldKey, matcherFor, type CompiledLexicon, type Matcher } from './compile.ts';
import { preprocess, type Preprocessed } from './preprocess.ts';
import { TIERS, type AnalysisResult, type LexiconEntry, type Match, type Tier } from './types.ts';

// A word is a run of letters/digits (combining marks allowed after the first char, so
// decomposed "naïve" is one word), optionally joined by apostrophes or hyphens
// ("don't", "state-of-the-art"), or by "." / "," between digits ("3.14", "20,000").
// Runs on preprocessed text: curly apostrophes and non-breaking hyphens join too, and
// masked math, code and LaTeX commands are not words.
const WORD =
  /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:(?:['-]|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;
// A maximal run of word characters, as used by the pattern boundaries in compile.ts.
const WORD_RUN = /[\p{L}\p{M}\p{N}_]+/gu;
const WORD_CHAR = /^[\p{L}\p{M}\p{N}_]$/u;
const TIER_RANK: Record<Tier, number> = { artifact: 0, lexical: 1, stylistic: 2 };

// The page analyses the same text twice in a row (shown lexicon, then the experimental
// count), so the last preprocessing result is kept.
let lastText: string | null = null;
let lastPrepared: Preprocessed | null = null;

function prepared(text: string): Preprocessed {
  if (text !== lastText || lastPrepared === null) {
    lastPrepared = preprocess(text);
    lastText = text;
  }
  return lastPrepared;
}

function countIn(text: string): number {
  let n = 0;
  WORD.lastIndex = 0;
  while (WORD.exec(text) !== null) n++;
  return n;
}

/** Number of words in `text`, counted after preprocessing (as in analyze()). */
export function countWords(text: string): number {
  return countIn(prepared(text).text);
}

/**
 * Order for settling overlaps: earliest start, then the longer match, then the stronger
 * tier, then the entry ID (plain code-unit order, so the result does not depend on the
 * locale).
 */
function byPriority(a: Match, b: Match): number {
  return (
    a.start - b.start ||
    b.end - b.start - (a.end - a.start) ||
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0)
  );
}

/** Keeps matches in priority order, dropping each one that overlaps a kept one. */
function settle(matches: Match[]): Match[] {
  matches.sort(byPriority);
  const kept: Match[] = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      kept.push(m);
      lastEnd = m.end;
    }
  }
  return kept;
}

/**
 * Overlaps among reviewed entries (accepted, watch) are settled first. Matches of
 * candidate entries are then added only where they overlap nothing kept, so turning the
 * experimental lexicon on can add highlights but never replace a reviewed one.
 */
function resolveOverlaps(reviewed: Match[], candidates: Match[]): Match[] {
  const kept = settle(reviewed);
  if (candidates.length === 0) return kept;
  candidates.sort(byPriority);
  const added: Match[] = [];
  let k = 0;
  let lastEnd = -1;
  for (const c of candidates) {
    while (k < kept.length && kept[k]!.end <= c.start) k++;
    if (k < kept.length && kept[k]!.start < c.end) continue; // overlaps a reviewed match
    if (c.start < lastEnd) continue; // overlaps a candidate match already added
    added.push(c);
    lastEnd = c.end;
  }
  if (added.length === 0) return kept;
  return [...kept, ...added].sort((a, b) => a.start - b.start);
}

type Found = (entry: LexiconEntry, start: number, end: number) => void;

/** True if a word character (as in WORD_RUN) starts at `pos`. */
function isWordCharAt(text: string, pos: number): boolean {
  const c = text.charCodeAt(pos);
  if (c < 0x80) {
    return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
  }
  if (pos >= text.length) return false;
  return WORD_CHAR.test(String.fromCodePoint(text.codePointAt(pos)!));
}

/**
 * Word and phrase entries, through the word-run index. For each entry the result is
 * exactly what a global scan with its own regex would give: matches are found in text
 * order and a new one may only start after the entry's previous match ended.
 */
function findIndexed(text: string, matcher: Matcher, found: Found): void {
  if (matcher.byKey.size === 0) return;
  const lastEnd = new Int32Array(matcher.slots);
  WORD_RUN.lastIndex = 0;
  for (let run = WORD_RUN.exec(text); run !== null; run = WORD_RUN.exec(text)) {
    const candidates = matcher.byKey.get(foldKey(run[0]));
    if (candidates === undefined) continue;
    const start = run.index;
    for (const c of candidates) {
      if (start < lastEnd[c.slot]!) continue;
      c.sticky.lastIndex = start;
      const m = c.sticky.exec(text);
      if (m === null || m[0].length === 0) continue;
      const end = start + m[0].length;
      if (c.wordEnd && isWordCharAt(text, end)) continue;
      lastEnd[c.slot] = end;
      found(c.entry, start, end);
    }
  }
}

const isSpaceCode = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
const ORIGINAL_SPACE = /^\s$/;

export function analyze(text: string, lexicon: CompiledLexicon): AnalysisResult {
  const { text: prepped, map } = prepared(text);
  const matcher = matcherFor(lexicon);
  const reviewed: Match[] = [];
  const candidates: Match[] = [];
  /** True if any position in [from, to) of `prepped` is masked (a space that was not
   * whitespace in the original). */
  const masked = (from: number, to: number): boolean => {
    for (let k = from; k < to; k++) {
      if (prepped.charCodeAt(k) === 0x20 && !ORIGINAL_SPACE.test(text[map[k]!]!)) return true;
    }
    return false;
  };
  // Offsets are converted back to the original text here (see Preprocessed.map).
  const found: Found = (entry, start, end) => {
    // A regex may run into masked text at its edges ("[ \t]*$" before a masked comment);
    // the highlight should stop at the visible text. Whitespace that was whitespace in
    // the original stays part of the match, as before.
    if (isSpaceCode(prepped.charCodeAt(end - 1))) {
      let e = end;
      while (e > start && isSpaceCode(prepped.charCodeAt(e - 1))) e--;
      if (e > start && masked(e, end)) end = e;
    }
    if (isSpaceCode(prepped.charCodeAt(start))) {
      let s = start;
      while (s < end && isSpaceCode(prepped.charCodeAt(s))) s++;
      if (s < end && masked(start, s)) start = s;
    }
    const match = { entryId: entry.id, tier: entry.tier, start: map[start]!, end: map[end - 1]! + 1 };
    (entry.status === 'candidate' ? candidates : reviewed).push(match);
  };

  findIndexed(prepped, matcher, found);
  for (const { entry, regex } of matcher.scanned) {
    // matchAll clones the regex starting at its lastIndex; reset so leftover state
    // from any external exec()/test() call cannot skip matches.
    regex.lastIndex = 0;
    for (const m of prepped.matchAll(regex)) {
      if (m[0].length > 0) found(entry, m.index, m.index + m[0].length);
    }
  }

  const matches = resolveOverlaps(reviewed, candidates);
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  for (const m of matches) counts[m.tier]++;
  const words = countIn(prepped);
  const total = matches.length;

  return {
    matches,
    stats: { words, counts, total, per1k: words === 0 ? 0 : (total / words) * 1000 },
  };
}
