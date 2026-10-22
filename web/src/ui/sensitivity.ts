// Tier-2 sensitivity: a display filter on lexical entries by their human fire-rate (the
// share of pre-2022 arXiv abstracts an entry fires in, measured by `npm run baseline`).
// Every entry stays "accepted"; this only decides which lexical entries the page shows.
// An entry without a measured fire-rate ("none") counts as 0, so every level shows it.

import type { LexiconEntry } from '../engine/index.ts';

export const SENSITIVITIES = ['loose', 'standard', 'strict'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];
export const DEFAULT_SENSITIVITY: Sensitivity = 'standard';

/** Highest human fire-rate a lexical entry may have to be shown at each level. */
export const MAX_FIRE_RATE: Record<Sensitivity, number> = {
  loose: 0.0025,
  standard: 0.01,
  strict: Number.POSITIVE_INFINITY,
};

export interface FireData {
  /** Number of abstracts measured. */
  abstracts: number;
  /** Abstracts each lexical entry fires in; entries that fire in none are left out. */
  fires: Readonly<Record<string, number>>;
}

export function isSensitivity(value: unknown): value is Sensitivity {
  return (SENSITIVITIES as readonly unknown[]).includes(value);
}

export function fireRate(id: string, data: FireData): number {
  return data.abstracts > 0 ? (data.fires[id] ?? 0) / data.abstracts : 0;
}

/** Leaves out lexical entries whose fire-rate is above the level; other tiers pass. */
export function bySensitivity(
  entries: readonly LexiconEntry[],
  level: Sensitivity,
  data: FireData,
): LexiconEntry[] {
  const max = MAX_FIRE_RATE[level];
  return entries.filter((e) => e.tier !== 'lexical' || fireRate(e.id, data) <= max);
}
