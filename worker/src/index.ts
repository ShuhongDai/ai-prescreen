// The report, hit-count and usage-statistics API at https://api.aiprescreen.fyi:
//   POST /v1/report   a new-phrase or false-positive report → a GitHub issue (Turnstile check)
//   POST /v1/hits     the entry IDs one analysis showed → per-day counts in D1
//   POST /v1/collect  usage statistics: a visit and its events → D1 (src/analytics.ts)
//   GET  /v1/health   whether reports are configured (no details)
//   GET  /v1/stats    the dashboard's numbers (STATS_TOKEN only, src/stats.ts)
//   GET  /dashboard   the dashboard page (src/dashboard.ts)
// Only the page's origin may POST (CORS, and the Origin header is checked). Clients are
// rate-limited by a salted hash of their IP (an IPv6 address's /64) that is never stored
// (src/limits.ts); a visit stores the day's visitor hash, another hash of the same salt that
// cannot be linked to the address once the salt is gone. Nothing here logs or keeps an IP
// address, a User-Agent or any reported text, except that a local dry run (GITHUB_DRY_RUN,
// development only) prints the issue it would open. Daily caps keep the account's free
// quotas safe: issues per report kind, rows written for hits and statistics, rows the
// dashboard reads.

import { API_PATHS, type ReportError } from '../../web/src/report-contract.ts';
import { clientFamily, isBot, isHostingNetwork, parseCollect, placeOf, visitorKey } from './analytics.ts';
import { dashboardAsset } from './dashboard.ts';
import { ENTRY_IDS } from './generated/entry-ids.ts';
import { openIssue, type OpenedIssue } from './github.ts';
import { parseHits } from './hits.ts';
import { clientKey, clientPrefix, dailySalt } from './limits.ts';
import { issueFor, parseReport } from './reports.ts';
import { aggregate, parseStatsQuery, readStats } from './stats.ts';
import type { StatsError } from './stats-types.ts';
import {
  addHits,
  budgetUsed,
  chargeBudget,
  dayBefore,
  deleteOldSalts,
  deleteOldVisits,
  recordVisit,
  releaseReport,
  reportsOn,
  reserveBudget,
  reserveReport,
  rollUpDay,
  utcDay,
  visitRows,
  visitState,
  VISITS_KEEP_DAYS,
} from './store.ts';
import { verifyTurnstile } from './turnstile.ts';
import type { Env, ExecutionContext } from './types.ts';

/** Largest request bodies accepted, in bytes. */
export const BODY_MAX = { report: 16_384, hits: 65_536, collect: 16_384 } as const;

export interface Deps {
  now: Date;
  fetch: typeof fetch;
  knownIds: ReadonlySet<string>;
}

const KNOWN_IDS: ReadonlySet<string> = new Set(ENTRY_IDS);

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const failure = (error: ReportError, status: number, headers: Record<string, string>) =>
  json({ ok: false, error }, status, headers);

/** A cap from [vars]: a whole number, else 0 (closed), so a typo never lifts a limit. */
const cap = (value: string | undefined) => (/^\d+$/.test(value ?? '') ? Number(value) : 0);

/**
 * The parsed JSON body, or undefined when it is over `max` bytes, not UTF-8 or not JSON.
 * Reads at most max + 1 bytes, also without a Content-Length. Any content type: hit counts
 * come from navigator.sendBeacon as text/plain (no CORS preflight).
 */
