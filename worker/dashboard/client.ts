// The dashboard's script, served as /dashboard.js (scripts/worker-dashboard.ts strips the
// types). Self-contained: type imports only. Every value from the API is shown with
// textContent, never as HTML (referring sites, cities and utm tags come from visitors).

import type { Count, DayRow, Dimension, StatsResponse, Tally } from '../src/stats-types.ts';

const TOKEN_KEY = 'aiprescreen-dashboard-token';
const REPO = 'ShuhongDai/ai-prescreen';

// Each refresh reads the range's rows again and D1's free read quota is per day, so longer
// ranges refresh less often; the long view comes from the daily totals ("Since launch").
const RANGES = [
  { id: 'today', label: 'Today', days: 1, refreshS: 60 },
  { id: '7d', label: '7 days', days: 7, refreshS: 120 },
  { id: '30d', label: '30 days', days: 30, refreshS: 600 },
  { id: '90d', label: '90 days', days: 90, refreshS: 1800 },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

const DIM_LABELS: Record<Dimension, string> = {
  ref_host: 'Referring sites',
  utm_source: 'Campaign source (utm_source or ?ref=)',
  utm_medium: 'Campaign medium',
  utm_campaign: 'Campaign name',
  country: 'Countries',
  region: 'Regions',
  city: 'Cities',
  as_org: 'Networks (who runs the connection)',
  device: 'Devices',
  browser: 'Browsers',
  os: 'Operating systems',
  lang: 'Browser languages',
  viewport: 'Window widths (CSS px)',
  theme: 'Colour scheme',
  touch: 'Touch screen',
  path: 'Pages',
};

const EVENT_LABELS: Record<string, string> = {
  input: 'Draft entered',
  example: 'Tried the example',
  sensitivity: 'Changed sensitivity',
  experimental: 'Experimental lexicon',
  key: 'Opened the Key',
  advanced: 'Opened Advanced',
  undo: 'Undo after "Not AI-like"',
  'report-open': 'Opened the report form',
};

// ---- State ----

let token = readToken();
let range: RangeId = 'today';
let filters: [Dimension, string][] = [];
let suspect = false;
let timer: number | undefined;
/** Bumped by every load and by signing out: an answer to an older request is ignored. */
let generation = 0;
let lastData: StatsResponse | null = null;
let repoInfo: { stars: number; forks: number; issues: number } | null = null;

const app = document.getElementById('app')!;
const status = document.getElementById('status')!;
const tooltip = el('div', 'tooltip');
tooltip.hidden = true;
document.body.append(tooltip);

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveToken(value: string): void {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Kept for this page view only.
  }
}

// ---- DOM helpers ----

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const fmt = new Intl.NumberFormat('en');
const num = (n: number) => fmt.format(n);
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

let regionNames: Intl.DisplayNames | null = null;
let languageNames: Intl.DisplayNames | null = null;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
  languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
} catch {
  // Codes are shown as they are.
}

