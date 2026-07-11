/**
 * chrome.tabGroups lifecycle helpers for task-scoped tab isolation (spec
 * 001-claude-free-extension, US2 / FR-006-008). Lives alongside the per-task tab
 * tracking already added to background.ts in T018 — this file owns the actual
 * chrome.tabGroups calls; background.ts wires them into manage_tabs.
 */

export interface AgentTabGroupHandle {
  groupId: number;
  taskId: string;
}

const GROUP_COLOR_ACTIVE: chrome.tabGroups.ColorEnum = 'blue';
const GROUP_COLOR_DONE: chrome.tabGroups.ColorEnum = 'green';

/** taskId → groupId, so repeated manage_tabs('open') calls for the same task reuse one group. */
const groupsByTask = new Map<string, number>();

function truncateTitle(taskName: string): string {
  // Chrome silently truncates tab group titles past a small cap; keep our own
  // budget so "🤖 Agent: " prefix always survives instead of getting cut off.
  const MAX = 40;
  const trimmed = taskName.length > MAX ? taskName.slice(0, MAX - 1) + '…' : taskName;
  return `🤖 Agent: ${trimmed}`;
}

/** Creates a group for tabId (if the task doesn't have one yet) or adds tabId to the
 * task's existing group. Returns the groupId either way. */
export async function createOrJoinGroup(taskId: string, taskName: string, tabId: number): Promise<number> {
  const existing = groupsByTask.get(taskId);
  if (existing !== undefined) {
    try {
      await chrome.tabs.group({ groupId: existing, tabIds: [tabId] });
      return existing;
    } catch {
      // Group may have been closed by the user — fall through and create a new one.
      groupsByTask.delete(taskId);
    }
  }

  const groupId = await chrome.tabs.group({ tabIds: [tabId] });
  await chrome.tabGroups.update(groupId, { title: truncateTitle(taskName), color: GROUP_COLOR_ACTIVE });
  groupsByTask.set(taskId, groupId);
  return groupId;
}

/** T027: blue while active, green once the task completes or is awaiting approval. */
export async function setGroupState(taskId: string, state: 'active' | 'done'): Promise<void> {
  const groupId = groupsByTask.get(taskId);
  if (groupId === undefined) return;
  try {
    await chrome.tabGroups.update(groupId, { color: state === 'active' ? GROUP_COLOR_ACTIVE : GROUP_COLOR_DONE });
  } catch { /* group may already be gone */ }
}

export function getGroupId(taskId: string): number | undefined {
  return groupsByTask.get(taskId);
}

/** Clears bookkeeping for a task without touching any tabs — call after the tabs
 * themselves have already been closed (see closeTaskTabs in background.ts). */
export function forgetGroup(taskId: string): void {
  groupsByTask.delete(taskId);
}
