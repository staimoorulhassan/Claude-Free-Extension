# Feature Specification: Resilient Autonomous Browser Agent Engine

**Feature Branch**: `001-claude-free-extension`
**Created**: 2026-07-11
**Status**: Draft
**Input**: User description: "Upgrade Claude Free (Claude-Free-Extension) into a resilient, autonomous browser automation engine mirroring Claude Code / Claude in Chrome, while keeping the multi-provider (50+ free/custom LLM) routing advantage. Consolidates sp.specs/01-agent-engine.spec.md, 02-tab-grouping.spec.md, 03-endurance-runtime.spec.md, 04-multi-provider-router.spec.md into one feature."

## Context: what already exists

A codebase survey (see `research.md`) found this is **not** a greenfield build. The extension already has:
- A working agent loop (`src/sidepanel/store.ts`) with a 25-round / 10-minute cap, streaming, an approval gate, and a seed of self-healing (retries `read_page` on stale `click_element` refs).
- A real CDP execution backend (`src/background.ts`, `chrome.debugger`) and a pruned accessibility-tree perception primitive (`accessibility-tree.js`) that already matches spec 01's "perception layer" design.
- A working Anthropic↔OpenAI-compatible request/response translator (`src/lib/openai-compat.ts`) that already routes to 13 providers and is the real "router" — it just has no fallback when a provider's `supportsTools` is `false`.

This spec targets the **gaps** between that baseline and the four aspirational designs, not a rewrite. Every requirement below is written to extend or gap-fill named existing modules where one exists.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Multi-step task completes without silent failure (Priority: P1)

A user asks the agent to complete a multi-step browser task (e.g., "find the 3 cheapest flights and list them"). The agent perceives the page, plans a tool call, executes it, and verifies the result before proceeding — retrying or asking the user when a step fails, instead of silently continuing on bad state.

**Why this priority**: This is the core value proposition already partially built (`store.ts` loop) — without reliable execute→verify→recover, every other feature (tab grouping, endurance, provider breadth) is cosmetic.

**Independent Test**: Run a scripted multi-step form-filling task against a test page with an injected cookie-banner overlay and a stale-element scenario; confirm the agent dismisses the overlay and recovers from the stale element without user intervention.

**Acceptance Scenarios**:

1. **Given** a page with a cookie-consent overlay blocking the target element, **When** the agent attempts `click_element` and the click fails because the element is obscured, **Then** the agent runs a secondary perception turn, locates and clicks a dismissal control, and retries the original action — without surfacing an error to the user.
2. **Given** a target element's DOM reference has gone stale between planning and execution, **When** `click_element` reports "not found", **Then** the agent re-reads page state and retries once before falling back to `ask_user`.
3. **Given** a tool action triggers a 4xx/5xx network response or a JS console error on the page, **When** the agent's next perception turn runs, **Then** the error is surfaced in context (not silently dropped) so the model can react to it.

---

### User Story 2 - Agent activity stays visually isolated from the user's browsing (Priority: P2)

When a task opens or drives multiple tabs, those tabs are visually grouped and labeled so the user can tell at a glance what the agent is doing, and can cleanly abort the task without losing unrelated tabs.

**Why this priority**: Directly affects trust and usability once P1 makes multi-step, multi-tab tasks reliable enough to run unattended; low technical risk (pure `chrome.tabGroups` API, no dependency on P3/P4).

**Independent Test**: Start a task that opens 4 research tabs; confirm they land in one labeled, colored tab group; click "Terminate Task" and confirm only those 4 tabs close.

**Acceptance Scenarios**:

1. **Given** a task that needs to open new tabs, **When** the first new tab is created, **Then** a `chrome.tabGroups` group is created with a title reflecting the task name and a distinct color.
2. **Given** an active agent group, **When** the agent finishes the task or enters an approval-wait state, **Then** the group's color updates (e.g., to green) to reflect the new state.
3. **Given** an active agent group with N tabs it opened, **When** the user clicks "Terminate Task", **Then** exactly those N tabs close and pre-existing tabs are untouched.

---

### User Story 3 - Long-running tasks survive service worker restarts (Priority: P3)

