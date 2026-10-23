import { describe, expect, it } from 'vitest';
import { normalize, preprocess, type Preprocessed } from '../web/src/engine/index.ts';

// ---------------------------------------------------------------- helpers

/**
 * Preprocesses `input` and checks the invariants that hold for every input:
 * - the map has one entry per output code unit plus a final one (the input length);
 * - it is strictly increasing (output keeps the original order, nothing is inserted);
 * - every output character is the normalised original character, or a space (masked,
 *   or "~"), and line breaks are never masked.
 */
function run(input: string): Preprocessed {
  const pre = preprocess(input);
  const norm = normalize(input);
  const problems: string[] = [];
  if (pre.map.length !== pre.text.length + 1) problems.push('map length');
  if (pre.map[pre.text.length] !== input.length) problems.push('map sentinel');
  for (let i = 0; i < pre.text.length; i++) {
    const o = pre.map[i]!;
    if (i > 0 && o <= pre.map[i - 1]!) problems.push(`map not increasing at ${i}`);
    const out = pre.text[i];
    const src = norm[o];
    if (out !== src && out !== ' ') problems.push(`output ${i} is ${JSON.stringify(out)}, source ${JSON.stringify(src)}`);
    if ((src === '\n' || src === '\r') && out !== src) problems.push(`line break at ${o} was masked`);
  }
  expect(problems, JSON.stringify(input)).toEqual([]);
  return pre;
}

/** Preprocessed text only. */
function text(input: string): string {
  return run(input).text;
}

/** The ORIGINAL text behind each occurrence of `needle` in the preprocessed text. */
function originals(input: string, needle: string): string[] {
  const { text: out, map } = run(input);
  const found: string[] = [];
  for (let s = out.indexOf(needle); s >= 0; s = out.indexOf(needle, s + 1)) {
    found.push(input.slice(map[s], map[s + needle.length - 1]! + 1));
  }
  return found;
}

/** `input` with every character of `hidden` (taken in order) replaced by spaces. */
const blanked = (input: string, ...hidden: string[]) =>
  hidden.reduce((s, h) => s.replace(h, h.replace(/[^\n\r]/g, ' ')), input);

// ---------------------------------------------------------------- basics

describe('preprocess: plain text', () => {
  it('leaves ordinary prose untouched, with an identity map', () => {
    const input = 'Plain prose, with "quotes", 3.14, e-mail and dashes -- here.\nNext line.';
    const pre = run(input);
    expect(pre.text).toBe(input);
    expect(Array.from(pre.map)).toEqual(Array.from({ length: input.length + 1 }, (_, i) => i));
  });

  it('handles empty input', () => {
    const pre = run('');
    expect(pre.text).toBe('');
    expect(Array.from(pre.map)).toEqual([0]);
  });

  it('normalises quotes, special spaces and Unicode hyphens one-to-one', () => {
    const input = '\u201CHi\u201D \u2018x\u2019 a\u00A0b c\u2009d state\u2011of\u2010the-art';
    const pre = run(input);
    expect(pre.text).toBe('"Hi" \'x\' a b c d state-of-the-art');
    expect(pre.map[pre.text.length - 1]).toBe(input.length - 1);
  });

  it('keeps CRLF and lone CR line breaks', () => {
    expect(text('a\r\nb\rc\n')).toBe('a\r\nb\rc\n');
  });

  it('removes invisible format characters and maps around them', () => {
    const input = '\uFEFFAs an AI\u200B lan\u00ADguage mo\u200Ddel\u2060.';
    const pre = run(input);
    expect(pre.text).toBe('As an AI language model.');
    expect(originals(input, 'language')).toEqual(['lan\u00ADguage']);
    expect(originals(input, 'As')).toEqual(['As']);
    expect(pre.map[0]).toBe(1);
  });

  it('maps offsets correctly after astral characters', () => {
    const input = '😀 𝒜𝓁𝓅𝒽𝒶 compre-\nhensive 🇦🇹 $x$ `y` delve';
    expect(text(input)).toBe('😀 𝒜𝓁𝓅𝒽𝒶 comprehensive 🇦🇹 $ $ ` ` delve');
    expect(originals(input, 'comprehensive')).toEqual(['compre-\nhensive']);
    expect(originals(input, 'delve')).toEqual(['delve']);
    expect(originals(input, '𝒜')).toEqual(['𝒜']);
  });

  it('does not strip Markdown markers', () => {
    const input = '### Results\n**bold** and *it* | a | b |\n---\n> quote\n- item';
    expect(text(input)).toBe(input);
  });
});

