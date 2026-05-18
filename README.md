# Universal Provider Extension — Multi-Provider AI Interface

The **Universal Provider Extension** transforms the Chrome browser automation extension into a **multi-provider AI interface** supporting any OpenAI-compatible API endpoint while preserving 100% feature parity.

---

## Supported Providers

| Provider | Icon | Vision | Tools | Streaming | Authentication |
|----------|------|--------|-------|-----------|----------------|
| **Google Gemini** | 🔵 | ✅ | ✅ | ✅ | API Key (aistudio.google.com) |
| **DeepSeek** | 🔷 | ❌ | ✅ | ✅ | API Key (platform.deepseek.com) |
| **Alibaba Qwen** | 🟠 | ✅ | ✅ | ✅ | API Key (dashscope-intl.aliyuncs.com) |
| **MiniMax** | 🟢 | ✅ | ✅ | ✅ | API Key (minimaxi.com) |
| **Zhipu GLM** | 🟣 | ✅ | ✅ | ✅ | API Key (open.bigmodel.cn) |
| **OpenAI** | ⚫ | ✅ | ✅ | ✅ | API Key (platform.openai.com) |
| **Groq** | ⚡ | ❌ | ✅ | ✅ | API Key (console.groq.com) |
| **Mistral** | 🌊 | ✅ | ✅ | ✅ | API Key (console.mistral.ai) |
| **Kimi (Moonshot)** | 🌙 | ✅ | ✅ | ✅ | API Key (platform.moonshot.cn) |
| **Azure OpenAI** | 🔷 | ✅ | ✅ | ✅ | Azure AD/API Key |
| **Ollama** | 🦙 | ✅ | ✅ | ✅ | None (local) |
| **LM Studio** | 🖥️ | ❌ | ✅ | ✅ | None (local) |
| **Pollinations.ai** | 🌸 | ✅ | ✅ | ✅ | Optional (pollinations.ai) |
| **Custom** | ⚙️ | Configurable | Configurable | Configurable | Varies |

---

## Quick Start

### 1. Install the Extension

Load the extension in Chrome:
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the extension folder

### 2. Configure Your Provider

**Method A: Setup UI (Recommended)**

The extension will automatically prompt you to configure a provider on first launch. The setup UI includes:
- Provider selection with feature badges (Vision, Tools, Streaming)
- API key input with helpful hints
- Advanced settings for custom endpoints

**Method B: Keyboard Shortcut**

Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) at any time to open the provider selector.

**Method C: Programmatic API**

```javascript
// Open the provider selector UI
UniversalProvider.showUI();

// Get current configuration
const config = UniversalProvider.getConfig();
console.log(config.provider, config.apiKey);

// Switch provider programmatically
await UniversalProvider.saveConfig({
  provider: 'gemini',
  apiKey: 'YOUR_API_KEY'
});
```

---

## Features at 100% Parity

All extension features work identically regardless of the provider:

| Feature | How It's Preserved |
|---------|-------------------|
| **Streaming SSE** | Full `message_start → content_block_delta → message_stop` event translation |
| **Tool Use** | Anthropic ↔ OpenAI tool format bidirectional translation |
| **Vision/Images** | Base64 and URL images translated to OpenAI `image_url` format |
| **System Prompts** | Converted to OpenAI `{role: "system"}` messages |
| **Stop Sequences** | Mapped to OpenAI `stop` parameter |
| **Token Usage** | Mapped from `prompt_tokens`/`completion_tokens` |
| **Extended Thinking** | Passed through as `<thinking>` text blocks |
| **Multi-turn Conversations** | Full conversation history preserved |
| **MCP Connectors** | Pass-through (not intercepted) |
| **OAuth Integration** | Pass-through (not intercepted) |
| **Analytics** | Pass-through (not intercepted) |
| **Browser Automation** | Full functionality via tool calling |

---

## Architecture

