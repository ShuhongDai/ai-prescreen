// Preprocessing: turns raw pasted text into the text that lexicon patterns run on, plus a
// map from every code unit of that text back to the original.
//
// Every rule applies to every input. Nothing tries to decide whether a text "is" LaTeX,
// Markdown or an email; a rule fires wherever its own syntax appears.
//
// - Normalisation (1:1): curly quotes, special spaces and Unicode hyphens become ASCII.
// - Masking (1:1): characters become spaces; line breaks stay, so line-anchored artifact
//   regexes keep working. LaTeX math, comments, citations/references and command names,
//   the content of closed Markdown code fences, and inline code. For inline code and
//   $-math only the content is masked: the delimiters stay, so "**`x`**" and "**$x$**"
//   still look like bold markers with text inside.
// - Removal (recorded in the map): invisible format characters, hyphenation breaks
//   ("compre-\nhensive"), LaTeX discretionary hyphens and accent commands.
// - "~" (LaTeX no-break space) becomes a space.
//
// Markdown markers such as ** and ### are left alone: they are tier-1 signals themselves.

import { isInvisible, normalize } from './normalize.ts';

export interface Preprocessed {
  /** The text that lexicon patterns and word counting run on. */
  text: string;
  /**
   * Original offset of every code unit of `text`, plus one final entry
   * `map[text.length] === original.length`. A span [s, e) of `text` (e > s) covers
   * [map[s], map[e - 1] + 1) of the original text.
   */
  map: Int32Array;
}

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const DOLLAR = 0x24;
const PERCENT = 0x25;
const LPAREN = 0x28;
const STAR = 0x2a;
const HYPHEN = 0x2d;
const LBRACKET = 0x5b;
const BACKSLASH = 0x5c;
const RBRACKET = 0x5d;
const BACKTICK = 0x60;
const LBRACE = 0x7b;
const RBRACE = 0x7d;
const TILDE = 0x7e;
const SOFT_HYPHEN = 0xad;

/** Commands masked together with their optional [..] and first {..} argument. */
const MASKED_COMMANDS = new Set([
  'cite', 'citep', 'citet', 'citealp', 'citealt', 'citeauthor', 'citeyear', 'citeyearpar',
  'citenum', 'Cite', 'Citep', 'Citet', 'parencite', 'Parencite', 'textcite', 'Textcite',
  'autocite', 'Autocite', 'footcite', 'fullcite', 'nocite',
  'ref', 'eqref', 'cref', 'Cref', 'autoref', 'pageref', 'nameref', 'vref', 'label',
  'includegraphics', 'input', 'include', 'bibliography', 'bibliographystyle',
  'addbibresource', 'bibitem', 'usepackage', 'documentclass', 'vspace', 'hspace',
]);

/** Commands whose {..} argument is visible text: only the command, braces and optional
 * [..] arguments are masked. A URL stays visible too: artifact entries look for
 * chatbot tracking parameters in it. */
const TEXT_COMMANDS = new Set([
  'emph', 'textbf', 'textit', 'textsc', 'textsl', 'textrm', 'textsf', 'texttt', 'textup',
  'textmd', 'textnormal', 'underline', 'mbox', 'part', 'chapter', 'section', 'subsection',
  'subsubsection', 'paragraph', 'subparagraph', 'caption', 'footnote', 'title', 'item', 'url',
]);

/** Font switches used inside a group: "{\em text}", "{\bf text}". The group's braces are
 * masked like a formatting command's. */
const DECLARATIONS = new Set([
  'em', 'bf', 'it', 'sl', 'sc', 'rm', 'sf', 'tt', 'bfseries', 'mdseries', 'itshape', 'slshape',
  'scshape', 'upshape', 'rmfamily', 'sffamily', 'ttfamily', 'normalfont', 'tiny', 'scriptsize',
  'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge',
]);

const MATH_ENVIRONMENTS = new Set(
  ['equation', 'align', 'alignat', 'flalign', 'gather', 'multline', 'eqnarray', 'math', 'displaymath']
    .flatMap((name) => [name, `${name}*`]),
);

