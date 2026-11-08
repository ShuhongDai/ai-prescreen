// The dashboard's script, served as /dashboard.js (scripts/worker-dashboard.ts strips the
// types). Self-contained: type imports only. Every value from the API is shown with
// textContent, never as HTML (referring sites, cities and utm tags come from visitors).
// English and Chinese: every text comes from EN / ZH; the choice is kept in localStorage.

import type { Count, DayRow, Dimension, StatsResponse, Tally } from '../src/stats-types.ts';

const TOKEN_KEY = 'aiprescreen-dashboard-token';
const LANG_KEY = 'aiprescreen-dashboard-lang';
const REPO = 'ShuhongDai/ai-prescreen';

// Each refresh reads the range's rows again and D1's free read quota is per day, so longer
// ranges refresh less often; the long view comes from the daily totals ("Since launch").
const RANGES = [
  { id: 'today', days: 1, refreshS: 60 },
  { id: '7d', days: 7, refreshS: 120 },
  { id: '30d', days: 30, refreshS: 600 },
  { id: '90d', days: 90, refreshS: 1800 },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

// ---- Texts ----

const EN = {
  locale: 'en',
  switchTo: '中文',
  switchLabel: 'Switch to Chinese',
  title: 'AI初筛 · dashboard',
  loading: 'Loading…',
  ranges: { today: 'Today', '7d': '7 days', '30d': '30 days', '90d': '90 days' } as Record<RangeId, string>,
  dims: {
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
  } as Record<Dimension, string>,
  events: {
    input: 'Draft entered',
    example: 'Tried the example',
    sensitivity: 'Changed sensitivity',
    experimental: 'Experimental lexicon',
    key: 'Opened the Key',
    advanced: 'Opened Advanced',
    undo: 'Undo after "Not AI-like"',
    'report-open': 'Opened the report form',
  } as Record<string, string>,
  /** Event values, report kinds and similar codes; anything missing is shown as it is. */
  values: {} as Record<string, string>,
  funnel: {
    view: 'Opened the page',
    input: 'Draft entered (paste or type)',
    analysis: 'Analysed own draft',
    popover: 'Opened a highlight',
    'report-open': 'Opened the report form',
  } as Record<string, string>,
  none: '(none)',
  direct: '(direct or unknown)',
  yes: 'yes',
  no: 'no',
  seconds: (n: number) => `${n} s`,
  minutes: (m: number, s: number) => `${m} min ${s} s`,
  every: (s: number) => (s < 60 ? `${s} s` : `${s / 60} min`),
  bucket: (b: string) => b,
  // Status line
  updating: 'Updating…',
  updated: (time: string, every: string) => `Updated ${time} · refreshes every ${every} while this tab is visible`,
  budget: "Today's read budget for the dashboard is used up (it protects the database's free quota). Back after midnight UTC.",
  rateLimited: 'Too many refreshes; trying again shortly.',
  failed: (e: string) => `Could not load (${e}).`,
  offline: 'Offline or the API is unreachable; retrying.',
  // Sign-in
  signIn: 'Sign in',
  tokenTitle: 'Dashboard token',
  tokenHelp: 'The STATS_TOKEN secret: only the part after "STATS_TOKEN=". It is kept in this browser only.',
  tokenLabel: 'Token',
  open: 'Open dashboard',
  wrongToken: 'That token was not accepted.',
  // Toolbar
  dateRange: 'Date range',
  cloud: 'Include cloud networks',
  leftOut: (n: string) => ` (${n} left out)`,
  removeFilter: 'Remove filter',
  utcDays: '(UTC days)',
  signOut: 'Sign out',
  // Tiles
  live: 'Active in the last 30 min',
  visits: 'Visits (page views)',
  visitors: 'Visitors',
  visitorsSub: 'unique per day, summed',
  used: 'Used the tool',
  usedSub: (p: string) => `${p} of visits analysed a draft or the example`,
  timeOnPage: 'Median time on page',
  timeOnPageSub: 'while the tab was visible',
  firstAnalysis: 'Time to first analysis',
  firstAnalysisSub: 'median, visits that analysed',
  analysesPerVisit: 'Analyses per analysing visit',
  scroll: 'Median scroll depth',
  stars: 'GitHub stars',
  starsSub: (forks: string, issues: string) => `${forks} forks · ${issues} open issues`,
  // Cards
  perDay: 'Visits per day',
  perHour: 'Visits per hour, last 48 hours (your time zone)',
  funnelTitle: 'Funnel: how far visits got',
  funnelHeads: ['Step', 'Visits', 'of all'],
  features: 'Features used',
  featureHeads: ['Event', 'Visits', 'Times'],
  engagement: 'Engagement',
  activeTitle: 'Time on page (visible)',
  activeHeads: ['Time', 'Visits'],
  scrollTitle: 'Scroll depth',
  scrollHeads: ['Depth', 'Visits'],
  drafts: 'Analysed drafts',
  wordsTitle: 'Length (words)',
  wordsHeads: ['Words', 'Analyses'],
  artifactTitle: 'Chatbot leftovers (red pen) per draft',
  lexicalTitle: 'Overused words (highlighter) per draft',
  stylisticTitle: 'Style notes (pencil) per draft',
  marksHeads: ['Marks', 'Analyses'],
  dimHeads: ['', 'Visits', 'Visitors'],
  asOrgNote: 'Universities and companies often show up by name; home connections show the provider.',
  opened: 'Highlights opened (details popover)',
  dismissed: 'Marked "Not AI-like"',
  entryHeads: ['Entry', 'Times'],
  hits: 'Most shown entries (hit counts)',
  hitsHeads: ['Entry', 'Page views'],
  hitsNote: 'Hit counts are not linked to visits, so filters do not apply here.',
  reports: 'Reports filed through the Worker',
  reportHeads: ['Kind', 'Issues'],
  history: 'Since launch: daily totals (cron, all visits)',
  elsewhere: 'Elsewhere',
  sites: { traffic: 'GitHub traffic', reports: 'Open reports' },
  truncated: 'Very many visits in this range: only the newest are counted. Choose a shorter range.',
  // Tables and charts
  nothing: 'Nothing yet.',
  filterBy: (label: string) => `Filter by ${label}`,
  legendVisits: 'Visits',
  legendUsed: 'Used the tool',
  endVisits: (n: string) => `${n} visits`,
  endUsed: (n: string) => `${n} used`,
  tipVisits: (n: string) => `Visits: ${n}`,
  tipVisitors: (n: string) => `Visitors: ${n}`,
  tipUsed: (n: string) => `Used the tool: ${n}`,
  table: 'Table',
  tableHeads: ['Day', 'Visits', 'Visitors', 'Used'],
  perDayAria: 'Visits per day; table below',
  perHourAria: 'Visits per hour, last 48 hours',
};

type Texts = typeof EN;

const ZH: Texts = {
  locale: 'zh-CN',
  switchTo: 'English',
  switchLabel: '切换到英文',
  title: 'AI初筛 · 数据后台',
  loading: '加载中…',
  ranges: { today: '今天', '7d': '7 天', '30d': '30 天', '90d': '90 天' },
  dims: {
    ref_host: '来源网站',
    utm_source: '推广来源（utm_source 或 ?ref=）',
    utm_medium: '推广媒介',
    utm_campaign: '推广活动',
    country: '国家和地区',
    region: '省 / 州',
    city: '城市',
    as_org: '网络（由谁提供这条网络连接）',
    device: '设备',
    browser: '浏览器',
    os: '操作系统',
    lang: '浏览器语言',
    viewport: '窗口宽度（CSS 像素）',
    theme: '明暗模式',
    touch: '触屏',
    path: '页面',
  },
  events: {
    input: '输入了文稿',
    example: '试用了示例',
    sensitivity: '调整了灵敏度',
    experimental: '实验词库',
    key: '打开了图例（Key）',
    advanced: '打开了 Advanced',
    undo: '"Not AI-like" 之后撤销',
    'report-open': '打开了举报表单',
  },
  values: {
    paste: '粘贴',
    type: '手打',
    on: '打开',
    off: '关闭',
    loose: '宽松',
    standard: '标准',
    strict: '严格',
    'false-positive': '误报',
    'new-phrase': '新短语',
    'phrase-selection': '选中文字后举报',
    'phrase-advanced': '从 Advanced 举报',
    light: '浅色',
    dark: '深色',
    desktop: '桌面电脑',
    mobile: '手机',
    tablet: '平板',
  },
  funnel: {
    view: '打开页面',
    input: '输入了文稿（粘贴或手打）',
    analysis: '分析了自己的文稿',
    popover: '打开了标记详情',
    'report-open': '打开了举报表单',
  },
  none: '（无）',
  direct: '（直接访问或未知）',
  yes: '是',
  no: '否',
  seconds: (n) => `${n} 秒`,
  minutes: (m, s) => `${m} 分 ${s} 秒`,
  every: (s) => (s < 60 ? `${s} 秒` : `${s / 60} 分钟`),
  bucket: (b) => b.replace(/ s$/, ' 秒').replace(/ min$/, ' 分钟'),
  updating: '更新中…',
  updated: (time, every) => `已更新 ${time} · 标签页可见时每 ${every} 自动刷新`,
  budget: '今天后台的读取额度已用完（为了保护数据库的免费额度），UTC 午夜后恢复。',
  rateLimited: '刷新太频繁，稍后自动重试。',
  failed: (e) => `加载失败（${e}）。`,
  offline: '网络断开或无法连接 API，正在重试。',
  signIn: '登录',
  tokenTitle: '后台口令',
  tokenHelp: 'Worker 的 STATS_TOKEN：只填 "STATS_TOKEN=" 后面的部分。口令只保存在这个浏览器里。',
  tokenLabel: '口令',
  open: '打开后台',
  wrongToken: '口令不对。',
  dateRange: '时间范围',
  cloud: '包括云服务器网络',
  leftOut: (n) => `（已排除 ${n} 次）`,
  removeFilter: '移除筛选',
  utcDays: '（按 UTC 日期）',
  signOut: '退出登录',
  live: '最近 30 分钟在线',
  visits: '访问次数（页面浏览）',
  visitors: '访客',
  visitorsSub: '按天去重后相加',
  used: '用过工具',
  usedSub: (p) => `${p} 的访问分析过文稿或示例`,
  timeOnPage: '页面停留时长（中位数）',
  timeOnPageSub: '只算标签页可见的时间',
  firstAnalysis: '到第一次分析的时间',
  firstAnalysisSub: '中位数，只算分析过的访问',
  analysesPerVisit: '每次访问的分析次数',
  scroll: '滚动深度（中位数）',
  stars: 'GitHub 星标',
  starsSub: (forks, issues) => `${forks} 个 fork · ${issues} 个未关闭 issue`,
  perDay: '每日访问',
  perHour: '每小时访问（最近 48 小时，你的时区）',
  funnelTitle: '漏斗：访问走到了哪一步',
  funnelHeads: ['步骤', '访问', '占比'],
  features: '功能使用',
  featureHeads: ['事件', '访问', '次数'],
  engagement: '参与度',
  activeTitle: '页面停留时长（可见时间）',
  activeHeads: ['时长', '访问'],
  scrollTitle: '滚动深度',
  scrollHeads: ['深度', '访问'],
  drafts: '分析过的文稿',
  wordsTitle: '长度（词数）',
  wordsHeads: ['词数', '分析次数'],
  artifactTitle: '每篇的聊天机器人残留（红笔）',
  lexicalTitle: '每篇的高频词（荧光笔）',
  stylisticTitle: '每篇的风格提示（铅笔）',
  marksHeads: ['标记数', '分析次数'],
  dimHeads: ['', '访问', '访客'],
  asOrgNote: '大学和公司通常会显示名称；家庭网络显示的是运营商。',
  opened: '被打开详情的标记',
  dismissed: '被标为 "Not AI-like" 的标记',
  entryHeads: ['词条', '次数'],
  hits: '最常出现的词条（hit 计数）',
  hitsHeads: ['词条', '页面浏览'],
  hitsNote: 'hit 计数和访问没有关联，所以筛选对这里不起作用。',
  reports: '通过 Worker 提交的举报',
  reportHeads: ['类型', 'issue 数'],
  history: '上线以来：每日汇总（定时任务，全部访问）',
  elsewhere: '其他平台',
  sites: { traffic: 'GitHub 流量', reports: '未处理的举报' },
  truncated: '这个范围内访问太多，只统计了最新的一部分。请选更短的时间范围。',
  nothing: '暂无数据。',
  filterBy: (label) => `按"${label}"筛选`,
  legendVisits: '访问',
  legendUsed: '用过工具',
  endVisits: (n) => `${n} 次访问`,
  endUsed: (n) => `${n} 次使用`,
  tipVisits: (n) => `访问：${n}`,
  tipVisitors: (n) => `访客：${n}`,
  tipUsed: (n) => `用过工具：${n}`,
  table: '表格',
  tableHeads: ['日期', '访问', '访客', '使用'],
  perDayAria: '每日访问；下方有表格',
  perHourAria: '每小时访问，最近 48 小时',
};

function readLang(): 'en' | 'zh' {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // Not stored: from the browser below.
  }
  return /^zh\b/i.test(navigator.language ?? '') ? 'zh' : 'en';
}

