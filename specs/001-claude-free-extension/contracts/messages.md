# Contract: internal `chrome.runtime` message types (new/changed)

The sidepanel↔background boundary already uses `chrome.runtime.sendMessage`/`onMessage` (`background.ts:414-479`). This lists only the messages this feature adds or changes; existing `computer_use` message handling is unchanged in shape (only its `action` enum grows, per `contracts/tools.md`).

## `TASK_START` (sidepanel → background)

```typescript
{ type: 'TASK_START', taskId: string, initialTabId: number | null }
```
Background creates the initial `ExecutionJournal` (`status: 'in_progress'`) and, if P3's loop-relocation is complete, begins driving the loop itself rather than the sidepanel driving it directly.

## `TASK_ROUND_COMPLETE` (background → sidepanel, informational)

```typescript
{ type: 'TASK_ROUND_COMPLETE', taskId: string, roundCount: number }
```
Fired after each journal write so the sidepanel UI can reflect progress even though background now owns the loop. Sidepanel closing MUST NOT stop the task (this is the whole point of P3) — this message is purely for UI, not a control signal.

## `TASK_RESUMED` (background → sidepanel, informational)

```typescript
{ type: 'TASK_RESUMED', taskId: string, fromRound: number }
```
Fired once on service-worker startup when an `in_progress` journal is found and resumed, so the UI can show "resumed after restart" rather than the user wondering why a task jumped state.

## `TASK_ORPHANED` (background → sidepanel)

```typescript
{ type: 'TASK_ORPHANED', taskId: string, reason: 'tab_closed' | 'group_closed' }
```
Fired when resume-time verification (`research.md` §5) finds the journaled tab/group no longer exists. Surfaced to the user rather than silently dropped or silently resumed against the wrong tab.

## `TAB_GROUP_TERMINATE` (sidepanel → background)

```typescript
{ type: 'TAB_GROUP_TERMINATE', taskId: string }
```
Replaces ad-hoc tab closing with the scoped cleanup guarantee: background looks up `AgentTabGroup.memberTabIds` for `taskId` and closes exactly those tabs (P2 acceptance scenario 3), then marks the journal `status: 'aborted'`.

## `OFFSCREEN_PING` (offscreen document → background, via `chrome.runtime.connect` port)

```typescript
{ type: 'OFFSCREEN_PING', timestamp: number }
```
Sent every 20s over a long-lived port (not `sendMessage`) per `research.md` §6. Background doesn't need to reply — the connection itself, plus periodic port traffic, is what resets MV3's idle timer.
