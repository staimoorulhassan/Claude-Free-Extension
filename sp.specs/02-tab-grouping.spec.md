# 02 — Tab Grouping: Active Workspace Isolation

## Status
Draft

## Summary
Organize agent-driven tab activity using Chrome's native tab-group API for visual workspace separation, so multi-tab agent workflows stay visually contained. **Note:** Tab groups provide visual organization only; they do not isolate cookies, storage, or access between tabs (all tabs in the same browser profile share session state).

## 1. Dynamic Workspace Grouping

- **Automatic Group Creation:** whenever an agent task requires opening new tabs or controlling existing ones, the extension calls `chrome.tabs.group({ tabIds: [...] })`.
- **Visual Styling:** `chrome.tabGroups.update()` labels the group with a distinct badge, e.g. `title: "🤖 Agent: [Task Name]"`, `color: "purple"` or `"blue"`.
- **Parallel Tab Management:** the agent can add multiple active tabs to this group and run asynchronous extraction scripts across all grouped tabs simultaneously.
- **Tab Ownership & Allowlist:** the extension maintains an explicit allowlist of agent-owned/created tabs (stored per `task_id`). Agent operations (`read_page`, `click_element`, CDP attach, etc.) are permitted only on tabs in this allowlist. Operations targeting unrelated user tabs must be rejected with an error. New tabs created via `chrome.tabs.create` or adopted via explicit user approval are added to the allowlist.
- **Window Scope:** Chrome tab groups are window-scoped (`chrome.tabs.group()` requires all `tabIds` to belong to the same window). Agent tasks must either (a) create all tabs in the side panel's window, (b) move tabs to a common window via `chrome.tabs.move()` before grouping, or (c) maintain separate groups per window. The default strategy is to create/group tabs in the side panel's active window (`windowId` from `chrome.windows.getCurrent()` or the window where the side panel was opened).

## 2. Workspace Lifecycle & Cleanup

- When an agent finishes its task or enters "Planning Mode" (awaiting user approval), the group badge color updates to `"green"`.
- **Task Ownership Tracking:** ownership is tracked independently from group membership. The extension persists a `taskId → { ownedTabIds: number[], originalGroupId?: number, originalWindowId: number }` mapping in `chrome.storage.local` (or service-worker memory for short-lived tasks). When a tab is created or adopted, it is recorded with its original group/window metadata.
- **Cleanup on Termination:** when the user clicks "Terminate Task", the extension closes only tabs in `ownedTabIds` that were created or marked temporary by the task. Pre-existing user tabs (tabs opened before task start, or never added to `ownedTabIds`) are preserved. This ownership state must be persisted and transferable to the endurance runtime (see `03-endurance-runtime.spec.md`) so cleanup remains unambiguous after service-worker restarts.

## Acceptance Criteria

- [ ] A task that opens N research tabs results in exactly N tabs inside one labeled `chrome.tabGroups` group.
- [ ] The group title reflects the task name and updates color on state transitions (active → planning/awaiting-approval → done).
- [ ] "Terminate Task" closes only tabs created by that task's group; tabs open before the task started are unaffected.
- [ ] Tabs added to an existing group retain their cookies/session state (no re-authentication required).

## Out of Scope
- The perception/action loop that decides which tabs to open (see `01-agent-engine.spec.md`)
- Any persistence of group state across a Service Worker restart (see `03-endurance-runtime.spec.md`)

## Open Questions
- How are group colors reused/avoided when multiple agent tasks run concurrently?
- Should a group survive a browser restart, or is it always task-scoped and ephemeral?
