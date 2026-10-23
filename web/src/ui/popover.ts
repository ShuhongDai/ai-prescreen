// The highlight popover: a single non-modal dialog, anchored to one highlight at a time,
// styled as a margin annotation card.
// Text goes in through textContent only (never innerHTML).
//
// Focus flow: opening moves focus into the dialog. Escape and the close button close it
// and return focus to the highlight. Tab past the last control moves on to the next
// highlight; Shift+Tab before the first control returns to the highlight (as if the
// dialog sat right after its highlight in the tab order). Clicking outside, or moving
// focus elsewhere, just closes it.
//
// Position (fixed), chosen again on every scroll and resize:
// - "margin": a margin note in the sheet's right margin (its note column), aligned to the
//   highlight's line, with a thin connector line from the end of the highlight, so it
//   never covers the text being read;
// - "float": next to the clicked line (below, or above when there is no room) when the
//   sheet has no note column;
// - "sheet": a bottom sheet (CSS) on a narrow or short viewport (phones in either
//   orientation), or when floating would cover the highlight; the highlight is scrolled
//   above it. The choice is chooseCardMode() in position.ts.
// The card follows the highlight while the page or the result pane scrolls and closes
// once the highlight is scrolled out of view. No fade-in: opaque from the first frame.

import type { PopoverModel } from './format.ts';
import {
  chooseCardMode,
  coversAnchor,
  intersection,
  intersects,
  isCompactViewport,
  lineIndexAt,
  noteColumn,
  placeMarginNote,
  placePopover,
  VIEWPORT_MARGIN,
  type Box,
  type CardMode,
  type Column,
} from './position.ts';

/** The phone layout of style.css (stacked panes); main.ts uses it for the paste reveal. */
export const BOTTOM_SHEET_QUERY = '(max-width: 767.98px)';
/** A note column narrower than this (px) is not used: the card floats instead. */
const MIN_NOTE_COLUMN = 176;

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

export interface PopoverOptions<T> {
  /**
   * "Not AI-like (false positive)" was pressed, or the "Report false positive" link was
   * followed (the browser opens it in a new tab); the popover is already closed.
   * `viaPointer` is false when the control was activated from the keyboard.
   */
  onFalsePositive(context: T, viaPointer: boolean): void;
  /** Client rect the highlight must stay visible in besides the viewport (the result pane). */
  clipRect?(): Box | null;
  /** The highlight after `anchor` in tab order (for Tab past the end of the popover). */
  nextAfter?(anchor: HTMLElement): HTMLElement | null;
  /** The sheet the highlights are on; its right padding, when wide enough, holds the card. */
  sheet?: HTMLElement;
}

export interface OpenRequest<T> {
  anchor: HTMLElement;
  model: PopoverModel;
  context: T;
  /** Click position, so a highlight that wraps gets the popover at the clicked line. */
  point?: { x: number; y: number };
}

export interface Popover<T> {
  /** The dialog element; the caller inserts it into the document. */
  readonly element: HTMLElement;
  /** The highlight the open popover belongs to; null when closed. */
  readonly anchor: HTMLElement | null;
  /** Opens for `anchor`, closing any other open popover first. */
  open(request: OpenRequest<T>): void;
  /** No-op when closed. `returnFocus` moves focus back to the highlight. */
  close(options?: { returnFocus?: boolean }): void;
}

const ID = {
  title: 'popover-title',
  quote: 'popover-quote',
  experimental: 'popover-experimental',
  why: 'popover-why',
} as const;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  id?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (id) node.id = id;
  return node;
}

