# Claude Free — Domain Glossary & Project Context

Terms used in architecture discussions. Add to this file as the domain model
sharpens; do not re-litigate decisions recorded in ADRs (see `docs/adr/`).

## Domain glossary

- **Task** — one agent run. Owns the tab group and the tabs it opened, carries a
  journal record (`journal:<taskId>` in `chrome.storage.local`) with lifecycle
  status (`in_progress`, `orphaned`, `completed`, `aborted`), and must survive
  service-worker restarts (resume/orphan protocol in `background.ts`).
- **Tool** — a model-invoked action. The side panel exposes a single tool,
  `computer`, whose ~25 actions span browser control (click, type, navigate,
  screenshot, scroll, …) and web research. The schema lives in the side panel
  (`src/lib/types.ts`); execution lives in the background dispatcher
  (`src/background.ts`), with a separate (stub) Steel executor.
- **Research** — the read-only web actions: `web_search`, `web_fetch`,
  `discover_site`, `sitemap_urls`. They share HTML-extraction helpers in
  `src/lib/webResearch.ts`.
- **Recording** — a macro: user interactions (click/type) captured by content
  scripts and replayed as a scripted task prompt.
- **Provider** — an OpenAI-compatible chat endpoint the UI streams from, via
  `src/lib/openai-compat.ts`, which translates between OpenAI request/SSE and
  Anthropic message shapes.
- **Steel** — a remote-browser adapter behind the `computer` tool. Currently a
  stub: most actions return "not implemented".
- **Journal** — the persistence record for a Task (see above). Lifecycle
  operations (new / write / read / complete / find-in-progress / resume-on-
  startup) live in `src/lib/journal.ts` behind an injected storage seam so the
  module is unit-testable with an in-memory fake.

## Repository & build

- **Source repo:** github.com/staimoorulhassan/Claude-Free-Extension
- **Working clone:** `E:\claude-free-recon` — feature branches cut off `main`,
  PRs opened against `main` and merged with merge commits.
- **Build workflow:**
  - `npm ci` — install pinned dependencies
  - `npm run build` — Vite build → `dist/`. `dist/` is **committed** and must
    rebuild byte-identically from a clean checkout; the CI dist-sync guard
    enforces this. HTML is forced to LF via `.gitattributes` (`*.html eol=lf`)
    because vite preserves source line endings — Windows autocrlf must never
    smudge CRLF into the committed artifact.
  - `npm test` — vitest (`src/**` + `tests/unit`, 126 tests) plus `node --test`
    spec-conformance checks (52 tests).
  - `npx playwright test` — the e2e suite (`tests/e2e`) loads `dist/` as an
    unpacked MV3 extension (headed Chromium). Locally: `PLAYWRIGHT_CHANNEL`
    optional; in CI it runs under `xvfb-run`.
- **CI (`.github/workflows/build.yml`):** the `build` job runs type-check →
  `npm test` → build → **dist-sync guard** → **CRLF-in-dist check** →
  upload/attest; the `e2e` job installs the pinned bundled chromium
  (`npx playwright install --with-deps chromium`) and runs the full Playwright
  suite under `xvfb-run`. **Every PR is gated on all of:** `npm test`
  (126 vitest + 52 node), the full e2e suite (8 specs), the dist-sync guard
  (committed `dist/` must rebuild byte-identically), and the CRLF check
  (no committed file under `dist/` may contain a CR byte).

## Version picture

