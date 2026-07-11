# 03 — Endurance Runtime: Zero-Corruption Endurance

## Status
Draft

## Summary
Prevent Manifest V3 Service Worker termination (Chrome kills idle workers after ~30s, or forcibly recycles after ~5min of continuous execution) from corrupting or losing agent state during long-running, multi-step workflows.

## 1. Offscreen Document Heartbeat (Keep-Alive Engine)

- On extension startup, the service worker calls `chrome.offscreen.createDocument()` to spawn an invisible `keepalive.html` page.
- The offscreen document keeps an open bidirectional channel (`chrome.runtime.connect`) with the service worker and sends a lightweight ping every 20 seconds, resetting Chrome's idle timer and preventing spontaneous termination.

## 2. Atomic State Checkpointing & Crash Recovery

- **Zero In-Memory Reliance:** the agent never stores execution history, pending tool calls, or DOM trees solely in the service worker's RAM.
- **The Execution Journal:** after every tool turn, the full state engine (`task_id`, `step_count`, `conversation_history`, `active_tab_id`, `pending_action`) is serialized to `chrome.storage.local` via an atomic write.
- **Auto-Hydration on Restart:** if the service worker is forcibly restarted (e.g. under memory pressure), the initialization script checks `chrome.storage.local` for an active `execution_journal`. If found, it re-binds to the target tab via CDP and resumes from the exact interrupted step.

## Acceptance Criteria

- [ ] The offscreen document pings at a fixed ≤20s interval and the service worker does not idle-terminate during an active task.
- [ ] After every tool turn, `chrome.storage.local` contains a journal entry consistent with the in-flight step (verifiable by reading storage mid-task).
- [ ] Force-killing the service worker mid-task (e.g. via `chrome://serviceworker-internals`) and letting Chrome restart it resumes the task from the last completed step, not from scratch and not with a context-invalidation error.
- [ ] A 50-step automated loop, force-killed at step 25, completes all 50 steps.
- [ ] No task step is executed twice as a result of a restart (idempotent resume).

## Out of Scope
- The content of what gets journaled beyond the fields listed above (tool definitions live in `01-agent-engine.spec.md`)
- Provider-specific conversation formatting (see `04-multi-provider-router.spec.md`)

## Open Questions
- What is the storage quota ceiling for `chrome.storage.local` journals on very long (100+ step) tasks, and what's the eviction/summarization strategy as it approaches the limit?
- Does the offscreen document itself need its own crash-recovery path (what if it fails to spawn)?
