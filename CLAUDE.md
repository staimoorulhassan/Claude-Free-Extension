# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A from-scratch Chrome extension (Manifest V3) that provides a Claude-compatible AI side panel, routing all requests through any OpenAI-compatible provider (Gemini, DeepSeek, Qwen, OpenAI, Groq, Ollama, Pollinations, etc.) via a built-in translation adapter. The extension is built with React + TypeScript + Vite.

The older compiled extension files in the repo root (`assets/`, the original `service-worker-loader.js`, etc.) are legacy reference — the active source is entirely in `src/`.

## Commands

```bash
npm install          # install dependencies
npm run dev          # build and watch (reload dist/ in Chrome after each change)
npm run build        # production build → dist/
npm run type-check   # TypeScript check without emitting
```

**Loading in Chrome:** `chrome://extensions → Developer mode → Load unpacked → select dist/`

After any code change with `npm run dev`, click the reload icon in `chrome://extensions`, then reopen the side panel.

## Architecture

### Build output

Vite builds everything into `dist/`:

| Output | Source |
|--------|--------|
| `dist/sidepanel.html` | `sidepanel.html` + `src/sidepanel/` |
| `dist/options.html` | `options.html` + `src/options/` |
| `dist/background.js` | `src/background.ts` |
| `dist/content.js` | `src/content.ts` |
| `dist/assets/chunks/` | shared React/library chunks |
| `dist/manifest.json` | copied from `manifest.json` |
| `dist/icon-128.png` | copied from root (if present) |

### Source layout (`src/`)

```
src/
├── lib/
│   ├── types.ts          — all shared TypeScript types (ContentBlock, Message, AppSettings…)
│   ├── openai-compat.ts  — Anthropic↔OpenAI format adapter + PROVIDERS preset table
│   ├── storage.ts        — chrome.storage helpers (settings, conversations)
│   ├── tools.ts          — tool registry; dispatches tool calls to implementations
│   └── computer-use.ts   — computer use tool (screenshot, click, type, scroll, drag…)
├── background.ts         — service worker (side panel open, keyboard shortcut, lifecycle)
├── content.ts            — content script (minimal bridge; reserved for page interaction)
├── sidepanel/
│   ├── main.tsx          — React entry point
│   ├── App.tsx           — root component; theme, init, panel switching
│   ├── store.ts          — Zustand store; all state + agent loop logic
│   ├── sidepanel.css     — all styles (CSS custom properties for dark/light theming)
│   └── components/
│       ├── Header.tsx        — toolbar (new chat, history, settings buttons)
│       ├── Chat.tsx          — scrollable message list
│       ├── Message.tsx       — renders a single message (markdown + tool blocks)
│       ├── MessageInput.tsx  — textarea, file attach, send/stop buttons
│       ├── ToolCall.tsx      — collapsible tool_use and tool_result block UIs
│       ├── SettingsPanel.tsx — in-panel settings (provider, tokens, computer use…)
│       └── HistoryPanel.tsx  — conversation list with delete
└── options/
    ├── main.tsx          — options page entry
    └── App.tsx           — full-page settings form
```

### Request flow

```
User types → MessageInput → store.sendMessage()
    ↓
createOpenAICompatibleFetch(providerConfig)   ← src/lib/openai-compat.ts
    ↓
Anthropic-format POST to https://api.anthropic.com/v1/messages
    ↓   (intercepted by custom fetch)
Translated to OpenAI /chat/completions → provider
    ↓
OpenAI SSE response → converted back to Anthropic SSE format
    ↓
store parses SSE events → updates Zustand state → React re-renders
```

### Agent loop (in `store.ts`)

`sendMessage()` runs a `while(true)` loop:
1. POST to `/v1/messages` (streaming)
2. Parse SSE events: accumulate text/tool-use blocks incrementally
3. If `stop_reason !== 'tool_use'` → break
4. Execute tool calls via `src/lib/tools.ts` → `executeTool()`
5. Append tool results as a new `user` message, loop

### Provider configuration

Stored in `chrome.storage.sync` under key `"settings"`. The `PROVIDERS` table in `src/lib/openai-compat.ts` defines presets (baseURL, defaultModel, modelMap, vision/tools support). Users configure via Settings panel or Options page. No API key is hardcoded — Pollinations.ai is the default because it's free and key-free.

### Computer use

Defined in `src/lib/computer-use.ts`. Actions are executed via `chrome.scripting.executeScript` (for click/type/scroll) and `chrome.tabs.captureVisibleTab` (for screenshot). Uses CSS-pixel coordinates on the currently active browser tab. CDP/debugger is not used — this keeps permissions simpler but means events are synthesized at the DOM level.

### Adding the CSP when adding a new provider

The manifest's `content_security_policy.extension_pages` `connect-src` directive must include the provider's origin. Add the new URL there and rebuild.

## Key constraints

- `src/lib/openai-compat.ts` is the TypeScript counterpart to the legacy `openai-compat-fetch.js` in the root. They share the same logic; keep them in sync if the translation layer changes.
- `content.ts` runs in `document_idle` on all URLs. Keep it lightweight — no heavy imports.
- `background.ts` is an ES module service worker. Chrome MV3 service workers wake up on demand; don't rely on in-memory state surviving between events.
- Conversation history persists in `chrome.storage.local` (unlimited storage permission). Settings persist in `chrome.storage.sync` (limited to ~100 KB total).
