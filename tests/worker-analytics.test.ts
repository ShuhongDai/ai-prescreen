import { beforeEach, describe, expect, it } from 'vitest';
import { analysisValue, COLLECT_MAX_EVENTS, type CollectRequest, type VisitInfo } from '../web/src/report-contract.ts';
import { clientFamily, isBot, isHostingNetwork, parseCollect, visitorKey } from '../worker/src/analytics.ts';
import { daily, handle, type Deps } from '../worker/src/index.ts';
import { clientKey, resetSaltCache } from '../worker/src/limits.ts';
import { parseStatsQuery } from '../worker/src/stats.ts';
import type { StatsResponse } from '../worker/src/stats-types.ts';
import type { Env } from '../worker/src/types.ts';
import { d1, limiter } from './worker-fakes.ts';

const KNOWN = new Set(['en.lexical.delve', 'en.artifact.certainly-here-is']);
const VISIT = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'BBBBBBBBBBBBBBBBBBBBBB';
const IP = '203.0.113.7';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const view: VisitInfo = {
  path: '/',
  ref: 'news.ycombinator.com',
  utmSource: 'newsletter',
  utmMedium: '',
  utmCampaign: '',
  lang: 'de-AT',
  viewport: '1024-1439',
  theme: 'dark',
  touch: false,
};

const first: CollectRequest = { visit: VISIT, view, events: [], active: 0, scroll: 40 };

function world(env: Partial<Env> = {}) {
  const { db, sql } = d1();
  const full = {
    DB: db,
    REPORT_LIMIT: limiter(5),
    HITS_LIMIT: limiter(20),
    COLLECT_LIMIT: limiter(30),
    STATS_LIMIT: limiter(20),
    GITHUB_REPO: 'ShuhongDai/ai-prescreen',
    ALLOWED_ORIGINS: 'https://aiprescreen.fyi',
    TURNSTILE_HOSTNAMES: 'aiprescreen.fyi',
    REPORTS_PER_DAY: '30',
    HITS_ROWS_PER_DAY: '20000',
    ANALYTICS_ROWS_PER_DAY: '30000',
    STATS_ROWS_READ_PER_DAY: '1500000',
    STATS_TOKEN: 'stats-token',
    ...env,
  } as Env;
  const deps = (at = '2026-11-08T12:00:00Z'): Deps => ({ now: new Date(at), fetch, knownIds: KNOWN });
  return { env: full, sql, deps };
}

function collect(body: unknown, init: { ua?: string; origin?: string | null; ip?: string; cf?: Record<string, unknown> } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'text/plain;charset=UTF-8', 'CF-Connecting-IP': init.ip ?? IP, 'User-Agent': init.ua ?? UA };
  if (init.origin !== null) headers.Origin = init.origin ?? 'https://aiprescreen.fyi';
  const req = new Request('https://api.aiprescreen.fyi/v1/collect', { method: 'POST', headers, body: JSON.stringify(body) });
  Object.defineProperty(req, 'cf', { value: init.cf ?? { country: 'AT', region: 'Tyrol', city: 'Innsbruck', asOrganization: 'Universitaet Innsbruck' } });
  return req;
}

function statsRequest(query = '', token: string | null = 'stats-token'): Request {
  const headers: Record<string, string> = { 'CF-Connecting-IP': IP };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://api.aiprescreen.fyi/v1/stats${query}`, { headers });
}

beforeEach(() => resetSaltCache());