// ---------------------------------------------------------------- hyphenation

describe('preprocess: hyphenation breaks', () => {
  it('joins a word broken at a line end', () => {
    const input = 'a compre-\nhensive survey';
    expect(text(input)).toBe('a comprehensive survey');
    expect(originals(input, 'comprehensive')).toEqual(['compre-\nhensive']);
    expect(originals(input, 'hensive')).toEqual(['hensive']);
  });

  it('allows spaces and tabs around the break, and CRLF / CR line ends', () => {
    expect(text('compre- \t\n  hensive')).toBe('comprehensive');
    expect(originals('x compre-\r\nhensive y', 'comprehensive')).toEqual(['compre-\r\nhensive']);
    expect(text('compre-\rhensive')).toBe('comprehensive');
  });

  it('joins with a Unicode hyphen or a soft hyphen at the break', () => {
    expect(text('compre\u2010\nhensive')).toBe('comprehensive');
    expect(originals('a compre\u00AD\nhensive b', 'comprehensive')).toEqual(['compre\u00AD\nhensive']);
  });

  it('works for letters outside ASCII', () => {
    expect(text('naï-\nve')).toBe('naïve');
  });

  it('does not join when the next line starts with a capital, digit or symbol', () => {
    expect(text('Well-\nKnown')).toBe('Well-\nKnown');
    expect(text('item-\n2')).toBe('item-\n2');
    expect(text('a-\n- b')).toBe('a-\n- b');
  });

  it('does not join across a blank line, or after a non-letter', () => {
    expect(text('compre-\n\nhensive')).toBe('compre-\n\nhensive');
    expect(text('2-\nfold')).toBe('2-\nfold');
    expect(text('a -\nb')).toBe('a -\nb');
  });

  it('leaves hyphens inside a line alone', () => {
    expect(text('state-of-the-art, well-known')).toBe('state-of-the-art, well-known');
  });

  it('removes the LaTeX discretionary hyphen between letters', () => {
    const input = 'hy\\-phen\\-ation';
    expect(text(input)).toBe('hyphenation');
    expect(originals(input, 'hyphenation')).toEqual([input]);
    // Elsewhere "\-" is an escaped hyphen.
    expect(text('a \\- b')).toBe('a  - b');
  });
});

// ---------------------------------------------------------------- comments

describe('preprocess: LaTeX comments', () => {
  it('mask the rest of the line, keeping the line break', () => {
    const input = 'Text % a comment\nNext line';
    expect(text(input)).toBe(blanked(input, '% a comment'));
    expect(text('% whole line\r\nkept')).toBe(blanked('% whole line\r\nkept', '% whole line'));
  });

  it('leave percentages alone', () => {
    for (const input of ['20% of the votes', '20 % of', '20\u00A0% of', '20\u2009% of', '1.1%.']) {
      expect(text(input), input).toBe(normalize(input));
    }
  });

  it('are not started by an escaped percent sign', () => {
    expect(text('50\\% of it')).toBe('50 % of it');
    // An escaped backslash does not escape the "%".
    expect(text('a\\\\% comment')).toBe('a' + ' '.repeat(11));
  });

  it('are not started by percent-encoding inside a URL', () => {
    const input = 'See https://example.org/a%20b and [x](www.example.org/%7Euser) here';
    expect(text(input)).toBe(input);
  });

  it('are not started by a percent sign inside prose', () => {
    for (const input of [
      'Yields (%) are listed below.',
      'Error [%] per method.',
      'An x% increase.',
      'We used 10 mol% Pd.',
      'Samples with 5 wt% Pt/C.',
      'About 85 wt.% and more.',
      'Only 5  % of runs.',
      'See reports/Final%20Report.pdf now.',
    ]) {
      expect(text(input), input).toBe(input);
    }
  });

  it('start after whitespace, "}" or "\\\\", at a line start and at a line end', () => {
    expect(text('text % comment\nnext')).toBe(blanked('text % comment\nnext', '% comment'));
    expect(text('  % indented\nnext')).toBe(blanked('  % indented\nnext', '% indented'));
    expect(text('\\end{x}% c')).toBe(' '.repeat(10));
    expect(text('foo%\nbar')).toBe('foo \nbar');
    expect(text('foo%  \r\nbar')).toBe('foo   \r\nbar');
  });
});

