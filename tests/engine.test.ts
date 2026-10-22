import { describe, expect, it } from 'vitest';
import {
  TIERS,
  analyze,
  compileEntry,
  compileLexicon,
  countWords,
  isActive,
  literalSource,
  normalize,
  preprocess,
  type CompileOptions,
  type CompiledEntry,
  type LexiconEntry,
  type Match,
} from '../web/src/engine/index.ts';
import { LEXICON } from '../web/src/lexicon.ts';
import artifactExamples from './fixtures/artifact-examples.json';

// ---------------------------------------------------------------- helpers

let seq = 0;
/** Builds a lexicon entry with sensible defaults (accepted, artifact tier, phrase). */
function entry(fields: Partial<LexiconEntry> & Pick<LexiconEntry, 'pattern'>): LexiconEntry {
  seq++;
  return {
    id: `test.${String(seq).padStart(4, '0')}`,
    match: 'phrase',
    tier: 'artifact',
    lang: 'en',
    status: 'accepted',
    note: 'test fixture',
    added: '2026-10-22',
    ...fields,
  };
}

function run(entries: LexiconEntry[], text: string, options?: CompileOptions) {
  return analyze(text, compileLexicon(entries, options));
}

/** The visible text of every match, sliced from the ORIGINAL input. */
function hits(entries: LexiconEntry[], text: string, options?: CompileOptions): string[] {
  return run(entries, text, options).matches.map((m) => text.slice(m.start, m.end));
}

function ids(entries: LexiconEntry[], text: string, options?: CompileOptions): string[] {
  return run(entries, text, options).matches.map((m) => m.entryId);
}

// ---------------------------------------------------------------- basics

describe('engine', () => {
  it('defines the three detection tiers in order', () => {
    expect(TIERS).toEqual(['artifact', 'lexical', 'stylistic']);
  });
});

// ---------------------------------------------------------------- normalize

describe('normalize', () => {
  it('maps curly quotes, exotic spaces and Unicode hyphens to ASCII', () => {
    expect(normalize('‘a’ ‚b‛ c′ dʼ')).toBe("'a' 'b' c' d'");
    expect(normalize('“a” „b‟ c″')).toBe('"a" "b" c"');
    expect(normalize('a b c d　e f g')).toBe('a b c d e f g');
    expect(normalize('state‑of‐the-art')).toBe('state-of-the-art');
  });

  it('is length-preserving for every BMP code unit (incl. lone surrogates)', () => {
    let all = '';
    for (let c = 0; c <= 0xffff; c++) all += String.fromCharCode(c);
    const out = normalize(all);
    expect(out.length).toBe(all.length);
    // Every changed position maps one code unit to one ASCII code unit.
    for (let i = 0; i < all.length; i++) {
      if (out[i] !== all[i]) expect(out.charCodeAt(i)).toBeLessThan(0x80);
    }
  });

  it('leaves astral characters and CRLF untouched', () => {
    const s = 'a😀b𝒜c\r\nd';
    expect(normalize(s)).toBe(s);
  });
});

// ---------------------------------------------------------------- offsets

describe('offsets index the original text', () => {
  const opener = entry({ pattern: "Here's a revised version" });

  it('with curly apostrophes in the text and a straight one in the pattern', () => {
    const text = 'Certainly! Here’s a revised version of your abstract.';
    expect(hits([opener], text)).toEqual(['Here’s a revised version']);
  });

  it('with curly double quotes around a placeholder', () => {
    const e = entry({ pattern: '"Your Name"' });
    const text = 'Signed, “Your Name”.';
    expect(hits([e], text)).toEqual(['“Your Name”']);
  });

  it('with NBSP and other exotic spaces between and before words', () => {
    const e = entry({ pattern: 'as an AI language model' });
    const text = '  Well, as an AI language model, I cannot.';
    expect(hits([e], text)).toEqual(['as an AI language model']);
  });

  it('with CRLF line endings', () => {
    const e = entry({ pattern: 'Regenerate response' });
    const text = 'First line.\r\n\r\nRegenerate response\r\nLast line.';
    const [m] = run([e], text).matches;
    expect(text.slice(m.start, m.end)).toBe('Regenerate response');
    expect(m.start).toBe(text.indexOf('Regenerate'));
  });

  it('with emoji and other astral characters before the match', () => {
    const e = entry({ pattern: 'Great question!' });
    const text = '👍🏽 𝒜𝓁𝓅𝒽𝒶 🇦🇹 Great question! 😀';
    const [m] = run([e], text).matches;
    expect(m.start).toBe(text.indexOf('Great'));
    expect(text.slice(m.start, m.end)).toBe('Great question!');
  });

  it('with accented letters, case-insensitively', () => {
    const e = entry({ pattern: 'déjà vu', match: 'phrase' });
    const text = 'Crème brûlée. DÉJÀ VU, again: Déjà\tvu.';
    expect(hits([e], text)).toEqual(['DÉJÀ VU', 'Déjà\tvu']);
  });

  it('for matches across every kind of normalised character at once', () => {
    const e = entry({ pattern: `I'm "state-of-the-art"` });
    const text = '😀 x I’m “state‑of‑the‑art” y';
    expect(hits([e], text)).toEqual(['I’m “state‑of‑the‑art”']);
  });
});

// ---------------------------------------------------------------- literal matching

