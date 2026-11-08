// Everything the Worker keeps in D1 (worker/migrations/): per-day counts, budgets, the day's
// salt, and the usage statistics' visits and events. No text, no IP addresses; a visitor is
// known only by the day's salted hash (see 0003_analytics.sql).

import type { UsageEvent, VisitInfo } from '../../web/src/report-contract.ts';
import type { D1Database } from './types.ts';

/** YYYY-MM-DD in UTC. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const changed = (meta: Record<string, unknown>) => Number(meta.changes ?? 0) === 1;

/**
 * Takes `amount` from the day's budget `name` if all of it still fits under `cap`, in one
 * statement, so concurrent requests cannot overshoot. True when taken.
 */
export async function reserveBudget(db: D1Database, day: string, name: string, amount: number, cap: number): Promise<boolean> {
  if (amount > cap) return false;
  const res = await db
    .prepare(
      'INSERT INTO budgets (day, name, used) VALUES (?1, ?2, ?3) ' +
        'ON CONFLICT (day, name) DO UPDATE SET used = used + ?3 WHERE used + ?3 <= ?4',
    )
    .bind(day, name, amount, cap)
    .run();
  return changed(res.meta);
}

/** Entry IDs per statement: D1 allows 100 bound parameters per query. */
export const HITS_PER_STATEMENT = 50;

/**
 * Adds one to each entry's count for the day, in one transaction of multi-row upserts (at
 * most HITS_PER_STATEMENT entries each), so a request stays far below D1's queries-per-
 * invocation limit.
 */
