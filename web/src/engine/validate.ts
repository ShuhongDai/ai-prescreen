// Lexicon validation: pure functions, no Node or DOM APIs, so the same checks run in
// `npm run validate-lexicon` (Node) and in the Vitest suite.

import { literalSource } from './compile.ts';
import { isRewrittenOrRemoved, normalize } from './normalize.ts';
import { MATCH_KINDS, STATUSES, TIERS } from './types.ts';

export interface LexiconFile {
  /** File name or path; only the base name ("en.artifact.json") is checked. */
  fileName: string;
  data: unknown;
}

const KNOWN_KEYS = new Set([
  'id',
  'pattern',
  'match',
  'inflect',
  'tier',
  'lang',
  'status',
  'note',
  'suggestions',
  'models',
  'added',
  'evidence',
  'independentSources',
]);
const EVIDENCE_KEYS = new Set(['type', 'ref', 'url', 'derivedFrom']);
const URL = /^https?:\/\/\S+$/;
const REQUIRED_STRINGS = ['id', 'pattern', 'match', 'tier', 'lang', 'status', 'note', 'added'];

const LANG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FILE_NAME = new RegExp(`^([a-z]{2,3}(?:-[a-z0-9]{2,8})?)\\.(${TIERS.join('|')})\\.json$`);
// Probe text for zero-length matches: line starts/ends, blank lines, words, digits,
// punctuation and a few typical trigger words.
const PROBE =
  'Hello, world.\n\n  [x] **y** ## z\t\n' +
  'Sure! Certainly! Here is a draft (2024): 3.14, 20,000 - I am. As an AI, OK?\n';

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isValidDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Key used to detect duplicate patterns: what the engine actually compiles. "word" and
 * "phrase" entries share one key space (they compile to the same regex) and are
 * case-insensitive; regex sources keep their case, because \b and \B differ.
 */
export function patternKey(match: string, pattern: string): string {
  if (match === 'regex') return `regex:${normalize(pattern).trim()}`;
  try {
    return `literal:${literalSource(pattern).toLowerCase()}`;
  } catch {
    return `literal:${pattern.trim().toLowerCase()}`;
  }
}

/**
 * Removes lookarounds, anchors and \b / \B from a regex source, leaving the part that
 * consumes characters. Returns null if the source cannot be scanned.
 */