A task running 25+ tool-call rounds continues correctly even if Chrome terminates and restarts the MV3 service worker mid-task, instead of silently losing all progress.

**Why this priority**: Currently the loop lives in the side panel (an even more ephemeral context than the service worker) — closing the panel already loses all state today. This is the deepest architectural change of the four areas (loop ownership must move into the service worker), so it's sequenced after P1/P2 prove out the tool/tab model it needs to persist.

**Independent Test**: Start a 10+ round task, force-terminate the service worker via `chrome://serviceworker-internals`, and confirm the task resumes from the last completed round rather than restarting or silently stopping.

**Acceptance Scenarios**:

1. **Given** an in-progress task, **When** a tool round completes, **Then** the full turn state (task id, round count, conversation history, active tab/group id, pending action) is atomically written to `chrome.storage.local` before the next round starts.
2. **Given** a service-worker restart mid-task, **When** the service worker re-initializes, **Then** it detects the pending journal entry and resumes execution from the interrupted step, without re-executing the already-completed step.
3. **Given** an idle task, **When** 20 seconds of service-worker inactivity would normally trigger MV3 termination, **Then** an offscreen-document heartbeat keeps the worker alive until the task genuinely completes or is terminated by the user.

---

### User Story 4 - Free/local models without native tool-calling can still drive the agent (Priority: P4)

A user configures a free or local model that doesn't support native function calling (e.g., a small OpenRouter free-tier model, or a local Ollama model), and the agent still successfully executes tool calls by parsing them out of the model's text output.

**Why this priority**: The existing router (`openai-compat.ts`) already handles native tool-calling providers; this closes the one real gap (silent tool-calling drop for `supportsTools:false` providers) but doesn't block P1–P3, which can be built/tested against an already-working native-tool provider.

**Independent Test**: Point the provider config at a `supportsTools:false` model, run a task requiring `navigate` + `click_element`, and confirm both execute correctly via parsed `<tool_call>` blocks instead of silently running tool-less.

**Acceptance Scenarios**:

1. **Given** a provider config with `supportsTools: false`, **When** a request is built, **Then** the system prompt is augmented with the `<thinking>`/`<tool_call>` protocol instead of silently omitting tool definitions.
2. **Given** a model response containing a `<tool_call>{"name":...,"arguments":...}</tool_call>` block, **When** the response is parsed, **Then** the block is stripped from the user-visible chat output and routed into the same tool-execution path used for native tool calls.
3. **Given** a malformed or non-JSON `<tool_call>` body, **When** parsing fails, **Then** the failure is surfaced as a recoverable tool-result error (matching P1's error-surfacing behavior), not a silent drop or crash.

---

### Edge Cases

- What happens when a `manage_tabs` action tries to close a tab that the user manually removed from the agent's group? (Group membership and actual open tabs can diverge.)
- How does the system handle a task whose journal (P3) references a tab or tab group that no longer exists after a restart?
- What happens when the Tier-2 XML polyfill (P4) is used with a provider whose `contextWindow` is small enough that the injected tool-protocol system prompt itself consumes a large fraction of it?
- How does self-healing (P1) avoid infinite retry loops when the "dismiss overlay" action itself keeps failing?
- What happens when two tasks are started while a tab group from a previous task is still open (P2 group-name/color collision)?

## Requirements *(mandatory)*

### Functional Requirements

**Agent loop / tools (P1)**
- **FR-001**: System MUST expose `navigate`, `click_element`, `type_text`, `read_page_state`, `execute_js`, `manage_tabs`, and `ask_user` as callable tools, extending the existing single multiplexed `computer` tool (`src/lib/tools.ts`) rather than replacing its execution backend.
- **FR-002**: System MUST wait for DOM-mutation settlement (network idle or DOM-quiet ~500ms) after an action before the next perception turn, replacing the current fixed `setTimeout` delays in `background.ts`.
- **FR-003**: System MUST auto-detect and dismiss common overlay/modal patterns (cookie banners, newsletter popups) via a secondary perception+action turn when a primary action fails due to an obscured element.
- **FR-004**: System MUST capture console errors and failed (4xx/5xx) network requests via CDP (`Log`/`Network` domains, not currently enabled) and include them in the next perception turn's context.
- **FR-005**: System MUST support driving more than one tab per task (today's single global `attachedTabId` in `background.ts` is a hard blocker and MUST become per-tab/group-aware).

**Tab grouping (P2)**
- **FR-006**: System MUST add the `tabGroups` permission and create a `chrome.tabGroups` group for any task that opens or drives more than one tab.
- **FR-007**: System MUST label each agent-created group with a task-derived title and set its color to reflect task state (e.g., active vs. done/awaiting-approval).
- **FR-008**: System MUST track which tabs were created by a given task so "Terminate Task" can close exactly those tabs without affecting pre-existing tabs.

**Endurance runtime (P3)**
- **FR-009**: System MUST persist an execution journal (task id, round count, conversation history, active tab/group id, pending action) to `chrome.storage.local` after every completed tool round.
- **FR-010**: System MUST detect a pending journal entry on service-worker startup and resume the task from the last completed round instead of restarting it.
- **FR-011**: System MUST run an offscreen-document heartbeat to prevent MV3 idle-termination of the service worker during an active task.
- **FR-012**: The agent loop MUST be driven from a context that outlives the side panel (i.e., relocated into or coordinated through the service worker), since the side panel closing today already destroys all in-flight state.

**Multi-provider router (P4)**
- **FR-013**: System MUST fall back to a system-prompt-injected `<thinking>`/`<tool_call>` XML protocol when a provider's `supportsTools` is `false`, instead of silently sending the request without tools (current behavior in `openai-compat.ts`).
- **FR-014**: System MUST parse `<tool_call>` blocks out of Tier-2 model responses, strip them from user-visible output, and route the parsed JSON into the same tool-execution path as native tool calls.
- **FR-015**: System MUST add a `contextWindow` field to `ProviderConfig` (`src/lib/types.ts`) and make the existing message-count-based sliding window (`compressForApi` in `store.ts`) contextWindow-aware.
- **FR-016**: System MUST surface malformed Tier-2 tool-call parses as a recoverable tool-result error rather than crashing the loop or dropping the call silently.

### Key Entities

- **ExecutionJournal**: `taskId`, `roundCount`, `conversationHistory`, `activeTabId`, `activeGroupId`, `pendingAction`, `status`. Persisted to `chrome.storage.local`, read back on service-worker init.
- **AgentTabGroup**: `groupId`, `taskId`, `title`, `color`, `memberTabIds[]`. In-memory + journaled, drives P2's grouping and P3's crash-recovery re-binding.
- **ProviderConfig** (extends existing `src/lib/types.ts` shape): adds `contextWindow: number` to the current `{provider, apiKey, baseURL, defaultModel, modelMap, supportsVision, supportsTools, debug}` shape.
- **ToolCallEnvelope**: `name`, `arguments` (parsed JSON) — the common shape both the native `tool_use` path and the Tier-2 `<tool_call>` parser must produce, so downstream execution (`executeTool` in `tools.ts`) doesn't need to know which path produced it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A 50-step scripted task, with the service worker force-killed at step 25 (`chrome://serviceworker-internals`), completes all 50 steps with no step re-executed and no context-invalidation error.
- **SC-002**: A task that opens 4 research tabs results in exactly one labeled `chrome.tabGroups` group containing exactly those 4 tabs; "Terminate Task" closes exactly those 4 and no others.
- **SC-003**: A `supportsTools:false` free model (e.g., an OpenRouter free-tier model without native function calling) successfully completes a `navigate` → `click_element` sequence via the Tier-2 XML polyfill, with zero `<thinking>`/`<tool_call>` leakage into the visible chat transcript.
- **SC-004**: On a page with an injected cookie-consent overlay blocking the target element, the agent completes the intended action without the user manually dismissing the overlay, in ≥90% of runs across 10 trials.
- **SC-005**: `api.steel.dev` is reachable from the extension (CSP fix) or Steel is explicitly documented as out of scope for this feature's self-healing guarantees (see research.md finding: `SteelComputer` is currently a non-functional stub).