let lang = readLang();
let T: Texts = lang === 'zh' ? ZH : EN;
/** An event value or code in the chosen language. */
const v = (code: string) => T.values[code] ?? code;

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
/** The status line, kept as a function so a language switch can redraw it. */
let statusText: () => string = () => T.loading;
let loginMessage: (() => string) | null = null;

const app = document.getElementById('app')!;
const status = document.getElementById('status')!;
const heading = document.querySelector('.top h1');
const tooltip = el('div', 'tooltip');
tooltip.hidden = true;
document.body.append(tooltip);

const langButton = el('button', 'link small langswitch');
langButton.type = 'button';
langButton.addEventListener('click', () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // This page view only.
  }
  applyLang();
  if (!token) renderLogin(loginMessage);
  else if (lastData) render(lastData);
});
document.querySelector('.top')?.append(langButton);

function setStatus(text: () => string): void {
  statusText = text;
  status.textContent = text();
}

function applyLang(): void {
  T = lang === 'zh' ? ZH : EN;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = T.title;
  if (heading) heading.textContent = T.title;
  langButton.textContent = T.switchTo;
  langButton.setAttribute('aria-label', T.switchLabel);
  langButton.lang = lang === 'zh' ? 'en' : 'zh';
  makeNames();
  status.textContent = statusText();
}

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
  for (const [k, val] of Object.entries(attrs)) node.setAttribute(k, String(val));
  return node;
}

