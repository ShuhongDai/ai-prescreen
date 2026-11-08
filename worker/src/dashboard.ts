// The dashboard (GET /dashboard): one page, its script and stylesheet, generated from
// worker/dashboard/ by scripts/worker-dashboard.ts. The page asks for the STATS_TOKEN once
// and keeps it in that browser's localStorage; without it the page shows no numbers.

import { DASHBOARD_CSS, DASHBOARD_HTML, DASHBOARD_JS } from './generated/dashboard.ts';

/** Only its own files and the API; GitHub's public API for the star count. */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self' https://api.github.com",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const ASSETS: Record<string, { body: string; type: string }> = {
  '/dashboard': { body: DASHBOARD_HTML, type: 'text/html; charset=utf-8' },
  '/dashboard.js': { body: DASHBOARD_JS, type: 'text/javascript; charset=utf-8' },
  '/dashboard.css': { body: DASHBOARD_CSS, type: 'text/css; charset=utf-8' },
};

export function dashboardAsset(pathname: string): Response | null {
  const asset = ASSETS[pathname === '/dashboard/' ? '/dashboard' : pathname];
  if (!asset) return null;
  return new Response(asset.body, {
    headers: {
      'Content-Type': asset.type,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': CSP,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
