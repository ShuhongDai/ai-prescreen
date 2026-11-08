// Anonymous usage statistics: one random visit ID per page view, kept in
// memory only (never on the device), the visit's context (referring site, language,
// viewport…) and events from the fixed lists in report-contract.ts. Never any text. Nothing
// is sent while switched off (Advanced, or Global Privacy Control), and switching off drops
// what is waiting.

import {
  ACTIVE_MAX_S,
  COLLECT_MAX_EVENTS,
  EVENT_T_MAX,
  VISIT_FIELD_MAX,
  viewportBucket,
  type CollectRequest,
  type UsageEvent,
  type UsageEventName,
  type VisitInfo,
} from '../report-contract.ts';

/** Quiet time after an event before the waiting events are sent. */
export const COLLECT_DELAY_MS = 10_000;

/** At most this many `analysis` events per visit (each pause in typing makes one). */
export const ANALYSIS_MAX = 20;

export interface Engagement {
  /** Seconds the page has been visible. */
  active(): number;
  /** Deepest scroll position so far, in percent of the page. */
  scroll(): number;
}

export interface UsageTracker {
  readonly visit: string;
  track(name: UsageEventName, value?: string): void;
  /** Sends what is waiting, and the engagement so far (the page is being hidden). */
  flush(): void;
  setEnabled(enabled: boolean): void;
}

export interface UsageOptions {
  send(body: CollectRequest): boolean;
  enabled: boolean;
  info(): VisitInfo;
  engagement: Engagement;
  /** Milliseconds since the page was opened. */
  now(): number;
  delay?: number;
  visitId?: string;
}

export function randomVisitId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function createUsageTracker(options: UsageOptions): UsageTracker {
  const visit = options.visitId ?? randomVisitId();
  const delay = options.delay ?? COLLECT_DELAY_MS;
  let enabled = options.enabled;
  let viewSent = false;
  let info: VisitInfo | null = null;
  let pending: UsageEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let analyses = 0;
  let lastAnalysis = '';
  let sentEngagement = '';

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  function engagement(): { active: number; scroll: number } {
    const clamp = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n)));
    return { active: clamp(options.engagement.active(), ACTIVE_MAX_S), scroll: clamp(options.engagement.scroll(), 100) };
  }

  function send(events: UsageEvent[]): void {
    const now = engagement();
    info ??= options.info();
    const body: CollectRequest = { visit, view: info, events, ...now };
    viewSent = true;
    sentEngagement = `${now.active}/${now.scroll}`;
    options.send(body);
  }

  function flush(): void {
    cancel();
    if (!enabled) return;
    if (!viewSent) {
      // The view comes first, with the visit's context.
      send(pending.splice(0, COLLECT_MAX_EVENTS));
    }
    while (pending.length > 0) send(pending.splice(0, COLLECT_MAX_EVENTS));
    const now = engagement();
    if (`${now.active}/${now.scroll}` !== sentEngagement) send([]);
  }

  function track(name: UsageEventName, value = ''): void {
    if (!enabled) return;
    if (name === 'analysis') {
      // A pause in typing on the same text is not a new analysis.
      if (value === lastAnalysis || analyses >= ANALYSIS_MAX) return;
      lastAnalysis = value;
      analyses += 1;
    }
    const t = Math.min(EVENT_T_MAX, Math.max(0, Math.round(options.now())));
    pending.push({ name, value, t });
    if (timer === undefined) timer = setTimeout(flush, delay);
  }

  function setEnabled(value: boolean): void {
    enabled = value;
    cancel();
    if (!enabled) pending = [];
    // Switched on later in the page view: the view is sent now.
    else if (!viewSent) flush();
  }

  // The view: sent right away, so the dashboard sees the visit while it happens.
  if (enabled) flush();

  return { visit, track, flush, setEnabled };
}

/** The visit's context, read from the browser. */
export function readVisitInfo(win: Window = window): VisitInfo {
  const short = (s: string) => s.slice(0, VISIT_FIELD_MAX);
  let ref = '';
  try {
    const host = win.document.referrer ? new URL(win.document.referrer).hostname.toLowerCase() : '';
    if (host !== win.location.hostname) ref = host;
  } catch {
    // Not a URL: no referring site.
  }
  const params = new URLSearchParams(win.location.search);
  const param = (name: string) => short((params.get(name) ?? '').trim().toLowerCase());
  const lang = /^([a-z]{2,3})(?:-([a-z]{2}))?\b/i.exec(win.navigator.language ?? '');
  const media = (q: string) => typeof win.matchMedia === 'function' && win.matchMedia(q).matches;
  return {
    path: short(win.location.pathname),
    ref: short(ref),
    utmSource: param('utm_source') || param('ref'),
    utmMedium: param('utm_medium'),
    utmCampaign: param('utm_campaign'),
    lang: lang ? `${lang[1]!.toLowerCase()}${lang[2] ? `-${lang[2].toUpperCase()}` : ''}` : '',
    viewport: viewportBucket(win.innerWidth),
    theme: media('(prefers-color-scheme: dark)') ? 'dark' : 'light',
    touch: media('(pointer: coarse)'),
  };
}

/** Visible time and scroll depth of this page view (no listeners left behind matter: one page). */
export function watchEngagement(win: Window = window): Engagement {
  const doc = win.document;
  let activeMs = 0;
  let visibleSince: number | null = doc.visibilityState === 'visible' ? win.performance.now() : null;
  let deepest = 0;
  const measure = () => {
    const height = doc.documentElement.scrollHeight;
    if (height > 0) deepest = Math.max(deepest, ((win.scrollY + win.innerHeight) / height) * 100);
  };
  doc.addEventListener('visibilitychange', () => {
    const now = win.performance.now();
    if (doc.visibilityState === 'visible') visibleSince ??= now;
    else if (visibleSince !== null) {
      activeMs += now - visibleSince;
      visibleSince = null;
    }
  });
  win.addEventListener('scroll', measure, { passive: true });
  measure();
  return {
    active: () => (activeMs + (visibleSince === null ? 0 : win.performance.now() - visibleSince)) / 1000,
    scroll: () => deepest,
  };
}
