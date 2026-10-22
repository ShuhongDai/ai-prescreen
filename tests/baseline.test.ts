import { describe, expect, it } from 'vitest';
import baseline from '../web/src/baseline.json';
import { LEXICON } from '../web/src/lexicon.ts';
import { defaultLexical, lexiconFingerprint } from '../web/src/ui/baseline.ts';
import { buildSummary } from '../web/src/ui/format.ts';

describe('human baseline', () => {
  it('was measured with the current default lexical entries (else: npm run baseline)', () => {
    expect({ fingerprint: lexiconFingerprint(LEXICON), entries: defaultLexical(LEXICON).length }).toEqual({
      fingerprint: baseline.fingerprint,
      entries: baseline.lexicalEntries,
    });
  });

  it('has sane statistics', () => {
    expect(baseline.abstracts).toBeGreaterThan(1000);
    expect(baseline.medianPer1k).toBeLessThanOrEqual(baseline.p90Per1k);
    expect(baseline.pooledPer1k).toBeGreaterThan(0);
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
      baseline: { years: '2019–21', pooledPer1k: 20.94 },
    });

  it('follows the density from 200 words on', () => {
    expect(summary(250).density).toBe('20.0 per 1k words · typical human papers (2019–21): ~20.9');
    expect(summary(199).density).toBeNull();
  });

  it('is left out while experimental matches are shown', () => {
    expect(summary(250, 1).density).toBe('20.0 per 1k words');
  });
});
