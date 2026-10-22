import { describe, expect, it } from 'vitest';
import { focusIndexAfterDismiss } from '../web/src/ui/dismiss.ts';
import { dismissedText } from '../web/src/ui/format.ts';

describe('dismissedText', () => {
  it('counts entries, singular and plural', () => {
    expect(dismissedText(0)).toBeNull();
    expect(dismissedText(1)).toBe('1 entry dismissed');
    expect(dismissedText(2)).toBe('2 entries dismissed');
  });
});

describe('focusIndexAfterDismiss', () => {
  const starts = [5, 12, 40, 41, 90];

  it('picks the first highlight at or after the dismissed one', () => {
    expect(focusIndexAfterDismiss(starts, 0)).toBe(0);
    expect(focusIndexAfterDismiss(starts, 12)).toBe(1);
    expect(focusIndexAfterDismiss(starts, 13)).toBe(2);
    expect(focusIndexAfterDismiss(starts, 90)).toBe(4);
  });

  it('falls back to the last one before it, and to -1 when none are left', () => {
    expect(focusIndexAfterDismiss(starts, 91)).toBe(4);
    expect(focusIndexAfterDismiss([], 10)).toBe(-1);
  });
});
