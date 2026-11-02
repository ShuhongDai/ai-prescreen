// The report form's wording and request (DOM-free). The dialog is src/ui/report-dialog.ts.

import { TIER_CHOICES, type ReportError, type ReportRequest } from '../report-contract.ts';
import { falsePositiveReportUrl, newPhraseReportUrl, reportText } from './report.ts';

/** What the reader is about to report: a phrase (maybe empty), or a highlight. */
export type ReportDraft =
  | { kind: 'new-phrase'; phrase: string }
  | { kind: 'false-positive'; entryId: string; matchedText: string };

export interface ReportFields {
  phrase: string;
  tier: string;
  example: string;
  model: string;
  comment: string;
}

export const REPORT_TEXT = {
  phraseTitle: 'Report a phrase',
  falsePositiveTitle: 'Report a false positive',
  phraseLede: 'Suggest wording that may read as AI-like. Reports are reviewed in batches.',
  falsePositiveLede: 'Flagged ordinary wording? Reports are counted per entry and reviewed in batches.',
  entry: 'Entry',
  public: 'Your report becomes a public issue on GitHub; Cloudflare Turnstile checks it for spam. Please do not include anything private.',
  send: 'Send report',
  github: 'Open on GitHub instead',
  checking: 'Checking that you are human…',
  sending: 'Sending…',
  phraseMissing: 'Please enter the phrase.',
  checkFailed: 'The spam check could not run. You can open the report on GitHub instead.',
  thanks: 'Thank you, your report was sent.',
  issue: (n: number) => `It is issue #${n} on GitHub`,
  close: 'Close',
} as const;

const ERRORS: Record<ReportError, string> = {
  invalid: 'Something in the report is not valid. Please check the fields.',
  origin: 'Reports can be sent from aiprescreen.fyi only.',
  challenge: 'The spam check did not pass. Please try again.',
  'rate-limited': 'Too many reports in a short time. Please wait a minute and try again.',
  unavailable: 'Reports cannot be sent right now. You can open the report on GitHub instead.',
};

export const errorText = (error: ReportError): string => ERRORS[error];

/** The request for the Worker, or null when the phrase or tier is missing. */
export function buildRequest(draft: ReportDraft, fields: ReportFields, token: string): ReportRequest | null {
  const example = fields.example.trim();
  if (draft.kind === 'new-phrase') {
    const phrase = fields.phrase.replace(/\s+/g, ' ').trim();
    const tier = TIER_CHOICES.find((t) => t === fields.tier);
    if (!phrase || !tier) return null;
    return { kind: 'new-phrase', phrase, tier, example, model: fields.model.trim(), token };
  }
  return {
    kind: 'false-positive',
    entryId: draft.entryId,
    matchedText: reportText(draft.matchedText),
    example,
    comment: fields.comment.trim(),
    token,
  };
}

/**
 * The pre-filled GitHub issue form, the secondary way to report. Like before the Worker it
 * carries only the phrase, or the entry ID and the matched text.
 */
export function githubUrl(draft: ReportDraft, phrase: string): string {
  return draft.kind === 'new-phrase' ? newPhraseReportUrl(phrase) : falsePositiveReportUrl(draft.entryId, draft.matchedText);
}
