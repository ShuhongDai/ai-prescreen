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
  const bounds = { top: 0, right: viewport.width, bottom: viewport.height, left: 0 };
  return placeWithin(anchor, popover, bounds, gap, margin);
}

/** Like placePopover, but kept inside `bounds` (e.g. the visible part of a pane). */
export function placeWithin(
  anchor: Box,
  size: Size,
  bounds: Box,
  gap = POPOVER_GAP,
  margin = VIEWPORT_MARGIN,
): Position {
  const spaceBelow = bounds.bottom - margin - (anchor.bottom + gap);
  const spaceAbove = anchor.top - gap - (bounds.top + margin);
  let placement: Placement;
  if (size.height <= spaceBelow) placement = 'below';
  else if (size.height <= spaceAbove) placement = 'above';
  else placement = spaceBelow >= spaceAbove ? 'below' : 'above';

  const top = placement === 'below' ? anchor.bottom + gap : anchor.top - gap - size.height;
  return {
    top: Math.round(clamp(top, bounds.top + margin, bounds.bottom - margin - size.height)),
    left: Math.round(clamp(anchor.left, bounds.left + margin, bounds.right - margin - size.width)),
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

// ---- Margin notes: the card in the sheet's right margin, with a connector line ----

/** A horizontal span in client coordinates. */
export interface Column {
  left: number;
  right: number;
}

/** Space between the text column and the card. */
export const NOTE_GAP = 16;
/** Space between the card and the sheet's right edge. */
export const NOTE_INSET = 12;

/**
 * The sheet's note column: its right padding, in client coordinates (`clientLeft` and
 * `clientWidth` leave out the border and a scrollbar). Null when narrower than `min`.
 */
export function noteColumn(
  sheet: { left: number },
  clientLeft: number,
  clientWidth: number,
  paddingRight: number,
  min: number,
): Column | null {
  if (paddingRight < min) return null;
  const right = sheet.left + clientLeft + clientWidth;
  return { left: right - paddingRight, right };
}

export interface MarginNotePlacement {
  top: number;
  left: number;
  width: number;
  /** From the end of the highlight on its line to the card's left edge, just under the
   * line; null when there is no room or it would miss the card. */
  connector: { top: number; left: number; width: number } | null;
}

/**
 * The card fills the note column and starts at the highlight's line, clamped into the
 * viewport (a card taller than the viewport is pinned to the top margin).
 */
export function placeMarginNote(
  line: Box,
  column: Column,
  cardHeight: number,
  viewport: Size,
  gap = NOTE_GAP,
  inset = NOTE_INSET,
  margin = VIEWPORT_MARGIN,
): MarginNotePlacement {
  const left = Math.round(column.left + gap);
  const width = Math.max(0, Math.round(column.right - inset - left));
  const top = Math.round(clamp(line.top - 4, margin, viewport.height - margin - cardHeight));
  // In the gap under the line, so it never strikes through the words after the highlight.
  const y = Math.round(line.bottom + 2);
  const x = Math.round(line.right + 2);
  const reaches = y >= top + 2 && y <= top + cardHeight - 2;
  return {
    top,
    left,
    width,
    connector: left - x >= 4 && reaches ? { top: y, left: x, width: left - x } : null,
  };
}

// ---- Where a highlight's card goes ----

export type CardMode = 'margin' | 'float' | 'sheet';

/** A viewport narrower than this, or shorter than the next, gets the bottom sheet (px). */
export const SHEET_BELOW_WIDTH = 768;
export const SHEET_BELOW_HEIGHT = 560;

/** Phones in either orientation, and other small windows. */
export function isCompactViewport(viewport: Size): boolean {
  return viewport.width < SHEET_BELOW_WIDTH || viewport.height < SHEET_BELOW_HEIGHT;
}

/**
 * The card's mode: a bottom sheet on a compact viewport; else a margin note when the sheet
 * has a note column; else floating next to the highlight, unless that would cover the
 * highlight (`floatCovers`), which also gets the bottom sheet.
 */
export function chooseCardMode(
  viewport: Size,
  hasNoteColumn: boolean,
  floatCovers: boolean,
): CardMode {
  if (isCompactViewport(viewport)) return 'sheet';
  if (hasNoteColumn) return 'margin';
  return floatCovers ? 'sheet' : 'float';
}

/** Whether a card of `size` placed at `pos` overlaps the highlight's line box. */
export function coversAnchor(pos: { top: number; left: number }, size: Size, anchor: Box): boolean {
  const card = { top: pos.top, left: pos.left, right: pos.left + size.width, bottom: pos.top + size.height };
  return intersects(card, anchor);
}
