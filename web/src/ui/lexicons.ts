// Which compiled lexicons the page analyses with, and what the experimental lexicon would
// add. DOM-free, so the choice is unit-tested.
//
// Dismissed entries ("Not AI-like (false positive)") are left out BEFORE compiling, so the
// engine settles overlaps without them: an entry that lost an overlap to a dismissed
// entry is flagged again instead of disappearing with it.

import {
  analyze,
  compileLexicon,
  type AnalysisResult,
  type CompiledLexicon,
  type LexiconEntry,
} from '../engine/index.ts';
import { isExperimental } from './format.ts';
import { bySensitivity, type FireData, type Sensitivity } from './sensitivity.ts';

export interface LexiconChoice {
  /** The "Experimental lexicon" toggle: also show candidate entries. */
  experimental: boolean;
  /** Entry IDs dismissed as false positives during this page view. */
  dismissed: ReadonlySet<string>;
  /** Tier-2 sensitivity and the fire counts it filters by; all lexical entries if absent. */
  sensitivity?: { level: Sensitivity; data: FireData };
}

export interface PageLexicons {
  experimental: boolean;
  /** What the page shows. */
  active: CompiledLexicon;
  /** Candidates included, to count what the experimental lexicon would add. Same object as
   * `active` while the experimental lexicon is on. */
  withCandidates: CompiledLexicon;
  /** IDs of the candidate (experimental) entries that were compiled. */
  candidates: ReadonlySet<string>;
}

/**
 * Compile again whenever the toggle or the sensitivity changes, an entry is dismissed, or
 * Undo is pressed. Lexical entries above the sensitivity's fire-rate are left out of both
 * lexicons, like dismissed ones, so the experimental count compares like with like.
 */
export function compileLexicons(
  entries: readonly LexiconEntry[],
  choice: LexiconChoice,
): PageLexicons {
  const shown = choice.sensitivity
    ? bySensitivity(entries, choice.sensitivity.level, choice.sensitivity.data)
    : entries;
  const kept =
    choice.dismissed.size === 0 ? shown : shown.filter((e) => !choice.dismissed.has(e.id));
  const withCandidates = compileLexicon(kept, { includeCandidates: true });
  return {
    experimental: choice.experimental,
    active: choice.experimental ? withCandidates : compileLexicon(kept, { includeCandidates: false }),
    withCandidates,
    candidates: new Set(kept.filter((e) => isExperimental(e)).map((e) => e.id)),
  };
}

export interface DraftAnalysis {
  /** What the page shows (dismissed entries are never matched). */
  result: AnalysisResult;
  /** Shown matches that come from candidate entries (experimental lexicon on). */
  experimentalShown: number;
  /**
   * Experimental lexicon off: how many more matches it would show. Net gain only, so a
   * candidate that would merely replace a reviewed match in an overlap does not count.
   */
  experimentalHidden: number;
}

export function analyzeDraft(text: string, lexicons: PageLexicons): DraftAnalysis {
  const result = analyze(text, lexicons.active);
  if (lexicons.experimental) {
    const shown = result.matches.filter((m) => lexicons.candidates.has(m.entryId)).length;
    return { result, experimentalShown: shown, experimentalHidden: 0 };
  }
  const all = text === '' ? 0 : analyze(text, lexicons.withCandidates).stats.total;
  return { result, experimentalShown: 0, experimentalHidden: Math.max(0, all - result.stats.total) };
}