const fmt = new Intl.NumberFormat('en');
const num = (n: number) => fmt.format(n);
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

let regionNames: Intl.DisplayNames | null = null;
let languageNames: Intl.DisplayNames | null = null;
function makeNames(): void {
  try {
    regionNames = new Intl.DisplayNames([T.locale], { type: 'region' });
    languageNames = new Intl.DisplayNames([T.locale], { type: 'language' });
  } catch {
    // Codes are shown as they are.
    regionNames = languageNames = null;
  }
}

function duration(s: number | null): string {
  if (s === null) return '–';
  if (s < 60) return T.seconds(Math.round(s));
  const m = Math.floor(s / 60);
  return T.minutes(m, Math.round(s - m * 60));
}

/** How a dimension's value reads. */
function display(dim: Dimension, c: { value: string; label?: string }): string {
  if (c.value === '') return dim === 'ref_host' ? T.direct : T.none;
  if (dim === 'touch') return c.value === '1' ? T.yes : T.no;
  if (dim === 'theme' || dim === 'device') return v(c.value);
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

function safe<R>(f: () => R): R | undefined {
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
    renderLogin(null);
    return;
  }
  const { from, to } = rangeDays();
  const params = new URLSearchParams({ from, to });
  for (const [d, val] of filters) params.append('f', `${d}:${val}`);
  if (suspect) params.set('suspect', '1');
  setStatus(() => T.updating);
  try {
    const res = await fetch(`/v1/stats?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const data = (await res.json().catch(() => null)) as StatsResponse | { ok: false; error: string } | null;
    if (mine !== generation) return; // a newer load or a sign-out came meanwhile
    if (res.status === 401) {
      token = '';
      saveToken('');
      renderLogin(() => T.wrongToken);
      return;
    }
    if (!data || !data.ok) {
      const error = data && !data.ok ? data.error : `HTTP ${res.status}`;
      setStatus(() => (error === 'budget' ? T.budget : error === 'rate-limited' ? T.rateLimited : T.failed(error)));
    } else {
      lastData = data;
      render(data);
      const at = data.generatedAt;
      setStatus(() => T.updated(new Date(at).toLocaleTimeString(T.locale), T.every(refreshS())));
    }
  } catch {
    if (mine !== generation) return;
    setStatus(() => T.offline);
  }
  schedule();
}

const refreshS = () => RANGES.find((r) => r.id === range)!.refreshS;

function schedule(): void {
  clearTimeout(timer);
  if (document.visibilityState !== 'visible') return;
  timer = window.setTimeout(load, refreshS() * 1000);
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
    if (lastData && token) render(lastData);
  } catch {
    // Not shown.
  }
}

// ---- Views ----

function renderLogin(message: (() => string) | null): void {
  loginMessage = message;
  setStatus(() => T.signIn);
  const box = el('form', 'login');
  box.append(el('h2', '', T.tokenTitle), el('p', 'muted small', T.tokenHelp));
  const input = el('input');
  input.type = 'password';
  input.autocomplete = 'current-password';
  input.required = true;
  input.setAttribute('aria-label', T.tokenLabel);
  const button = el('button', '', T.open);
  button.type = 'submit';
  box.append(input, button);
  if (message) box.append(el('p', 'error small', message()));
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    // Forgiving: the whole .env line, quotes or spaces pasted with it still work.
    token = input.value
      .trim()
      .replace(/^STATS_TOKEN\s*=\s*/, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    saveToken(token);
    loginMessage = null;
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
  seg.setAttribute('aria-label', T.dateRange);
  for (const r of RANGES) {
    const b = el('button', '', T.ranges[r.id]);
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
  label.append(box, ` ${T.cloud}${d.suspect ? '' : T.leftOut(num(d.totals.suspectLeftOut))}`);
  bar.append(label);

  for (const [dim, value] of filters) {
    const chip = el('span', 'chip small');
    chip.append(`${T.dims[dim]}: ${display(dim, { value })}`);
    const x = el('button', '', '×');
    x.type = 'button';
    x.setAttribute('aria-label', T.removeFilter);
    x.addEventListener('click', () => {
      filters = filters.filter(([fd, fv]) => !(fd === dim && fv === value));
      void load();
    });
    chip.append(x);
    bar.append(chip);
  }

  bar.append(el('span', 'spacer'));
  bar.append(el('span', 'small muted', `${d.from === d.to ? d.from : `${d.from} – ${d.to}`} ${T.utcDays}`));
  const out = el('button', 'link small', T.signOut);
  out.type = 'button';
  out.addEventListener('click', () => {
    token = '';
    saveToken('');
    generation++;
    clearTimeout(timer);
    renderLogin(null);
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
    tile(T.live, num(d.live.visits), liveSub, true),
    tile(T.visits, num(t.visits)),
    tile(T.visitors, num(t.visitors), T.visitorsSub),
    tile(T.used, num(t.used), T.usedSub(pct(t.used, t.visits))),
    tile(T.timeOnPage, duration(t.medianActiveS), T.timeOnPageSub),
    tile(T.firstAnalysis, duration(t.medianFirstAnalysisS), T.firstAnalysisSub),
    tile(T.analysesPerVisit, String(t.analysesPerAnalysingVisit)),
    tile(T.scroll, `${Math.round(t.medianScroll)}%`),
  );
  if (repoInfo) wrap.append(tile(T.stars, num(repoInfo.stars), T.starsSub(num(repoInfo.forks), num(repoInfo.issues))));
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
    const c = card(T.perDay, true);
    c.append(lineChart(d.days));
    grid.append(c);
  }
  const hours = card(T.perHour, d.days.length <= 1);
  hours.append(hourChart(d.hours, d.generatedAt));
  grid.append(hours);

  // Usage.
  const funnel = card(T.funnelTitle);
  const first = d.funnel[0]?.visits ?? 0;
  funnel.append(barTable(d.funnel.map((f) => ({ label: T.funnel[f.id] ?? f.step, value: f.visits, extra: pct(f.visits, first) })), T.funnelHeads));
  grid.append(funnel);

  const features = card(T.features);
  const rows: BarRow[] = [];
  for (const [name, values] of Object.entries(d.events)) {
    for (const e of values) {
      if (e.count === 0) continue;
      rows.push({ label: `${T.events[name] ?? name}${e.value ? `: ${v(e.value)}` : ''}`, value: e.visits, extra: num(e.count) });
    }
  }
  rows.sort((a, b) => b.value - a.value);
  features.append(barTable(rows, T.featureHeads));
  grid.append(features);

  const engagement = card(T.engagement);
  engagement.append(el('h3', '', T.activeTitle), barTable(tallyRows(d.engagement.active, T.bucket), T.activeHeads));
  engagement.append(el('h3', '', T.scrollTitle), barTable(tallyRows(d.engagement.scroll), T.scrollHeads));
  grid.append(engagement);

  const drafts = card(T.drafts);
  drafts.append(el('h3', '', T.wordsTitle), barTable(tallyRows(d.analysis.words), T.wordsHeads));
  drafts.append(el('h3', '', T.artifactTitle), barTable(tallyRows(d.analysis.artifact), T.marksHeads));
  drafts.append(el('h3', '', T.lexicalTitle), barTable(tallyRows(d.analysis.lexical), T.marksHeads));
  drafts.append(el('h3', '', T.stylisticTitle), barTable(tallyRows(d.analysis.stylistic), T.marksHeads));
  grid.append(drafts);

  // Where visits come from, and on what.
  const order: Dimension[] = ['ref_host', 'utm_source', 'country', 'city', 'as_org', 'lang', 'device', 'browser', 'os', 'viewport', 'theme', 'touch', 'utm_medium', 'utm_campaign', 'region', 'path'];
  for (const dim of order) {
    const counts = d.dims[dim];
    if (dim.startsWith('utm_') && dim !== 'utm_source' && counts.every((c) => c.value === '')) continue;
    if (dim === 'path' && counts.length <= 1) continue;
    const c = card(T.dims[dim]);
    c.append(dimTable(dim, counts));
    if (dim === 'as_org') c.append(el('p', 'note', T.asOrgNote));
    grid.append(c);
  }

  // Lexicon.
  const opened = card(T.opened);
  opened.append(barTable(tallyRows(d.entries.popover), T.entryHeads));
  grid.append(opened);
  const dismissed = card(T.dismissed);
  dismissed.append(barTable(tallyRows(d.entries.dismiss), T.entryHeads));
  grid.append(dismissed);
  const hits = card(T.hits);
  hits.append(barTable(tallyRows(d.hits), T.hitsHeads));
  hits.append(el('p', 'note', T.hitsNote));
  grid.append(hits);
  const reports = card(T.reports);
  reports.append(barTable(tallyRows(d.reports, v), T.reportHeads));
  grid.append(reports);

  if (d.history.length > 1) {
    const c = card(T.history, true);
    c.append(lineChart(d.history));
    grid.append(c);
  }

  const links = card(T.elsewhere, true);
  const list = el('p', 'small');
  const sites: [string, string][] = [
    ['Google Search Console', 'https://search.google.com/search-console?resource_id=sc-domain:aiprescreen.fyi'],
    ['Bing Webmaster Tools', 'https://www.bing.com/webmasters'],
    ['Cloudflare Web Analytics', 'https://dash.cloudflare.com/?to=/:account/web-analytics'],
    [T.sites.traffic, `https://github.com/${REPO}/graphs/traffic`],
    [T.sites.reports, `https://github.com/${REPO}/issues?q=is%3Aissue+is%3Aopen+label%3Areport`],
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
  if (d.truncated) links.append(el('p', 'note', T.truncated));
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

const tallyRows = (t: Tally[], label: (s: string) => string = (s) => s): BarRow[] =>
  t.map((x) => ({ label: x.value ? label(x.value) : T.none, value: x.count }));

function barTable(rows: BarRow[], heads: string[]): HTMLElement {
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return el('p', 'empty small', T.nothing);
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
      b.title = T.filterBy(r.label);
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
  const active = new Set(filters.filter(([d]) => d === dim).map(([, val]) => val));
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
    T.dimHeads,
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

function axes(chart: SVGSVGElement, max: number): (value: number) => number {
  const y = (value: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - value / max);
  for (let i = 0; i <= 4; i++) {
    const value = (max / 4) * i;
    chart.append(svg('line', { class: i === 0 ? 'axis' : 'gridline', x1: PAD.left, x2: W - PAD.right, y1: y(value), y2: y(value) }));
    const t = svg('text', { x: PAD.left - 6, y: y(value) + 4, 'text-anchor': 'end' });
    t.textContent = num(Math.round(value));
    chart.append(t);
  }
  return y;
}

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(T.locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Visits and visits that used the tool, per day: two series, one axis. */
function lineChart(days: DayRow[]): HTMLElement {
  const wrap = el('div');
  const legend = el('div', 'legend');
  for (const [cls, name] of [
    ['--series-1', T.legendVisits],
    ['--series-2', T.legendUsed],
  ] as const) {
    const item = el('span');
    const key = el('span', 'key');
    key.style.background = `var(${cls})`;
    item.append(key, name);
    legend.append(item);
  }
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': T.perDayAria });
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
  labelAt(last.visits, T.endVisits(num(last.visits)), -6);
  if (Math.abs(y(last.used) - y(last.visits)) > 14) labelAt(last.used, T.endUsed(num(last.used)), 14);
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
    showTip([shortDay(d.day), T.tipVisits(num(d.visits)), T.tipVisitors(num(d.visitors)), T.tipUsed(num(d.used))], e.clientX, e.clientY);
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
  details.append(el('summary', '', T.table));
  const table = el('table');
  const head = el('tr');
  for (const h of T.tableHeads) head.append(el('th', '', h));
  table.append(head);
  for (const d of [...days].reverse()) {
    const tr = el('tr');
    for (const val of [d.day, num(d.visits), num(d.visitors), num(d.used)]) tr.append(el('td', '', val));
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
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': T.perHourAria });
  const max = niceMax(Math.max(...series.map((s) => s.visits), 1));
  const y = axes(chart, max);
  const slot = (W - PAD.left - PAD.right) / series.length;
  series.forEach((s, i) => {
    const x = PAD.left + i * slot;
    const label = new Date(s.hour * 3_600_000).toLocaleString(T.locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
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
    hit.addEventListener('pointermove', (e) => showTip([label, T.tipVisits(num(s.visits))], e.clientX, e.clientY));
    hit.addEventListener('pointerleave', hideTip);
    chart.append(hit);
    const date = new Date(s.hour * 3_600_000);
    if (date.getHours() % 6 === 0) {
      const t = svg('text', { x: x + slot / 2, y: H - 6, 'text-anchor': 'middle' });
      t.textContent = date.getHours() === 0 ? date.toLocaleDateString(T.locale, { weekday: 'short' }) : `${date.getHours()}:00`;
      chart.append(t);
    }
  });
  return chart;
}

// ---- Start ----

applyLang();
void load();
void loadRepo();
