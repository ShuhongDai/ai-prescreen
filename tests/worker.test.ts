import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { toReport } from '../scripts/triage-lib.ts';
import { FORMS, HITS_MAX_IDS } from '../web/src/report-contract.ts';
import { parseHits } from '../worker/src/hits.ts';
import { BODY_MAX, handle, type Deps } from '../worker/src/index.ts';
import { clientPrefix, resetSaltCache } from '../worker/src/limits.ts';
import { issueFor, parseReport, TITLE_MAX, type ValidReport } from '../worker/src/reports.ts';
import { cleanText, codeBlock, codeSpan, titleText } from '../worker/src/text.ts';
import { SITEVERIFY_URL } from '../worker/src/turnstile.ts';
import type { Env } from '../worker/src/types.ts';
import { d1, limiter } from './worker-fakes.ts';

const KNOWN = new Set(['en.lexical.delve', 'en.artifact.certainly-here-is', 'en.stylistic.not-only-but-also']);

interface FakeWorld {
  env: Env & {
    REPORT_LIMIT: ReturnType<typeof limiter>;
    HITS_LIMIT: ReturnType<typeof limiter>;
    COLLECT_LIMIT: ReturnType<typeof limiter>;
    STATS_LIMIT: ReturnType<typeof limiter>;
  };
  sql: DatabaseSync;
  calls: { url: string; body: Record<string, unknown> }[];
  deps: (day?: string, known?: ReadonlySet<string>) => Deps;
}

