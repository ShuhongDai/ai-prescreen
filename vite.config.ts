import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The page only needs what the engine and the popover use; citations and source counts
// stay in lexicon/*.json for reviewers. Build only, so tests and dev see the full files.
function slimLexicon(): Plugin {
  return {
    name: 'slim-lexicon',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]lexicon[\\/][^\\/]+\.json$/.test(id)) return null;
      const entries = JSON.parse(code) as Record<string, unknown>[];
      const slim = entries.map(({ evidence, models, independentSources, ...rest }) => rest);
      return { code: JSON.stringify(slim), map: null };
    },
  };
}

// Privacy, enforced by the browser: the built page loads only its own files, connects
// only to the report/hit-count API, and runs and frames only Turnstile (loaded with a report
// form). A meta tag, since GitHub Pages sends no custom headers; build only, as the dev
// server needs inline scripts and its own connections.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  'connect-src https://api.aiprescreen.fyi',
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  root: 'web',
  // Served from the root of https://aiprescreen.fyi (GitHub Pages custom domain).
  base: '/',
  plugins: [slimLexicon(), contentSecurityPolicy()],
  build: {
    outDir: '../dist',
    modulePreload: { polyfill: false },
    emptyOutDir: true,
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts', 'web/src/**/*.test.ts'],
    // The module cache keys on file contents, so a new lexicon/*.json file did not
    // refresh web/src/lexicon.ts's import.meta.glob result and tests ran on a stale list.
    fsModuleCache: false,
  },
});
