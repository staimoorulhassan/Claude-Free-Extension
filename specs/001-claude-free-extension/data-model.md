# Phase 1 Data Model: Resilient Autonomous Browser Agent Engine

All types are additive to `src/lib/types.ts` unless noted as "extends existing".

## ExecutionJournal

Persisted to `chrome.storage.local` under key `journal:<taskId>` (see `research.md` §5). Written atomically after every completed tool round; read back on service-worker init to detect and resume in-progress tasks.

```typescript
interface ExecutionJournal {
  taskId: string;                  // uuid, generated when a task starts
  roundCount: number;               // completed tool-call rounds so far
  conversationHistory: AnthropicMessage[]; // same shape store.ts already accumulates
  activeTabId: number | null;       // primary driven tab, null if no tab yet
  activeGroupId: number | null;     // chrome.tabGroups id, null if task hasn't grouped tabs yet
  pendingAction: ToolCallEnvelope | null; // set before dispatch, cleared after tool_result recorded
  status: 'in_progress' | 'orphaned' | 'completed' | 'aborted';
  createdAt: number;                // epoch ms
  updatedAt: number;                // epoch ms, bumped on every write
}
```

**Validation rules**:
- `roundCount` MUST NOT exceed the existing 25-round cap (`store.ts:594`) — the journal doesn't introduce a new limit, it persists the existing one.
- `status` transitions: `in_progress → completed | aborted | orphaned`. `orphaned` is terminal (surfaced to user, not auto-resumed) per the P3 edge case resolved in `research.md` §5.
- `pendingAction` MUST be `null` whenever `status !== 'in_progress'`.

**Relationships**: `activeGroupId` references `AgentTabGroup.groupId` (may be null if the task never opened >1 tab, since P2 grouping only triggers on multi-tab tasks per FR-006).

## AgentTabGroup

In-memory in `background.ts` during an active task; the subset needed for resume (`groupId`, `taskId`) is also captured inside `ExecutionJournal.activeGroupId` — the group's own metadata (title/color/members) is re-derived from `chrome.tabGroups.get`/`chrome.tabs.query` on resume rather than duplicated in the journal, so it can't drift out of sync with actual browser state.

```typescript
interface AgentTabGroup {
  groupId: number;                  // chrome.tabGroups id
  taskId: string;                   // owning ExecutionJournal.taskId
  title: string;                    // "🤖 Agent: <task name>"
  color: chrome.tabGroups.ColorEnum; // 'blue' while active, 'green' when done/awaiting-approval
  memberTabIds: number[];           // tabs this task opened; drives scoped "Terminate Task" cleanup
}
```

**Validation rules**:
- `memberTabIds` MUST only ever contain tabs created by this task (FR-008) — pre-existing tabs the agent merely activates (not creates) are never added, so "Terminate Task" can't close user tabs.
- `color` MUST only take the two values above (spec's literal state scheme, `research.md` §7) — no other lifecycle states are defined for this feature.

## ProviderConfig (extends existing `src/lib/types.ts`)

```typescript
interface ProviderConfig {
  provider: string;
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
  modelMap?: Record<string, string>;
  supportsVision?: boolean;
  supportsTools?: boolean;
  debug?: boolean;
  contextWindow?: number;           // NEW — see research.md §9. Falls back to a conservative
                                     // default (e.g. 8192) when absent for unknown/custom providers.
}
```

**Validation rules**:
- When `supportsTools === false`, the request builder MUST take the Tier-2 XML-polyfill branch (FR-013) instead of omitting tool definitions.
- `contextWindow`, when absent, MUST NOT crash `compressForApi` — it must fall back to the existing message-count-based heuristic (backward-compatible degradation, not a hard requirement).

## ToolCallEnvelope

The common shape both the native `tool_use` path and the Tier-2 `<tool_call>` parser produce, so `executeTool()` in `tools.ts` never needs to know which path produced a given call.

```typescript
interface ToolCallEnvelope {
  name: string;                     // tool/action name, e.g. "click_element"
  arguments: Record<string, unknown>; // parsed JSON arguments
  source: 'native' | 'tier2-xml';   // provenance, useful for error messages/telemetry only
}
```

**Validation rules**:
- `arguments` MUST be valid parsed JSON before this envelope is constructed — a malformed Tier-2 `<tool_call>` body never reaches this shape; it's turned into a recoverable tool-result error at the parser boundary instead (FR-016), matching the native path's existing error-surfacing behavior (`store.ts:788-818`).

## State transitions (task lifecycle, P1 + P3 combined)

```text
[user starts task]
      │
      ▼
 status: in_progress ──(round completes, journal write)──▶ status: in_progress (loop)
      │                                                          │
      │ (service worker restarts mid-task)                       │ (25 rounds reached, or
      ▼                                                          │  stopReason !== 'tool_use',
 [resume: verify activeTabId/activeGroupId exist]                │  or user aborts)
      │                                                          ▼
      ├─ exist ──▶ status: in_progress (resume from roundCount)  status: completed | aborted
      └─ gone  ──▶ status: orphaned (terminal, surfaced to user)
```
