// Human baseline shown after the density in the summary line: lexical hits per 1,000
// words in pre-2022 arXiv abstracts, measured with the default (non-experimental) lexicon.
// Generated into web/src/baseline.json by `npm run baseline`; no JSON import here, so the
// script can use this module under plain Node.

import type { LexiconEntry } from '../engine/index.ts';

export interface Baseline {
  generated: string;
  /** Short label for the summary line, e.g. "2019–21". */
  years: string;
  abstracts: number;
  words: number;
  /** Lexical entries active by default when measured. */
  lexicalEntries: number;
  /** lexiconFingerprint() of those entries; tests fail when the lexicon has changed. */
  fingerprint: string;
  /** Total lexical hits per 1,000 words over all abstracts. */
  pooledPer1k: number;
  /** Mean, median and 90th percentile of the per-abstract rates. */
  meanPer1k: number;
  medianPer1k: number;
  p90Per1k: number;
}

/** The lexical entries that are active by default (no experimental lexicon). */
export function defaultLexical(entries: readonly LexiconEntry[]): LexiconEntry[] {
  return entries.filter((e) => e.tier === 'lexical' && (e.status === 'accepted' || e.status === 'watch'));
}

/** FNV-1a over the default lexical entries' matching fields, as 8 hex digits. */
export function lexiconFingerprint(entries: readonly LexiconEntry[]): string {
  const keys = defaultLexical(entries)
    .map((e) => [e.id, e.pattern, e.match, e.inflect ? '1' : '0'].join('\u0000'))
    .sort();
  let h = 0x811c9dc5;
  for (const ch of keys.join('\u0001')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** "typical human papers (2019–21): ~2.1" */
export function baselineText(b: Pick<Baseline, 'years' | 'pooledPer1k'>): string {
  return `typical human papers (${b.years}): ~${b.pooledPer1k.toFixed(1)}`;
}