export function createPopover<T>(options: PopoverOptions<T>): Popover<T> {
  // ---- DOM (built once, refilled on every open) ----
  const root = el('div', 'popover');
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', `${ID.title} ${ID.quote}`);

  const title = el('h3', 'popover-title', ID.title);
  const closeButton = el('button', 'icon-button popover-close');
  closeButton.type = 'button';
  const closeGlyph = el('span', '');
  closeGlyph.setAttribute('aria-hidden', 'true');
  closeGlyph.textContent = '×';
  closeButton.append(closeGlyph);
  const head = el('div', 'popover-head');
  head.append(title, closeButton);

  const experimental = el('p', 'popover-experimental', ID.experimental);
  const quote = el('p', 'popover-quote', ID.quote);

  const whyHeading = el('h4', 'popover-heading');
  const why = el('p', 'popover-text', ID.why);
  const whySection = el('div', 'popover-section');
  whySection.append(whyHeading, why);

  const suggestionsHeading = el('h4', 'popover-heading');
  const suggestionList = el('ul', 'popover-list');
  const suggestionsSection = el('div', 'popover-section');
  suggestionsSection.append(suggestionsHeading, suggestionList);

  const fpButton = el('button', 'button');
  fpButton.type = 'button';
  // A real link: the report only leaves the page when the user follows it.
  const reportLink = el('a', 'report-link');
  reportLink.target = '_blank';
  reportLink.rel = 'noopener noreferrer';
  const reportLabel = el('span', '');
  const reportArrow = el('span', '');
  reportArrow.setAttribute('aria-hidden', 'true');
  reportArrow.textContent = ' ↗';
  const reportHint = el('span', 'sr-only');
  reportLink.append(reportLabel, reportArrow, reportHint);
  const actions = el('div', 'popover-actions');
  actions.append(fpButton, reportLink);

  root.append(head, experimental, quote, whySection, suggestionsSection, actions);

  // The margin note's line to its highlight; inserted next to the card on first use.
  const connector = el('div', 'popover-connector');
  connector.setAttribute('aria-hidden', 'true');
  connector.hidden = true;

  // ---- State ----
  let anchor: HTMLElement | null = null;
  let current: { context: T } | null = null;
  /** Which line box of a wrapped highlight the popover is attached to. */
  let line = 0;
  let frame = 0;
  let pointerDownOutside = false;

  function fill(model: PopoverModel): void {
    // The card's rule and the connector show the tier's pen (style.css).
    root.dataset.tier = model.tier;
    connector.dataset.tier = model.tier;
    title.dataset.tier = model.tier;
    title.textContent = model.title;
    experimental.textContent = model.experimental ?? '';
    experimental.hidden = model.experimental === null;
    quote.textContent = model.quote;
    whyHeading.textContent = model.why.heading;
    why.textContent = model.why.text;
    suggestionsSection.hidden = model.suggestions === null;
    suggestionsHeading.textContent = model.suggestions?.heading ?? '';
    suggestionList.replaceChildren(
      ...(model.suggestions?.items ?? []).map((text) => {
        const li = el('li', '');
        li.textContent = text;
        return li;
      }),
    );
    fpButton.textContent = model.falsePositive;
    reportLabel.textContent = model.report.label;
    reportHint.textContent = model.report.hint;
    reportLink.href = model.report.href;
    closeButton.setAttribute('aria-label', model.close);
    // Only reference what is shown: a hidden element named in aria-describedby is still read.
    root.setAttribute(
      'aria-describedby',
      model.experimental === null ? ID.why : `${ID.experimental} ${ID.why}`,
    );
  }

  // ---- Geometry ----
  function viewport(): { width: number; height: number } {
    const de = document.documentElement;
    return { width: de.clientWidth, height: de.clientHeight };
  }

  function anchorBox(): Box | null {
    if (!anchor) return null;
    const rects = anchor.getClientRects();
    if (rects.length === 0) return null;
    return rects[Math.min(line, rects.length - 1)] ?? null;
  }

  function anchorVisible(): boolean {
    const box = anchorBox();
    if (!box) return false;
    const { width, height } = viewport();
    let area: Box = { top: 0, right: width, bottom: height, left: 0 };
    const clip = options.clipRect?.();
    if (clip) area = intersection(area, clip);
    return intersects(box, area);
  }

  function sheetColumn(): Column | null {
    const sheet = options.sheet;
    if (!sheet) return null;
    const padding = Number.parseFloat(getComputedStyle(sheet).paddingRight) || 0;
    const rect = sheet.getBoundingClientRect();
    return noteColumn(rect, sheet.clientLeft, sheet.clientWidth, padding, MIN_NOTE_COLUMN);
  }

  function resetGeometry(): void {
    for (const p of ['top', 'left', 'width', 'maxWidth', 'maxHeight'] as const) root.style[p] = '';
    connector.hidden = true;
  }

  function place(): CardMode | null {
    const box = anchorBox();
    if (!box) return null;
    const vp = viewport();
    // The window size as media queries see it (scrollbar included).
    const screen = { width: window.innerWidth || vp.width, height: window.innerHeight || vp.height };
    const column = isCompactViewport(screen) ? null : sheetColumn();
    resetGeometry();

    if (chooseCardMode(screen, column !== null, false) === 'margin' && column) {
      root.dataset.mode = 'margin';
      root.style.maxHeight = `${Math.max(0, vp.height - 2 * VIEWPORT_MARGIN)}px`;
      root.style.width = `${placeMarginNote(box, column, 0, vp).width}px`;
      const note = placeMarginNote(box, column, root.offsetHeight, vp);
      root.style.top = `${note.top}px`;
      root.style.left = `${note.left}px`;
      if (note.connector) {
        connector.style.top = `${note.connector.top}px`;
        connector.style.left = `${note.connector.left}px`;
        connector.style.width = `${note.connector.width}px`;
        connector.hidden = false;
      }
      return 'margin';
    }

    if (!isCompactViewport(screen)) {
      root.dataset.mode = 'float';
      root.style.maxWidth = `${Math.max(0, vp.width - 2 * VIEWPORT_MARGIN)}px`;
      root.style.maxHeight = `${Math.max(0, vp.height - 2 * VIEWPORT_MARGIN)}px`;
      const size = { width: root.offsetWidth, height: root.offsetHeight };
      const pos = placePopover(box, size, vp);
      if (chooseCardMode(screen, false, coversAnchor(pos, size, box)) === 'float') {
        root.style.top = `${pos.top}px`;
        root.style.left = `${pos.left}px`;
        root.dataset.placement = pos.placement;
        return 'float';
      }
      resetGeometry();
    }

    root.dataset.mode = 'sheet'; // fixed to the bottom by style.css
    return 'sheet';
  }

  /**
   * Bottom sheet: when it covers the highlight, scroll (never move focus) so the highlight
   * comes to the top of the view, above the sheet. scrollIntoView handles both the result
   * pane (when it scrolls on its own) and the page; marks keep a scroll margin (style.css).
   */
  function revealAboveSheet(): void {
    const box = anchorBox();
    if (!anchor || !box) return;
    if (box.bottom + 12 <= root.getBoundingClientRect().top) return;
    const behavior = matches('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth';
    anchor.scrollIntoView({ block: 'start', inline: 'nearest', behavior });
  }

  // ---- Open / close ----
  function open(request: OpenRequest<T>): void {
    if (anchor) hide(null);
    fill(request.model);
    anchor = request.anchor;
    current = { context: request.context };
    const { point } = request;
    line = point ? lineIndexAt(anchor.getClientRects(), point.x, point.y) : 0;
    anchor.setAttribute('aria-expanded', 'true');
    pointerDownOutside = false;
    if (!connector.isConnected) root.after(connector);
    root.hidden = false;
    const mode = place();
    listen(true);
    root.focus({ preventScroll: true });
    if (mode === 'sheet') revealAboveSheet();
  }

  /** Closes; moves focus to `focusTo` first (before the focused control is hidden). */
  function hide(focusTo: HTMLElement | null, preventScroll = true): void {
    const was = anchor;
    if (!was) return;
    anchor = null;
    current = null;
    listen(false);
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    was.setAttribute('aria-expanded', 'false');
    if (focusTo?.isConnected) focusTo.focus({ preventScroll });
    root.hidden = true;
    connector.hidden = true;
  }

  function close({ returnFocus = false }: { returnFocus?: boolean } = {}): void {
    hide(returnFocus ? anchor : null);
  }

  // ---- Events on the dialog itself ----
  closeButton.addEventListener('click', () => close({ returnFocus: true }));

  fpButton.addEventListener('click', (e) => {
    if (!current) return;
    const { context } = current;
    hide(null);
    options.onFalsePositive(context, e.detail > 0);
  });

  // Following the link (click, Enter, or a middle click for a background tab) also
  // dismisses the entry. The default action is kept: the browser opens the form.
  function onReport(e: MouseEvent): void {
    if (!current || (e.type === 'auxclick' && e.button !== 1)) return;
    const { context } = current;
    hide(null);
    options.onFalsePositive(context, e.detail > 0);
  }
  reportLink.addEventListener('click', onReport);
  reportLink.addEventListener('auxclick', onReport);

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !anchor) return;
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === root || active === closeButton) {
        e.preventDefault();
        close({ returnFocus: true });
      }
      return;
    }
    if (active === reportLink) {
      const next = options.nextAfter?.(anchor) ?? null;
      if (next) {
        e.preventDefault();
        hide(next, false);
      } else {
        // Last highlight: back on it, the browser's own Tab then moves past the pane.
        close({ returnFocus: true });
      }
    }
  });

  root.addEventListener('focusout', (e) => {
    if (!anchor) return;
    const to = e.relatedTarget;
    // null: focus left the window or went to a non-focusable spot (handled by pointerup).
    if (!(to instanceof Node) || root.contains(to) || anchor.contains(to)) return;
    close();
  });

  // ---- Document-level listeners, attached only while open ----
  function inside(target: EventTarget | null): boolean {
    return target instanceof Node && (root.contains(target) || (anchor?.contains(target) ?? false));
  }

  function onPointerDown(e: PointerEvent): void {
    pointerDownOutside = !inside(e.target);
  }

  // Closing on pointerup (not pointerdown) lets a touch scroll that starts outside the
  // popover keep it open: the browser cancels the pointer when it starts scrolling.
  function onPointerUp(e: PointerEvent): void {
    const outside = pointerDownOutside;
    pointerDownOutside = false;
    if (outside && !inside(e.target)) close();
  }

  function onPointerCancel(): void {
    pointerDownOutside = false;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.isComposing || !anchor) return;
    e.preventDefault();
    close({ returnFocus: inside(document.activeElement) });
  }

  function onViewportChange(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!anchor) return;
      if (!anchor.isConnected) close();
      else if (!anchorVisible()) close({ returnFocus: root.contains(document.activeElement) });
      else place();
    });
  }

  const capture = { capture: true } as const;
  const passiveCapture = { capture: true, passive: true } as const;

  function listen(on: boolean): void {
    if (on) {
      document.addEventListener('pointerdown', onPointerDown, capture);
      document.addEventListener('pointerup', onPointerUp, capture);
      document.addEventListener('pointercancel', onPointerCancel, capture);
      document.addEventListener('keydown', onKeyDown);
      // Capturing on window also catches scrolling inside the result pane.
      window.addEventListener('scroll', onViewportChange, passiveCapture);
      window.addEventListener('resize', onViewportChange);
    } else {
      document.removeEventListener('pointerdown', onPointerDown, capture);
      document.removeEventListener('pointerup', onPointerUp, capture);
      document.removeEventListener('pointercancel', onPointerCancel, capture);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onViewportChange, capture);
      window.removeEventListener('resize', onViewportChange);
    }
  }

  return {
    element: root,
    get anchor() {
      return anchor;
    },
    open,
    close,
  };
}
