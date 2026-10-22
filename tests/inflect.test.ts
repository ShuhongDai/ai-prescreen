import { describe, expect, it } from 'vitest';
import {
  analyze,
  compileLexicon,
  inflectPattern,
  inflectWord,
  type LexiconEntry,
} from '../web/src/engine/index.ts';

function lexical(pattern: string, inflect = true): LexiconEntry {
  return {
    id: `en.lexical.${pattern.replace(/\W+/g, '-')}`,
    pattern,
    match: /\s/.test(pattern) ? 'phrase' : 'word',
    inflect,
    tier: 'lexical',
    lang: 'en',
    status: 'candidate',
    note: 'test fixture',
    added: '2026-10-22',
  };
}

/** Visible text of every match of a single inflected entry. */
function hits(pattern: string, text: string, inflect = true): string[] {
  const lex = compileLexicon([lexical(pattern, inflect)], { includeCandidates: true });
  return analyze(text, lex).matches.map((m) => text.slice(m.start, m.end));
}

describe('inflectWord', () => {
  it('generates verb forms', () => {
    expect(inflectWord('delve')).toEqual(expect.arrayContaining(['delve', 'delves', 'delved', 'delving']));
    expect(inflectWord('showcase')).toEqual(
      expect.arrayContaining(['showcases', 'showcased', 'showcasing']),
    );
    expect(inflectWord('clarify')).toEqual(expect.arrayContaining(['clarifies', 'clarified', 'clarifying']));
    expect(inflectWord('agree')).toEqual(expect.arrayContaining(['agrees', 'agreed', 'agreeing']));
    expect(inflectWord('underlie')).toEqual(expect.arrayContaining(['underlies', 'underlying']));
    expect(inflectWord('panic')).toEqual(expect.arrayContaining(['panicked', 'panicking']));
  });

  it('puts the token itself first, unchanged', () => {
    expect(inflectWord('Delve')[0]).toBe('Delve');
    expect(inflectWord('delve').filter((f) => f === 'delve')).toHaveLength(1);
  });

  it('generates noun plurals', () => {
    expect(inflectWord('tapestry')).toContain('tapestries');
    expect(inflectWord('realm')).toContain('realms');
    expect(inflectWord('harness')).toContain('harnesses');
    expect(inflectWord('approach')).toContain('approaches');
    expect(inflectWord('echo')).toEqual(expect.arrayContaining(['echos', 'echoes']));
    expect(inflectWord('synthesis')).toContain('syntheses');
  });

  it('gives polysyllables both doubled and undoubled final consonants', () => {
    expect(inflectWord('underpin')).toEqual(expect.arrayContaining(['underpinned', 'underpinning']));
    expect(inflectWord('target')).toEqual(expect.arrayContaining(['targeted', 'targeting']));
    expect(inflectWord('travel')).toEqual(
      expect.arrayContaining(['traveled', 'travelled', 'traveling', 'travelling']),
    );
    expect(inflectWord('fuel')).toEqual(expect.arrayContaining(['fueled', 'fuelled']));
  });

  it('doubles the final consonant of one-syllable words only, avoiding other words', () => {
    expect(inflectWord('hop')).toEqual(expect.arrayContaining(['hopped', 'hopping']));
    expect(inflectWord('hop')).not.toContain('hoped');
    expect(inflectWord('hop')).not.toContain('hoping');
    expect(inflectWord('scar')).not.toContain('scared');
    expect(inflectWord('plan')).not.toContain('planed');
    expect(inflectWord('spur')).toEqual(expect.arrayContaining(['spurred', 'spurring']));
  });

  it('uses the irregular table and no regular past for those verbs', () => {
    expect(inflectWord('weave')).toEqual(expect.arrayContaining(['wove', 'woven', 'weaving', 'weaves']));
    expect(inflectWord('strive')).toEqual(expect.arrayContaining(['strove', 'striven', 'striving']));
    expect(inflectWord('seek')).toEqual(expect.arrayContaining(['sought', 'seeking']));
    expect(inflectWord('shed')).toEqual(expect.arrayContaining(['sheds', 'shedding']));
    expect(inflectWord('undertake')).toEqual(expect.arrayContaining(['undertook', 'undertaken', 'undertaking']));
    expect(inflectWord('arise')).toEqual(expect.arrayContaining(['arose', 'arisen', 'arising']));
    expect(inflectWord('foresee')).toEqual(expect.arrayContaining(['foresaw', 'foreseen', 'foreseeing']));
    expect(inflectWord('underlie')).toEqual(expect.arrayContaining(['underlay', 'underlain']));
    expect(inflectWord('understand')).toContain('understood');
    expect(inflectWord('lead')).toContain('led');
    expect(inflectWord('lead')).not.toContain('leaded');
    expect(inflectWord('arise')).not.toContain('arized');
  });

  it('generates British and American spellings', () => {
    expect(inflectWord('utilize')).toEqual(
      expect.arrayContaining([
        'utilizes', 'utilized', 'utilizing', 'utilise', 'utilised', 'utilising', 'utilises',
        'utilization', 'utilisation', 'utilizations', 'utilisations',
      ]),
    );
    expect(inflectWord('prioritise')).toEqual(expect.arrayContaining(['prioritize', 'prioritized', 'prioritising']));
    expect(inflectWord('analyze')).toEqual(
      expect.arrayContaining(['analyse', 'analysed', 'analyzing', 'analysing', 'analyzes']),
    );
    expect(inflectWord('optimization')).toEqual(
      expect.arrayContaining(['optimisation', 'optimizations', 'optimisations']),
    );
    expect(inflectWord('utilized')).toContain('utilised');
  });

  it('knows common irregular verbs, including two-letter ones', () => {
    const table: Record<string, string[]> = {
      leave: ['left', 'leaving'], meet: ['met'], fall: ['fell', 'fallen'], keep: ['kept'],
      feel: ['felt'], spend: ['spent'], tell: ['told'], say: ['said', 'says'], pay: ['paid'],
      catch: ['caught'], teach: ['taught'], buy: ['bought'], sell: ['sold'], win: ['won', 'winning'],
      begin: ['began', 'begun', 'beginning'], grow: ['grew', 'grown'], draw: ['drew', 'drawn'],
      show: ['showed', 'shown'], know: ['knew', 'known'], throw: ['threw', 'thrown'],
      see: ['saw', 'seen', 'seeing'], go: ['went', 'gone', 'goes', 'going'], come: ['came'],
      become: ['became'], run: ['ran', 'running'], drive: ['drove', 'driven'], wear: ['wore', 'worn'],
      bear: ['bore', 'borne'], stick: ['stuck'], hang: ['hung'], lose: ['lost', 'losing'],
      mean: ['meant'], send: ['sent'], lend: ['lent'], bend: ['bent'], deal: ['dealt'],
      shoot: ['shot'], sit: ['sat', 'sitting'], forget: ['forgot', 'forgotten', 'forgetting'],
      get: ['got', 'gotten', 'getting'], hide: ['hid', 'hidden'], sink: ['sank', 'sunk'],
      spring: ['sprang', 'sprung'], steal: ['stole', 'stolen'], freeze: ['froze', 'frozen'],
    };
    for (const [verb, forms] of Object.entries(table)) {
      expect(inflectWord(verb), verb).toEqual(expect.arrayContaining(forms));
    }
    expect(inflectWord('leave')).not.toContain('leaved');
    expect(inflectWord('go')).not.toContain('goed');
  });

  it('doubles a final consonant after any vowel, keeping the undoubled spelling too', () => {
    expect(inflectWord('equip')).toEqual(expect.arrayContaining(['equipped', 'equipping', 'equips']));
    expect(inflectWord('quit')).toEqual(expect.arrayContaining(['quitted', 'quitting']));
    expect(inflectWord('need')).toEqual(expect.arrayContaining(['needed', 'needing']));
    expect(inflectWord('hop')).not.toContain('hoped');
  });

  it('generates -or / -our spellings in both directions', () => {
    expect(inflectWord('endeavor')).toEqual(
      expect.arrayContaining(['endeavour', 'endeavours', 'endeavoured', 'endeavouring', 'endeavored']),
    );
    expect(inflectWord('endeavour')).toEqual(expect.arrayContaining(['endeavor', 'endeavors', 'endeavoring']));
    expect(inflectWord('behaviour')).toEqual(expect.arrayContaining(['behavior', 'behaviors', 'behaviours']));
    expect(inflectWord('colour')).toContain('color');
    // Short -our words and -oor words keep their spelling: no "for", "dour" or "flour".
    expect(inflectWord('four')).not.toContain('for');
    expect(inflectWord('door')).not.toContain('dour');
    expect(inflectWord('floor')).not.toContain('flour');
  });

  it('generates Latin and Greek plurals', () => {
    const plurals: Record<string, string> = {
      analysis: 'analyses', hypothesis: 'hypotheses', synthesis: 'syntheses', emphasis: 'emphases',
      catalysis: 'catalyses', spectrum: 'spectra', curriculum: 'curricula', medium: 'media',
      criterion: 'criteria', phenomenon: 'phenomena',
    };
    for (const [one, many] of Object.entries(plurals)) expect(inflectWord(one), one).toContain(many);
    expect(inflectWord('spectrum')).toContain('spectrums');
    expect(inflectWord('nation')).not.toContain('natia');
    expect(inflectWord('decision')).not.toContain('decisia');
  });

  it('does not turn a -yse verb into the plural of an -ysis noun', () => {
    expect(inflectWord('analyse')).not.toContain('analyses');
    expect(inflectWord('analyze')).not.toContain('analyses');
  });

  it('inflects only the last part of a hyphenated token', () => {
    expect(inflectWord('fine-tune')).toEqual(
      expect.arrayContaining(['fine-tunes', 'fine-tuned', 'fine-tuning']),
    );
  });

  it('leaves function words, short words and non-plain tokens unchanged', () => {
    for (const token of ['a', 'the', 'of', 'into', 'their', 'with', 'is', 'AI', 'GPT-4', "today's", '2024', 'x_y', 'naïve']) {
      expect(inflectWord(token), token).toEqual([token]);
    }
  });
});

