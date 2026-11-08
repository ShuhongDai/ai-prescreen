// The contract between the page and the report, hit-count and usage-statistics Worker
// (worker/, served at https://api.aiprescreen.fyi). DOM-free: the page and the Worker both
// import it.

/** Where the page sends reports, hit counts and usage statistics. */
export const API_ORIGIN = 'https://api.aiprescreen.fyi';
export const API_PATHS = { report: '/v1/report', hits: '/v1/hits', collect: '/v1/collect' } as const;

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

// ---- Usage statistics ----
// One visit is one page view, known by a random ID that lives only in the page's memory
// (never stored on the device). Events carry fixed values from the lists below, entry IDs
// or buckets; never any text.

/** A visit ID: 16 random bytes, base64url (src/ui/analytics.ts). */
export const VISIT_ID = /^[A-Za-z0-9_-]{22}$/;

/** Most events in one request; the rest go in the next one. */
export const COLLECT_MAX_EVENTS = 30;

/** Latest event time accepted, in ms after the page was opened (two days). */
export const EVENT_T_MAX = 172_800_000;

/** Word counts of an analysed draft, as buckets. */
export const WORD_BUCKETS = ['<50', '50-199', '200-999', '1k-4.9k', '5k+'] as const;
/** Highlights of one tier in an analysed draft, as buckets. */
export const MARK_BUCKETS = ['0', '1', '2-5', '6-20', '21+'] as const;
/** Viewport widths in CSS pixels, as buckets. */
export const VIEWPORTS = ['<480', '480-767', '768-1023', '1024-1439', '1440+'] as const;

const bucket = <T extends readonly string[]>(buckets: T, limits: readonly number[], n: number): T[number] => {
  const i = limits.findIndex((limit) => n < limit);
  return buckets[i === -1 ? buckets.length - 1 : i] as T[number];
};
export const wordBucket = (n: number) => bucket(WORD_BUCKETS, [50, 200, 1000, 5000], n);
export const markBucket = (n: number) => bucket(MARK_BUCKETS, [1, 2, 6, 21], n);
export const viewportBucket = (px: number) => bucket(VIEWPORTS, [480, 768, 1024, 1440], px);

/** Events with a fixed list of values ('' = no value). */
export const EVENT_VALUES = {
  /** The draft got text by pasting, or by typing (once per visit). */
  input: ['paste', 'type'],
  example: [''],
  sensitivity: ['off', 'loose', 'standard', 'strict'],
  experimental: ['on', 'off'],
  /** The "Key" popover or the Advanced area was opened. */
  key: [''],
  advanced: [''],
  /** "Undo" after "Not AI-like". */
  undo: [''],
  /**
   * The report form was opened: from a highlight, from selected text, from Advanced. Sent
   * reports are not events: their time would tie a visit to a public GitHub issue (and its
   * author); the Worker counts the reports it files per day instead.
   */
  'report-open': ['false-positive', 'phrase-selection', 'phrase-advanced'],
} as const satisfies Record<string, readonly string[]>;

/**
 * Events with other values: `popover` (a highlight's details were opened) and `dismiss`
 * ("Not AI-like") carry the entry ID; `analysis` (a draft analysis that settled) carries
 * `words|artifact|lexical|stylistic` buckets (analysisValue).
 */
export const ENTRY_EVENTS = ['popover', 'dismiss'] as const;
export type UsageEventName = keyof typeof EVENT_VALUES | (typeof ENTRY_EVENTS)[number] | 'analysis';

export function analysisValue(words: number, counts: { artifact: number; lexical: number; stylistic: number }): string {
  return [wordBucket(words), markBucket(counts.artifact), markBucket(counts.lexical), markBucket(counts.stylistic)].join('|');
}

export interface UsageEvent {
  name: UsageEventName;
  value: string;
  /** Milliseconds after the page was opened. */
  t: number;
}

/** What the page tells about a visit, once, with its first request. */
export interface VisitInfo {
  /** location.pathname */
  path: string;
  /** The referring site's hostname only ('' = none or this site). */
  ref: string;
  /** utm_source (or ref=), utm_medium, utm_campaign from the URL, lower case ('' = none). */
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  /** The browser's first language, e.g. "de" or "zh-CN". */
  lang: string;
  viewport: (typeof VIEWPORTS)[number];
  theme: 'light' | 'dark';
  /** A coarse pointer (touch screen) is the primary input. */
  touch: boolean;
}

export interface CollectRequest {
  visit: string;
  /**
   * The visit's context, in every request: a beacon gets no answer, so the Worker creates
   * the visit from whichever request reaches it first.
   */
  view?: VisitInfo;
  events: UsageEvent[];
  /** Seconds the page has been visible so far. */
  active: number;
  /** How far down the page the reader has scrolled, at most, in percent. */
  scroll: number;
}

/** Longest text field of VisitInfo, in characters. */
export const VISIT_FIELD_MAX = 100;
export const ACTIVE_MAX_S = 86_400;
