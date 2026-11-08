// GET /v1/stats: the dashboard's numbers, read from D1 and summed up here. Only with the
// STATS_TOKEN secret. The visits of the range are read once and every breakdown is computed
// from them, so a refresh reads each row once (D1's free plan counts rows read); the reads
// stop at STATS_MAX_VISITS / STATS_MAX_EVENTS (no full sort), so one answer reads a bounded
// number of rows. The Workers free plan allows 10 ms of CPU per request: summing up many
// tens of thousands of events may not fit, so very busy ranges need a shorter range.

import { EVENT_VALUES, MARK_BUCKETS, WORD_BUCKETS } from '../../web/src/report-contract.ts';
import { dayBefore } from './store.ts';
import type { Count, DayRow, Dimension, StatsResponse, Tally } from './stats-types.ts';
import { DIMENSIONS } from './stats-types.ts';
import type { D1Database } from './types.ts';

/** Longest range in days (visits are kept 400 days). */
export const STATS_MAX_DAYS = 400;
/** Most visits and events read for one answer; beyond that, the newest. */
export const STATS_MAX_VISITS = 20_000;
export const STATS_MAX_EVENTS = 100_000;
/** Rows per breakdown in the answer. */
export const TOP = 30;
export const LIVE_MS = 30 * 60_000;

