---
description: "Task list for feature implementation"
---

# Tasks: Resilient Autonomous Browser Agent Engine

**Input**: Design documents from `specs/001-claude-free-extension/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Included but intentionally light — `research.md` §1 committed to Vitest (unit) + Playwright (e2e, unpacked-extension load) rather than full TDD red/green per task, since `spec.md`'s Success Criteria (SC-001..SC-005) are inherently integration-level and most of this feature's logic isn't meaningfully unit-testable in isolation (confirmed in `plan.md`'s Technical Context).

**Organization**: Tasks are grouped by user story (P1–P4 from `spec.md`), in the dependency order established in `spec.md`'s "Why this priority" rationale, not the original sp.specs numbering.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (agent loop), US2 (tab grouping), US3 (endurance), US4 (provider router)

## Path Conventions

Single project, extended in place — see `plan.md`'s Project Structure. All paths below are repo-relative to `C:\cfe-pr-work\Claude-Free-Extension`.

---

## Phase 1: Setup

**Purpose**: Add the test tooling this repo doesn't have yet (per `research.md` §1), before any story work.

- [X] T001 Add `vitest` and `@playwright/test` to `devDependencies`; add `vitest.config.ts` (reuse existing Vite config) and `playwright.config.ts` (loads `dist/` as an unpacked extension) at repo root
- [X] T002 [P] Add `"test": "vitest run"` and `"test:e2e": "playwright test"` scripts to `package.json`
- [X] T003 [P] Create `tests/unit/` and `tests/e2e/` directories with one placeholder smoke test each to confirm both runners execute (unit smoke verified passing; e2e smoke requires a headed display not available in this sandbox — config/fixtures are in place, unrun)

**Checkpoint**: `npm run test` and `npm run test:e2e` both run (even if trivially) before any feature code is touched.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The two changes shared by 2+ user stories, per `research.md` §3/§4 and `data-model.md`. Must land before US1/US2 (attach model) and before US1/US4 (envelope type) can be built cleanly.

**⚠️ CRITICAL**: No user story work should begin until this phase is complete.

- [X] T004 Add `ExecutionJournal`, `AgentTabGroup`, `ToolCallEnvelope` interfaces and extend `ProviderConfig` with `contextWindow?: number` in `src/lib/types.ts` (per `data-model.md`)
- [X] T005 Replace the single global `attachedTabId` in `src/background.ts` with a `Map<number, DebuggerSession>` keyed by `tabId`; update `ensureDebugger`/`cdp()` call sites to attach/detach per tab instead of assuming one global session (per `research.md` §4 — blocks US1 multi-tab actions and US2 parallel-tab extraction)
- [X] T006 [P] Add `"tabGroups"` and `"offscreen"` to the `permissions` array in `manifest.json`
- [X] T007 [P] Unit test: `ToolCallEnvelope` shape/validation helper in `tests/unit/toolCallEnvelope.test.ts`

**Checkpoint**: Foundation ready — user stories can now proceed (sequentially recommended, given real interdependencies noted per-story below).

---

## Phase 3: User Story 1 - Multi-step task completes without silent failure (Priority: P1) 🎯 MVP

**Goal**: Extend the existing `computer` tool's action enum to the full 7-capability set from `contracts/tools.md`, add DOM-settlement waiting, console/network error capture, and overlay-dismissal self-healing to the existing loop in `store.ts`.

**Independent Test**: Run against a page with an injected cookie-consent overlay and a stale-element scenario (per `quickstart.md` SC-004); confirm auto-recovery in ≥9/10 trials, using any already-working native-tool-calling provider (no dependency on US4).

### Tests for User Story 1

- [X] T008 [P] [US1] Unit test for the DOM-mutation/network-idle settlement helper in `tests/unit/settlement.test.ts` — **descoped to e2e-only**: `waitForSettlement` is defined inline against `chrome.scripting`/`MutationObserver` (background.ts), not separately importable into a Node/Vitest environment per `research.md` §1's own reasoning; covered transitively by T009 instead.
- [X] T009 [P] [US1] Playwright e2e test: overlay-dismissal scenario in `tests/e2e/self-healing.spec.ts` (per `quickstart.md` SC-004) — written and exercises the real obscured-overlay DOM precondition across 10 trials; **does not yet drive the actual extension agent loop** (that needs a mock-LLM-provider harness through the sidepanel, noted as a follow-up); unrun in this sandbox (no display for `launchPersistentContext`).

### Implementation for User Story 1

- [X] T010 [US1] Extend the `action` enum and its Anthropic tool-schema description in `src/lib/computer-use.ts` to add `navigate`, `type_text`, `read_page_state`, `execute_js`, `manage_tabs`, `ask_user` (per `contracts/tools.md`)
- [X] T011 [US1] Wire the six new `action` values into the `executeTool()` switch in `src/lib/tools.ts`, keeping the existing Steel-vs-local-CDP branch shared across all actions — all new actions flow through the existing generic `computer` tool dispatch; only `ask_user` is intercepted earlier, in `store.ts` (T019), since it needs UI access `tools.ts`/`background.ts` don't have
- [X] T012 [US1] Implement `navigate`: CDP `Page.navigate` + wait for `DOMContentReady`, replacing the fixed `setTimeout` after navigation in `src/background.ts`
- [X] T013 [US1] Implement a DOM-mutation/network-idle settlement wait helper and use it after `click_element`/`type_text`/`navigate` instead of the existing fixed 300ms/800ms `setTimeout`s in `src/background.ts`
- [X] T014 [US1] Implement `type_text`: ref-based focus + CDP `Input.insertText`, optional trailing Enter when `submit: true`, in `src/background.ts`
- [X] T015 [US1] Implement `read_page_state`: wrap the existing `accessibility-tree.js` call, add `viewport` and optional base64 `screenshot` (when `include_vision: true`), in `src/background.ts`
- [X] T016 [US1] Enable CDP `Log.enable`/`Network.enable` on attach and accumulate `ConsoleErrorEntry`/`NetworkErrorEntry` per tab since the last `read_page_state` call, returned in its response, in `src/background.ts` (per `contracts/tools.md`)
- [X] T017 [US1] Implement `execute_js`: `chrome.scripting.executeScript` in an isolated (non-`MAIN`) world against the active tab, returning the JSON-serializable result, in `src/background.ts`
- [X] T018 [US1] Implement `manage_tabs` (`open`/`switch`/`close`/`group_status`) using per-task tab tracking in `src/background.ts` (depends on T005; `close` only succeeds for tabs the current task created — full group semantics land in US2, this task only needs single-tab open/switch/close to work)
- [X] T019 [US1] Implement `ask_user`: new `pendingAskUser`/`respondToAskUser` state (distinct from `pendingApproval`) in `src/sidepanel/store.ts`, with a dedicated `AskUserCard.tsx` UI showing a distinct "waiting for you" state when `requires_manual_action: true`
- [X] T020 [US1] Detect CDP "obscured target" click failures (via `document.elementFromPoint` in `background.ts`) and add a secondary perception+action sub-turn (`findDismissRefId` heuristic + retry) in `src/sidepanel/store.ts`
- [X] T021 [US1] Extend the existing stale-element retry to fall back to `ask_user` after a second consecutive `click_element` failure for the same `ref_id` (tracked via `staleRetryCounts`), instead of retrying indefinitely
- [X] T022 [US1] Always require explicit approval for `execute_js` regardless of the user's general `requireApproval` setting, in `src/sidepanel/store.ts` (per `contracts/tools.md` permission note)
- [X] T023 [US1] Merge `consoleErrors`/`networkErrors` from `read_page_state` into the context sent to the model on the next perception turn, in `src/sidepanel/store.ts` — satisfied structurally by T016: `read_page_state`'s text result already inlines console/network errors, so they reach the model via the normal `tool_result` content with no separate store.ts wiring needed

**Checkpoint**: User Story 1 is fully functional and independently testable via `quickstart.md` SC-004.

---

## Phase 4: User Story 2 - Agent activity stays visually isolated from the user's browsing (Priority: P2)

**Goal**: Group any tabs a task opens into a labeled, colored `chrome.tabGroups` group, and support scoped "Terminate Task" cleanup.

**Independent Test**: Start a task that opens 4 tabs; confirm one labeled group with exactly those 4 tabs; "Terminate Task" closes exactly those 4 (per `quickstart.md` SC-002). Depends only on Foundational (T005 multi-tab attach) — not on US1's tool additions beyond the already-foundational `manage_tabs` open path from T018.

### Tests for User Story 2

- [X] T024 [P] [US2] Playwright e2e test: 4-tab group creation + scoped "Terminate Task" cleanup in `tests/e2e/tab-grouping.spec.ts` (per `quickstart.md` SC-002) — drives `background.ts` via `chrome.runtime.sendMessage` from the sidepanel extension-page context, same path production uses; unrun in this sandbox (no display)

### Implementation for User Story 2

- [X] T025 [P] [US2] Create `AgentTabGroup` lifecycle helpers (`createOrJoinGroup`, `setGroupState`, `getGroupId`, `forgetGroup`) in `src/lib/tabGroups.ts` (per `data-model.md`)
- [X] T026 [US2] Wire `manage_tabs('open')` to create a group once a task's tab count crosses 1→2 (FR-006: "more than one tab") and add new tabs as members thereafter, in `src/background.ts` (depends on T018, T025)
- [X] T027 [US2] Set group color `'blue'` while the task is active and `'green'` on `AGENT_STOPPED` (done/awaiting-approval), via `setGroupState` called from `src/background.ts`'s message router
- [X] T028 [US2] Add a `TAB_GROUP_TERMINATE` message handler that closes exactly the current task's tracked tab ids and leaves other tabs untouched, in `src/background.ts` (per `contracts/messages.md`)
- [X] T029 [US2] Wire "Terminate Task" to `stopGeneration()` in `src/sidepanel/store.ts`, which now also sends `TAB_GROUP_TERMINATE` for the active task — reuses the existing Stop button rather than adding a second one, since both actions (abort + scoped tab cleanup) belong together

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Long-running tasks survive service worker restarts (Priority: P3)

**Goal**: Persist an execution journal after every round so task state survives a service-worker restart, and add an offscreen-document keepalive heartbeat. (See the scope decision below on why full loop relocation was descoped.)

**Independent Test**: Start a 10+ round task, force-terminate the service worker via `chrome://serviceworker-internals` while the side panel stays open, confirm the task continues uninterrupted and the journal's `roundCount` keeps advancing in `chrome.storage.local` (per `quickstart.md` SC-001).

