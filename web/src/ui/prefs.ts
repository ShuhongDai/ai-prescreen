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

export const HIT_COUNTS_KEY = 'ai-prescreen:hit-counts';

/**
 * Whether anonymous hit counts are sent: the reader's choice, else on, unless the browser
 * asks sites not to share data (Global Privacy Control).
 */
export function loadHitCounts(
  storage: () => StorageLike | null = browserStorage,
  privacySignal: boolean = globalPrivacyControl(),
): boolean {
  try {
    const value = storage()?.getItem(HIT_COUNTS_KEY);
    if (value === '1' || value === '0') return value === '1';
  } catch {
    // Unreadable: the default below.
  }
  return !privacySignal;
}

export function saveHitCounts(value: boolean, storage: () => StorageLike | null = browserStorage): void {
  try {
    storage()?.setItem(HIT_COUNTS_KEY, value ? '1' : '0');
  } catch {
    // Not persisted; the switch still works for this page view.
  }
}

function globalPrivacyControl(): boolean {
  return typeof navigator !== 'undefined' && (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
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
