import { defineConfig } from '@playwright/test';

// Loads dist/ as an unpacked MV3 extension via a persistent context (see
// tests/e2e/fixtures.ts). Requires `npm run build` first — this config does not
// build automatically, since e2e runs are expected to target a specific built
// artifact, not whatever's mid-edit in src/.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000, // several scenarios (SC-001's 50-step task, SC-004's 10 overlay trials) are long-running
  fullyParallel: false, // extension tests share one persistent browser context per file
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