// Characters the main loop stops at. Everything else is copied as is.
const SPECIAL = /[\\$%`{}~\-\n\r\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const FENCE_OPEN = /[ \t]*(`{3,})([^\n\r]*)/y;
// A "~~~" fence line: three or more tildes, an optional info string, nothing else.
const TILDE_FENCE = /~{3,}[\w+#.-]{0,20}[ \t]*(?=\r\n|\n|\r|$)/y;
const LINE_BREAK = /\r\n|\n|\r/g;
const BLANK_LINE = /(?:\r\n|\n|\r(?!\n))[ \t]*(?:\r\n|\n|\r)/g;
const ENV_NAME = /[ \t]*\{([A-Za-z]+\*?)\}/y;
const HYPHEN_BREAK = /[ \t]*(?:\r\n|\n|\r)[ \t]*(?=\p{Ll})/uy;
const LETTER = /^\p{L}$/u;
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
const URL_START = /[a-z][a-z0-9+.-]*:\/\/|www\./i;
const NOT_LINE_BREAK = /[^\n\r\u2028\u2029]/g;

const isAsciiLetter = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const isHex = (c: number) => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isBlank = (c: number) => c === SPACE || c === TAB;
const isSpace = (c: number) => c === SPACE || c === TAB || c === LF || c === CR;

/** The code point that ends just before `pos`. */
function codePointBefore(t: string, pos: number): number {
  const low = t.charCodeAt(pos - 1);
  if (low >= 0xdc00 && low <= 0xdfff && pos >= 2) {
    const high = t.charCodeAt(pos - 2);
    if (high >= 0xd800 && high <= 0xdbff) return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
  }
  return low;
}

function isLetterAt(t: string, pos: number): boolean {
  const c = t.charCodeAt(pos);
  if (c < 0x80) return isAsciiLetter(c);
  const cp = t.codePointAt(pos);
  return cp !== undefined && LETTER.test(String.fromCodePoint(cp));
}

function isLetterBefore(t: string, pos: number): boolean {
  if (pos === 0) return false;
  const cp = codePointBefore(t, pos);
  return cp < 0x80 ? isAsciiLetter(cp) : LETTER_OR_MARK.test(String.fromCodePoint(cp));
}

/** True if the character at `pos` is preceded by an odd number of backslashes. */
function isEscaped(t: string, pos: number): boolean {
  let k = pos - 1;
  while (k >= 0 && t.charCodeAt(k) === BACKSLASH) k--;
  return (pos - 1 - k) % 2 === 1;
}

/** Position of the line break that ends the line containing `pos` (or the text length). */
function lineEndFrom(t: string, pos: number): number {
  LINE_BREAK.lastIndex = pos;
  const m = LINE_BREAK.exec(t);
  return m === null ? t.length : m.index;
}

/** True if the line break at `pos` is followed by a blank line (a paragraph break). */
function blankLineAfter(t: string, pos: number): boolean {
  let q = pos + (t.charCodeAt(pos) === CR && t.charCodeAt(pos + 1) === LF ? 2 : 1);
  while (isBlank(t.charCodeAt(q))) q++;
  const c = t.charCodeAt(q);
  return c === LF || c === CR;
}

/** The whitespace-delimited token last checked by inUrl and the answer for it. */
interface TokenMemo {
  start: number;
  end: number;
  url: boolean;
}

const tokenMemo = (): TokenMemo => ({ start: 0, end: 0, url: false });

/** True if the whitespace-delimited token around `pos` looks like a URL ("https://…",
 * "www.…"). Decided once per token, so a long URL full of "%20" stays linear. */
function inUrl(t: string, pos: number, memo: TokenMemo): boolean {
  if (pos >= memo.start && pos < memo.end) return memo.url;
  let start = pos;
  while (start > 0 && !isSpace(t.charCodeAt(start - 1))) start--;
  let end = pos;
  while (end < t.length && !isSpace(t.charCodeAt(end))) end++;
  memo.start = start;
  memo.end = end;
  memo.url = URL_START.test(t.slice(start, end));
  return memo.url;
}

/**
 * Whether an unescaped "%" starts a LaTeX comment (callers check escaping). It does at
 * the start of a line (after blanks), after whitespace, "}" or a "\\" line break, and at
 * the end of a line ("foo%", which LaTeX uses to swallow the line break). Not in prose:
 * "x%", "(%)", "[%]", "10 mol% Pd", "85 wt.% and". After a number, with or without
 * blanks, it is a percentage ("20%", "5  % of"), and percent-encoding in a URL
 * ("https://example.org/a%20b") is no comment either.
 */
function isCommentAt(t: string, pos: number, memo: TokenMemo): boolean {
  let b = pos - 1;
  while (b >= 0 && isBlank(t.charCodeAt(b))) b--;
  if (b >= 0 && isDigit(t.charCodeAt(b))) return false;
  if (isHex(t.charCodeAt(pos + 1)) && isHex(t.charCodeAt(pos + 2)) && inUrl(t, pos, memo)) return false;
  const before = t.charCodeAt(pos - 1);
  if (pos === 0 || isSpace(before) || before === RBRACE || before === BACKSLASH) return true;
  let q = pos + 1;
  while (isBlank(t.charCodeAt(q))) q++;
  return q >= t.length || t.charCodeAt(q) === LF || t.charCodeAt(q) === CR;
}

/**
 * For every "{", the position of its matching "}" (or -1). Escaped braces and comments
 * are skipped; a paragraph break closes nothing and forgets all open braces, like LaTeX,
 * so one stray "{" cannot pair up with a brace pages later.
 */
function matchBraces(t: string): Int32Array {
  const match = new Int32Array(t.length).fill(-1);
  const open: number[] = [];
  const memo = tokenMemo();
  const re = /[\\%{}\n\r]/g;
  let i = 0;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(t);
    if (m === null) break;
    const j = m.index;
    i = j + 1;
    switch (t.charCodeAt(j)) {
      case BACKSLASH:
        i = j + 2;
        break;
      case PERCENT:
        if (isCommentAt(t, j, memo)) i = lineEndFrom(t, j);
        break;
      case LBRACE:
        open.push(j);
        break;
      case RBRACE: {
        const o = open.pop();
        if (o !== undefined) match[o] = j;
        break;
      }
      default:
        if (open.length > 0 && blankLineAfter(t, j)) open.length = 0;
    }
  }
  return match;
}

