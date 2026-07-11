# Phase 0 Research: Resilient Autonomous Browser Agent Engine

Source: codebase survey (Explore agent, 2026-07-11) against `sp.specs/01-04-*.spec.md`. Each entry resolves one `NEEDS CLARIFICATION` or open design question from `spec.md` / `plan.md`.

## 1. Testing framework

- **Decision**: Vitest for unit-testable logic; Playwright (loading the unpacked extension into Chromium) for the CDP/tab-group/service-worker scenarios that need a real browser.
- **Rationale**: Vitest shares Vite's config/transform pipeline already in `package.json`, zero new build tooling. Unit-testable surface: `toolCallPolyfill.ts` parsing, `journal.ts` serialization/resume logic, `contextWindow`-aware `compressForApi`. None of P1–P3's core value (CDP dispatch, `chrome.tabGroups`, MV3 service-worker lifecycle) is unit-testable in isolation — those need a real Chrome instance, which is what SC-001..SC-004 in `spec.md` already assume ("force-kill the service worker via `chrome://serviceworker-internals`").
- **Alternatives considered**: Jest (no material advantage over Vitest given Vite is already the bundler); manual-only QA (rejected — SC-001..SC-004 are exactly the kind of regression that silently breaks without an automated e2e harness, and this is the whole point of the "endurance" feature).

## 2. Perception layer reuse

- **Decision**: Reuse `accessibility-tree.js` unchanged as the DOM/a11y half of the perception layer. Add console/network capture as a new, separate concern (CDP `Log.enable` + `Network.enable` in `background.ts`), not folded into the content script.
- **Rationale**: The Explore survey confirmed `accessibility-tree.js` already produces exactly spec 01 §1's "pruned Accessibility DOM Tree" (interactive-only filter, viewport visibility, ref-based element map, redaction of sensitive fields, char-cap truncation). Rewriting it would be pure regression risk for zero new capability. Console/network errors are a CDP-domain concern orthogonal to the content-script-based DOM tree, so they're captured server-side (in `background.ts`) and merged into the same perception-turn payload at the call site, not inside the content script.
- **Alternatives considered**: Adding `console.error`/network-failure hooks via `window.onerror` injected into the content script — rejected because it can't see cross-origin iframe or service-worker-initiated request failures the way CDP's `Network.responseReceived`/`Log.entryAdded` domains can.

## 3. Tool schema shape: multiplexed vs. 7 distinct tools