function duration(s: number | null): string {
  if (s === null) return '–';
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

/** How a dimension's value reads. */
function display(dim: Dimension, c: { value: string; label?: string }): string {
  if (c.value === '') return dim === 'ref_host' ? '(direct or unknown)' : '(none)';
  if (dim === 'touch') return c.value === '1' ? 'yes' : 'no';
  if (dim === 'country') {
    const name = safe(() => regionNames?.of(c.value));
    return name && name !== c.value ? `${name} (${c.value})` : c.value;
  }
  if (dim === 'lang') {
    const name = safe(() => languageNames?.of(c.value));
    return name && name !== c.value ? `${name} (${c.value})` : c.value;
  }
  return c.label ?? c.value;
}

function safe<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

function showTip(text: string[], x: number, y: number): void {
  tooltip.replaceChildren(...text.map((line, i) => (i === 0 ? el('strong', '', line) : el('div', '', line))));
  tooltip.hidden = false;
  const box = tooltip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - box.width - 8, x + 12);
  const top = y - box.height - 12 < 8 ? y + 16 : y - box.height - 12;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${top}px`;
}
const hideTip = () => {
  tooltip.hidden = true;
};

// ---- Data ----

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeDays(): { from: string; to: string } {
  const days = RANGES.find((r) => r.id === range)!.days;
  const now = new Date();
  return { from: utcDay(new Date(now.getTime() - (days - 1) * 86_400_000)), to: utcDay(now) };
}

async function load(): Promise<void> {
  clearTimeout(timer);
  const mine = ++generation;
  if (!token) {
    renderLogin('');
    return;
  }
  const { from, to } = rangeDays();
  const params = new URLSearchParams({ from, to });
  for (const [d, v] of filters) params.append('f', `${d}:${v}`);
  if (suspect) params.set('suspect', '1');
  status.textContent = 'Updating…';
  try {
    const res = await fetch(`/v1/stats?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const data = (await res.json().catch(() => null)) as StatsResponse | { ok: false; error: string } | null;
    if (mine !== generation) return; // a newer load or a sign-out came meanwhile
    if (res.status === 401) {
      token = '';
      saveToken('');
      renderLogin('That token was not accepted.');
      return;
    }
    if (!data || !data.ok) {
      const error = data && !data.ok ? data.error : `HTTP ${res.status}`;
      status.textContent =
        error === 'budget'
          ? "Today's read budget for the dashboard is used up (it protects the database's free quota). Back after midnight UTC."
          : error === 'rate-limited'
            ? 'Too many refreshes; trying again shortly.'
            : `Could not load (${error}).`;
    } else {
      lastData = data;
      render(data);
      status.textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString()} · refreshes every ${refreshLabel()} while this tab is visible`;
    }
  } catch {
    if (mine !== generation) return;
    status.textContent = 'Offline or the API is unreachable; retrying.';
  }
  schedule();
}

function refreshLabel(): string {
  const s = RANGES.find((r) => r.id === range)!.refreshS;
  return s < 60 ? `${s} s` : `${s / 60} min`;
}

function schedule(): void {
  clearTimeout(timer);
  if (document.visibilityState !== 'visible') return;
  timer = window.setTimeout(load, RANGES.find((r) => r.id === range)!.refreshS * 1000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && token) void load();
  else clearTimeout(timer);
});

async function loadRepo(): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    const r = (await res.json()) as { stargazers_count: number; forks_count: number; open_issues_count: number };
    repoInfo = { stars: r.stargazers_count, forks: r.forks_count, issues: r.open_issues_count };
    if (lastData) render(lastData);
  } catch {
    // Not shown.
  }
}

// ---- Views ----

function renderLogin(message: string): void {
  status.textContent = 'Sign in';
  const box = el('form', 'login');
  box.append(
    el('h2', '', 'Dashboard token'),
    el('p', 'muted small', 'The STATS_TOKEN secret of the Worker (in .env on the headnode). It is kept in this browser only.'),
  );
  const input = el('input');
  input.type = 'password';
  input.autocomplete = 'current-password';
  input.required = true;
  input.setAttribute('aria-label', 'Token');
  const button = el('button', '', 'Open dashboard');
  button.type = 'submit';
  box.append(input, button);
  if (message) box.append(el('p', 'error small', message));
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    token = input.value.trim();
    saveToken(token);
    void load();
  });
  app.replaceChildren(box);
  input.focus();
}

function render(d: StatsResponse): void {
  const scrollY = window.scrollY;
  app.replaceChildren(toolbar(d), tiles(d), sections(d));
  window.scrollTo({ top: scrollY });
}

function toolbar(d: StatsResponse): HTMLElement {
  const bar = el('div', 'toolbar');
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Date range');
  for (const r of RANGES) {
    const b = el('button', '', r.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(r.id === range));
    b.addEventListener('click', () => {
      range = r.id;
      void load();
    });
    seg.append(b);
  }
  bar.append(seg);

  const label = el('label', 'small');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = suspect;
  box.addEventListener('change', () => {
    suspect = box.checked;
    void load();
  });
  label.append(box, ` Include cloud networks${d.suspect ? '' : ` (${num(d.totals.suspectLeftOut)} left out)`}`);
  bar.append(label);

  for (const [dim, value] of filters) {
    const chip = el('span', 'chip small');
    chip.append(`${DIM_LABELS[dim]}: ${display(dim, { value })}`);
    const x = el('button', '', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove filter');
    x.addEventListener('click', () => {
      filters = filters.filter(([fd, fv]) => !(fd === dim && fv === value));
      void load();
    });
    chip.append(x);
    bar.append(chip);
  }

  bar.append(el('span', 'spacer'));
  bar.append(el('span', 'small muted', `${d.from === d.to ? d.from : `${d.from} – ${d.to}`} (UTC days)`));
  const out = el('button', 'link small', 'Sign out');
  out.type = 'button';
  out.addEventListener('click', () => {
    token = '';
    saveToken('');
    generation++;
    clearTimeout(timer);
    renderLogin('');
  });
  bar.append(out);
  return bar;
}

function tile(label: string, value: string, sub = '', live = false): HTMLElement {
  const t = el('div', 'tile');
  const l = el('div', 'label');
  if (live) l.append(el('span', 'live-dot'));
  l.append(label);
  t.append(l, el('div', 'value', value));
  if (sub) t.append(el('div', 'sub', sub));
  return t;
}

function tiles(d: StatsResponse): HTMLElement {
  const t = d.totals;
  const wrap = el('div', 'tiles');
  const liveSub = d.live.countries.map((c) => `${c.value || '?'} ${c.count}`).join(' · ');
  wrap.append(
    tile('Active in the last 30 min', num(d.live.visits), liveSub, true),
    tile('Visits (page views)', num(t.visits)),
    tile('Visitors', num(t.visitors), 'unique per day, summed'),
    tile('Used the tool', num(t.used), `${pct(t.used, t.visits)} of visits analysed a draft or the example`),
    tile('Median time on page', duration(t.medianActiveS), 'while the tab was visible'),
    tile('Time to first analysis', duration(t.medianFirstAnalysisS), 'median, visits that analysed'),
    tile('Analyses per analysing visit', String(t.analysesPerAnalysingVisit)),
    tile('Median scroll depth', `${Math.round(t.medianScroll)}%`),
  );
  if (repoInfo) wrap.append(tile('GitHub stars', num(repoInfo.stars), `${num(repoInfo.forks)} forks · ${num(repoInfo.issues)} open issues`));
  return wrap;
}

function card(title: string, wide = false): HTMLElement {
  const c = el('section', wide ? 'card wide' : 'card');
  c.append(el('h2', '', title));
  return c;
}

function sections(d: StatsResponse): HTMLElement {
  const grid = el('div', 'grid');

  // Over time.
  if (d.days.length > 1) {
    const c = card('Visits per day', true);
    c.append(lineChart(d.days));
    grid.append(c);
  }
  const hours = card('Visits per hour, last 48 hours (your time zone)', d.days.length <= 1);
  hours.append(hourChart(d.hours, d.generatedAt));
  grid.append(hours);

  // Usage.
  const funnel = card('Funnel: how far visits got');
  const first = d.funnel[0]?.visits ?? 0;
  funnel.append(
    barTable(
      d.funnel.map((f) => ({ label: f.step, value: f.visits, extra: pct(f.visits, first) })),
      ['Step', 'Visits', 'of all'],
    ),
  );
  grid.append(funnel);

  const features = card('Features used');
  const rows: BarRow[] = [];
  for (const [name, values] of Object.entries(d.events)) {
    for (const v of values) {
      if (v.count === 0) continue;
      rows.push({ label: `${EVENT_LABELS[name] ?? name}${v.value ? `: ${v.value}` : ''}`, value: v.visits, extra: num(v.count) });
    }
  }
  rows.sort((a, b) => b.value - a.value);
  features.append(barTable(rows, ['Event', 'Visits', 'Times']));
  grid.append(features);

  const engagement = card('Engagement');
  engagement.append(el('h3', '', 'Time on page (visible)'), barTable(tallyRows(d.engagement.active), ['Time', 'Visits']));
  engagement.append(el('h3', '', 'Scroll depth'), barTable(tallyRows(d.engagement.scroll), ['Depth', 'Visits']));
  grid.append(engagement);

  const drafts = card('Analysed drafts');
  drafts.append(el('h3', '', 'Length (words)'), barTable(tallyRows(d.analysis.words), ['Words', 'Analyses']));
  drafts.append(el('h3', '', 'Chatbot leftovers (red pen) per draft'), barTable(tallyRows(d.analysis.artifact), ['Marks', 'Analyses']));
  drafts.append(el('h3', '', 'Overused words (highlighter) per draft'), barTable(tallyRows(d.analysis.lexical), ['Marks', 'Analyses']));
  drafts.append(el('h3', '', 'Style notes (pencil) per draft'), barTable(tallyRows(d.analysis.stylistic), ['Marks', 'Analyses']));
  grid.append(drafts);

  // Where visits come from, and on what.
  const order: Dimension[] = ['ref_host', 'utm_source', 'country', 'city', 'as_org', 'lang', 'device', 'browser', 'os', 'viewport', 'theme', 'touch', 'utm_medium', 'utm_campaign', 'region', 'path'];
  for (const dim of order) {
    const counts = d.dims[dim];
    if (dim.startsWith('utm_') && dim !== 'utm_source' && counts.every((c) => c.value === '')) continue;
    if (dim === 'path' && counts.length <= 1) continue;
    const c = card(DIM_LABELS[dim]);
    c.append(dimTable(dim, counts));
    if (dim === 'as_org') c.append(el('p', 'note', 'Universities and companies often show up by name; home connections show the provider.'));
    grid.append(c);
  }

  // Lexicon.
  const opened = card('Highlights opened (details popover)');
  opened.append(barTable(tallyRows(d.entries.popover), ['Entry', 'Times']));
  grid.append(opened);
  const dismissed = card('Marked "Not AI-like"');
  dismissed.append(barTable(tallyRows(d.entries.dismiss), ['Entry', 'Times']));
  grid.append(dismissed);
  const hits = card('Most shown entries (hit counts)');
  hits.append(barTable(tallyRows(d.hits), ['Entry', 'Page views']));
  hits.append(el('p', 'note', 'Hit counts are not linked to visits, so filters do not apply here.'));
  grid.append(hits);
  const reports = card('Reports filed through the Worker');
  reports.append(barTable(tallyRows(d.reports), ['Kind', 'Issues']));
  grid.append(reports);

  if (d.history.length > 1) {
    const c = card('Since launch: daily totals (cron, all visits)', true);
    c.append(lineChart(d.history));
    grid.append(c);
  }

  const links = card('Elsewhere', true);
  const list = el('p', 'small');
  const sites: [string, string][] = [
    ['Google Search Console', 'https://search.google.com/search-console?resource_id=sc-domain:aiprescreen.fyi'],
    ['Bing Webmaster Tools', 'https://www.bing.com/webmasters'],
    ['Cloudflare Web Analytics', 'https://dash.cloudflare.com/?to=/:account/web-analytics'],
    ['GitHub traffic', `https://github.com/${REPO}/graphs/traffic`],
    ['Open reports', `https://github.com/${REPO}/issues?q=is%3Aissue+is%3Aopen+label%3Areport`],
  ];
  sites.forEach(([name, href], i) => {
    if (i > 0) list.append(' · ');
    const a = el('a', '', name);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    list.append(a);
  });
  links.append(list);
  if (d.truncated) links.append(el('p', 'note', 'Very many visits in this range: only the newest are counted. Choose a shorter range.'));
  grid.append(links);
  return grid;
}

