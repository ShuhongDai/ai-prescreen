import { describe, expect, it } from 'vitest';
import type { LexiconEntry } from '../web/src/engine/index.ts';
import { validateLexiconFiles } from '../web/src/engine/validate.ts';
import { closingAction, parseIssueForm, toReport, triage, type Issue, type LexiconFile } from '../scripts/triage-lib.ts';

// Bodies as GitHub renders the issue forms in .github/ISSUE_TEMPLATE/.
const phraseBody = (phrase: string, tier: string, model = '_No response_') =>
  `### Phrase\n\n${phrase}\n\n### Suggested tier\n\n${tier}\n\n### Example sentence\n\n_No response_\n\n### Model it came from\n\n${model}`;
const fpBody = (entryId: string, matched: string, comment = '_No response_') =>
  `### Entry id\n\n${entryId}\n\n### Matched text\n\n${matched}\n\n### Example sentence\n\n_No response_\n\n### Comment\n\n${comment}`;
const issue = (number: number, label: string, body: string): Issue => ({
  number,
  title: 't',
  body,
  url: `https://github.com/ShuhongDai/ai-prescreen/issues/${number}`,
  labels: ['report', label],
});

const entry = (id: string, pattern: string, extra: Partial<LexiconEntry> = {}): LexiconEntry => ({
  id,
  pattern,
  match: /\s/.test(pattern) ? 'phrase' : 'word',
  inflect: false,
  tier: id.split('.')[1] as LexiconEntry['tier'],
  lang: 'en',
  status: 'accepted',
  note: 'n',
  suggestions: [],
  models: [],
  added: '2026-10-22',
  evidence: [],
  ...extra,
});

describe('issue forms', () => {
  it('parses fields and empty optional answers', () => {
    expect(parseIssueForm(phraseBody('delve into', 'overused word', 'GPT-4o'))).toEqual({
      Phrase: 'delve into',
      'Suggested tier': 'overused word',
      'Example sentence': '',
      'Model it came from': 'GPT-4o',
    });
  });

  it('turns issues into reports', () => {
    expect(toReport(issue(1, 'report:new-phrase', phraseBody(' “Delve  into” ', 'overused word')))).toMatchObject({
      kind: 'new-phrase',
      phrase: 'Delve into',
      tier: 'lexical',
    });
    expect(toReport(issue(2, 'report:false-positive', fpBody('en.lexical.delve', 'delve')))).toMatchObject({
      kind: 'false-positive',
      entryId: 'en.lexical.delve',
      matchedText: 'delve',
    });
    expect(toReport(issue(3, 'report:new-phrase', phraseBody('_No response_', 'style')))).toMatchObject({ kind: 'unparsed' });
    expect(toReport({ ...issue(4, 'bug', ''), labels: ['report'] })).toMatchObject({ kind: 'unparsed' });
  });
});

describe('triage', () => {
  const files = (): LexiconFile[] => [
    { fileName: 'en.artifact.json', entries: [entry('en.artifact.certainly-here-is', 'certainly here is')] },
    {
      fileName: 'en.lexical.json',
      entries: [
        entry('en.lexical.delve', 'delve', {
          evidence: [{ type: 'paper', ref: 'Kobak et al.' }],
          independentSources: 1,
        }),
      ],
    },
  ];
  const reports = [
    issue(1, 'report:new-phrase', phraseBody('Delve', 'overused word', 'GPT-4o')),
    issue(2, 'report:new-phrase', phraseBody('rich tapestry of', 'overused word')),
    issue(3, 'report:new-phrase', phraseBody('Rich tapestry of', 'overused word')),
    issue(4, 'report:new-phrase', phraseBody('Certainly! Here is', 'artifact (chatbot leftover)')),
    issue(5, 'report:new-phrase', phraseBody('not only … but also', 'style')),
    issue(6, 'report:new-phrase', phraseBody('one two three four five six seven eight nine', 'overused word')),
    issue(7, 'report:false-positive', fpBody('en.lexical.delve', 'delve')),
    issue(8, 'report:false-positive', fpBody('en.lexical.delve', 'delves', 'Literal use in geology.')),
    issue(9, 'report:false-positive', fpBody('en.lexical.nope', 'x')),
  ].map(toReport);

  it('adds candidates, merges duplicates and counts false positives', () => {
    const f = files();
    const r = triage(reports, f, {
      today: '2026-10-23',
      matchedBy: (p) => (p.startsWith('Certainly') ? 'en.artifact.certainly-here-is' : null),
    });
    expect(r.added).toEqual([
      { entryId: 'en.lexical.rich-tapestry-of', fileName: 'en.lexical.json', pattern: 'rich tapestry of', issues: [2, 3] },
    ]);
    expect(r.merged).toEqual([
      { entryId: 'en.lexical.delve', status: 'accepted', issues: [1], how: 'same pattern' },
      { entryId: 'en.artifact.certainly-here-is', status: 'accepted', issues: [4], how: 'already matched' },
    ]);
    expect(r.skipped.map((s) => s.issue)).toEqual([5, 6]);
    expect(r.falsePositives).toEqual([
      { entryId: 'en.lexical.delve', status: 'accepted', count: 2, issues: [7, 8], matched: ['delve', 'delves'], comments: ['Literal use in geology.'] },
      { entryId: 'en.lexical.nope', status: null, count: 1, issues: [9], matched: ['x'], comments: [] },
    ]);

    const delve = f[1]!.entries.find((e) => e.id === 'en.lexical.delve')!;
    expect(delve.evidence!.map((e) => e.ref)).toEqual(['Kobak et al.', '#1']);
    // Reports are evidence, but never independent sources (decision 2026-11-02).
    expect(delve).toMatchObject({ independentSources: 1, userReports: 1, models: ['GPT-4o'] });
    const added = f[1]!.entries.find((e) => e.id === 'en.lexical.rich-tapestry-of')!;
    expect(added).toMatchObject({ status: 'candidate', match: 'phrase', independentSources: 0, userReports: 2 });
    expect(added.evidence!.map((e) => [e.type, e.ref])).toEqual([['user-report', '#2'], ['user-report', '#3']]);
    expect(validateLexiconFiles(f.map((x) => ({ fileName: x.fileName, data: x.entries })))).toEqual([]);
  });

  it('is idempotent: running twice adds no evidence twice', () => {
    const f = files();
    const opts = { today: '2026-10-23', matchedBy: () => null };
    triage(reports, f, opts);
    const once = JSON.stringify(f);
    triage(reports, f, opts);
    expect(JSON.stringify(f)).toBe(once);
  });
});