- **Workspace:** v3.3.6 + PRs #13–#30 at `6d6c9d7` — a byte-identical copy of
  the CI-verified committed `dist/` from `E:\claude-free-recon` (all top-level
  files `cmp`-verified, `assets/` and `sounds/` directory-compared). Includes
  the tabi provider preset (PR #30) in addition to the v3.3.6 release content.
  Older builds are preserved in this directory, recoverable if ever needed:
  `dist-3.3.3-backup/` (the shipped v3.3.3 + hand-edits) and
  `dist-pre-tabi-backup/` (the `57b91b0` copy — also recoverable from repo
  commit `57b91b0`'s committed dist).
- **`main`:** v3.3.6 — the real source tree, with PRs #13–#30 merged
  (currently at `6d6c9d7`). **Release v3.3.6 is published as Latest** with
  `claude-free-extension-v3.3.6.zip` attached (built + attached by CI on the
  `v3.3.6` tag; the tabi provider landed after the release tag and is in the
  workspace but not in the v3.3.6 zip):

| PR | Change | Workspace delta it absorbs |
|----|--------|---------------------------|
| #13 | storage-write guards (`chrome.storage` failures) | crash fix (unhandled rejections on disk-full/quota) in settings/vault/conversations/recordings/Steel-session saves |
| #14 | AGENT_STOPPED journal-complete fallback (`currentTaskId ?? msg.taskId`) + `completeJournal()` extraction with unit tests | journal-complete fix in the shipped `background.js` |
| #15 | declarativeNetRequest UA-spoof rule for agentrouter.org + CSP `novarouter.site` | `dnr-rules.json` + manifest wiring |
| #16 | a11y suite: runtime patch (`a11y.js`) + WCAG 2.2 CSS overrides + options contrast fix | the workspace's a11y artifacts |
| #17 | a11y ported declaratively into React; `a11y.js` deleted | runtime patch layer removed from the build |
| #18 | CI hardening: e2e job, dist-sync guard, `npm test` gate | — |
| #19 | `CONTEXT.md` — this domain glossary + repository/build/version state | — |
| #20 | `FetchFn` injection seam + 16 unit tests on `webResearch.ts` (search/sitemap/discover/page-fetch, real abort path) | — |
| #21 | title entity-decoding fix in `fetchPageAsText` (titles now decode like text/snippets) | — |
| #22 | `FetchFn` seams + 15 tests on `models.ts`/`agentrouter.ts`; unreachable fallback-error branch removed | — |
| #23 | `.gitattributes` (`*.html eol=lf`) + CI CRLF-in-dist check | closes the CRLF-in-dist failure class (#18/#22) |
| #24 | `CONTEXT.md` refresh — this file, extended through #23 | — |
| #25 | journal-owned tab assignments (`openedTabIds` persisted via the injected seam; terminate unions cache + persisted set so terminate-after-restart closes the right tabs; orphan verification checks the persisted set) + terminal-state lifecycle (`abortJournal`, shared `isTerminal` guard) | — |
| #26 | per-provider `extraHeaders` (validated JSON) enabling the Opik LLM Gateway (`Comet-Workspace` header) + `connect-src` CSP for `www.comet.com` | — |
| #27 | `CONTEXT.md` refresh — this file, extended through #26 | — |
| #28 | version bump 3.3.5 → 3.3.6 (manifest + package + rebuilt dist/manifest) → release v3.3.6 published as Latest with dist.zip attached | — |
| #29 | `CONTEXT.md` refresh — this file, extended through release v3.3.6 | — |
| #30 | tabi provider preset (`https://tabitoken.com/v1`, claude-opus-4-8 default, Claude-family mapping) + wallet onboarding + `connect-src` CSP for `tabitoken.com` | — |

## Open decision: the 20% security system prompt

The shipped v3.3.3 bundle once carried a non-empty default system prompt
("You are a browser automation agent … FULL, REAL control of the user's
browser", plus research guidance) — a hand-reduced version of a longer security
preamble. The source default (`DEFAULT_SETTINGS.systemPrompt` in
`src/lib/types.ts`) is empty.

With the workspace now running the current source build, there is **no longer a
workspace-only delta** — both sides carry the empty default. Whether to port the
20% prompt back into source is still **pending the owner's decision**: committing
it would bake that reduced prompt into every build.

(Historical note: the old shipped `a11y.js` runtime patch and its stale
references were removed from the workspace with this rebuild — that work was
already ported declaratively into React in PR #17.)
