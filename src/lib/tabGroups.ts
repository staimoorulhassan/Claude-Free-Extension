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

/** Title of the extension-wide group created when the side panel opens, so the
 * user's current tab and every tab the extension opens live in one place and
 * stay visually separated from unrelated browsing. */
const EXTENSION_GROUP_TITLE = 'Claude Free';

let extensionGroupId: number | undefined;

/** Groups an ungrouped web tab into the extension group, or returns the group
 * the tab is already in (never hijacks a user's own group). Returns undefined
 * when the tab can't be grouped (extension/chrome:// pages, closed tab, races). */
export async function ensureExtensionGroup(tabId: number): Promise<number | undefined> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
  if (!tab.url || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) return undefined;
  if (typeof tab.groupId === 'number' && tab.groupId >= 0) {
    extensionGroupId = tab.groupId;
    return tab.groupId;
  }
  try {
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title: EXTENSION_GROUP_TITLE, color: GROUP_COLOR_ACTIVE });
    extensionGroupId = groupId;
    return groupId;
  } catch {
    return undefined; // raced with a user action or tab close
  }
}

/** The extension group's id, if it exists this session (undefined after the
 * group is closed — callers fall back to task-scoped grouping). */
export function getExtensionGroupId(): number | undefined {
  return extensionGroupId;
}

/** True when the given group id is the extension's own group. */
export function isExtensionGroupId(groupId: number): boolean {
  return extensionGroupId === groupId;
}

/** True when the group belongs to the extension (the extension group or any
 * task-scoped group created via manage_tabs). */
export function isExtensionTrackedGroup(groupId: number): boolean {
  if (extensionGroupId === groupId) return true;
  for (const gid of groupsByTask.values()) if (gid === groupId) return true;
  return false;
}

/** True when tabId is a member of the extension group (false when there is no
 * extension group this session or the tab can't be read). */
export async function isTabInExtensionGroup(tabId: number): Promise<boolean> {
  if (extensionGroupId === undefined) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    return typeof tab.groupId === 'number' && tab.groupId >= 0 && tab.groupId === extensionGroupId;
  } catch {
    return false;
  }
}

/** Drops the cached extension-group id — call when the group is removed. With no
 * groupId it always clears; with one it only clears when it matches. */
export function clearExtensionGroup(groupId?: number): void {
  if (groupId === undefined || extensionGroupId === groupId) extensionGroupId = undefined;
}

/** Clears bookkeeping for a task without touching any tabs — call after the tabs
 * themselves have already been closed (see closeTaskTabs in background.ts). */
export function forgetGroup(taskId: string): void {
  groupsByTask.delete(taskId);
}
