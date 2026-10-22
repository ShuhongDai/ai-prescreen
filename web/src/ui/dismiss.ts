// "Not AI-like (false positive)" dismissals: DOM-free helpers. The set of dismissed entry
// IDs lives in memory for the current page view only (never in localStorage); dismissed
// entries are left out of the compiled lexicons (see lexicons.ts).

/**
 * Which highlight gets focus after the one at text offset `pos` was dismissed: the first
 * one starting at or after `pos`, else the last one before it. `starts` must be sorted
 * ascending. Returns -1 when no highlight is left.
 */
export function focusIndexAfterDismiss(starts: readonly number[], pos: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid]! < pos) lo = mid + 1;
    else hi = mid;
  }
  if (lo < starts.length) return lo;
  return starts.length - 1;
}