describe('usage statistics: validation', () => {
  it('accepts a view with events from the fixed lists, entry IDs and analysis buckets', () => {
    const events = [
      { name: 'input', value: 'paste', t: 1200 },
      { name: 'analysis', value: analysisValue(350, { artifact: 1, lexical: 7, stylistic: 0 }), t: 5300 },
      { name: 'popover', value: 'en.lexical.delve', t: 9000 },
      { name: 'example', value: '', t: 9100 },
    ];
    const parsed = parseCollect({ ...first, events }, KNOWN);
    expect(parsed?.view).toEqual(view);
    expect(parsed?.events.map((e) => e.value)).toEqual(['paste', '200-999|1|6-20|0', 'en.lexical.delve', '']);
  });

  it('rejects anything outside the contract', () => {
    const bad = (patch: Record<string, unknown>) => parseCollect({ ...first, ...patch }, KNOWN);
    const event = (name: string, value: string, t = 1) => bad({ events: [{ name, value, t }] });
    expect(bad({ visit: 'short' })).toBeNull();
    expect(bad({ visit: `${VISIT.slice(1)}=` })).toBeNull();
    expect(bad({ active: -1 })).toBeNull();
    expect(bad({ scroll: 101 })).toBeNull();
    expect(bad({ active: 1.5 })).toBeNull();
    expect(event('typed-text', 'hello')).toBeNull();
    expect(event('input', 'drop')).toBeNull();
    expect(event('popover', 'en.lexical.unknown')).toBeNull();
    expect(event('analysis', '200-999|1|6-20')).toBeNull();
    expect(event('analysis', 'many|1|1|1')).toBeNull();
    expect(event('example', '', -5)).toBeNull();
    expect(bad({ events: Array.from({ length: COLLECT_MAX_EVENTS + 1 }, () => ({ name: 'key', value: '', t: 1 })) })).toBeNull();
    const badView = (patch: Partial<Record<keyof VisitInfo, unknown>>) => bad({ view: { ...view, ...patch } });
    expect(badView({ ref: 'https://example.com/path' })).toBeNull();
    expect(badView({ ref: 'x'.repeat(101) })).toBeNull();
    expect(badView({ utmSource: 'Newsletter' })).toBeNull();
    expect(badView({ utmSource: '<script>' })).toBeNull();
    expect(badView({ path: 'relative' })).toBeNull();
    expect(badView({ lang: 'german' })).toBeNull();
    expect(badView({ viewport: '9000' })).toBeNull();
    expect(badView({ theme: 'blue' })).toBeNull();
    expect(badView({ touch: 'yes' })).toBeNull();
    // Accepted, for contrast: no view at all (a later request of the visit), utm in other scripts.
    expect(bad({ view: undefined })?.view).toBeNull();
    expect(badView({ utmCampaign: '知乎 spring-2027' })).not.toBeNull();
  });

  it('reads browser, system and device families, and spots bots and hosting networks', () => {
    expect(clientFamily(UA)).toEqual({ device: 'desktop', browser: 'Safari', os: 'macOS' });
    expect(clientFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0')).toEqual({
      device: 'desktop',
      browser: 'Edge',
      os: 'Windows',
    });
    expect(clientFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1')).toEqual({
      device: 'mobile',
      browser: 'Chrome',
      os: 'iOS',
    });
    expect(clientFamily('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36').device).toBe('tablet');
    expect(clientFamily('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toEqual({ device: 'desktop', browser: 'Firefox', os: 'Linux' });
    expect(isBot('')).toBe(true);
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBot('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0')).toBe(true);
    expect(isBot(UA)).toBe(false);
    expect(isHostingNetwork('Amazon.com, Inc.')).toBe(true);
    expect(isHostingNetwork('Hetzner Online GmbH')).toBe(true);
    expect(isHostingNetwork('Universitaet Innsbruck')).toBe(false);
  });

  it('hashes visitors per day, never as the rate-limit key', async () => {
    const a = await visitorKey(IP, UA, 'salt-1');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await visitorKey(IP, UA, 'salt-1')).toBe(a);
    expect(await visitorKey(IP, UA, 'salt-2')).not.toBe(a);
    expect(await visitorKey(IP, 'other browser', 'salt-1')).not.toBe(a);
    expect(await clientKey(IP, 'salt-1')).not.toBe(a);
  });
});

