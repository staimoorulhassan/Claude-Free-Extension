import { test, expect } from './fixtures';

// SC-002 (quickstart.md): a task that opens 4 tabs lands in exactly one labeled
// chrome.tabGroups group; "Terminate Task" (TAB_GROUP_TERMINATE) closes exactly
// those 4 tabs and leaves everything else untouched.
//
// Drives background.ts the same way the sidepanel does in production — via
// chrome.runtime.sendMessage from an extension-page context (the sidepanel itself),
// since chrome.tabGroups/chrome.tabs are only available inside extension contexts.
// Requires a real display (headed Chromium via the fixtures) — runs locally and
// in the CI e2e job under xvfb-run.

test('4-tab task creates one labeled group; Terminate Task closes exactly those 4', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // The background resolves the tab to drive via getWebTabId(), which excludes
  // chrome-extension:// pages and throws "No browser tab found" if nothing else
  // is active. The test browser starts with no web tabs, so seed one — a data:
  // URL keeps setup off the network (the opened tabs below still use example.com).
  const seedPage = await context.newPage();
  await seedPage.goto('data:text/html,<h1>seed web tab</h1>');

  const taskId = 'test-task-1';

  await page.evaluate((taskId) => {
    return chrome.runtime.sendMessage({ type: 'AGENT_STARTED', taskId, taskName: 'Research task' });
  }, taskId);

  const openTabIds: number[] = [];
  for (let i = 0; i < 4; i++) {
    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'computer_use', action: { action: 'manage_tabs', op: 'open', url: 'https://example.com' } },
          resolve,
        );
      });
    }) as { result?: Array<{ text?: string }> };
    const parsed = JSON.parse(result.result?.[0]?.text ?? '{}') as { tabId?: number };
    if (parsed.tabId) openTabIds.push(parsed.tabId);
  }
  expect(openTabIds).toHaveLength(4);

  const groups = await page.evaluate(() => chrome.tabGroups.query({}));
  const agentGroups = groups.filter(g => g.title?.startsWith('🤖 Agent:'));
  expect(agentGroups).toHaveLength(1);
  expect(agentGroups[0].color).toBe('blue');

  const memberTabs = await page.evaluate(
    (groupId) => chrome.tabs.query({ groupId }),
    agentGroups[0].id,
  );
  expect(memberTabs.map(t => t.id).sort()).toEqual(openTabIds.sort());

  await page.evaluate((taskId) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'TAB_GROUP_TERMINATE', taskId }, resolve);
    });
  }, taskId);

  for (const id of openTabIds) {
    await expect(page.evaluate((tabId) => chrome.tabs.get(tabId).catch(() => null), id)).resolves.toBeNull();
  }
});

// Panel-open grouping: opening the side panel puts the user's current web tab
// into the "Claude Free" extension group, and every tab the extension opens
// afterwards joins that same group — instead of the task-scoped "🤖 Agent:"
// group, which is only used when no extension group exists.
//
// Driven the same way as the test above (PANEL_OPENED is what the real side
// panel sends on mount; sending it directly keeps the test deterministic).

test('panel open groups the active web tab; extension-opened tabs join that group', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // The sidepanel.html tab is an extension page (skipped by grouping); seed a
  // web tab and make it the active one, then fire PANEL_OPENED like the real
  // panel does on mount.
  const seedPage = await context.newPage();
  await seedPage.goto('data:text/html,<h1>seed web tab</h1>');
  await seedPage.bringToFront();

  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'PANEL_OPENED' }));

  const groups = await page.evaluate(() => chrome.tabGroups.query({}));
  const extGroup = groups.find(g => g.title === 'Claude Free');
  expect(extGroup).toBeDefined();
  expect(extGroup!.color).toBe('blue');

  const seedMembers = await page.evaluate((groupId) => chrome.tabs.query({ groupId }), extGroup!.id);
  expect(seedMembers).toHaveLength(1); // exactly the seed web tab
  expect(seedMembers[0].active).toBe(true);

  const taskId = 'test-task-panel-group';
  await page.evaluate((taskId) => {
    return chrome.runtime.sendMessage({ type: 'AGENT_STARTED', taskId, taskName: 'Panel task' });
  }, taskId);

  const openTabIds: number[] = [];
  for (let i = 0; i < 2; i++) {
    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'computer_use', action: { action: 'manage_tabs', op: 'open', url: 'https://example.com' } },
          resolve,
        );
      });
    }) as { result?: Array<{ text?: string }> };
    const parsed = JSON.parse(result.result?.[0]?.text ?? '{}') as { tabId?: number; groupId?: number };
    if (parsed.tabId) openTabIds.push(parsed.tabId);
    if (i === 0) expect(parsed.groupId).toBe(extGroup!.id); // first open joined the panel group
  }
  expect(openTabIds).toHaveLength(2);

  const allMembers = await page.evaluate((groupId) => chrome.tabs.query({ groupId }), extGroup!.id);
  expect(allMembers).toHaveLength(3); // seed + the two opened tabs

  // No task-scoped group was created — the panel group absorbed the task tabs.
  const groupsAfter = await page.evaluate(() => chrome.tabGroups.query({}));
  expect(groupsAfter.filter(g => g.title?.startsWith('🤖 Agent:'))).toHaveLength(0);
});