/** Lines that hold nothing but 3+ backticks (and blanks): the possible closing fences. */
interface FenceLines {
  /** Start of the line, end of the line (its line break or the text end), backtick count. */
  start: number[];
  end: number[];
  count: number[];
}

function fenceLines(t: string): FenceLines {
  const lines: FenceLines = { start: [], end: [], count: [] };
  for (let p = t.indexOf('```'); p >= 0; ) {
    let q = p;
    while (t.charCodeAt(q) === BACKTICK) q++;
    let s = p;
    while (s > 0 && isBlank(t.charCodeAt(s - 1))) s--;
    let e = q;
    while (isBlank(t.charCodeAt(e))) e++;
    const before = t.charCodeAt(s - 1);
    const after = t.charCodeAt(e);
    if ((s === 0 || before === LF || before === CR) && (e === t.length || after === LF || after === CR)) {
      lines.start.push(s);
      lines.end.push(e);
      lines.count.push(q - p);
    }
    p = t.indexOf('```', q);
  }
  return lines;
}

/** Positions of maximal backtick runs, grouped by run length. */
function backtickRuns(t: string): Map<number, { pos: number[]; next: number }> {
  const runs = new Map<number, { pos: number[]; next: number }>();
  for (let p = t.indexOf('`'); p >= 0; ) {
    let q = p + 1;
    while (t.charCodeAt(q) === BACKTICK) q++;
    const list = runs.get(q - p);
    if (list) list.pos.push(p);
    else runs.set(q - p, { pos: [p], next: 0 });
    p = t.indexOf('`', q);
  }
  return runs;
}

/**
 * Memoises a forward search `find(from)` that returns the first valid position >= from
 * (or -1). The preprocessor asks with increasing `from`: a question at or before the
 * last answer reuses it, and a new search starts after it, so all searches of one kind
 * together scan the text at most once (no quadratic blow-up on unclosed delimiters).
 */
function forwardSearch(find: (from: number) => number): (from: number) => number {
  let memoFrom = -1;
  let memoPos = -1;
  return (from) => {
    if (memoFrom >= 0 && memoFrom <= from && (memoPos < 0 || from <= memoPos)) return memoPos;
    memoFrom = from;
    memoPos = find(from);
    return memoPos;
  };
}

