// Server-side check of a Turnstile token (https://developers.cloudflare.com/turnstile/).

import { TURNSTILE_ACTION } from '../../web/src/report-contract.ts';

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResult {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
  metadata?: { result_with_testing_key?: boolean };
}

/**
 * True when Turnstile confirms the token, it was issued on one of `hostnames`, and for the
 * page's report widget (its action). Turnstile's test keys answer without an action and
 * with the hostname "example.com", which only local development allows.
 */
export async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string | null,
  hostnames: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await fetchImpl(SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token, ...(ip ? { remoteip: ip } : {}), idempotency_key: crypto.randomUUID() }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as SiteverifyResult;
  const actionOk = data.action === TURNSTILE_ACTION || data.metadata?.result_with_testing_key === true;
  return data.success === true && typeof data.hostname === 'string' && hostnames.includes(data.hostname) && actionOk;
}
