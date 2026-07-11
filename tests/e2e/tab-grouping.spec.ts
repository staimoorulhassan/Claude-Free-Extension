import { test, expect } from './fixtures';

// SC-002 (quickstart.md): a task that opens 4 tabs lands in exactly one labeled
// chrome.tabGroups group; "Terminate Task" (TAB_GROUP_TERMINATE) closes exactly
// those 4 tabs and leaves everything else untouched.
//
// Drives background.ts the same way the sidepanel does in production — via
// chrome.runtime.sendMessage from an extension-page context (the sidepanel itself),
// since chrome.tabGroups/chrome.tabs are only available inside extension contexts.
// Requires a real display — not runnable in this sandbox; written and ready to run.

test('4-tab task creates one labeled group; Terminate Task closes exactly those 4', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

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
