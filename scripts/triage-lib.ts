// Pure logic for `npm run triage` (no Node APIs, so it is unit-tested): parse report issues
// from the GitHub issue forms, turn new-phrase reports into lexicon candidates, and count
// false-positive reports per entry.

import { literalSource } from '../web/src/engine/compile.ts';
import type { Evidence, LexiconEntry, Tier } from '../web/src/engine/types.ts';
import { patternKey } from '../web/src/engine/validate.ts';

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

/**
 * GitHub renders an issue form as "### <field label>" followed by the value; empty
 * optional fields read "_No response_". Returns label → value ('' when empty).
 */
export function parseIssueForm(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const parts = body.replace(/\r\n?/g, '\n').split(/^### +(.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const value = (parts[i + 1] ?? '').trim();
    fields[parts[i]!.trim()] = value === '_No response_' ? '' : value;
  }
  return fields;
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
  const f = parseIssueForm(issue.body);
  if (issue.labels.includes('report:new-phrase')) {
    const phrase = normalizePhrase(f['Phrase'] ?? '');
    const tier = tierOf(f['Suggested tier'] ?? '');
    if (!phrase) return { kind: 'unparsed', ...base, reason: 'no phrase' };
    if (!tier) return { kind: 'unparsed', ...base, reason: 'no suggested tier' };
    return { kind: 'new-phrase', ...base, phrase, tier, example: f['Example sentence'] ?? '', model: f['Model it came from'] ?? '' };
  }
  if (issue.labels.includes('report:false-positive')) {
    const entryId = (f['Entry id'] ?? '').trim();
    if (!entryId) return { kind: 'unparsed', ...base, reason: 'no entry id' };
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

const slugOf = (s: string) =>
  s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'phrase';

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
