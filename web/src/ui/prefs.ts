// Per-viewer preferences in localStorage. Storage may be missing or throw (private
// windows, blocked site data), so every access is guarded and falls back to defaults.

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