export interface StatsQuery {
  from: string;
  to: string;
  filters: [Dimension, string][];
  /** Include visits from cloud networks. */
  suspect: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DIMENSION_SET: ReadonlySet<string> = new Set(DIMENSIONS);

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD&f=column:value (repeatable)&suspect=1, or null. */
export function parseStatsQuery(url: URL, today: string): StatsQuery | null {
  const from = url.searchParams.get('from') ?? today;
  const to = url.searchParams.get('to') ?? today;
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return null;
  if (from > to || from < dayBefore(to, STATS_MAX_DAYS)) return null;
  const filters: [Dimension, string][] = [];
  for (const f of url.searchParams.getAll('f')) {
    const at = f.indexOf(':');
    const column = f.slice(0, at);
    const value = f.slice(at + 1);
    if (at < 1 || !DIMENSION_SET.has(column) || value.length > 200 || filters.length >= 8) return null;
    filters.push([column as Dimension, value]);
  }
  return { from, to, filters, suspect: url.searchParams.get('suspect') === '1' };
}

export interface VisitRow {
  id: string;
  day: string;
  started_at: number;
  last_seen: number;
  visitor: string;
  suspect: number;
  active_s: number;
  scroll_max: number;
  [column: string]: string | number;
}

export interface EventRow {
  visit: string;
  t_ms: number;
  name: string;
  value: string;
}

export interface StatsData {
  visits: VisitRow[];
  events: EventRow[];
  suspectLeftOut: number;
  live: { country: string }[];
  /** Start times of visits in the last 48 hours (whatever the range). */
  recent: number[];
  hits: Tally[];
  reports: Tally[];
  history: { day: string; metric: string; count: number }[];
  truncated: boolean;
}

/**
 * The filters as a condition on visits `v`, with their values bound from ?first on. Column
 * names come from DIMENSIONS only; values are always bound.
 */
function filterSql(q: StatsQuery, first: number, withSuspect = q.suspect): { sql: string; values: unknown[] } {
  const parts = ['1 = 1'];
  if (!withSuspect) parts.push('v.suspect = 0');
  const values: unknown[] = [];
  for (const [column, value] of q.filters) {
    parts.push(`v.${column} = ?${first + values.length}`);
    values.push(column === 'touch' ? Number(value === '1') : value);
  }
  return { sql: parts.join(' AND '), values };
}

const VISIT_COLUMNS = ['id', 'day', 'started_at', 'last_seen', 'visitor', 'suspect', 'active_s', 'scroll_max', ...DIMENSIONS];

/** Reads what the answer needs; `rowsRead` is what D1 counted for it. */
export async function readStats(db: D1Database, q: StatsQuery, now: number): Promise<{ data: StatsData; rowsRead: number }> {
  const f = filterSql(q, 3);
  const w = { sql: `v.day BETWEEN ?1 AND ?2 AND ${f.sql}` };
  const bound = [q.from, q.to, ...f.values];
  const all = filterSql(q, 3, true);
  const recent = filterSql(q, 3);
  const twoDaysAgo = dayBefore(new Date(now).toISOString().slice(0, 10), 2);
  const [visits, events, left, liveRows, recentRows, hits, reports, history] = await Promise.all([
    // Newest days first, along the day index, so the read stops at the limit.
    db
      .prepare(`SELECT ${VISIT_COLUMNS.map((c) => `v.${c}`).join(', ')} FROM visits v WHERE ${w.sql} ORDER BY v.day DESC LIMIT ${STATS_MAX_VISITS + 1}`)
      .bind(...bound)
      .all<VisitRow>(),
    db
      .prepare(`SELECT e.visit, e.t_ms, e.name, e.value FROM events e JOIN visits v ON v.id = e.visit WHERE ${w.sql} LIMIT ${STATS_MAX_EVENTS}`)
      .bind(...bound)
      .all<EventRow>(),
    q.suspect
      ? null
      : db
          .prepare(`SELECT COUNT(*) AS n FROM visits v WHERE v.day BETWEEN ?1 AND ?2 AND ${all.sql} AND v.suspect = 1`)
          .bind(q.from, q.to, ...all.values)
          .all<{ n: number }>(),
    db
      .prepare(`SELECT v.country FROM visits v WHERE v.day >= ?1 AND v.last_seen >= ?2 AND ${recent.sql}`)
      .bind(twoDaysAgo, now - LIVE_MS, ...recent.values)
      .all<{ country: string }>(),
    db
      .prepare(`SELECT v.started_at FROM visits v WHERE v.day >= ?1 AND v.started_at >= ?2 AND ${recent.sql} LIMIT ${STATS_MAX_VISITS}`)
      .bind(twoDaysAgo, now - 48 * 3_600_000, ...recent.values)
      .all<{ started_at: number }>(),
    db
      .prepare(`SELECT entry_id AS value, SUM(count) AS count FROM hits WHERE day BETWEEN ?1 AND ?2 GROUP BY entry_id ORDER BY count DESC LIMIT ${TOP}`)
      .bind(q.from, q.to)
      .all<Tally>(),
    db
      .prepare('SELECT kind AS value, SUM(count) AS count FROM reports WHERE day BETWEEN ?1 AND ?2 GROUP BY kind')
      .bind(q.from, q.to)
      .all<Tally>(),
    db
      .prepare("SELECT day, metric, count FROM daily WHERE metric IN ('visits', 'visitors', 'used') ORDER BY day")
      .all<{ day: string; metric: string; count: number }>(),
  ]);
  const results = [visits, events, left, liveRows, recentRows, hits, reports, history];
  const rowsRead = results.reduce((sum, r) => sum + Number(r?.meta.rows_read ?? r?.results.length ?? 0), 0);
  const truncated = visits.results.length > STATS_MAX_VISITS || events.results.length >= STATS_MAX_EVENTS;
  const kept = visits.results.slice(0, STATS_MAX_VISITS);
  const keptIds = new Set(kept.map((v) => v.id));
  return {
    data: {
      visits: kept,
      // Only events of the visits kept, so no step counts more visits than were read.
      events: truncated ? events.results.filter((e) => keptIds.has(e.visit)) : events.results,
      recent: recentRows.results.map((r) => Number(r.started_at)),
      suspectLeftOut: Number(left?.results[0]?.n ?? 0),
      live: liveRows.results,
      hits: hits.results.map((r) => ({ value: r.value, count: Number(r.count) })),
      reports: reports.results.map((r) => ({ value: r.value, count: Number(r.count) })),
      history: history.results,
      truncated,
    },
    rowsRead,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const tallies = (map: Map<string, number>, limit = Infinity): Tally[] =>
  [...map]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);

/** Counts in the order of `buckets`, zeros included. */
const inOrder = (buckets: readonly string[], map: Map<string, number>): Tally[] => buckets.map((value) => ({ value, count: map.get(value) ?? 0 }));

const bump = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

const ACTIVE_BUCKETS: [string, number][] = [
  ['<10 s', 10],
  ['10–29 s', 30],
  ['30–59 s', 60],
  ['1–2 min', 180],
  ['3–9 min', 600],
  ['10–29 min', 1800],
  ['30+ min', Infinity],
];
const SCROLL_BUCKETS: [string, number][] = [
  ['<25%', 25],
  ['25–49%', 50],
  ['50–74%', 75],
  ['75–99%', 100],
  ['100%', Infinity],
];
const bucketOf = (buckets: [string, number][], n: number) => buckets.find(([, limit]) => n < limit)![0];

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = dayBefore(d, -1)) days.push(d);
  return days;
}

