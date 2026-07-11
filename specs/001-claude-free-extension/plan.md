# Implementation Plan: Resilient Autonomous Browser Agent Engine

**Branch**: `001-claude-free-extension` | **Date**: 2026-07-11 | **Spec**: `specs/001-claude-free-extension/spec.md`
**Input**: Feature specification from `specs/001-claude-free-extension/spec.md`

**Note**: This template is filled in by the `/sp.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Close the gap between the existing "Claude Free" MV3 extension (a working agent loop, CDP action dispatcher, accessibility-tree perception, and an OpenAI-compat provider router already in production) and four target capabilities: a 7-tool self-healing perceive/plan/act/verify loop (P1), `chrome.tabGroups`-based task isolation (P2), a service-worker-owned execution journal with offscreen-document keepalive (P3), and a Tier-2 XML tool-call polyfill for non-tool-calling providers (P4). Approach: extend named existing modules (`tools.ts`, `background.ts`, `store.ts`, `openai-compat.ts`, `storage.ts`) rather than parallel new subsystems, per the reuse findings in `research.md`.

## Technical Context

**Language/Version**: TypeScript 5.5 (strict mode), ES2022 target, compiled via `tsc --noEmit` + Vite 5.4 bundler
**Primary Dependencies**: React 18 + Zustand 4 (sidepanel UI/state), no server framework (this is a client-only MV3 extension); `chrome.*` extension APIs are the runtime dependency surface
**Storage**: `chrome.storage.local` (large/session data — conversations, provider vault, the new execution journal) and `chrome.storage.sync` (small user settings), per existing `src/lib/storage.ts` split
**Testing**: NEEDS CLARIFICATION — no test framework is present in `package.json` today (no Jest/Vitest/Playwright). Phase 0 must decide: Vitest for unit-testable logic (tool-call parsing, journal serialization, sliding-window compression) since it composes cleanly with the existing Vite build, plus a Playwright-driven e2e harness (loads the unpacked extension into Chromium) for the CDP/tab-group/service-worker acceptance scenarios that can't be unit-tested.
**Target Platform**: Chrome/Chromium MV3, `minimum_chrome_version: 116` (per `manifest.json`)
**Project Type**: Single project — MV3 browser extension (service worker + side panel + content scripts), no separate backend
**Performance Goals**: Perception turn (accessibility-tree capture + optional screenshot) must stay well under the existing 500ms DOM-settlement wait so it doesn't dominate round latency; journal write-after-every-turn (P3) must not add perceptible per-round latency (target: <50ms for a `chrome.storage.local.set` of one journal record)
**Constraints**: MV3 service-worker 30s-idle / ~5min-continuous-execution termination model (P3's central constraint); `extension_pages` CSP `connect-src` allowlist blocks any provider `baseURL` host not explicitly listed (P4 constraint, plus the existing `api.steel.dev` CSP gap found in research); single global `attachedTabId` in `background.ts` currently blocks multi-tab CDP attach (P1/P2 shared blocker)
**Scale/Scope**: 4 user stories / 16 functional requirements across 4 existing source modules + 2 new subsystems (tab-group manager, execution journal); no new services, no new build targets

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template (no project-specific principles have been ratified for this repo) — there are no concrete gates to check against. Recorded here rather than silently skipped: if the user ratifies a constitution later, this plan should be re-checked against it. No violations to justify in the meantime.

**Post-design re-check (after Phase 1)**: unchanged — constitution is still unratified. Nothing in `data-model.md`/`contracts/` introduced a new external dependency, service, or deployment target that would independently warrant a gate even absent a formal constitution (still a single MV3 extension, still zero new build targets).

## Project Structure

### Documentation (this feature)

```text
specs/001-claude-free-extension/
├── plan.md              # This file (/sp.plan command output)
├── research.md          # Phase 0 output (/sp.plan command)
├── data-model.md        # Phase 1 output (/sp.plan command)
├── quickstart.md        # Phase 1 output (/sp.plan command)
├── contracts/           # Phase 1 output (/sp.plan command)
└── tasks.md             # Phase 2 output (/sp.tasks command - NOT created by /sp.plan)
```

### Source Code (repository root)

```text
# Option 1: Single project — this IS the existing structure, extended in place
manifest.json                  # + "tabGroups", "offscreen" permissions; CSP connect-src fixes
accessibility-tree.js          # reused as-is (P1 perception primitive); no changes needed
visual-indicator.ts            # reused as-is for P2 group-state UI signaling

src/
├── background.ts              # P1: multi-tab CDP attach, Log/Network domain capture,
│                               #     modal-dismissal retry; P3: journal owner + offscreen
│                               #     document lifecycle; P2: tabGroups create/update/close
├── content.ts                 # unchanged unless P1 needs new content-script hooks
├── offscreen.html / offscreen.ts   # NEW (P3): keepalive heartbeat document
├── lib/
│   ├── tools.ts                # P1: extend to navigate/click_element/type_text/
│   │                            #     read_page_state/execute_js/manage_tabs/ask_user
│   ├── computer-use.ts         # P1: extend action set; existing tool stays as one option
│   ├── tabGroups.ts            # NEW (P2): AgentTabGroup lifecycle helpers
│   ├── journal.ts              # NEW (P3): ExecutionJournal read/write/resume helpers
│   ├── openai-compat.ts        # P4: Tier-2 <thinking>/<tool_call> system-prompt injection
│   │                            #     + response parser when supportsTools === false
│   ├── toolCallPolyfill.ts     # NEW (P4): XML tool-call parse/strip, shared ToolCallEnvelope
│   ├── types.ts                # P4: add contextWindow to ProviderConfig; ExecutionJournal,
│   │                            #     AgentTabGroup, ToolCallEnvelope types
│   ├── storage.ts              # P3: journal read/write wrapper alongside existing
│   │                            #     providerVault/conversations/settings helpers
│   ├── steel-computer.ts       # OUT OF SCOPE for this feature (see research.md) — left as
│   │                            #     the existing stub; self-healing/journal targets the
│   │                            #     local CDP path only
│   └── ...                     # models.ts, fastResponse.ts, recordings.ts unchanged
├── sidepanel/
│   └── store.ts                # P1: richer self-healing (overlay dismissal, console/network
│                                #     error surfacing); P3: loop-driving relocated to/
│                                #     coordinated with background.ts so it survives panel close
├── options/                    # unchanged unless P4 needs a contextWindow input field

tests/                          # NEW — no test infra exists today (see Technical Context)
├── unit/                       # Vitest: toolCallPolyfill parsing, journal serialization,
│                                #   contextWindow-aware compressForApi
└── e2e/                        # Playwright + unpacked extension load: SC-001..SC-004 scenarios
```

**Structure Decision**: Single project, extended in place — no new build targets, no
frontend/backend split. All net-new modules (`journal.ts`, `tabGroups.ts`,
`toolCallPolyfill.ts`, `offscreen.ts`) live alongside existing `src/lib/*` and are wired
into the existing `background.ts`/`store.ts`/`openai-compat.ts` entry points rather than
introducing a parallel architecture.

## Complexity Tracking

No constitution violations to justify (constitution is unratified — see Constitution
Check above). The one structural complexity worth flagging without a formal violation:
**P3 requires moving agent-loop ownership from `store.ts` (side panel) toward
`background.ts` (service worker)**, since only the service worker can plausibly survive
long enough to own a resumable journal. This is a real architectural migration, not just
additive code — `tasks.md` should sequence it as its own reviewable slice rather than
folding it silently into "add journal read/write."