describe('usage statistics: the Worker', () => {
  it('stores a visit with place and families, never the address or the User-Agent', async () => {
    const w = world();
    const res = await handle(collect(first), w.env, w.deps());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://aiprescreen.fyi');
    const row = w.sql.prepare('SELECT * FROM visits').get()!;
    expect(row).toMatchObject({
      id: VISIT,
      day: '2026-11-08',
      country: 'AT',
      region: 'Tyrol',
      city: 'Innsbruck',
      as_org: 'Universitaet Innsbruck',
      suspect: 0,
      device: 'desktop',
      browser: 'Safari',
      os: 'macOS',
      lang: 'de-AT',
      ref_host: 'news.ycombinator.com',
      utm_source: 'newsletter',
      theme: 'dark',
      touch: 0,
      scroll_max: 40,
    });
    const dump = JSON.stringify(['visits', 'events', 'budgets'].map((t) => w.sql.prepare(`SELECT * FROM ${t}`).all()));
    expect(dump).not.toContain(IP);
    expect(dump).not.toContain('203.0.113');
    expect(dump).not.toContain('Macintosh');
  });

  it('adds later events and engagement to the visit; ignores unknown and old visits', async () => {
    const w = world();
    await handle(collect(first), w.env, w.deps());
    const later = { visit: VISIT, events: [{ name: 'input', value: 'paste', t: 2000 }, { name: 'popover', value: 'en.lexical.delve', t: 4000 }], active: 30, scroll: 20 };
    await handle(collect(later), w.env, w.deps('2026-11-08T12:00:30Z'));
    expect(w.sql.prepare('SELECT active_s, scroll_max, last_seen FROM visits').get()).toEqual({
      active_s: 30,
      scroll_max: 40, // the deepest so far
      last_seen: Date.parse('2026-11-08T12:00:00Z'), // whole minutes
    });
    expect(w.sql.prepare('SELECT name, value, t_ms FROM events ORDER BY t_ms').all()).toEqual([
      { name: 'input', value: 'paste', t_ms: 2000 },
      { name: 'popover', value: 'en.lexical.delve', t_ms: 4000 },
    ]);
    // A visit that never sent its view, and one older than two days: nothing changes.
    await handle(collect({ ...later, visit: OTHER }), w.env, w.deps());
    await handle(collect(later), w.env, w.deps('2026-11-11T12:00:00Z'));
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 2 });
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM visits').get()).toEqual({ n: 1 });
    // The same view twice keeps the first.
    await handle(collect({ ...first, view: { ...view, ref: 'example.com' } }), w.env, w.deps());
    expect(w.sql.prepare('SELECT ref_host FROM visits').get()).toEqual({ ref_host: 'news.ycombinator.com' });
  });

  it('creates the visit from a later request when the first one was lost', async () => {
    const w = world();
    await handle(collect({ ...first, visit: OTHER, events: [{ name: 'example', value: '', t: 7000 }] }), w.env, w.deps('2026-11-08T12:03:41Z'));
    expect(w.sql.prepare('SELECT id, started_at FROM visits').get()).toEqual({ id: OTHER, started_at: Date.parse('2026-11-08T12:03:00Z') });
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 1 });
  });

  it('drops bots quietly, marks hosting networks, and needs the page origin', async () => {
    const w = world();
    expect((await handle(collect(first, { ua: 'curl/8.0' }), w.env, w.deps())).status).toBe(204);
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM visits').get()).toEqual({ n: 0 });
    expect((await handle(collect(first, { origin: null }), w.env, w.deps())).status).toBe(403);
    expect((await handle(collect(first, { origin: 'https://evil.example' }), w.env, w.deps())).status).toBe(403);
    expect((await handle(collect({ ...first, visit: 'x' }), w.env, w.deps())).status).toBe(400);
    await handle(collect(first, { cf: { country: 'US', asOrganization: 'Amazon.com, Inc.' } }), w.env, w.deps());
    expect(w.sql.prepare('SELECT suspect FROM visits').get()).toEqual({ suspect: 1 });
  });

  it("stays within the day's write budget", async () => {
    const w = world({ ANALYTICS_ROWS_PER_DAY: '10' });
    await handle(collect(first), w.env, w.deps()); // visit 4 + update 1 + the budget row 1: 6
    const events = [1, 2, 3].map((t) => ({ name: 'key', value: '', t }));
    await handle(collect({ visit: VISIT, events, active: 1, scroll: 0 }), w.env, w.deps()); // 6 + (1 + 3 × 2 + 1): over
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 0 });
    await handle(collect({ visit: VISIT, events: events.slice(0, 1), active: 1, scroll: 0 }), w.env, w.deps()); // 6 + (1 + 2 + 1): fits
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 1 });
  });
});

