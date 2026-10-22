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
  type CompileOptions,
  type LexiconEntry,
} from '../web/src/engine/index.ts';
import { LEXICON } from '../web/src/lexicon.ts';

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
      ['\\cite{}', 'see \\cite{} here', ['\\cite{}']],
      ['what?', 'wha what?', ['what?']],
      ['a|b', 'a b a|b', ['a|b']],
      ['^_^', '^_^', ['^_^']],
      ['[x]', 'x [x]', ['[x]']],
      ['a/b', 'a/b', ['a/b']],
    ];
    for (const [pattern, text, expected] of cases) {
      expect(hits([entry({ pattern })], text), pattern).toEqual(expected);
    }
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