// ---------------------------------------------------------------- math

describe('preprocess: LaTeX math', () => {
  it('masks the content of inline $…$ and keeps the dollar signs', () => {
    const input = 'Let $x^2 + y$ be large.';
    expect(text(input)).toBe('Let $       $ be large.');
    expect(text('**$x$** bold')).toBe('**$ $** bold');
  });

  it('never opens math with a "$" right after a digit', () => {
    for (const input of ['It was about 5$, and the 10$ fee too.', 'Pay 5$x$ now']) {
      expect(text(input), input).toBe(input);
    }
  });

  it("follows Pandoc's rule for dollar signs in plain text", () => {
    for (const input of [
      'It costs $5 and $10.',
      'between $5-$10 per unit',
      'a $ b $ c',
      'pay $x $ later',
      'US$5 and US$10',
      'just one $ sign',
    ]) {
      expect(text(input), input).toBe(input);
    }
    expect(text('$5 and $10, but $x$')).toBe('$5 and $10, but $ $');
  });

  it('masks $$…$$, \\[…\\] and \\(…\\), across lines but not across paragraphs', () => {
    const input = 'A $$\\int f\n dx$$ B \\[\nE = mc^2\n\\] C \\(a+b\\) D';
    expect(text(input)).toBe(blanked(input, '\\int f\n dx', '\\[\nE = mc^2\n\\]', '\\(a+b\\)'));
    expect(text('$a\n\nb$')).toBe('$a\n\nb$');
    expect(text('$$a\n\nb$$')).toBe('$$a\n\nb$$');
  });

  it('masks equation-like environments with their \\begin and \\end', () => {
    for (const env of ['equation', 'equation*', 'align', 'align*', 'gather', 'multline*', 'eqnarray', 'displaymath']) {
      const input = `Before \\begin{${env}}\n  a &= b \\\\\n  c &= d\n\\end{${env}} after`;
      expect(text(input), env).toBe(blanked(input, input.slice(7, -6)));
    }
  });

  it('does not treat escaped dollars as math', () => {
    expect(text('\\$5 and \\$10')).toBe(' $5 and  $10');
  });

  it('masks only the \\begin command of an environment that is never closed', () => {
    const input = '\\begin{equation} x and more';
    expect(text(input)).toBe(blanked(input, '\\begin{equation}'));
  });
});

// ---------------------------------------------------------------- commands

