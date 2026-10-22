// The highlight popover: a single non-modal dialog, anchored to one highlight at a time.
// Text goes in through textContent only (never innerHTML).
//
// Focus flow: opening moves focus into the dialog. Escape and the close button close it
// and return focus to the highlight. Tab past the last control moves on to the next
// highlight; Shift+Tab before the first control returns to the highlight (as if the
// dialog sat right after its highlight in the tab order). Clicking outside, or moving
// focus elsewhere, just closes it.
//
// Position: fixed, next to the clicked line of the highlight (below, or above when there
// is no room), clamped to the viewport. It follows the highlight while the page or the
// result pane scrolls and closes once the highlight is scrolled out of view.

import type { PopoverModel } from './format.ts';
import {
  intersection,
  intersects,
  lineIndexAt,
  placePopover,
  VIEWPORT_MARGIN,
  type Box,
} from './position.ts';

export interface PopoverOptions<T> {
  /**
   * "Not AI-like (false positive)" was pressed; the popover is already closed.
   * `viaPointer` is false when the button was activated from the keyboard.
   */
  onFalsePositive(context: T, viaPointer: boolean): void;
  /** Client rect the highlight must stay visible in besides the viewport (the result pane). */
  clipRect?(): Box | null;
  /** The highlight after `anchor` in tab order (for Tab past the end of the popover). */
  nextAfter?(anchor: HTMLElement): HTMLElement | null;
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
  const actions = el('div', 'popover-actions');
  actions.append(fpButton);

  root.append(head, experimental, quote, whySection, suggestionsSection, actions);

  // ---- State ----
  let anchor: HTMLElement | null = null;
  let current: { context: T } | null = null;
  /** Which line box of a wrapped highlight the popover is attached to. */
  let line = 0;
  let frame = 0;
  let pointerDownOutside = false;

  function fill(model: PopoverModel): void {
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

  function place(): void {
    const box = anchorBox();
    if (!box) return;
    const vp = viewport();
    root.style.maxWidth = `${Math.max(0, vp.width - 2 * VIEWPORT_MARGIN)}px`;
    root.style.maxHeight = `${Math.max(0, vp.height - 2 * VIEWPORT_MARGIN)}px`;
    const pos = placePopover(box, { width: root.offsetWidth, height: root.offsetHeight }, vp);
    root.style.top = `${pos.top}px`;
    root.style.left = `${pos.left}px`;
    root.dataset.placement = pos.placement;
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
    root.hidden = false;
    place();
    listen(true);
    root.focus({ preventScroll: true });
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
    if (active === fpButton) {
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
