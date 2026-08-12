import { test, expect } from './fixtures';

// Verifies the accessibility properties that were ported from the a11y.js
// runtime patch (removed in PR #17) into the React source, declaratively:
//   1. every form control has an accessible name (WCAG 3.3.2)
//   2. every icon-only button[title] has an aria-label from its title (WCAG 1.1.1)
//   3. the chat conversation is a polite live log region (WCAG 4.1.3)
//   4. keyboard skip links target the first control (WCAG 2.4.1)
//   5. the options page ships the a11y styles the sidepanel CSS already had
//
// Requires `npm run build` first (fixtures.ts loads dist/ as an unpacked MV3
// extension). Run with `PLAYWRIGHT_CHANNEL=chrome npx playwright test` on
// machines where Playwright's bundled chromium isn't downloaded.

function unnamedControls(page: import('@playwright/test').Page) {
  // A control has an accessible name when it has an aria-label/aria-labelledby,
  // sits inside a wrapping label, or is programmatically associated with a
  // <label> (labels[]). Anything else fails WCAG 3.3.2.
  return page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      if ((el as HTMLInputElement).type === 'hidden') return;
      if (el.getAttribute('aria-label')) return;
      if (el.getAttribute('aria-labelledby')) return;
      if (el.closest('label')) return;
      if ('labels' in el && (el.labels?.length ?? 0) > 0) return;
      bad.push(el.outerHTML.slice(0, 100));
    });
    return bad;
  });
}

test('sidepanel: chat is a live log, composer is labeled, skip link targets it', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Fix 3: the conversation is a polite live log region.
  const chat = page.locator('.chat');
  await expect(chat).toHaveAttribute('role', 'log');
  await expect(chat).toHaveAttribute('aria-live', 'polite');

  // Fix 1 (input-textarea special case) + fix 4: composer carries the skip
  // link's target id and its own name.
  const composer = page.locator('textarea#a11y-composer.input-textarea');
  await expect(composer).toHaveAttribute('aria-label', 'Message');

  // Fix 4: skip link is first in the page (before the header), points at the
  // composer, and carries the visually-hidden-until-focus classes.
  const skip = page.locator('a.a11y-skip');
  await expect(skip).toHaveCount(1);
  await expect(skip).toHaveAttribute('href', '#a11y-composer');
  await expect(skip).toHaveText('Skip to message input');
  await expect(skip).toHaveClass(/visually-hidden/);
  const headerBeforeSkip = await page.evaluate(() => {
    const skipEl = document.querySelector('a.a11y-skip');
    const headerEl = document.querySelector('.header');
    return !skipEl || !headerEl
      ? false
      : !!(skipEl.compareDocumentPosition(headerEl) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(headerBeforeSkip).toBe(true);
});

test('sidepanel: every icon-only button and every form control has a name', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Fix 2: any button that is icon-only (title + no visible text) must carry
  // an aria-label equal to its title.
  const unnamedButtons = await page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll('button[title]').forEach((b) => {
      if (!b.textContent?.trim() && !b.getAttribute('aria-label')) {
        bad.push(b.outerHTML.slice(0, 100));
      }
    });
    return bad;
  });
  expect(unnamedButtons).toEqual([]);

  // Fix 1: every non-hidden form control has an accessible name. The settings
  // panel renders on demand, so open it to cover the settings controls too.
  await page.locator('button[title="Settings"]').click();
  // The toggle checkboxes sit inside an empty wrapping <label>, which satisfies
  // the generic has-a-label check even when unnamed — pin the explicit
  // aria-label the port adds (the runtime patch skipped these entirely).
  await expect(page.locator('input[aria-label="Use Steel stealth browser"]')).toHaveCount(1);
  // Wait for the settings panel to settle (Provider select renders immediately;
  // the model list controls appear only after the debounced fetch resolves).
  await expect(page.locator('.settings select')).toHaveCount(2);
  await page.waitForTimeout(1200); // allow the model-list fetch to resolve
  expect(await unnamedControls(page)).toEqual([]);
});

test('options: skip link targets the first control, fields are label-associated, a11y styles ship', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  // Fix 4: skip link points at the first control (the Provider select).
  const skip = page.locator('a.a11y-skip');
  await expect(skip).toHaveCount(1);
  await expect(skip).toHaveAttribute('href', '#a11y-first-control');
  await expect(skip).toHaveText('Skip to settings');

  const provider = page.locator('select#a11y-first-control');
  await expect(provider).toBeVisible();
  await expect(page.locator('label[for="a11y-first-control"]')).toHaveText('Provider');

  // Fix 1: every control is programmatically associated with its label.
  expect(await unnamedControls(page)).toEqual([]);

  // Fix 5: the page ships the a11y styles the runtime patch used to inject
  // (skip-link reveal, focus indicator, visually-hidden utility).
  const styleText = await page.evaluate(() =>
    Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n'),
  );
  expect(styleText).toContain('.visually-hidden');
  expect(styleText).toContain('.a11y-skip:focus');
  expect(styleText).toContain(':focus-visible');
  expect(styleText).toContain('scroll-margin-block');
});
