import './style.css';
import baseline from './baseline.json';
import type { LexiconEntry } from './engine/index.ts';
import { LEXICON } from './lexicon.ts';
import { focusIndexAfterDismiss } from './ui/dismiss.ts';
import { buildSummary, densitySuffix, popoverModel } from './ui/format.ts';
import { analyzeDraft, compileLexicons } from './ui/lexicons.ts';
import { createPhraseReport } from './ui/phrase-report.ts';
import { createPopover } from './ui/popover.ts';
import { loadExperimental, loadSensitivity, saveExperimental, saveSensitivity } from './ui/prefs.ts';
import { renderMirror, type RenderedHighlight } from './ui/render.ts';
import { newPhraseReportUrl } from './ui/report.ts';
import { isSensitivity } from './ui/sensitivity.ts';

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
const sensitivitySelect = byId<HTMLSelectElement>('sensitivity');
const summaryBox = byId<HTMLDivElement>('summary');
const summaryText = byId<HTMLSpanElement>('summary-text');
const summaryDensity = byId<HTMLSpanElement>('summary-density');
const summaryNote = byId<HTMLParagraphElement>('summary-note');
const summaryNoteText = byId<HTMLSpanElement>('summary-note-text');
const enableButton = byId<HTMLButtonElement>('enable-experimental');
const dismissedLine = byId<HTMLParagraphElement>('summary-dismissed');
const dismissedLabel = byId<HTMLSpanElement>('summary-dismissed-text');
const undoButton = byId<HTMLButtonElement>('undo-dismiss');
const advanced = byId<HTMLDetailsElement>('advanced');
const reportPhraseLink = byId<HTMLAnchorElement>('report-phrase');

// The empty "report an AI-like phrase" form, for keyboard users and phrases not on screen.
reportPhraseLink.href = newPhraseReportUrl('');

const entries: ReadonlyMap<string, LexiconEntry> = new Map(LEXICON.map((e) => [e.id, e]));

let experimental = loadExperimental();
toggle.checked = experimental;
let sensitivity = loadSensitivity();
sensitivitySelect.value = sensitivity;

/** Entry IDs marked "Not AI-like (false positive)". Memory only, for this page view. */
const dismissed = new Set<string>();

// Recompiled only when the toggle changes, an entry is dismissed, or Undo is pressed.
// Dismissed entries are left out before compiling, so overlaps are settled without them.
const choice = () => ({ experimental, dismissed, sensitivity: { level: sensitivity, data: baseline } });
let lexicons = compileLexicons(LEXICON, choice());
function recompile(): void {
  lexicons = compileLexicons(LEXICON, choice());
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

// "Report as AI-like" next to text selected in the result pane.
const phraseReport = createPhraseReport(result);
popover.element.after(phraseReport.element);

/**
 * A false positive from the popover: both "Not AI-like (false positive)" and the
 * "Report false positive" link land here. Every highlight of the entry is dismissed for
 * the rest of this page view (memory only), and the summary offers Undo.
 * M3 reports by opening the public GitHub issue form: the link itself (a plain <a>, which
 * the browser opens in a new tab) carries the entry ID and the matched text, so the
 * matched text goes into the URL only when the user clicks Report. Nothing is sent by
 * script.
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
  phraseReport.hide();
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
    // With tier 2 off there is nothing to compare against.
    baseline:
      sensitivity === 'off'
        ? null
        : { years: baseline.years, pooledPer1k: baseline.levels[sensitivity].pooledPer1k },
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
  phraseReport.hide();
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
sensitivitySelect.addEventListener('change', () => {
  if (!isSensitivity(sensitivitySelect.value)) return;
  sensitivity = sensitivitySelect.value;
  saveSensitivity(sensitivity);
  recompile();
  schedule();
});
enableButton.addEventListener('click', () => {
  // The toggle lives in the Advanced area: open it, so the new state is visible there.
  advanced.open = true;
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
  // This button disappears with the update; stay with the results rather than jump to
  // the Advanced area (the summary's live region announces the change).
  result.focus({ preventScroll: true });
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
