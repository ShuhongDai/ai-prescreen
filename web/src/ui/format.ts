// DOM-free text helpers for the result pane (summary line, popover, screen-reader text).
// Wording rule: describe what was flagged, never who or what wrote the text.

import { TIERS, type AnalysisStats, type LexiconEntry, type Tier } from '../engine/index.ts';
import { falsePositiveReportUrl, NEW_TAB_HINT } from './report.ts';

export interface TierInfo {
  /** What follows the count in the summary line (a reviewer's note), singular and plural. */
  one: string;
  many: string;
  /** Short label for the popover title and screen readers. */
  label: string;
}

export const TIER_INFO: Record<Tier, TierInfo> = {
  artifact: { one: 'to remove', many: 'to remove', label: 'Chatbot artifact' },
  lexical: { one: 'to consider', many: 'to consider', label: 'Overused wording' },
  stylistic: { one: 'style note', many: 'style notes', label: 'Style note' },
};

export function countNoun(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The rate per 1,000 words is shown only from this many words on: in a shorter text a
 * single hit swings the rate so much that the number means little.
 */
export const DENSITY_MIN_WORDS = 200;

/** Hits per 1,000 words with one decimal; tiny non-zero rates show as "<0.1". */
export function formatPer1k(per1k: number): string {
  if (per1k > 0 && per1k < 0.05) return '<0.1';
  return per1k.toFixed(1);
}

export interface SummaryInput {
  /** The editor is empty or whitespace only. */
  idle: boolean;
  /** Stats of the matches that are shown (dismissed entries already left out). */
  stats: AnalysisStats;
  /** Shown matches that come from candidate (experimental) entries. */
  experimentalShown: number;
  /** Matches candidate entries would add while the experimental lexicon is off. */
  experimentalHidden: number;
  /** Entries dismissed as false positives during this page session. */
  dismissedEntries?: number;
  /** Human baseline for the current sensitivity, appended to the density (ui/baseline.ts). */
  baseline?: { years: string; pooledPer1k: number } | null;
}

export type SummaryState = 'idle' | 'clean' | 'flagged';

export interface Summary {
  state: SummaryState;
  /** Counts line, e.g. "3 to remove · 12 to consider". Goes in the live region. */
  text: string;
  /**
   * E.g. "7.3 per 1k words, typical ~8.6": shown right after the counts but kept OUT of
   * the live region, since it changes on nearly every keystroke. Null below
   * DENSITY_MIN_WORDS words and when nothing is flagged.
   */
  density: string | null;
  /** What "typical" means, e.g. "typical human papers, 2019–21" (tooltip and screen
   * readers); null when the density has no baseline. */
  densityDetail: string | null;
  /** Secondary line, e.g. about experimental entries; null when there is nothing to add. */
  note: string | null;
  /** True when the note is about hidden experimental matches (UI offers a "turn on" button). */
  offerExperimental: boolean;
  /** E.g. "1 entry dismissed"; the UI adds an Undo button. Null when nothing is dismissed. */
  dismissed: string | null;
}

export const SEPARATOR = ' · ';

/** What follows the counts on screen: " · 3.1 per 1k words", or '' when there is no rate. */
export function densitySuffix(summary: Pick<Summary, 'density'>): string {
  return summary.density === null ? '' : `${SEPARATOR}${summary.density}`;
}

export const IDLE_TEXT = 'Paste or type a draft to check it.';
export const CLEAN_TEXT = 'Nothing flagged.';
export const CLEAN_REVIEWED_TEXT = 'Nothing flagged by reviewed entries.';

/** Kept short: with hundreds of candidate entries this note shows up often. */
function hiddenNote(hidden: number, shown: number): string {
  return `Experimental entries would flag ${hidden}${shown > 0 ? ' more' : ''}.`;
}

function shownNote(shown: number, total: number): string {
  if (shown === total) {
    return total === 1
      ? 'It comes from an experimental entry (still under review).'
      : `All ${total} come from experimental entries (still under review).`;
  }
  return shown === 1
    ? '1 comes from an experimental entry (still under review).'
    : `${shown} come from experimental entries (still under review).`;
}

export function dismissedText(entries: number): string | null {
  return entries > 0 ? `${countNoun(entries, 'entry', 'entries')} dismissed` : null;
}

export function buildSummary(input: SummaryInput): Summary {
  const { stats, experimentalShown, experimentalHidden } = input;
  if (input.idle) {
    return {
      state: 'idle',
      text: IDLE_TEXT,
      density: null,
      densityDetail: null,
      note: null,
      offerExperimental: false,
      dismissed: null,
    };
  }

  const dismissed = dismissedText(input.dismissedEntries ?? 0);
  const hidden = experimentalHidden > 0;
  const note = hidden ? hiddenNote(experimentalHidden, stats.total) : null;

  if (stats.total === 0) {
    return {
      state: 'clean',
      text: hidden ? CLEAN_REVIEWED_TEXT : CLEAN_TEXT,
      density: null,
      densityDetail: null,
      note,
      offerExperimental: hidden,
      dismissed,
    };
  }

  const parts = TIERS.filter((t) => stats.counts[t] > 0).map((t) =>
    countNoun(stats.counts[t], TIER_INFO[t].one, TIER_INFO[t].many),
  );

  // The baseline was measured with the default lexicon, so it is left out while
  // experimental matches are shown.
  const baseline = input.baseline && experimentalShown === 0 ? input.baseline : null;
  const rated = stats.words >= DENSITY_MIN_WORDS;
  const typical = baseline ? `, typical ~${baseline.pooledPer1k.toFixed(1)}` : '';

  return {
    state: 'flagged',
    text: parts.join(SEPARATOR),
    density: rated ? `${formatPer1k(stats.per1k)} per 1k words${typical}` : null,
    densityDetail: rated && baseline ? `typical human papers, ${baseline.years}` : null,
    note: hidden ? note : experimentalShown > 0 ? shownNote(experimentalShown, stats.total) : null,
    offerExperimental: hidden,
    dismissed,
  };
}

export function isExperimental(entry: LexiconEntry | undefined): boolean {
  return entry?.status === 'candidate';
}

/**
 * Visually hidden text read after the highlighted words by assistive technology. Kept
 * short: the popover carries the explanation.
 */
export function screenReaderText(entry: LexiconEntry): string {
  const exp = isExperimental(entry) ? ', experimental' : '';
  return ` (flagged: ${TIER_INFO[entry.tier].label.toLowerCase()}${exp})`;
}

// ---- Popover ----

export const POPOVER_TEXT = {
  experimental: 'Experimental entry — still under review',
  why: "Why it's flagged",
  suggestions: 'Suggestions',
  falsePositive: 'Not AI-like (false positive)',
  report: 'Report false positive',
  close: 'Close',
  noNote: 'No explanation has been written for this entry yet.',
} as const;

/** Longest quote of the flagged text shown in the popover, in characters. */
export const QUOTE_MAX_CHARS = 80;

/** The flagged text on one line, in curly quotes, cut at `max` characters. */
export function quoteText(text: string, max = QUOTE_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat); // code points, so a surrogate pair is never cut in half
  const body = chars.length <= max ? flat : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
  return `“${body}”`;
}

