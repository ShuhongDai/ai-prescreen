import './style.css';
import { analyze, compileLexicon, type LexiconEntry } from './engine/index.ts';
import { LEXICON } from './lexicon.ts';
import { buildSummary, isExperimental } from './ui/format.ts';
import { loadExperimental, saveExperimental } from './ui/prefs.ts';
import { renderMirror } from './ui/render.ts';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const input = byId<HTMLTextAreaElement>('input');
const result = byId<HTMLDivElement>('result');
const toggle = byId<HTMLInputElement>('experimental');
const summaryText = byId<HTMLParagraphElement>('summary-text');
const summaryNote = byId<HTMLParagraphElement>('summary-note');
const summaryNoteText = byId<HTMLSpanElement>('summary-note-text');
const enableButton = byId<HTMLButtonElement>('enable-experimental');
const summaryBox = summaryText.parentElement as HTMLElement;

const entries: ReadonlyMap<string, LexiconEntry> = new Map(LEXICON.map((e) => [e.id, e]));
const fromCandidate = (m: { entryId: string }) => isExperimental(entries.get(m.entryId));

// With candidates included: used to count what the experimental lexicon would add while
// it is off. Compiled once; the active lexicon is recompiled only when the toggle changes.
const withCandidates = compileLexicon(LEXICON, { includeCandidates: true });
let experimental = loadExperimental();
let active = compileLexicon(LEXICON, { includeCandidates: experimental });
toggle.checked = experimental;

function update(): void {
  const text = input.value;
  const idle = text.trim() === '';
  const res = analyze(idle ? '' : text, active);
  const experimentalHidden =
    !idle && !experimental ? analyze(text, withCandidates).matches.filter(fromCandidate).length : 0;
  const summary = buildSummary({
    idle,
    stats: res.stats,
    experimentalShown: experimental ? res.matches.filter(fromCandidate).length : 0,
    experimentalHidden,
  });

  summaryBox.dataset.state = summary.state;
  summaryText.textContent = summary.text;
  summaryNoteText.textContent = summary.note ?? '';
  summaryNote.hidden = summary.note === null;
  enableButton.hidden = !summary.offerExperimental;
  result.dataset.state = summary.state;
  renderMirror(result, idle ? '' : text, res.matches, entries);
}

let frame = 0;
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    update();
  });
}

input.addEventListener('input', schedule);
toggle.addEventListener('change', () => {
  experimental = toggle.checked;
  saveExperimental(experimental);
  active = compileLexicon(LEXICON, { includeCandidates: experimental });
  schedule();
});
enableButton.addEventListener('click', () => {
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
  toggle.focus();
});

// Covers text the browser restores into the textarea on reload / back navigation.
update();
