import { describe, expect, it } from 'vitest';
import type { LexiconEntry } from '../web/src/engine/index.ts';
import { POPOVER_TEXT, popoverModel, QUOTE_MAX_CHARS, quoteText } from '../web/src/ui/format.ts';
import {
  chooseCardMode,
  coversAnchor,
  intersection,
  intersects,
  isCompactViewport,
  lineIndexAt,
  NOTE_GAP,
  NOTE_INSET,
  noteColumn,
  placeMarginNote,
  placePopover,
  placeWithin,
  POPOVER_GAP,
  VIEWPORT_MARGIN,
  type Box,
} from '../web/src/ui/position.ts';
import { falsePositiveReportUrl } from '../web/src/ui/report.ts';

const lexical: LexiconEntry = {
  id: 'en.lexical.delve-into',
  pattern: 'delve into',
  match: 'phrase',
  inflect: true,
  tier: 'lexical',
  lang: 'en',
  status: 'accepted',
  note: 'Strongly over-represented in LLM-polished academic text since 2023.',
  suggestions: ['examine', 'explore', 'look at'],
  added: '2026-10-22',
};

describe('popover content model', () => {
  it('has title, quote, why and suggestions for an accepted entry with suggestions', () => {
    const m = popoverModel(lexical, 'delve into');
    expect(m).toEqual({
      tier: 'lexical',
      title: 'Overused wording',
      experimental: null,
      quote: '“delve into”',
      why: { heading: "Why it's flagged", text: lexical.note },
      suggestions: { heading: 'Suggestions', items: ['examine', 'explore', 'look at'] },
      falsePositive: 'Not AI-like (false positive)',
      report: {
        label: 'Report false positive',
        hint: ' (opens GitHub in a new tab)',
        href: falsePositiveReportUrl('en.lexical.delve-into', 'delve into'),
      },
      close: 'Close',
    });
  });

  it('links the report to the pre-filled false-positive form for this entry and text', () => {
    const href = popoverModel(lexical, 'Delved\n into').report.href;
    const u = new URL(href);
    expect(`${u.origin}${u.pathname}`).toBe('https://github.com/ShuhongDai/ai-prescreen/issues/new');
    expect(u.searchParams.get('template')).toBe('report-false-positive.yml');
    expect(u.searchParams.get('entry_id')).toBe('en.lexical.delve-into');
    expect(u.searchParams.get('matched_text')).toBe('Delved into');
  });

  it('marks candidate entries as experimental', () => {
    const m = popoverModel({ ...lexical, status: 'candidate' }, 'delved into');
    expect(m.experimental).toBe('Experimental entry — still under review');
    expect(popoverModel({ ...lexical, status: 'watch' }, 'x').experimental).toBeNull();
  });

  it('leaves out the suggestions section when there are none', () => {
    expect(popoverModel({ ...lexical, suggestions: [] }, 'x').suggestions).toBeNull();
    const { suggestions: _omit, ...withoutField } = lexical;
    expect(popoverModel(withoutField, 'x').suggestions).toBeNull();
    expect(popoverModel({ ...lexical, suggestions: ['  ', ''] }, 'x').suggestions).toBeNull();
    expect(popoverModel({ ...lexical, suggestions: [' examine ', ' '] }, 'x').suggestions).toEqual({
      heading: 'Suggestions',
      items: ['examine'],
    });
  });

  it('always has the "why" section and the false-positive button', () => {
    const artifact: LexiconEntry = {
      ...lexical,
      id: 'en.artifact.copy-code',
      tier: 'artifact',
      note: '  ',
      suggestions: undefined,
    };
    const m = popoverModel(artifact, 'Copy code');
    expect(m.title).toBe('Chatbot artifact');
    expect(m.why).toEqual({ heading: "Why it's flagged", text: POPOVER_TEXT.noNote });
    expect(m.falsePositive).toBe('Not AI-like (false positive)');
  });

  it('never uses verdict wording', () => {
    const m = popoverModel({ ...lexical, status: 'candidate' }, 'delve into');
    const strings = [m.title, m.experimental, m.quote, m.why.heading, m.suggestions?.heading, m.close];
    for (const s of [...strings, ...Object.values(POPOVER_TEXT)]) {
      expect(s ?? '').not.toMatch(/AI[- ]generated|written by AI|probability|detected/i);
    }
  });
});

