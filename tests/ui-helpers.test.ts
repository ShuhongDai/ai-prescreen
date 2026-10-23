import { describe, expect, it } from 'vitest';
import type { AnalysisStats, LexiconEntry, Match } from '../web/src/engine/index.ts';
import {
  buildSummary,
  CLEAN_REVIEWED_TEXT,
  CLEAN_TEXT,
  DENSITY_MIN_WORDS,
  densitySuffix,
  formatPer1k,
  IDLE_TEXT,
  screenReaderText,
  type Summary,
} from '../web/src/ui/format.ts';
import { loadExperimental, saveExperimental, type StorageLike } from '../web/src/ui/prefs.ts';
import { buildSegments } from '../web/src/ui/segments.ts';

function stats(partial: Partial<AnalysisStats['counts']>, words: number): AnalysisStats {
  const counts = { artifact: 0, lexical: 0, stylistic: 0, ...partial };
  const total = counts.artifact + counts.lexical + counts.stylistic;
  return { words, counts, total, per1k: words === 0 ? 0 : (total / words) * 1000 };
}

const base = { idle: false, experimentalShown: 0, experimentalHidden: 0 };

/** The summary line as shown on screen: counts, then the rate. */
const line = (s: Summary) => s.text + densitySuffix(s);

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
    expect(s).toMatchObject({ state: 'idle', text: IDLE_TEXT, density: null, note: null });
  });

  it('has a neutral clean state', () => {
    const s = buildSummary({ ...base, stats: stats({}, 1200) });
    expect(s).toMatchObject({
      state: 'clean',
      text: CLEAN_TEXT,
      density: null,
      note: null,
      offerExperimental: false,
    });
  });

  it("reads as a reviewer's note, with one decimal per 1k words", () => {
    expect(line(buildSummary({ ...base, stats: stats({ artifact: 1 }, 320) }))).toBe(
      '1 to remove · 3.1 per 1k words',
    );
    expect(line(buildSummary({ ...base, stats: stats({ artifact: 2, lexical: 7 }, 1000) }))).toBe(
      '2 to remove · 7 to consider · 9.0 per 1k words',
    );
    expect(line(buildSummary({ ...base, stats: stats({ lexical: 1, stylistic: 1 }, 2000) }))).toBe(
      '1 to consider · 1 style note · 1.0 per 1k words',
    );
    expect(buildSummary({ ...base, stats: stats({ stylistic: 3 }, 20) }).text).toBe('3 style notes');
  });

  it('tags each count with its tier (for its colour), in tier order', () => {
    const s = buildSummary({ ...base, stats: stats({ stylistic: 2, lexical: 12, artifact: 3 }, 100) });
    expect(s.parts).toEqual([
      { tier: 'artifact', text: '3 to remove' },
      { tier: 'lexical', text: '12 to consider' },
      { tier: 'stylistic', text: '2 style notes' },
    ]);
    expect(s.parts.map((p) => p.text).join(' · ')).toBe(s.text);
    expect(buildSummary({ ...base, stats: stats({}, 100) }).parts).toEqual([]);
    expect(buildSummary({ ...base, idle: true, stats: stats({}, 0) }).parts).toEqual([]);
  });

  it('adds the typical rate of human papers, explained in a long form', () => {
    const baseline = { years: '2019–21', pooledPer1k: 8.64 };
    const s = buildSummary({ ...base, baseline, stats: stats({ artifact: 3, lexical: 12 }, 2055) });
    expect(line(s)).toBe('3 to remove · 12 to consider · 7.3 per 1k words, typical ~8.6');
    expect(s.text).toBe('3 to remove · 12 to consider');
    expect(s.densityDetail).toBe('typical human papers, 2019–21');
    // No rate below 200 words, so nothing to compare either.
    const short = buildSummary({ ...base, baseline, stats: stats({ lexical: 2 }, 150) });
    expect([short.density, short.densityDetail]).toEqual([null, null]);
    // Left out while experimental matches are shown (measured with the default lexicon).
    const exp = buildSummary({
      ...base,
      baseline,
      experimentalShown: 1,
      stats: stats({ lexical: 2 }, 400),
    });
    expect([exp.density, exp.densityDetail]).toEqual(['5.0 per 1k words', null]);
    // Without a baseline (sensitivity Off) only the rate.
    const off = buildSummary({ ...base, baseline: null, stats: stats({ artifact: 1 }, 1000) });
    expect([off.density, off.densityDetail]).toEqual(['1.0 per 1k words', null]);
  });

  it('keeps the rate out of the counts text (live region) as a separate part', () => {
    const s = buildSummary({ ...base, stats: stats({ artifact: 2, lexical: 7 }, 2260) });
    expect(s.text).toBe('2 to remove · 7 to consider');
    expect(s.density).toBe('4.0 per 1k words');
    expect(densitySuffix(s)).toBe(' · 4.0 per 1k words');
    // Typing that only moves the rate leaves the live-region text unchanged.
    const more = buildSummary({ ...base, stats: stats({ artifact: 2, lexical: 7 }, 3000) });
    expect(more.text).toBe(s.text);
    expect(more.density).toBe('3.0 per 1k words');
  });

  it('omits the rate when there are no words', () => {
    const s = buildSummary({ ...base, stats: stats({ artifact: 1 }, 0) });
    expect([s.text, s.density, densitySuffix(s)]).toEqual(['1 to remove', null, '']);
  });

  it(`hides the rate below ${DENSITY_MIN_WORDS} words and shows it from there on`, () => {
    expect(DENSITY_MIN_WORDS).toBe(200);
    const below = buildSummary({ ...base, stats: stats({ artifact: 1, lexical: 2 }, 199) });
    expect([below.text, below.density]).toEqual(['1 to remove · 2 to consider', null]);
    const at = buildSummary({ ...base, stats: stats({ artifact: 1, lexical: 2 }, 200) });
    expect([at.text, at.density]).toEqual(['1 to remove · 2 to consider', '15.0 per 1k words']);
    expect(line(at)).toBe('1 to remove · 2 to consider · 15.0 per 1k words');
    expect(line(buildSummary({ ...base, stats: stats({ lexical: 1 }, 6) }))).toBe('1 to consider');
  });

  it('lists tiers in the order artifact, lexical, stylistic', () => {
    expect(
      line(buildSummary({ ...base, stats: stats({ stylistic: 2, lexical: 1, artifact: 3 }, 1000) })),
    ).toBe('3 to remove · 1 to consider · 2 style notes · 6.0 per 1k words');
  });

  it('says when experimental matches are hidden, briefly', () => {
    const clean = buildSummary({ ...base, experimentalHidden: 3, stats: stats({}, 50) });
    expect(clean.text).toBe(CLEAN_REVIEWED_TEXT);
    expect(clean.note).toBe('Experimental entries would flag 3.');
    expect(clean.offerExperimental).toBe(true);
    const one = buildSummary({ ...base, experimentalHidden: 1, stats: stats({ artifact: 1 }, 50) });
    expect(one.state).toBe('flagged');
    expect(one.note).toBe('Experimental entries would flag 1 more.');
    expect(one.offerExperimental).toBe(true);
  });

  it('notes shown experimental matches', () => {
    expect(
      buildSummary({ ...base, experimentalShown: 2, stats: stats({ artifact: 2 }, 100) }).note,
    ).toBe('All 2 come from experimental entries (still under review).');
    expect(
      buildSummary({ ...base, experimentalShown: 1, stats: stats({ artifact: 1 }, 100) }).note,
    ).toBe('It comes from an experimental entry (still under review).');
    expect(
      buildSummary({ ...base, experimentalShown: 1, stats: stats({ artifact: 3 }, 100) }).note,
    ).toBe('1 comes from an experimental entry (still under review).');
    expect(
      buildSummary({ ...base, experimentalShown: 4, stats: stats({ lexical: 9 }, 100) }).note,
    ).toBe('4 come from experimental entries (still under review).');
  });

  it('reports dismissed entries, but not while idle', () => {
    expect(buildSummary({ ...base, stats: stats({ artifact: 1 }, 10) }).dismissed).toBeNull();
    expect(
      buildSummary({ ...base, dismissedEntries: 1, stats: stats({ artifact: 1 }, 10) }).dismissed,
    ).toBe('1 entry dismissed');
    const clean = buildSummary({ ...base, dismissedEntries: 3, stats: stats({}, 10) });
    expect(clean).toMatchObject({ state: 'clean', text: CLEAN_TEXT, dismissed: '3 entries dismissed' });
    expect(
      buildSummary({ ...base, idle: true, dismissedEntries: 2, stats: stats({}, 0) }).dismissed,
    ).toBeNull();
  });

  it('never uses verdict wording', () => {
    const texts = [
      buildSummary({ ...base, idle: true, stats: stats({}, 0) }),
      buildSummary({ ...base, stats: stats({}, 10) }),
      buildSummary({ ...base, experimentalHidden: 2, stats: stats({ artifact: 1 }, 10) }),
      buildSummary({ ...base, experimentalHidden: 2, stats: stats({}, 10) }),
      buildSummary({ ...base, experimentalShown: 1, stats: stats({ artifact: 1 }, 10) }),
      buildSummary({ ...base, dismissedEntries: 1, stats: stats({ lexical: 1 }, 300) }),
    ].flatMap((s) => [s.text, s.density ?? '', s.note ?? '', s.dismissed ?? '']);
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

describe('screen-reader text', () => {
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

  it('is short: tier and experimental status (the popover has the details)', () => {
    expect(screenReaderText(entry)).toBe(' (flagged: chatbot artifact, experimental)');
    expect(screenReaderText({ ...entry, status: 'accepted' })).toBe(' (flagged: chatbot artifact)');
    expect(screenReaderText({ ...entry, tier: 'lexical', status: 'watch' })).toBe(
      ' (flagged: overused wording)',
    );
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
