import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisValue, API_PATHS, COLLECT_MAX_EVENTS, VISIT_ID, viewportBucket, type CollectRequest, type VisitInfo } from '../web/src/report-contract.ts';
import { ANALYSIS_MAX, COLLECT_DELAY_MS, createUsageTracker, randomVisitId } from '../web/src/ui/analytics.ts';
import { API_BASE, sendCollect } from '../web/src/ui/api.ts';
import { parseCollect } from '../worker/src/analytics.ts';

const info: VisitInfo = { path: '/', ref: '', utmSource: '', utmMedium: '', utmCampaign: '', lang: 'en', viewport: '1440+', theme: 'light', touch: false };

function tracker(enabled = true) {
  const sent: CollectRequest[] = [];
  let clock = 0;
  const engagement = { active: 0, scroll: 0 };
  const usage = createUsageTracker({
    send: (body) => {
      sent.push(structuredClone(body));
      return true;
    },
    enabled,
    info: () => info,
    engagement: { active: () => engagement.active, scroll: () => engagement.scroll },
    now: () => clock,
    visitId: 'AAAAAAAAAAAAAAAAAAAAAA',
  });
  return { usage, sent, engagement, tick: (ms: number) => (clock += ms) };
}

describe('usage statistics in the page', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the view at once, then events in batches after a quiet spell', () => {
    const { usage, sent, tick } = tracker();
    expect(sent).toEqual([{ visit: 'AAAAAAAAAAAAAAAAAAAAAA', view: info, events: [], active: 0, scroll: 0 }]);
    tick(1500);
    usage.track('input', 'paste');
    usage.track('example');
    vi.advanceTimersByTime(COLLECT_DELAY_MS - 1);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent[1]).toEqual({
      visit: 'AAAAAAAAAAAAAAAAAAAAAA',
      view: info, // in every request: a lost first one must not lose the visit
      events: [
        { name: 'input', value: 'paste', t: 1500 },
        { name: 'example', value: '', t: 1500 },
      ],
      active: 0,
      scroll: 0,
    });
  });

  it('sends nothing while switched off, drops what waits when switched off, and sends the view when switched on', () => {
    const off = tracker(false);
    off.usage.track('example');
    off.usage.flush();
    vi.runAllTimers();
    expect(off.sent).toEqual([]);
    off.usage.setEnabled(true);
    expect(off.sent).toHaveLength(1);
    expect(off.sent[0]?.view).toEqual(info);

    const on = tracker();
    on.usage.track('key');
    on.usage.setEnabled(false);
    on.usage.flush();
    vi.runAllTimers();
    expect(on.sent).toHaveLength(1); // the view only
  });

  it('flushes on hiding: waiting events, else the engagement when it changed', () => {
    const { usage, sent, engagement } = tracker();
    usage.flush();
    expect(sent).toHaveLength(1); // nothing new
    engagement.active = 42;
    engagement.scroll = 77.6;
    usage.flush();
    expect(sent[1]).toMatchObject({ events: [], active: 42, scroll: 78 });
    const many = COLLECT_MAX_EVENTS + 5;
    for (let i = 0; i < many; i++) usage.track('key');
    usage.flush();
    expect(sent.slice(2).map((b) => b.events.length)).toEqual([COLLECT_MAX_EVENTS, 5]);
  });

  it('counts an analysis once per change, and at most ANALYSIS_MAX per visit', () => {
    const { usage, sent } = tracker();
    const a = analysisValue(120, { artifact: 0, lexical: 3, stylistic: 0 });
    usage.track('analysis', a);
    usage.track('analysis', a);
    for (let i = 0; i < ANALYSIS_MAX + 5; i++) usage.track('analysis', analysisValue(i * 60, { artifact: i % 2, lexical: 0, stylistic: 0 }));
    usage.flush();
    const analyses = sent.flatMap((b) => b.events).filter((e) => e.name === 'analysis');
    expect(analyses).toHaveLength(ANALYSIS_MAX);
    expect(analyses[0]?.value).toBe('50-199|0|2-5|0');
  });

  it('builds requests the Worker accepts', () => {
    const { usage, sent } = tracker();
    usage.track('sensitivity', 'strict');
    usage.track('report-open', 'phrase-selection');
    usage.track('analysis', analysisValue(6000, { artifact: 25, lexical: 1, stylistic: 3 }));
    usage.flush();
    for (const body of sent) expect(parseCollect(JSON.parse(JSON.stringify(body)), new Set())).not.toBeNull();
  });

  it('makes random visit IDs and buckets viewports', () => {
    const ids = new Set(Array.from({ length: 50 }, randomVisitId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(VISIT_ID);
    expect([320, 479, 480, 800, 1200, 2560].map(viewportBucket)).toEqual(['<480', '<480', '480-767', '768-1023', '1024-1439', '1440+']);
  });

  it('sends as a text/plain beacon to the collect endpoint', async () => {
    const beacon = vi.fn((_url: string, _data: Blob) => true);
    const body: CollectRequest = { visit: 'AAAAAAAAAAAAAAAAAAAAAA', events: [], active: 1, scroll: 2 };
    expect(sendCollect(body, beacon)).toBe(true);
    const [url, blob] = beacon.mock.calls[0]!;
    expect(url).toBe(`${API_BASE}${API_PATHS.collect}`);
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(JSON.parse(await blob.text())).toEqual(body);
    expect(sendCollect(body, null)).toBe(false);
  });
});
