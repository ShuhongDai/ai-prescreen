// Rate limiting without storing IP addresses: a client is known only by a hash of its IP
// and the day's random salt. The hash goes to the rate limiting binding (counters for at
// most a minute) and is never stored; the salt is deleted once the day is over.

import { saltFor } from './store.ts';
import type { D1Database } from './types.ts';

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomSalt(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * The part of an address that stands for one client: all of an IPv4 address, the /64 of an
 * IPv6 one (a home or a server usually has a whole /64 to pick addresses from).
 */
export function clientPrefix(ip: string): string {
  if (!ip.includes(':')) return ip;
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1); // IPv4-mapped
  const [head = '', tail] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.padStart(4, '0'))
    .join(':')}::/64`;
}

export async function clientKey(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}\n${ip}`));
  return hex(digest).slice(0, 32);
}

/** The day's salt, kept in this isolate until the day changes. */
let cached: { day: string; salt: string } | null = null;

export async function dailySalt(db: D1Database, day: string): Promise<string> {
  if (cached?.day !== day) cached = { day, salt: await saltFor(db, day, randomSalt) };
  return cached.salt;
}

/** For tests: forget the cached salt. */
export function resetSaltCache(): void {
  cached = null;
}