function world(
  options: {
    human?: boolean;
    hostname?: string;
    action?: string;
    github?: number;
    /** Labels GitHub keeps on a new issue (default: all it was given). */
    keptLabels?: string[];
    env?: Partial<Omit<Env, 'DB' | 'REPORT_LIMIT' | 'HITS_LIMIT' | 'COLLECT_LIMIT' | 'STATS_LIMIT'>>;
  } = {},
): FakeWorld {
  const { db, sql } = d1();
  const calls: FakeWorld['calls'] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    if (url === SITEVERIFY_URL) {
      return Response.json({ success: options.human ?? true, hostname: options.hostname ?? 'aiprescreen.fyi', action: options.action ?? 'report' });
    }
    if (url === 'https://api.github.com/repos/ShuhongDai/ai-prescreen/issues') {
      if (options.github) return new Response('{}', { status: options.github });
      const given = (calls.at(-1)!.body.labels as string[]) ?? [];
      const labels = (options.keptLabels ?? given).map((name) => ({ name }));
      return Response.json({ number: 42, html_url: 'https://github.com/ShuhongDai/ai-prescreen/issues/42', labels }, { status: 201 });
    }
    if (url === 'https://api.github.com/repos/ShuhongDai/ai-prescreen/issues/42/labels') return Response.json([], { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  const env = {
    DB: db,
    REPORT_LIMIT: limiter(5),
    HITS_LIMIT: limiter(20),
    COLLECT_LIMIT: limiter(30),
    STATS_LIMIT: limiter(20),
    GITHUB_TOKEN: 'github_pat_test',
    TURNSTILE_SECRET: 'turnstile-secret',
    GITHUB_REPO: 'ShuhongDai/ai-prescreen',
    ALLOWED_ORIGINS: 'https://aiprescreen.fyi',
    TURNSTILE_HOSTNAMES: 'aiprescreen.fyi',
    REPORTS_PER_DAY: '30',
    HITS_ROWS_PER_DAY: '20000',
    ANALYTICS_ROWS_PER_DAY: '30000',
    STATS_ROWS_READ_PER_DAY: '1500000',
    STATS_TOKEN: 'stats-token',
    ...options.env,
  };
  return {
    env,
    sql,
    calls,
    deps: (day = '2026-11-02', known = KNOWN) => ({ now: new Date(`${day}T12:00:00Z`), fetch: fakeFetch, knownIds: known }),
  };
}

const IP = '203.0.113.7';

function request(
  path: string,
  init: { method?: string; body?: unknown; origin?: string | null; type?: string; ip?: string } = {},
): Request {
  const headers: Record<string, string> = { 'CF-Connecting-IP': init.ip ?? IP, 'Content-Type': init.type ?? 'application/json' };
  if (init.origin !== null) headers.Origin = init.origin ?? 'https://aiprescreen.fyi';
  const body = init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  return new Request(`https://api.aiprescreen.fyi${path}`, { method: init.method ?? 'POST', headers, body });
}

const phrase = { kind: 'new-phrase', phrase: 'delve into', tier: 'overused word', example: '', model: '', token: 'tok' };
const falsePositive = { kind: 'false-positive', entryId: 'en.lexical.delve', matchedText: 'delve', token: 'tok' };

beforeEach(() => resetSaltCache());

describe('text for issues', () => {
  it('cleans text: NFC, no control characters, whitespace, length', () => {
    expect(cleanText('  A\u0000b\u202Ec\r\nd\t e ', 20)).toBe('Abc d e');
    expect(cleanText('line 1  \r\n\r\n\r\n\r\nline\t2', 40, true)).toBe('line 1\n\nline 2');
    expect(cleanText('café', 4)).toBe('café');
    expect(cleanText('x'.repeat(11), 10)).toBeNull();
    expect(cleanText(42, 10)).toBeNull();
  });

  it('fences code with more backticks than the text has', () => {
    expect(codeSpan('delve')).toBe('`delve`');
    expect(codeSpan('a `b` c')).toBe('``a `b` c``');
    expect(codeSpan('`edge')).toBe('`` `edge ``');
    expect(codeBlock('one\n```\ntwo')).toBe('````text\none\n```\ntwo\n````');
  });

  it('keeps @ and # in titles from reading as mentions or references', () => {
    expect(titleText('ask @octocat about #12', 80)).toBe('ask @\u2060octocat about #\u206012');
    expect(Array.from(titleText('x'.repeat(100), TITLE_MAX))).toHaveLength(TITLE_MAX);
  });
});

describe('report validation', () => {
  it('accepts a new phrase and a false positive', () => {
    expect(parseReport(phrase, KNOWN)?.report).toEqual({ kind: 'new-phrase', phrase: 'delve into', tier: 'overused word', example: '', model: '' });
    expect(parseReport({ ...falsePositive, comment: 'fine here' }, KNOWN)?.report).toEqual({
      kind: 'false-positive',
      entryId: 'en.lexical.delve',
      matchedText: 'delve',
      example: '',
      comment: 'fine here',
    });
  });

  it('rejects missing tokens, unknown kinds and tiers, unknown entries and long fields', () => {
    expect(parseReport({ ...phrase, token: '' }, KNOWN)).toBeNull();
    expect(parseReport({ ...phrase, kind: 'other' }, KNOWN)).toBeNull();
    expect(parseReport({ ...phrase, tier: 'lexical' }, KNOWN)).toBeNull();
    expect(parseReport({ ...phrase, phrase: '   ' }, KNOWN)).toBeNull();
    expect(parseReport({ ...phrase, phrase: 'x'.repeat(301) }, KNOWN)).toBeNull();
    expect(parseReport({ ...falsePositive, entryId: 'en.lexical.unknown' }, KNOWN)).toBeNull();
    expect(parseReport({ ...falsePositive, entryId: 'en.lexical.DELVE' }, KNOWN)).toBeNull();
    expect(parseReport({ ...falsePositive, comment: 7 }, KNOWN)).toBeNull();
    expect(parseReport([phrase], KNOWN)).toBeNull();
  });
});

describe('issues from the page read like the issue forms (npm run triage)', () => {
  const asIssue = (report: ValidReport) => {
    const draft = issueFor(report);
    return { draft, parsed: toReport({ number: 7, title: draft.title, body: draft.body, url: 'u', labels: draft.labels }) };
  };

  it('round-trips a new phrase, with markdown, mentions and backticks kept as text', () => {
    const report: ValidReport = {
      kind: 'new-phrase',
      phrase: 'delve into `code` @octocat',
      tier: 'artifact (chatbot leftover)',
      example: 'See #12 and [a link](https://example.com)\n```\n![img](x)',
      model: 'GPT-4o',
    };
    const { draft, parsed } = asIssue(report);
    expect(draft.labels).toEqual([...FORMS['new-phrase'].labels]);
    expect(draft.title).toBe('AI-like phrase: delve into `code` @\u2060octocat');
    expect(parsed).toMatchObject({ kind: 'new-phrase', phrase: report.phrase, tier: 'artifact', example: report.example, model: 'GPT-4o' });
    // Reported text only inside code: no mention, link or image outside it.
    const outside = draft.body.replace(/(`+)[\s\S]*?\1/g, '');
    expect(outside).not.toMatch(/@octocat|#12|\]\(|!\[/);
  });

  it('round-trips a false positive and writes "_No response_" for empty fields', () => {
    const report: ValidReport = { kind: 'false-positive', entryId: 'en.lexical.delve', matchedText: 'delves', example: '', comment: 'Ordinary\nword.' };
    const { draft, parsed } = asIssue(report);
    expect(draft.title).toBe('False positive: en.lexical.delve');
    expect(draft.body).toContain('### Example sentence\n\n_No response_');
    expect(parsed).toMatchObject({ kind: 'false-positive', entryId: 'en.lexical.delve', matchedText: 'delves', example: '', comment: 'Ordinary\nword.' });
  });
});

describe('hit-count validation', () => {
  it('keeps known IDs once and drops unknown ones', () => {
    expect(parseHits({ ids: ['en.lexical.delve', 'en.lexical.delve', 'en.lexical.nope'] }, KNOWN)).toEqual(['en.lexical.delve']);
    expect(parseHits({ ids: [] }, KNOWN)).toEqual([]);
  });

  it('rejects malformed requests and too many IDs', () => {
    expect(parseHits({ ids: 'en.lexical.delve' }, KNOWN)).toBeNull();
    expect(parseHits({ ids: [1] }, KNOWN)).toBeNull();
    expect(parseHits(null, KNOWN)).toBeNull();
    expect(parseHits({ ids: Array(HITS_MAX_IDS + 1).fill('en.lexical.delve') }, KNOWN)).toBeNull();
  });
});

describe('the Worker', () => {
  it('answers CORS preflights for the page only', async () => {
    const w = world();
    const ok = await handle(request('/v1/report', { method: 'OPTIONS' }), w.env, w.deps());
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://aiprescreen.fyi');
    expect(ok.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    const other = await handle(request('/v1/report', { method: 'OPTIONS', origin: 'https://evil.example' }), w.env, w.deps());
    expect(other.status).toBe(403);
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('refuses requests from other origins or without one', async () => {
    const w = world();
    for (const origin of ['https://evil.example', null]) {
      const res = await handle(request('/v1/hits', { body: { ids: ['en.lexical.delve'] }, origin }), w.env, w.deps());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: 'origin' });
    }
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM hits').get()).toEqual({ n: 0 });
  });

  it('counts hits per entry per day, also from a text/plain beacon', async () => {
    const w = world();
    const send = (ids: string[], day?: string) =>
      handle(request('/v1/hits', { body: { ids }, type: 'text/plain;charset=UTF-8' }), w.env, w.deps(day));
    expect((await send(['en.lexical.delve', 'en.artifact.certainly-here-is', 'en.lexical.nope'])).status).toBe(204);
    expect((await send(['en.lexical.delve'])).status).toBe(204);
    expect((await send(['en.lexical.delve'], '2026-11-03')).status).toBe(204);
    expect(w.sql.prepare('SELECT day, entry_id, count FROM hits ORDER BY day, entry_id').all()).toEqual([
      { day: '2026-11-02', entry_id: 'en.artifact.certainly-here-is', count: 1 },
      { day: '2026-11-02', entry_id: 'en.lexical.delve', count: 2 },
      { day: '2026-11-03', entry_id: 'en.lexical.delve', count: 1 },
    ]);
  });

  it('rate-limits by a salted hash that is not the IP, changes daily and is not stored', async () => {
    const w = world();
    const send = (day?: string) => handle(request('/v1/hits', { body: { ids: ['en.lexical.delve'] } }), w.env, w.deps(day));
    for (let i = 0; i < 20; i++) expect((await send()).status).toBe(204);
    expect((await send()).status).toBe(429);
    const [today] = w.env.HITS_LIMIT.keys;
    expect(today).toMatch(/^[0-9a-f]{32}$/);
    expect(today).not.toContain(IP);
    resetSaltCache();
    expect((await send('2026-11-03')).status).toBe(204);
    expect(w.env.HITS_LIMIT.keys.at(-1)).not.toBe(today);
    // One salt left (the new day's), and no table holds the IP or the key.
    expect(w.sql.prepare('SELECT day FROM salts').all()).toEqual([{ day: '2026-11-03' }]);
    const dump = JSON.stringify(['hits', 'reports', 'salts'].map((t) => w.sql.prepare(`SELECT * FROM ${t}`).all()));
    expect(dump).not.toContain(IP);
    expect(dump).not.toContain(today!);
  });

  it('rejects malformed and oversized bodies', async () => {
    const w = world();
    expect((await handle(request('/v1/hits', { body: '{"ids":' }), w.env, w.deps())).status).toBe(400);
    expect((await handle(request('/v1/hits', { body: { ids: 'x' } }), w.env, w.deps())).status).toBe(400);
    const big = JSON.stringify({ ...phrase, example: 'x'.repeat(BODY_MAX.report) });
    expect((await handle(request('/v1/report', { body: big }), w.env, w.deps())).status).toBe(400);
  });

  it('files a checked report as a GitHub issue and counts it', async () => {
    const w = world();
    const res = await handle(request('/v1/report', { body: falsePositive }), w.env, w.deps());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, issue: { number: 42, url: 'https://github.com/ShuhongDai/ai-prescreen/issues/42' } });
    const [verify, github] = w.calls;
    expect(verify).toMatchObject({ url: SITEVERIFY_URL, body: { secret: 'turnstile-secret', response: 'tok', remoteip: IP } });
    expect(github?.body).toMatchObject({ title: 'False positive: en.lexical.delve', labels: ['report', 'report:false-positive'] });
    expect(w.sql.prepare('SELECT kind, entry_id, count FROM reports').all()).toEqual([
      { kind: 'false-positive', entry_id: 'en.lexical.delve', count: 1 },
    ]);
  });

  it('checks the report before Turnstile, and Turnstile before GitHub', async () => {
    const invalid = world();
    expect((await handle(request('/v1/report', { body: { ...phrase, tier: 'x' } }), invalid.env, invalid.deps())).status).toBe(400);
    expect(invalid.calls).toEqual([]);

    for (const options of [{ human: false }, { hostname: 'example.com' }, { action: 'other' }]) {
      const w = world(options);
      const res = await handle(request('/v1/report', { body: phrase }), w.env, w.deps());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: 'challenge' });
      expect(w.calls.map((c) => c.url)).toEqual([SITEVERIFY_URL]);
    }
  });

  it('limits reports per client and per day, and stays closed when unconfigured or GitHub fails', async () => {
    const w = world();
    for (let i = 0; i < 5; i++) expect((await handle(request('/v1/report', { body: phrase }), w.env, w.deps())).status).toBe(201);
    expect((await handle(request('/v1/report', { body: phrase }), w.env, w.deps())).status).toBe(429);

    const capped = world({ env: { REPORTS_PER_DAY: '1' } });
    expect((await handle(request('/v1/report', { body: phrase }), capped.env, capped.deps())).status).toBe(201);
    capped.env.REPORT_LIMIT = limiter(5); // a different client
    expect((await handle(request('/v1/report', { body: phrase }), capped.env, capped.deps())).status).toBe(503);

    const unconfigured = world({ env: { GITHUB_TOKEN: undefined } });
    expect((await handle(request('/v1/report', { body: phrase }), unconfigured.env, unconfigured.deps())).status).toBe(503);
    expect(unconfigured.calls).toEqual([]);

    const down = world({ github: 500 });
    const res = await handle(request('/v1/report', { body: phrase }), down.env, down.deps());
    expect(res.status).toBe(503);
    expect(down.sql.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM reports').get()).toEqual({ n: 0 });
  });

  it('only prints the issue in a dry run', async () => {
    const w = world({ env: { GITHUB_DRY_RUN: '1', GITHUB_TOKEN: undefined } });
    const res = await handle(request('/v1/report', { body: phrase }), w.env, w.deps());
    expect(res.status).toBe(201);
    expect(w.calls.map((c) => c.url)).toEqual([SITEVERIFY_URL]);
  });

  it('says whether reports are configured, and nothing else', async () => {
    const w = world();
    const res = await handle(request('/v1/health', { method: 'GET' }), w.env, w.deps());
    expect(await res.json()).toEqual({ ok: true, reports: true });
    expect((await handle(request('/v1/other'), w.env, w.deps())).status).toBe(404);
    expect((await handle(request('/v1/report', { method: 'GET' }), w.env, w.deps())).status).toBe(405);
  });
});

describe('hardening (security review)', () => {
  it('keys IPv4 clients by address and IPv6 clients by their /64', async () => {
    expect(clientPrefix('203.0.113.7')).toBe('203.0.113.7');
    expect(clientPrefix('2001:db8:1:2::1')).toBe('2001:0db8:0001:0002::/64');
    expect(clientPrefix('2001:DB8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:0db8:0001:0002::/64');
    expect(clientPrefix('::1')).toBe('0000:0000:0000:0000::/64');
    expect(clientPrefix('::ffff:198.51.100.4')).toBe('198.51.100.4');
    const w = world();
    for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2::99', '2001:db8:1:3::1']) {
      await handle(request('/v1/hits', { body: { ids: ['en.lexical.delve'] }, ip }), w.env, w.deps());
    }
    const [a, b, c] = w.env.HITS_LIMIT.keys;
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('drops hit counts quietly once the day\'s write budget (hit rows + the budget row) is used', async () => {
    const w = world({ env: { HITS_ROWS_PER_DAY: '5' } });
    const send = (ids: string[]) => handle(request('/v1/hits', { body: { ids } }), w.env, w.deps());
    expect((await send(['en.lexical.delve', 'en.artifact.certainly-here-is'])).status).toBe(204); // 3 rows
    expect((await send(['en.lexical.delve', 'en.stylistic.not-only-but-also'])).status).toBe(204); // 6 > 5: dropped
    expect((await send(['en.lexical.delve'])).status).toBe(204); // 5: still fits
    expect(w.sql.prepare('SELECT SUM(count) AS n FROM hits').get()).toEqual({ n: 3 });
    expect(w.sql.prepare('SELECT used FROM budgets').get()).toEqual({ used: 5 });
  });

  it('writes up to 100 IDs as at most two multi-row statements', async () => {
    const ids = Array.from({ length: HITS_MAX_IDS }, (_, i) => `en.lexical.entry-${i}`);
    const w = world();
    const sizes: number[] = [];
    const batch = w.env.DB.batch.bind(w.env.DB);
    w.env.DB = { prepare: w.env.DB.prepare.bind(w.env.DB), batch: (s) => (sizes.push(s.length), batch(s)) };
    const res = await handle(request('/v1/hits', { body: { ids } }), w.env, w.deps(undefined, new Set(ids)));
    expect(res.status).toBe(204);
    expect(sizes.at(-1)).toBe(2);
    expect(w.sql.prepare('SELECT COUNT(*) AS n, SUM(count) AS c FROM hits').get()).toEqual({ n: HITS_MAX_IDS, c: HITS_MAX_IDS });
  });

  it('fails closed when a cap is missing or not a whole number', async () => {
    for (const REPORTS_PER_DAY of ['', '50/day', '-1']) {
      const w = world({ env: { REPORTS_PER_DAY } });
      expect((await handle(request('/v1/report', { body: phrase }), w.env, w.deps())).status).toBe(503);
      expect(w.calls).toEqual([]);
    }
    const w = world({ env: { HITS_ROWS_PER_DAY: 'lots' } });
    expect((await handle(request('/v1/hits', { body: { ids: ['en.lexical.delve'] } }), w.env, w.deps())).status).toBe(204);
    expect(w.sql.prepare('SELECT COUNT(*) AS n FROM hits').get()).toEqual({ n: 0 });
  });

  it('caps each report kind on its own, and concurrent reports cannot overshoot', async () => {
    const w = world({ env: { REPORTS_PER_DAY: '2' } });
    w.env.REPORT_LIMIT = limiter(100);
    const burst = await Promise.all(Array.from({ length: 6 }, () => handle(request('/v1/report', { body: phrase }), w.env, w.deps())));
    expect(burst.map((r) => r.status).sort()).toEqual([201, 201, 503, 503, 503, 503]);
    expect((await handle(request('/v1/report', { body: falsePositive }), w.env, w.deps())).status).toBe(201);
    expect(w.calls.filter((c) => c.url.startsWith('https://api.github.com/'))).toHaveLength(3);
  });

  it('gives the reserved slot back when GitHub fails', async () => {
    const w = world({ github: 502, env: { REPORTS_PER_DAY: '1' } });
    expect((await handle(request('/v1/report', { body: phrase }), w.env, w.deps())).status).toBe(503);
    expect(w.sql.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM reports').get()).toEqual({ n: 0 });
  });

  it('reads no more than the size limit, also without a Content-Length, and only UTF-8', async () => {
    const w = world();
    const big = new TextEncoder().encode(JSON.stringify({ ids: [], pad: '中'.repeat(30_000) })); // ~90 KB
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= big.length) return controller.close();
        controller.enqueue(big.slice(pulled, pulled + 4096));
        pulled += 4096;
      },
    });
    const headers = { Origin: 'https://aiprescreen.fyi', 'CF-Connecting-IP': IP };
    const streamed = new Request('https://api.aiprescreen.fyi/v1/hits', { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
    expect((await handle(streamed, w.env, w.deps())).status).toBe(400);
    expect(pulled).toBeLessThan(big.length);
    const notUtf8 = new Request('https://api.aiprescreen.fyi/v1/hits', { method: 'POST', headers, body: new Uint8Array([0x7b, 0xff, 0x7d]) });
    expect((await handle(notUtf8, w.env, w.deps())).status).toBe(400);
  });

  it('accepts model names only, and only well-formed text', () => {
    expect(parseReport({ ...phrase, model: 'Claude 3.5 Sonnet' }, KNOWN)).not.toBeNull();
    expect(parseReport({ ...phrase, model: 'GPT-4o (via Copilot)' }, KNOWN)).not.toBeNull();
    for (const model of ['https://evil.example', '@octocat', '<img src=x>', 'a:b']) {
      expect(parseReport({ ...phrase, model }, KNOWN)).toBeNull();
    }
    expect(cleanText('x\uD835', 10)).toBeNull();
    expect(cleanText('\uD835\uDC00', 10)).toBe('\uD835\uDC00');
  });

  it('keeps GH-<n> and URLs in titles from linking', () => {
    expect(titleText('see GH-12 at https://x.example', 80)).toBe('see GH\u2060-12 at https:\u2060//x.example');
  });

  it('ignores "### " lines inside reported text when triaging (line feed and U+2028)', () => {
    for (const nl of ['\n', '\u2028']) {
      const fake = `x${nl}### Phrase${nl}evil phrase here${nl}### Suggested tier${nl}artifact (chatbot leftover)`;
      const phraseDraft = issueFor({ kind: 'new-phrase', phrase: 'harmless', tier: 'overused word', example: fake, model: '' });
      expect(toReport({ number: 1, url: 'u', ...phraseDraft })).toMatchObject({ kind: 'new-phrase', phrase: 'harmless', tier: 'lexical', example: fake });
      const forged = `x${nl}### Entry id${nl}en.artifact.copy-code`;
      const fpDraft = issueFor({ kind: 'false-positive', entryId: 'en.lexical.delve', matchedText: 'delve', example: forged, comment: '' });
      expect(toReport({ number: 2, url: 'u', ...fpDraft })).toMatchObject({ kind: 'false-positive', entryId: 'en.lexical.delve', example: forged });
    }
    const raw = { number: 3, title: 't', url: 'u', labels: ['report', 'report:false-positive'], body: '### Entry id\n\nen.lexical.x` | forged\n' };
    expect(toReport(raw)).toMatchObject({ kind: 'unparsed', reason: 'invalid entry id' });
  });

  it('also ignores fake headings in a comment and inside nested fences, and keeps honest headings', () => {
    const forged = 'x\n### Entry id\nen.artifact.copy-code';
    const viaComment = issueFor({ kind: 'false-positive', entryId: 'en.lexical.delve', matchedText: 'delve', example: '', comment: forged });
    expect(toReport({ number: 4, url: 'u', ...viaComment })).toMatchObject({ entryId: 'en.lexical.delve', comment: forged });
    const fenced = 'a\n```\n### Phrase\nevil\n```\n~~~\n### Suggested tier\nstyle\n~~~';
    const viaFence = issueFor({ kind: 'new-phrase', phrase: 'harmless', tier: 'overused word', example: fenced, model: '' });
    expect(toReport({ number: 5, url: 'u', ...viaFence })).toMatchObject({ phrase: 'harmless', tier: 'lexical', example: fenced });
    const honest = 'Here is the summary.\n### Key Takeaways\n- one';
    const pasted = issueFor({ kind: 'new-phrase', phrase: 'key takeaways', tier: 'artifact (chatbot leftover)', example: honest, model: 'GPT-4o' });
    expect(toReport({ number: 6, url: 'u', ...pasted })).toMatchObject({ phrase: 'key takeaways', example: honest, model: 'GPT-4o' });
  });
});

describe('labels on Worker-filed issues', () => {
  it('adds the labels GitHub dropped, so triage finds the report', async () => {
    const w = world({ keptLabels: [] });
    expect((await handle(request('/v1/report', { body: falsePositive }), w.env, w.deps())).status).toBe(201);
    const add = w.calls.find((c) => c.url.endsWith('/issues/42/labels'));
    expect(add?.body).toEqual({ labels: ['report', 'report:false-positive'] });
  });

  it('makes no extra call when GitHub kept them', async () => {
    const w = world();
    expect((await handle(request('/v1/report', { body: phrase }), w.env, w.deps())).status).toBe(201);
    expect(w.calls.some((c) => c.url.endsWith('/labels'))).toBe(false);
  });
});