/** Sums the rows up into the dashboard's answer. Pure. */
export function aggregate(q: StatsQuery, data: StatsData, now: number): StatsResponse {
  const { visits, events } = data;
  const visitorOf = (v: VisitRow) => `${v.day}/${v.visitor}`;

  // Events per visit, and which visits had which event.
  const byVisit = new Map<string, EventRow[]>();
  for (const e of events) {
    const list = byVisit.get(e.visit);
    if (list) list.push(e);
    else byVisit.set(e.visit, [e]);
  }
  const visitsWith = (test: (e: EventRow) => boolean) => {
    const set = new Set<string>();
    for (const e of events) if (test(e)) set.add(e.visit);
    return set;
  };
  const used = visitsWith((e) => e.name === 'analysis' || e.name === 'example');

  // Per day.
  const days = new Map<string, { visits: number; visitors: Set<string>; used: number }>(
    eachDay(q.from, q.to).map((d) => [d, { visits: 0, visitors: new Set(), used: 0 }]),
  );
  const hours = new Map<number, number>();
  for (const started of data.recent) {
    const hour = Math.floor(started / 3_600_000);
    hours.set(hour, (hours.get(hour) ?? 0) + 1);
  }
  for (const v of visits) {
    const day = days.get(v.day);
    if (day) {
      day.visits += 1;
      day.visitors.add(v.visitor);
      if (used.has(v.id)) day.used += 1;
    }
  }
  const dayRows: DayRow[] = [...days].map(([day, d]) => ({ day, visits: d.visits, visitors: d.visitors.size, used: d.used }));

  // Breakdowns per dimension.
  const dims = {} as Record<Dimension, Count[]>;
  for (const column of DIMENSIONS) {
    const counts = new Map<string, { visits: number; visitors: Set<string>; label?: string }>();
    for (const v of visits) {
      const value = String(v[column] ?? '');
      let c = counts.get(value);
      if (!c) {
        c = { visits: 0, visitors: new Set() };
        if (column === 'city' && value) c.label = [value, v.region, v.country].filter(Boolean).join(', ');
        if (column === 'region' && value) c.label = [value, v.country].filter(Boolean).join(', ');
        counts.set(value, c);
      }
      c.visits += 1;
      c.visitors.add(visitorOf(v));
    }
    dims[column] = [...counts]
      .map(([value, c]) => ({ value, visits: c.visits, visitors: c.visitors.size, ...(c.label ? { label: c.label } : {}) }))
      .sort((a, b) => b.visits - a.visits || a.value.localeCompare(b.value))
      .slice(0, TOP);
  }

  // Funnel: each step counts the visits that reached it.
  const steps: [string, Set<string>][] = [
    ['Draft entered (paste or type)', visitsWith((e) => e.name === 'input')],
    ['Analysed own draft', visitsWith((e) => e.name === 'analysis')],
    ['Opened a highlight', visitsWith((e) => e.name === 'popover')],
    ['Opened the report form', visitsWith((e) => e.name === 'report-open')],
  ];
  const funnel = [{ step: 'Opened the page', visits: visits.length }, ...steps.map(([step, set]) => ({ step, visits: set.size }))];

  // Events with fixed values, in one pass.
  const byNameValue = new Map<string, { count: number; visits: Set<string> }>();
  for (const e of events) {
    const key = `${e.name}\n${e.value}`;
    const c = byNameValue.get(key);
    if (c) {
      c.count += 1;
      c.visits.add(e.visit);
    } else byNameValue.set(key, { count: 1, visits: new Set([e.visit]) });
  }
  const fixed: StatsResponse['events'] = {};
  for (const [name, values] of Object.entries(EVENT_VALUES) as [string, readonly string[]][]) {
    fixed[name] = values.map((value) => {
      const c = byNameValue.get(`${name}\n${value}`);
      return { value, count: c?.count ?? 0, visits: c?.visits.size ?? 0 };
    });
  }

  const entryTally = (name: string) => {
    const map = new Map<string, number>();
    for (const e of events) if (e.name === name) bump(map, e.value);
    return tallies(map, TOP);
  };

  // Analyses: word and highlight buckets.
  const parts = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  const analysesPerVisit = new Map<string, number>();
  const firstAnalysis: number[] = [];
  for (const [visit, list] of byVisit) {
    const analyses = list.filter((e) => e.name === 'analysis');
    if (analyses.length === 0) continue;
    analysesPerVisit.set(visit, analyses.length);
    firstAnalysis.push(Math.min(...analyses.map((e) => e.t_ms)) / 1000);
    for (const e of analyses) e.value.split('|').forEach((bucket, i) => parts[i] && bump(parts[i]!, bucket));
  }

  const active = new Map<string, number>();
  const scroll = new Map<string, number>();
  for (const v of visits) {
    bump(active, bucketOf(ACTIVE_BUCKETS, v.active_s));
    bump(scroll, bucketOf(SCROLL_BUCKETS, v.scroll_max));
  }

  const liveCountries = new Map<string, number>();
  for (const l of data.live) bump(liveCountries, l.country);

  const history = new Map<string, DayRow>();
  for (const h of data.history) {
    const row = history.get(h.day) ?? { day: h.day, visits: 0, visitors: 0, used: 0 };
    if (h.metric === 'visits' || h.metric === 'visitors' || h.metric === 'used') row[h.metric] = Number(h.count);
    history.set(h.day, row);
  }

  const analysing = [...analysesPerVisit.values()];
  return {
    ok: true,
    generatedAt: now,
    from: q.from,
    to: q.to,
    filters: q.filters,
    suspect: q.suspect,
    truncated: data.truncated,
    live: { visits: data.live.length, countries: tallies(liveCountries, 10) },
    totals: {
      visits: visits.length,
      visitors: new Set(visits.map(visitorOf)).size,
      used: visits.filter((v) => used.has(v.id)).length,
      suspectLeftOut: data.suspectLeftOut,
      medianActiveS: median(visits.map((v) => v.active_s)),
      medianScroll: median(visits.map((v) => v.scroll_max)),
      medianFirstAnalysisS: firstAnalysis.length ? Math.round(median(firstAnalysis)) : null,
      analysesPerAnalysingVisit: analysing.length ? Math.round((analysing.reduce((a, b) => a + b, 0) / analysing.length) * 10) / 10 : 0,
    },
    days: dayRows,
    hours: [...hours].map(([hour, visits]) => ({ hour, visits })).sort((a, b) => a.hour - b.hour),
    dims,
    funnel,
    events: fixed,
    entries: { popover: entryTally('popover'), dismiss: entryTally('dismiss') },
    analysis: {
      words: inOrder(WORD_BUCKETS, parts[0]!),
      artifact: inOrder(MARK_BUCKETS, parts[1]!),
      lexical: inOrder(MARK_BUCKETS, parts[2]!),
      stylistic: inOrder(MARK_BUCKETS, parts[3]!),
    },
    engagement: { active: inOrder(ACTIVE_BUCKETS.map(([b]) => b), active), scroll: inOrder(SCROLL_BUCKETS.map(([b]) => b), scroll) },
    hits: data.hits,
    reports: data.reports,
    history: [...history.values()],
  };
}