async function readJson(request: Request, max: number): Promise<unknown> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && !(Number(declared) <= max)) return undefined;
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** Compares two secrets in constant time (their hashes, so the length does not leak either). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** GET /v1/stats: same-origin only (the dashboard), no CORS headers. */
async function stats(request: Request, env: Env, deps: Deps, url: URL): Promise<Response> {
  const fail = (error: StatsError, status: number) => json({ ok: false, error }, status, {});
  const day = utcDay(deps.now);
  const key = await clientKey(clientPrefix(request.headers.get('CF-Connecting-IP') ?? ''), await dailySalt(env.DB, day));
  if (!(await env.STATS_LIMIT.limit({ key })).success) return fail('rate-limited', 429);
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!env.STATS_TOKEN || !token || !(await sameSecret(token, env.STATS_TOKEN))) return fail('unauthorized', 401);
  const query = parseStatsQuery(url, day);
  if (!query) return fail('invalid', 400);
  // Rows read are counted after the fact; once over the day's cap, nothing more is read.
  if ((await budgetUsed(env.DB, day, 'stats-reads')) >= cap(env.STATS_ROWS_READ_PER_DAY)) return fail('budget', 503);
  const now = deps.now.getTime();
  const { data, rowsRead } = await readStats(env.DB, query, now);
  await chargeBudget(env.DB, day, 'stats-reads', rowsRead);
  return json(aggregate(query, data, now), 200, {});
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const asset = dashboardAsset(url.pathname);
    if (asset) return asset;
    if (url.pathname === '/v1/stats') return stats(request, env, deps, url);
  }
  const origin = request.headers.get('Origin');
  const allowed = origin !== null && list(env.ALLOWED_ORIGINS).includes(origin);
  const cors: Record<string, string> = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };

  if (url.pathname === '/v1/health' && request.method === 'GET') {
    return json({ ok: true, reports: Boolean(env.TURNSTILE_SECRET && env.GITHUB_TOKEN) }, 200, cors);
  }
  const route =
    url.pathname === API_PATHS.report ? 'report' : url.pathname === API_PATHS.hits ? 'hits' : url.pathname === API_PATHS.collect ? 'collect' : null;
  if (route === null) return json({ ok: false, error: 'not-found' }, 404, cors);
  if (request.method === 'OPTIONS') {
    if (!allowed) return new Response(null, { status: 403, headers: cors });
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, { ...cors, Allow: 'POST, OPTIONS' });
  if (!allowed) return failure('origin', 403, cors);

  const body = await readJson(request, BODY_MAX[route]);
  if (body === undefined) return failure('invalid', 400, cors);
  const day = utcDay(deps.now);
  const ip = request.headers.get('CF-Connecting-IP');
  const key = await clientKey(clientPrefix(ip ?? ''), await dailySalt(env.DB, day));

  if (route === 'collect') {
    const parsed = parseCollect(body, deps.knownIds);
    if (parsed === null) return failure('invalid', 400, cors);
    const done = new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'no-store' } });
    // Scripted clients are dropped quietly, like counts over the day's budget.
    const ua = request.headers.get('User-Agent') ?? '';
    if (isBot(ua)) return done;
    if (!(await env.COLLECT_LIMIT.limit({ key })).success) return failure('rate-limited', 429, cors);
    // Whole minutes: no finer time than the dashboard needs.
    const now = Math.floor(deps.now.getTime() / 60_000) * 60_000;
    // Every request carries the view; it creates the visit only when it is not stored yet.
    const state = await visitState(env.DB, parsed.visit, now);
    if (state === 'closed' || (state === 'missing' && !parsed.view)) return done;
    const place = placeOf(request);
    const view = state === 'missing' && parsed.view && {
      ...parsed.view,
      ...place,
      ...clientFamily(ua),
      visitor: await visitorKey(clientPrefix(ip ?? ''), ua, await dailySalt(env.DB, day)),
      suspect: isHostingNetwork(place.asOrg),
    };
    const write = { visit: parsed.visit, day, now, view: view || null, events: parsed.events, active: parsed.active, scroll: parsed.scroll };
    if (await reserveBudget(env.DB, day, 'analytics', visitRows(write) + 1, cap(env.ANALYTICS_ROWS_PER_DAY))) {
      await recordVisit(env.DB, write);
    }
    return done;
  }

  if (route === 'hits') {
    const ids = parseHits(body, deps.knownIds);
    if (ids === null) return failure('invalid', 400, cors);
    if (!(await env.HITS_LIMIT.limit({ key })).success) return failure('rate-limited', 429, cors);
    // Over the day's write budget the counts are dropped quietly; the page needs no answer.
    // The budget covers every row this writes: one per entry, and the budget row itself.
    if (ids.length > 0 && (await reserveBudget(env.DB, day, 'hits', ids.length + 1, cap(env.HITS_ROWS_PER_DAY)))) {
      await addHits(env.DB, day, ids);
    }
    return new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'no-store' } });
  }

  // Validated before the Turnstile check: a token can be checked only once.
  const parsed = parseReport(body, deps.knownIds);
  if (!parsed) return failure('invalid', 400, cors);
  if (!(await env.REPORT_LIMIT.limit({ key })).success) return failure('rate-limited', 429, cors);
  const dryRun = env.GITHUB_DRY_RUN === '1';
  const perDay = cap(env.REPORTS_PER_DAY);
  if (!env.TURNSTILE_SECRET || (!env.GITHUB_TOKEN && !dryRun) || perDay === 0) return failure('unavailable', 503, cors);
  const { kind } = parsed.report;
  const entryId = parsed.report.kind === 'false-positive' ? parsed.report.entryId : '';
  // A full day fails before the reader's token is spent.
  if ((await reportsOn(env.DB, day, kind)) >= perDay) return failure('unavailable', 503, cors);
  const human = await verifyTurnstile(parsed.token, env.TURNSTILE_SECRET, ip, list(env.TURNSTILE_HOSTNAMES), deps.fetch);
  if (!human) return failure('challenge', 403, cors);
  // Counted before the issue is opened (only after Turnstile, so no token, no count).
  if (!(await reserveReport(env.DB, day, kind, entryId, perDay))) return failure('unavailable', 503, cors);

  const draft = issueFor(parsed.report);
  let issue: OpenedIssue;
  if (dryRun) {
    console.log(`[dry run] ${draft.title}\nlabels: ${draft.labels.join(', ')}\n\n${draft.body}`);
    issue = { number: 0, url: `https://github.com/${env.GITHUB_REPO}/issues` };
  } else {
    try {
      issue = await openIssue(env.GITHUB_REPO, env.GITHUB_TOKEN ?? '', draft, deps.fetch);
    } catch {
      await releaseReport(env.DB, day, kind, entryId).catch(() => undefined);
      return failure('unavailable', 503, cors);
    }
  }
  // Nothing that can fail after the issue exists.
  return json({ ok: true, issue }, 201, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env, { now: new Date(), fetch, knownIds: KNOWN_IDS });
    } catch {
      return json({ ok: false, error: 'unavailable' }, 500, { Vary: 'Origin' });
    }
  },

  /**
   * Daily cron (wrangler.toml): drop past days' salts even when no request comes; write the
   * last two days' totals (again: visits can end after midnight); delete visits older than
   * VISITS_KEEP_DAYS.
   */
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(daily(env.DB, utcDay(new Date())));
  },
};

/** The daily cron's work, in order; each step runs even if an earlier one failed. */
export async function daily(db: Env['DB'], today: string): Promise<void> {
  const steps = [
    () => deleteOldSalts(db, today),
    () => rollUpDay(db, dayBefore(today, 2)),
    () => rollUpDay(db, dayBefore(today, 1)),
    () => deleteOldVisits(db, dayBefore(today, VISITS_KEEP_DAYS)),
  ];
  for (const step of steps) await step().catch(() => undefined);
}