describe('word and phrase matching', () => {
  it('is case-insensitive', () => {
    const e = entry({ pattern: 'Certainly! Here is' });
    expect(hits([e], 'CERTAINLY! HERE IS x. certainly! here is y.')).toEqual([
      'CERTAINLY! HERE IS',
      'certainly! here is',
    ]);
  });

  it('lets any whitespace run stand for a space in a phrase', () => {
    const e = entry({ pattern: 'as of my last knowledge update' });
    const text = 'as  of\tmy\nlast \r\n knowledge  update';
    expect(hits([e], text)).toEqual([text]);
  });

  it('treats whitespace inside the pattern itself flexibly', () => {
    const e = entry({ pattern: '  as \t of  my last  ' });
    expect(hits([e], 'as of my last')).toEqual(['as of my last']);
  });

  it('does not match a word inside a longer word', () => {
    const e = entry({ pattern: 'delve', match: 'word' });
    expect(hits([e], 'delved redelve delves delve_x x_delve delve2')).toEqual([]);
  });

  it('matches a word next to punctuation and at text edges', () => {
    const e = entry({ pattern: 'delve', match: 'word' });
    expect(hits([e], 'delve, (delve) "delve." -delve- delve')).toEqual([
      'delve',
      'delve',
      'delve',
      'delve',
      'delve',
    ]);
  });

  it('matches patterns whose edges are punctuation anywhere', () => {
    const cite = entry({ pattern: '[Insert citation]' });
    expect(hits([cite], 'as shown[insert CITATION].')).toEqual(['[insert CITATION]']);
    expect(hits([cite], 'x[Insert citation]y')).toEqual(['[Insert citation]']);
  });

  it('matches markdown punctuation like ** and ###', () => {
    const bold = entry({ pattern: '**' });
    const heading = entry({ pattern: '###' });
    const text = '### Title\nSome **bold** text';
    expect(hits([bold, heading], text)).toEqual(['###', '**', '**']);
  });

  it('applies a boundary only on edges that are word characters', () => {
    // Left edge is a word char, right edge is "!" -> boundary on the left only.
    const e = entry({ pattern: 'Sure!' });
    expect(hits([e], 'Unsure! Sure!!')).toEqual(['Sure!']);
  });

  it('handles patterns starting or ending with an apostrophe', () => {
    const til = entry({ pattern: "'til" });
    expect(hits([til], 'wait ’til dawn')).toEqual(['’til']);
    // Right edge is a word char, so "'tilde" is not a hit.
    expect(hits([til], "a 'tilde")).toEqual([]);
    const authors = entry({ pattern: "the authors'" });
    expect(hits([authors], 'per the authors’ notes')).toEqual(['the authors’']);
  });

  it('handles patterns with digit edges', () => {
    const e = entry({ pattern: 'GPT-4' });
    expect(hits([e], 'gpt-4, GPT-40, XGPT-4, GPT-4o, (GPT-4)')).toEqual(['gpt-4', 'GPT-4']);
  });

  it('escapes regex metacharacters in literal patterns', () => {
    const cases: [string, string, string[]][] = [
      ['a.b', 'axb a.b', ['a.b']],
      ['C++', 'C++ and Cpp', ['C++']],
      ['(sic)', 'sic (sic)', ['(sic)']],
      ['$100', 'cost $100 or 100', ['$100']],
      ['1+1=2', '11=2 1+1=2', ['1+1=2']],
      ['{x}', 'x {x}', ['{x}']],
      ['what?', 'wha what?', ['what?']],
      ['a|b', 'a b a|b', ['a|b']],
      ['^_^', '^_^', ['^_^']],
      ['[x]', 'x [x]', ['[x]']],
      ['a/b', 'a/b', ['a/b']],
    ];
    for (const [pattern, text, expected] of cases) {
      expect(hits([entry({ pattern })], text), pattern).toEqual(expected);
    }
    // A backslash is escaped too. (In analysed text every backslash is LaTeX syntax and
    // gets masked by preprocessing, so this is checked on the compiled regex itself.)
    const re = compileEntry(entry({ pattern: '\\cite{}' }));
    expect('see \\cite{} here'.match(re)).toEqual(['\\cite{}']);
    expect('see \\citee{} here'.match(re)).toBeNull();
  });

  it('recognises astral letters at pattern edges (regression)', () => {
    // 𝒜 is \p{L}; a code-unit check saw a lone surrogate and dropped the boundary.
    const e = entry({ pattern: '𝒜', match: 'word' });
    expect(hits([e], '𝒜𝒜 x𝒜 𝒜.')).toEqual(['𝒜']);
    expect(literalSource('𝒜')).toContain('(?<!');
  });

  it('does not match base letters of a decomposed (NFD) word (regression)', () => {
    const e = entry({ pattern: 'cafe', match: 'word' });
    expect(hits([e], 'a café here')).toEqual([]);
    expect(hits([e], 'a cafe here')).toEqual(['cafe']);
  });

  it('matches across Unicode hyphens in the text (regression)', () => {
    const e = entry({ pattern: 'state-of-the-art' });
    expect(hits([e], 'a state‑of‐the-art model')).toEqual([
      'state‑of‐the-art',
    ]);
  });

  it('rejects empty and whitespace-only patterns without breaking the lexicon', () => {
    expect(() => literalSource('   ')).toThrow();
    const ok = entry({ pattern: 'Copy code' });
    const empty = entry({ pattern: ' \t ' });
    const lex = compileLexicon([empty, ok]);
    expect(lex.entries.map((c) => c.entry.id)).toEqual([ok.id]);
    expect(lex.errors?.map((e) => e.entryId)).toEqual([empty.id]);
    expect(analyze('Copy code', lex).matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- regex entries

describe('regex entries', () => {
  it('compiles with gimu flags', () => {
    const re = compileEntry(entry({ pattern: 'x', match: 'regex' }));
    expect(re.flags).toBe('gimu');
  });

  it('treats ^ and $ as line anchors', () => {
    const e = entry({ pattern: '^Sure!', match: 'regex' });
    const text = 'Sure! one\nSure! two\nNot Sure!\r\nSure! three';
    expect(run([e], text).matches.map((m) => m.start)).toEqual([
      0,
      text.indexOf('Sure! two'),
      text.indexOf('Sure! three'),
    ]);
    const tail = entry({ pattern: 'Copy code$', match: 'regex' });
    expect(hits([tail], 'Copy code\r\nCopy code here\nCopy code')).toEqual([
      'Copy code',
      'Copy code',
    ]);
  });

  it('matches whole-line markdown headings with offsets intact', () => {
    const e = entry({ pattern: '^#{1,6}[ \\t]+\\S', match: 'regex' });
    const text = '😀\n## Results\nnot # this\n###\tMethods';
    expect(hits([e], text)).toEqual(['## R', '###\tM']);
  });

  it('supports Unicode property classes', () => {
    const e = entry({ pattern: '\\p{Script=Greek}+', match: 'regex' });
    expect(hits([e], '😀 alpha αβγ beta')).toEqual(['αβγ']);
  });

  it('is case-insensitive even for case classes (documents the i flag)', () => {
    // Lexicon authors: with the i flag, \p{Lu} and [A-Z] also match lower case.
    const upper = entry({ pattern: '\\b\\p{Lu}{4,}\\b', match: 'regex' });
    expect(hits([upper], 'An IMPORTANT note, OK')).toEqual(['IMPORTANT', 'note']);
    const ascii = entry({ pattern: '\\b[A-Z]{2}\\b', match: 'regex' });
    expect(hits([ascii], 'OK ok')).toEqual(['OK', 'ok']);
  });

  it('treats a surrogate pair as one character (u flag)', () => {
    const e = entry({ pattern: 'x.y', match: 'regex' });
    expect(hits([e], 'x😀y')).toEqual(['x😀y']);
  });

  it('skips zero-length matches', () => {
    expect(hits([entry({ pattern: '(?=Sure)', match: 'regex' })], 'Sure Sure')).toEqual([]);
    expect(hits([entry({ pattern: '^', match: 'regex' })], 'a\nb\nc')).toEqual([]);
    // Non-empty matches of a pattern that can also match empty are kept.
    expect(hits([entry({ pattern: 'a*', match: 'regex' })], 'baaab😀a')).toEqual(['aaa', 'a']);
  });

  it('supports lookbehind and lookahead', () => {
    const e = entry({ pattern: '(?<=\\bthe )model(?= said)', match: 'regex' });
    expect(hits([e], 'a model said; the model said; the model did')).toEqual(['model']);
  });

  it('runs on normalised text, and a curly quote in the source still matches (regression)', () => {
    const curly = entry({ pattern: 'Here’s (?:a|the)', match: 'regex' });
    const straight = entry({ pattern: "Here's (?:a|the)", match: 'regex' });
    const text = "Here’s a draft. Here's the plan.";
    expect(hits([curly], text)).toEqual(['Here’s a', "Here's the"]);
    expect(hits([straight], text)).toEqual(['Here’s a', "Here's the"]);
  });

  it('skips an invalid regex instead of breaking the whole lexicon (regression)', () => {
    const bad = entry({ pattern: '\\-', match: 'regex' }); // invalid escape under the u flag
    const unclosed = entry({ pattern: '(Sure', match: 'regex' });
    const good = entry({ pattern: 'Copy code' });
    const lex = compileLexicon([bad, good, unclosed]);
    expect(lex.entries.map((c) => c.entry.id)).toEqual([good.id]);
    expect(lex.errors?.map((e) => e.entryId)).toEqual([bad.id, unclosed.id]);
    expect(lex.errors?.[0].message).toMatch(/invalid/i);
    expect(analyze('Copy code', lex).matches).toHaveLength(1);
    // compileEntry itself still throws, so validation can report it.
    expect(() => compileEntry(bad)).toThrow();
  });

  it('does not compile inactive entries at all', () => {
    const bad = entry({ pattern: '(', match: 'regex', status: 'retired' });
    expect(compileLexicon([bad], { includeCandidates: true }).errors).toEqual([]);
  });
});

// ---------------------------------------------------------------- status and tiers

describe('status and tier handling', () => {
  const text = 'alpha beta gamma delta epsilon';
  const accepted = entry({ pattern: 'alpha', status: 'accepted' });
  const watch = entry({ pattern: 'beta', status: 'watch' });
  const candidate = entry({ pattern: 'gamma', status: 'candidate' });
  const retired = entry({ pattern: 'delta', status: 'retired' });
  const stylistic = entry({ pattern: 'epsilon', tier: 'stylistic' });
  const lexical = entry({ pattern: 'alpha beta', tier: 'lexical' });
  const all = [accepted, watch, candidate, retired, stylistic];

  it('activates accepted and watch entries by default', () => {
    expect(hits(all, text)).toEqual(['alpha', 'beta']);
  });

  it('activates candidates only with includeCandidates', () => {
    expect(hits(all, text, { includeCandidates: true })).toEqual(['alpha', 'beta', 'gamma']);
    expect(hits(all, text, { includeCandidates: false })).toEqual(['alpha', 'beta']);
  });

  it('never activates retired entries', () => {
    expect(isActive(retired, { includeCandidates: true, tiers: TIERS })).toBe(false);
    expect(hits([retired], text, { includeCandidates: true, tiers: TIERS })).toEqual([]);
  });

  it('ignores an unknown status', () => {
    const odd = { ...accepted, status: 'proposed' } as unknown as LexiconEntry;
    expect(isActive(odd, { includeCandidates: true })).toBe(false);
  });

  it('keeps stylistic off by default and honours the tiers option', () => {
    expect(isActive(stylistic)).toBe(false);
    expect(hits([stylistic, lexical], text)).toEqual(['alpha beta']);
    expect(hits([stylistic, lexical], text, { tiers: ['stylistic'] })).toEqual(['epsilon']);
    expect(hits([stylistic, lexical], text, { tiers: TIERS })).toEqual([
      'alpha beta',
      'epsilon',
    ]);
    expect(hits(all, text, { tiers: [] })).toEqual([]);
  });

  it('reports the tier of each match', () => {
    const r = run([lexical, stylistic], text, { tiers: TIERS });
    expect(r.matches.map((m) => m.tier)).toEqual(['lexical', 'stylistic']);
  });
});

// ---------------------------------------------------------------- overlaps

describe('overlap resolution', () => {
  it('prefers the longer match at the same start', () => {
    const short = entry({ pattern: 'Here is' });
    const long = entry({ pattern: 'Here is a revised version' });
    expect(ids([short, long], 'Here is a revised version.')).toEqual([long.id]);
    expect(ids([long, short], 'Here is a revised version.')).toEqual([long.id]);
  });

  it('drops a match contained in an earlier one', () => {
    const outer = entry({ pattern: 'Here is a revised version' });
    const inner = entry({ pattern: 'revised version' });
    expect(ids([inner, outer], 'Here is a revised version.')).toEqual([outer.id]);
  });

  it('drops a later match that partially overlaps an earlier one', () => {
    const first = entry({ pattern: 'ab cd' });
    const second = entry({ pattern: 'cd ef' });
    expect(hits([second, first], 'ab cd ef')).toEqual(['ab cd']);
  });

  it('earliest start wins even over a longer later match', () => {
    const first = entry({ pattern: 'ab cd' });
    const second = entry({ pattern: 'cd ef gh ij' });
    expect(hits([second, first], 'ab cd ef gh ij')).toEqual(['ab cd']);
  });

  it('keeps adjacent matches', () => {
    const x = entry({ pattern: '[x]' });
    const y = entry({ pattern: '[y]' });
    expect(hits([x, y], '[x][y]')).toEqual(['[x]', '[y]']);
    expect(hits([entry({ pattern: '**' })], '****')).toEqual(['**', '**']);
  });

  it('breaks exact ties by tier, then by entry ID', () => {
    const lex = entry({ id: 'a.lexical', pattern: 'pivotal', tier: 'lexical' });
    const art = entry({ id: 'z.artifact', pattern: 'pivotal', tier: 'artifact' });
    expect(ids([lex, art], 'pivotal')).toEqual(['z.artifact']);
    const b = entry({ id: 'b', pattern: 'pivotal' });
    const a = entry({ id: 'a', pattern: 'pivotal' });
    const aa = entry({ id: 'A', pattern: 'pivotal' });
    // Code-unit order ("A" < "a" < "b"), not locale order.
    expect(ids([b, a, aa], 'pivotal')).toEqual(['A']);
  });

  it('returns the same matches, sorted by start, whatever the entry order', () => {
    const entries = [
      entry({ pattern: 'Certainly!' }),
      entry({ pattern: 'Here is' }),
      entry({ pattern: 'Here is a revised' }),
      entry({ pattern: 'revised version' }),
      entry({ pattern: 'version', tier: 'lexical' }),
      entry({ pattern: '[Insert citation]' }),
      entry({ pattern: '\\[[^\\]]+\\]', match: 'regex', tier: 'lexical' }),
    ];
    const text = 'Certainly! Here is a revised version [Insert citation]. Another version [x].';
    const expected = run(entries, text).matches;
    const starts = expected.map((m) => m.start);
    expect(starts).toEqual([...starts].sort((p, q) => p - q));
    for (let i = 0; i < expected.length - 1; i++) {
      expect(expected[i].end).toBeLessThanOrEqual(expected[i + 1].start);
    }
    const reversed = [...entries].reverse();
    const rotated = [...entries.slice(3), ...entries.slice(0, 3)];
    expect(run(reversed, text).matches).toEqual(expected);
    expect(run(rotated, text).matches).toEqual(expected);
    expect(hits(entries, text)).toEqual([
      'Certainly!',
      'Here is a revised',
      'version',
      '[Insert citation]',
      'version',
      '[x]',
    ]);
  });
});

// ---------------------------------------------------------------- stats

describe('stats', () => {
  it('counts words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
    expect(countWords('one two  three\nfour')).toBe(4);
    expect(countWords('state-of-the-art')).toBe(1);
    expect(countWords("don't")).toBe(1);
    expect(countWords('don’t')).toBe(1);
    expect(countWords('state‑of‑the‑art')).toBe(1);
    expect(countWords('In 2026 we ran 3 trials')).toBe(6);
    expect(countWords('3.14 and 20,000 and 1.5x')).toBe(5);
    expect(countWords('end. Next,word')).toBe(3);
    expect(countWords('— ** ### -- ...')).toBe(0);
    expect(countWords('Crème brûlée, déjà vu')).toBe(4);
    expect(countWords('naïve café')).toBe(2);
    expect(countWords('😀 hi 😀')).toBe(1);
    expect(countWords('人工知能')).toBe(1);
  });

  it('counts matches per tier, total and hits per 1,000 words', () => {
    const entries = [
      entry({ pattern: 'Certainly!' }),
      entry({ pattern: 'Copy code' }),
      entry({ pattern: 'delve', match: 'word', tier: 'lexical' }),
      entry({ pattern: 'In conclusion,', tier: 'stylistic' }),
    ];
    const text = 'Certainly! We delve. In conclusion, we delve again. Copy code';
    const r = run(entries, text, { tiers: TIERS });
    expect(r.stats.words).toBe(10);
    expect(r.stats.counts).toEqual({ artifact: 2, lexical: 2, stylistic: 1 });
    expect(r.stats.total).toBe(5);
    expect(r.stats.per1k).toBe(500);
    // Inactive tiers are still present in counts, as zero.
    expect(run(entries, text).stats.counts).toEqual({ artifact: 2, lexical: 2, stylistic: 0 });
  });

  it('handles empty input', () => {
    const r = run([entry({ pattern: 'x' })], '');
    expect(r.matches).toEqual([]);
    expect(r.stats).toEqual({
      words: 0,
      counts: { artifact: 0, lexical: 0, stylistic: 0 },
      total: 0,
      per1k: 0,
    });
  });

  it('reports per1k as 0 when there are hits but no words', () => {
    const r = run([entry({ pattern: '**' })], '** **');
    expect(r.stats.total).toBe(2);
    expect(r.stats.words).toBe(0);
    expect(r.stats.per1k).toBe(0);
  });

  it('handles an empty lexicon', () => {
    const r = analyze('Certainly! Here is', compileLexicon([]));
    expect(r.matches).toEqual([]);
    expect(r.stats.words).toBe(3);
  });
});

// ---------------------------------------------------------------- statelessness

describe('repeated analysis', () => {
  it('gives identical results with the same compiled lexicon', () => {
    const lex = compileLexicon([
      entry({ pattern: 'Certainly!' }),
      entry({ pattern: '^Sure', match: 'regex' }),
      entry({ pattern: 'delve', match: 'word', tier: 'lexical' }),
    ]);
    const text = 'Sure, certainly! We delve.\nSure. Certainly! delve';
    const first = analyze(text, lex);
    const second = analyze(text, lex);
    expect(second).toEqual(first);
    expect(first.matches).toHaveLength(6);
    // A different, shorter text in between must not leave state behind.
    analyze('Sure', lex);
    expect(analyze(text, lex)).toEqual(first);
  });

  it('ignores lastIndex left over from outside use of the compiled regexes', () => {
    const lex = compileLexicon([entry({ pattern: 'Certainly' })]);
    const text = 'Certainly. Certainly.';
    const re = lex.entries[0].regex;
    re.test(text); // advances lastIndex past the first hit
    expect(re.lastIndex).toBeGreaterThan(0);
    expect(analyze(text, lex).matches).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- performance

describe('performance', () => {
  it('analyses ~20,000 words with the full lexicon in < 100 ms', () => {
    const sentences = [
      'The committee reviewed the proposal in detail and raised several questions about the budget.',
      'We measured the response at 3.5 kHz, which agrees with earlier work (Smith & Jones, 2019).',
      'Her colleagues didn’t expect the results to hold across all twelve field sites.',
      'In the second experiment, participants read short passages and answered comprehension questions.',
      'Rainfall in the upper catchment was well below the long-term average for most of the season.',
      'Table 2 lists the sample sizes; the smallest group had only fourteen respondents.',
      'Certainly! Here is a revised version of the paragraph you sent.',
      'As an AI language model, I cannot verify these figures.',
      'The method is described in [Insert citation] and summarised in **Section 3**.',
      '### Discussion',
      'Regenerate response',
      'Copy code',
      'Our state‑of‑the‑art baseline was trained on a single GPU for roughly two days.',
      'Café owners in the old town said the new parking rules had cut weekend trade.',
      'If you have any further questions, feel free to ask!',
    ];
    const parts: string[] = [];
    let words = 0;
    for (let i = 0; words < 20000; i++) {
      // Vary order deterministically so the text is not one short loop.
      const s = sentences[(i * 7 + (i >> 3)) % sentences.length];
      parts.push(s, i % 9 === 8 ? '\n\n' : ' ');
      words += countWords(s);
    }
    const text = parts.join('');
    const lex = compileLexicon(LEXICON, { includeCandidates: true });
    expect(lex.errors ?? []).toEqual([]);
    expect(countWords(text)).toBeGreaterThanOrEqual(20000);

    let best = Infinity;
    let result = analyze(text, lex); // warm-up
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      result = analyze(text, lex);
      best = Math.min(best, performance.now() - t0);
    }
    expect(result.stats.words).toBeGreaterThanOrEqual(20000);
    expect(best).toBeLessThan(100);
  });

  // Adversarial inputs: one long line of blanks used to backtrack quadratically in the
  // Markdown table-rule entry (1.7 s for 50k spaces). Every entry must stay linear.
  const adversarial: Record<string, string> = {
    spaces: ' '.repeat(50000),
    tabs: '\t'.repeat(50000),
    'table rule + blanks': '|---|---' + ' '.repeat(50000) + 'x',
    'many blank lines': (' '.repeat(5000) + '\n').repeat(10),
    'quote then I': '"' + ' I'.repeat(25000),
    'unclosed bold': '**a'.repeat(16000),
    'unclosed brackets': '[insert '.repeat(6000),
    'near-miss opener': 'Certainly! Here is a '.repeat(2400),
  };
  const full = compileLexicon(LEXICON, { includeCandidates: true, tiers: TIERS });
  for (const [name, text] of Object.entries(adversarial)) {
    it(`stays fast on adversarial input: ${name}`, () => {
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        analyze(text, full);
        best = Math.min(best, performance.now() - t0);
      }
      expect(best).toBeLessThan(50);
    });
  }
});

// ---------------------------------------------------------------- invisible characters

describe('invisible format characters', () => {
  const e = [entry({ pattern: 'As an AI language model' })];
  const cases: Array<[string, string]> = [
    ['zero-width space', 'As an AI\u200B language model'],
    ['word joiner', 'As an\u2060 AI language model'],
    ['soft hyphen', 'As an AI lan\u00ADguage model'],
    ['BOM', '\uFEFFAs an AI language model'],
    ['zero-width joiner', 'As an AI langu\u200Dage model'],
  ];
  for (const [name, text] of cases) {
    it(`do not break a match (${name})`, () => {
      const res = run(e, `Intro. ${text}, I cannot.`);
      expect(res.matches).toHaveLength(1);
      const m = res.matches[0]!;
      const slice = `Intro. ${text}, I cannot.`.slice(m.start, m.end);
      // Offsets index the original text, including the invisible character inside it.
      expect(slice.replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')).toBe('As an AI language model');
      expect(slice.startsWith('As')).toBe(true);
    });
  }

  it('apply to line-anchored regex entries', () => {
    const r = [entry({ match: 'regex', pattern: '^[ \\t]*Regenerate[ \\t]+response[ \\t]*$' })];
    expect(hits(r, 'Text.\n\uFEFFRegenerate response\nMore')).toEqual(['Regenerate response']);
    expect(hits(r, 'Text.\nRegener\u00ADate response')).toEqual(['Regener\u00ADate response']);
  });

  it('do not split words when counting', () => {
    expect(countWords('hyphen\u00ADated word')).toBe(2);
    expect(countWords('\uFEFFone two')).toBe(2);
  });
});

// ---------------------------------------------------------------- preprocessing in analyze()

describe('analyze() runs on preprocessed text', () => {
  const delve = entry({ pattern: 'delve', match: 'word', tier: 'lexical', inflect: true });

  it('skips LaTeX math, citations, labels and comments, but not \\emph text', () => {
    const text = [
      'We \\emph{delve} into the data.',
      'Math: $\\mathrm{delve}(x)$, \\[ delve \\] and \\begin{equation} delve \\end{equation}.',
      'Refs \\cite{delve2020,delves}, \\label{sec:delve} and \\ref{delve}.',
      '% we delve here in a comment',
      'Done delving.',
    ].join('\n');
    const r = run([delve], text, { includeCandidates: true });
    expect(r.matches.map((m) => text.slice(m.start, m.end))).toEqual(['delve', 'delving']);
    expect(r.matches[0]!.start).toBe(text.indexOf('delve}'));
    expect(r.matches[1]!.start).toBe(text.indexOf('delving'));
  });

  it('flags hyphen-broken words with spans that cover the break', () => {
    const comprehensive = entry({ pattern: 'comprehensive', match: 'word', tier: 'lexical' });
    const meticulous = entry({ pattern: 'meticulous', match: 'word', tier: 'lexical' });
    const text = 'A compre-\nhensive and meticu-\r\n  lous review, hy\\-phen\\-free.';
    expect(hits([comprehensive, meticulous], text)).toEqual(['compre-\nhensive', 'meticu-\r\n  lous']);
    const hyphen = entry({ pattern: 'hyphenfree', match: 'word' });
    expect(hits([hyphen], 'hy\\-phen\\-free')).toEqual(['hy\\-phen\\-free']);
  });

  it('lets a phrase match across a masked citation (the span covers it)', () => {
    const phrase = entry({ pattern: 'delve into', tier: 'lexical' });
    expect(hits([phrase], 'we delve~\\cite{x} into it')).toEqual(['delve~\\cite{x} into']);
  });

  it('skips Markdown code but still flags fences, bold and headings (real lexicon)', () => {
    const lex = compileLexicon(
      LEXICON.filter((e) => e.tier === 'artifact'),
      { includeCandidates: true },
    );
    const text = [
      'Intro with `[Insert citation]` inline.',
      '```markdown',
      '[Insert citation] and **not bold**',
      '### Not a heading',
      '```',
      '### Results',
      'See **this** and [Insert citation] here.',
    ].join('\n');
    const spans = analyze(text, lex).matches.map((m) => [m.entryId, text.slice(m.start, m.end)]);
    expect(spans).toEqual([
      ['en.artifact.markdown-code-fence', '```markdown'],
      ['en.artifact.markdown-code-fence', '```'],
      ['en.artifact.markdown-heading', '###'],
      ['en.artifact.markdown-bold', '**'],
      [expect.stringMatching(/placeholder$/), '[Insert citation]'],
    ]);
    expect(text.indexOf('### Results')).toBe(analyze(text, lex).matches[2]!.start);
  });

  it('still flags line-anchored artifacts next to masked text, without highlighting it', () => {
    const r = entry({ match: 'regex', pattern: '^[ \\t]*Regenerate[ \\t]+response[ \\t]*$' });
    expect(hits([r], 'Text $x$.\nRegenerate response % leftover\nMore')).toEqual(['Regenerate response']);
    expect(hits([r], '\\noindent Regenerate response\n')).toEqual(['Regenerate response']);
    // Whitespace that is whitespace in the original stays part of the match, as before.
    expect(hits([r], 'x\n  Regenerate response  \ny')).toEqual(['  Regenerate response  ']);
  });

  it('counts only words that survive preprocessing', () => {
    const r = run([], 'We use $x + y$ and \\cite{a} here % note\n`code` done');
    expect(r.stats.words).toBe(5);
    expect(countWords('compre-\nhensive')).toBe(1);
  });
});

// ---------------------------------------------------------------- review fixes

describe('prose that only looks like LaTeX or Markdown (real lexicon)', () => {
  const ARTIFACTS = compileLexicon(
    LEXICON.filter((e) => e.tier === 'artifact'),
    { includeCandidates: true },
  );
  const spans = (text: string) =>
    analyze(text, ARTIFACTS).matches.map((m) => [m.entryId, text.slice(m.start, m.end)]);

  it('a percent sign in prose does not hide the rest of the line', () => {
    const text = 'Yields (%) are listed below. As an AI language model, I cannot verify them.';
    expect(spans(text)).toEqual([['en.artifact.as-an-ai-language-model', 'As an AI language model, I']]);
  });

  it('keeps tracking parameters inside \\url{} and \\href{}{} visible', () => {
    for (const text of [
      'See \\url{https://example.org/page?utm_source=chatgpt.com} for details.',
      'As \\href{https://example.org/a?utm_source=chatgpt.com}{reported}, sales rose.',
    ]) {
      expect(spans(text), text).toEqual([['en.artifact.utm-source-chatgpt', '?utm_source=chatgpt.com']]);
    }
  });

  it('bold markers around inline code or math are still flagged', () => {
    expect(spans('**`npm install`** first')).toEqual([['en.artifact.markdown-bold', '**']]);
    expect(spans('**$x$** is bold math')).toEqual([['en.artifact.markdown-bold', '**']]);
  });

  it('backticks used as apostrophes or quotes do not mask the prose after them', () => {
    expect(spans("I don`t know. As an AI language model, I can`t browse.")).toEqual([
      ['en.artifact.as-an-ai-language-model', 'As an AI language model, I'],
    ]);
    const delve = entry({ pattern: 'delve', match: 'word', tier: 'lexical', inflect: true });
    expect(hits([delve], 'We call it ``AI-polished" text and ``human" text, then delve.')).toEqual(['delve']);
    expect(hits([delve], 'It was 5$, so we delve into the 10$ fee.')).toEqual(['delve']);
  });
});

describe('candidate entries only add highlights', () => {
  it('a reviewed entry keeps its match against a longer candidate (real lexicon)', () => {
    const text = "Here is the paragraph about our method.\n\nLet me know if you'd like any further adjustments to the tone.";
    const ids = (includeCandidates: boolean) =>
      analyze(text, compileLexicon(LEXICON, { includeCandidates })).matches.map((m) => m.entryId);
    expect(ids(false)).toEqual(['en.artifact.let-me-know-adjustments']);
    expect(ids(true)).toContain('en.artifact.let-me-know-adjustments');
    expect(ids(true)).not.toContain('en.artifact.closing-offer-at-end');
  });

  it('settles reviewed matches first, then adds candidates only where nothing overlaps', () => {
    const reviewed = entry({ id: 'r', pattern: 'beta gamma', tier: 'lexical' });
    const longer = entry({ id: 'c1', pattern: 'alpha beta gamma delta', tier: 'artifact', status: 'candidate' });
    const free = entry({ id: 'c2', pattern: 'epsilon', status: 'candidate' });
    const inside = entry({ id: 'c3', pattern: 'gamma', tier: 'artifact', status: 'candidate' });
    const text = 'alpha beta gamma delta epsilon';
    const all = [longer, reviewed, free, inside];
    expect(ids(all, text, { includeCandidates: true })).toEqual(['r', 'c2']);
    expect(ids(all, text)).toEqual(['r']);
    // Between candidates, the usual order still decides.
    const a = entry({ id: 'a', pattern: 'alpha beta', status: 'candidate' });
    const b = entry({ id: 'b', pattern: 'beta gamma delta', status: 'candidate' });
    expect(ids([b, a], text, { includeCandidates: true })).toEqual(['a']);
  });
});

describe('hyphens inside patterns', () => {
  const edge = entry({ pattern: 'cutting-edge', match: 'word', tier: 'lexical' });

  it('match a hyphen, whitespace or nothing', () => {
    const text = 'a cutting-edge, cutting edge, cuttingedge and Cutting-Edge tool; cutting-\nedge too';
    expect(hits([edge], text)).toEqual([
      'cutting-edge',
      'cutting edge',
      'cuttingedge',
      'Cutting-Edge',
      'cutting-\nedge',
    ]);
    expect(hits([edge], 'cutting - edge, cutting--edge, cutting-edges')).toEqual([]);
  });

  it('work with inflection and in phrases, including joined first words', () => {
    const tune = entry({ pattern: 'fine-tune', match: 'word', tier: 'lexical', inflect: true });
    expect(hits([tune], 'We fine tuned it, finetuning and fine-tunes.')).toEqual([
      'fine tuned',
      'finetuning',
      'fine-tunes',
    ]);
    const art = entry({ pattern: 'state-of-the-art model', tier: 'lexical' });
    expect(hits([art], 'a state of the art model, a stateoftheart model, a state-of-the-art  model')).toEqual([
      'state of the art model',
      'stateoftheart model',
      'state-of-the-art  model',
    ]);
  });
});

// ---------------------------------------------------------------- Markdown fences

describe('Markdown fences in analyze()', () => {
  const ARTIFACTS = compileLexicon(
    LEXICON.filter((e) => e.tier === 'artifact'),
    { includeCandidates: true },
  );
  const delve = entry({ pattern: 'delve', match: 'word', tier: 'lexical', inflect: true });
  const spans = (text: string, lex = ARTIFACTS) =>
    analyze(text, lex).matches.map((m) => [m.entryId, text.slice(m.start, m.end)]);

  it('leaves the prose between paired ~~~ scene breaks analysable', () => {
    const text = 'She left.\n\n~~~\n\nWe delve into the night.\n\n~~~\n\nThey delved again.';
    expect(hits([delve], text)).toEqual(['delve', 'delved']);
  });

  it('leaves the rest of the text analysable after an unclosed ``` fence', () => {
    const text = 'Intro\n```python\nSee [Insert citation] for details.\nWe delve on.';
    expect(spans(text)).toEqual([
      ['en.artifact.markdown-code-fence', '```python'],
      [expect.stringMatching(/placeholder$/), '[Insert citation]'],
    ]);
    expect(hits([delve], text)).toEqual(['delve']);
  });

  it('still masks the content of a closed ```python block', () => {
    const text = 'Before\n```python\nprint("[Insert citation]")  # delve\n```\nAfter we delve.';
    expect(spans(text)).toEqual([
      ['en.artifact.markdown-code-fence', '```python'],
      ['en.artifact.markdown-code-fence', '```'],
    ]);
    expect(hits([delve], text)).toEqual(['delve']);
    expect(run([delve], text).matches[0]!.start).toBe(text.lastIndexOf('delve'));
  });

  it('keeps the ~~~ negative example of the fence entry negative, with its prose analysable', () => {
    const fence = LEXICON.find((e) => e.id === 'en.artifact.markdown-code-fence')!;
    const negatives = (artifactExamples as Record<string, { negative: string[] }>)[fence.id]!.negative;
    const sceneBreak = negatives.find((t) => t.includes('~~~'))!;
    expect(sceneBreak).toBeDefined();
    const own = compileLexicon([fence], { includeCandidates: true, tiers: TIERS });
    expect(analyze(sceneBreak, own).matches).toEqual([]);
    // The prose after the break is not masked.
    const after = sceneBreak.slice(sceneBreak.lastIndexOf('~~~') + 3).trim();
    expect(preprocess(sceneBreak).text).toContain(after);
  });
});

// ---------------------------------------------------------------- indexed matching

describe('indexed word/phrase matching', () => {
  /** What the engine did before the index: every entry's own regex over the whole text. */
  function scanEveryEntry(entries: LexiconEntry[], text: string): Match[] {
    const lex = compileLexicon(entries, { includeCandidates: true, tiers: TIERS });
    const { text: prepared, map } = preprocess(text);
    const found: Match[] = [];
    for (const { entry: e, regex } of lex.entries) {
      regex.lastIndex = 0;
      for (const m of prepared.matchAll(regex)) {
        const end = m.index + m[0].length;
        found.push({ entryId: e.id, tier: e.tier, start: map[m.index]!, end: map[end - 1]! + 1 });
      }
    }
    const rank = { artifact: 0, lexical: 1, stylistic: 2 };
    found.sort(
      (a, b) =>
        a.start - b.start ||
        b.end - b.start - (a.end - a.start) ||
        rank[a.tier] - rank[b.tier] ||
        (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0),
    );
    const kept: Match[] = [];
    let lastEnd = -1;
    for (const m of found) {
      if (m.start >= lastEnd) {
        kept.push(m);
        lastEnd = m.end;
      }
    }
    return kept;
  }

  it('gives exactly the matches of scanning every entry separately (randomised)', () => {
    let seed = 20261022;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
    const words = [
      'delve', 'delves', 'Delving', 'DELVED', 'into', 'a', 'the', 'tapestry', 'tapestries',
      'underpin', 'underpinned', 'plays', 'crucial', 'role', 'in', 'of', "today's",
      'state-of-the-art', 'fine-tune', 'fine-tuned', 'GPT-4', 'Sure!', 'utilise',
      'utilization', '\u017Fhow', 'show', 'na\u00EFve', 'cafe\u0301', 'caf\u00E9', '𝒜lpha', 'x_y',
      "don't", 'ok', '\u03A3\u0391\u03A3', '\u03C3\u03B1\u03C2', 'stra\u00DFe', 'STRASSE',
      '\u212A', 'kelvin', 'cutting', 'edge', 'cuttingedge', 'cutting-edge', 'co-author', 'coauthor',
      'stateoftheart', 'stateof',
    ];
    const separators = [' ', ' ', ' ', '  ', '\n', '\t', ', ', '. ', '-', "'", '\u2019', '_', '', '(', '[', ']', '**'];
    const patterns = [
      'delve', 'delve into', 'tapestry', 'underpin', 'plays a crucial role', 'crucial role in',
      'a', 'the tapestry', "today's", 'state-of-the-art', 'fine-tune', 'GPT-4', 'Sure!',
      'utilize', 'show', 'na\u00EFve', 'caf\u00E9', '𝒜lpha', 'x_y', "don't", 'ok',
      '\u03C3\u03B1\u03C2', 'stra\u00DFe', 'kelvin', '[Insert citation]', '**', "'til", 'role',
      'role in', 'in', 'of the', 'cutting-edge', 'co-author', 'state-of-the-art', 'cutting-edge tool',
    ];
    for (let trial = 0; trial < 400; trial++) {
      const entries: LexiconEntry[] = [];
      const count = 1 + Math.floor(random() * 8);
      for (let i = 0; i < count; i++) {
        const pattern = pick(patterns);
        entries.push(
          entry({
            id: `fuzz.${i}`,
            pattern,
            match: /\s/.test(pattern) ? 'phrase' : 'word',
            inflect: random() < 0.6,
            tier: pick(['artifact', 'lexical', 'lexical'] as const),
          }),
        );
      }
      let text = '';
      const length = Math.floor(random() * 40);
      for (let i = 0; i < length; i++) text += pick(words) + pick(separators);
      const expected = scanEveryEntry(entries, text);
      const lex = compileLexicon(entries, { includeCandidates: true, tiers: TIERS });
      expect(analyze(text, lex).matches, JSON.stringify({ text, patterns: entries.map((e) => e.pattern) })).toEqual(
        expected,
      );
    }
  });

  it('uses simple case folding like the regexes (long s, Kelvin sign, final sigma)', () => {
    expect(hits([entry({ pattern: 'show', match: 'word' })], 'a \u017Fhow')).toEqual(['\u017Fhow']);
    expect(hits([entry({ pattern: 'kelvin', match: 'word' })], '\u212Aelvin')).toEqual(['\u212Aelvin']);
    expect(hits([entry({ pattern: '\u03C3\u03B1\u03C2', match: 'word' })], '\u03A3\u0391\u03A3')).toEqual([
      '\u03A3\u0391\u03A3',
    ]);
    // Full case folding is not applied: "ß" does not match "ss".
    expect(hits([entry({ pattern: 'stra\u00DFe', match: 'word' })], 'STRASSE')).toEqual([]);
  });

  it('freezes compiled lexicons, so the cached match plan cannot go stale', () => {
    const lex = compileLexicon([entry({ pattern: 'alpha' })]);
    expect(analyze('alpha beta', lex).matches).toHaveLength(1);
    expect(Object.isFrozen(lex) && Object.isFrozen(lex.entries)).toBe(true);
    const more = compileLexicon([entry({ pattern: 'beta' })]).entries[0]!;
    expect(() => (lex.entries as CompiledEntry[]).push(more)).toThrow();
    // A lexicon assembled by hand from compiled entries gets its own plan.
    expect(analyze('alpha beta', { entries: [...lex.entries, more] }).matches).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- performance with a large lexicon

describe('performance with a large inflected lexicon', () => {
  const verbs = (
    'delve underscore showcase leverage foster harness navigate streamline bolster elevate ' +
    'unlock unveil embark hone garner spearhead resonate empower enhance transform optimize ' +
    'facilitate align ensure envision reimagine redefine revolutionize unleash amplify catalyze ' +
    'cultivate embrace encompass exemplify illuminate underpin craft curate weave strive shed ' +
    'seek undertake foresee overcome mitigate tailor commend embody encapsulate expedite ' +
    'galvanize augment captivate champion delineate elucidate enrich evolve fuel glean ignite ' +
    'immerse imbue intertwine juxtapose nurture orchestrate permeate propel reshape revitalize ' +
    'safeguard scrutinize spotlight spur surge thrive traverse unravel uncover unpack usher'
  ).split(' ');
  const nouns = (
    'tapestry realm testament landscape interplay synergy paradigm beacon symphony plethora ' +
    'cornerstone journey nexus intricacy nuance framework insight frontier catalyst trajectory ' +
    'ecosystem milestone blueprint linchpin bedrock hallmark crucible tenet facet dimension ' +
    'spectrum avenue arena domain sphere horizon tapestries mosaic labyrinth odyssey'
  ).split(' ');
  const glue = ['the', 'a', 'into', 'upon', 'our'];

  /** 500 lexical candidates with "inflect": every verb and noun, plus phrases. */
  function syntheticEntries(): LexiconEntry[] {
    const patterns = [...verbs, ...nouns];
    for (let i = 0; patterns.length < 500; i++) {
      patterns.push(`${verbs[i % verbs.length]} ${glue[i % glue.length]} ${nouns[(i * 7) % nouns.length]}`);
    }
    return patterns.map((pattern, i) => ({
      id: `en.lexical.synthetic-${i}`,
      pattern,
      match: pattern.includes(' ') ? ('phrase' as const) : ('word' as const),
      inflect: true,
      tier: 'lexical' as const,
      lang: 'en',
      status: 'candidate' as const,
      note: 'synthetic performance fixture',
      added: '2026-10-22',
    }));
  }

  /** ~20,000 words of varied prose: plain, LaTeX and Markdown, with and without hits. */
  function prose(): string {
    const sentences = [
      'The committee reviewed the proposal in detail and raised several questions about the budget.',
      'We measured the response at 3.5 kHz, which agrees with earlier work (Smith & Jones, 2019).',
      'Her colleagues didn\u2019t expect the results to hold across all twelve field sites.',
      'In the second experiment, participants read short passages and answered comprehension questions.',
      'Rainfall in the upper catchment was well below the long-term average for most of the season.',
      'We delve into the intricate tapestry of results, which underscores a pivotal shift in the field.',
      'This framework fosters collaboration and helps teams navigate the evolving landscape of policy.',
      'As shown by \\citet{lee2024}, the estimator converges when $n \\to \\infty$ (see Eq.~\\eqref{eq:main}).',
      'The cost was \\$5 per sample, i.e.\\ about 20% of the budget % TODO check the numbers\n',
      'Our \\emph{comprehen-\nsive} analysis showcases how these methods underpin modern practice.',
      '\\begin{equation}\n  y = \\beta_0 + \\beta_1 x + \\varepsilon\n\\end{equation}',
      'Certainly! Here is a revised version of the paragraph you sent.',
      'The method is described in [Insert citation] and summarised in **Section 3**.',
      '\n### Discussion\n',
      'Run `make test` before you push; the CI only builds the site.',
      '\n```bash\nnpm run build\n```\n',
      'Researchers continue to harness these insights, delving into new frontiers each year.',
      'Caf\u00E9 owners in the old town said the new parking rules had cut weekend trade.',
      'Table 2 lists the sample sizes; the smallest group had only fourteen respondents.',
      'If you have any further questions, feel free to ask!',
    ];
    const parts: string[] = [];
    let words = 0;
    for (let i = 0; words < 20500; i++) {
      const s = sentences[(i * 7 + (i >> 3)) % sentences.length]!;
      parts.push(s, i % 9 === 8 ? '\n\n' : ' ');
      words += countWords(s);
    }
    return parts.join('');
  }

  it('analyses ~20,000 words with the real lexicon plus 500 inflected entries in < 100 ms', () => {
    const text = prose();
    const lex = compileLexicon([...LEXICON, ...syntheticEntries()], { includeCandidates: true });
    expect(lex.errors).toEqual([]);
    expect(lex.entries.length).toBeGreaterThanOrEqual(500 + 40);

    let result = analyze(text, lex); // warm-up (also builds the index)
    let best = Infinity;
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      result = analyze(text, lex);
      best = Math.min(best, performance.now() - t0);
    }
    console.log(
      `[perf] ${result.stats.words} words, ${text.length} chars, ${lex.entries.length} entries, ` +
        `${result.stats.total} matches: best of 5 = ${best.toFixed(1)} ms`,
    );
    expect(result.stats.words).toBeGreaterThanOrEqual(20000);
    expect(result.stats.counts.lexical).toBeGreaterThan(1000);
    expect(result.stats.counts.artifact).toBeGreaterThan(100);
    expect(best).toBeLessThan(100);
  });

  it('keeps per-call overhead small for one-entry lexicons on short texts', () => {
    // Shape of the fire-rate script: one entry at a time over many short abstracts.
    const abstracts = Array.from(
      { length: 2000 },
      (_, i) =>
        `Abstract ${i}. We study the ${nouns[i % nouns.length]} of networks and ` +
        `${verbs[i % verbs.length]} new results; the method improves accuracy by ${i % 30}% ` +
        'over strong baselines on three benchmarks. '.repeat(4),
    );
    const lex = compileLexicon([syntheticEntries()[0]!], { includeCandidates: true });
    let fired = 0;
    const t0 = performance.now();
    for (const a of abstracts) if (analyze(a, lex).matches.length > 0) fired++;
    const elapsed = performance.now() - t0;
    console.log(`[perf] 2,000 short abstracts with a one-entry lexicon: ${elapsed.toFixed(1)} ms`);
    expect(fired).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });
});
