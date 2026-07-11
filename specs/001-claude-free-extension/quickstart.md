# Quickstart: verifying the resilient agent engine end to end

Manual + scripted verification steps mapped to `spec.md`'s Success Criteria. Run after `/sp.implement` completes each user story, not just at the very end — each story is independently testable per the spec.

## Setup

```bash
npm install
npm run build      # vite build → dist/
```

Load `dist/` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

## SC-004 / P1: self-healing overlay dismissal + stale-element retry

1. Open a test page with an injected cookie-consent overlay covering a target button (any real site with a cookie banner works, or a local test fixture).
2. Ask the agent to click the covered button.
3. **Expect**: agent dismisses the banner via a secondary perception turn, then completes the original click — no user intervention, no error surfaced.
4. Repeat 10x; SC-004 requires ≥9/10 successful auto-dismissals.

## SC-002 / P2: tab group isolation + scoped termination

1. Ask the agent to open 4 research tabs on a topic.
2. **Expect**: exactly one `chrome.tabGroups` group appears, titled `🤖 Agent: <task>`, colored blue, containing exactly those 4 tabs.
3. Click "Terminate Task" in the side panel.
4. **Expect**: exactly those 4 tabs close; any tabs open before the task started remain untouched.

## SC-001 / P3: service-worker restart survives mid-task

**Scope note**: the implemented guarantee is "the service worker restarting doesn't lose task state, as long as the side panel stays open" — the agent loop is still driven by the side panel (`src/sidepanel/store.ts`), not autonomously by the service worker. Fully headless resume after the side panel itself is closed is out of scope for this pass (see `tasks.md` T035). `chrome.runtime.sendMessage` auto-wakes a terminated MV3 service worker, so in practice a mid-task SW restart is transparent to a running task.

1. Start a scripted 50-step task (e.g., a form-filling loop against a local test fixture), side panel open.
2. At step 25, open `chrome://serviceworker-internals`, find the extension's service worker, click "Stop".
3. **Expect**: the task continues uninterrupted from the side panel's perspective (its `while` loop never depended on the SW being alive between messages); the next `computer_use`/`TASK_ROUND_COMPLETE` message auto-wakes the SW, which finds and updates the existing journal rather than starting a fresh one. Task reaches step 50 with `roundCount` incrementing monotonically in `chrome.storage.local` (inspect via the extension's service worker DevTools console: `chrome.storage.local.get(null, console.log)`).
4. Separately, to see the resume-detection path itself: close the side panel entirely mid-task, force-restart the SW as above, then reopen the side panel. **Expect**: a `TASK_ORPHANED` or `TASK_RESUMED` banner appears (per whichever the last-known `activeTabId` resolves to) rather than the extension silently pretending nothing happened.

## SC-003 / P4: Tier-2 XML tool-call polyfill

1. In Options, configure a provider with `supportsTools: false` (e.g., a raw local model endpoint known not to support function calling, or force the flag off for an OpenRouter free-tier model in `PROVIDERS`).
2. Ask the agent to `navigate` to a URL and then `click_element` on something.
3. **Expect**: both actions execute correctly; inspect the visible chat transcript and confirm zero `<thinking>` or `<tool_call>` tags leak into it.

## SC-005 / Steel scope confirmation

1. Enable Steel in Options with a valid API key.
2. Run the same overlay-dismissal test from SC-004.
3. **Expect (documented, not a regression to fix in this feature)**: `SteelComputer` still returns canned success text without real page interaction — this feature does not change Steel's behavior either way (`research.md` §10). If this ever silently starts appearing to work, treat it as a signal Steel was implemented elsewhere and re-scope P1's self-healing claims accordingly.
