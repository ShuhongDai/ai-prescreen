import './style.css';
import type { LexiconEntry } from './engine/index.ts';
import { LEXICON } from './lexicon.ts';
import { focusIndexAfterDismiss } from './ui/dismiss.ts';
import { buildSummary, densitySuffix, popoverModel } from './ui/format.ts';
import { analyzeDraft, compileLexicons } from './ui/lexicons.ts';
import { createPopover } from './ui/popover.ts';
import { loadExperimental, saveExperimental } from './ui/prefs.ts';
import { renderMirror, type RenderedHighlight } from './ui/render.ts';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

/** Writes only on change, so a live region is not re-announced for nothing. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

const input = byId<HTMLTextAreaElement>('input');
const result = byId<HTMLDivElement>('result');
const resultHint = byId<HTMLParagraphElement>('result-hint');
const toggle = byId<HTMLInputElement>('experimental');
const summaryBox = byId<HTMLDivElement>('summary');
const summaryText = byId<HTMLSpanElement>('summary-text');
const summaryDensity = byId<HTMLSpanElement>('summary-density');
const summaryNote = byId<HTMLParagraphElement>('summary-note');
const summaryNoteText = byId<HTMLSpanElement>('summary-note-text');
const enableButton = byId<HTMLButtonElement>('enable-experimental');
const dismissedLine = byId<HTMLParagraphElement>('summary-dismissed');
const dismissedLabel = byId<HTMLSpanElement>('summary-dismissed-text');
const undoButton = byId<HTMLButtonElement>('undo-dismiss');

const entries: ReadonlyMap<string, LexiconEntry> = new Map(LEXICON.map((e) => [e.id, e]));

let experimental = loadExperimental();
toggle.checked = experimental;

/** Entry IDs marked "Not AI-like (false positive)". Memory only, for this page view. */
const dismissed = new Set<string>();

// Recompiled only when the toggle changes, an entry is dismissed, or Undo is pressed.
// Dismissed entries are left out before compiling, so overlaps are settled without them.
let lexicons = compileLexicons(LEXICON, { experimental, dismissed });
function recompile(): void {
  lexicons = compileLexicons(LEXICON, { experimental, dismissed });
}

/** The text the result pane shows, and its highlights in text order. */
let shownText = '';
let highlights: RenderedHighlight[] = [];

const matchedText = (h: RenderedHighlight) => shownText.slice(h.match.start, h.match.end);

const popover = createPopover<RenderedHighlight>({
  onFalsePositive(item, viaPointer) {
    onFalsePositive(item.entry, matchedText(item));
    focusAfterDismiss(item.match.start, viaPointer);
  },
  clipRect: () => result.getBoundingClientRect(),
  nextAfter: (anchor) => highlights[Number(anchor.dataset.i) + 1]?.el ?? null,
});
result.after(popover.element);

/**
 * "Not AI-like (false positive)" in the popover. M2 scope: every highlight of the entry
 * is dismissed for the rest of this page view (memory only; nothing is stored or sent),
 * and the summary offers Undo.
 * M3 adds the option to report the false positive to GitHub here (a pre-filled issue).
 * The matched text may only go into such a report if the user explicitly ticks a box.
 */
function onFalsePositive(entry: LexiconEntry, _matchedText: string): void {
  dismissed.add(entry.id);
  recompile();
  update();
}

/** After a dismissal, focus the next highlight (else the previous one, else Undo). */
function focusAfterDismiss(pos: number, viaPointer: boolean): void {
  const i = focusIndexAfterDismiss(highlights.map((h) => h.match.start), pos);
  const target = highlights[i]?.el ?? undoButton;
  // Keeps keyboard and screen-reader users in place; a pointer user is never scrolled.
  target.focus({ preventScroll: viaPointer });
}

// Normally one update per animation frame. When the last update was too slow for that
// (very long drafts), wait for a pause in typing instead so the editor stays responsive.
const SLOW_UPDATE_MS = 30;
const TYPING_PAUSE_MS = 150;
let lastUpdateMs = 0;
let frame = 0;
let timer = 0;

function run(): void {
  cancelAnimationFrame(frame);
  clearTimeout(timer);
  frame = 0;
  timer = 0;
  update();
}

