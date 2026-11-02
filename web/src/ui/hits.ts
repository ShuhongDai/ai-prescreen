// Anonymous hit counts: once an analysis has settled, the IDs of the entries it shows are
// sent, each at most once per page view; never any text. Nothing is sent while the reader
// keeps typing, for the "Try an example" text, or when the counts are switched off.

import { HITS_MAX_IDS } from '../report-contract.ts';

/** Quiet time after the last analysis before its IDs are sent. */
export const HIT_DELAY_MS = 4000;

export interface HitTracker {
  /** After every analysis: the entry IDs it shows (pass none for the example or no draft). */
  analysed(ids: Iterable<string>): void;
  /** Sends what is waiting now (the page is being hidden or closed). */
  flush(): void;
  setEnabled(enabled: boolean): void;
}

export function createHitTracker(send: (ids: string[]) => void, enabled: boolean, delay = HIT_DELAY_MS): HitTracker {
  const sent = new Set<string>();
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  function flush(): void {
    cancel();
    const batch = enabled ? pending.slice(0, HITS_MAX_IDS) : [];
    pending = [];
    if (batch.length === 0) return;
    for (const id of batch) sent.add(id);
    send(batch);
  }

  return {
    analysed(ids) {
      cancel();
      // Nothing is kept while switched off, so switching on never sends an earlier analysis.
      pending = enabled ? [...new Set(ids)].filter((id) => !sent.has(id)) : [];
      if (enabled && pending.length > 0) timer = setTimeout(flush, delay);
    },
    flush,
    setEnabled(value) {
      enabled = value;
      if (!enabled) {
        cancel();
        pending = [];
      }
    },
  };
}
