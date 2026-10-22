import { describe, expect, it } from 'vitest';
import type { AnalysisStats, LexiconEntry, Match } from '../web/src/engine/index.ts';
import {
  buildSummary,
  CLEAN_REVIEWED_TEXT,
  CLEAN_TEXT,
  formatPer1k,
  IDLE_TEXT,
  screenReaderText,
  tooltipText,
} from '../web/src/ui/format.ts';
import { loadExperimental, saveExperimental, type StorageLike } from '../web/src/ui/prefs.ts';
import { buildSegments } from '../web/src/ui/segments.ts';

function stats(partial: Partial<AnalysisStats['counts']>, words: number): AnalysisStats {
  const counts = { artifact: 0, lexical: 0, stylistic: 0, ...partial };
  const total = counts.artifact + counts.lexical + counts.stylistic;
  return { words, counts, total, per1k: words === 0 ? 0 : (total / words) * 1000 };
}

const base = { idle: false, experimentalShown: 0, experimentalHidden: 0 };

describe('buildSegments', () => {
  const m = (start: number, end: number, entryId = 'x'): Match => ({
    entryId,
    tier: 'artifact',
    start,
    end,
  });

  it('splits text around matches and reassembles exactly', () => {
    const text = 'Certainly! Here is the text. Copy code';
    const segs = buildSegments(text, [m(29, 38), m(0, 18)]);
    expect(segs.map((s) => [s.text, s.match !== null])).toEqual([
      ['Certainly! Here is', true],
      [' the text. ', false],
      ['Copy code', true],
    ]);
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });

  it('drops overlapping, empty and out-of-range matches', () => {
    const text = 'abcdef';
    const segs = buildSegments(text, [m(0, 3), m(2, 5), m(4, 4), m(5, 99)]);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(['abc', 'f']);
  });

  it('returns no segments for empty text', () => {
    expect(buildSegments('', [])).toEqual([]);
  });
});

describe('buildSummary', () => {
  it('has an idle state', () => {
    const s = buildSummary({ ...base, idle: true, stats: stats({}, 0) });
    expect(s).toMatchObject({ state: 'idle', text: IDLE_TEXT, note: null });
  });

  it('has a neutral clean state', () => {
    const s = buildSummary({ ...base, stats: stats({}, 120) });
    expect(s).toMatchObject({ state: 'clean', text: CLEAN_TEXT, note: null, offerExperimental: false });
  });

  it('uses singular and plural and one decimal per 1k words', () => {
    expect(buildSummary({ ...base, stats: stats({ artifact: 1 }, 320) }).text).toBe(
      '1 artifact · 3.1 per 1k words',
    );
    expect(buildSummary({ ...base, stats: stats({ artifact: 2, lexical: 7 }, 1000) }).text).toBe(
      '2 artifacts · 7 overused words · 9.0 per 1k words',
    );
    expect(buildSummary({ ...base, stats: stats({ lexical: 1, stylistic: 3 }, 2000) }).text).toBe(
      '1 overused word · 3 style signals · 2.0 per 1k words',
    );
  });

  it('omits the rate when there are no words', () => {
    expect(buildSummary({ ...base, stats: stats({ artifact: 1 }, 0) }).text).toBe('1 artifact');
  });

  it('says when experimental matches are hidden', () => {
    const clean = buildSummary({ ...base, experimentalHidden: 3, stats: stats({}, 50) });
    expect(clean.text).toBe(CLEAN_REVIEWED_TEXT);
    expect(clean.note).toBe(
      '3 possible matches from experimental entries are hidden — turn on Experimental lexicon to see them.',
    );
    expect(clean.offerExperimental).toBe(true);
    const one = buildSummary({ ...base, experimentalHidden: 1, stats: stats({ artifact: 1 }, 50) });
    expect(one.state).toBe('flagged');
    expect(one.note).toMatch(/^1 possible match from experimental entries is hidden/);
  });

  it('notes shown experimental matches', () => {
    expect(
      buildSummary({ ...base, experimentalShown: 2, stats: stats({ artifact: 2 }, 100) }).note,
    ).toBe('All 2 come from experimental entries that are still under review.');
    expect(
      buildSummary({ ...base, experimentalShown: 1, stats: stats({ artifact: 3 }, 100) }).note,
    ).toBe('1 of these comes from an experimental entry that is still under review.');
  });

  it('never uses verdict wording', () => {
    const texts = [
      buildSummary({ ...base, idle: true, stats: stats({}, 0) }),
      buildSummary({ ...base, stats: stats({}, 10) }),
      buildSummary({ ...base, experimentalHidden: 2, stats: stats({ artifact: 1 }, 10) }),
      buildSummary({ ...base, experimentalShown: 1, stats: stats({ artifact: 1 }, 10) }),
    ].flatMap((s) => [s.text, s.note ?? '']);
    for (const t of texts) {
      expect(t).not.toMatch(/AI[- ]generated|written by AI|probability|detected/i);
    }
  });
});

describe('formatPer1k', () => {
  it('formats with one decimal and shows tiny rates as <0.1', () => {
    expect(formatPer1k(0)).toBe('0.0');
    expect(formatPer1k(3.125)).toBe('3.1');
    expect(formatPer1k(0.02)).toBe('<0.1');
  });
});

describe('tooltip and screen-reader text', () => {
  const entry: LexiconEntry = {
    id: 'en.artifact.test',
    pattern: 'Copy code',
    match: 'phrase',
    tier: 'artifact',
    lang: 'en',
    status: 'candidate',
    note: 'Chat UI button label pasted along with the text.',
    added: '2026-10-22',
  };

  it('labels tier, experimental status and note', () => {
    expect(tooltipText(entry)).toBe(
      'Chatbot artifact · experimental entry, still under review\nChat UI button label pasted along with the text.',
    );
    expect(screenReaderText(entry)).toBe(
      ' (flagged: chatbot artifact, experimental entry. Chat UI button label pasted along with the text.)',
    );
    const accepted = { ...entry, status: 'accepted' as const };
    expect(tooltipText(accepted)).not.toMatch(/experimental/);
  });
});

describe('experimental preference storage', () => {
  function memory(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    };
  }

  it('defaults to off and round-trips', () => {
    const s = memory();
    expect(loadExperimental(() => s)).toBe(false);
    saveExperimental(true, () => s);
    expect(loadExperimental(() => s)).toBe(true);
    saveExperimental(false, () => s);
    expect(loadExperimental(() => s)).toBe(false);
  });

  it('survives missing or throwing storage', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadExperimental(() => null)).toBe(false);
    expect(loadExperimental(() => throwing)).toBe(false);
    expect(() => saveExperimental(true, () => throwing)).not.toThrow();
    expect(
      loadExperimental(() => {
        throw new Error('SecurityError');
      }),
    ).toBe(false);
  });
});
