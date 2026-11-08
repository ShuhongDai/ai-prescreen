// Per-viewer preferences in localStorage. Storage may be missing or throw (private
// windows, blocked site data), so every access is guarded and falls back to defaults.

import { DEFAULT_SENSITIVITY, isSensitivity, type Sensitivity } from './sensitivity.ts';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const EXPERIMENTAL_KEY = 'ai-prescreen:experimental-lexicon';

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadExperimental(storage: () => StorageLike | null = browserStorage): boolean {
  try {
    return storage()?.getItem(EXPERIMENTAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveExperimental(
  value: boolean,
  storage: () => StorageLike | null = browserStorage,
): void {
  try {
    storage()?.setItem(EXPERIMENTAL_KEY, value ? '1' : '0');
  } catch {
    // Not persisted; the toggle still works for this page view.
  }
}

/** '0': this browser is left out of the statistics (also kept from the former opt-out switch). */
export const HIT_COUNTS_KEY = 'ai-prescreen:hit-counts';

/** Opening the page with one of these hashes leaves a browser out of the statistics, or back in. */
export const STATS_HASH = { off: '#no-stats', on: '#stats' } as const;

/** Whether this browser sends hit counts and usage statistics: yes, unless it was left out. */
export function loadHitCounts(storage: () => StorageLike | null = browserStorage): boolean {
  try {
    return storage()?.getItem(HIT_COUNTS_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveHitCounts(value: boolean, storage: () => StorageLike | null = browserStorage): void {
  try {
    storage()?.setItem(HIT_COUNTS_KEY, value ? '1' : '0');
  } catch {
    // Not persisted.
  }
}

/**
 * Applies #no-stats / #stats from the page's URL (the owner's own browsers; not shown on the
 * page). True when the hash was one of them, so the caller can remove it from the address.
 */
export function applyStatsHash(hash: string, storage: () => StorageLike | null = browserStorage): boolean {
  if (hash !== STATS_HASH.off && hash !== STATS_HASH.on) return false;
  saveHitCounts(hash === STATS_HASH.on, storage);
  return true;
}

export const SENSITIVITY_KEY = 'ai-prescreen:tier2-sensitivity';

/** The stored tier-2 sensitivity, or the default when missing, invalid or unreadable. */
export function loadSensitivity(storage: () => StorageLike | null = browserStorage): Sensitivity {
  try {
    const value = storage()?.getItem(SENSITIVITY_KEY);
    return isSensitivity(value) ? value : DEFAULT_SENSITIVITY;
  } catch {
    return DEFAULT_SENSITIVITY;
  }
}

export function saveSensitivity(
  value: Sensitivity,
  storage: () => StorageLike | null = browserStorage,
): void {
  try {
    storage()?.setItem(SENSITIVITY_KEY, value);
  } catch {
    // Not persisted; the setting still works for this page view.
  }
}
