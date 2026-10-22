// DOM-free text helpers for the result pane (summary line, tooltips, screen-reader text).
// Wording rule: describe what was flagged, never who or what wrote the text.

import { TIERS, type AnalysisStats, type LexiconEntry, type Tier } from '../engine/index.ts';

export interface TierInfo {
  /** Noun used in the summary line, singular and plural. */
  one: string;
  many: string;
  /** Short label for tooltips, the legend and screen readers. */
  label: string;
}

export const TIER_INFO: Record<Tier, TierInfo> = {
  artifact: { one: 'artifact', many: 'artifacts', label: 'Chatbot artifact' },
  lexical: { one: 'overused word', many: 'overused words', label: 'Overused wording' },
  stylistic: { one: 'style signal', many: 'style signals', label: 'Style signal' },
};

export function countNoun(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Hits per 1,000 words with one decimal; tiny non-zero rates show as "<0.1". */
export function formatPer1k(per1k: number): string {
  if (per1k > 0 && per1k < 0.05) return '<0.1';
  return per1k.toFixed(1);
}

export interface SummaryInput {
  /** The editor is empty or whitespace only. */
  idle: boolean;
  stats: AnalysisStats;
  /** Shown matches that come from candidate (experimental) entries. */
  experimentalShown: number;
  /** Matches candidate entries would add while the experimental lexicon is off. */
  experimentalHidden: number;
}

export type SummaryState = 'idle' | 'clean' | 'flagged';

export interface Summary {
  state: SummaryState;
  text: string;
  /** Secondary line, e.g. about experimental entries; null when there is nothing to add. */
  note: string | null;
  /** True when the note is about hidden experimental matches (UI offers a "turn on" button). */
  offerExperimental: boolean;
}

export const IDLE_TEXT = 'Paste or type a draft to check it.';
export const CLEAN_TEXT = 'Nothing flagged.';
export const CLEAN_REVIEWED_TEXT = 'Nothing flagged by reviewed entries.';

function hiddenNote(n: number): string {
  return n === 1
    ? '1 possible match from experimental entries is hidden — turn on Experimental lexicon to see it.'
    : `${n} possible matches from experimental entries are hidden — turn on Experimental lexicon to see them.`;
}

function shownNote(shown: number, total: number): string {
  if (shown === total) {
    return total === 1
      ? 'It comes from an experimental entry that is still under review.'
      : `All ${total} come from experimental entries that are still under review.`;
  }
  return shown === 1
    ? '1 of these comes from an experimental entry that is still under review.'
    : `${shown} of these come from experimental entries that are still under review.`;
}

export function buildSummary(input: SummaryInput): Summary {
  const { stats, experimentalShown, experimentalHidden } = input;
  if (input.idle) return { state: 'idle', text: IDLE_TEXT, note: null, offerExperimental: false };

  const hidden = experimentalHidden > 0;
  const note = hidden ? hiddenNote(experimentalHidden) : null;

  if (stats.total === 0) {
    return {
      state: 'clean',
      text: hidden ? CLEAN_REVIEWED_TEXT : CLEAN_TEXT,
      note,
      offerExperimental: hidden,
    };
  }

  const parts = TIERS.filter((t) => stats.counts[t] > 0).map((t) =>
    countNoun(stats.counts[t], TIER_INFO[t].one, TIER_INFO[t].many),
  );
  if (stats.words > 0) parts.push(`${formatPer1k(stats.per1k)} per 1k words`);

  return {
    state: 'flagged',
    text: parts.join(' · '),
    note: hidden ? note : experimentalShown > 0 ? shownNote(experimentalShown, stats.total) : null,
    offerExperimental: hidden,
  };
}

export function isExperimental(entry: LexiconEntry | undefined): boolean {
  return entry?.status === 'candidate';
}

/** Native tooltip (title attribute) for a highlight. */
export function tooltipText(entry: LexiconEntry): string {
  const exp = isExperimental(entry) ? ' · experimental entry, still under review' : '';
  return `${TIER_INFO[entry.tier].label}${exp}\n${entry.note}`;
}

/** Visually hidden text read after the highlighted words by assistive technology. */
export function screenReaderText(entry: LexiconEntry): string {
  const exp = isExperimental(entry) ? ', experimental entry' : '';
  return ` (flagged: ${TIER_INFO[entry.tier].label.toLowerCase()}${exp}. ${entry.note})`;
}
