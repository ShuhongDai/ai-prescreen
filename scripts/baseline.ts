// Measures the human baseline for the summary line: lexical hits per 1,000 words in the
// pre-2022 arXiv sample with the default (non-experimental) lexicon, and writes
// web/src/baseline.json. Re-run after changing which lexical entries are accepted;
// tests/baseline.test.ts fails until you do.
//
//   node scripts/baseline.ts [--abstracts data/arxiv/abstracts-2019-2021.jsonl]

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { analyze, compileLexicon, type LexiconEntry } from '../web/src/engine/index.ts';
import { defaultLexical, lexiconFingerprint, type Baseline } from '../web/src/ui/baseline.ts';

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
  .map((line) => (JSON.parse(line) as { abstract: string; published: string }));

const compiled = compileLexicon(defaultLexical(lexicon));
let hits = 0;
let words = 0;
const rates: number[] = [];
for (const a of abstracts) {
  const { stats } = analyze(a.abstract, compiled);
  hits += stats.counts.lexical;
  words += stats.words;
  if (stats.words > 0) rates.push((stats.counts.lexical / stats.words) * 1000);
}
rates.sort((x, y) => x - y);
const quantile = (q: number) => rates[Math.min(rates.length - 1, Math.floor(q * rates.length))] ?? 0;
const round = (x: number) => Math.round(x * 100) / 100;
const years = [...new Set(abstracts.map((a) => a.published.slice(0, 4)))].sort();

const baseline: Baseline = {
  generated: new Date().toLocaleDateString('sv-SE'),
  years: `${years[0]}–${years[years.length - 1]!.slice(2)}`,
  abstracts: abstracts.length,
  words,
  lexicalEntries: defaultLexical(lexicon).length,
  fingerprint: lexiconFingerprint(lexicon),
  pooledPer1k: round((hits / words) * 1000),
  meanPer1k: round(rates.reduce((s, r) => s + r, 0) / rates.length),
  medianPer1k: round(quantile(0.5)),
  p90Per1k: round(quantile(0.9)),
};
writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n');
console.log(`${hits} lexical hits in ${words} words of ${abstracts.length} abstracts → ${OUT}`);
console.log(baseline);