describe('preprocess: LaTeX commands', () => {
  it('masks citations, references and labels with their arguments', () => {
    for (const cmd of [
      '\\cite{smith2020}',
      '\\cite[p.~5]{jones}',
      '\\citep[see][ch.~2]{a,b}',
      '\\citet*{x}',
      '\\parencite{x}',
      '\\ref{fig:1}',
      '\\eqref{eq:main}',
      '\\Cref{sec:a}',
      '\\label{sec:intro}',
      '\\includegraphics[width=\\linewidth]{figs/plot.pdf}',
      '\\vspace*{2em}',
      '\\usepackage[utf8]{inputenc}',
    ]) {
      const input = `See ${cmd} now.`;
      expect(text(input), cmd).toBe(blanked(input, cmd));
    }
  });

  it('masks only the command name when its argument is never closed', () => {
    expect(text('\\cite{a\n\nb}')).toBe('     {a\n\nb}');
  });

  it('keeps the text argument of formatting commands', () => {
    const input = 'We \\emph{delve} into \\textbf{this}.';
    expect(text(input)).toBe('We       delve  into         this .');
    expect(originals(input, 'delve')).toEqual(['delve']);
  });

  it('handles nested braces: \\emph{a \\textbf{b} c}', () => {
    const input = '\\emph{a \\textbf{b} c}';
    expect(text(input)).toBe('      a         b  c ');
    expect(originals(input, 'b')).toEqual(['b']);
    expect(originals(input, 'c')).toEqual(['c']);
  });

  it('masks optional arguments of formatting commands', () => {
    const input = '\\section*[Short]{Long Title}\\label{sec:x}';
    expect(text(input)).toBe(' '.repeat(17) + 'Long Title' + ' '.repeat(14));
    expect(text('\\item[(a)] First')).toBe(' '.repeat(11) + 'First');
  });

  it('keeps the URL of \\url and both arguments of \\href visible', () => {
    const href = '\\href{https://example.org/?utm_source=chatgpt.com}{the docs}.';
    expect(text(href)).toBe(blanked(href, '\\href{', '}{', '}'));
    const url = 'See \\url{https://example.org/a%20b} now.';
    expect(text(url)).toBe(blanked(url, '\\url{', '}'));
  });

  it('masks the braces and switch of {\\em …} and {\\bf …} groups', () => {
    const input = 'We {\\em delve} into {\\bfseries this}; {plain} stays.';
    expect(text(input)).toBe(blanked(input, '{\\em', '}', '{\\bfseries', '}'));
  });

  it('masks the name of unknown commands and keeps their arguments as text', () => {
    expect(text('\\textcolor{red}{note} \\LaTeX{} rocks')).toBe(
      `${' '.repeat(11)}red${' '.repeat(2)}note${' '.repeat(11)}rocks`,
    );
    expect(text('Use \\insertdate here')).toBe(blanked('Use \\insertdate here', '\\insertdate'));
  });

  it('keeps footnote and caption text', () => {
    const input = 'Text.\\footnote{See \\cite{x} for more.}';
    expect(text(input)).toBe('Text.          See          for more. ');
  });

  it('masks \\begin / \\end of other environments with an optional argument', () => {
    const input = '\\begin{figure}[htbp]\n\\caption{A plot}\n\\end{figure}';
    expect(text(input)).toBe(' '.repeat(20) + '\n         A plot \n' + ' '.repeat(12));
  });

  it('turns ~ into a space and keeps escaped special characters', () => {
    expect(text('Table~2')).toBe('Table 2');
    expect(text('\\% \\& \\_ \\# \\$ \\{x\\}')).toBe(' %  &  _  #  $  {x }');
    // A backslash before an astral character hides only the backslash.
    expect(text('\\😀x \\')).toBe(' 😀x \\');
  });

  it('masks spacing commands and line breaks', () => {
    expect(text('e.g.\\ the 5\\,ms end\\\\next \\\\[2pt]x')).toBe('e.g.  the 5  ms end  next        x');
  });

  it('removes accent commands inside words', () => {
    expect(text("caf\\'e na\\\"{i}ve")).toBe('cafe naive');
    expect(originals("caf\\'e", 'cafe')).toEqual(["caf\\'e"]);
  });
});

// ---------------------------------------------------------------- Markdown code

describe('preprocess: Markdown code', () => {
  it('masks the content of fenced code blocks but keeps the fence lines', () => {
    const input = 'Intro\n```python\nprint("[Insert citation]")\n```\nAfter';
    expect(text(input)).toBe(blanked(input, 'print("[Insert citation]")'));
  });

  it('supports indentation, CRLF, blanks around the closing fence and longer closing fences', () => {
    const indented = '  ```js\r\n  code\r\n  ```  \r\nafter';
    expect(text(indented)).toBe(blanked(indented, '  code'));
    const longer = '```\ncode\n`````\nafter';
    expect(text(longer)).toBe(blanked(longer, 'code'));
  });

  it('does not close a fence with a shorter fence or a fence line with text', () => {
    const input = '````\n```\n```` x\ninner\n````\nafter';
    expect(text(input)).toBe(blanked(input, '```\n```` x\ninner'));
  });

  it('does not treat an unclosed fence as a code block', () => {
    const input = 'Intro\n```python\ncode [Insert citation]\nmore';
    expect(text(input)).toBe(input);
    // Pairs are matched in order; a last, unmatched fence masks nothing.
    const odd = '```\na\n```\nb\n```\nc';
    expect(text(odd)).toBe(blanked(odd, 'a'));
  });

  it('never masks the text between ~~~ lines (they are often scene breaks)', () => {
    // The fence lines themselves stay visible (the artifact entry may flag them), but only
    // closed backtick fences mask their content.
    const input = 'She left.\n\n~~~\n\nNext morning.\n\n~~~\n\nThe end.';
    expect(text(input)).toBe(input);
  });

  it('does not treat triple backticks inside a line as a fence', () => {
    const input = 'Use triple backticks (```) to format code.';
    expect(text(input)).toBe(input);
  });

  it('masks the content of inline code, including longer runs, and keeps the backticks', () => {
    const input = 'Run `delve --x` or ``a ` b`` now';
    expect(text(input)).toBe('Run `         ` or ``     `` now');
    expect(text('**`npm install`** first')).toBe('**`           `** first');
  });

  it('pairs backticks with flanking rules, so prose between code spans stays visible', () => {
    // A run between two letters is an apostrophe; a run followed by a blank opens nothing;
    // a closing run needs a non-blank before it.
    for (const input of [
      'I don`t know; it`s fine.',
      'We call it ``AI-polished" text and ``human" text.',
      'a ` b ` c',
    ]) {
      expect(text(input), input).toBe(input);
    }
    expect(text("Use `f('x')` + `g()` here")).toBe("Use `f('x')` + `   ` here");
    expect(text('a ` b `c` d')).toBe('a ` b ` ` d');
  });

  it('does not treat LaTeX quotes as code', () => {
    for (const input of [
      "``As an AI language model, I cannot'' he wrote",
      "``first'' and ``second'' quotes",
      "a `single' quote and `another' one",
    ]) {
      expect(text(input), input).toBe(input);
    }
  });

  it('needs the closing backticks on the same line', () => {
    const input = 'a `b\nc` d';
    expect(text(input)).toBe(input);
  });

  it('keeps line breaks inside every masked region', () => {
    const input = '$$a\nb$$ % c\n\\begin{align}\nx\n\\end{align}\n```\ny\n\n```';
    expect(text(input).replace(/[^\n]/g, '')).toBe(input.replace(/[^\n]/g, ''));
  });
});

