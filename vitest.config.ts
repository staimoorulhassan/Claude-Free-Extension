import { defineConfig } from 'vite';
import { resolve } from 'path';

// Unit-test config for logic that doesn't need a real browser (tool-call parsing,
// journal serialization, contextWindow-aware compression). See research.md §1 —
// anything needing chrome.debugger/chrome.tabGroups/MV3 lifecycle is e2e (Playwright), not here.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
