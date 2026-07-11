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
- **Execution & Verification:** the extension executes the command via `chrome.debugger` or targeted content scripts, then waits for DOM mutation settlement (network idle or DOM-quiet for 500ms) before capturing the next state.

## 2. Standardized Tool Space

| Tool Name | Parameters | Purpose & Verification |
| --- | --- | --- |
| `navigate` | `url: string` | Loads a target URL. Verifies via `DOMContentReady` event. |
| `click_element` | `selector: string`, `text_hint?: string` | Clicks target element using CDP simulation. Retries if stale. |
| `type_text` | `selector: string`, `text: string`, `submit?: boolean` | Types text with simulated keystroke delays. Optionally hits Enter. |
| `read_page_state` | `include_vision?: boolean` | Returns pruned DOM accessibility tree and console error logs. |
| `execute_js` | `script: string` | Runs custom JavaScript in page context for complex data extraction. |
| `manage_tabs` | `action: string`, `tab_id?: number` | Opens, switches, closes, or groups tabs across workflows. |
| `ask_user` | `prompt: string`, `requires_manual_action: boolean` | Pauses execution for CAPTCHAs, 2FA, or irreversible financial actions. |

## 3. Self-Healing & Intelligent Error Recovery

- **Modal & Overlay Dismissal:** if a click fails because the element is obscured (cookie banners, newsletter popups), the engine fires a secondary perception turn to locate and click dismissal controls (`[X]`, "Accept all", "Close") before retrying the primary action.
- **Console Debugging Loop:** if a web app throws a JS console error or a 4xx/5xx network failure during a task, the agent reads the error payload directly from `chrome.debugger` logs and attempts to reconfigure or fix the input autonomously.

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