export interface PopoverModel {
  tier: Tier;
  /** Tier label, the dialog's title. */
  title: string;
  /** Shown for candidate entries only. */
  experimental: string | null;
  /** The flagged text, quoted and shortened. */
  quote: string;
  why: { heading: string; text: string };
  /** Null when the entry has no suggestions: the section is left out. */
  suggestions: { heading: string; items: string[] } | null;
  falsePositive: string;
  /** Link to the pre-filled public GitHub issue form; it also dismisses the entry. */
  report: { label: string; hint: string; href: string };
  close: string;
}

export function popoverModel(entry: LexiconEntry, matchedText: string): PopoverModel {
  const items = (entry.suggestions ?? []).map((s) => s.trim()).filter((s) => s !== '');
  return {
    tier: entry.tier,
    title: TIER_INFO[entry.tier].label,
    experimental: isExperimental(entry) ? POPOVER_TEXT.experimental : null,
    quote: quoteText(matchedText),
    why: { heading: POPOVER_TEXT.why, text: entry.note.trim() || POPOVER_TEXT.noNote },
    suggestions: items.length > 0 ? { heading: POPOVER_TEXT.suggestions, items } : null,
    falsePositive: POPOVER_TEXT.falsePositive,
    report: {
      label: POPOVER_TEXT.report,
      hint: NEW_TAB_HINT,
      href: falsePositiveReportUrl(entry.id, matchedText),
    },
    close: POPOVER_TEXT.close,
  };
}
