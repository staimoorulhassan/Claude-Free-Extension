# 04 — Multi-Provider Router: Universal 50+ LLM Routing

## Status
Draft

## Summary
Keep the extension provider-agnostic — free and flexible AI without locking users into a single paid vendor — by giving every configured LLM endpoint (OpenRouter, Groq, Together AI, local Ollama, Gemini, OpenAI, DeepSeek, custom) a uniform agentic tool-calling contract, regardless of whether the underlying model natively supports function calling.

## 1. Unified Router Contract

```typescript
interface ModelProviderConfig {
  providerId: string;       // e.g., 'openrouter', 'groq', 'ollama', 'custom'
  baseUrl: string;          // e.g., 'https://openrouter.ai/api/v1'
  apiKey: string;           // Optional for local Ollama
  modelName: string;        // e.g., 'meta-llama/llama-3.3-70b-instruct:free'
  supportsNativeTools: boolean; // True for GPT-4o/Claude/Gemini, False for smaller free models
  contextWindow: number;    // Token limit for automatic sliding window pruning
}
```

## 2. The Tool Schema Polyfill Engine

Two-tier schema translator, selected per-provider via `supportsNativeTools`:

- **Tier 1 (Native Function Calling):** for advanced models (Claude 3.5 Sonnet via bridge, Gemini 1.5 Pro, GPT-4o, Llama 3.3 70B), tools are injected directly into the API request's standard `tools` parameter array.
- **Tier 2 (System Prompt XML Polyfill):** for smaller/free-tier models without native tool support (Mistral-7B, Phi-3, free OpenRouter endpoints), the router injects a strict behavioral protocol into the system prompt: reasoning inside `<thinking>` tags, tool calls inside `<tool_call>` XML tags containing a single JSON object:

```xml
<tool_call>
{"name": "click_element", "arguments": {"selector": "#submit-btn"}}
</tool_call>
```

  The response parser intercepts these XML blocks, strips them from the chat UI, and routes the parsed JSON into the execution engine defined in `01-agent-engine.spec.md`.

## Acceptance Criteria

- [ ] Switching `providerId`/`baseUrl`/`modelName` in config requires no changes to the agent loop or tool definitions.
- [ ] A native-tool-calling model (e.g. GPT-4o) routes tool calls through the standard `tools` request parameter — Tier 1 path exercised.
- [ ] A non-tool-calling free model (e.g. `google/gemma-2-9b-it:free`) successfully executes a `navigate` then `click_element` sequence via the Tier 2 XML polyfill.
- [ ] `<thinking>` and `<tool_call>` blocks never leak into the user-visible chat UI.
- [ ] Conversation history is pruned via sliding window before exceeding `contextWindow` for the active model.
- [ ] A malformed or non-JSON `<tool_call>` body is caught and surfaced as a recoverable parse error, not a silent failure or crash.

## Out of Scope
- Specific provider API key management/storage UI
- Cost/rate-limit tracking per provider

## Open Questions
- What is the fallback behavior if a Tier 2 model never emits a well-formed `<tool_call>` block after N turns — abort, retry with a stricter reminder, or hand off to `ask_user`?
- Should `supportsNativeTools` be auto-detected (probe request) or always manually configured per provider entry?
