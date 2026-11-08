// Bindings, variables and secrets (worker/wrangler.toml, `wrangler secret put`), with minimal
// types for the Workers APIs used here, so no type package is needed.

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Runs the statements in one transaction. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

/** A rate limiting binding ([[ratelimits]] in wrangler.toml). */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Env {
  DB: D1Database;
  REPORT_LIMIT: RateLimit;
  HITS_LIMIT: RateLimit;
  COLLECT_LIMIT: RateLimit;
  STATS_LIMIT: RateLimit;
  /** Secret: the dashboard's access token (GET /v1/stats). Unset: no dashboard data. */
  STATS_TOKEN?: string;
  /** Secret: fine-grained token with Issues read/write on GITHUB_REPO only. */
  GITHUB_TOKEN?: string;
  /** Secret: the Turnstile widget's secret key. */
  TURNSTILE_SECRET?: string;
  /** "owner/name" */
  GITHUB_REPO: string;
  /** Comma-separated origins allowed to call the API. */
  ALLOWED_ORIGINS: string;
  /** Comma-separated hostnames a Turnstile token may come from. */
  TURNSTILE_HOSTNAMES: string;
  /** Issues opened per UTC day and report kind at most, over all clients. */
  REPORTS_PER_DAY: string;
  /** Rows written for hit counts per UTC day at most, the budget row included (D1's daily write quota). */
  HITS_ROWS_PER_DAY: string;
  /** Rows written for usage statistics per UTC day at most, the budget row included. */
  ANALYTICS_ROWS_PER_DAY: string;
  /** Rows the dashboard may read per UTC day (D1's daily read quota is the account's). */
  STATS_ROWS_READ_PER_DAY: string;
  /** "1": print issues instead of opening them (local development). */
  GITHUB_DRY_RUN?: string;
}
