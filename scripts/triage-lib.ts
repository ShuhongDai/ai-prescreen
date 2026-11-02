// Pure logic for `npm run triage` (no Node APIs, so it is unit-tested): parse report issues
// from the GitHub issue forms, turn new-phrase reports into lexicon candidates, and count
// false-positive reports per entry.

import { literalSource } from '../web/src/engine/compile.ts';
import type { Evidence, LexiconEntry, Tier } from '../web/src/engine/types.ts';
import { patternKey, validateLexicon } from '../web/src/engine/validate.ts';
import { ENTRY_ID, FIELD_MAX, MODEL_NAME } from '../web/src/report-contract.ts';

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
}

export type Report =
  | { kind: 'new-phrase'; issue: number; url: string; phrase: string; tier: Tier; example: string; model: string }
  | { kind: 'false-positive'; issue: number; url: string; entryId: string; matchedText: string; example: string; comment: string }
  | { kind: 'unparsed'; issue: number; url: string; reason: string };

/** Longest phrase (in words) that becomes a lexicon pattern; longer reports are listed only. */
export const MAX_PATTERN_WORDS = 8;

/** Each issue form's field labels, in order (.github/ISSUE_TEMPLATE/). */
export const FORM_FIELDS = {
  'new-phrase': ['Phrase', 'Suggested tier', 'Example sentence', 'Model it came from'],
  'false-positive': ['Entry id', 'Matched text', 'Example sentence', 'Comment'],
} as const;

export const FORM_LABELS: readonly string[] = [...new Set([...FORM_FIELDS['new-phrase'], ...FORM_FIELDS['false-positive']])];

/** The textarea fields: only their values can hold a code block. */
const MULTILINE_FIELDS: readonly string[] = ['Example sentence', 'Comment'];

interface Fence {
  char: string;
  length: number;
}

/** A line opening a fenced code block (CommonMark: up to 3 spaces, 3+ ` or ~). */
function fenceOpen(line: string): Fence | null {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m || (m[1]![0] === '`' && m[2]!.includes('`'))) return null;
  return { char: m[1]![0]!, length: m[1]!.length };
}

const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

const fenceCloses = (line: string, fence: Fence) => {
  const m = CLOSING_FENCE.exec(line);
  return m !== null && m[1]![0] === fence.char && m[1]!.length >= fence.length;
};

/**
 * GitHub renders an issue form as "### <field label>" followed by the value; empty
 * optional fields read "_No response_". Reports sent through the Worker (worker/src/
 * reports.ts) read the same, with the reported text in a code span or code block, which is
 * unwrapped here. A section starts only at one of `labels` (the form's own), outside a code
 * block, and only the first section of a label counts, so reported text cannot fake a
 * field. A code block counts only in a textarea field and only when it is closed again
 * (the rule preprocess.ts follows). Lines end at line feeds only (not at U+2028).
 * Returns label → value ('' when empty).
 */
export function parseIssueForm(body: string, labels: readonly string[] = FORM_LABELS): Record<string, string> {
  const fields: Record<string, string> = {};
  const all = body.replace(/\r\n?/g, '\n').split('\n');
  // closers[i]: the longest closing fence of each kind on line i or later.
  const closers: Record<string, number>[] = [];
  closers[all.length] = { '`': 0, '~': 0 };
  for (let i = all.length - 1; i >= 0; i--) {
    const m = CLOSING_FENCE.exec(all[i]!);
    const here = { ...closers[i + 1]! };
    if (m) here[m[1]![0]!] = Math.max(here[m[1]![0]!]!, m[1]!.length);
    closers[i] = here;
  }
  let label: string | null = null;
  let lines: string[] = [];
  let fence: Fence | null = null;
  const end = () => {
    if (label === null) return;
    const value = lines.join('\n').trim();
    fields[label] = value === '_No response_' ? '' : unwrapCode(value);
  };
  all.forEach((line, i) => {
    if (fence) {
      if (fenceCloses(line, fence)) fence = null;
    } else {
      const heading = /^### +(.+?)[ \t]*$/.exec(line)?.[1];
      if (heading !== undefined && labels.includes(heading) && heading !== label && !(heading in fields)) {
        end();
        label = heading;
        lines = [];
        return;
      }
      const open = label !== null && MULTILINE_FIELDS.includes(label) ? fenceOpen(line) : null;
      if (open && closers[i + 1]![open.char]! >= open.length) fence = open;
    }
    lines.push(line);
  });
  end();
  return fields;
}