export function stripAssertions(source: string): string | null {
  let out = '';
  let i = 0;
  let inClass = false;
  const skipGroup = (): boolean => {
    // `i` points at "(" of a lookaround; skip to its matching ")".
    let depth = 0;
    let cls = false;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '\\') {
        i++;
        continue;
      }
      if (cls) {
        if (c === ']') cls = false;
        continue;
      }
      if (c === '[') cls = true;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) {
        i++;
        return true;
      }
    }
    return false;
  };
  while (i < source.length) {
    const c = source[i]!;
    if (c === '\\') {
      const next = source[i + 1];
      if (next === undefined) return null;
      if (!inClass && (next === 'b' || next === 'B')) {
        i += 2;
        continue;
      }
      out += c + next;
      i += 2;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      out += c;
      i++;
      continue;
    }
    if (c === '[') {
      inClass = true;
      out += c;
      i++;
      continue;
    }
    if (c === '^' || c === '$') {
      i++;
      continue;
    }
    if (c === '(' && /^\(\?(?:=|!|<=|<!)/.test(source.slice(i, i + 4))) {
      if (!skipGroup()) return null;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Code points named by \uXXXX, \u{...} or \xXX escapes in a regex source. */
function escapedCodePoints(source: string): number[] {
  const found: number[] = [];
  const re = /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|[^])/g;
  for (const m of source.matchAll(re)) {
    const hex = m[1] ?? m[2] ?? m[3];
    if (hex !== undefined) found.push(parseInt(hex, 16));
  }
  return found;
}

/** Returns an error message if the regex source is unusable, otherwise null. */
function checkRegexSource(source: string, flags: string): string | null {
  let re: RegExp;
  try {
    re = new RegExp(source, flags);
  } catch (err) {
    return `does not compile with flags "${flags}": ${(err as Error).message}`;
  }
  for (const text of ['', PROBE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (m[0].length === 0) return 'can match the empty string';
    }
  }
  // Structural check: if the consuming part (without lookarounds and anchors) can be
  // empty, the pattern can produce zero-length matches, which the engine discards.
  const consuming = stripAssertions(source);
  if (consuming !== null) {
    try {
      if (new RegExp(`^(?:${consuming})$`, flags.replace(/[gm]/g, '')).test('')) {
        return 'can match the empty string (its consuming part is optional)';
      }
    } catch {
      // Stripping changed group numbering or similar; the probe check above still ran.
    }
  }
  return null;
}

/** Regex-specific checks on the source as written (before normalisation). */
function checkRegexAuthoring(source: string): string | null {
  const bad = escapedCodePoints(source).filter(isRewrittenOrRemoved);
  for (const ch of source) {
    const code = ch.codePointAt(0)!;
    if (isRewrittenOrRemoved(code) && normalize(ch) === ch) bad.push(code);
  }
  if (bad.length === 0) return null;
  const list = [...new Set(bad)].map((c) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`);
  return (
    `names ${list.join(', ')}, which the engine rewrites or removes before matching ` +
    `(curly quotes, special spaces and hyphens become ASCII; invisible characters are ` +
    `dropped), so it can never match; write the ASCII form instead`
  );
}

/** Validates one entry; `where` prefixes every message. */
function validateEntry(
  entry: unknown,
  where: string,
  file: { lang: string; tier: string } | null,
): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(`${where}: ${msg}`);

  if (!isRecord(entry)) {
    err('entry must be an object');
    return errors;
  }

  for (const key of Object.keys(entry)) {
    if (!KNOWN_KEYS.has(key)) err(`unknown field "${key}"`);
  }
  for (const key of REQUIRED_STRINGS) {
    const v = entry[key];
    if (typeof v !== 'string') err(`"${key}" is required and must be a string`);
    else if (v.trim() === '') err(`"${key}" must not be empty`);
  }

  const { id, pattern, match, tier, lang, status, added } = entry;

  if (typeof match === 'string' && !(MATCH_KINDS as readonly string[]).includes(match)) {
    err(`"match" must be one of ${MATCH_KINDS.join(', ')} (got "${match}")`);
  }
  if (typeof tier === 'string' && !(TIERS as readonly string[]).includes(tier)) {
    err(`"tier" must be one of ${TIERS.join(', ')} (got "${tier}")`);
  }
  if (typeof status === 'string' && !(STATUSES as readonly string[]).includes(status)) {
    err(`"status" must be one of ${STATUSES.join(', ')} (got "${status}")`);
  }
  if (typeof lang === 'string' && !LANG.test(lang)) {
    err(`"lang" must be a lowercase language code such as "en" (got "${lang}")`);
  }
  if (typeof added === 'string' && !isValidDate(added)) {
    err(`"added" must be a valid date in YYYY-MM-DD format (got "${added}")`);
  }

  if (typeof id === 'string') {
    const parts = id.split('.');
    if (parts.length !== 3 || !SLUG.test(parts[2] ?? '')) {
      err(`"id" must look like "<lang>.<tier>.<kebab-slug>" (got "${id}")`);
    } else {
      if (typeof lang === 'string' && parts[0] !== lang) {
        err(`"id" language "${parts[0]}" does not match "lang" "${lang}"`);
      }
      if (typeof tier === 'string' && parts[1] !== tier) {
        err(`"id" tier "${parts[1]}" does not match "tier" "${tier}"`);
      }
    }
  }
  if (file) {
    if (typeof lang === 'string' && lang !== file.lang) {
      err(`"lang" "${lang}" does not match the file name language "${file.lang}"`);
    }
    if (typeof tier === 'string' && tier !== file.tier) {
      err(`"tier" "${tier}" does not match the file name tier "${file.tier}"`);
    }
  }

  if (entry.inflect !== undefined && typeof entry.inflect !== 'boolean') {
    err('"inflect" must be a boolean');
  }
  if (entry.inflect === true && match === 'regex') {
    err('"inflect" is not supported for regex patterns');
  }
  if (entry.suggestions !== undefined && !isStringArray(entry.suggestions)) {
    err('"suggestions" must be an array of strings');
  }
  if (entry.models !== undefined && !isStringArray(entry.models)) {
    err('"models" must be an array of strings');
  }
  let independent: number | null = null;
  if (entry.evidence !== undefined) {
    const ok =
      Array.isArray(entry.evidence) &&
      entry.evidence.every(
        (ev) => isRecord(ev) && typeof ev.type === 'string' && typeof ev.ref === 'string',
      );
    if (!ok) {
      err('"evidence" must be an array of { "type": string, "ref": string }');
    } else {
      (entry.evidence as Record<string, unknown>[]).forEach((ev, i) => {
        for (const key of Object.keys(ev)) {
          if (!EVIDENCE_KEYS.has(key)) err(`evidence[${i}]: unknown field "${key}"`);
        }
        if ((ev.type as string).trim() === '' || (ev.ref as string).trim() === '') {
          err(`evidence[${i}]: "type" and "ref" must not be empty`);
        }
        if (ev.url !== undefined && (typeof ev.url !== 'string' || !URL.test(ev.url))) {
          err(`evidence[${i}]: "url" must be an http(s) URL`);
        }
        if (ev.derivedFrom !== undefined && (typeof ev.derivedFrom !== 'string' || ev.derivedFrom.trim() === '')) {
          err(`evidence[${i}]: "derivedFrom" must be a non-empty string`);
        }
      });
      independent = (entry.evidence as Record<string, unknown>[]).filter(
        (ev) => ev.derivedFrom === undefined,
      ).length;
    }
  }
  if (entry.independentSources !== undefined) {
    const n = entry.independentSources;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      err('"independentSources" must be a non-negative integer');
    } else if (independent !== null && n !== independent) {
      err(
        `"independentSources" is ${n}, but ${independent} evidence item(s) have no "derivedFrom"`,
      );
    }
  }

  if (typeof pattern === 'string' && pattern.trim() !== '') {
    if (match === 'word' && /\s/.test(pattern.trim())) {
      err('"word" patterns must not contain whitespace (use "phrase")');
    }
    if (match === 'regex') {
      // Validate exactly what compileEntry() builds: the normalised source.
      const problem = checkRegexSource(normalize(pattern), 'gimu') ?? checkRegexAuthoring(pattern);
      if (problem) err(`regex pattern ${problem}`);
    } else if (match === 'word' || match === 'phrase') {
      const problem = checkRegexSource(literalSource(pattern), 'giu');
      if (problem) err(`${match} pattern ${problem}`);
    }
  }

  return errors;
}

/**
 * Validates one lexicon file's parsed JSON. Checks shape, fields, enums, id format,
 * consistency with the file name, regex validity and duplicates WITHIN the file.
 * Returns human-readable errors; an empty array means the file is valid.
 */
export function validateLexicon(fileName: string, data: unknown): string[] {
  const name = baseName(fileName);
  const errors: string[] = [];

  const fm = FILE_NAME.exec(name);
  if (!fm) {
    errors.push(`${name}: file name must look like "<lang>.<tier>.json" (tier: ${TIERS.join(', ')})`);
  }
  const file = fm ? { lang: fm[1]!, tier: fm[2]! } : null;

  if (!Array.isArray(data)) {
    errors.push(`${name}: file must contain a JSON array of entries`);
    return errors;
  }

  data.forEach((entry, i) => {
    const label = isRecord(entry) && typeof entry.id === 'string' ? ` (${entry.id})` : '';
    errors.push(...validateEntry(entry, `${name}[${i}]${label}`, file));
  });
  errors.push(...findDuplicates([{ fileName, data }]));
  return errors;
}

/**
 * Finds duplicate ids and duplicate patterns (see patternKey) across all given files.
 * Entries that are not objects are skipped.
 */
export function findDuplicates(files: readonly LexiconFile[]): string[] {
  const errors: string[] = [];
  const ids = new Map<string, string>();
  const patterns = new Map<string, string>();

  for (const { fileName, data } of files) {
    if (!Array.isArray(data)) continue;
    const name = baseName(fileName);
    data.forEach((entry, i) => {
      if (!isRecord(entry)) return;
      const where = `${name}[${i}]`;
      if (typeof entry.id === 'string') {
        const first = ids.get(entry.id);
        if (first) errors.push(`${where}: duplicate id "${entry.id}" (first at ${first})`);
        else ids.set(entry.id, where);
      }
      if (typeof entry.pattern === 'string' && typeof entry.match === 'string') {
        const key = patternKey(entry.match, entry.pattern);
        const first = patterns.get(key);
        const label = typeof entry.id === 'string' ? entry.id : where;
        if (first) errors.push(`${where} (${label}): duplicate ${entry.match} pattern (same as ${first})`);
        else patterns.set(key, label);
      }
    });
  }
  return errors;
}

/** Validates a set of lexicon files: every file on its own, plus cross-file duplicates. */
export function validateLexiconFiles(files: readonly LexiconFile[]): string[] {
  const perFile = files.flatMap((f) => validateLexicon(f.fileName, f.data));
  // Within-file duplicates were already reported per file; report only the extra
  // collisions that span files.
  const all = new Set(findDuplicates(files));
  for (const f of files) for (const e of findDuplicates([f])) all.delete(e);
  return [...perFile, ...all];
}