// ---- Tables with bars ----

interface BarRow {
  label: string;
  value: number;
  extra?: string;
  onClick?: () => void;
}

const tallyRows = (t: Tally[]): BarRow[] => t.map((x) => ({ label: x.value || '(none)', value: x.count }));

function barTable(rows: BarRow[], heads: string[]): HTMLElement {
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return el('p', 'empty small', 'Nothing yet.');
  const max = Math.max(...rows.map((r) => r.value), 1);
  const table = el('table', 'bars');
  const head = el('tr');
  heads.forEach((h, i) => {
    const th = el('th', i === 0 ? '' : 'num', h);
    th.scope = 'col';
    head.append(th);
  });
  table.append(head);
  for (const r of rows) {
    const tr = el('tr');
    const cell = el('td', 'label');
    const wrap = el('span', 'barcell');
    const fill = el('span', 'fill');
    fill.style.width = `${(r.value / max) * 100}%`;
    let text: HTMLElement;
    if (r.onClick) {
      const b = el('button', 'text', r.label);
      b.type = 'button';
      b.title = `Filter by ${r.label}`;
      b.addEventListener('click', r.onClick);
      text = b;
    } else {
      text = el('span', 'text', r.label);
      text.title = r.label;
    }
    wrap.append(fill, text);
    cell.append(wrap);
    tr.append(cell, el('td', 'num', num(r.value)));
    if (heads.length > 2) tr.append(el('td', 'num', r.extra ?? ''));
    table.append(tr);
  }
  return table;
}

