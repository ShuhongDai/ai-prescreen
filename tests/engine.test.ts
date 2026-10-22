import { describe, expect, it } from 'vitest';
import { TIERS } from '../web/src/engine';

describe('engine', () => {
  it('defines the three detection tiers in order', () => {
    expect(TIERS).toEqual(['artifact', 'lexical', 'stylistic']);
  });
});
