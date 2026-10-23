// Pre-filled GitHub issue forms (M3 contribution flow, no backend). DOM-free.
//
// Reports are public GitHub issues created through the issue forms in
// .github/ISSUE_TEMPLATE/; the query keys below are those forms' field ids. A URL carries
// only what the user chose to report (an entry ID and the flagged text, or a selected
// phrase), and it only leaves the page when the user clicks the link: it is a plain link,
// never a request made by script.

export const REPO = 'https://github.com/ShuhongDai/ai-prescreen';

/** Longest text put into a form field, in characters (code points). */
export const REPORT_TEXT_MAX = 300;
/** Longest phrase repeated in an issue title, in characters (code points). */
export const TITLE_PHRASE_MAX = 80;

export const FALSE_POSITIVE_TEMPLATE = 'report-false-positive.yml';
export const NEW_PHRASE_TEMPLATE = 'report-ai-phrase.yml';

/**
 * Whitespace runs collapsed to one space, trimmed, and cut to at most `max` characters
 * (counted in code points, so a surrogate pair is never split).
 */
export function reportText(text: string, max = REPORT_TEXT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length <= max ? flat : chars.slice(0, max).join('').trimEnd();
}

function issueUrl(params: Record<string, string>): string {
  return `${REPO}/issues/new?${new URLSearchParams(params).toString()}`;
}

/** "Report false positive" in a highlight's popover. */
export function falsePositiveReportUrl(entryId: string, matchedText: string): string {
  return issueUrl({
    template: FALSE_POSITIVE_TEMPLATE,
    title: `False positive: ${entryId}`,
    entry_id: entryId,
    matched_text: reportText(matchedText),
  });
}

/** "Report as AI-like" for selected text, or the empty form ("Report a phrase"). */
export function newPhraseReportUrl(phrase: string): string {
  const text = reportText(phrase);
  return issueUrl({
    template: NEW_PHRASE_TEMPLATE,
    title: `AI-like phrase: ${reportText(text, TITLE_PHRASE_MAX)}`,
    phrase: text,
  });
}

/** Read with each report link: it leaves the page for GitHub. */
export const NEW_TAB_HINT = ' (opens GitHub in a new tab)';
