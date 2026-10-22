// Measures, on the pre-2022 arXiv sample, (1) each lexical entry's human fire count (the
// entry compiled on its own) and (2) the human baseline per tier-2 sensitivity level:
// lexical hits per 1,000 words with the default (non-experimental) lexicon. Writes
// web/src/baseline.json. Re-run after changing lexical entries or their status;
// tests/baseline.test.ts fails until you do. Takes a few minutes.
//
//   node scripts/baseline.ts [--abstracts data/arxiv/abstracts-2019-2021.jsonl]

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TIERS, analyze, compileLexicon, type LexiconEntry } from '../web/src/engine/index.ts';
import {
  defaultLexical,
  lexiconFingerprint,
  measuredLexical,
  type Baseline,
  type LevelBaseline,
} from '../web/src/ui/baseline.ts';
import { SENSITIVITIES, bySensitivity, type FireData } from '../web/src/ui/sensitivity.ts';

const i = process.argv.indexOf('--abstracts');
const ABSTRACTS = i > 0 ? process.argv[i + 1]! : 'data/arxiv/abstracts-2019-2021.jsonl';
const OUT = 'web/src/baseline.json';

const lexicon: LexiconEntry[] = readdirSync('lexicon')
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(`lexicon/${f}`, 'utf8')) as LexiconEntry[]);
const abstracts = readFileSync(ABSTRACTS, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { abstract: string; published: string });

// (1) Fire counts, each entry compiled on its own (as in scripts/fire-rate.ts).
const measured = measuredLexical(lexicon);
const fires: Record<string, number> = {};
measured.forEach((entry, n) => {
  const compiled = compileLexicon([entry], { includeCandidates: true, tiers: TIERS });
  const count = abstracts.filter((a) =>
    analyze(a.abstract, compiled).matches.some((m) => m.entryId === entry.id),
  ).length;
  if (count > 0) fires[entry.id] = count;
  if ((n + 1) % 250 === 0) console.log(`fire counts: ${n + 1}/${measured.length}`);
});
const fireData: FireData = { abstracts: abstracts.length, fires };

// (2) Baseline per level, with the default lexical entries the page shows at that level.
const round = (x: number) => Math.round(x * 100) / 100;
let words = 0;
function measure(entries: LexiconEntry[]): LevelBaseline {
  const compiled = compileLexicon(entries);
  let hits = 0;
  words = 0;
  const rates: number[] = [];
  for (const a of abstracts) {
    const { stats } = analyze(a.abstract, compiled);
    hits += stats.counts.lexical;
    words += stats.words;
    if (stats.words > 0) rates.push((stats.counts.lexical / stats.words) * 1000);
  }
  rates.sort((x, y) => x - y);
  const quantile = (q: number) => rates[Math.min(rates.length - 1, Math.floor(q * rates.length))] ?? 0;
  return {
    lexicalEntries: entries.length,
    pooledPer1k: round((hits / words) * 1000),
    meanPer1k: round(rates.reduce((s, r) => s + r, 0) / rates.length),
    medianPer1k: round(quantile(0.5)),
    p90Per1k: round(quantile(0.9)),
  };
}
const levels = Object.fromEntries(
  SENSITIVITIES.map((level) => [level, measure(bySensitivity(defaultLexical(lexicon), level, fireData))]),
) as Baseline['levels'];

const years = [...new Set(abstracts.map((a) => a.published.slice(0, 4)))].sort();
const sortedFires = Object.fromEntries(Object.entries(fires).sort(([a], [b]) => (a < b ? -1 : 1)));
const baseline: Baseline = {
  generated: new Date().toLocaleDateString('sv-SE'),
  years: `${years[0]}–${years[years.length - 1]!.slice(2)}`,
  abstracts: abstracts.length,
  words,
  fingerprint: lexiconFingerprint(lexicon),
  levels,
  fires: sortedFires,
};
writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n');
console.log(`${measured.length} lexical entries measured on ${abstracts.length} abstracts → ${OUT}`);
console.log(levels);
