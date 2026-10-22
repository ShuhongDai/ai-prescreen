import type { LexiconEntry } from './engine/index.ts';

// Every lexicon/*.json file is bundled; each file is a JSON array of entries.
const files = import.meta.glob<LexiconEntry[]>('../../lexicon/*.json', {
  eager: true,
  import: 'default',
});

export const LEXICON: readonly LexiconEntry[] = Object.keys(files)
  .sort()
  .flatMap((path) => files[path]);
