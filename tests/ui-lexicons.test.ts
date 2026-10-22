import { describe, expect, it } from 'vitest';
import { analyze, compileLexicon } from '../web/src/engine/index.ts';
import { LEXICON } from '../web/src/lexicon.ts';
import { buildSummary } from '../web/src/ui/format.ts';
import { analyzeDraft, compileLexicons, type DraftAnalysis } from '../web/src/ui/lexicons.ts';

const CERTAINLY = 'en.artifact.certainly-here-is';
const REVISED = 'en.artifact.here-is-revised-version';
const LET_ME_KNOW = 'en.artifact.let-me-know-adjustments';
const CLOSING_OFFER = 'en.artifact.closing-offer-at-end'; // candidate

const T1 = 'Certainly! Here is a revised version of your abstract:\n\nWe study X.';
const LAST_LINE = "Let me know if you'd like any further adjustments to the tone.";
const T2 = `${T1}\n\n${LAST_LINE}`;
const LAST_START = T2.length - LAST_LINE.length;

// Dismissal and candidate logic is tested on the artifact tier only, so lexical candidates
// in these sentences ("adjustments", "further") do not change the counts.
const ARTIFACTS = LEXICON.filter((e) => e.tier === 'artifact');

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
    const l = compileLexicons(LEXICON, { experimental: false, dismissed: new Set([CERTAINLY, CLOSING_OFFER]) });
    const has = (lex: typeof l.active, id: string) => lex.entries.some((c) => c.entry.id === id);
    expect(has(l.active, CERTAINLY) || has(l.withCandidates, CERTAINLY)).toBe(false);
    expect(has(l.withCandidates, CLOSING_OFFER)).toBe(false);
    expect(has(l.active, REVISED) && has(l.withCandidates, REVISED)).toBe(true);
    expect(l.candidates.has(CLOSING_OFFER)).toBe(false);
  });

  it('shows candidates only with the experimental lexicon on, then compiling once', () => {
    const off = compileLexicons(LEXICON, { experimental: false, dismissed: new Set() });
    expect(off.active.entries.some((c) => c.entry.id === CLOSING_OFFER)).toBe(false);
    expect(off.withCandidates.entries.some((c) => c.entry.id === CLOSING_OFFER)).toBe(true);
    expect(off.candidates.has(CLOSING_OFFER)).toBe(true);
    const on = compileLexicons(LEXICON, { experimental: true, dismissed: new Set() });
    expect(on.active).toBe(on.withCandidates);
    expect(on.active.entries.some((c) => c.entry.id === CLOSING_OFFER)).toBe(true);
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
      analyze(T2, compileLexicon(LEXICON.filter((e) => e.id === id), { includeCandidates: true }))
        .matches.some((m) => m.end > LAST_START);
    expect(alone(LET_ME_KNOW) && alone(CLOSING_OFFER)).toBe(true);

    const after = run(T2, true, [CERTAINLY]);
    expect(ids(after)).toContain(REVISED);
    expect(ids(after)).not.toContain(CERTAINLY);
    const last = onLastLine(after);
    expect(last).toHaveLength(1);

    // Dismissing whichever entry won the last line leaves the other one flagging it.
    const winner = last[0]!.entryId;
    const again = run(T2, true, [CERTAINLY, winner]);
    expect(onLastLine(again).map((m) => m.entryId)).toEqual([
      winner === LET_ME_KNOW ? CLOSING_OFFER : LET_ME_KNOW,
    ]);
    expect(ids(again)).toContain(REVISED);
  });
});

describe('hidden experimental matches: net gain only', () => {
  const OFFER_ONLY = "Here is the abstract.\n\nLet me know if you'd like any further changes.";

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
    expect(run(T2, false, [LET_ME_KNOW, CLOSING_OFFER]).experimentalHidden).toBe(0);
  });

  it('counts shown candidate matches while the experimental lexicon is on', () => {
    const d = run(OFFER_ONLY, true);
    expect(ids(d)).toEqual([CLOSING_OFFER]);
    expect(d).toMatchObject({ experimentalShown: 1, experimentalHidden: 0 });
    expect(summaryOf(d).note).toBe('It comes from an experimental entry (still under review).');
  });

  it('is zero for empty text', () => {
    expect(run('', false)).toMatchObject({ experimentalShown: 0, experimentalHidden: 0 });
  });
});
