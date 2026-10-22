// Human fire-rate of lexicon entries on the pre-2022 arXiv sample (a lexicon-quality
// metric, not engine logic; see CLAUDE.md, M2 notes). Each entry is compiled ON ITS OWN
// and run over every abstract; its fire-rate is the share of abstracts with >= 1 match.
//
//   node scripts/fire-rate.ts [--tier lexical] [--status candidate]
//        [--abstracts data/arxiv/abstracts-2019-2021.jsonl] [--out data/fire-rates.json]
//        [--review review.md --top 30 --sample 50 --seed 42]
//        [--from data/fire-rates.json]   (reuse saved results; only rewrite the review)

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TIERS, analyze, compileLexicon, type LexiconEntry } from '../web/src/engine/index.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}

const TIER = arg('tier', 'lexical');
const STATUS = arg('status', '');
const ABSTRACTS = arg('abstracts', 'data/arxiv/abstracts-2019-2021.jsonl');
const OUT = arg('out', 'data/fire-rates.json');
const REVIEW = arg('review', '');
const TOP = Number(arg('top', '30'));
const SAMPLE = Number(arg('sample', '50'));
const SEED = Number(arg('seed', '42'));
const FROM = arg('from', '');

interface Abstract {
  id: string;
  group: string;
  abstract: string;
}

interface Example {
  arxivId: string;
  snippet: string;
}

interface FireRate {
  id: string;
  fires: number;
  rate: number;
  examples: Example[];
}

const lexicon: LexiconEntry[] = readdirSync('lexicon')
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(`lexicon/${f}`, 'utf8')) as LexiconEntry[]);
const selected = lexicon.filter(
  (e) => e.tier === TIER && e.status !== 'retired' && (STATUS === '' || e.status === STATUS),
);
const abstracts: Abstract[] = readFileSync(ABSTRACTS, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Abstract);
const N = abstracts.length;

function snippet(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 60);
  const to = Math.min(text.length, end + 60);
  const flat = (s: string) => s.replace(/\s+/g, ' ');
  return (
    (from > 0 ? '…' : '') +
    flat(text.slice(from, start)) +
    '«' +
    flat(text.slice(start, end)) +
    '»' +
    flat(text.slice(end, to)) +
    (to < text.length ? '…' : '')
  );
}

function measure(): FireRate[] {
  const t0 = performance.now();
  const measured = selected.map((entry) => {
    const compiled = compileLexicon([entry], { includeCandidates: true, tiers: TIERS });
    let fires = 0;
    const examples: Example[] = [];
    for (const a of abstracts) {
      const m = analyze(a.abstract, compiled).matches.find((x) => x.entryId === entry.id);
      if (!m) continue;
      fires++;
      if (examples.length < 3) examples.push({ arxivId: a.id, snippet: snippet(a.abstract, m.start, m.end) });
    }
    return { id: entry.id, fires, rate: N === 0 ? 0 : fires / N, examples };
  });
  writeFileSync(
    OUT,
    JSON.stringify({ abstracts: ABSTRACTS, n: N, tier: TIER, status: STATUS || 'all', results: measured }, null, 2) + '\n',
  );
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`${selected.length} ${TIER} entries x ${N} abstracts in ${seconds} s → ${OUT}`);
  return measured;
}

function load(path: string): FireRate[] {
  const saved = JSON.parse(readFileSync(path, 'utf8')) as { n: number; results: FireRate[] };
  const byId = new Map(saved.results.map((r) => [r.id, r]));
  const missing = selected.filter((e) => !byId.has(e.id)).map((e) => e.id);
  if (saved.n !== N || missing.length > 0) {
    throw new Error(`${path} does not match the current sample/lexicon (missing: ${missing.slice(0, 5).join(', ')})`);
  }
  return selected.map((e) => byId.get(e.id)!);
}

const results: FireRate[] = FROM ? load(FROM) : measure();

// ---------------------------------------------------------------------------------------
// Review file: top-N by fire-rate, a seeded random sample of the rest, summary stats.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.001 ? 3 : 2)}%`;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function sourcesCell(e: LexiconEntry): string {
  const ev = e.evidence ?? [];
  const indep = ev.filter((x) => !x.derivedFrom).map((x) => x.ref);
  const derived = ev.length - indep.length;
  const shortRef = (ref: string) => (ref.length > 70 ? `${ref.slice(0, 67)}…` : ref);
  const shown = indep.slice(0, 3).map(shortRef).join('; ');
  const more = indep.length > 3 ? `; +${indep.length - 3} more` : '';
  return `**${indep.length}**${derived ? ` (+${derived} derived)` : ''}: ${shown}${more}`;
}

function patternCell(e: LexiconEntry): string {
  return `\`${e.pattern}\`${e.inflect ? ' (+inflections)' : ''}`;
}

