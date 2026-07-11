---
id: 0002
title: Agent engine tasks breakdown
stage: tasks
date: 2026-07-11
surface: agent
model: claude-sonnet-5
feature: 001-claude-free-extension
branch: 001-claude-free-extension
user: Claude Code <claude@anthropic.com>
command: /sp.tasks
labels: ["sp.tasks", "browser-extension", "agent-engine"]
links:
  spec: specs/001-claude-free-extension/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/001-claude-free-extension/tasks.md
tests:
 - none (task-generation stage; tasks.md itself schedules the Vitest/Playwright work as T001-T003, T008-T009, T024, T030-T031, T040-T041, T052)
---

## Prompt

claude-extension-free k /sp.plan, uska bad /sp.tasks uska bad /sp.implement krdo one by one

(Continuation of the same request — /sp.plan completed in PHR 0001, now running /sp.tasks against the completed plan.)

## Response snapshot

Ran `check-prerequisites.ps1 -Json` (confirmed research.md/data-model.md/contracts/quickstart.md all present), then generated `specs/001-claude-free-extension/tasks.md`: 52 tasks across 7 phases.

- Phase 1 Setup (T001-T003): scaffold Vitest + Playwright, since research.md already decided this and no test infra exists in the repo.
- Phase 2 Foundational (T004-T007): the two changes shared by multiple stories — new types (ExecutionJournal/AgentTabGroup/ToolCallEnvelope/ProviderConfig.contextWindow) and the multi-tab CDP attach refactor (Map<tabId, DebuggerSession> replacing the single global attachedTabId), which blocks both US1's multi-tab actions and all of US2.
- Phase 3 US1 (T008-T023, 🎯 MVP): 7-tool extension of the existing multiplexed `computer` action enum, DOM-settlement waiting, console/network capture, overlay-dismissal self-healing.
- Phase 4 US2 (T024-T029): tab group lifecycle + scoped terminate, depends on Foundational's T005 and US1's manage_tabs open path (T018).
- Phase 5 US3 (T030-T039): the big one — journal read/write/resume, offscreen heartbeat, and relocating agent-loop ownership from the side panel into the service worker (flagged in plan.md as its own architectural slice, not folded into "add journal read/write").
- Phase 6 US4 (T040-T048): Tier-2 XML tool-call polyfill in openai-compat.ts, contextWindow plumbing.
- Phase 7 Polish (T049-T052): full quickstart.md validation, docs, type-check, one more unit test.

Every task follows the required `- [ ] T### [P?] [US#?] Description with file path` format. Dependencies section explicitly notes the real cross-story dependencies (US2→US1's T018, US4→Foundational's T004) rather than treating all stories as fully independent, since spec.md's own "Why this priority" reasoning already established a real sequencing rationale (agent loop → tab isolation → endurance → provider breadth).

## Outcome

- ✅ Impact: `tasks.md` is ready for `/sp.implement`; MVP scope explicitly identified as Phase 1-3 (Setup + Foundational + US1).
- 🧪 Tests: none run yet; T001-T003 scaffold the runners, story-specific test tasks (T008-T009, T024, T030-T031, T040-T041) are interleaved per phase.
- 📁 Files: specs/001-claude-free-extension/tasks.md (new).
- 🔁 Next prompts: `/sp.implement`, starting with Phase 1+2 (Setup+Foundational) then Phase 3 (US1/MVP) per the user's "one by one" instruction — implement should likely also proceed phase-by-phase with checkpoints rather than all 52 tasks in one uninterrupted pass, given the size.
- 🧠 Reflection: kept test tasks lightweight (not full TDD-per-task) per research.md's own reasoning that most of this feature's value (CDP dispatch, tabGroups, MV3 lifecycle) isn't meaningfully unit-testable — forcing red/green per task here would have produced test-shaped busywork rather than real coverage.

## Evaluation notes (flywheel)

- Failure modes observed: none.
- Graders run and results (PASS/FAIL): n/a.
- Prompt variant (if applicable): n/a.
- Next experiment (smallest change to try): n/a.