// ---------------------------------------------------------------- robustness

describe('preprocess: robustness', () => {
  // Every rule scans forward with memoised searches; none of these may go quadratic.
  const adversarial: Record<string, string> = {
    'unclosed inline math': '$a '.repeat(17000),
    'unclosed display math': '$$a '.repeat(12000),
    'unclosed \\[': '\\[a '.repeat(12000),
    'unclosed citations': '\\cite{a '.repeat(6000),
    'unclosed optional arguments': '\\cite[a '.repeat(6000),
    'unclosed environments': '\\begin{equation} '.repeat(3000),
    'unclosed braces': '\\emph{'.repeat(8000) + '}'.repeat(8000),
    'backtick runs of growing length': Array.from({ length: 300 }, (_, i) => '`'.repeat(i + 1) + 'x').join(''),
    'many comments': 'a % b\n'.repeat(8000),
    'many hyphen breaks': 'ab-\ncd '.repeat(7000),
    'many fences': '```\nx\n'.repeat(8000),
    'many unclosed fences': '```a\n'.repeat(12000),
    'percent-encoded URLs': ('https://x.org/' + 'a%20'.repeat(500) + ' ').repeat(50),
    'unclosed optional arguments, many': '\\cite['.repeat(20000),
    'line breaks with unclosed lengths': '\\\\['.repeat(33000),
    'apostrophe backticks between code openers': ('`a ' + 'x`y '.repeat(100)).repeat(100),
    'fences of growing length': Array.from({ length: 300 }, (_, i) => '`'.repeat(i + 3) + 'x\n').join(''),
    'escaped backslashes': '\\\\'.repeat(25000) + '$x$',
  };
  for (const [name, input] of Object.entries(adversarial)) {
    it(`stays fast: ${name}`, () => {
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        preprocess(input);
        best = Math.min(best, performance.now() - t0);
      }
      expect(best).toBeLessThan(50);
      run(input);
    });
  }

  it('keeps all invariants on a mixed LaTeX / Markdown document', () => {
    run(
      '\\section{Intro}\\label{s}\nWe \\emph{delve} into $x$ (see \\cite[p.~2]{a}). % todo\n' +
        '```js\nconst a = `b`;\n```\n**Note:** use `code` and ``quotes\'\'.\n' +
        'compre-\nhensive 😀 \\begin{align*}a\\end{align*} 50% of $5 and $10.\uFEFF',
    );
  });
});

describe('tilde code fences', () => {
  it('keeps a "~~~" fence line and turns other tildes into spaces', () => {
    expect(preprocess('~~~python\ncode\n~~~').text).toBe('~~~python\ncode\n~~~');
    expect(preprocess('  ~~~\r\n').text).toBe('  ~~~\r\n');
    expect(preprocess('Fig.~1 shows ~5% gains').text).toBe('Fig. 1 shows  5% gains');
    expect(preprocess('a ~~~ b').text).toBe('a     b');
    expect(preprocess('~~~~ scene break').text).toBe('     scene break');
  });

  it('stays linear on many tildes', () => {
    const t0 = performance.now();
    preprocess('~x'.repeat(100_000) + '\n' + '  ~\n'.repeat(50_000));
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
