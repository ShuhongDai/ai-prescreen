// Cloudflare Web Analytics (cookieless; page views and loading speed): its
// script is loaded only in the built page, and not in a browser left out of the statistics.
// The site (aiprescreen.fyi, created 2026-11-08 in the Cloudflare dashboard) and its token come
// from Cloudflare's snippet; the token is public, it ends up in the page anyway. The page's
// Content-Security-Policy allows Cloudflare's two hosts only while a token is set
// (vite.config.ts). Cloudflare publishes the script at an unversioned URL without an
// integrity hash, so it runs as Cloudflare serves it, with access to the page.

export const CF_BEACON_TOKEN: string = '76712f07579e4c779d2809e8862aae8e';

export const CF_BEACON_SCRIPT = 'https://static.cloudflareinsights.com/beacon.min.js';
export const CF_BEACON_ENDPOINT = 'https://cloudflareinsights.com';

let loaded = false;

export function loadCloudflareBeacon(doc: Document = document): void {
  if (loaded || !CF_BEACON_TOKEN || import.meta.env.DEV) return;
  loaded = true;
  // As in Cloudflare's snippet: a module script that finds its settings in data-cf-beacon.
  const script = doc.createElement('script');
  script.type = 'module';
  script.src = CF_BEACON_SCRIPT;
  script.dataset.cfBeacon = JSON.stringify({ token: CF_BEACON_TOKEN });
  doc.head.append(script);
}
