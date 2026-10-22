import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'web',
  base: '/ai-prescreen/',
  build: {
    outDir: '../dist',
    modulePreload: { polyfill: false },
    emptyOutDir: true,
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts', 'web/src/**/*.test.ts'],
  },
});
