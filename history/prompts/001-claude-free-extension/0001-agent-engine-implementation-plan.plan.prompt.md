---
id: 0001
title: Agent engine implementation plan
stage: plan
date: 2026-07-11
surface: agent
model: claude-sonnet-5
feature: 001-claude-free-extension
branch: 001-claude-free-extension
user: Claude Code <claude@anthropic.com>
command: /sp.plan
labels: ["sp.plan", "browser-extension", "agent-engine"]
links:
  spec: specs/001-claude-free-extension/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/001-claude-free-extension/spec.md
 - specs/001-claude-free-extension/plan.md
 - specs/001-claude-free-extension/research.md
 - specs/001-claude-free-extension/data-model.md
 - specs/001-claude-free-extension/quickstart.md
 - specs/001-claude-free-extension/contracts/tools.md
 - specs/001-claude-free-extension/contracts/messages.md
 - .specify/ (bootstrapped from the outer wrapper repo — this clone had none)
tests:
 - none (planning stage; test framework choice itself is a research.md decision — Vitest + Playwright, not yet implemented)
---

## Prompt

claude-extension-free k /sp.plan, uska bad /sp.tasks uska bad /sp.implement krdo one by one

(Preceded by a clarifying question, answered: "Chaaron specs ek sath, ek unified feature ki tarah" — i.e., consolidate all four sp.specs/*.spec.md files (agent-engine, tab-grouping, endurance-runtime, multi-provider-router) into one unified feature rather than four separate SDD cycles.)

## Response snapshot

Ran `/sp.plan` for the Claude-Free-Extension repo (`C:\cfe-pr-work\Claude-Free-Extension`, branch `001-claude-free-extension`, the PR-staged clean clone from earlier in this session — not the outer wrapper directory that only holds `.specify`/`CLAUDE.md` scaffolding, and not the untracked nested folder under Downloads).

Key steps:
1. Discovered this repo had no `.specify/` scaffolding at all (the earlier `sp.specs/*.spec.md` files used a custom, non-SpecKit format). Bootstrapped `.specify/` by copying it from the outer wrapper directory's scaffolding.
2. Spawned an Explore agent to survey the actual codebase (`src/lib/tools.ts`, `background.ts`, `store.ts`, `openai-compat.ts`, `accessibility-tree.js`, `steel-*.ts`) before writing anything, per the constitution's reuse-first mandate. Major finding: this is not greenfield — a working agent loop, CDP dispatcher, and provider router already exist; tab-grouping and service-worker persistence are the only fully-greenfield areas. Also found `SteelComputer` is a non-functional stub and `api.steel.dev` is missing from the CSP allowlist.
3. Wrote `specs/001-claude-free-extension/spec.md` consolidating all 4 sp.specs into one feature with 4 prioritized (P1–P4) user stories, sequenced by real dependency order (agent loop → tab isolation → endurance → provider breadth) rather than the original doc's ordering.
4. Ran `setup-plan.ps1 -Json`, filled `plan.md`'s Technical Context (flagging "Testing" as NEEDS CLARIFICATION since no test framework exists in `package.json`), Constitution Check (unratified — template only, no gates), and Project Structure (extends existing modules in place, no parallel architecture).
5. Phase 0: `research.md` — 11 numbered decisions resolving every NEEDS CLARIFICATION and open design question (testing framework, perception reuse, single-multiplexed-tool vs 7-tool schema, multi-tab CDP attach model, journal schema/resume strategy, offscreen heartbeat lifecycle, tab-group color scheme, Tier-2 XML polyfill integration point, contextWindow sourcing, Steel scope, CSP fix scope).
6. Phase 1: `data-model.md` (ExecutionJournal, AgentTabGroup, extended ProviderConfig, ToolCallEnvelope, with validation rules and a state-transition diagram), `contracts/tools.md` (7-capability action-enum contract), `contracts/messages.md` (new chrome.runtime message types), `quickstart.md` (manual verification steps mapped 1:1 to spec.md's SC-001..SC-005).
7. Ran `update-agent-context.ps1 claude` — it reported success but produced no actual diff in the repo's `CLAUDE.md` (likely a marker-based insertion point this hand-written CLAUDE.md doesn't have). Flagged as a known minor gap, not blocking.

## Outcome

- ✅ Impact: Full Phase 0 + Phase 1 planning artifacts exist for a unified 4-area feature; ready for `/sp.tasks`.
- 🧪 Tests: none yet — `research.md` §1 decided Vitest (unit) + Playwright (e2e, unpacked-extension load) as the approach, to be scaffolded during implementation.
- 📁 Files: see `files:` above.
- 🔁 Next prompts: `/sp.tasks` to generate `tasks.md` from this plan; then `/sp.implement`. Also worth a follow-up: fix `update-agent-context.ps1`'s silent no-op against this repo's `CLAUDE.md`.
- 🧠 Reflection: the biggest risk surfaced isn't in the spec's original four areas — it's that P3 (endurance) requires relocating agent-loop ownership from the side panel into the service worker, a real architectural migration `tasks.md` needs to sequence as its own slice rather than bury inside "add journal read/write."

## Evaluation notes (flywheel)

- Failure modes observed: `update-agent-context.ps1` claimed success but made no file change — likely assumes marker comments this repo's CLAUDE.md doesn't have. Not investigated further (out of critical path).
- Graders run and results (PASS/FAIL): n/a.
- Prompt variant (if applicable): n/a.
- Next experiment (smallest change to try): n/a.