function schedule(): void {
  if (lastUpdateMs > SLOW_UPDATE_MS) {
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(timer);
    timer = window.setTimeout(run, TYPING_PAUSE_MS);
  } else if (!frame && !timer) {
    frame = requestAnimationFrame(run);
  }
}

function update(): void {
  const started = performance.now();
  // Re-rendering replaces every highlight: never leave a popover on a stale one.
  if (popover.anchor) {
    const hadFocus = popover.element.contains(document.activeElement);
    popover.close();
    if (hadFocus) result.focus({ preventScroll: true });
  }

  const text = input.value;
  const idle = text.trim() === '';
  shownText = idle ? '' : text;
  const { result: res, experimentalShown, experimentalHidden } = analyzeDraft(shownText, lexicons);
  const summary = buildSummary({
    idle,
    stats: res.stats,
    experimentalShown,
    experimentalHidden,
    dismissedEntries: dismissed.size,
  });

  summaryBox.dataset.state = summary.state;
  setText(summaryText, summary.text);
  // Outside the live regions: it changes on nearly every keystroke. Emptied (not just
  // hidden) when there is no rate, since #result's aria-describedby still reads it.
  setText(summaryDensity, densitySuffix(summary));
  setHidden(summaryDensity, summary.density === null);
  setText(summaryNoteText, summary.note ?? '');
  setHidden(summaryNote, summary.note === null);
  setHidden(enableButton, !summary.offerExperimental);
  setText(dismissedLabel, summary.dismissed ?? '');
  setHidden(dismissedLine, summary.dismissed === null);
  setHidden(resultHint, summary.state !== 'flagged');
  result.dataset.state = summary.state;
  highlights = renderMirror(result, shownText, res.matches, entries);
  lastUpdateMs = performance.now() - started;
}

// ---- Highlights: one set of listeners on the container (event delegation) ----

function highlightAt(target: EventTarget | null): RenderedHighlight | null {
  if (!(target instanceof Element)) return null;
  const mark = target.closest<HTMLElement>('mark[data-i]');
  if (!mark || mark.parentElement !== result) return null;
  const item = highlights[Number(mark.dataset.i)];
  return item?.el === mark ? item : null;
}

function toggleFor(item: RenderedHighlight, point?: { x: number; y: number }): void {
  if (popover.anchor === item.el) {
    popover.close({ returnFocus: true });
    return;
  }
  popover.open({
    anchor: item.el,
    model: popoverModel(item.entry, matchedText(item)),
    context: item,
    point,
  });
}

result.addEventListener('click', (e) => {
  if (e.detail > 1) return; // second click of a double-click (word selection)
  const item = highlightAt(e.target);
  if (!item) return;
  // A drag that selects text and ends on a highlight is not a click on it.
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed && result.contains(selection.anchorNode)) return;
  toggleFor(item, e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined);
});

// Enter acts on keydown, Space on keyup (like a native button), so a held key does not
// reopen the popover and Space never scrolls the pane.
let spaceDownOn: HTMLElement | null = null;
result.addEventListener('keydown', (e) => {
  if ((e.key !== 'Enter' && e.key !== ' ') || e.altKey || e.ctrlKey || e.metaKey) return;
  const item = highlightAt(e.target);
  if (!item || e.target !== item.el) return;
  e.preventDefault();
  if (e.key === ' ') spaceDownOn = item.el;
  else if (!e.repeat) toggleFor(item);
});
result.addEventListener('keyup', (e) => {
  if (e.key !== ' ') return;
  const armed = spaceDownOn;
  spaceDownOn = null;
  const item = highlightAt(e.target);
  if (!item || item.el !== armed) return;
  e.preventDefault();
  toggleFor(item);
});

// ---- Controls ----

input.addEventListener('input', schedule);
toggle.addEventListener('change', () => {
  experimental = toggle.checked;
  saveExperimental(experimental);
  recompile();
  schedule();
});
enableButton.addEventListener('click', () => {
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
  toggle.focus();
});
undoButton.addEventListener('click', () => {
  dismissed.clear();
  recompile();
  update();
  // The Undo button is hidden now; continue from the result pane.
  result.focus({ preventScroll: true });
});

// Covers text the browser restores into the textarea on reload / back navigation.
update();
