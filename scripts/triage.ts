// Triage of user reports (GitHub issues labelled "report"), in two steps:
//
//   npm run triage                    fetch open reports, add new phrases to lexicon/*.json as
//                                     candidates (or as evidence on existing entries), write
//                                     reviews/triage-<date>.md, then stop
//   npm run triage -- --close         after Shuhong has decided: show the comments/closes
//   npm run triage -- --close --yes   ... and do them (issues whose entry is still a
//                                     candidate stay open)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TIERS, analyze, compileLexicon, type LexiconEntry } from '../web/src/engine/index.ts';
import { validateLexiconFiles } from '../web/src/engine/validate.ts';
import { closingAction, toReport, triage, type Issue, type TriageResult } from './triage-lib.ts';

const REPO = 'ShuhongDai/ai-prescreen';
const STATE = 'reviews/triage-state.json';
const today = new Date().toLocaleDateString('sv-SE');

const gh = (args: string[]) => execFileSync('gh', [...args, '--repo', REPO], { encoding: 'utf8' });

function readLexicon(): { fileName: string; entries: LexiconEntry[] }[] {
  return readdirSync('lexicon')
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((fileName) => ({ fileName, entries: JSON.parse(readFileSync(`lexicon/${fileName}`, 'utf8')) as LexiconEntry[] }));
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const issues = (ns: number[]) => ns.map((n) => `#${n}`).join(', ');

function reviewFile(r: TriageResult, total: number): string {
  const lines = [
    `# Triage ${today}`,
    '',
    `${total} open report issue(s): ${r.processed.filter((p) => p.kind === 'new-phrase').length} new phrase, ` +
      `${r.processed.filter((p) => p.kind === 'false-positive').length} false positive, ${r.unparsed.length} unparsed.`,
    '',
    '## New lexicon candidates',
    '',
    r.added.length ? '| entry | pattern | file | issues |\n|---|---|---|---|' : '_None._',
    ...r.added.map((a) => `| \`${a.entryId}\` | \`${cell(a.pattern)}\` | ${a.fileName} | ${issues(a.issues)} |`),
    '',
    '## Reports added as evidence to existing entries',
    '',
    r.merged.length ? '| entry | status | how | issues |\n|---|---|---|---|' : '_None._',
    ...r.merged.map((m) => `| \`${m.entryId}\` | ${m.status} | ${m.how} | ${issues(m.issues)} |`),
    '',
    '## Not turned into entries',
    '',
    r.skipped.length ? '| issue | phrase | reason |\n|---|---|---|' : '_None._',
    ...r.skipped.map((s) => `| #${s.issue} | ${cell(s.phrase)} | ${s.reason} |`),
    '',
    '## False positives per entry',
    '',
    r.falsePositives.length ? '| entry | status | reports | issues | matched text | comments |\n|---|---|---|---|---|---|' : '_None._',
    ...r.falsePositives.map(
      (f) =>
        `| \`${f.entryId}\` | ${f.status ?? 'unknown id'} | ${f.count} | ${issues(f.issues)} | ${cell(f.matched.join('; '))} | ${cell(f.comments.join(' / '))} |`,
    ),
    '',
    '## Unparsed issues',
    '',
    r.unparsed.length ? r.unparsed.map((u) => `- #${u.issue}: ${u.reason}`).join('\n') : '_None._',
    '',
    '## Next steps',
    '',
    '1. Decide in lexicon/*.json: set new candidates to `accepted` or `retired`; for false positives,',
    '   retire or narrow the entry, or keep it.',
    '2. `npm run baseline` (if lexical entries changed), `npm test`, `npm run validate-lexicon`, commit, push.',
    '3. `npm run triage -- --close` to preview, then `npm run triage -- --close --yes` to comment on and',
    '   close the processed issues (reports whose entry is still a candidate stay open).',
    '',
  ];
  return lines.join('\n');
}

function collect(): void {
  const raw = JSON.parse(
    gh(['issue', 'list', '--label', 'report', '--state', 'open', '--limit', '500', '--json', 'number,title,body,url,labels']),
  ) as (Omit<Issue, 'labels'> & { labels: { name: string }[] })[];
  const reports = raw
    .map((i) => toReport({ ...i, labels: i.labels.map((l) => l.name) }))
    .sort((a, b) => a.issue - b.issue);

  const files = readLexicon();
  const before = files.map((f) => JSON.stringify(f.entries));
  const active = compileLexicon(files.flatMap((f) => f.entries), { includeCandidates: true, tiers: TIERS });
  const result = triage(reports, files, {
    today,
    // An active entry that matches the whole reported phrase already covers it.
    matchedBy: (phrase) =>
      analyze(phrase, active).matches.find((m) => m.start === 0 && m.end === phrase.length)?.entryId ?? null,
  });

  const errors = validateLexiconFiles(files.map((f) => ({ fileName: f.fileName, data: f.entries })));
  if (errors.length > 0) {
    console.error('Lexicon would be invalid; nothing written:\n' + errors.join('\n'));
    process.exit(1);
  }
  files.forEach((f, i) => {
    if (JSON.stringify(f.entries) !== before[i]) writeFileSync(`lexicon/${f.fileName}`, JSON.stringify(f.entries, null, 2) + '\n');
  });
  if (!existsSync('reviews')) mkdirSync('reviews');
  const review = `reviews/triage-${today}.md`;
  writeFileSync(review, reviewFile(result, raw.length));
  writeFileSync(STATE, JSON.stringify({ date: today, processed: result.processed }, null, 2) + '\n');
  console.log(
    `${raw.length} report(s): ${result.added.length} new candidate(s), ${result.merged.length} merged, ` +
      `${result.falsePositives.length} entr(y/ies) with false-positive reports, ${result.unparsed.length} unparsed → ${review}`,
  );
  if (result.added.some((a) => a.fileName.includes('lexical'))) console.log('Lexical entries changed: run npm run baseline.');
}

function close(execute: boolean): void {
  if (!existsSync(STATE)) {
    console.error(`No ${STATE}; run npm run triage first.`);
    process.exit(1);
  }
  const state = JSON.parse(readFileSync(STATE, 'utf8')) as { processed: TriageResult['processed'] };
  const status = new Map(readLexicon().flatMap((f) => f.entries).map((e) => [e.id, e.status as string]));
  const remaining: TriageResult['processed'] = [];
  for (const p of state.processed) {
    const action = closingAction(p, p.entryId ? (status.get(p.entryId) ?? null) : null);
    if (!action.close) {
      console.log(`#${p.issue}: stays open (${p.entryId ?? 'no entry'}${p.entryId ? `, ${status.get(p.entryId) ?? 'unknown'}` : ''})`);
      remaining.push(p);
      continue;
    }
    console.log(`#${p.issue}: close as ${action.reason} — ${action.comment}`);
    if (execute) {
      gh(['issue', 'comment', String(p.issue), '--body', action.comment]);
      gh(['issue', 'close', String(p.issue), '--reason', action.reason]);
    }
  }
  if (execute) writeFileSync(STATE, JSON.stringify({ ...state, processed: remaining }, null, 2) + '\n');
  else console.log('\nDry run. Add --yes to comment and close.');
}

if (process.argv.includes('--close')) close(process.argv.includes('--yes'));
else collect();