function dimTable(dim: Dimension, counts: Count[]): HTMLElement {
  const active = new Set(filters.filter(([d]) => d === dim).map(([, v]) => v));
  return barTable(
    counts.map((c) => ({
      label: display(dim, c),
      value: c.visits,
      extra: num(c.visitors),
      onClick: active.has(c.value)
        ? undefined
        : () => {
            filters = [...filters.filter(([d]) => d !== dim), [dim, c.value]];
            void load();
          },
    })),
    ['', 'Visits', 'Visitors'],
  );
}

// ---- Charts ----

const W = 760;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

function niceMax(n: number): number {
  if (n <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= n) ?? n;
}

function axes(chart: SVGSVGElement, max: number): (v: number) => number {
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / max);
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    chart.append(svg('line', { class: i === 0 ? 'axis' : 'gridline', x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v) }));
    const t = svg('text', { x: PAD.left - 6, y: y(v) + 4, 'text-anchor': 'end' });
    t.textContent = num(Math.round(v));
    chart.append(t);
  }
  return y;
}

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Visits and visits that used the tool, per day: two series, one axis. */
function lineChart(days: DayRow[]): HTMLElement {
  const wrap = el('div');
  const legend = el('div', 'legend');
  for (const [cls, name] of [['--series-1', 'Visits'], ['--series-2', 'Used the tool']] as const) {
    const item = el('span');
    const key = el('span', 'key');
    key.style.background = `var(${cls})`;
    item.append(key, name);
    legend.append(item);
  }
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Visits per day; table below' });
  const max = niceMax(Math.max(...days.map((d) => d.visits), 1));
  const y = axes(chart, max);
  const n = days.length;
  const x = (i: number) => PAD.left + ((W - PAD.left - PAD.right) * i) / Math.max(1, n - 1);
  const path = (key: 'visits' | 'used') => days.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  chart.append(svg('path', { class: 'line-1', d: path('visits') }), svg('path', { class: 'line-2', d: path('used') }));
  // Direct labels at the end of each line.
  const last = days[n - 1]!;
  const labelAt = (value: number, text: string, dy: number) => {
    const t = svg('text', { x: W - PAD.right, y: y(value) + dy, 'text-anchor': 'end' });
    t.textContent = text;
    chart.append(t);
  };
  labelAt(last.visits, `${num(last.visits)} visits`, -6);
  if (Math.abs(y(last.used) - y(last.visits)) > 14) labelAt(last.used, `${num(last.used)} used`, 14);
  const ticks = n <= 8 ? days.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  for (const i of ticks) {
    const t = svg('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' });
    t.textContent = shortDay(days[i]!.day);
    chart.append(t);
  }
  // Crosshair and tooltip.
  const cross = svg('line', { class: 'cross', y1: PAD.top, y2: H - PAD.bottom, visibility: 'hidden' });
  const dot1 = svg('circle', { class: 'dot-1', r: 4.5, visibility: 'hidden' });
  const dot2 = svg('circle', { class: 'dot-2', r: 4.5, visibility: 'hidden' });
  const hit = svg('rect', { x: PAD.left, y: 0, width: W - PAD.left - PAD.right, height: H, fill: 'transparent' });
  chart.append(cross, dot1, dot2, hit);
  hit.addEventListener('pointermove', (e) => {
    const box = chart.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((sx - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1))));
    const d = days[i]!;
    for (const [node, cx, cy] of [
      [cross, x(i), 0],
      [dot1, x(i), y(d.visits)],
      [dot2, x(i), y(d.used)],
    ] as const) {
      node.setAttribute('visibility', 'visible');
      if (node === cross) {
        node.setAttribute('x1', String(cx));
        node.setAttribute('x2', String(cx));
      } else {
        node.setAttribute('cx', String(cx));
        node.setAttribute('cy', String(cy));
      }
    }
    showTip([shortDay(d.day), `Visits: ${num(d.visits)}`, `Visitors: ${num(d.visitors)}`, `Used the tool: ${num(d.used)}`], e.clientX, e.clientY);
  });
  hit.addEventListener('pointerleave', () => {
    for (const node of [cross, dot1, dot2]) node.setAttribute('visibility', 'hidden');
    hideTip();
  });
  wrap.append(legend, chart, dayTable(days));
  return wrap;
}

