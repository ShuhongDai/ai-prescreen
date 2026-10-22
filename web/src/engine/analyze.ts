import type { CompiledLexicon } from './compile.ts';
import { HAS_INVISIBLE, isInvisible, normalize } from './normalize.ts';
import { TIERS, type AnalysisResult, type Match, type Tier } from './types.ts';

// A word is a run of letters/digits (combining marks allowed after the first char, so
// decomposed "naïve" is one word), optionally joined by apostrophes or hyphens
// ("don't", "state-of-the-art"), or by "." / "," between digits ("3.14", "20,000").
// Runs on normalised text, so curly apostrophes and non-breaking hyphens join too.
const WORD =
  /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:(?:['-]|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;
const TIER_RANK: Record<Tier, number> = { artifact: 0, lexical: 1, stylistic: 2 };

/** Normalised text with invisible format characters removed, plus a map back. */
interface Prepared {
  text: string;
  /** Original offset of each code unit of `text`; null when nothing was removed. */
  toOriginal: Int32Array | null;
}

/**
 * Invisible format characters (soft hyphen, zero-width space/joiners, word joiner, BOM)
 * would otherwise break every phrase they land in ("Regener\u00ADate response"). They are
 * removed before matching and offsets are mapped back to the original text.
 */
function prepare(text: string): Prepared {
  const normalized = normalize(text);
  if (!HAS_INVISIBLE.test(normalized)) return { text: normalized, toOriginal: null };
  const map = new Int32Array(normalized.length);
  const parts: string[] = [];
  let n = 0;
  let runStart = 0;
  for (let i = 0; i < normalized.length; i++) {
    if (isInvisible(normalized.charCodeAt(i))) {
      parts.push(normalized.slice(runStart, i));
      runStart = i + 1;
    } else {
      map[n++] = i;
    }
  }
  parts.push(normalized.slice(runStart));
  return { text: parts.join(''), toOriginal: map.subarray(0, n) };
}

export function countWords(text: string): number {
  let n = 0;
  for (const _ of prepare(text).text.matchAll(WORD)) n++;
  return n;
}

/**
 * Earliest start wins; ties go to the longer match, then the stronger tier, then the
 * entry ID (plain code-unit order, so the result does not depend on the locale).
 */
function resolveOverlaps(matches: Match[]): Match[] {
  matches.sort(
    (a, b) =>
      a.start - b.start ||
      b.end - b.start - (a.end - a.start) ||
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0),
  );
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

export function analyze(text: string, lexicon: CompiledLexicon): AnalysisResult {
  const { text: prepared, toOriginal } = prepare(text);
  const found: Match[] = [];

  for (const { entry, regex } of lexicon.entries) {
    // matchAll clones the regex starting at its lastIndex; reset so leftover state
    // from any external exec()/test() call cannot skip matches.
    regex.lastIndex = 0;
    for (const m of prepared.matchAll(regex)) {
      if (m[0].length === 0) continue;
      let start = m.index;
      let end = start + m[0].length;
      if (toOriginal) {
        start = toOriginal[start]!;
        end = toOriginal[end - 1]! + 1;
      }
      found.push({ entryId: entry.id, tier: entry.tier, start, end });
    }
  }

  const matches = resolveOverlaps(found);
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  for (const m of matches) counts[m.tier]++;
  let words = 0;
  for (const _ of prepared.matchAll(WORD)) words++;
  const total = matches.length;

  return {
    matches,
    stats: { words, counts, total, per1k: words === 0 ? 0 : (total / words) * 1000 },
  };
}
