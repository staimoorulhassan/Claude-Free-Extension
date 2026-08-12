import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '../../dist');

// Loads the built extension as a persistent context, per Chrome's requirement that
// MV3 extensions only load in non-headless (or new-headless) persistent contexts —
// a plain browser.newContext() cannot see the extension at all.
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      // Defaults to Playwright's bundled chromium. Set PLAYWRIGHT_CHANNEL=chrome
      // only if you have a Chrome build that still honors --load-extension (e.g.
      // Chrome for Testing or pre-137 Chrome) — modern branded Chrome ignores the
      // flag, so the extension won't load and the service-worker wait will hang.
      channel: process.env.PLAYWRIGHT_CHANNEL,
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) background = await context.waitForEvent('serviceworker');
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
});

export const expect = test.expect;