function dayTable(days: DayRow[]): HTMLElement {
  const details = el('details', 'table');
  details.append(el('summary', '', 'Table'));
  const table = el('table');
  const head = el('tr');
  for (const h of ['Day', 'Visits', 'Visitors', 'Used']) head.append(el('th', '', h));
  table.append(head);
  for (const d of [...days].reverse()) {
    const tr = el('tr');
    for (const v of [d.day, num(d.visits), num(d.visitors), num(d.used)]) tr.append(el('td', '', v));
    table.append(tr);
  }
  details.append(table);
  return details;
}

/** Visits per hour over the last 48 hours, in the viewer's time zone. */
function hourChart(hours: { hour: number; visits: number }[], now: number): SVGSVGElement {
  const end = Math.floor(now / 3_600_000);
  const series = Array.from({ length: 48 }, (_, i) => {
    const hour = end - 47 + i;
    return { hour, visits: hours.find((h) => h.hour === hour)?.visits ?? 0 };
  });
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Visits per hour, last 48 hours' });
  const max = niceMax(Math.max(...series.map((s) => s.visits), 1));
  const y = axes(chart, max);
  const slot = (W - PAD.left - PAD.right) / series.length;
  series.forEach((s, i) => {
    const x = PAD.left + i * slot;
    const label = new Date(s.hour * 3_600_000).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    if (s.visits > 0) {
      const top = y(s.visits);
      const h = Math.max(1, y(0) - top);
      // Rounded data end, square at the baseline.
      const r = Math.min(4, h, (slot - 2) / 2);
      const w = Math.max(1, slot - 2);
      chart.append(
        svg('path', {
          class: 'bar',
          d: `M${x + 1},${y(0)} V${top + r} Q${x + 1},${top} ${x + 1 + r},${top} H${x + 1 + w - r} Q${x + 1 + w},${top} ${x + 1 + w},${top + r} V${y(0)} Z`,
        }),
      );
    }
    const hit = svg('rect', { x, y: PAD.top, width: slot, height: H - PAD.top - PAD.bottom, fill: 'transparent' });
    hit.addEventListener('pointermove', (e) => showTip([label, `Visits: ${num(s.visits)}`], e.clientX, e.clientY));
    hit.addEventListener('pointerleave', hideTip);
    chart.append(hit);
    const date = new Date(s.hour * 3_600_000);
    if (date.getHours() % 6 === 0) {
      const t = svg('text', { x: x + slot / 2, y: H - 6, 'text-anchor': 'middle' });
      t.textContent = date.getHours() === 0 ? date.toLocaleDateString(undefined, { weekday: 'short' }) : `${date.getHours()}:00`;
      chart.append(t);
    }
  });
  return chart;
}

// ---- Start ----

void load();
void loadRepo();
