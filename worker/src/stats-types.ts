// The answer of GET /v1/stats, read by the dashboard (worker/dashboard/client.ts). Types only.

/** Visit columns the dashboard can break down and filter by. */
export const DIMENSIONS = [
  'ref_host',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'country',
  'region',
  'city',
  'as_org',
  'device',
  'browser',
  'os',
  'lang',
  'viewport',
  'theme',
  'touch',
  'path',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface Count {
  value: string;
  visits: number;
  visitors: number;
  /** A longer name to show (a city with its region and country). */
  label?: string;
}

export interface Tally {
  value: string;
  count: number;
}

export interface DayRow {
  day: string;
  visits: number;
  visitors: number;
  /** Visits that analysed a draft or tried the example. */
  used: number;
}

export interface StatsResponse {
  ok: true;
  /** Unix ms (server clock). */
  generatedAt: number;
  from: string;
  to: string;
  filters: [Dimension, string][];
  suspect: boolean;
  /** More visits than the Worker reads at once: the numbers cover the newest ones only. */
  truncated: boolean;
  /** Visits with a request in the last 30 minutes (filters apply). */
  live: { visits: number; countries: Tally[] };
  totals: {
    visits: number;
    visitors: number;
    used: number;
    /** Visits from cloud networks left out (when `suspect` is false). */
    suspectLeftOut: number;
    medianActiveS: number;
    medianScroll: number;
    /** Median seconds from opening the page to the first analysis, over visits with one. */
    medianFirstAnalysisS: number | null;
    analysesPerAnalysingVisit: number;
  };
  days: DayRow[];
  /** Visits per hour (Unix hour = ms / 3,600,000) in the last 48 hours (whatever the range). */
  hours: { hour: number; visits: number }[];
  dims: Record<Dimension, Count[]>;
  funnel: { step: string; visits: number }[];
  /** Events with fixed values: count and visits per value. */
  events: Record<string, { value: string; count: number; visits: number }[]>;
  /** Highlights opened and dismissed, per entry. */
  entries: { popover: Tally[]; dismiss: Tally[] };
  analysis: { words: Tally[]; artifact: Tally[]; lexical: Tally[]; stylistic: Tally[] };
  engagement: { active: Tally[]; scroll: Tally[] };
  /** Lexicon hit counts (all visits: they are not linked to visits, so no filters). */
  hits: Tally[];
  reports: Tally[];
  /** Totals per day from the daily cron, for the long view (no filters). */
  history: DayRow[];
}

export type StatsError = 'unauthorized' | 'invalid' | 'rate-limited' | 'budget' | 'unavailable';
