// Builds the result pane DOM. User text and lexicon strings only ever go into text
// nodes / textContent / attributes — never innerHTML.

import type { LexiconEntry, Match } from '../engine/index.ts';
import { isExperimental, screenReaderText, tooltipText } from './format.ts';
import { buildSegments } from './segments.ts';

export function renderMirror(
  container: HTMLElement,
  text: string,
  matches: readonly Match[],
  entries: ReadonlyMap<string, LexiconEntry>,
): void {
  const frag = document.createDocumentFragment();
  for (const seg of buildSegments(text, matches)) {
    const entry = seg.match ? entries.get(seg.match.entryId) : undefined;
    if (!seg.match || !entry) {
      frag.append(document.createTextNode(seg.text));
      continue;
    }
    const mark = document.createElement('mark');
    mark.className = `hl hl--${seg.match.tier}`;
    if (isExperimental(entry)) mark.classList.add('hl--experimental');
    mark.dataset.entryId = entry.id;
    mark.title = tooltipText(entry);
    mark.append(document.createTextNode(seg.text));
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = screenReaderText(entry);
    mark.append(sr);
    frag.append(mark);
  }
  container.replaceChildren(frag);
}
