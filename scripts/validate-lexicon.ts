// Validates every lexicon/*.json file. Run with `npm run validate-lexicon`
// (Node 24 runs this file directly via type stripping; keep to erasable TS syntax).

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLexiconFiles, type LexiconFile } from '../web/src/engine/validate.ts';

const lexiconDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lexicon');
const names = readdirSync(lexiconDir)
  .filter((n) => n.endsWith('.json'))
  .sort();

const errors: string[] = [];
const files: LexiconFile[] = [];
for (const name of names) {
  const text = readFileSync(join(lexiconDir, name), 'utf8');
  try {
    files.push({ fileName: name, data: JSON.parse(text) });
  } catch (err) {
    errors.push(`${name}: invalid JSON: ${(err as Error).message}`);
  }
}
errors.push(...validateLexiconFiles(files));

if (names.length === 0) errors.push('lexicon/: no *.json files found');

if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} lexicon error(s).`);
  process.exit(1);
}

const byStatus = new Map<string, number>();
let entries = 0;
for (const f of files) {
  for (const entry of f.data as Array<{ status: string }>) {
    entries++;
    byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + 1);
  }
}
const statusSummary = [...byStatus].map(([s, n]) => `${n} ${s}`).join(', ');
console.log(
  `Lexicon OK: ${files.length} file(s), ${entries} entries (${statusSummary || 'none'}).`,
);