describe('quoteText', () => {
  it('puts the text on one line in curly quotes', () => {
    expect(quoteText('  Certainly!\n\nHere is\ta revised version ')).toBe(
      '“Certainly! Here is a revised version”',
    );
  });

  it(`cuts long text at ${QUOTE_MAX_CHARS} characters without splitting a code point`, () => {
    const long = 'word '.repeat(40);
    const q = quoteText(long);
    expect(Array.from(q.slice(1, -1)).length).toBeLessThanOrEqual(QUOTE_MAX_CHARS);
    expect(q.endsWith('…”')).toBe(true);
    const astral = '𝔸'.repeat(100);
    const qa = quoteText(astral, 10);
    expect(qa).toBe(`“${'𝔸'.repeat(9)}…”`);
    expect(quoteText('a'.repeat(10), 10)).toBe(`“${'a'.repeat(10)}”`);
  });
});

describe('placePopover', () => {
  const desktop = { width: 1280, height: 800 };
  const size = { width: 352, height: 200 };
  const word = (top: number, left: number, width = 60, height = 20): Box => ({
    top,
    left,
    right: left + width,
    bottom: top + height,
  });

  it('goes below the highlight, left edges aligned, when there is room', () => {
    expect(placePopover(word(100, 300), size, desktop)).toEqual({
      top: 120 + POPOVER_GAP,
      left: 300,
      placement: 'below',
    });
  });

  it('flips above when there is no room below', () => {
    const a = word(700, 300);
    expect(placePopover(a, size, desktop)).toEqual({
      top: 700 - POPOVER_GAP - 200,
      left: 300,
      placement: 'above',
    });
  });

  it('takes the roomier side and clamps into the viewport when neither side fits', () => {
    const tall = { width: 352, height: 500 };
    const nearTop = placePopover(word(300, 40), tall, desktop); // 466 below vs 286 above
    expect(nearTop.placement).toBe('below');
    expect(nearTop.top).toBe(desktop.height - VIEWPORT_MARGIN - 500);
    const nearBottom = placePopover(word(480, 40), tall, desktop); // 286 below vs 466 above
    expect(nearBottom.placement).toBe('above');
    expect(nearBottom.top).toBe(VIEWPORT_MARGIN);
  });

  it('clamps horizontally on a narrow (mobile) viewport', () => {
    const phone = { width: 360, height: 640 };
    const popover = { width: 360 - 2 * VIEWPORT_MARGIN, height: 220 };
    expect(placePopover(word(100, 290), popover, phone)).toMatchObject({
      left: VIEWPORT_MARGIN,
      placement: 'below',
    });
    const small = { width: 200, height: 120 };
    expect(placePopover(word(100, 300), small, phone).left).toBe(360 - VIEWPORT_MARGIN - 200);
    expect(placePopover(word(100, -30), small, phone).left).toBe(VIEWPORT_MARGIN);
  });

  it('pins a popover larger than the viewport to the top-left margin', () => {
    const huge = { width: 2000, height: 2000 };
    expect(placePopover(word(100, 300), huge, desktop)).toMatchObject({
      top: VIEWPORT_MARGIN,
      left: VIEWPORT_MARGIN,
    });
  });

  it('rounds to whole pixels', () => {
    const p = placePopover({ top: 10.4, left: 20.6, right: 80.2, bottom: 30.3 }, size, desktop);
    expect(Number.isInteger(p.top) && Number.isInteger(p.left)).toBe(true);
  });
});

describe('placeWithin (the selection link, kept inside the visible pane)', () => {
  const pane: Box = { top: 200, left: 600, bottom: 700, right: 1200 };
  const link = { width: 140, height: 24 };
  const caret = (top: number, x: number): Box => ({ top, bottom: top + 20, left: x, right: x + 1 });

  it('goes just below the end of the selection', () => {
    expect(placeWithin(caret(300, 800), link, pane, 4, 4)).toEqual({
      top: 324,
      left: 800,
      placement: 'below',
    });
  });

  it('flips above at the bottom of the pane and clamps to its right edge', () => {
    expect(placeWithin(caret(670, 1150), link, pane, 4, 4)).toEqual({
      top: 670 - 4 - 24,
      left: 1200 - 4 - 140,
      placement: 'above',
    });
  });

  it('never leaves the pane on the left or top', () => {
    const p = placeWithin(caret(150, 500), link, pane, 4, 4);
    expect(p.left).toBe(604);
    expect(p.top).toBeGreaterThanOrEqual(204);
  });

  it('matches placePopover when the bounds are the viewport', () => {
    const a = caret(100, 300);
    const size = { width: 352, height: 200 };
    expect(placeWithin(a, size, { top: 0, left: 0, right: 1280, bottom: 800 })).toEqual(
      placePopover(a, size, { width: 1280, height: 800 }),
    );
  });
});