- **Decision**: Keep one Anthropic-facing tool definition (extend the existing multiplexed `computer` tool's `action` enum) rather than splitting into 7 separate top-level tools as spec 01's table literally lists them.
- **Rationale**: `getEnabledTools()`/`executeTool()` in `tools.ts` already dispatch on `block.name` then `action` — adding `navigate`, `type_text`, `read_page_state`, `execute_js`, `manage_tabs`, `ask_user` as new `action` enum values (alongside existing `click_element`, `screenshot`, etc.) is additive to the existing dispatch switch, preserves one system-prompt tool-schema block (cheaper in tokens per turn — relevant given P4's small-context free models), and avoids duplicating the Steel-vs-local-CDP branch in `executeTool()` seven times over. The spec's 7-tool table is treated as the **capability list**, not a literal API-shape requirement — `data-model.md`'s `ToolCallEnvelope` normalizes both native and Tier-2-polyfilled calls to `{name, arguments}` regardless of which `action` they map to internally.
- **Alternatives considered**: 7 separate Anthropic tool blocks (rejected: larger system-prompt/tool-schema token cost every turn, especially costly under P4 for small-context free models; also means duplicating the Steel-stub-vs-real-CDP routing logic in `tools.ts` seven times instead of once).

## 4. Multi-tab CDP attach model

- **Decision**: Replace the single global `attachedTabId` in `background.ts` with a `Map<tabId, DebuggerSession>`, keyed by tab id, with explicit attach-on-first-use and detach-on-tab-close/group-close.
- **Rationale**: This is the one change both P1 (multi-tab tool execution) and P2 (parallel extraction across a tab group) share as a hard blocker per the Explore survey. A map is the minimal structural change — `ensureDebugger`/`cdp()` helpers already take a `tabId`-shaped call site in most cases; the fix is removing the implicit single-global assumption, not rewriting the CDP dispatch itself.
- **Alternatives considered**: Attach/detach per call (rejected — `chrome.debugger.attach` has observable overhead and flashes Chrome's "debugging this browser" banner per attach; keeping a session map avoids redundant attach/detach churn during a multi-round task on the same tab).

## 5. Execution journal schema & resume strategy

- **Decision**: One `chrome.storage.local` record per active task, keyed `journal:<taskId>`, containing exactly the `ExecutionJournal` entity fields from `spec.md` (`taskId, roundCount, conversationHistory, activeTabId, activeGroupId, pendingAction, status`). On service-worker init, scan for `journal:*` keys with `status: 'in_progress'`; for each, verify `activeTabId`/`activeGroupId` still exist (via `chrome.tabs.get`/`chrome.tabGroups.get`, both fail gracefully if closed) before resuming; if the tab/group is gone, mark the journal `status: 'orphaned'` and surface it to the user rather than silently resuming against a nonexistent tab.
- **Rationale**: Directly resolves the P3 edge case in `spec.md` ("What happens when a task's journal references a tab or tab group that no longer exists after a restart?") with an explicit orphaned-state rather than an unhandled exception. Per-task keying (vs. one giant journal blob) keeps writes small (P3's <50ms write-latency target) and avoids read-modify-write races if a future version supports concurrent tasks.
- **Alternatives considered**: Single `execution_journal` key holding the one active task (matches the original sp.specs wording literally) — rejected in favor of `journal:<taskId>` keys since it costs nothing extra today and doesn't foreclose multi-task support later; still only one journal is "in_progress" at a time per this feature's actual scope.

## 6. Offscreen document heartbeat

- **Decision**: 20-second `chrome.runtime.connect` ping from `offscreen.ts` to `background.ts`, matching the spec's stated interval (safely under MV3's ~30s idle-termination threshold). The offscreen document is created lazily on first task start (not at extension startup) and closed when no task is `in_progress`, to avoid holding a persistent offscreen document (and its small memory/process overhead) when the extension is idle.
- **Rationale**: Spec 03 §1 specifies the 20s interval already; the lazy-create/close-when-idle refinement avoids the extension always running an offscreen document even when the user isn't running any agent task, which the original spec didn't address but is a reasonable resource-hygiene default.
- **Alternatives considered**: `chrome.alarms` (fires at minimum 1-minute granularity — too coarse to reliably beat the ~30s idle window); always-on offscreen document from extension startup (rejected per above — unnecessary resource use when idle).

## 7. Tab group state/color scheme

- **Decision**: `blue` while a task is actively running, `green` when done or awaiting approval (matches `spec.md`/original sp.specs wording exactly), title format `🤖 Agent: <task name, truncated to Chrome's tab-group title limit>`.
- **Rationale**: No existing precedent in the codebase (confirmed fully greenfield by the survey), so the original spec's literal wording is adopted as-is rather than inventing a new scheme.
- **Alternatives considered**: None material — this is a UI convention with no functional ambiguity worth a tradeoff table.

## 8. Tier-2 XML tool-call polyfill format & integration point

- **Decision**: Mirror the existing `supportsVision:false` fallback pattern in `openai-compat.ts` (which already replaces unsupported image blocks with a textual placeholder) — add a symmetric `supportsTools:false` branch that (a) appends a `<thinking>`/`<tool_call>` protocol block to the system prompt instead of the `tools` request parameter, and (b) runs response text through a new `toolCallPolyfill.ts` parser that extracts `<tool_call>{json}</tool_call>` blocks into the same `ToolCallEnvelope` shape the native path produces, before `buildAnthropicStream` re-synthesizes the Anthropic-shaped SSE the sidepanel already expects.
- **Rationale**: This means `store.ts`'s agent loop needs **zero changes** to consume Tier-2 tool calls — they arrive as ordinary `content_block` tool_use events in the same synthesized stream, exactly like a native provider. All the polyfill complexity is contained in `openai-compat.ts` + the new `toolCallPolyfill.ts`, which is where the router already owns Anthropic↔OpenAI translation.
- **Alternatives considered**: Handling XML parsing in `store.ts` (the consumer) — rejected because it would leak provider-capability-specific logic outside the router, and `store.ts` already treats every provider as "the same Anthropic-shaped stream," which is the abstraction worth preserving.

## 9. `contextWindow` sourcing

- **Decision**: Add `contextWindow?: number` to `ProviderConfig`, populated from a small hardcoded table for the 13 existing `PROVIDERS` presets (well-known published context limits) with a conservative default (e.g., 8192) for unknown/custom providers, overridable by the user in Options.
- **Rationale**: No provider preset today exposes context-window size, and `/models` endpoint responses (used by `models.ts` for free/paid classification) don't reliably include it across providers. A hardcoded-with-override table is the pragmatic middle ground between "always ask the user" (friction) and "assume infinite" (defeats the point of FR-015).
- **Alternatives considered**: Always require manual entry (rejected — regresses UX for the 13 already-known presets); attempt runtime detection via provider `/models` metadata (rejected as a P4 dependency — inconsistent enough across providers that it would introduce its own NEEDS CLARIFICATION chain; can be a fast-follow, not blocking this feature).

## 10. Steel browser scope

- **Decision**: Out of scope for this feature's self-healing/journal guarantees. `SteelComputer` remains the existing non-functional stub; P1's self-healing loop and P3's journal/resume both target the local `chrome.debugger` CDP path only. When `steelSession` is active, existing behavior (fake canned success) is unchanged by this feature — not worsened, not fixed.
- **Rationale**: Explicitly called out in `spec.md` SC-005 per the Explore survey's finding that `SteelComputer` does no real page interaction today. Making Steel a real remote-CDP backend is a separate, sizeable workstream (Playwright/CDP-over-WebSocket client) that would roughly double this feature's scope; bundling it in would blur P1's actual self-healing acceptance criteria (SC-004) with an unrelated "make Steel real" project.
- **Alternatives considered**: Building a real Steel CDP client as a P1 prerequisite (rejected — out of proportion to this feature's stated goals; flagged as a candidate for its own future spec instead).

## 11. CSP allowlist fixes

- **Decision**: In scope, minimal: remove the orphaned `api.moonshot.cn` entry only if Phase 1 confirms no `PROVIDERS` preset references it (dead weight, zero functional benefit to keeping it); leave `api.steel.dev` **not** added to `connect-src`, consistent with the Steel-out-of-scope decision above (adding CSP access without a working client would be a no-op that just widens the attack surface for no benefit).
- **Rationale**: Keeps CSP changes tied 1:1 to functionality actually shipped in this feature (P4's provider work), rather than opportunistically fixing unrelated CSP drift.
- **Alternatives considered**: Fixing all CSP issues found during the survey regardless of relation to P1–P4 — rejected as scope creep; tracked instead as a follow-up note in `plan.md`'s Complexity Tracking-adjacent context for a future small cleanup task.
