import { test, expect } from './fixtures';

// Group confinement (v3.4.2): when enabled (default), the extension only works
// inside its "Claude Free" tab group. Selecting a tab outside the group locks
// the extension (hides it), the computer tool refuses to touch outside tabs,
// and closing the group shuts the extension down.
//
// Driven the same way as tab-grouping.spec.ts — chrome.runtime.sendMessage from
// an extension-page context, since chrome.tabs/chrome.tabGroups are only
// available inside extension contexts. Requires a real display (headed Chromium
// via the fixtures) — runs locally and in the CI e2e job under xvfb-run.

test('outside tab locks the extension and refuses tools; closing the group shuts it down', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed a web tab and open the panel on it — this creates the extension group.
  const seed = await context.newPage();
  await seed.goto('data:text/html,<h1>inside tab</h1>');
  await seed.bringToFront();
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'PANEL_OPENED' }));

  const groups = await page.evaluate(() => chrome.tabGroups.query({}));
  const extGroup = groups.find(g => g.title === 'Claude Free');
  expect(extGroup).toBeDefined();

  // A second, ungrouped web tab — the outside world.
  const outside = await context.newPage();
  await outside.goto('data:text/html,<h1>outside tab</h1>');
  await outside.bringToFront();

  // 1. The extension notices the outside tab and locks (hides).
  await expect
    .poll(async () => {
      const state = await page.evaluate(() => new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_CONFINEMENT_STATE' }, resolve);
      }));
      return (state as { locked: boolean }).locked;
    })
    .toBe(true);

  // 2. The computer tool refuses to act on the outside active tab.
  const refusal = await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'computer_use', action: { action: 'navigate', url: 'https://example.com' } },
        resolve,
      );
    });
  }) as { result?: Array<{ text?: string }> };
  expect(refusal.result?.[0]?.text ?? '').toContain('Confinement');

  // 3. manage_tabs 'switch' to the outside tab is refused too.
  const tabs = await page.evaluate(() => chrome.tabs.query({}));
  const outsideTab = tabs.find(t => t.url?.includes('outside tab'));
  expect(outsideTab?.id).toBeDefined();
  const switchResult = await page.evaluate((tabId) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'computer_use', action: { action: 'manage_tabs', op: 'switch', tab_id: tabId } },
        resolve,
      );
    });
  }, outsideTab!.id) as { result?: Array<{ text?: string }> };
  expect(switchResult.result?.[0]?.text ?? '').toContain('Confinement');

  // 4. Closing the extension group shuts the extension down — the lock persists
  //    and the group is gone. (Chrome removes a group when its last tab closes,
  //    so close the group's member tabs.)
  const memberIds = await page.evaluate(
    (groupId) => chrome.tabs.query({ groupId }).then(ts => ts.map(t => t.id)),
    extGroup!.id,
  );
  expect(memberIds.length).toBeGreaterThan(0);
  await page.evaluate((ids) => chrome.tabs.remove(ids), memberIds);

  const stateAfter = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_CONFINEMENT_STATE' }, resolve);
  })) as { locked: boolean };
  expect(stateAfter.locked).toBe(true);

  const groupsAfter = await page.evaluate(() => chrome.tabGroups.query({}));
  expect(groupsAfter.find(g => g.title === 'Claude Free')).toBeUndefined();
});
