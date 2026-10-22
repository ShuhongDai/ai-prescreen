import { describe, expect, it } from 'vitest';
import baseline from '../web/src/baseline.json';
import type { LexiconEntry } from '../web/src/engine/index.ts';
import { LEXICON } from '../web/src/lexicon.ts';
import { analyzeDraft, compileLexicons } from '../web/src/ui/lexicons.ts';
import { loadSensitivity, saveSensitivity, SENSITIVITY_KEY, type StorageLike } from '../web/src/ui/prefs.ts';
import {
  DEFAULT_SENSITIVITY,
  MAX_FIRE_RATE,
  bySensitivity,
  fireRate,
  isSensitivity,
  type FireData,
} from '../web/src/ui/sensitivity.ts';

const entry = (id: string, tier: LexiconEntry['tier'] = 'lexical'): LexiconEntry => ({
  id,
  pattern: id,
  match: 'word',
  tier,
  lang: 'en',
  status: 'accepted',
  note: 'n',
  added: '2026-10-23',
});

describe('sensitivity filter', () => {
  const data: FireData = { abstracts: 1000, fires: { rare: 2, mid: 8, common: 40, art: 900 } };
  const entries = [entry('none'), entry('rare'), entry('mid'), entry('common'), entry('art', 'artifact')];
  const ids = (level: Parameters<typeof bySensitivity>[1]) => bySensitivity(entries, level, data).map((e) => e.id);

  it('keeps lexical entries up to the level’s fire-rate, and "none" everywhere but Off', () => {
    expect(ids('off')).toEqual(['art']);
    expect(ids('loose')).toEqual(['none', 'rare', 'art']);
    expect(ids('standard')).toEqual(['none', 'rare', 'mid', 'art']);
    expect(ids('strict')).toEqual(['none', 'rare', 'mid', 'common', 'art']);
  });

  it('uses the documented thresholds', () => {
    expect(MAX_FIRE_RATE).toEqual({
      off: Number.NEGATIVE_INFINITY,
      loose: 0.0025,
      standard: 0.01,
      strict: Number.POSITIVE_INFINITY,
    });
    expect(DEFAULT_SENSITIVITY).toBe('standard');
    expect(fireRate('missing', data)).toBe(0);
    expect(isSensitivity('strict') && !isSensitivity('medium')).toBe(true);
  });

  it('only changes what the page shows, with the real lexicon', () => {
    const text = 'We leverage this to delve into it.'; // leverage fires in >1% of human abstracts
    const shown = (level: 'off' | 'loose' | 'standard' | 'strict') =>
      analyzeDraft(
        text,
        compileLexicons(LEXICON, { experimental: false, dismissed: new Set(), sensitivity: { level, data: baseline } }),
      ).result.matches.map((m) => m.entryId);
    expect(fireRate('en.lexical.leverage', baseline)).toBeGreaterThan(MAX_FIRE_RATE.standard);
    expect(shown('strict')).toEqual(['en.lexical.leverage', 'en.lexical.delve']);
    expect(shown('standard')).toEqual(['en.lexical.delve']);
    expect(shown('off')).toEqual([]);
    expect(LEXICON.find((e) => e.id === 'en.lexical.leverage')?.status).toBe('accepted');
  });
});

describe('sensitivity preference storage', () => {
  const memory = (): (() => StorageLike) => {
    const store = new Map<string, string>();
    const s: StorageLike = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
    return () => s;
  };

  it('defaults to standard and round-trips', () => {
    const storage = memory();
    expect(loadSensitivity(storage)).toBe('standard');
    saveSensitivity('loose', storage);
    expect(storage().getItem(SENSITIVITY_KEY)).toBe('loose');
    expect(loadSensitivity(storage)).toBe('loose');
    saveSensitivity('off', storage);
    expect(loadSensitivity(storage)).toBe('off');
  });

  it('ignores invalid values and survives missing or throwing storage', () => {
    const storage = memory();
    storage().setItem(SENSITIVITY_KEY, 'medium');
    expect(loadSensitivity(storage)).toBe('standard');
    const throwing = () => {
      throw new Error('blocked');
    };
    expect(loadSensitivity(throwing)).toBe('standard');
    expect(() => saveSensitivity('strict', throwing)).not.toThrow();
    expect(loadSensitivity(() => null)).toBe('standard');
  });
});
