// The contract between the page and the report and hit-count Worker (worker/, served at
// https://api.aiprescreen.fyi). DOM-free: the page and the Worker both import it.

/** Where the page sends reports and hit counts. */
export const API_ORIGIN = 'https://api.aiprescreen.fyi';
export const API_PATHS = { report: '/v1/report', hits: '/v1/hits' } as const;

/**
 * The GitHub issue forms in .github/ISSUE_TEMPLATE/. The Worker opens issues with the same
 * titles, labels and field labels, so a report sent from the page reads like one filed on
 * github.com and `npm run triage` handles both.
 */
export const FORMS = {
  'new-phrase': { template: 'report-ai-phrase.yml', title: 'AI-like phrase: ', labels: ['report', 'report:new-phrase'] },
  'false-positive': { template: 'report-false-positive.yml', title: 'False positive: ', labels: ['report', 'report:false-positive'] },
} as const;

export type ReportKind = keyof typeof FORMS;

/** The "Suggested tier" options of the new-phrase form, in its order. */
export const TIER_CHOICES = ['artifact (chatbot leftover)', 'overused word', 'style'] as const;
export type TierChoice = (typeof TIER_CHOICES)[number];

/** Longest value per field, in characters (code points). */
export const FIELD_MAX = { phrase: 300, matchedText: 300, example: 2000, comment: 2000, model: 80 } as const;

/**
 * A model name such as "GPT-4o" or "Claude 3.5 Sonnet": letters, digits, spaces and . , + - _ ( )
 * only, so no URL, mention or markup. Checked by the Worker and by `npm run triage`, which may
 * write it into a lexicon entry's `models`.
 */
export const MODEL_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,+\-_()]*$/u;

/** Every lexicon entry ID has this form (scripts/validate-lexicon.ts keeps it so). */
export const ENTRY_ID = /^en\.(?:artifact|lexical|stylistic)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Most entry IDs in one hit-count request; the rest wait for the next one. */
export const HITS_MAX_IDS = 100;

/** The action the page's Turnstile widget is rendered with; the Worker checks it. */
export const TURNSTILE_ACTION = 'report';

export interface NewPhraseReport {
  kind: 'new-phrase';
  phrase: string;
  tier: TierChoice;
  example?: string;
  model?: string;
  /** Turnstile token. */
  token: string;
}

export interface FalsePositiveReport {
  kind: 'false-positive';
  entryId: string;
  matchedText?: string;
  example?: string;
  comment?: string;
  token: string;
}

export type ReportRequest = NewPhraseReport | FalsePositiveReport;

/**
 * - invalid: a field is missing, too long or unknown;
 * - origin: not sent from the page;
 * - challenge: the Turnstile check failed (get a new token and try again);
 * - rate-limited: too many requests from this client in the last minute;
 * - unavailable: reports cannot be filed now (daily limit, GitHub error, not configured).
 */
export type ReportError = 'invalid' | 'origin' | 'challenge' | 'rate-limited' | 'unavailable';

export type ReportResponse =
  | { ok: true; issue: { number: number; url: string } }
  | { ok: false; error: ReportError };

/** Hit counts: the entry IDs one analysis showed. Never any text. */
export interface HitsRequest {
  ids: string[];
}
