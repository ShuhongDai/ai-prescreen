import { describe, expect, it } from 'vitest';
import { analyze, compileLexicon, type LexiconEntry } from '../web/src/engine/index.ts';
import { LEXICON } from '../web/src/lexicon.ts';
import { buildSummary } from '../web/src/ui/format.ts';
import { analyzeDraft, compileLexicons, type DraftAnalysis } from '../web/src/ui/lexicons.ts';

const CERTAINLY = 'en.artifact.certainly-here-is';
const REVISED = 'en.artifact.here-is-revised-version';
const LET_ME_KNOW = 'en.artifact.let-me-know-adjustments';
// Test-only candidates (the real lexicon has none): one overlaps LET_ME_KNOW on the last
// line, the other matches where no reviewed entry does.
const CAND_LINE = 'test.candidate-last-line';
const CAND_ONLY = 'test.candidate-only';

const T1 = 'Certainly! Here is a revised version of your abstract:\n\nWe study X.';
const LAST_LINE = "Let me know if you'd like any further adjustments to the tone.";
const T2 = `${T1}\n\n${LAST_LINE}`;
const LAST_START = T2.length - LAST_LINE.length;

const candidate = (id: string, pattern: string): LexiconEntry => ({
  id,
  pattern,
  match: 'phrase',
  tier: 'artifact',
  lang: 'en',
  status: 'candidate',
  note: 'test candidate',
  added: '2026-10-23',
});

// Dismissal and candidate logic is tested on the artifact tier only, so lexical entries
// in these sentences ("adjustments", "further") do not change the counts.
const ARTIFACTS = [
  ...LEXICON.filter((e) => e.tier === 'artifact'),
  candidate(CAND_LINE, LAST_LINE.slice(0, -1)),
  candidate(CAND_ONLY, 'Here is the abstract'),
];

function run(text: string, experimental: boolean, dismissed: string[] = []): DraftAnalysis {
  return analyzeDraft(text, compileLexicons(ARTIFACTS, { experimental, dismissed: new Set(dismissed) }));
}
const ids = (d: DraftAnalysis) => d.result.matches.map((m) => m.entryId);
const onLastLine = (d: DraftAnalysis) => d.result.matches.filter((m) => m.end > LAST_START);
const summaryOf = (d: DraftAnalysis, dismissedEntries = 0) =>
  buildSummary({
    idle: false,
    stats: d.result.stats,
    experimentalShown: d.experimentalShown,
    experimentalHidden: d.experimentalHidden,
    dismissedEntries,
  });

describe('compileLexicons', () => {
  it('leaves dismissed entries out of both compiled lexicons', () => {
    const l = compileLexicons(ARTIFACTS, { experimental: false, dismissed: new Set([CERTAINLY, CAND_LINE]) });
    const has = (lex: typeof l.active, id: string) => lex.entries.some((c) => c.entry.id === id);
    expect(has(l.active, CERTAINLY) || has(l.withCandidates, CERTAINLY)).toBe(false);
    expect(has(l.withCandidates, CAND_LINE)).toBe(false);
    expect(has(l.active, REVISED) && has(l.withCandidates, REVISED)).toBe(true);
    expect(l.candidates.has(CAND_LINE)).toBe(false);
  });

  it('shows candidates only with the experimental lexicon on, then compiling once', () => {
    const off = compileLexicons(ARTIFACTS, { experimental: false, dismissed: new Set() });
    expect(off.active.entries.some((c) => c.entry.id === CAND_LINE)).toBe(false);
    expect(off.withCandidates.entries.some((c) => c.entry.id === CAND_LINE)).toBe(true);
    expect(off.candidates.has(CAND_LINE)).toBe(true);
    const on = compileLexicons(ARTIFACTS, { experimental: true, dismissed: new Set() });
    expect(on.active).toBe(on.withCandidates);
    expect(on.active.entries.some((c) => c.entry.id === CAND_LINE)).toBe(true);
  });
});

describe('dismissing an entry (real lexicon)', () => {
  it('flags an overlapping entry that the dismissed one used to win against', () => {
    expect(ids(run(T1, false))).toEqual([CERTAINLY]);
    const after = run(T1, false, [CERTAINLY]);
    expect(ids(after)).toEqual([REVISED]);
    expect(summaryOf(after, 1)).toMatchObject({
      state: 'flagged',
      text: '1 artifact',
      dismissed: '1 entry dismissed',
    });
  });

  it('does the same with the experimental lexicon on', () => {
    // Both entries match the last line on their own; only one can win the overlap.
    const alone = (id: string) =>
      analyze(T2, compileLexicon(ARTIFACTS.filter((e) => e.id === id), { includeCandidates: true }))
        .matches.some((m) => m.end > LAST_START);
    expect(alone(LET_ME_KNOW) && alone(CAND_LINE)).toBe(true);

    const after = run(T2, true, [CERTAINLY]);
    expect(ids(after)).toContain(REVISED);
    expect(ids(after)).not.toContain(CERTAINLY);
    const last = onLastLine(after);
    expect(last).toHaveLength(1);

    // Dismissing whichever entry won the last line leaves the other one flagging it.
    const winner = last[0]!.entryId;
    const again = run(T2, true, [CERTAINLY, winner]);
    expect(onLastLine(again).map((m) => m.entryId)).toEqual([
      winner === LET_ME_KNOW ? CAND_LINE : LET_ME_KNOW,
    ]);
    expect(ids(again)).toContain(REVISED);
  });
});

describe('hidden experimental matches: net gain only', () => {
  const OFFER_ONLY = 'Here is the abstract.\n\nWe study X.';

  it('does not count a candidate that would only replace a reviewed match', () => {
    const d = run(T2, false);
    expect(ids(d)).toEqual([CERTAINLY, LET_ME_KNOW]);
    expect(d.experimentalHidden).toBe(0);
    expect(summaryOf(d).note).toBeNull();
  });

  it('counts a candidate match that adds to what is shown', () => {
    const d = run(OFFER_ONLY, false);
    expect(d.result.stats.total).toBe(0);
    expect(d.experimentalHidden).toBe(1);
    expect(summaryOf(d)).toMatchObject({
      text: 'Nothing flagged by reviewed entries.',
      note: 'Experimental entries would flag 1.',
    });
  });

  it('leaves dismissed entries out of both sides of the count', () => {
    const d = run(T2, false, [LET_ME_KNOW]);
    expect(ids(d)).toEqual([CERTAINLY]);
    expect(d.experimentalHidden).toBe(1); // the candidate would flag the last line again
    expect(run(T2, false, [LET_ME_KNOW, CAND_LINE]).experimentalHidden).toBe(0);
  });

  it('counts shown candidate matches while the experimental lexicon is on', () => {
    const d = run(OFFER_ONLY, true);
    expect(ids(d)).toEqual([CAND_ONLY]);
    expect(d).toMatchObject({ experimentalShown: 1, experimentalHidden: 0 });
    expect(summaryOf(d).note).toBe('It comes from an experimental entry (still under review).');
  });

  it('is zero for empty text', () => {
    expect(run('', false)).toMatchObject({ experimentalShown: 0, experimentalHidden: 0 });
  });
});
