// Test doubles for the Worker (tests/worker*.test.ts): D1 on Node's SQLite with the real
// migrations, and a rate limiting binding that counts per key.

import { DatabaseSync } from 'node:sqlite';
import init from '../worker/migrations/0001_init.sql?raw';
import budgets from '../worker/migrations/0002_budgets.sql?raw';
import analytics from '../worker/migrations/0003_analytics.sql?raw';
import type { D1Database, D1PreparedStatement, RateLimit } from '../worker/src/types.ts';

/** D1 on Node's SQLite, with the real migrations. A batch runs as one transaction without
 * yielding, as D1 runs it in one round trip, so concurrent requests cannot interleave in it. */
export function d1(): { db: D1Database; sql: DatabaseSync } {
  const sql = new DatabaseSync(':memory:');
  for (const migration of [init, budgets, analytics]) sql.exec(migration);
  const queries = new WeakMap<D1PreparedStatement, { query: string; values: unknown[] }>();
  const runNow = (query: string, values: unknown[]) => {
    const { changes } = sql.prepare(query).run(...values);
    return { results: [], success: true, meta: { changes: Number(changes) } };
  };
  const statement = (query: string, values: unknown[]): D1PreparedStatement => {
    const stmt: D1PreparedStatement = {
      bind: (...v: unknown[]) => statement(query, v),
      first: async <T>() => {
        const row = sql.prepare(query).get(...values);
        return (row ? { ...row } : null) as T | null;
      },
      run: async () => runNow(query, values),
      all: async <T>() => ({ results: sql.prepare(query).all(...values).map((r) => ({ ...r })) as T[], success: true, meta: {} }),
    };
    queries.set(stmt, { query, values });
    return stmt;
  };
  const db: D1Database = {
    prepare: (query) => statement(query, []),
    batch: async (statements) => {
      sql.exec('BEGIN');
      try {
        const out = statements.map((s) => runNow(queries.get(s)!.query, queries.get(s)!.values));
        sql.exec('COMMIT');
        return out;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, sql };
}

export function limiter(limit: number): RateLimit & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { success: counts.get(key)! <= limit };
    },
  };
}

