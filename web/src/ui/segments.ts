// Splits the original text into plain and highlighted runs for the result pane.

import type { Match } from '../engine/index.ts';

export interface Segment {
  text: string;
  match: Match | null;
}

/**
 * Matches are offsets into `text`. The engine already returns sorted, non-overlapping
 * matches; this is defensive anyway: overlapping, empty or out-of-range matches are
 * dropped so the concatenated segments always equal `text` exactly.
 */
export function buildSegments(text: string, matches: readonly Match[]): Segment[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Segment[] = [];
  let pos = 0;
  for (const m of sorted) {
    const end = Math.min(m.end, text.length);
    if (m.start < pos || end <= m.start) continue;
    if (m.start > pos) out.push({ text: text.slice(pos, m.start), match: null });
    out.push({ text: text.slice(m.start, end), match: m });
    pos = end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: null });
  return out;
}
