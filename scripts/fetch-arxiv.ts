// Fetches a sample of pre-2022 arXiv abstracts (CC0 metadata) used ONLY as a measuring
// stick for lexicon candidates (human fire-rate; see CLAUDE.md, M2 notes). Never used by
// the engine or the web page.
//
//   node scripts/fetch-arxiv.ts                      # draw the sample, write ids + abstracts
//   node scripts/fetch-arxiv.ts --ids data/arxiv-sample-ids.txt   # re-fetch a saved sample
//
// Sampling: 10 subject groups x 3 years (2019-2021) x 3 random 7-day windows (fixed seed),
// up to PER_CELL papers per group-year, first-in-window by submission date. Papers whose
// latest version was updated in 2022 or later are dropped, so every abstract predates
// ChatGPT. Abstracts go to data/arxiv/ (gitignored); the id list is committed.
// Thank you to arXiv for use of its open access interoperability.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const API = 'https://export.arxiv.org/api/query';
const DELAY_MS = 3100; // arXiv API etiquette: at most one request every 3 seconds
const SEED = 20261022;
const YEARS = [2019, 2020, 2021];
const WINDOWS_PER_YEAR = 3;
const WINDOW_DAYS = 7;
const PER_CELL = 67; // 10 groups x 3 years x 67 ≈ 2,000
const CUTOFF = '2022-01-01T00:00:00Z';
const OUT_DIR = 'data/arxiv';
const ABSTRACTS = `${OUT_DIR}/abstracts-2019-2021.jsonl`;
const IDS = 'data/arxiv-sample-ids.txt';
const USER_AGENT = 'ai-prescreen lexicon measuring stick (https://github.com/ShuhongDai/ai-prescreen)';

const GROUPS: Record<string, string[]> = {
  'cs-nlp-ai': ['cs.CL', 'cs.AI', 'cs.IR', 'cs.HC'],
  'cs-ml': ['cs.LG', 'stat.ML'],
  'cs-other': ['cs.CV', 'cs.CR', 'cs.SE', 'cs.RO', 'cs.DC', 'cs.NI', 'cs.DS'],
  math: ['math.PR', 'math.AP', 'math.CO', 'math.NA', 'math.OC', 'math.AG', 'math.NT', 'math.DG'],
  'cond-mat': ['cond-mat.mtrl-sci', 'cond-mat.str-el', 'cond-mat.soft', 'cond-mat.mes-hall', 'cond-mat.stat-mech'],
  'astro-ph': ['astro-ph.GA', 'astro-ph.CO', 'astro-ph.SR', 'astro-ph.HE', 'astro-ph.EP', 'astro-ph.IM'],
  'hep-gr-nucl': ['hep-ph', 'hep-th', 'hep-ex', 'gr-qc', 'nucl-th'],
  'quant-physics': ['quant-ph', 'physics.optics', 'physics.flu-dyn', 'physics.bio-ph', 'physics.soc-ph', 'physics.chem-ph'],
  'bio-fin-econ': ['q-bio.NC', 'q-bio.QM', 'q-bio.PE', 'q-bio.BM', 'q-fin.ST', 'q-fin.GN', 'econ.EM', 'econ.GN'],
  'stat-eess': ['stat.ME', 'stat.AP', 'eess.SP', 'eess.IV', 'eess.SY', 'eess.AS'],
};

interface Abstract {
  id: string; // versioned, e.g. "1901.01234v2"
  published: string;
  updated: string;
  primaryCategory: string;
  group: string;
  title: string;
  abstract: string;
}

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const oneLine = (s: string) => decodeXml(s).replace(/\s+/g, ' ').trim();

function parseFeed(xml: string, group: string): Abstract[] {
  const out: Abstract[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]!;
    const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(e)?.[1] ?? '';
    const id = /arxiv\.org\/abs\/([^<\s]+)/.exec(tag('id'))?.[1];
    if (!id) continue;
    out.push({
      id,
      published: tag('published').trim(),
      updated: tag('updated').trim(),
      primaryCategory: /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(e)?.[1] ?? '',
      group,
      title: oneLine(tag('title')),
      abstract: oneLine(tag('summary')),
    });
  }
  return out;
}

async function query(params: Record<string, string>): Promise<string> {
  const url = `${API}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) return res.text();
    if (attempt >= 4) throw new Error(`HTTP ${res.status} for ${url}`);
    await sleep(DELAY_MS * attempt * 2);
  }
}

const stamp = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const baseId = (id: string) => id.replace(/v\d+$/, '');

async function drawSample(): Promise<Abstract[]> {
  const rand = mulberry32(SEED);
  const seen = new Set<string>();
  const sample: Abstract[] = [];
  for (const [group, cats] of Object.entries(GROUPS)) {
    for (const year of YEARS) {
      // Distinct, non-overlapping window starts within the year (days 0..357).
      const starts = new Set<number>();
      while (starts.size < WINDOWS_PER_YEAR) starts.add(Math.floor(rand() * (365 - WINDOW_DAYS)));
      const perWindow = Math.ceil(PER_CELL / WINDOWS_PER_YEAR);
      let cell = 0;
      for (const day of [...starts].sort((a, b) => a - b)) {
        const from = new Date(Date.UTC(year, 0, 1 + day));
        const to = new Date(Date.UTC(year, 0, 1 + day + WINDOW_DAYS - 1));
        const xml = await query({
          search_query: `(${cats.map((c) => `cat:${c}`).join(' OR ')}) AND submittedDate:[${stamp(from)}0000 TO ${stamp(to)}2359]`,
          start: '0',
          max_results: String(perWindow * 2),
          sortBy: 'submittedDate',
          sortOrder: 'ascending',
        });
        await sleep(DELAY_MS);
        let taken = 0;
        for (const a of parseFeed(xml, group)) {
          if (taken >= perWindow || cell >= PER_CELL) break;
          if (a.updated >= CUTOFF || a.abstract.length < 200 || seen.has(baseId(a.id))) continue;
          seen.add(baseId(a.id));
          sample.push(a);
          taken++;
          cell++;
        }
        console.log(`${group} ${year} window ${stamp(from)}: +${taken}`);
      }
    }
  }
  return sample;
}

async function refetch(idFile: string): Promise<Abstract[]> {
  const ids = readFileSync(idFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const out: Abstract[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const xml = await query({ id_list: chunk.join(','), max_results: String(chunk.length) });
    out.push(...parseFeed(xml, ''));
    await sleep(DELAY_MS);
    console.log(`fetched ${out.length}/${ids.length}`);
  }
  return out;
}

const idsArg = process.argv.indexOf('--ids');
const abstracts = idsArg > 0 ? await refetch(process.argv[idsArg + 1]!) : await drawSample();
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(ABSTRACTS, abstracts.map((a) => JSON.stringify(a)).join('\n') + '\n');
if (idsArg < 0) writeFileSync(IDS, abstracts.map((a) => a.id).join('\n') + '\n');
const byGroup = new Map<string, number>();
for (const a of abstracts) byGroup.set(a.group, (byGroup.get(a.group) ?? 0) + 1);
console.log(`\n${abstracts.length} abstracts → ${ABSTRACTS}`, Object.fromEntries(byGroup));