export function preprocess(original: string): Preprocessed {
  const t = normalize(original);
  const n = t.length;
  const map = new Int32Array(n + 1);
  const parts: string[] = [];
  let o = 0; // length of the output so far
  let run = 0; // start of the stretch of `t` that is pending and will be copied as is

  // ---- output

  const keepTo = (end: number): void => {
    if (end > run) {
      parts.push(t.slice(run, end));
      for (let k = run; k < end; k++) map[o++] = k;
    }
    run = end;
  };
  const mask = (start: number, end: number): void => {
    keepTo(start);
    if (end <= start) return;
    const s = t.slice(start, end);
    parts.push(s.length < 64 && !/[\n\r\u2028\u2029]/.test(s) ? ' '.repeat(s.length) : s.replace(NOT_LINE_BREAK, ' '));
    for (let k = start; k < end; k++) map[o++] = k;
    run = end;
  };
  const drop = (start: number, end: number): void => {
    keepTo(start);
    run = end;
  };
  const replace = (pos: number, ch: string): void => {
    keepTo(pos);
    parts.push(ch);
    map[o++] = pos;
    run = pos + 1;
  };

  // ---- lazily built lookups

  let braces: Int32Array | null = null;
  let flagged: Uint8Array | null = null; // braces of command arguments, masked when reached
  let runs: ReturnType<typeof backtickRuns> | null = null;
  let fences: FenceLines | null = null;
  const urlMemo = tokenMemo();
  const fenceNext = new Map<number, number>(); // per opening length: next candidate to try
  const envEnds = new Map<string, (from: number) => number>();

  const braceMatch = (p: number): number => (braces ??= matchBraces(t))[p]!;
  const flag = (p: number): void => {
    (flagged ??= new Uint8Array(n))[p] = 1;
  };
  const skipBlanks = (p: number): number => {
    while (isBlank(t.charCodeAt(p))) p++;
    return p;
  };

  const paraEnd = forwardSearch((from) => {
    BLANK_LINE.lastIndex = from;
    const m = BLANK_LINE.exec(t);
    return m === null ? n : m.index;
  });
  const lineEnd = forwardSearch((from) => lineEndFrom(t, from));
  const unescaped = (needle: string) =>
    forwardSearch((from) => {
      let q = t.indexOf(needle, from);
      while (q >= 0 && isEscaped(t, q)) q = t.indexOf(needle, q + 1);
      return q;
    });
  const displayDollarClose = unescaped('$$');
  const nextDollar = unescaped('$');
  const bracketClose = unescaped('\\]');
  const parenClose = unescaped('\\)');
  const envEnd = (name: string, from: number): number => {
    let search = envEnds.get(name);
    if (!search) envEnds.set(name, (search = unescaped(`\\end{${name}}`)));
    return search(from);
  };
  /** Index of the first fence line after `from` with at least `length` backticks, or -1. */
  const closingFence = (length: number, from: number): number => {
    const f = (fences ??= fenceLines(t));
    let k = fenceNext.get(length) ?? 0;
    while (k < f.start.length && (f.start[k]! <= from || f.count[k]! < length)) k++;
    fenceNext.set(length, k);
    return k < f.start.length ? k : -1;
  };
  /**
   * The run closing inline code that opened before `from`: the next run of the same
   * length before `limit` (the line end). Runs between two letters ("don`t") are
   * apostrophes and are skipped. The first other run decides: it closes if it has a
   * non-blank before it; otherwise nothing closes ("``AI-polished" ... ``human").
   */
  const closingRun = (length: number, from: number, limit: number): number => {
    const list = (runs ??= backtickRuns(t)).get(length);
    if (!list) return -1;
    while (list.next < list.pos.length && list.pos[list.next]! < from) list.next++;
    for (let r = list.next; r < list.pos.length; r++) {
      const p = list.pos[r]!;
      if (p >= limit) return -1;
      if (isLetterBefore(t, p) && isLetterAt(t, p + length)) continue;
      return isSpace(t.charCodeAt(p - 1)) ? -1 : p;
    }
    return -1;
  };

  const nextRightBracket = forwardSearch((from) => t.indexOf(']', from));
  /** Position of the "]" closing an optional argument that opens at `p`, or -1. Optional
   * arguments are short: the search gives up after 300 characters. */
  const closingBracket = (p: number): number => {
    const limit = Math.min(n, p + 300);
    const first = nextRightBracket(p);
    if (first < 0 || first >= limit) return -1;
    let depth = 0;
    for (let q = p; q < limit; q++) {
      const c = t.charCodeAt(q);
      if (c === BACKSLASH) q++;
      else if (c === LBRACE) {
        const e = braceMatch(q);
        if (e < 0) return -1;
        q = e;
      } else if (c === LBRACKET) depth++;
      else if (c === RBRACKET && --depth === 0) return q;
      else if ((c === LF || c === CR) && blankLineAfter(t, q)) return -1;
    }
    return -1;
  };
  /** Skips up to `max` optional [..] arguments at `p`; returns the position after them. */
  const optionalArgs = (p: number, max: number): number => {
    for (let k = 0; k < max; k++) {
      const q = skipBlanks(p);
      if (t.charCodeAt(q) !== LBRACKET) break;
      const e = closingBracket(q);
      if (e < 0) break;
      p = e + 1;
    }
    return p;
  };
  /** Position of the "}" closing a {..} argument at `p` (after blanks), or -1. */
  const requiredArg = (p: number): number => {
    const q = skipBlanks(p);
    return t.charCodeAt(q) === LBRACE ? braceMatch(q) : -1;
  };
  /** Marks the braces of up to `max` consecutive {..} groups at `p`; their text stays. */
  const textArgs = (p: number, max: number): void => {
    let q = skipBlanks(p);
    for (let k = 0; k < max && t.charCodeAt(q) === LBRACE; k++) {
      const e = braceMatch(q);
      if (e < 0) return;
      flag(q);
      flag(e);
      q = e + 1;
    }
  };

  /** True if a font switch like "\em" or "\bfseries" starts at `p`. */
  const declarationAt = (p: number): boolean => {
    if (t.charCodeAt(p) !== BACKSLASH) return false;
    let k = p + 1;
    while (isAsciiLetter(t.charCodeAt(k))) k++;
    return k > p + 1 && DECLARATIONS.has(t.slice(p + 1, k));
  };

  // ---- rules

  /**
   * At the start of a line: a Markdown code fence (3+ backticks, optionally followed by an
   * info string) masks the lines up to its closing fence, a later line of only backticks,
   * at least as many. Without a closing fence it is not a code block and nothing is
   * masked: hiding the rest of a document is worse than missing a highlight. The fence
   * lines themselves stay visible ("```python" is an artifact signal of its own).
   */
  const lineStart = (p: number): number => {
    if (p >= n) return p;
    FENCE_OPEN.lastIndex = p;
    const open = FENCE_OPEN.exec(t);
    if (open === null || open[2]!.includes('`')) return p; // no fence, or inline code
    const openEnd = p + open[0].length;
    const close = closingFence(open[1]!.length, openEnd);
    if (close < 0) return p;
    mask(skipLineBreak(openEnd), fences!.start[close]!);
    return fences!.end[close]!;
  };
  /** End of the tilde run if `p` starts a "~~~" fence line (after optional blanks), else -1. */
  const tildeFenceEnd = (p: number): number => {
    let k = p - 1;
    while (k >= 0 && (t.charCodeAt(k) === 0x20 || t.charCodeAt(k) === 0x09)) k--;
    if (k >= 0 && t.charCodeAt(k) !== LF && t.charCodeAt(k) !== CR) return -1;
    TILDE_FENCE.lastIndex = p;
    if (!TILDE_FENCE.test(t)) return -1;
    let e = p;
    while (t.charCodeAt(e) === TILDE) e++;
    return e;
  };
  const skipLineBreak = (p: number): number => {
    if (t.charCodeAt(p) === CR) return t.charCodeAt(p + 1) === LF ? p + 2 : p + 1;
    return t.charCodeAt(p) === LF ? p + 1 : p;
  };

  /** \begin{…} / \end{…}: math environments are masked whole; others lose the
   * command and its environment name. */
  const environment = (j: number, k: number, begin: boolean): number => {
    ENV_NAME.lastIndex = k;
    const env = ENV_NAME.exec(t);
    if (env === null) {
      mask(j, k);
      return k;
    }
    const name = env[1]!;
    let end = k + env[0].length;
    if (begin && MATH_ENVIRONMENTS.has(name)) {
      const close = envEnd(name, end);
      if (close >= 0) end = close + name.length + 6; // "\end{" + name + "}"
      mask(j, end);
      return end;
    }
    if (begin && t.charCodeAt(end) === LBRACKET) {
      const e = closingBracket(end);
      if (e >= 0) end = e + 1;
    }
    mask(j, end);
    if (begin) textArgs(end, Infinity);
    return end;
  };

  const backslash = (j: number): number => {
    if (j + 1 >= n) return n;
    const c = t.charCodeAt(j + 1);
    if (isAsciiLetter(c)) {
      let k = j + 2;
      while (isAsciiLetter(t.charCodeAt(k))) k++;
      const name = t.slice(j + 1, k);
      if (t.charCodeAt(k) === STAR) k++;
      if (name === 'begin' || name === 'end') return environment(j, k, name === 'begin');
      if (MASKED_COMMANDS.has(name)) {
        k = optionalArgs(k, 2);
        const e = requiredArg(k);
        if (e >= 0) k = e + 1;
        mask(j, k);
        return k;
      }
      if (name === 'href') {
        // \href{url}{text}: both stay visible, only the command and braces go.
        mask(j, k);
        textArgs(k, 2);
        return k;
      }
      if (TEXT_COMMANDS.has(name)) {
        k = optionalArgs(k, 2);
        mask(j, k);
        textArgs(k, 1);
        return k;
      }
      // Unknown command: hide its name, keep the text of directly following {..} groups.
      mask(j, k);
      textArgs(k, Infinity);
      return k;
    }
    switch (c) {
      case LBRACKET:
      case LPAREN: {
        // \[ … \] and \( … \): math, within one paragraph.
        const close = c === LBRACKET ? bracketClose(j + 2) : parenClose(j + 2);
        if (close >= 0 && close < paraEnd(j)) {
          mask(j, close + 2);
          return close + 2;
        }
        break;
      }
      case BACKSLASH: {
        // \\ line break, with an optional * and [length].
        let k = j + 2;
        if (t.charCodeAt(k) === STAR) k++;
        if (t.charCodeAt(k) === LBRACKET) {
          let e = k + 1;
          while (e < n && e - k <= 20 && t.charCodeAt(e) !== RBRACKET && !isSpace(t.charCodeAt(e))) e++;
          if (t.charCodeAt(e) === RBRACKET) k = e + 1;
        }
        mask(j, k);
        return k;
      }
      case HYPHEN:
        // \- discretionary hyphen inside a word: "hy\-phen" -> "hyphen".
        if (isLetterBefore(t, j) && isLetterAt(t, j + 2)) {
          drop(j, j + 2);
          return j + 2;
        }
        break;
      case 0x27: // \'  accents: "caf\'e" -> "cafe", "na\"{i}ve" -> "naive"
      case 0x60: // \`
      case 0x5e: // \^
      case 0x22: // \"
      case TILDE: // \~
      case 0x3d: // \=
      case 0x2e: // \.
        if (isLetterAt(t, j + 2)) {
          drop(j, j + 2);
          return j + 2;
        }
        if (
          t.charCodeAt(j + 2) === LBRACE &&
          isAsciiLetter(t.charCodeAt(j + 3)) &&
          t.charCodeAt(j + 4) === RBRACE
        ) {
          drop(j, j + 3);
          drop(j + 4, j + 5);
          return j + 5;
        }
        break;
      case 0x2c: // \,  thin space
      case 0x3b: // \;
      case SPACE: // "\ " control space
      case TAB:
      case 0x40: // \@
      case 0x2f: // \/
        mask(j, j + 2);
        return j + 2;
      case LF:
      case CR:
        mask(j, j + 1);
        return j + 1;
    }
    // Escaped character (\% \& \_ \# \$ \{ \} …): hide the backslash, keep the character
    // and do not interpret it ("\%" starts no comment, "\$" no math).
    mask(j, j + 1);
    const low = t.charCodeAt(j + 2);
    const pair = c >= 0xd800 && c <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
    return j + (pair ? 3 : 2);
  };

  /** $…$ and $$…$$ math: the content is masked, the dollar signs stay. */
  const dollar = (j: number): number => {
    // Right after a digit, "$" is a currency sign ("5$", "the 10$ fee"), never math.
    if (isDigit(t.charCodeAt(j - 1))) return j + 1;
    if (t.charCodeAt(j + 1) === DOLLAR) {
      const close = displayDollarClose(j + 2);
      if (close >= 0 && close < paraEnd(j)) {
        mask(j + 2, close);
        return close + 2;
      }
      return j + 2;
    }
    // Inline math, Pandoc's rule: a non-space right after the opening "$"; the next "$"
    // closes it only with a non-space before it and no digit after it. So "$5 and $10"
    // is not math; neither "$" is.
    if (j + 1 >= n || isSpace(t.charCodeAt(j + 1))) return j + 1;
    const close = nextDollar(j + 2);
    if (
      close >= 0 &&
      close < paraEnd(j) &&
      !isSpace(t.charCodeAt(close - 1)) &&
      !isDigit(t.charCodeAt(close + 1))
    ) {
      mask(j + 1, close);
      return close + 1;
    }
    return j + 1;
  };

  const percent = (j: number): number => {
    if (!isCommentAt(t, j, urlMemo)) return j + 1;
    const end = lineEnd(j);
    mask(j, end);
    return end;
  };

  /**
   * Inline code: a run of k backticks closed by a run of exactly k on the same line (see
   * closingRun). A run followed by a blank opens nothing, nor does a run between two
   * letters ("don`t", "it`s"). Not code either if the content holds k apostrophes: that
   * is a LaTeX ``quote'' or `quote'. Only the content is masked.
   */
  const backticks = (j: number): number => {
    let k = j + 1;
    while (t.charCodeAt(k) === BACKTICK) k++;
    const length = k - j;
    if (k >= n || isSpace(t.charCodeAt(k)) || (isLetterBefore(t, j) && isLetterAt(t, k))) return k;
    const close = closingRun(length, k, lineEnd(j));
    if (close < 0) return k;
    if (t.slice(k, close).includes("'".repeat(length))) return k;
    mask(k, close);
    return close + length;
  };

  /** A hyphen at a line break between a letter and a lower-case letter is a
   * hyphenation break: hyphen, break and indentation are removed. */
  const hyphen = (j: number, soft: boolean): number => {
    if (isSpace(t.charCodeAt(j + 1)) && isLetterBefore(t, j)) {
      HYPHEN_BREAK.lastIndex = j + 1;
      if (HYPHEN_BREAK.test(t)) {
        const end = HYPHEN_BREAK.lastIndex;
        drop(j, end);
        return end;
      }
    }
    if (soft) drop(j, j + 1);
    return j + 1;
  };

  // ---- main loop

  let i = lineStart(0);
  while (i < n) {
    SPECIAL.lastIndex = i;
    const m = SPECIAL.exec(t);
    if (m === null) break;
    const j = m.index;
    const c = t.charCodeAt(j);
    switch (c) {
      case LF:
        i = lineStart(j + 1);
        break;
      case CR:
        i = t.charCodeAt(j + 1) === LF ? j + 1 : lineStart(j + 1);
        break;
      case BACKSLASH:
        i = backslash(j);
        break;
      case DOLLAR:
        i = dollar(j);
        break;
      case PERCENT:
        i = percent(j);
        break;
      case BACKTICK:
        i = backticks(j);
        break;
      case LBRACE:
        if (flagged !== null && flagged[j] === 1) mask(j, j + 1);
        else if (declarationAt(j + 1)) {
          // "{\em text}": the group works like a formatting command's argument.
          const e = braceMatch(j);
          if (e >= 0) {
            flag(e);
            mask(j, j + 1);
          }
        }
        i = j + 1;
        break;
      case RBRACE:
        if (flagged !== null && flagged[j] === 1) mask(j, j + 1);
        i = j + 1;
        break;
      case TILDE: {
        // A "~~~" code-fence line stays as it is, so the artifact entry can flag it;
        // any other "~" (LaTeX no-break space, "approximately") becomes a space.
        const fence = tildeFenceEnd(j);
        if (fence > j) {
          i = fence;
          break;
        }
        replace(j, ' ');
        i = j + 1;
        break;
      }
      case HYPHEN:
      case SOFT_HYPHEN:
        i = hyphen(j, c === SOFT_HYPHEN);
        break;
      default:
        // Zero-width space/joiners, word joiner, BOM.
        if (isInvisible(c)) drop(j, j + 1);
        i = j + 1;
    }
  }
  keepTo(n);
  map[o] = n;
  return { text: parts.join(''), map: map.subarray(0, o + 1) };
}
