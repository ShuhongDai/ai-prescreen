// "Report as AI-like": a small floating link next to a text selection in the result pane.
// It is a real link to the public GitHub issue form with the selected phrase filled in,
// so nothing leaves the page unless the user follows it.
//
// The phrase comes from the selected text nodes, leaving out the screen-reader-only text
// inside highlights. The link appears once a selection gesture ends, follows scrolling,
// and hides when the selection collapses or leaves the pane, when the pane is re-rendered,
// when the end of the selection scrolls out of view, and on Escape. It never takes the
// selection or the focus away when clicked.

import { intersection, intersects, placeWithin, type Box } from './position.ts';
import { NEW_TAB_HINT, newPhraseReportUrl, REPORT_TEXT_MAX } from './report.ts';

export interface PhraseReport {
  /** The link; the caller inserts it into the document (after the pane, not inside it). */
  readonly element: HTMLAnchorElement;
  /** Hides the link until the selection changes again (e.g. before a re-render). */
  hide(): void;
}

/** Enough raw text for a full report field even after whitespace is collapsed. */
const COLLECT_MAX = REPORT_TEXT_MAX * 4;
const GAP = 4;
const MARGIN = 4;
/** After a press on the link, wait this long before reacting to selection changes, so the
 * click (which may come late after a touch) still finds the link where it was. */
const PRESS_GRACE_MS = 350;

/**
 * The visible text of `range` inside `pane`, from its text nodes in order. Text inside an
 * `.sr-only` element (the hidden " (flagged: …)" in each highlight) is left out. Stops
 * once `limit` characters are collected.
 */
export function visibleSelectedText(range: Range, pane: Node, limit = COLLECT_MAX): string {
  const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
  const start = range.startContainer;
  let node: Node | null;
  if (start.nodeType === Node.TEXT_NODE && pane.contains(start)) {
    walker.currentNode = start;
    node = start;
  } else {
    node = walker.nextNode();
  }
  let out = '';
  let inside = false;
  for (; node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) {
      if (inside) break; // past the end of the range
      continue;
    }
    inside = true;
    if (node.parentElement?.closest('.sr-only')) continue;
    const data = (node as Text).data;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : data.length;
    out += data.slice(from, to);
    if (out.length >= limit) break;
  }
  return out;
}

export function createPhraseReport(pane: HTMLElement): PhraseReport {
  const link = document.createElement('a');
  link.className = 'phrase-report';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.hidden = true;
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = ' ↗';
  const hint = document.createElement('span');
  hint.className = 'sr-only';
  hint.textContent = NEW_TAB_HINT;
  link.append('Report as AI-like', arrow, hint);

  let frame = 0;
  /** A pointer went down in the pane and is not up yet (a selection may be in progress). */
  let dragging = false;
  /** A pointer is down on the link (or was, moments ago). */
  let pressing = false;
  let pressTimer = 0;
  /** Escape, a report or a re-render: stay hidden until the selection changes. */
  let suppressed = false;

  function selectedRanges(): Range[] | null {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    if (!pane.contains(sel.anchorNode) || !pane.contains(sel.focusNode)) return null;
    const ranges: Range[] = [];
    for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i));
    return ranges;
  }

  /** Where the selection ends on screen: the caret there, else its last line box. */
  function endBox(range: Range): Box | null {
    const end = range.cloneRange();
    end.collapse(false);
    const carets = end.getClientRects();
    const caret = carets.length > 0 ? carets[carets.length - 1] : null;
    if (caret && caret.height > 0) return caret;
    const rects = range.getClientRects();
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i]!;
      if (r.width > 1 && r.height > 1) return r;
    }
    return null;
  }

  function visibleArea(): Box {
    const de = document.documentElement;
    const view = { top: 0, right: de.clientWidth, bottom: de.clientHeight, left: 0 };
    return intersection(view, pane.getBoundingClientRect());
  }

  function hideLink(): void {
    if (link.hidden) return;
    // Keyboard focus on the link must not be lost with it.
    if (link.contains(document.activeElement)) pane.focus({ preventScroll: true });
    link.hidden = true;
  }

  function refresh(): void {
    frame = 0;
    if (pressing || dragging) return;
    const ranges = suppressed ? null : selectedRanges();
    if (!ranges) return hideLink();
    const phrase = ranges.map((r) => visibleSelectedText(r, pane)).join(' ');
    const box = phrase.trim() === '' ? null : endBox(ranges[ranges.length - 1]!);
    const at: Box | null = box && {
      top: box.top,
      bottom: box.bottom,
      left: box.right,
      right: box.right + 1,
    };
    const area = visibleArea();
    if (!at || !intersects(at, area)) return hideLink();
    link.href = newPhraseReportUrl(phrase);
    link.hidden = false;
    const pos = placeWithin(at, { width: link.offsetWidth, height: link.offsetHeight }, area, GAP, MARGIN);
    link.style.top = `${pos.top}px`;
    link.style.left = `${pos.left}px`;
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(refresh);
  }

  // ---- Selection and pane ----
  document.addEventListener('selectionchange', () => {
    suppressed = false;
    if (!dragging) schedule();
  });
  pane.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    hideLink();
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    schedule();
  };
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', endDrag, true);
  // Capturing on window also catches scrolling inside the pane.
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || link.hidden) return;
    suppressed = true;
    hideLink();
  });

  // ---- The link itself ----
  // No default on mousedown: the selection stays and the focus does not move.
  link.addEventListener('mousedown', (e) => e.preventDefault());
  link.addEventListener('pointerdown', () => {
    pressing = true;
    clearTimeout(pressTimer);
  });
  const release = (delay: number) => () => {
    if (!pressing) return;
    clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      pressing = false;
      schedule();
    }, delay);
  };
  document.addEventListener('pointerup', release(PRESS_GRACE_MS), true);
  document.addEventListener('pointercancel', release(0), true);
  // Followed (click, Enter, middle click): the browser opens the form; the link hides.
  const followed = (e: MouseEvent) => {
    if (e.type === 'auxclick' && e.button !== 1) return;
    suppressed = true;
    hideLink();
  };
  link.addEventListener('click', followed);
  link.addEventListener('auxclick', followed);

  return {
    element: link,
    hide() {
      suppressed = true;
      hideLink();
    },
  };
}