/** The text inside a value that is exactly one fenced code block or one code span. */
export function unwrapCode(value: string): string {
  const block = /^(`{3,})[^`\n]*\n([\s\S]*?)\n\1$/.exec(value);
  if (block) return block[2]!;
  const fence = /^`+/.exec(value)?.[0] ?? '';
  const n = fence.length;
  if (n === 0 || value.length <= 2 * n || !value.endsWith(fence) || value[value.length - n - 1] === '`') return value;
  const inner = value.slice(n, -n);
  // A run of exactly n backticks inside would have closed the span earlier.
  if ((inner.match(/`+/g) ?? []).some((run) => run.length === n)) return value;
  return inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() ? inner.slice(1, -1) : inner;
}

export function normalizePhrase(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function tierOf(choice: string): Tier | null {
  const c = choice.toLowerCase();
  if (c.startsWith('artifact')) return 'artifact';
  if (c.startsWith('overused')) return 'lexical';
  if (c.startsWith('style')) return 'stylistic';
  return null;
}

export function toReport(issue: Issue): Report {
  const base = { issue: issue.number, url: issue.url };
  if (issue.labels.includes('report:new-phrase')) {
    const f = parseIssueForm(issue.body, FORM_FIELDS['new-phrase']);
    const phrase = normalizePhrase(f['Phrase'] ?? '');
    const tier = tierOf(f['Suggested tier'] ?? '');
    if (!phrase) return { kind: 'unparsed', ...base, reason: 'no phrase' };
    if (!tier) return { kind: 'unparsed', ...base, reason: 'no suggested tier' };
    // Only a model name may end up in a lexicon entry's `models`.
    const model = f['Model it came from'] ?? '';
    const modelOk = MODEL_NAME.test(model) && Array.from(model).length <= FIELD_MAX.model;
    return { kind: 'new-phrase', ...base, phrase, tier, example: f['Example sentence'] ?? '', model: modelOk ? model : '' };
  }
  if (issue.labels.includes('report:false-positive')) {
    const f = parseIssueForm(issue.body, FORM_FIELDS['false-positive']);
    const entryId = (f['Entry id'] ?? '').trim();
    if (!entryId) return { kind: 'unparsed', ...base, reason: 'no entry id' };
    if (!ENTRY_ID.test(entryId)) return { kind: 'unparsed', ...base, reason: 'invalid entry id' };
    return {
      kind: 'false-positive',
      ...base,
      entryId,
      matchedText: normalizePhrase(f['Matched text'] ?? ''),
      example: f['Example sentence'] ?? '',
      comment: f['Comment'] ?? '',
    };
  }
  return { kind: 'unparsed', ...base, reason: 'neither report:new-phrase nor report:false-positive' };
}

export interface LexiconFile {
  fileName: string;
  entries: LexiconEntry[];
}

export interface TriageResult {
  added: { entryId: string; fileName: string; pattern: string; issues: number[] }[];
  merged: { entryId: string; status: string; issues: number[]; how: 'same pattern' | 'already matched' }[];
  skipped: { issue: number; phrase: string; reason: string }[];
  falsePositives: {
    entryId: string;
    status: string | null;
    count: number;
    issues: number[];
    matched: string[];
    comments: string[];
  }[];
  unparsed: { issue: number; reason: string }[];
  /** Every issue this run handled, for `triage --close` later. */
  processed: { issue: number; kind: 'new-phrase' | 'false-positive'; entryId: string | null }[];
}

export interface TriageOptions {
  /** YYYY-MM-DD for new entries' "added". */
  today: string;
  /** ID of an active entry that matches the whole phrase, or null (engine-based in the script). */
  matchedBy: (phrase: string) => string | null;
}

// Cut first, then trim: a cut may end at a dash.
const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'phrase';

function addEvidence(entry: LexiconEntry, report: Extract<Report, { kind: 'new-phrase' }>): boolean {
  const ref = `#${report.issue}`;
  entry.evidence ??= [];
  if (entry.evidence.some((e) => e.ref === ref)) return false;
  const item: Evidence = { type: 'user-report', ref, url: report.url };
  entry.evidence.push(item);
  if (entry.independentSources !== undefined) {
    entry.independentSources = entry.evidence.filter((e) => !e.derivedFrom).length;
  }
  if (report.model && !(entry.models ?? []).includes(report.model)) entry.models = [...(entry.models ?? []), report.model];
  return true;
}

/** Mutates the given files' entry arrays; returns what changed, for the review file. */
export function triage(reports: readonly Report[], files: readonly LexiconFile[], opts: TriageOptions): TriageResult {
  const result: TriageResult = { added: [], merged: [], skipped: [], falsePositives: [], unparsed: [], processed: [] };
  const all = () => files.flatMap((f) => f.entries);
  const byKey = new Map<string, LexiconEntry>();
  for (const e of all()) byKey.set(patternKey(e.match, e.pattern), e);
  const fileFor = (tier: Tier) => files.find((f) => f.fileName === `en.${tier}.json`);
  const note = (list: { entryId: string; issues: number[] }[], entryId: string, issue: number) => {
    const row = list.find((r) => r.entryId === entryId);
    if (row) row.issues.push(issue);
    return row;
  };

  for (const r of reports) {
    if (r.kind === 'unparsed') {
      result.unparsed.push({ issue: r.issue, reason: r.reason });
      continue;
    }
    if (r.kind === 'false-positive') {
      const entry = all().find((e) => e.id === r.entryId) ?? null;
      let row = result.falsePositives.find((x) => x.entryId === r.entryId);
      if (!row) {
        row = { entryId: r.entryId, status: entry?.status ?? null, count: 0, issues: [], matched: [], comments: [] };
        result.falsePositives.push(row);
      }
      row.count++;
      row.issues.push(r.issue);
      if (r.matchedText && !row.matched.includes(r.matchedText)) row.matched.push(r.matchedText);
      if (r.comment) row.comments.push(r.comment);
      result.processed.push({ issue: r.issue, kind: 'false-positive', entryId: r.entryId });
      continue;
    }

    // New phrase.
    const words = r.phrase.split(' ').length;
    const file = fileFor(r.tier);
    if (words > MAX_PATTERN_WORDS || !file) {
      result.skipped.push({
        issue: r.issue,
        phrase: r.phrase,
        reason: !file ? `no lexicon file for tier "${r.tier}" yet` : `longer than ${MAX_PATTERN_WORDS} words`,
      });
      result.processed.push({ issue: r.issue, kind: 'new-phrase', entryId: null });
      continue;
    }
    const pattern = r.phrase.toLowerCase();
    const match = words === 1 ? 'word' : 'phrase';
    let key: string;
    try {
      literalSource(pattern);
      key = patternKey(match, pattern);
    } catch {
      result.unparsed.push({ issue: r.issue, reason: `unusable phrase "${r.phrase}"` });
      continue;
    }

    const same = byKey.get(key);
    const coveredId = same ? null : opts.matchedBy(r.phrase);
    const existing = same ?? (coveredId ? all().find((e) => e.id === coveredId) : undefined);
    if (existing) {
      addEvidence(existing, r);
      const added = result.added.find((a) => a.entryId === existing.id);
      if (added) {
        if (!added.issues.includes(r.issue)) added.issues.push(r.issue);
      } else if (!note(result.merged, existing.id, r.issue)) {
        result.merged.push({ entryId: existing.id, status: existing.status, issues: [r.issue], how: same ? 'same pattern' : 'already matched' });
      }
      result.processed.push({ issue: r.issue, kind: 'new-phrase', entryId: existing.id });
      continue;
    }

    const taken = new Set(all().map((e) => e.id));
    let id = `en.${r.tier}.${slugOf(pattern)}`;
    for (let n = 2; taken.has(id); n++) id = `en.${r.tier}.${slugOf(pattern)}-${n}`;
    const entry: LexiconEntry = {
      id,
      pattern,
      match,
      inflect: false,
      tier: r.tier,
      lang: 'en',
      status: 'candidate',
      note: 'Reported by users as AI-like; still under review.',
      suggestions: [],
      models: [],
      added: opts.today,
      evidence: [],
      ...(r.tier === 'lexical' ? { independentSources: 0 } : {}),
    };
    addEvidence(entry, r);
    // One unusable report must not stop the whole batch (the lexicon is validated as a whole).
    const problems = validateLexicon(file.fileName, [entry]);
    if (problems.length > 0) {
      result.unparsed.push({ issue: r.issue, reason: `unusable entry: ${problems[0]}` });
      continue;
    }
    file.entries.push(entry);
    byKey.set(key, entry);
    result.added.push({ entryId: id, fileName: file.fileName, pattern, issues: [r.issue] });
    result.processed.push({ issue: r.issue, kind: 'new-phrase', entryId: id });
  }
  result.falsePositives.sort((a, b) => b.count - a.count || a.entryId.localeCompare(b.entryId));
  return result;
}

/** What `triage --close` does with one processed issue, given the entry's current status. */
export function closingAction(
  p: TriageResult['processed'][number],
  status: string | null,
): { close: false } | { close: true; reason: 'completed' | 'not planned'; comment: string } {
  if (p.entryId === null || status === null || status === 'candidate') return { close: false };
  const id = `\`${p.entryId}\``;
  if (p.kind === 'new-phrase') {
    return status === 'retired'
      ? { close: true, reason: 'not planned', comment: `Thanks for the report! Reviewed: ${id} is not flagged (retired).` }
      : { close: true, reason: 'completed', comment: `Thanks for the report! ${id} is in the lexicon (${status}).` };
  }
  return status === 'retired'
    ? { close: true, reason: 'completed', comment: `Thanks for the report! ${id} has been retired and is no longer flagged.` }
    : {
        close: true,
        reason: 'not planned',
        comment: `Thanks for the report! Reviewed: ${id} stays in the lexicon. On the site you can hide it with "Not AI-like (false positive)" or lower the sensitivity.`,
      };
}
