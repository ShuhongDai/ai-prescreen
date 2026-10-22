// Length-preserving normalisation: every input code unit maps to exactly one output
// code unit, so match offsets are valid in the original text without an offset map.
// Every character class below must contain BMP characters only (one code unit each)
// and every replacement must be a single code unit.

// ‘ ’ ‚ ‛ ′ ʼ
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u02BC]/g;
// “ ” „ ‟ ″
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033]/g;
// NBSP, ogham space, en/em/thin/hair spaces etc., narrow NBSP, medium math space, ideographic space
const SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
// hyphen, non-breaking hyphen (Word/PDF output) -> ASCII hyphen-minus
const HYPHENS = /[\u2010\u2011]/g;

export function normalize(text: string): string {
  return text
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(SPACES, ' ')
    .replace(HYPHENS, '-');
}

// Invisible format characters: soft hyphen, zero-width space / non-joiner / joiner, word
// joiner, BOM (zero-width no-break space). They cannot be mapped to a single visible
// character, so analyze() removes them before matching and maps offsets back.
export const HAS_INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/;

export function isInvisible(code: number): boolean {
  return (
    code === 0x00ad ||
    (code >= 0x200b && code <= 0x200d) ||
    code === 0x2060 ||
    code === 0xfeff
  );
}

/**
 * Code points that never reach a lexicon pattern: normalize() rewrites them, or analyze()
 * removes them. A regex that names one of them can never match it.
 */
export function isRewrittenOrRemoved(code: number): boolean {
  if (code > 0xffff) return false;
  if (isInvisible(code)) return true;
  const ch = String.fromCharCode(code);
  return normalize(ch) !== ch;
}
