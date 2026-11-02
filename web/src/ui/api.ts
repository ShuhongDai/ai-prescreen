// Requests to the report and hit-count Worker (worker/). The only requests the page makes
// besides the reports a reader sends: anonymous hit counts, which carry entry IDs only and
// can be switched off (CLAUDE.md, hard rule 2).

import {
  API_ORIGIN,
  API_PATHS,
  type HitsRequest,
  type ReportError,
  type ReportRequest,
  type ReportResponse,
} from '../report-contract.ts';

/** `npm run worker:dev` serves the Worker on port 8788 (worker/wrangler.toml). */
export const API_BASE = import.meta.env.DEV ? 'http://localhost:8788' : API_ORIGIN;

const REPORT_TIMEOUT_MS = 20_000;

const isResponse = (v: unknown): v is ReportResponse =>
  typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'boolean';

/** Sends a report; never throws (a network failure reads as "unavailable"). */
export async function sendReport(request: ReportRequest, fetchImpl: typeof fetch = fetch): Promise<ReportResponse> {
  try {
    const res = await fetchImpl(`${API_BASE}${API_PATHS.report}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      credentials: 'omit',
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    const data: unknown = await res.json().catch(() => null);
    if (isResponse(data)) return data;
    const error: ReportError = res.status === 429 ? 'rate-limited' : 'unavailable';
    return { ok: false, error };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/**
 * Sends hit counts as a beacon: text/plain needs no CORS preflight, and the browser still
 * delivers it when the page is closed. Returns false when the browser did not queue it.
 */
export function sendHits(ids: readonly string[], beacon: ((url: string, data: Blob) => boolean) | null = defaultBeacon()): boolean {
  if (!beacon || ids.length === 0) return false;
  const body: HitsRequest = { ids: [...ids] };
  return beacon(`${API_BASE}${API_PATHS.hits}`, new Blob([JSON.stringify(body)], { type: 'text/plain;charset=UTF-8' }));
}

function defaultBeacon(): ((url: string, data: Blob) => boolean) | null {
  return typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
    ? (url, data) => navigator.sendBeacon(url, data)
    : null;
}
