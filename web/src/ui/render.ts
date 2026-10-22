// Builds the result pane DOM. User text and lexicon strings only ever go into text
// nodes / textContent / attributes — never innerHTML.
//
// Kept cheap for 20,000-word inputs with many highlights: one pass over the segments,
// everything built in a detached fragment, no layout reads and no per-mark listeners
// (main.ts listens once on the container).

import type { LexiconEntry, Match } from '../engine/index.ts';
import { isExperimental, screenReaderText } from './format.ts';
import { buildSegments } from './segments.ts';

export interface RenderedHighlight {
  match: Match;
  entry: LexiconEntry;
  /** The <mark>; its `data-i` is this highlight's index in the returned array. */
  el: HTMLElement;
}

/** An empty highlight for one entry and tier; every highlight is a clone of one of these. */
function markTemplate(entry: LexiconEntry, tier: Match['tier']): HTMLElement {
  const mark = document.createElement('mark');
  mark.className = isExperimental(entry) ? `hl hl--${tier} hl--experimental` : `hl hl--${tier}`;
  mark.dataset.entryId = entry.id;
  // Opens the popover (click, Enter or Space; see main.ts).
  mark.tabIndex = 0;
  mark.setAttribute('role', 'button');
  mark.setAttribute('aria-haspopup', 'dialog');
  mark.setAttribute('aria-expanded', 'false');
  const hint = document.createElement('span');
  hint.className = 'sr-only';
  hint.textContent = screenReaderText(entry);
  mark.append(hint);
  return mark;
}

/** Replaces the container's content; returns the highlights in text order. */
export function renderMirror(
  container: HTMLElement,
  text: string,
  matches: readonly Match[],
  entries: ReadonlyMap<string, LexiconEntry>,
): RenderedHighlight[] {
  const frag = document.createDocumentFragment();
  const out: RenderedHighlight[] = [];
  const templates = new Map<string, HTMLElement>();

  for (const seg of buildSegments(text, matches)) {
    const entry = seg.match ? entries.get(seg.match.entryId) : undefined;
    if (!seg.match || !entry) {
      frag.append(seg.text);
      continue;
    }
    const key = `${seg.match.tier} ${entry.id}`;
    let template = templates.get(key);
    if (!template) {
      template = markTemplate(entry, seg.match.tier);
      templates.set(key, template);
    }
    const mark = template.cloneNode(true) as HTMLElement;
    mark.dataset.i = String(out.length);
    mark.prepend(seg.text);
    frag.append(mark);
    out.push({ match: seg.match, entry, el: mark });
  }
  container.replaceChildren(frag);
  return out;
}