export async function addHits(db: D1Database, day: string, ids: readonly string[]): Promise<void> {
  const statements = [];
  for (let i = 0; i < ids.length; i += HITS_PER_STATEMENT) {
    const chunk = ids.slice(i, i + HITS_PER_STATEMENT);
    const rows = chunk.map((_, j) => `(?1, ?${j + 2}, 1)`).join(', ');
    statements.push(
      db
        .prepare(`INSERT INTO hits (day, entry_id, count) VALUES ${rows} ON CONFLICT (day, entry_id) DO UPDATE SET count = count + 1`)
        .bind(day, ...chunk),
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

/** Reports of one kind counted on the day, over all clients. */
export async function reportsOn(db: D1Database, day: string, kind: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(count), 0) AS n FROM reports WHERE day = ?1 AND kind = ?2')
    .bind(day, kind)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * Counts a report against the day's cap for its kind before its issue is opened, in one
 * statement (concurrent reports cannot overshoot). False, and nothing counted, when full.
 */
export async function reserveReport(db: D1Database, day: string, kind: string, entryId: string, cap: number): Promise<boolean> {
  const res = await db
    .prepare(
      'INSERT INTO reports (day, kind, entry_id, count) SELECT ?1, ?2, ?3, 1 ' +
        'WHERE (SELECT COALESCE(SUM(count), 0) FROM reports WHERE day = ?1 AND kind = ?2) < ?4 ' +
        'ON CONFLICT (day, kind, entry_id) DO UPDATE SET count = count + 1',
    )
    .bind(day, kind, entryId, cap)
    .run();
  return changed(res.meta);
}

/** Gives a reserved report back (its issue could not be opened). */
export async function releaseReport(db: D1Database, day: string, kind: string, entryId: string): Promise<void> {
  await db
    .prepare('UPDATE reports SET count = count - 1 WHERE day = ?1 AND kind = ?2 AND entry_id = ?3 AND count > 0')
    .bind(day, kind, entryId)
    .run();
}

/** The day's salt, made on first use (the first writer wins); earlier days' salts go. */
export async function saltFor(db: D1Database, day: string, fresh: () => string): Promise<string> {
  const read = db.prepare('SELECT salt FROM salts WHERE day = ?1').bind(day);
  const row = await read.first<{ salt: string }>();
  if (row) return row.salt;
  await db.batch([
    db.prepare('DELETE FROM salts WHERE day < ?1').bind(day),
    db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?1, ?2)').bind(day, fresh()),
  ]);
  const made = await read.first<{ salt: string }>();
  if (!made) throw new Error('no salt for the day');
  return made.salt;
}

export async function deleteOldSalts(db: D1Database, day: string): Promise<void> {
  await db.prepare('DELETE FROM salts WHERE day < ?1').bind(day).run();
}

// ---- Usage statistics (migration 0003) ----


/** A visit takes requests for two days at most (a tab left open); later ones are dropped. */
export const VISIT_OPEN_MS = 2 * 86_400_000;

export interface VisitWrite {
  visit: string;
  day: string;
  now: number;
  /** Set when the visit is not stored yet: everything known about it. */
  view: (VisitInfo & { visitor: string; country: string; region: string; city: string; asOrg: string; suspect: boolean; device: string; browser: string; os: string }) | null;
  events: readonly UsageEvent[];
  active: number;
  scroll: number;
}

/**
 * Rows D1 bills for a visit request, at most: it counts every index entry written as a row.
 * A new visit: the row, its primary-key index and `visits_day` (one spare); the update:
 * the row (no indexed column changes); an event: the row and `events_visit`.
 */
export const WRITE_COST = { visit: 4, update: 1, event: 2 } as const;
export const visitRows = (w: Pick<VisitWrite, 'view' | 'events'>) =>
  (w.view ? WRITE_COST.visit : 0) + WRITE_COST.update + w.events.length * WRITE_COST.event;

/** Whether a visit is stored and still takes requests (VISIT_OPEN_MS). */
export async function visitState(db: D1Database, visit: string, now: number): Promise<'missing' | 'open' | 'closed'> {
  const row = await db.prepare('SELECT started_at FROM visits WHERE id = ?1').bind(visit).first<{ started_at: number }>();
  if (!row) return 'missing';
  return Number(row.started_at) >= now - VISIT_OPEN_MS ? 'open' : 'closed';
}

/**
 * Stores a visit request in one transaction: the visit (first request only), its latest
 * engagement, and its events. Requests for a visit that is unknown or too old change nothing.
 */
export async function recordVisit(db: D1Database, w: VisitWrite): Promise<void> {
  const statements = [];
  const v = w.view;
  if (v) {
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO visits (id, day, started_at, last_seen, visitor, country, region, city, as_org, suspect, ' +
            'device, browser, os, lang, ref_host, utm_source, utm_medium, utm_campaign, path, viewport, theme, touch) ' +
            'VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)',
        )
        .bind(
          w.visit, w.day, w.now, v.visitor, v.country, v.region, v.city, v.asOrg, v.suspect ? 1 : 0,
          v.device, v.browser, v.os, v.lang, v.ref, v.utmSource, v.utmMedium, v.utmCampaign, v.path, v.viewport, v.theme, v.touch ? 1 : 0,
        ),
    );
  }
  const since = w.now - VISIT_OPEN_MS;
  statements.push(
    db
      .prepare(
        'UPDATE visits SET last_seen = MAX(last_seen, ?2), active_s = MAX(active_s, ?3), scroll_max = MAX(scroll_max, ?4) ' +
          'WHERE id = ?1 AND started_at >= ?5',
      )
      .bind(w.visit, w.now, w.active, w.scroll, since),
  );
  if (w.events.length > 0) {
    const rows = w.events.map((_, i) => `(?${3 + i * 3}, ?${4 + i * 3}, ?${5 + i * 3})`).join(', ');
    statements.push(
      db
        .prepare(
          `INSERT INTO events (visit, t_ms, name, value) SELECT ?1, column1, column2, column3 FROM (VALUES ${rows}) ` +
            'WHERE EXISTS (SELECT 1 FROM visits WHERE id = ?1 AND started_at >= ?2)',
        )
        .bind(w.visit, since, ...w.events.flatMap((e) => [e.t, e.name, e.value])),
    );
  }
  await db.batch(statements);
}

/** Visits and their events are kept this many days; `daily` keeps the totals. */
export const VISITS_KEEP_DAYS = 400;

/** Columns whose top values go into `daily` (at most DAILY_TOP each). */
const DAILY_DIMENSIONS = ['country', 'ref_host', 'utm_source', 'device', 'browser', 'os', 'lang', 'as_org'] as const;
const DAILY_TOP = 100;

/** Writes the day's totals into `daily` (again, if run twice), counting non-suspect visits. */
export async function rollUpDay(db: D1Database, day: string): Promise<void> {
  const visits = 'FROM visits WHERE day = ?1 AND suspect = 0';
  const statements = [
    db.prepare('DELETE FROM daily WHERE day = ?1').bind(day),
    db.prepare(`INSERT INTO daily (day, metric, value, count) SELECT ?1, 'visits', '', COUNT(*) ${visits}`).bind(day),
    db.prepare(`INSERT INTO daily (day, metric, value, count) SELECT ?1, 'visitors', '', COUNT(DISTINCT visitor) ${visits}`).bind(day),
    db
      .prepare("INSERT INTO daily (day, metric, value, count) SELECT ?1, 'suspect', '', COUNT(*) FROM visits WHERE day = ?1 AND suspect = 1")
      .bind(day),
    db
      .prepare(
        "INSERT INTO daily (day, metric, value, count) SELECT ?1, 'used', '', COUNT(DISTINCT e.visit) FROM events e " +
          "JOIN visits v ON v.id = e.visit WHERE v.day = ?1 AND v.suspect = 0 AND e.name IN ('analysis', 'example')",
      )
      .bind(day),
    ...DAILY_DIMENSIONS.map((column) =>
      db
        .prepare(
          `INSERT INTO daily (day, metric, value, count) SELECT * FROM (SELECT ?1, '${column}', ${column}, COUNT(*) AS n ${visits} ` +
            `GROUP BY ${column} ORDER BY n DESC LIMIT ${DAILY_TOP})`,
        )
        .bind(day),
    ),
    db
      .prepare(
        "INSERT INTO daily (day, metric, value, count) SELECT * FROM (SELECT ?1, 'event:' || e.name, e.value, COUNT(*) AS n FROM events e " +
          `JOIN visits v ON v.id = e.visit WHERE v.day = ?1 AND v.suspect = 0 GROUP BY e.name, e.value ORDER BY n DESC LIMIT ${DAILY_TOP * 5})`,
      )
      .bind(day),
  ];
  await db.batch(statements);
}

/**
 * Rows deleted per daily run at most, so that deleting old days stays far below the
 * account's daily write quota (about 2 rows billed per event, 3 per visit, with indexes);
 * a backlog is worked off over the following days.
 */
export const DELETE_CHUNK = { events: 8000, visits: 3000 } as const;

/** Deletes visits (and first their events) of days before `cutoff`, a chunk at a time. */
export async function deleteOldVisits(db: D1Database, cutoff: string): Promise<void> {
  await db.batch([
    db
      .prepare(
        'DELETE FROM events WHERE rowid IN (SELECT e.rowid FROM events e JOIN visits v ON v.id = e.visit ' +
          `WHERE v.day < ?1 LIMIT ${DELETE_CHUNK.events})`,
      )
      .bind(cutoff),
    db
      .prepare(
        'DELETE FROM visits WHERE id IN (SELECT v.id FROM visits v WHERE v.day < ?1 ' +
          `AND NOT EXISTS (SELECT 1 FROM events e WHERE e.visit = v.id) LIMIT ${DELETE_CHUNK.visits})`,
      )
      .bind(cutoff),
  ]);
}

/** The day `days` days before `day` (YYYY-MM-DD, UTC). */
export function dayBefore(day: string, days: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000));
}

/** What the day's budget `name` has used so far. */
export async function budgetUsed(db: D1Database, day: string, name: string): Promise<number> {
  const row = await db.prepare('SELECT used FROM budgets WHERE day = ?1 AND name = ?2').bind(day, name).first<{ used: number }>();
  return Number(row?.used ?? 0);
}

/** Adds `amount` to the day's budget `name`, whatever it is at (spent already, e.g. rows read). */
export async function chargeBudget(db: D1Database, day: string, name: string, amount: number): Promise<void> {
  await db
    .prepare('INSERT INTO budgets (day, name, used) VALUES (?1, ?2, ?3) ON CONFLICT (day, name) DO UPDATE SET used = used + ?3')
    .bind(day, name, amount)
    .run();
}