function row(e: LexiconEntry, r: FireRate, i: number, withExample: boolean): string {
  const cols = [
    String(i + 1),
    `\`${e.id.split('.').pop()}\``,
    patternCell(e),
    `${r.fires}/${N} (${pct(r.rate)})`,
    sourcesCell(e),
    cell(e.note),
    cell((e.suggestions ?? []).join(', ')),
  ];
  if (withExample) {
    cols.push(cell(r.examples[0] ? `${r.examples[0].arxivId}: ${r.examples[0].snippet}` : '—'));
  }
  return `| ${cols.map(cell).join(' | ')} |`;
}

function histogram(values: number[], bands: [string, (v: number) => boolean][]): string {
  return bands.map(([label, test]) => `| ${label} | ${values.filter(test).length} |`).join('\n');
}

function review(): string {
  const byId = new Map(selected.map((e) => [e.id, e]));
  const ranked = [...results].sort((a, b) => b.rate - a.rate || a.id.localeCompare(b.id));
  const top = ranked.slice(0, TOP);
  const rest = ranked.slice(TOP).sort((a, b) => a.id.localeCompare(b.id));
  const rand = mulberry32(SEED);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const sample = rest.slice(0, SAMPLE).sort((a, b) => b.rate - a.rate || a.id.localeCompare(b.id));

  const header = (withExample: boolean) =>
    `| # | entry | pattern | human fire-rate | independent sources | note | suggestions |${withExample ? ' example from a human abstract |' : ''}\n` +
    `|---|---|---|---|---|---|---|${withExample ? '---|' : ''}`;

  const rates = results.map((r) => r.rate);
  const counts = selected.map((e) => (e.evidence ?? []).filter((x) => !x.derivedFrom).length);
  const sorted = [...rates].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0;
  const mean = rates.reduce((s, v) => s + v, 0) / Math.max(1, rates.length);
  const one = 1 / Math.max(1, N);

  const rateBands: [string, (v: number) => boolean][] = [
    ['0 (no abstract)', (v) => v === 0],
    [`1 abstract (${pct(one)})`, (v) => v > 0 && v <= one],
    [`> 1 abstract, ≤ 0.25%`, (v) => v > one && v <= 0.0025],
    ['> 0.25%, ≤ 0.5%', (v) => v > 0.0025 && v <= 0.005],
    ['> 0.5%, ≤ 1%', (v) => v > 0.005 && v <= 0.01],
    ['> 1%, ≤ 2%', (v) => v > 0.01 && v <= 0.02],
    ['> 2%, ≤ 5%', (v) => v > 0.02 && v <= 0.05],
    ['> 5%', (v) => v > 0.05],
  ];
  const sourceBands: [string, (v: number) => boolean][] = [
    ['0', (v) => v === 0],
    ['1', (v) => v === 1],
    ['2', (v) => v === 2],
    ['3', (v) => v === 3],
    ['4', (v) => v === 4],
    ['5–9', (v) => v >= 5 && v <= 9],
    ['10+', (v) => v >= 10],
  ];
  const cross =
    `| independent sources \\ fire-rate | ${rateBands.map(([l]) => l).join(' | ')} |\n` +
    `|---|${rateBands.map(() => '---').join('|')}|\n` +
    sourceBands
      .map(([label, inBand]) => {
        const ids = selected.filter((e) => inBand((e.evidence ?? []).filter((x) => !x.derivedFrom).length));
        const cells = rateBands.map(
          ([, test]) => ids.filter((e) => test(results.find((r) => r.id === e.id)!.rate)).length,
        );
        return `| ${label} | ${cells.join(' | ')} |`;
      })
      .join('\n');

  return [
    `## (a) The ${top.length} ${STATUS || ''} entries with the highest human fire-rate`.replace('  ', ' '),
    '',
    header(true),
    ...top.map((r, i) => row(byId.get(r.id)!, r, i, true)),
    '',
    `## (b) Random sample of ${sample.length} of the remaining ${rest.length} entries (seed ${SEED})`,
    '',
    header(false),
    ...sample.map((r, i) => row(byId.get(r.id)!, r, i, false)),
    '',
    '## (c) Summary statistics',
    '',
    `- Entries measured: **${selected.length}** (${TIER}${STATUS ? `, status ${STATUS}` : ''}); abstracts: **${N}**.`,
    `- Fire-rate: median ${pct(median)}, mean ${pct(mean)}, max ${pct(sorted[sorted.length - 1] ?? 0)}.`,
    `- With ${N} abstracts, 0 fires means the true rate is below about ${pct(3 / Math.max(1, N))} (95% upper bound, rule of three).`,
    '',
    '### Fire-rate distribution',
    '',
    '| fire-rate | entries |',
    '|---|---|',
    histogram(rates, rateBands),
    '',
    '### Independent-source distribution',
    '',
    '| independent sources | entries |',
    '|---|---|',
    histogram(counts, sourceBands),
    '',
    '### Sources × fire-rate (entries per cell)',
    '',
    cross,
    '',
  ].join('\n');
}

if (REVIEW) {
  writeFileSync(REVIEW, review());
  console.log(`review → ${REVIEW}`);
}
