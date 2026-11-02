// Everything the Worker keeps in D1 (worker/migrations/): per-day counts, budgets and the
// day's salt. No text, no IP addresses, no client identifiers.

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
