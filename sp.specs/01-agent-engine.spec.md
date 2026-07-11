# 01 — Agent Engine: Intelligent Solver & Browser Control

## Status
Draft

## Summary
Upgrade the extension's automation core to a CDP-driven Perceive → Plan → Act → Verify loop, replacing basic script injection, so the agent can autonomously complete multi-step browser tasks with self-healing error recovery.

## 1. The Autonomous Action Loop

- **Perception Layer:** each turn captures:
  - a pruned Accessibility DOM Tree (non-interactive `div`s filtered out to save token context)
  - a base64 viewport screenshot (only when the active model supports vision)
  - recent network/console error logs
- **Reasoning & Planning:** the LLM evaluates current state against the user's objective, emits an internal reasoning block, then outputs one specific tool command.
- **Execution & Verification:** the extension executes the command via `chrome.debugger` or targeted content scripts, then waits for DOM mutation settlement (DOM-quiet for 500ms, or network idle defined as zero active `fetch`/`XMLHttpRequest` calls and no pending event-loop callbacks visible to content-script observation) before capturing the next state. Settlement wait is capped at 15 seconds maximum to prevent indefinite blocking by long-polling or streaming connections.

## 2. Standardized Tool Space

The extension exposes a single `computer` tool with action-based dispatch. The canonical `ComputerAction` interface (defined in `src/lib/computer-use.ts`) accepts:

- `action: string` — action type (see table below)
- `coordinate?: [number, number]` — CSS-pixel `[x, y]` for click/scroll actions
- `start_coordinate?: [number, number]` — drag start point
- `text?: string` — text to type, or key name for `action="key"`
- `url?: string` — target URL for `action="navigate"`
- `ref_id?: string` — element identifier from `read_page` output for `action="click_element"`
- `filter?: string` — `"interactive"` (default) or `"all"` for `action="read_page"`
- `direction?: 'up' | 'down' | 'left' | 'right'` — scroll direction
- `num_clicks?: number` — scroll step count (default 3)
- `duration?: number` — wait duration in seconds

| Action | Key Parameters | Purpose & Verification |
| --- | --- | --- |
| `navigate` | `url` | Loads a target URL. Waits for `status === 'complete'` event (max 15s) plus 800ms settle. |
| `click_element` | `ref_id` | Clicks target element by ref ID from `read_page`. Resolves coordinates via `__claudeElementMap` WeakRef registry, dispatches CDP Input events. 300ms settle. |
| `left_click`, `double_click`, `right_click`, `middle_click` | `coordinate` | Clicks at CSS-pixel coordinates using CDP `Input.dispatchMouseEvent`. 300ms settle after click. |
| `type` | `text` | Types text via CDP `Input.insertText` (no per-character delay). |
| `key` | `text` (key name or combo, e.g. `"Return"`, `"ctrl+a"`) | Dispatches keyDown/keyUp via CDP. 800ms settle after Enter/Return. |
| `scroll` | `coordinate`, `direction`, `num_clicks` | Scrolls viewport via CDP `mouseWheel` event. |
| `left_click_drag` | `start_coordinate`, `coordinate` | Drags from start to end in 10 interpolated steps. |
| `read_page` | `filter` | Executes `__generateAccessibilityTree()` injected into page context. Returns labeled tree + viewport dimensions. |
| `screenshot` | — | Captures via `Page.captureScreenshot` (CDP, DPR-normalized) or `chrome.tabs.captureVisibleTab` fallback. Returns base64 JPEG. |
| `wait` | `duration` | Pauses execution for `duration` seconds. |

**Note:** The spec-level tool names `execute_js`, `manage_tabs`, and `ask_user` are not yet implemented in the current `ComputerAction` dispatcher (`src/background.ts` lines 191-410). When added, they must conform to the same `ComputerAction` interface and be dispatched via the `computer_use` message handler.

**Security:** `execute_js` (when implemented) must require explicit user authorization before execution. Default behavior is deny. Authorization must be scoped per origin and capability (e.g., read-only DOM queries vs. mutation). Arbitrary page-context script execution is never permitted by default.

## 3. Self-Healing & Intelligent Error Recovery

- **Modal & Overlay Dismissal:** if a click fails because the element is obscured (cookie banners, newsletter popups), the engine fires a secondary perception turn to locate and click non-consent dismissal controls (close buttons: `[X]`, "dismiss", "no thanks", "maybe later") before retrying the primary action. Consent actions ("Accept all", "I agree", cookie acceptance, terms acceptance) are excluded from autonomous dismissal and require explicit user approval or policy configuration.
- **Console Debugging Loop:** when a web app action fails (element not found, navigation timeout, stale state), the agent attempts to reconfigure or fix the input autonomously by re-reading page state. **Note:** The current implementation enables only the CDP `Page` domain (`src/background.ts` line 88); console errors and 4xx/5xx network response payloads are not captured unless `Runtime` and `Network` domains are enabled and event listeners are registered for `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Network.responseReceived`, and `Network.getResponseBody`.

## Acceptance Criteria

- [ ] A perception turn returns a pruned accessibility tree under the active model's context budget.
- [ ] All seven tools are callable through both the native tool-calling path and the XML polyfill path (see `04-multi-provider-router.spec.md`).
- [ ] `click_element` retries at least once on a stale-element error before surfacing failure to the user.
- [ ] A cookie-banner overlay blocking a target element is auto-dismissed before the primary action retries.
- [ ] A 4xx/5xx network failure during a task is surfaced in the agent's next reasoning turn without crashing the loop.

## Out of Scope
- Model selection/routing logic (see `04-multi-provider-router.spec.md`)
- Tab group visual lifecycle (see `02-tab-grouping.spec.md`)
- Service worker persistence (see `03-endurance-runtime.spec.md`)

## Open Questions
- Which permission model gates `execute_js` given arbitrary script execution risk?
- What is the retry ceiling before `ask_user` is invoked automatically?
