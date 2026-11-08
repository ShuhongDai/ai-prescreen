// Cloudflare Web Analytics (cookieless; page views and loading speed): its
// script is loaded only in the built page, only while usage statistics are switched on, and
// only once a site token is set here (from the Cloudflare dashboard: Web Analytics → Add a
// site → aiprescreen.fyi; the token is public, it ends up in the page anyway). The page's
// Content-Security-Policy allows Cloudflare's two hosts only when a token is set
// (vite.config.ts). When setting the token, use the versioned script URL and integrity hash
// from Cloudflare's snippet (CF_BEACON_SCRIPT, CF_BEACON_INTEGRITY): it runs with access to
// the page. A loaded script cannot be unloaded: switching statistics off stops it with the
// next page load (README#privacy says so).

export const CF_BEACON_TOKEN = '';

export const CF_BEACON_SCRIPT = 'https://static.cloudflareinsights.com/beacon.min.js';
/** Subresource integrity of CF_BEACON_SCRIPT ('' = none; set it with a versioned URL). */
export const CF_BEACON_INTEGRITY = '';
export const CF_BEACON_ENDPOINT = 'https://cloudflareinsights.com';

let loaded = false;

export function loadCloudflareBeacon(doc: Document = document): void {
  if (loaded || !CF_BEACON_TOKEN || import.meta.env.DEV) return;
  loaded = true;
  const script = doc.createElement('script');
  script.defer = true;
  script.src = CF_BEACON_SCRIPT;
  if (CF_BEACON_INTEGRITY) {
    script.integrity = CF_BEACON_INTEGRITY;
    script.crossOrigin = 'anonymous';
  }
  script.dataset.cfBeacon = JSON.stringify({ token: CF_BEACON_TOKEN, spa: false });
  doc.head.append(script);
}
