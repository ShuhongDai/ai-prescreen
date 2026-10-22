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

export default defineConfig({
  root: 'web',
  base: '/ai-prescreen/',
  plugins: [slimLexicon()],
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
