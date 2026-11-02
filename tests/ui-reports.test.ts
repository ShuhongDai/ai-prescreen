import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_PATHS, HITS_MAX_IDS } from '../web/src/report-contract.ts';
import { API_BASE, sendHits, sendReport } from '../web/src/ui/api.ts';
import { createHitTracker, HIT_DELAY_MS } from '../web/src/ui/hits.ts';
import { HIT_COUNTS_KEY, loadHitCounts, saveHitCounts, type StorageLike } from '../web/src/ui/prefs.ts';
import { buildRequest, errorText, githubUrl, type ReportFields } from '../web/src/ui/report-form.ts';

describe('hit counts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends once an analysis has settled, not while the reader keeps typing', () => {
    const send = vi.fn();
    const hits = createHitTracker(send, true);
    hits.analysed(['en.lexical.delve']);
    vi.advanceTimersByTime(HIT_DELAY_MS - 1);
    hits.analysed(['en.lexical.delve', 'en.lexical.pivotal']);
    vi.advanceTimersByTime(HIT_DELAY_MS - 1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(['en.lexical.delve', 'en.lexical.pivotal']);
  });

  it('counts each entry at most once per page view', () => {
    const send = vi.fn();
    const hits = createHitTracker(send, true);
    hits.analysed(['a', 'a', 'b']);
    vi.runAllTimers();
    hits.analysed(['a', 'b']);
    vi.runAllTimers();
    hits.analysed(['b', 'c']);
    vi.runAllTimers();
    expect(send.mock.calls).toEqual([[['a', 'b']], [['c']]]);
  });

  it('sends nothing for no draft or the example, or while switched off', () => {
    const send = vi.fn();
    const hits = createHitTracker(send, false);
    hits.analysed(['a']);
    vi.runAllTimers();
    hits.setEnabled(true);
    hits.analysed([]);
    vi.runAllTimers();
    hits.analysed(['a']);
    hits.setEnabled(false); // switched off while waiting: dropped
    vi.runAllTimers();
    expect(send).not.toHaveBeenCalled();
  });

  it('never sends an analysis made while switched off, also after switching on', () => {
    const send = vi.fn();
    const hits = createHitTracker(send, false);
    hits.analysed(['a']);
    hits.setEnabled(true);
    hits.flush();
    vi.runAllTimers();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends what is waiting at once when the page is hidden, at most HITS_MAX_IDS', () => {
    const send = vi.fn();
    const hits = createHitTracker(send, true);
    const many = Array.from({ length: HITS_MAX_IDS + 5 }, (_, i) => `id-${i}`);
    hits.analysed(many);
    hits.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toHaveLength(HITS_MAX_IDS);
    vi.runAllTimers();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('the hit-count preference', () => {
  const store = (initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
    const data = { ...initial };
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  };

  it('is on by default, off with Global Privacy Control, and the reader\'s choice wins', () => {
    expect(loadHitCounts(() => store(), false)).toBe(true);
    expect(loadHitCounts(() => store(), true)).toBe(false);
    expect(loadHitCounts(() => store({ [HIT_COUNTS_KEY]: '1' }), true)).toBe(true);
    expect(loadHitCounts(() => store({ [HIT_COUNTS_KEY]: '0' }), false)).toBe(false);
    const s = store();
    saveHitCounts(false, () => s);
    expect(s.data[HIT_COUNTS_KEY]).toBe('0');
  });

  it('survives storage that throws', () => {
    const broken = () => {
      throw new Error('blocked');
    };
    expect(loadHitCounts(broken, false)).toBe(true);
    expect(() => saveHitCounts(true, broken)).not.toThrow();
  });
});

describe('report requests', () => {
  const fields = (over: Partial<ReportFields> = {}): ReportFields => ({
    phrase: '',
    tier: 'overused word',
    example: '',
    model: '',
    comment: '',
    ...over,
  });

  it('builds a new-phrase request from the form', () => {
    expect(buildRequest({ kind: 'new-phrase', phrase: '' }, fields({ phrase: '  delve\n into ', model: ' Claude ' }), 't')).toEqual({
      kind: 'new-phrase',
      phrase: 'delve into',
      tier: 'overused word',
      example: '',
      model: 'Claude',
      token: 't',
    });
    expect(buildRequest({ kind: 'new-phrase', phrase: '' }, fields({ phrase: '  ' }), 't')).toBeNull();
    expect(buildRequest({ kind: 'new-phrase', phrase: '' }, fields({ phrase: 'x', tier: 'lexical' }), 't')).toBeNull();
  });

  it('builds a false-positive request from the highlight and the form', () => {
    const draft = { kind: 'false-positive' as const, entryId: 'en.lexical.delve', matchedText: 'Delved\n into' };
    expect(buildRequest(draft, fields({ example: ' We delved in. ', comment: 'common' }), 't')).toEqual({
      kind: 'false-positive',
      entryId: 'en.lexical.delve',
      matchedText: 'Delved into',
      example: 'We delved in.',
      comment: 'common',
      token: 't',
    });
  });

  it('keeps the GitHub form as the secondary way, prefilled with the phrase or entry only', () => {
    const phrase = new URL(githubUrl({ kind: 'new-phrase', phrase: 'old' }, 'edited phrase'));
    expect(phrase.searchParams.get('template')).toBe('report-ai-phrase.yml');
    expect(phrase.searchParams.get('phrase')).toBe('edited phrase');
    const fp = new URL(githubUrl({ kind: 'false-positive', entryId: 'en.lexical.delve', matchedText: 'delve' }, ''));
    expect([...fp.searchParams.keys()].sort()).toEqual(['entry_id', 'matched_text', 'template', 'title']);
  });

  it('explains every error', () => {
    for (const e of ['invalid', 'origin', 'challenge', 'rate-limited', 'unavailable'] as const) {
      expect(errorText(e).length).toBeGreaterThan(10);
    }
  });
});

describe('the API client', () => {
  it('sends hit counts as a text/plain beacon with IDs only', async () => {
    const beacon = vi.fn((_url: string, _data: Blob) => true);
    expect(sendHits(['en.lexical.delve'], beacon)).toBe(true);
    const [url, blob] = beacon.mock.calls[0]!;
    expect(url).toBe(`${API_BASE}${API_PATHS.hits}`);
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(JSON.parse(await blob.text())).toEqual({ ids: ['en.lexical.delve'] });
    expect(sendHits([], beacon)).toBe(false);
    expect(sendHits(['x'], null)).toBe(false);
  });

  it('reads the Worker\'s answer and never throws', async () => {
    const ok = { ok: true, issue: { number: 3, url: 'https://github.com/x/y/issues/3' } };
    const req = { kind: 'new-phrase', phrase: 'p', tier: 'style', token: 't' } as const;
    const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await sendReport(req, answer(201, ok))).toEqual(ok);
    expect(await sendReport(req, answer(403, { ok: false, error: 'challenge' }))).toEqual({ ok: false, error: 'challenge' });
    const plain = (status: number) => (async () => new Response('busy', { status })) as unknown as typeof fetch;
    expect(await sendReport(req, plain(429))).toEqual({ ok: false, error: 'rate-limited' });
    expect(await sendReport(req, plain(502))).toEqual({ ok: false, error: 'unavailable' });
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await sendReport(req, offline)).toEqual({ ok: false, error: 'unavailable' });
  });
});