describe('usage statistics: the dashboard API', () => {
  async function seed(w: ReturnType<typeof world>) {
    await handle(collect(first), w.env, w.deps());
    await handle(
      collect({
        visit: VISIT,
        events: [
          { name: 'input', value: 'paste', t: 1000 },
          { name: 'analysis', value: '200-999|0|2-5|0', t: 6000 },
          { name: 'popover', value: 'en.lexical.delve', t: 9000 },
        ],
        active: 95,
        scroll: 80,
      }),
      w.env,
      w.deps('2026-11-08T12:01:00Z'),
    );
    const mobile = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    await handle(
      collect({ ...first, visit: OTHER, view: { ...view, ref: '' } }, { ua: mobile, ip: '198.51.100.2', cf: { country: 'CN', city: 'Beijing' } }),
      w.env,
      w.deps('2026-11-07T09:00:00Z'),
    );
  }

  it('needs the token', async () => {
    const w = world();
    expect((await handle(statsRequest('', null), w.env, w.deps())).status).toBe(401);
    expect((await handle(statsRequest('', 'wrong'), w.env, w.deps())).status).toBe(401);
    const unset = world({ STATS_TOKEN: undefined });
    expect((await handle(statsRequest('', ''), unset.env, unset.deps())).status).toBe(401);
    const res = await handle(statsRequest(), w.env, w.deps());
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('sums up visits, funnel, breakdowns and filters', async () => {
    const w = world();
    await seed(w);
    const get = async (q: string) => (await (await handle(statsRequest(q), w.env, w.deps('2026-11-08T12:05:00Z'))).json()) as StatsResponse;
    const week = await get('?from=2026-11-02&to=2026-11-08');
    expect(week.totals).toMatchObject({ visits: 2, visitors: 2, used: 1, medianFirstAnalysisS: 6, analysesPerAnalysingVisit: 1 });
    expect(week.days.at(-1)).toEqual({ day: '2026-11-08', visits: 1, visitors: 1, used: 1 });
    expect(week.days).toHaveLength(7);
    expect(week.live.visits).toBe(1);
    expect(week.funnel.map((f) => f.visits)).toEqual([2, 1, 1, 1, 0]);
    expect(week.hours.reduce((n, h) => n + h.visits, 0)).toBe(2); // both within 48 hours
    expect(week.dims.ref_host).toEqual([
      { value: '', visits: 1, visitors: 1 },
      { value: 'news.ycombinator.com', visits: 1, visitors: 1 },
    ]);
    expect(week.dims.city[0]).toEqual({ value: 'Beijing', visits: 1, visitors: 1, label: 'Beijing, CN' });
    expect(week.analysis.lexical.find((b) => b.value === '2-5')?.count).toBe(1);
    expect(week.entries.popover).toEqual([{ value: 'en.lexical.delve', count: 1 }]);
    expect(week.events.input?.find((e) => e.value === 'paste')).toEqual({ value: 'paste', count: 1, visits: 1 });

    const china = await get('?from=2026-11-02&to=2026-11-08&f=country:CN');
    expect(china.totals.visits).toBe(1);
    expect(china.dims.device).toEqual([{ value: 'mobile', visits: 1, visitors: 1 }]);
    const direct = await get('?from=2026-11-02&to=2026-11-08&f=ref_host:');
    expect(direct.totals.visits).toBe(1);
  });

  it('leaves out hosting networks unless asked', async () => {
    const w = world();
    await handle(collect(first, { cf: { asOrganization: 'DigitalOcean, LLC' } }), w.env, w.deps());
    const get = async (q: string) => (await (await handle(statsRequest(q), w.env, w.deps())).json()) as StatsResponse;
    expect((await get('')).totals).toMatchObject({ visits: 0, suspectLeftOut: 1 });
    expect((await get('?suspect=1')).totals.visits).toBe(1);
  });

  it('checks the query, and stops reading once the day’s read budget is spent', async () => {
    const today = '2026-11-08';
    const q = (s: string) => parseStatsQuery(new URL(`https://x/v1/stats${s}`), today);
    expect(q('')).toEqual({ from: today, to: today, filters: [], suspect: false });
    expect(q('?f=visitor:abc')).toBeNull();
    expect(q('?f=country')).toBeNull();
    expect(q('?from=2026-11-09&to=2026-11-08')).toBeNull();
    expect(q('?from=2024-01-01&to=2026-11-08')).toBeNull();
    expect(q("?from=2026-11-01'--")).toBeNull();

    const w = world({ STATS_ROWS_READ_PER_DAY: '1' });
    await seed(w);
    expect((await handle(statsRequest(), w.env, w.deps())).status).toBe(200);
    expect((await handle(statsRequest(), w.env, w.deps())).status).toBe(503);
  });

  it('serves the dashboard page with a strict policy', async () => {
    const w = world();
    const res = await handle(new Request('https://api.aiprescreen.fyi/dashboard'), w.env, w.deps());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(await res.text()).toContain('/dashboard.js');
    const js = await (await handle(new Request('https://api.aiprescreen.fyi/dashboard.js'), w.env, w.deps())).text();
    expect(js).not.toMatch(/import type|: StatsResponse/);
    expect(js).toContain('/v1/stats');
  });
});

describe('usage statistics: the daily cron', () => {
  it('writes daily totals and deletes visits after 400 days', async () => {
    const w = world();
    await handle(collect(first), w.env, w.deps('2026-11-07T10:00:00Z'));
    await handle(collect({ visit: VISIT, events: [{ name: 'example', value: '', t: 500 }], active: 5, scroll: 10 }), w.env, w.deps('2026-11-07T10:00:05Z'));
    await daily(w.env.DB, '2026-11-08');
    const rows = w.sql.prepare("SELECT metric, value, count FROM daily WHERE day = '2026-11-07' ORDER BY metric, value").all();
    expect(rows).toEqual(
      expect.arrayContaining([
        { metric: 'visits', value: '', count: 1 },
        { metric: 'visitors', value: '', count: 1 },
        { metric: 'used', value: '', count: 1 },
        { metric: 'country', value: 'AT', count: 1 },
        { metric: 'event:example', value: '', count: 1 },
      ]),
    );
    // Twice is the same as once.
    await daily(w.env.DB, '2026-11-08');
    expect(w.sql.prepare("SELECT COUNT(*) AS n FROM daily WHERE day = '2026-11-07'").get()).toEqual({ n: rows.length });
    await daily(w.env.DB, '2027-12-13');
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM visits').get()).toEqual({ n: 0 });
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 0 });
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM daily').get()).not.toEqual({ n: 0 });
  });
});