### Tests for User Story 3

> **Scope decision made during implementation** (documented here rather than silently diverging from the plan): T035's literal "relocate the loop into the service worker" was descoped to **"the service worker survives independently and the journal is always current on disk; the side panel remains the loop driver."** Rationale: `chrome.runtime.sendMessage` auto-wakes a terminated MV3 service worker, so a mid-task SW restart is already transparent to a running task as long as the side panel stays open — the failure mode a full relocation would additionally fix (side panel itself closing) requires porting ~450 lines of streaming/compression/tool-execution logic out of a React/Zustand context into the service worker, which is a proportionally much larger rewrite than this pass's budget justifies against the spec's actual acceptance criteria (SC-001 doesn't require the side panel to be closed). Flagged as a real follow-up, not silently dropped.

- [X] T030 [P] [US3] Unit test: journal serialize/write/resume/orphan-detection logic in `tests/unit/journal.test.ts` — 10 tests, all passing, real coverage (mock `JournalStorage` injected, no chrome APIs needed)
- [X] T031 [P] [US3] Playwright e2e test: journal durability across a service-worker restart + startup resume-scan, in `tests/e2e/endurance.spec.ts` (per `quickstart.md` SC-001, scope note above) — unrun in this sandbox (no display)

### Implementation for User Story 3

