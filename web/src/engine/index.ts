// Detection engine: pure TypeScript, no DOM access. Implemented from M1.

export const TIERS = ['artifact', 'lexical', 'stylistic'] as const;

export type Tier = (typeof TIERS)[number];