describe('inflectPattern', () => {
  it('inflects every content token and no function word', () => {
    const forms = inflectPattern('a testament to');
    expect(forms[0]).toEqual(['a']);
    expect(forms[1]).toEqual(expect.arrayContaining(['testament', 'testaments']));
    expect(forms[2]).toEqual(['to']);
    const role = inflectPattern('play a pivotal role in');
    expect(role.map((f) => f[0])).toEqual(['play', 'a', 'pivotal', 'role', 'in']);
    expect(role[0]).toEqual(expect.arrayContaining(['plays', 'played', 'playing']));
    expect(role[3]).toContain('roles');
    expect(role[4]).toEqual(['in']);
  });

  it('splits on any whitespace and normalises like the engine', () => {
    expect(inflectPattern('  delve \t into ').map((f) => f[0])).toEqual(['delve', 'into']);
    expect(inflectPattern('it\u2019s')).toEqual([["it's"]]);
    expect(inflectPattern('   ')).toEqual([]);
  });
});

describe('inflected matching', () => {
  it('matches inflected forms of a word entry, case-insensitively', () => {
    expect(hits('delve', 'We delve. It delves; they DELVED, delving deep.')).toEqual([
      'delve',
      'delves',
      'DELVED',
      'delving',
    ]);
    expect(hits('tapestry', 'a rich tapestry of tapestries')).toEqual(['tapestry', 'tapestries']);
    expect(hits('utilize', 'We utilise it; its utilisation and utilization.')).toEqual([
      'utilise',
      'utilisation',
      'utilization',
    ]);
  });

  it('matches every inflected form of a phrase, with any whitespace between', () => {
    expect(hits('delve into', 'delving into it, then delved   into more, delves\ninto')).toEqual([
      'delving into',
      'delved   into',
      'delves\ninto',
    ]);
    expect(hits('play a crucial role in', 'They played a crucial role in it; plays a crucial role in')).toEqual([
      'played a crucial role in',
      'plays a crucial role in',
    ]);
  });

  it('keeps word boundaries for every form', () => {
    expect(hits('delve', 'redelve delvesx delved2 delving_ undelving')).toEqual([]);
  });

  it('does not inflect function words inside a phrase', () => {
    expect(hits('a testament to', 'an testament to; a testaments to; a testament tos')).toEqual([
      'a testaments to',
    ]);
  });

  it('matches only the exact pattern without "inflect"', () => {
    expect(hits('delve into', 'delving into, delve into', false)).toEqual(['delve into']);
  });
});
