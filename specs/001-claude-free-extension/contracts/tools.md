# Tool Contract: extended `computer` action enum

Per `research.md` §3, all 7 capabilities from `spec.md` are additive `action` values on the existing single `computer` tool (`src/lib/tools.ts` / `src/lib/computer-use.ts`), not 7 separate top-level tools. This file specifies the input/output contract for each new/changed action. Existing actions (`screenshot`, `left_click`, `type`, `key`, `scroll`, etc.) are unchanged.

## `navigate`

- **Input**: `{ action: 'navigate', url: string }`
- **Output (success)**: `{ success: true, finalUrl: string }` — resolved via CDP `Page.navigate` + wait for `DOMContentReady` (replaces today's fixed `setTimeout` after navigate)
- **Output (error)**: `{ success: false, error: string }` — e.g. navigation timeout, blocked by CSP/permissions
- **Verification**: caller MUST treat a `navigate` result as unverified until the next `read_page_state` call confirms the expected page loaded — `navigate` itself only confirms the browser accepted the navigation, not that the target page is what the agent expected.

## `click_element`

- **Input**: `{ action: 'click_element', selector: string, text_hint?: string }` — already exists; contract unchanged except for the retry/self-healing behavior below.
- **Output (success)**: `{ success: true }`
- **Output (stale/not found)**: `{ success: false, error: 'not found' | 'stale' }` — triggers the existing `store.ts:788-818` auto `read_page_state` retry (FR-001/P1 acceptance scenario 2); on a second consecutive failure, the loop surfaces `ask_user` instead of retrying indefinitely.
- **Output (obscured)**: `{ success: false, error: 'obscured', obscuredBy?: string }` — new: when CDP reports the click target is covered by another element, this is what triggers the P1 acceptance scenario 1 overlay-dismissal sub-turn (locate + click a dismissal control, then retry the original `click_element` once).

## `type_text`

- **Input**: `{ action: 'type_text', selector: string, text: string, submit?: boolean }`
- **Output**: `{ success: true }` or `{ success: false, error: string }`
- **Behavior**: types via CDP `Input.insertText` per-character with simulated delay (existing pattern from `type`/`key` actions in `background.ts`); if `submit: true`, dispatches Enter after typing completes.

## `read_page_state`

- **Input**: `{ action: 'read_page_state', include_vision?: boolean }`
- **Output**: `{ pageContent: string, viewport: {width:number,height:number}, screenshot?: string /* base64, only if include_vision */, consoleErrors: ConsoleErrorEntry[], networkErrors: NetworkErrorEntry[], error?: string }`
- **Behavior**: `pageContent`/`viewport` are exactly `accessibility-tree.js`'s existing output (unchanged, per `research.md` §2). `consoleErrors`/`networkErrors` are NEW — populated from CDP `Log`/`Network` domain events accumulated since the last `read_page_state` call on this tab (FR-004).

```typescript
interface ConsoleErrorEntry { level: 'error' | 'warning'; text: string; timestamp: number; }
interface NetworkErrorEntry { url: string; status: number; method: string; timestamp: number; }
```

## `execute_js`

- **Input**: `{ action: 'execute_js', script: string }`
- **Output**: `{ success: true, result: unknown }` (JSON-serializable return value of the script) or `{ success: false, error: string }`
- **Behavior**: executes via `chrome.scripting.executeScript` in an isolated world against the active tab (NOT `MAIN` world, unlike `accessibility-tree.js` — arbitrary agent-generated script stays isolated from page globals for safety).
- **Permission note**: this is the highest-risk new action (arbitrary script execution). It reuses the existing `requireApproval` gate in `store.ts` — when approval mode is on, `execute_js` calls MUST always require explicit user approval regardless of the user's general approval setting (open question flagged in `spec.md` 01-agent-engine's original draft; resolved here as: always-gate, no opt-out, since this is the one action with unbounded blast radius).

## `manage_tabs`

- **Input**: `{ action: 'manage_tabs', op: 'open' | 'switch' | 'close' | 'group_status', tab_id?: number, url?: string }`
- **Output**: `{ success: true, tabId?: number, groupId?: number }` or `{ success: false, error: string }`
- **Behavior**: `open` creates a new tab, adds it to the task's `AgentTabGroup` (creating the group on first use per FR-006), and returns the new `tabId`. `close` only succeeds for tabs in `AgentTabGroup.memberTabIds` for the current task (enforces the P2 acceptance-scenario-3 scoped-cleanup guarantee at the tool layer, not just at the "Terminate Task" UI button).

## `ask_user`

- **Input**: `{ action: 'ask_user', prompt: string, requires_manual_action: boolean }`
- **Output**: resolves once the user responds via the sidepanel UI; `{ response: string }`.
- **Behavior**: pauses the loop (reuses the existing `pendingApproval`-style promise pattern in `store.ts:738-779`) until the user answers. `requires_manual_action: true` (e.g., CAPTCHA, 2FA, irreversible financial action) additionally surfaces a distinct "waiting for you" UI state, distinguishing it from the ordinary approval-gate pause.
