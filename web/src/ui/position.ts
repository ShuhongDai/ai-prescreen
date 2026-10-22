// Popover geometry: pure functions, no DOM. All values are CSS pixels in client (viewport)
// coordinates, as returned by getBoundingClientRect() / getClientRects().

export interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Placement = 'below' | 'above';

export interface Position {
  top: number;
  left: number;
  placement: Placement;
}

/** Gap between the highlight and the popover. */
export const POPOVER_GAP = 6;
/** Smallest distance between the popover and the viewport edges. */
export const VIEWPORT_MARGIN = 8;

/** Math.min(Math.max(v, lo), hi), except that `lo` wins when hi < lo. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/**
 * Below the anchor when the popover fits there, else above when it fits there, else on
 * the roomier side. The result is clamped into the viewport; the popover's left edge
 * follows the anchor's left edge. A popover larger than the viewport is pinned to the
 * top/left margin (the caller caps its size with max-width / max-height).
 */
export function placePopover(
  anchor: Box,
  popover: Size,
  viewport: Size,
  gap = POPOVER_GAP,
  margin = VIEWPORT_MARGIN,
): Position {
  const spaceBelow = viewport.height - margin - (anchor.bottom + gap);
  const spaceAbove = anchor.top - gap - margin;
  let placement: Placement;
  if (popover.height <= spaceBelow) placement = 'below';
  else if (popover.height <= spaceAbove) placement = 'above';
  else placement = spaceBelow >= spaceAbove ? 'below' : 'above';

  const top = placement === 'below' ? anchor.bottom + gap : anchor.top - gap - popover.height;
  return {
    top: Math.round(clamp(top, margin, viewport.height - margin - popover.height)),
    left: Math.round(clamp(anchor.left, margin, viewport.width - margin - popover.width)),
    placement,
  };
}

export function intersection(a: Box, b: Box): Box {
  return {
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
    left: Math.max(a.left, b.left),
  };
}

/** True when the two boxes overlap by more than an edge. */
export function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Index of the line box (client rect) of a wrapped highlight that contains the point,
 * else of the nearest one (vertical distance first). 0 when there are no rects.
 */
export function lineIndexAt(rects: ArrayLike<Box>, x: number, y: number): number {
  let best = 0;
  let bestDy = Infinity;
  let bestDx = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (dy < bestDy || (dy === bestDy && dx < bestDx)) {
      best = i;
      bestDy = dy;
      bestDx = dx;
    }
  }
  return best;
}
