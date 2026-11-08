// Usage statistics from the page (POST /v1/collect): checked against the contract's fixed
// lists, never any text. The visit's place and network come from Cloudflare (request.cf),
// its browser family from the User-Agent; neither the IP address nor the User-Agent is
// stored.

import {
  ACTIVE_MAX_S,
  COLLECT_MAX_EVENTS,
  ENTRY_EVENTS,
  EVENT_T_MAX,
  EVENT_VALUES,
  MARK_BUCKETS,
  VIEWPORTS,
  VISIT_FIELD_MAX,
  VISIT_ID,
  WORD_BUCKETS,
  type UsageEvent,
  type VisitInfo,
} from '../../web/src/report-contract.ts';

export interface ValidCollect {
  visit: string;
  view: VisitInfo | null;
  events: UsageEvent[];
  active: number;
  scroll: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

const FIXED: Readonly<Record<string, readonly string[]>> = EVENT_VALUES;
const ENTRY_NAMES: ReadonlySet<string> = new Set(ENTRY_EVENTS);

function validValue(name: string, value: string, knownIds: ReadonlySet<string>): boolean {
  if (name in FIXED) return FIXED[name]!.includes(value);
  if (ENTRY_NAMES.has(name)) return knownIds.has(value);
  if (name === 'analysis') {
    const [words, ...marks] = value.split('|');
    return (
      marks.length === 3 &&
      (WORD_BUCKETS as readonly string[]).includes(words ?? '') &&
      marks.every((m) => (MARK_BUCKETS as readonly string[]).includes(m))
    );
  }
  return false;
}

/** Hostname only ('' = none), lower case. */
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
/** A utm value: letters, digits and . _ + - and spaces, as the page lower-cases it. */
const TAG = /^[\p{Ll}\p{Lo}\p{N} ._+-]+$/u;
const PATH = /^\/[A-Za-z0-9._~/-]*$/;
const LANG = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

function field(v: unknown, pattern: RegExp): string | null {
  if (typeof v !== 'string' || v.length > VISIT_FIELD_MAX) return null;
  return v === '' || pattern.test(v) ? v : null;
}

function parseView(v: unknown): VisitInfo | null {
  if (!isObject(v)) return null;
  const path = field(v.path, PATH);
  const ref = field(v.ref, HOST);
  const utmSource = field(v.utmSource, TAG);
  const utmMedium = field(v.utmMedium, TAG);
  const utmCampaign = field(v.utmCampaign, TAG);
  const lang = field(v.lang, LANG);
  if (path === null || ref === null || utmSource === null || utmMedium === null || utmCampaign === null || lang === null) return null;
  if (!(VIEWPORTS as readonly unknown[]).includes(v.viewport)) return null;
  if (v.theme !== 'light' && v.theme !== 'dark') return null;
  if (typeof v.touch !== 'boolean') return null;
  return { path, ref, utmSource, utmMedium, utmCampaign, lang, viewport: v.viewport as VisitInfo['viewport'], theme: v.theme, touch: v.touch };
}

/** The request, or null when anything in it is malformed or unknown. */
export function parseCollect(input: unknown, knownIds: ReadonlySet<string>): ValidCollect | null {
  if (!isObject(input)) return null;
  const { visit, view, events, active, scroll } = input;
  if (typeof visit !== 'string' || !VISIT_ID.test(visit)) return null;
  if (!isInt(active, ACTIVE_MAX_S) || !isInt(scroll, 100)) return null;
  if (!Array.isArray(events) || events.length > COLLECT_MAX_EVENTS) return null;
  const parsedView = view === undefined ? null : parseView(view);
  if (view !== undefined && parsedView === null) return null;
  const out: UsageEvent[] = [];
  for (const e of events) {
    if (!isObject(e) || typeof e.name !== 'string' || typeof e.value !== 'string' || !isInt(e.t, EVENT_T_MAX)) return null;
    if (!validValue(e.name, e.value, knownIds)) return null;
    out.push({ name: e.name as UsageEvent['name'], value: e.value, t: e.t });
  }
  return { visit, view: parsedView, events: out, active, scroll };
}

/** Automated clients that run scripts; their requests are dropped. */
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|uptime|monitor|preview|python|curl|wget|httpclient|java\/|go-http|phantom|selenium|puppeteer|playwright|electron/i;

export function isBot(userAgent: string): boolean {
  return userAgent === '' || BOT.test(userAgent);
}

export interface Client {
  device: string;
  browser: string;
  os: string;
}

/** Device, browser and system families from the User-Agent (which is not kept). */
export function clientFamily(ua: string): Client {
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'macOS'
            : /Linux|X11/.test(ua)
              ? 'Linux'
              : 'Other';
  const browser = /Edg(?:e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Other';
  const device = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet' : /Mobi|iPhone|iPod/.test(ua) ? 'mobile' : 'desktop';
  return { device, browser, os };
}

/** Networks of cloud and hosting providers: visits from there are marked as maybe a bot. */
const HOSTING =
  /amazon|aws|google cloud|google llc|microsoft|azure|digitalocean|hetzner|ovh|linode|akamai|oracle|alibaba|tencent|huawei cloud|contabo|vultr|choopa|scaleway|leaseweb|m247|datacamp|cdn77|fastly|cloudflare|hostinger|ionos|netcup|upcloud|hivelocity|psychz|colocrossing|quadranet/i;

export function isHostingNetwork(asOrg: string): boolean {
  return HOSTING.test(asOrg);
}

/** What Cloudflare tells about the client's address (request.cf); the address is not kept. */
export interface Place {
  country: string;
  region: string;
  city: string;
  asOrg: string;
}

export function placeOf(request: Request): Place {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf ?? {};
  const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, VISIT_FIELD_MAX) : '');
  return { country: text(cf.country), region: text(cf.region), city: text(cf.city), asOrg: text(cf.asOrganization) };
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The day's visitor hash: salt, address (prefix) and User-Agent. Another domain than the
 * rate-limit key (limits.ts), so the stored hash never equals that key.
 */
export async function visitorKey(prefix: string, userAgent: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`visitor\n${salt}\n${prefix}\n${userAgent}`));
  return hex(digest).slice(0, 32);
}
