// Hit counts from the page: the entry IDs one analysis showed, never any text.

import { HITS_MAX_IDS } from '../../web/src/report-contract.ts';

/**
 * The known, distinct entry IDs of a hit-count request; unknown IDs (e.g. from a page built
 * with a newer lexicon) are left out. Null when the request is malformed.
 */
export function parseHits(input: unknown, knownIds: ReadonlySet<string>): string[] | null {
  if (typeof input !== 'object' || input === null) return null;
  const ids = (input as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || ids.length > HITS_MAX_IDS) return null;
  if (!ids.every((id): id is string => typeof id === 'string')) return null;
  return [...new Set(ids)].filter((id) => knownIds.has(id));
}
