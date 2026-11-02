// Text from the page, cleaned for a GitHub issue. Reported text goes into code spans and
// code blocks, where GitHub renders no markdown, links, images or @mentions: an issue opened
// with the owner's token must not notify or link anyone the reporter names.

// C0 and C1 controls (tab and line feed are handled separately) and bidi overrides.
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
// Half of a surrogate pair on its own (not well-formed UTF-16).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * `value` as clean text: NFC, without control characters, trimmed; one line unless
 * `multiline` (then at most one blank line in a row). Null when it is not a string, is not
 * well-formed (a lone surrogate) or is longer than `max` code points.
 */
export function cleanText(value: unknown, max: number, multiline = false): string | null {
  if (typeof value !== 'string' || LONE_SURROGATE.test(value)) return null;
  let text = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROLS, '');
  text = multiline
    ? text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\t/g, ' ')
    : text.replace(/\s+/g, ' ');
  text = text.trim();
  return Array.from(text).length <= max ? text : null;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return longest;
}

/** One line of text as a code span, fenced with more backticks than it contains. */
export function codeSpan(text: string): string {
  const fence = '`'.repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Text as a fenced code block, fenced with more backticks than it contains (at least 3). */
export function codeBlock(text: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}text\n${text}\n${fence}`;
}

/**
 * Text for an issue title: one line, cut to `max` code points, with a word joiner after
 * every @ and #, inside "GH-<n>" and inside "://", so that a title never reads as a mention,
 * an issue reference or a link.
 */
export function titleText(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  const cut = chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
  return cut
    .replace(/[@#]/g, '$&\u2060')
    .replace(/\b(gh)-(?=\d)/gi, '$1\u2060-')
    .replace(/:\/\//g, ':\u2060//');
}
