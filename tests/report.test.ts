import { describe, expect, it } from 'vitest';
import {
  falsePositiveReportUrl,
  newPhraseReportUrl,
  REPO,
  REPORT_TEXT_MAX,
  reportText,
  TITLE_PHRASE_MAX,
} from '../web/src/ui/report.ts';

function parse(url: string): { base: string; params: Record<string, string>; keys: string[] } {
  const u = new URL(url);
  return {
    base: `${u.origin}${u.pathname}`,
    params: Object.fromEntries(u.searchParams),
    keys: [...u.searchParams.keys()],
  };
}

describe('reportText', () => {
  it('collapses whitespace and trims', () => {
    expect(reportText('  delved\n\n into\tthe  ')).toBe('delved into the');
    expect(reportText(' \n ')).toBe('');
  });

  it(`cuts at ${REPORT_TEXT_MAX} characters, counting code points`, () => {
    expect(REPORT_TEXT_MAX).toBe(300);
    expect(reportText('a'.repeat(400))).toBe('a'.repeat(300));
    expect(reportText('a'.repeat(300))).toBe('a'.repeat(300));
    const astral = reportText('𝔸'.repeat(301));
    expect(Array.from(astral)).toHaveLength(300);
    expect(astral).toBe('𝔸'.repeat(300)); // no half surrogate pair at the end
    expect(reportText(`${'a'.repeat(299)} b`)).toBe('a'.repeat(299)); // no trailing space
  });
});

describe('falsePositiveReportUrl', () => {
  it('opens the false-positive issue form with the entry and the matched text only', () => {
    const url = falsePositiveReportUrl('en.lexical.delve-into', '  delved\n into ');
    expect(url.startsWith(`${REPO}/issues/new?`)).toBe(true);
    const { base, params, keys } = parse(url);
    expect(base).toBe('https://github.com/ShuhongDai/ai-prescreen/issues/new');
    expect(keys).toEqual(['template', 'title', 'entry_id', 'matched_text']);
    expect(params).toEqual({
      template: 'report-false-positive.yml',
      title: 'False positive: en.lexical.delve-into',
      entry_id: 'en.lexical.delve-into',
      matched_text: 'delved into',
    });
  });

  it('cuts the matched text at 300 characters', () => {
    const { params } = parse(falsePositiveReportUrl('en.artifact.x', 'word '.repeat(100)));
    expect(params.matched_text).toHaveLength(299); // 300, minus the trailing space trimmed
    expect(params.matched_text!.startsWith('word word')).toBe(true);
  });

  it('encodes characters that mean something in a URL', () => {
    const text = 'R&D #1: 50% = a+b? <x> "q" \'s’ 😀';
    const url = falsePositiveReportUrl('en.artifact.x', text);
    expect(url).not.toMatch(/[ #<>"]/);
    expect(parse(url).params.matched_text).toBe(text);
  });
});

describe('newPhraseReportUrl', () => {
  it('opens the new-phrase issue form with the phrase and a title', () => {
    const url = newPhraseReportUrl(' it is worth noting\nthat ');
    expect(url.startsWith(`${REPO}/issues/new?`)).toBe(true);
    const { params, keys } = parse(url);
    expect(keys).toEqual(['template', 'title', 'phrase']);
    expect(params).toEqual({
      template: 'report-ai-phrase.yml',
      title: 'AI-like phrase: it is worth noting that',
      phrase: 'it is worth noting that',
    });
  });

  it(`cuts the phrase at ${TITLE_PHRASE_MAX} characters in the title and 300 in the field`, () => {
    expect(TITLE_PHRASE_MAX).toBe(80);
    const long = 'x'.repeat(500);
    const { params } = parse(newPhraseReportUrl(long));
    expect(params.title).toBe(`AI-like phrase: ${'x'.repeat(80)}`);
    expect(params.phrase).toBe('x'.repeat(300));
  });

  it('gives the empty form for an empty phrase', () => {
    expect(parse(newPhraseReportUrl('')).params).toEqual({
      template: 'report-ai-phrase.yml',
      title: 'AI-like phrase: ',
      phrase: '',
    });
  });
});
