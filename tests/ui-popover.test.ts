import { describe, expect, it } from 'vitest';
import type { LexiconEntry } from '../web/src/engine/index.ts';
import { POPOVER_TEXT, popoverModel, QUOTE_MAX_CHARS, quoteText } from '../web/src/ui/format.ts';
import {
  intersection,
  intersects,
  lineIndexAt,
  placePopover,
  POPOVER_GAP,
  VIEWPORT_MARGIN,
  type Box,
} from '../web/src/ui/position.ts';

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
      close: 'Close',
    });
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
