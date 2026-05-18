# Claude Free Extension

A Chrome Extension (Manifest V3) that brings a powerful AI side panel to your browser, powered by **any OpenAI-compatible provider** — completely free. No Claude subscription required.

Built from scratch with React + TypeScript + Vite. Routes all requests through a built-in Anthropic↔OpenAI format adapter so you can use Gemini, DeepSeek, Qwen, Groq, Mistral, OpenRouter, Fireworks, Ollama, and more — while keeping the full Claude-style chat experience including **browser computer use**.

---

## Features

- **Multi-provider support** — swap AI providers without touching any code
- **Browser computer use** — the AI can see, click, type, and navigate your browser in real time using Chrome DevTools Protocol (CDP) for trusted, native-quality input events
- **Live visual indicators** — animated orange glow border, phantom cursor overlay, and a stop button appear during automation so you always know the AI is active
- **Streaming responses** — full SSE streaming with incremental text rendering
- **Tool use / function calling** — Anthropic tool format translated transparently to provider equivalents
- **Vision / image support** — paste or attach screenshots; base64 and URL images both work
- **Conversation history** — persisted across sessions in `chrome.storage.local`
- **Keyboard shortcut** — `Ctrl+E` / `Cmd+E` toggles the side panel
- **Dark / light / auto theme**

---

## Supported Providers

| Provider | Free Tier | Vision | Tools | Notes |
|---|---|---|---|---|
| **Pollinations.ai** | ✅ No key needed | ✅ | ✅ | Default — zero setup |
| **Google Gemini** | ✅ Generous free quota | ✅ | ✅ | Get key at aistudio.google.com |
| **DeepSeek** | ✅ Cheap | ❌ | ✅ | platform.deepseek.com |
| **Alibaba Qwen** | ✅ Free tier | ✅ | ✅ | dashscope-intl.aliyuncs.com |
| **OpenAI** | ❌ Paid | ✅ | ✅ | platform.openai.com |
| **OpenRouter** | ✅ Free models available | ✅ | ✅ | openrouter.ai |
| **Fireworks AI** | ✅ Free credits | ✅ | ✅ | fireworks.ai |
| **Groq** | ✅ Fast & free | ❌ | ✅ | console.groq.com |
| **Mistral** | ✅ Free tier | ✅ | ✅ | console.mistral.ai |
| **Kimi (Moonshot)** | ✅ Free credits | ✅ | ✅ | platform.moonshot.cn |
| **Ollama** | ✅ Fully local | ✅ | ✅ | No key, runs on your machine |
| **LM Studio** | ✅ Fully local | ❌ | ✅ | No key, runs on your machine |
| **Custom** | Varies | Configurable | Configurable | Any OpenAI-compatible endpoint |

---

## Installation

### Option A — Load pre-built (easiest)

1. Download the latest release zip from [Releases](../../releases) and unzip it
2. Open `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select the unzipped `dist/` folder

### Option B — Build from source

**Requirements:** Node.js 18+

```bash
git clone https://github.com/staimoorulhassan/Claude-Free-Extension.git
cd Claude-Free-Extension
npm install
npm run build        # outputs to dist/
```

Then load `dist/` as an unpacked extension in Chrome.

For live development:

```bash
npm run dev          # watch mode — rebuilds on save
```

After each rebuild, click the reload icon on `chrome://extensions`, then reopen the side panel.

---

## Quick Setup

1. Click the extension icon or press **Ctrl+E** to open the side panel
2. Click the **Settings** gear icon
3. Select a **Provider** from the dropdown
4. Enter your **API Key** (leave blank for Pollinations — no key needed)
5. Optionally set a custom model name
6. Enable **Computer Use** to let the AI control your browser

Your API key is stored locally in `chrome.storage.sync` and is **never sent anywhere except directly to your chosen provider**.

---

## Computer Use

When Computer Use is enabled, the AI gains a `computer` tool with these actions:

| Action | Description |
|---|---|
| `screenshot` | Capture the current tab |
| `navigate` | Go to a URL |
| `read_page` | Get a labelled accessibility tree of the page |
| `left_click` | Click at coordinates |
| `click_element` | Click a labelled element by ref ID |
| `type` | Type text into the focused field |
| `key` | Press keyboard keys (Enter, Tab, Escape, arrows, ctrl+c…) |
| `scroll` | Scroll the page |
| `double_click` | Double-click at coordinates |
| `right_click` | Right-click at coordinates |
| `left_click_drag` | Click and drag |
| `wait` | Pause for a moment |

Input events are dispatched via Chrome DevTools Protocol (`Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent`) — these are **trusted events** that work with React apps, SPAs, and any modern web page.

**Example prompt:**
> *"Go to google.com and search for the best laptop under $1000"*

The AI will navigate, type, and click entirely on its own while you watch via the phantom cursor overlay.

---

## Architecture

```
src/
├── background.ts          — service worker: CDP computer use, agent lifecycle
├── content.ts             — minimal page bridge
├── visual-indicator.ts    — glow border + phantom cursor + stop button (content script)
├── lib/
│   ├── openai-compat.ts   — Anthropic↔OpenAI format adapter + provider presets
│   ├── computer-use.ts    — computer tool schema + background message relay
│   ├── tools.ts           — tool registry and dispatcher
│   ├── storage.ts         — chrome.storage helpers
│   └── types.ts           — shared TypeScript types
└── sidepanel/
    ├── store.ts           — Zustand store + agent loop
    ├── App.tsx            — root component
    └── components/        — Chat, Message, MessageInput, SettingsPanel, HistoryPanel…
```

### Request flow

```
User message → store.sendMessage()
    ↓
createOpenAICompatibleFetch()          ← src/lib/openai-compat.ts
    ↓
Intercepts Anthropic-format POST → translates to OpenAI /chat/completions
    ↓
OpenAI SSE response → converts back to Anthropic SSE format
    ↓
store parses events → Zustand state updates → React re-renders
```

### Agent loop

The agent runs a `while(true)` loop in `store.ts`:
1. POST streaming request to `/v1/messages`
2. Parse SSE events, accumulate text and tool-use blocks
3. If `stop_reason === 'tool_use'` → execute tool calls via `background.ts` (CDP)
4. Append tool results as a new user message → loop
5. Otherwise → break, save conversation

---

## Adding a New Provider

1. Add an entry to the `PROVIDERS` table in [src/lib/openai-compat.ts](src/lib/openai-compat.ts):

```typescript
myprovider: {
  baseURL: 'https://api.myprovider.com/v1',
  defaultModel: 'my-model-name',
  supportsVision: true,
  supportsTools: true,
  modelMap: {
    'claude-sonnet-4-6': 'my-model-name',
    'claude-haiku-4-5':  'my-fast-model',
  },
},
```

2. Add the provider's API origin to `connect-src` in [manifest.json](manifest.json):

```json
"connect-src": "... https://api.myprovider.com ..."
```

3. Rebuild: `npm run build`

---

## Security

- API keys are stored in `chrome.storage.sync` (encrypted by Chrome, synced across your devices)
- Keys are transmitted only to your chosen provider's API endpoint — never to any third party
- No telemetry, no analytics, no remote logging
- Computer use runs entirely locally via Chrome's native debugger API

---

## Privacy

This extension does not collect, transmit, or store any personal data on any server. All data (conversations, settings, API keys) stays on your local machine or in your Chrome profile sync.

---

## Development Commands

```bash
npm run dev          # build + watch
npm run build        # production build → dist/
npm run type-check   # TypeScript check (no emit)
```

---

## License

MIT — do whatever you want with it.
