// Reports from the page: validation, and the GitHub issue they become. The issue matches
// what the issue forms in .github/ISSUE_TEMPLATE/ produce (title prefix, labels, "### <field
// label>" sections, "_No response_" for empty fields), so `npm run triage` reads both.

import { ENTRY_ID, FIELD_MAX, FORMS, MODEL_NAME, TIER_CHOICES, type TierChoice } from '../../web/src/report-contract.ts';
import { cleanText, codeBlock, codeSpan, titleText } from './text.ts';

export type ValidReport =
  | { kind: 'new-phrase'; phrase: string; tier: TierChoice; example: string; model: string }
  | { kind: 'false-positive'; entryId: string; matchedText: string; example: string; comment: string };

export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}

/** Longest phrase repeated in an issue title, as on github.com (web/src/ui/report.ts). */
export const TITLE_MAX = 80;
/** Longest Turnstile token accepted (they are about 2 KB at most). */
export const TOKEN_MAX = 4096;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** An optional field: absent → '' (null when present but invalid). */
const optional = (v: unknown, max: number, multiline = false) => (v === undefined ? '' : cleanText(v, max, multiline));

/** The report and its Turnstile token, or null when anything is missing or invalid. */
export function parseReport(input: unknown, knownIds: ReadonlySet<string>): { report: ValidReport; token: string } | null {
  if (!isObject(input)) return null;
  const token = input.token;
  if (typeof token !== 'string' || token.length === 0 || token.length > TOKEN_MAX) return null;
  const example = optional(input.example, FIELD_MAX.example, true);
  if (example === null) return null;

  if (input.kind === 'new-phrase') {
    const phrase = cleanText(input.phrase, FIELD_MAX.phrase);
    const tier = TIER_CHOICES.find((t) => t === input.tier);
    const model = optional(input.model, FIELD_MAX.model);
    if (!phrase || !tier || model === null || (model !== '' && !MODEL_NAME.test(model))) return null;
    return { report: { kind: 'new-phrase', phrase, tier, example, model }, token };
  }
  if (input.kind === 'false-positive') {
    const entryId = input.entryId;
    if (typeof entryId !== 'string' || !ENTRY_ID.test(entryId) || !knownIds.has(entryId)) return null;
    const matchedText = optional(input.matchedText, FIELD_MAX.matchedText);
    const comment = optional(input.comment, FIELD_MAX.comment, true);
    if (matchedText === null || comment === null) return null;
    return { report: { kind: 'false-positive', entryId, matchedText, example, comment }, token };
  }
  return null;
}

const NO_RESPONSE = '_No response_';
/** Before the first section, where the triage parser does not look. */
const SENT_FROM = '_Sent from the report form on https://aiprescreen.fyi (no GitHub account needed)._';

const section = (label: string, value: string) => `### ${label}\n\n${value || NO_RESPONSE}`;
const inline = (text: string) => (text ? codeSpan(text) : '');
const block = (text: string) => (text ? codeBlock(text) : '');

export function issueFor(report: ValidReport): IssueDraft {
  const form = FORMS[report.kind];
  const sections =
    report.kind === 'new-phrase'
      ? [
          section('Phrase', inline(report.phrase)),
          section('Suggested tier', report.tier),
          section('Example sentence', block(report.example)),
          section('Model it came from', inline(report.model)),
        ]
      : [
          // Validated against the lexicon's IDs, so it is safe as plain text.
          section('Entry id', report.entryId),
          section('Matched text', inline(report.matchedText)),
          section('Example sentence', block(report.example)),
          section('Comment', block(report.comment)),
        ];
  const subject = report.kind === 'new-phrase' ? titleText(report.phrase, TITLE_MAX) : report.entryId;
  return {
    title: `${form.title}${subject}`,
    body: `${[SENT_FROM, ...sections].join('\n\n')}\n`,
    labels: [...form.labels],
  };
}