describe('margin notes', () => {
  const viewport = { width: 1280, height: 860 };
  // A sheet at x 520..1240 (1px border, 16rem = 256px note column, scrollbar of 15px).
  const column = noteColumn({ left: 520 }, 1, 703, 256, 176)!;
  const line = (top: number, right: number): Box => ({ top, bottom: top + 24, left: 600, right });

  it('finds the note column in the sheet\'s right padding, left of a scrollbar', () => {
    expect(column).toEqual({ left: 520 + 1 + 703 - 256, right: 520 + 1 + 703 });
    expect(noteColumn({ left: 0 }, 1, 600, 40, 176)).toBeNull(); // no room: the card floats
  });

  it('fills the column and starts at the highlight\'s line, with a connector under it', () => {
    const note = placeMarginNote(line(300, 700), column, 180, viewport);
    expect(note.left).toBe(column.left + NOTE_GAP);
    expect(note.width).toBe(column.right - NOTE_INSET - (column.left + NOTE_GAP));
    expect(note.top).toBe(296);
    expect(note.connector).toEqual({ top: 300 + 24 + 2, left: 702, width: note.left - 702 });
  });

  it('stays in the viewport and still meets the line when clamped', () => {
    const low = placeMarginNote(line(780, 700), column, 200, viewport);
    expect(low.top).toBe(860 - VIEWPORT_MARGIN - 200);
    expect(low.connector).not.toBeNull();
    const high = placeMarginNote(line(-2, 700), column, 200, viewport);
    expect(high.top).toBe(VIEWPORT_MARGIN);
    expect(high.connector).not.toBeNull();
  });

  it('drops the connector when it would miss the card or has no length', () => {
    // A card shorter than the gap between its clamped top and the line.
    expect(placeMarginNote(line(840, 700), column, 20, viewport).connector).toBeNull();
    // The highlight already ends at the note column.
    expect(placeMarginNote(line(300, column.left + NOTE_GAP - 3), column, 180, viewport).connector).toBeNull();
  });
});

describe('card mode', () => {
  const desktop = { width: 1280, height: 860 };

  it('uses a margin note on a wide, tall screen when the sheet has a note column', () => {
    expect(chooseCardMode(desktop, true, false)).toBe('margin');
    expect(chooseCardMode(desktop, true, true)).toBe('margin'); // floating is not consulted
  });

  it('floats without a note column, unless floating would cover the highlight', () => {
    expect(chooseCardMode(desktop, false, false)).toBe('float');
    expect(chooseCardMode(desktop, false, true)).toBe('sheet');
  });

  it('uses the bottom sheet on narrow or short viewports (phones in either orientation)', () => {
    expect(chooseCardMode({ width: 390, height: 844 }, false, false)).toBe('sheet');
    expect(chooseCardMode({ width: 844, height: 390 }, true, false)).toBe('sheet');
    expect(chooseCardMode({ width: 1280, height: 500 }, true, false)).toBe('sheet');
    expect(isCompactViewport({ width: 767, height: 900 })).toBe(true);
    expect(isCompactViewport({ width: 768, height: 559 })).toBe(true);
    expect(isCompactViewport({ width: 768, height: 560 })).toBe(false);
  });

  it('knows when a floating card covers its highlight (the landscape-phone case)', () => {
    const mark: Box = { top: 69, bottom: 93, left: 675, right: 719 };
    expect(coversAnchor({ top: 13, left: 484 }, { width: 352, height: 369 }, mark)).toBe(true);
    expect(coversAnchor({ top: 99, left: 484 }, { width: 352, height: 200 }, mark)).toBe(false);
  });
});

describe('geometry helpers', () => {
  const box = (top: number, left: number, bottom: number, right: number): Box => ({
    top,
    left,
    bottom,
    right,
  });

  it('intersects and intersection', () => {
    const pane = box(100, 0, 500, 600);
    expect(intersects(box(480, 10, 500, 50), pane)).toBe(true);
    expect(intersects(box(500, 10, 520, 50), pane)).toBe(false); // touching edge only
    expect(intersects(box(40, 10, 60, 50), pane)).toBe(false);
    expect(intersection(box(0, 0, 800, 1280), pane)).toEqual(pane);
  });

  it('lineIndexAt finds the clicked line of a wrapped highlight', () => {
    const lines = [box(100, 400, 120, 600), box(126, 10, 146, 90)];
    expect(lineIndexAt(lines, 500, 110)).toBe(0);
    expect(lineIndexAt(lines, 50, 136)).toBe(1);
    expect(lineIndexAt(lines, 50, 200)).toBe(1); // nearest line
    expect(lineIndexAt([], 0, 0)).toBe(0);
  });
});
