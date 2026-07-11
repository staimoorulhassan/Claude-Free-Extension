# 02 — Tab Grouping: Active Workspace Isolation

## Status
Draft

## Summary
Isolate agent-driven tab activity from the user's personal browsing session using Chrome's native tab-group API, so multi-tab agent workflows stay visually contained and don't leak context into unrelated tabs.

## 1. Dynamic Workspace Grouping

- **Automatic Group Creation:** whenever an agent task requires opening new tabs or controlling existing ones, the extension calls `chrome.tabs.group({ tabIds: [...] })`.
- **Visual Styling:** `chrome.tabGroups.update()` labels the group with a distinct badge, e.g. `title: "🤖 Agent: [Task Name]"`, `color: "purple"` or `"blue"`.
- **Parallel Tab Management:** the agent can add multiple active tabs to this group and run asynchronous extraction scripts across all grouped tabs simultaneously without losing authentication cookies or session state.

## 2. Workspace Lifecycle & Cleanup

- When an agent finishes its task or enters "Planning Mode" (awaiting user approval), the group badge color updates to `"green"`.
- When the user clicks "Terminate Task" in the side panel, the extension closes only the temporary tabs spawned within that task's group; pre-existing user tabs are left untouched.

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
