import { describe, expect, it } from 'vitest';
import baseline from '../web/src/baseline.json';
import { LEXICON } from '../web/src/lexicon.ts';
import { defaultLexical, lexiconFingerprint, measuredLexical } from '../web/src/ui/baseline.ts';
import { buildSummary } from '../web/src/ui/format.ts';
import { SENSITIVITIES, bySensitivity } from '../web/src/ui/sensitivity.ts';

describe('human baseline', () => {
  it('was measured with the current lexical entries (else: npm run baseline)', () => {
    expect(lexiconFingerprint(LEXICON)).toBe(baseline.fingerprint);
  });

  it('only has fire counts for measured lexical entries', () => {
    const ids = new Set(measuredLexical(LEXICON).map((e) => e.id));
    expect(Object.keys(baseline.fires).filter((id) => !ids.has(id))).toEqual([]);
    expect(Object.values(baseline.fires).every((n) => n > 0 && n <= baseline.abstracts)).toBe(true);
  });

  it('has one level per sensitivity, consistent with the filter', () => {
    for (const level of SENSITIVITIES) {
      const b = baseline.levels[level];
      expect(b.lexicalEntries).toBe(bySensitivity(defaultLexical(LEXICON), level, baseline).length);
      expect(b.medianPer1k).toBeLessThanOrEqual(b.p90Per1k);
    }
    const { off, loose, standard, strict } = baseline.levels;
    expect(off).toMatchObject({ lexicalEntries: 0, pooledPer1k: 0 });
    expect(loose.lexicalEntries).toBeLessThanOrEqual(standard.lexicalEntries);
    expect(standard.lexicalEntries).toBeLessThanOrEqual(strict.lexicalEntries);
    expect(strict.lexicalEntries).toBe(defaultLexical(LEXICON).length);
    expect(loose.pooledPer1k).toBeLessThanOrEqual(standard.pooledPer1k);
    expect(standard.pooledPer1k).toBeLessThanOrEqual(strict.pooledPer1k);
  });
});

describe('summary line with the baseline', () => {
  const stats = (words: number, lexical: number) => ({
    words,
    counts: { artifact: 0, lexical, stylistic: 0 },
    total: lexical,
    per1k: (lexical / words) * 1000,
  });
  const summary = (words: number, experimentalShown = 0) =>
    buildSummary({
      idle: false,
      stats: stats(words, 5),
      experimentalShown,
      experimentalHidden: 0,
      baseline: { years: '2019–21', pooledPer1k: 8.59 },
    });

  it('follows the density from 200 words on', () => {
    expect(summary(250).density).toBe('20.0 per 1k words · typical human papers (2019–21): ~8.6');
    expect(summary(199).density).toBeNull();
  });

  it('is left out while experimental matches are shown', () => {
    expect(summary(250, 1).density).toBe('20.0 per 1k words');
  });
});