describe('issue forms filed on github.com', () => {
  const phraseForm = (example: string, model = '_No response_') =>
    `### Phrase\n\ndelve into\n\n### Suggested tier\n\noverused word\n\n### Example sentence\n\n${example}\n\n### Model it came from\n\n${model}`;
  const fpForm = (matched: string, example: string, comment: string) =>
    `### Entry id\n\nen.lexical.delve\n\n### Matched text\n\n${matched}\n\n### Example sentence\n\n${example}\n\n### Comment\n\n${comment}`;

  it('reads Markdown and a typed code block as the field\'s text, also with CRLF', () => {
    const example = 'We **delve** into it.\n```\n### Model it came from\nfake\n```';
    for (const body of [phraseForm(example, 'Claude'), phraseForm(example, 'Claude').replace(/\n/g, '\r\n')]) {
      expect(toReport(issue(1, 'report:new-phrase', body))).toMatchObject({ phrase: 'delve into', example, model: 'Claude' });
    }
  });

  it('reads each form with its own labels only', () => {
    const report = toReport(issue(2, 'report:false-positive', fpForm('delve', 'Notes\n### Phrase\nrest', 'why')));
    expect(report).toMatchObject({ entryId: 'en.lexical.delve', example: 'Notes\n### Phrase\nrest', comment: 'why' });
  });

  it('opens a code block only in a textarea and only when it is closed again', () => {
    const fenceInInput = toReport(issue(3, 'report:false-positive', fpForm('```python', '_No response_', 'A code listing.')));
    expect(fenceInInput).toMatchObject({ matchedText: 'python', comment: 'A code listing.' });
    const unclosed = toReport(issue(4, 'report:false-positive', fpForm('delve', '```\ncode', 'Still here.')));
    expect(unclosed).toMatchObject({ example: '```\ncode', comment: 'Still here.' });
  });

  it('keeps only model names', () => {
    expect(toReport(issue(5, 'report:new-phrase', phraseForm('_No response_', 'GPT-4o (via Copilot)')))).toMatchObject({ model: 'GPT-4o (via Copilot)' });
    for (const model of ['www.tracker.example/x', 'see https://x.example', '@octocat', 'x'.repeat(81)]) {
      expect(toReport(issue(6, 'report:new-phrase', phraseForm('_No response_', model)))).toMatchObject({ model: '' });
    }
  });
});

describe('triage of reports filed without an account', () => {
  it('gives a new stylistic candidate a source count of 0 and one user report', () => {
    const files = (): LexiconFile[] => [{ fileName: 'en.stylistic.json', entries: [] }];
    const f = files();
    const result = triage([toReport(issue(1, 'report:new-phrase', phraseBody('at its very heart', 'style')))], f, {
      today: '2026-11-02',
      matchedBy: () => null,
    });
    expect(result.added).toHaveLength(1);
    expect(f[0]!.entries[0]).toMatchObject({ tier: 'stylistic', independentSources: 0, userReports: 1 });
    expect(validateLexiconFiles(f.map((x) => ({ fileName: x.fileName, data: x.entries })))).toEqual([]);
  });

  it('cuts long slugs cleanly and never lets one unusable report stop the batch', () => {
    const files = (): LexiconFile[] => [{ fileName: 'en.lexical.json', entries: [] }];
    const long = 'a comprehensive understanding of the multifaceted interplay between';
    const result = triage([toReport(issue(1, 'report:new-phrase', phraseBody(long, 'overused word')))], files(), {
      today: '2026-10-30',
      matchedBy: () => null,
    });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]!.entryId).toMatch(/^en\.lexical\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(result.added[0]!.entryId.length).toBeLessThanOrEqual('en.lexical.'.length + 60);
  });
});

describe('closing processed issues', () => {
  it('waits for a decision, then comments and closes', () => {
    const p = (kind: 'new-phrase' | 'false-positive', entryId: string | null) => ({ issue: 1, kind, entryId });
    expect(closingAction(p('new-phrase', 'en.lexical.x'), 'candidate')).toEqual({ close: false });
    expect(closingAction(p('new-phrase', null), null)).toEqual({ close: false });
    expect(closingAction(p('new-phrase', 'en.lexical.x'), 'accepted')).toMatchObject({ close: true, reason: 'completed' });
    expect(closingAction(p('new-phrase', 'en.lexical.x'), 'retired')).toMatchObject({ close: true, reason: 'not planned' });
    expect(closingAction(p('false-positive', 'en.lexical.x'), 'retired')).toMatchObject({ close: true, reason: 'completed' });
    expect(closingAction(p('false-positive', 'en.lexical.x'), 'accepted')).toMatchObject({ close: true, reason: 'not planned' });
  });
});