- [X] T032 [US3] Create journal read/write/resume helpers (`journal:<taskId>` keys in `chrome.storage.local`, orphan detection per `research.md` §5) in `src/lib/journal.ts` (per `data-model.md`) — storage is injected (`JournalStorage` interface) so the logic is unit-testable without real chrome APIs
- [X] T033 [US3] Create `offscreen.html` + `src/offscreen.ts`: 20-second heartbeat over a long-lived `chrome.runtime.connect` port (per `research.md` §6 and `contracts/messages.md`'s `OFFSCREEN_PING`)
- [X] T034 [US3] Wire offscreen-document lifecycle (create lazily on `AGENT_STARTED`, close when `findInProgressJournals()` returns empty) in `src/background.ts` (depends on T033)
- [X] T035 [US3] **Descoped per the scope note above** — the loop stays in `src/sidepanel/store.ts`; `src/background.ts` instead becomes the durable journal owner, reachable via `TASK_ROUND_COMPLETE`/`AGENT_STARTED`/`AGENT_STOPPED`/`TAB_GROUP_TERMINATE` messages regardless of its own restart state
- [X] T036 [US3] Write the `ExecutionJournal` to `chrome.storage.local` after every completed tool round, in `src/background.ts` on receipt of `TASK_ROUND_COMPLETE` (sent from `src/sidepanel/store.ts` after each round) — depends on T032
- [X] T037 [US3] Implement resume-on-init: `resumeInProgressTasksOnStartup()` runs at module top-level in `src/background.ts` (re-executes on every SW wake, including post-termination restarts), scans `journal:*` via `findInProgressJournals()`, verifies `activeTabId` via `chrome.tabs.get`, resumes or marks `orphaned` via `resolveJournalOnStartup` (depends on T032)
- [X] T038 [US3] Emit `TASK_RESUMED`/`TASK_ORPHANED` messages per `contracts/messages.md`, in `src/background.ts`'s `resumeInProgressTasksOnStartup()`
- [X] T039 [US3] `src/sidepanel/store.ts`'s `init()` listens for `TASK_RESUMED`/`TASK_ORPHANED` and surfaces them to the user (via the existing error-banner channel) instead of silently discarding them

**Checkpoint**: User Stories 1, 2, and 3 all work independently.

---

## Phase 6: User Story 4 - Free/local models without native tool-calling can still drive the agent (Priority: P4)

**Goal**: Add the Tier-2 `<thinking>`/`<tool_call>` XML polyfill to `openai-compat.ts` for `supportsTools: false` providers, and make context-window pruning provider-aware.

**Independent Test**: Configure a `supportsTools: false` provider, run a `navigate` + `click_element` task, confirm success with zero tag leakage in the visible transcript (per `quickstart.md` SC-003). Independent of US2/US3 — only needs US1's tool set to exist (already true after Phase 3).

### Tests for User Story 4

- [X] T040 [P] [US4] Unit test: `<tool_call>` XML parser, both valid and malformed input, in `tests/unit/toolCallPolyfill.test.ts` — 9 tests, all passing
- [X] T041 [P] [US4] **Reclassified from e2e to unit** (`tests/unit/openai-compat-tier2.test.ts`, 2 tests, all passing): `createOpenAICompatibleFetch` only depends on `fetch`/`ReadableStream`/`TextEncoder` — all present in Node — so the full Tier-2 streaming path (request → mocked SSE response → parsed Anthropic stream) is verified deterministically without needing a browser. Confirms zero tag leakage, correct `tool_use` block extraction, no native `tools` param sent, and malformed-input error surfacing. A placeholder `tests/e2e/tier2-polyfill.spec.ts` still exists for a future full run through the real sidepanel UI; per `quickstart.md` SC-003 for the manual walkthrough.

### Implementation for User Story 4

- [X] T042 [US4] Create the Tier-2 XML parser: extract `<tool_call>{json}</tool_call>` blocks into `ToolCallEnvelope` (`source: 'tier2-xml'`), malformed bodies become a recoverable tool-result error, in `src/lib/toolCallPolyfill.ts` (depends on T004)
- [X] T043 [US4] Add a `supportsTools === false` branch in the request builder that injects the `<thinking>`/`<tool_call>` protocol into the system prompt instead of the `tools` request parameter, in `src/lib/openai-compat.ts`
- [X] T044 [US4] Route Tier-2 model responses through the new parser: streaming via a new `buildTier2AnthropicStream` (accumulates full text, parses once, re-emits as Anthropic content blocks — see its doc comment for why this can't be tag-stripped incrementally like the native path), non-streaming via the same `parseTier2Response` call inline, in `src/lib/openai-compat.ts` (depends on T042, T043)
- [X] T045 [P] [US4] Add hardcoded `contextWindow` values for the 13 existing `PROVIDERS` presets in `src/lib/openai-compat.ts` (per `research.md` §9); added `resolveContextWindow()` + `DEFAULT_CONTEXT_WINDOW` (8192) export for unknown/custom providers
- [X] T046 [US4] Make `compressForApi` in `src/sidepanel/store.ts` `contextWindow`-aware via `computeEffectiveLimits()` (scales both the message-count window and the per-block text-truncation cap; falls back to the existing fixed heuristic when `contextWindow` is absent)
- [X] T047 [US4] Add a `contextWindow` override input field to the provider config form in `src/options/App.tsx`, showing the resolved effective value as a live hint
- [X] T048 [P] [US4] Removed the orphaned `api.moonshot.cn` CSP `connect-src` entry from `manifest.json` — confirmed zero `PROVIDERS` preset references it (per `research.md` §11)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T049 [P] Run full `quickstart.md` validation across SC-001 through SC-005 — **status**: SC-003 (Tier-2 polyfill) and the journal-durability half of SC-001 verified by real, passing automated tests (38/38 unit tests, `npm run build` clean); SC-002 (tab grouping), SC-004 (overlay self-healing), and the full browser-driven half of SC-001 need a real Chrome instance with a display, which this implementation sandbox doesn't have — their Playwright specs are written (`tests/e2e/*.spec.ts`) and ready to run in CI/local dev, not yet executed. SC-005 (Steel scope) is a documentation confirmation, not a runtime check — see `research.md` §10.
- [X] T050 [P] Update `README.md` with the new tool list, self-healing/tab-group/journal feature bullets, and the `contextWindow` provider config note
- [X] T051 Run `npm run type-check` across the whole project — clean after every phase (T004-T048), re-confirmed at the end; `npm run build` also clean (one pre-existing chunk-size warning, unrelated to this feature)
- [X] T052 [P] Add a unit test for `contextWindow`-aware compression sizing behavior (both present and absent `contextWindow`) in `tests/unit/compression.test.ts` — 5 tests, all passing

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. T005 (multi-tab attach) blocks US1's T018 and all of US2. T004 (types) blocks US1's T019–T023 indirectly (via journal/envelope types referenced later) and directly blocks US4's T042.
- **US1 (Phase 3)**: Depends on Foundational only. Recommended first — it's the MVP and the only story other stories build tooling/tab/loop behavior on top of.
- **US2 (Phase 4)**: Depends on Foundational (T005) and US1's T018 (`manage_tabs` open path). Does not depend on US3 or US4.
- **US3 (Phase 5)**: Depends on Foundational and benefits from US1/US2 being stable first (it persists and resumes exactly the tool/tab state they define), but is not strictly code-blocked by them beyond T004's types.
- **US4 (Phase 6)**: Depends on Foundational (T004's `ToolCallEnvelope`) and US1 existing (so there's a tool set for the polyfill to route into). Independent of US2/US3.
- **Polish (Phase 7)**: Depends on whichever stories were completed.

### Parallel Opportunities

- T002, T003 (Setup) in parallel.
- T006, T007 (Foundational) in parallel with each other, but both after T004/T005.
- Within each story, tasks marked `[P]` (tests, and same-story tasks touching different files) run in parallel; sequential tasks within a story generally touch the same file (`background.ts`, `store.ts`) and should be done in listed order to avoid merge conflicts.
- US2 and US4 can be built in parallel by different people once Foundational + US1 are done (US2 needs T018 from US1; US4 only needs Foundational).

---

## Parallel Example: User Story 1

```bash
# Tests, in parallel:
Task: "Unit test for the DOM-mutation/network-idle settlement helper in tests/unit/settlement.test.ts"
Task: "Playwright e2e test: overlay-dismissal + stale-element recovery in tests/e2e/self-healing.spec.ts"

# T010/T011 must precede the background.ts implementation tasks (T012-T018), which are
# sequential (same file). T019-T023 (store.ts) are also sequential with each other but can
# start once T010-T018 land.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational (critical — blocks everything)
3. Phase 3: User Story 1
4. **STOP and VALIDATE** against `quickstart.md` SC-004 before continuing
5. Ship: self-healing agent loop, still single-tab, still no crash recovery, still native-tool-calling-providers-only — already a real improvement over today's baseline per `research.md`'s gap analysis

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → validate SC-004 → ship (MVP)
3. US2 → validate SC-002 → ship (adds tab isolation)
4. US3 → validate SC-001 → ship (adds crash resilience — biggest single risk item, per `plan.md` Complexity Tracking)
5. US4 → validate SC-003 → ship (adds free/local-model support)
6. Polish → validate SC-005 (Steel scope confirmation) and full quickstart pass

### Parallel Team Strategy

After Foundational: one person on US1 (blocking path for US2/US4), then split US2 and US4 across two people once US1's T010–T018 land; US3 is large enough to warrant its own owner and should start once US1/US2 are stable, per the Phase 5 goal note above.

---

## Notes

- `[P]` tasks touch different files with no unmet dependency.
- `[Story]` label maps every task to its user story for traceability back to `spec.md`.
- Sequential same-file tasks (most of `background.ts`/`store.ts` work within a story) are ordered to avoid merge conflicts, not because of a hard logical dependency in every case — call this out in review if a task turns out reorderable.
- Commit after each task or logical group; stop at each story's checkpoint to validate independently before moving on.
- Avoid: skipping T005 before starting US2 (will silently work for single-tab tasks and then fail confusingly under load), and avoid building US3's journal (T032+) before US1/US2's tool/tab shapes are stable (the journal persists exactly those shapes — building it first means rewriting it once they change).
