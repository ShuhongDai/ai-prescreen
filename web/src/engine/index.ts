// Detection engine: pure TypeScript, no DOM access.

export * from './types.ts';
export { normalize } from './normalize.ts';
export { preprocess } from './preprocess.ts';
export type { Preprocessed } from './preprocess.ts';
export { inflectPattern, inflectWord } from './inflect.ts';
export { compileEntry, compileLexicon, isActive, literalSource } from './compile.ts';
export type { CompiledEntry, CompiledLexicon } from './compile.ts';
export { analyze, countWords } from './analyze.ts';
