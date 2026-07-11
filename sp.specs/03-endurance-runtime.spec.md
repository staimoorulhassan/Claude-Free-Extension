# 03 — Endurance Runtime: Zero-Corruption Endurance

## Status
Draft

## Summary
Recover from Manifest V3 Service Worker termination (Chrome kills idle workers after ~30s, or forcibly recycles after ~5min of continuous execution) by checkpointing agent state and resuming long-running, multi-step workflows without corruption or data loss. **Note:** The offscreen document heartbeat mitigates idle termination during active tasks, but cannot prevent the 5-minute execution limit or termination under memory pressure. DevTools being open and active `chrome.runtime.connect` ports can extend service-worker lifetime beyond typical limits.

## 1. Offscreen Document Heartbeat (Keep-Alive Engine)

- On extension startup, the service worker calls `chrome.offscreen.createDocument()` to spawn an invisible `keepalive.html` page. Before calling `createDocument()`, the worker must check for an existing offscreen context via `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })` to ensure idempotency. Concurrent callers must be coordinated through a single in-flight creation promise (e.g., stored in a module-level variable) to avoid "Only a single offscreen document may be created" errors.
- The offscreen document keeps an open bidirectional channel (`chrome.runtime.connect`) with the service worker and sends a lightweight ping every 20 seconds, resetting Chrome's idle timer.
- **Reconnection on Disconnect:** if the port disconnects (`port.onDisconnect` fires), the offscreen document attempts to reconnect by calling `chrome.runtime.connect()` again. If reconnection fails (service worker not yet restarted), the offscreen document retries after a short delay. The service worker, upon restart, recreates the offscreen document if it no longer exists, re-establishing the heartbeat loop.

## 2. Atomic State Checkpointing & Crash Recovery

- **Zero In-Memory Reliance:** the agent never stores execution history, pending tool calls, or DOM trees solely in the service worker's RAM.
- **The Execution Journal:** after every tool turn, the full state engine is serialized to `chrome.storage.local` via an atomic write. Each journal entry includes:
  - `task_id`, `step_count`, `conversation_history` (Anthropic message array)
  - `active_tab_id`, `owned_tab_ids` (for cleanup, see `02-tab-grouping.spec.md`)
  - `pending_action`: `{ action_id: string, status: 'prepared' | 'running' | 'completed', action: ComputerAction, result?: ComputerToolResult[], settlement_data?: { timestamp: number, dom_hash?: string } }`
- **Auto-Hydration on Restart:** if the service worker is forcibly restarted (e.g. under memory pressure), the initialization script checks `chrome.storage.local` for an active `execution_journal`. If found:
  1. It inspects `pending_action.status`. If `'completed'` or settlement data indicates the action succeeded before checkpointing, the action is not re-executed.
  2. If `'prepared'` or `'running'` with no settlement confirmation, the action is re-executed (the agent loop resumes from the last stable state).
  3. The worker re-binds to `active_tab_id` via CDP (calling `ensureDebugger()`).
  4. DOM/perception state (accessibility tree, screenshot) is re-collected fresh after restart, not restored from storage, to ensure consistency with the live page.

## Acceptance Criteria

- [ ] The offscreen document pings at a fixed ≤20s interval and the service worker remains responsive during an active task (mitigates idle termination, but does not prevent 5-minute or memory-pressure termination).
- [ ] After every tool turn, `chrome.storage.local` contains a journal entry consistent with the in-flight step (verifiable by reading storage mid-task).
- [ ] `conversation_history` is compacted or summarized when it approaches 8 MiB (leaving 2 MiB headroom under the 10 MiB `chrome.storage.local` quota per key). Compaction preserves the most recent N turns and system messages. Storage write failures (quota exceeded, extension context invalidated) are caught and surfaced to the user as a recoverable error prompting manual summarization or task termination.
- [ ] Force-killing the service worker mid-task (e.g. via `chrome://serviceworker-internals`) and letting Chrome restart it resumes the task from the last completed step, not from scratch and not with a context-invalidation error.
- [ ] A 50-step automated loop, force-killed at step 25, completes all 50 steps after resumption.
- [ ] No task step is executed twice as a result of a restart (idempotent resume).

## Out of Scope
- The content of what gets journaled beyond the fields listed above (tool definitions live in `01-agent-engine.spec.md`)
- Provider-specific conversation formatting (see `04-multi-provider-router.spec.md`)

## Open Questions
- What is the storage quota ceiling for `chrome.storage.local` journals on very long (100+ step) tasks, and what's the eviction/summarization strategy as it approaches the limit?
- Does the offscreen document itself need its own crash-recovery path (what if it fails to spawn)?
