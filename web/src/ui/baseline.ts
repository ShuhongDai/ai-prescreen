// Human baseline shown after the density in the summary line: hits per 1,000 words (all
// tiers the level shows; tier 3 only at Strict) in pre-2022 arXiv abstracts, measured with
// the default (non-experimental) lexicon at each sensitivity level. Generated into web/src/baseline.json by
// `npm run baseline`, together with each lexical entry's fire count; no JSON import
// here, so the script can use this module under plain Node.

import type { LexiconEntry } from '../engine/index.ts';
import type { FireData, Sensitivity } from './sensitivity.ts';

export interface LevelBaseline {
  /** Default lexical and stylistic entries shown at this level when measured. */
  lexicalEntries: number;
  stylisticEntries: number;
  /** Total hits per 1,000 words over all abstracts. */
  pooledPer1k: number;
  /** Mean, median and 90th percentile of the per-abstract rates. */
  meanPer1k: number;
  medianPer1k: number;
  p90Per1k: number;
}

export interface Baseline extends FireData {
  generated: string;
  /** Short label for the summary line, e.g. "2019–21". */
  years: string;
  words: number;
  /** lexiconFingerprint() when measured; tests fail when the lexicon has changed. */
  fingerprint: string;
  levels: Record<Sensitivity, LevelBaseline>;
}

/** The lexical entries that are active by default (no experimental lexicon). */
export function defaultLexical(entries: readonly LexiconEntry[]): LexiconEntry[] {
  return entries.filter((e) => e.tier === 'lexical' && (e.status === 'accepted' || e.status === 'watch'));
}

/** The entries active by default in every tier (no experimental lexicon). */
export function defaultEntries(entries: readonly LexiconEntry[]): LexiconEntry[] {
  return entries.filter((e) => e.status === 'accepted' || e.status === 'watch');
}

/** The lexical entries whose fire-rate is measured: all but retired ones. */
export function measuredLexical(entries: readonly LexiconEntry[]): LexiconEntry[] {
  return entries.filter((e) => e.tier === 'lexical' && e.status !== 'retired');
}

/**
 * FNV-1a over the non-retired lexical and stylistic entries' matching fields and status,
 * as 8 hex digits: what the per-level baselines depend on.
 */
export function lexiconFingerprint(entries: readonly LexiconEntry[]): string {
  const keys = entries
    .filter((e) => (e.tier === 'lexical' || e.tier === 'stylistic') && e.status !== 'retired')
    .map((e) => [e.id, e.pattern, e.match, e.inflect ? '1' : '0', e.status].join('\u0000'))
    .sort();
  let h = 0x811c9dc5;
  for (const ch of keys.join('\u0001')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** "typical human papers (2019–21): ~2.1" */
export function baselineText(b: { years: string; pooledPer1k: number }): string {
  return `typical human papers (${b.years}): ~${b.pooledPer1k.toFixed(1)}`;
}