```
sidepanel.html
  └─ inject-openai-provider.js       ← Universal provider adapter
       ├─ Provider Registry            ← 13+ provider presets
       ├─ Login Bypass                 ← Dummy API key injection
       ├─ Fetch Interceptor            ← /v1/messages translation
       └─ UI Components                ← Provider selector overlay
            └─ useStorageState.js      ← Storage state management
                 └─ mcpPermissions.js  ← MCP permissions
                      └─ Anthropic SDK
                           └─ PATCHED fetch()
                                ├─ /v1/messages → OpenAI provider
                                ├─ /v1/messages/count_tokens → Stub
                                ├─ /api/bootstrap/features → Stub
                                ├─ /api/oauth/profile → Stub
                                └─ All other URLs → Pass-through
```

---

## Provider Configuration API

### Configuration Object

```javascript
const config = {
  provider: 'gemini',        // Provider key from registry
  apiKey: 'YOUR_API_KEY',    // Provider API key
  baseURL: '',               // Optional: override preset URL
  defaultModel: '',          // Optional: override preset model
  modelMap: {},              // Optional: additional model mappings
  supportsVision: true,      // Optional: override capability
  supportsTools: true,       // Optional: override capability
  debug: false,              // Enable debug logging
  extraHeaders: {},          // Custom HTTP headers
};
```

### JavaScript API

```javascript
// Load configuration
const config = await UniversalProvider.loadConfig();

// Save configuration
await UniversalProvider.saveConfig({
  provider: 'deepseek',
  apiKey: 'sk-...'
});

// Get current provider info
const provider = UniversalProvider.getInstalledProvider();  // 'deepseek'
const model = UniversalProvider.getInstalledModel();        // 'deepseek-chat'

// Access provider registry
const geminiInfo = UniversalProvider.registry.gemini;
console.log(geminiInfo.supportsVision, geminiInfo.modelMap);
```

---

## Custom Provider Setup

For any OpenAI-compatible endpoint not in the registry:

1. Open the provider selector (`Ctrl+Shift+P`)
2. Select "Custom Endpoint" ⚙️
3. Enter:
   - **Base URL**: Your API endpoint (e.g., `https://api.mycorp.com/v1`)
   - **API Key**: Your authentication key
   - **Default Model**: The model name to use
   - **Model Map**: JSON mapping of Claude model names to your model names

Example model map:
```json
{
  "claude-sonnet-4-6": "my-model-v1",
  "claude-haiku-4-5": "my-model-fast"
}
```

---

## Local Deployment

### Ollama

1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull a model: `ollama pull llama3.2`
3. Start Ollama server: `ollama serve`
4. Select "Ollama (Local)" in the extension - no key needed

### LM Studio

1. Download LM Studio from [lmstudio.ai](https://lmstudio.ai)
2. Load a model and start the local server (default port 1234)
3. Select "LM Studio (Local)" in the extension - no key needed

---

## Troubleshooting

### Extension shows "No provider configured"

Press `Ctrl+Shift+P` to open the provider selector and configure an API key.

### API errors after switching providers

Check the browser console for `[UniversalProvider]` logs. Enable debug mode to see full request/response details.

### Model not found errors

The provider may not have the mapped model. Check the provider's documentation and update the model mapping in advanced settings.

### Tools not working

Verify the provider supports function calling. Some providers (DeepSeek, Groq, LM Studio) may have limited tool support.

### Vision not working

Verify the provider supports vision. Some providers (DeepSeek, Groq, LM Studio) don't support image inputs.

---

## Security Notes

- API keys are stored in `chrome.storage.local` (encrypted by Chrome)
- Keys are never sent to any server except the configured provider
- Dummy Anthropic API key is injected to bypass login without network calls
- All OAuth/MCP/analytics traffic passes through unmodified

---

## Files

| File | Purpose |
|------|---------|
| `inject-openai-provider.js` | Main adapter with UI, injected into sidepanel |
| `openai-compat-fetch.js` | Standalone ESM module for external use |
| `sidepanel.html` | Extension UI (modified to include adapter) |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` / `Cmd+Shift+P` | Open provider selector |
| `Ctrl+E` / `Cmd+E` | Toggle side panel (built-in) |
