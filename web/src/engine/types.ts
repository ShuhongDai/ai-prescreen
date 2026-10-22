export const TIERS = ['artifact', 'lexical', 'stylistic'] as const;
export type Tier = (typeof TIERS)[number];

export const MATCH_KINDS = ['word', 'phrase', 'regex'] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export const STATUSES = ['candidate', 'accepted', 'watch', 'retired'] as const;
export type EntryStatus = (typeof STATUSES)[number];

export interface Evidence {
  type: string;
  ref: string;
}

/** One lexicon entry, as stored in lexicon/*.json. */
export interface LexiconEntry {
  id: string;
  pattern: string;
  match: MatchKind;
  inflect?: boolean;
  tier: Tier;
  lang: string;
  status: EntryStatus;
  note: string;
  suggestions?: string[];
  models?: string[];
  added: string;
  evidence?: Evidence[];
}

export interface Match {
  entryId: string;
  tier: Tier;
  /** Offsets into the ORIGINAL input text (UTF-16 code units, end exclusive). */
  start: number;
  end: number;
}

export interface AnalysisStats {
  words: number;
  counts: Record<Tier, number>;
  total: number;
  /** Hits per 1,000 words (0 for empty input). */
  per1k: number;
}

export interface AnalysisResult {
  matches: Match[];
  stats: AnalysisStats;
}

export interface CompileOptions {
  /** Also activate `candidate` entries ("experimental lexicon"). Default false. */
  includeCandidates?: boolean;
  /** Tiers to activate. Default: artifact and lexical (stylistic is off by default). */
  tiers?: readonly Tier[];
}
