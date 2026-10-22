import { describe, expect, it } from 'vitest';
import {
  TIERS,
  analyze,
  compileLexicon,
  type LexiconEntry,
  type Match,
} from '../web/src/engine/index.ts';
import { findDuplicates, validateLexicon, validateLexiconFiles } from '../web/src/engine/validate.ts';
import { LEXICON } from '../web/src/lexicon.ts';
import { buildSummary, isExperimental } from '../web/src/ui/format.ts';
import examplesJson from './fixtures/artifact-examples.json';

interface Examples {
  positive: string[];
  negative: string[];
}

const EXAMPLES = examplesJson as Record<string, Examples>;

const lexiconFiles = import.meta.glob<unknown>('../lexicon/*.json', {
  eager: true,
  import: 'default',
});
const cleanFixtures = import.meta.glob<string>('./fixtures/clean/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const ARTIFACT_ENTRIES = LEXICON.filter((e) => e.tier === 'artifact');
const FULL = compileLexicon(LEXICON, { includeCandidates: true, tiers: TIERS });

function only(entry: LexiconEntry) {
  return compileLexicon([entry], { includeCandidates: true, tiers: TIERS });
}

function describeMatches(text: string, matches: readonly Match[]): string {
  return matches.map((m) => `${m.entryId}: ${JSON.stringify(text.slice(m.start, m.end))}`).join('\n');
}

describe('lexicon files', () => {
  it('are found', () => {
    expect(Object.keys(lexiconFiles).length).toBeGreaterThan(0);
  });

  for (const [path, data] of Object.entries(lexiconFiles)) {
    it(`${path} passes validateLexicon`, () => {
      expect(validateLexicon(path, data)).toEqual([]);
    });
  }

  it('have no duplicate ids or patterns across files', () => {
    const files = Object.entries(lexiconFiles).map(([fileName, data]) => ({ fileName, data }));
    expect(validateLexiconFiles(files)).toEqual([]);
  });
});

describe('artifact examples fixture', () => {
  it('has an entry for every artifact lexicon entry', () => {
    const missing = ARTIFACT_ENTRIES.map((e) => e.id).filter((id) => !(id in EXAMPLES));
    expect(missing).toEqual([]);
  });

  it('only references existing artifact entries', () => {
    const ids = new Set(ARTIFACT_ENTRIES.map((e) => e.id));
    expect(Object.keys(EXAMPLES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('has at least one positive example per entry', () => {
    const empty = Object.entries(EXAMPLES)
      .filter(([, ex]) => ex.positive.length === 0)
      .map(([id]) => id);
    expect(empty).toEqual([]);
  });
});

describe('artifact entries match their examples', () => {
  for (const entry of ARTIFACT_ENTRIES) {
    const ex = EXAMPLES[entry.id] ?? { positive: [], negative: [] };

    describe(entry.id, () => {
      for (const text of ex.positive) {
        it(`matches ${JSON.stringify(text)}`, () => {
          const own = analyze(text, only(entry)).matches.filter((m) => m.entryId === entry.id);
          expect(own.length, `${entry.id} should match`).toBeGreaterThan(0);

          // With the full lexicon the entry may lose an overlap to another artifact
          // entry, but the text must still be flagged at that spot.
          const full = analyze(text, FULL).matches;
          const covered = own.some((o) =>
            full.some(
              (m) =>
                m.entryId === entry.id ||
                (m.tier === 'artifact' && m.start < o.end && o.start < m.end),
            ),
          );
          expect(covered, describeMatches(text, full) || 'no matches').toBe(true);
        });
      }

      for (const text of ex.negative) {
        it(`does not match ${JSON.stringify(text)}`, () => {
          const hits = analyze(text, only(entry)).matches.filter((m) => m.entryId === entry.id);
          expect(hits, describeMatches(text, hits)).toEqual([]);
        });
      }
    });
  }
});

describe('artifact spans', () => {
  const spans = (text: string) =>
    analyze(text, FULL).matches.map((m) => [m.entryId.replace('en.artifact.', ''), text.slice(m.start, m.end)]);

  it('Markdown markers do not hide a stronger artifact on the same line', () => {
    expect(spans('### Certainly! Here is a revised version of your abstract:')).toEqual([
      ['markdown-heading', '###'],
      ['certainly-here-is', 'Certainly! Here is'],
    ]);
    expect(spans('**Sure! Here is a polished version** below')).toEqual([
      ['markdown-bold', '**'],
      ['sure-here-is', 'Sure! Here is'],
    ]);
  });

  it('a heading span does not include the CR of a CRLF line ending', () => {
    expect(spans('Intro\r\n## Results\r\nMore')).toEqual([['markdown-heading', '##']]);
  });

  it('a hand-over line is flagged up to "version", whatever follows', () => {
    expect(spans('Here is a polished version of your abstract (at 10:30):')).toEqual([
      ['here-is-revised-version', 'Here is a polished version'],
    ]);
  });

  it('the M1 example is flagged (experimental lexicon on)', () => {
    expect(spans('Certainly! Here is a revised version\u2026')).toEqual([
      ['certainly-here-is', 'Certainly! Here is'],
    ]);
  });
});

describe('experimental lexicon toggle OFF (the default)', () => {
  // Mirrors main.ts: the shown lexicon is compiled with includeCandidates = toggle state,
  // and hidden experimental matches are counted against a candidates-included lexicon.
  const OFF = compileLexicon(LEXICON, { includeCandidates: false });
  const ON = compileLexicon(LEXICON, { includeCandidates: true });
  const byId = new Map(LEXICON.map((e) => [e.id, e]));

  it('flags the M1 example "Certainly! Here is a revised version\u2026"', () => {
    const text = 'Certainly! Here is a revised version\u2026';
    const res = analyze(text, OFF);
    expect(res.matches.map((m) => [m.entryId, text.slice(m.start, m.end)])).toEqual([
      ['en.artifact.certainly-here-is', 'Certainly! Here is'],
    ]);

    const hidden = analyze(text, ON).matches.filter((m) => isExperimental(byId.get(m.entryId)));
    const summary = buildSummary({
      idle: false,
      stats: res.stats,
      experimentalShown: 0,
      experimentalHidden: hidden.length,
    });
    expect(summary.state).toBe('flagged');
    // Six words: below the 200-word threshold, so no per-1k density.
    expect(summary.text).toBe('1 artifact');
    expect(summary.note).toBeNull();
  });

  for (const entry of ARTIFACT_ENTRIES) {
    const positives = EXAMPLES[entry.id]?.positive ?? [];

    if (entry.status === 'accepted' || entry.status === 'watch') {
      it(`${entry.id} (${entry.status}) flags its positive examples`, () => {
        for (const text of positives) {
          const own = analyze(text, only(entry)).matches.filter((m) => m.entryId === entry.id);
          const shown = analyze(text, OFF).matches;
          const covered = own.some((o) =>
            shown.some((m) => m.tier === 'artifact' && m.start < o.end && o.start < m.end),
          );
          expect(covered, `${JSON.stringify(text)}\n${describeMatches(text, shown) || 'no matches'}`).toBe(true);
        }
      });
    } else {
      it(`${entry.id} (${entry.status}) stays hidden`, () => {
        for (const text of positives) {
          const hits = analyze(text, OFF).matches.filter((m) => m.entryId === entry.id);
          expect(hits, describeMatches(text, hits)).toEqual([]);
        }
      });
    }
  }
});

describe('lexical entries', () => {
  const LEXICAL = LEXICON.filter((e) => e.tier === 'lexical');

  it('are found', () => {
    expect(LEXICAL.length).toBeGreaterThan(0);
  });

  it('each match their own pattern text (all but retired)', () => {
    const unmatched = LEXICAL.filter(
      (e) => e.status !== 'retired' && !analyze(e.pattern, only(e)).matches.some((m) => m.entryId === e.id),
    ).map((e) => `${e.id}: ${JSON.stringify(e.pattern)}`);
    expect(unmatched).toEqual([]);
  });

  it('retired entries never fire, even with the experimental lexicon', () => {
    const fired = LEXICAL.filter(
      (e) => e.status === 'retired' && analyze(e.pattern, only(e)).matches.length > 0,
    ).map((e) => e.id);
    expect(fired).toEqual([]);
  });
});

describe('clean human-written text', () => {
  it('fixtures are found', () => {
    expect(Object.keys(cleanFixtures).length).toBeGreaterThan(0);
  });

  for (const [path, text] of Object.entries(cleanFixtures)) {
    it(`${path} produces zero artifact matches`, () => {
      const hits = analyze(text, FULL).matches.filter((m) => m.tier === 'artifact');
      expect(hits, describeMatches(text, hits)).toEqual([]);
    });
  }
});

describe('validateLexicon', () => {
  const good: LexiconEntry = {
    id: 'en.artifact.example-entry',
    pattern: 'Regenerate response',
    match: 'phrase',
    inflect: false,
    tier: 'artifact',
    lang: 'en',
    status: 'candidate',
    note: 'Example.',
    suggestions: ['Delete this line.'],
    models: [],
    added: '2026-10-22',
    evidence: [],
  };
  const check = (patch: Record<string, unknown>, file = 'en.artifact.json') =>
    validateLexicon(file, [{ ...good, ...patch }]);
  const joined = (errors: string[]) => errors.join('\n');

  it('accepts a well-formed entry', () => {
    expect(check({})).toEqual([]);
  });

  it('rejects a non-array file', () => {
    expect(joined(validateLexicon('en.artifact.json', { entries: [] }))).toMatch(/JSON array/);
  });

  it('rejects a bad file name', () => {
    expect(joined(validateLexicon('artifact.json', []))).toMatch(/file name/);
  });

  it('rejects missing fields and bad enums', () => {
    const { note: _note, ...noNote } = good;
    expect(joined(validateLexicon('en.artifact.json', [noNote]))).toMatch(/"note" is required/);
    expect(joined(check({ match: 'fuzzy' }))).toMatch(/"match" must be one of/);
    expect(joined(check({ status: 'approved' }))).toMatch(/"status" must be one of/);
    expect(joined(check({ tier: 'magic' }))).toMatch(/"tier" must be one of/);
    expect(joined(check({ colour: 'red' }))).toMatch(/unknown field "colour"/);
  });

  it('checks id format and consistency with lang, tier and file name', () => {
    expect(joined(check({ id: 'en.artifact.Bad_Slug' }))).toMatch(/kebab-slug/);
    expect(joined(check({ id: 'en.lexical.example-entry' }))).toMatch(/does not match "tier"/);
    expect(joined(check({}, 'en.lexical.json'))).toMatch(/file name tier/);
    expect(joined(check({}, 'de.artifact.json'))).toMatch(/file name language/);
  });

  it('rejects invalid or empty-matching regexes', () => {
    expect(joined(check({ match: 'regex', pattern: '(unclosed' }))).toMatch(/does not compile/);
    expect(joined(check({ match: 'regex', pattern: 'a\\-b' }))).toMatch(/does not compile/);
    expect(joined(check({ match: 'regex', pattern: 'x*' }))).toMatch(/empty string/);
    expect(joined(check({ match: 'regex', pattern: '^' }))).toMatch(/empty string/);
  });

  it('rejects regexes whose matches are all zero-length (lookarounds only)', () => {
    expect(joined(check({ match: 'regex', pattern: '(?=Certainly)' }))).toMatch(/empty string/);
    expect(joined(check({ match: 'regex', pattern: '(?<=Sure)' }))).toMatch(/empty string/);
    expect(joined(check({ match: 'regex', pattern: '(?:Sure!)?(?=\\d)' }))).toMatch(/empty string/);
    expect(joined(check({ match: 'regex', pattern: '\\bfoo(?=bar)|(?<!x)\\b' }))).toMatch(/empty string/);
    // Lookarounds around a consuming part are fine, including inside character classes.
    expect(check({ match: 'regex', pattern: '(?<![\\w(])\\*\\*(?=[^\\s*])' })).toEqual([]);
  });

  it('rejects regexes that name characters the engine rewrites or removes', () => {
    expect(joined(check({ match: 'regex', pattern: "I\\u2019m sorry" }))).toMatch(/U\+2019.*ASCII/);
    expect(joined(check({ match: 'regex', pattern: 'I[\\u2019]m sorry' }))).toMatch(/U\+2019/);
    expect(joined(check({ match: 'regex', pattern: 'As\\u00A0an AI' }))).toMatch(/U\+00A0/);
    expect(joined(check({ match: 'regex', pattern: '\\u{201C}Your Name' }))).toMatch(/U\+201C/);
    expect(joined(check({ match: 'regex', pattern: 'Regener\u00ADate' }))).toMatch(/U\+00AD/);
    // An escaped backslash followed by "u2019" is not an escape of U+2019.
    expect(check({ match: 'regex', pattern: 'a\\\\u2019' })).toEqual([]);
  });

  it('validates the normalised regex source that the engine compiles', () => {
    // "’" becomes "'" before compiling, which makes this range out of order.
    expect(joined(check({ match: 'regex', pattern: '[(-\u2019]x' }))).toMatch(/does not compile/);
  });

  it('rejects whitespace in word patterns', () => {
    expect(joined(check({ match: 'word', pattern: 'two words' }))).toMatch(/whitespace/);
  });

  it('checks evidence items and the independent-source count', () => {
    const paper = { type: 'paper', ref: 'Example et al. 2024', url: 'https://example.org/p' };
    const blog = { type: 'blog', ref: 'Some blog', derivedFrom: 'Example et al. 2024' };
    expect(check({ evidence: [paper, blog], independentSources: 1 })).toEqual([]);
    expect(joined(check({ evidence: [paper, blog], independentSources: 2 }))).toMatch(
      /"independentSources" is 2, but 1 evidence item/,
    );
    expect(joined(check({ independentSources: 1.5 }))).toMatch(/non-negative integer/);
    expect(joined(check({ evidence: [{ ...paper, url: 'example.org' }] }))).toMatch(/http\(s\) URL/);
    expect(joined(check({ evidence: [{ ...paper, quote: 'copied text' }] }))).toMatch(/unknown field "quote"/);
    expect(joined(check({ evidence: [{ ...paper, derivedFrom: ' ' }] }))).toMatch(/"derivedFrom"/);
  });

  it('rejects bad dates and wrongly typed arrays', () => {
    expect(joined(check({ added: '2026-13-01' }))).toMatch(/"added"/);
    expect(joined(check({ added: '22.10.2026' }))).toMatch(/"added"/);
    expect(joined(check({ suggestions: 'Delete it.' }))).toMatch(/"suggestions"/);
    expect(joined(check({ models: [1] }))).toMatch(/"models"/);
    expect(joined(check({ evidence: [{ type: 'paper' }] }))).toMatch(/"evidence"/);
  });

  it('finds duplicate ids and patterns, within and across files', () => {
    const twin = { ...good, pattern: '  regenerate   RESPONSE ' };
    expect(joined(validateLexicon('en.artifact.json', [good, twin]))).toMatch(/duplicate id/);
    expect(joined(validateLexicon('en.artifact.json', [good, twin]))).toMatch(/duplicate phrase pattern/);

    const other = { ...good, id: 'en.lexical.other', tier: 'lexical', pattern: 'regenerate response' };
    const cross = findDuplicates([
      { fileName: 'en.artifact.json', data: [good] },
      { fileName: 'en.lexical.json', data: [other] },
    ]);
    expect(joined(cross)).toMatch(/duplicate phrase pattern/);

    // Same text with a different match kind is not a duplicate.
    const regex = { ...good, id: 'en.artifact.regex-twin', match: 'regex', pattern: 'Regenerate response' };
    expect(validateLexicon('en.artifact.json', [good, regex])).toEqual([]);
  });

  it('keys duplicates on what the engine compiles', () => {
    const a = { ...good, id: 'en.artifact.a' };
    const b = { ...good, id: 'en.artifact.b' };
    // Curly and straight apostrophes compile to the same regex.
    expect(
      joined(validateLexicon('en.artifact.json', [{ ...a, pattern: "Here's a draft" }, { ...b, pattern: 'Here\u2019s a draft' }])),
    ).toMatch(/duplicate phrase pattern/);
    // "word" and "phrase" with the same text compile to the same regex.
    expect(
      joined(validateLexicon('en.artifact.json', [{ ...a, match: 'word', pattern: 'delve' }, { ...b, match: 'phrase', pattern: 'delve' }])),
    ).toMatch(/duplicate phrase pattern/);
    // Regex case matters: \b and \B, \d and \D are different patterns.
    expect(
      validateLexicon('en.artifact.json', [
        { ...a, match: 'regex', pattern: '\\bSure\\b' },
        { ...b, match: 'regex', pattern: '\\BSure\\B' },
      ]),
    ).toEqual([]);
  });
});
