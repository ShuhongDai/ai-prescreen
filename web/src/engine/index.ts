// Detection engine: pure TypeScript, no DOM access.

export * from './types.ts';
export { normalize } from './normalize.ts';
export { compileEntry, compileLexicon, isActive, literalSource } from './compile.ts';
export type { CompiledEntry, CompiledLexicon } from './compile.ts';
export { analyze, countWords } from './analyze.ts';
