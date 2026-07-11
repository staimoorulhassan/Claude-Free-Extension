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
  apiKey?: string;          // Optional (e.g., local Ollama needs no key)
  modelName: string;        // e.g., 'meta-llama/llama-3.3-70b-instruct:free'
  supportsNativeTools: boolean; // True for GPT-4o/Claude/Gemini, False for smaller free models
  contextWindow: number;    // Token limit for automatic sliding window pruning
}
```

**Credential Handling:** API keys must never be logged, exposed in error messages, or included in diagnostics. Keys are sent only to the configured provider endpoint via the `Authorization: Bearer <apiKey>` header (see `src/lib/openai-compat.ts` line 430).

## 2. The Tool Schema Polyfill Engine

Two-tier schema translator, selected per-provider via `supportsNativeTools`. Both tiers normalize to a single canonical contract: `{ name: string, arguments: Record<string, unknown>, tool_call_id: string }` for requests, and `{ tool_call_id: string, result: ContentBlock[], error?: string }` for responses.

- **Tier 1 (Native Function Calling):** for advanced models (Claude 3.5 Sonnet via bridge, Gemini 1.5 Pro, GPT-4o, Llama 3.3 70B), tools are injected directly into the API request's standard `tools` parameter array. Responses containing `tool_calls` (OpenAI format) are normalized into Anthropic `tool_use` blocks with preserved IDs and arguments.
- **Tier 2 (System Prompt XML Polyfill):** for smaller/free-tier models without native tool support (Mistral-7B, Phi-3, free OpenRouter endpoints), the router injects a strict behavioral protocol into the system prompt: reasoning inside `<thinking>` tags, tool calls inside `<tool_call>` XML tags containing a single JSON object:

```xml
<tool_call>
{"name": "click_element", "arguments": {"selector": "#submit-btn"}}
</tool_call>
```

  The response parser intercepts these XML blocks, parses the JSON, and validates each tool call before dispatching:
  1. **Tool Allowlist Check:** the tool `name` must be in the canonical tool set (currently `computer` only; see `01-agent-engine.spec.md` for the full action list).
  2. **Schema Validation:** required fields (e.g., `action` for `computer`) must be present and valid. Unknown tools, missing required fields, or invalid argument types (e.g., string where array expected) are rejected as recoverable errors—invalid calls must never reach the execution engine.
  3. After validation, the parsed tool call is normalized into the canonical `{ name, arguments, tool_call_id }` shape (generating a synthetic ID if none was provided).
  4. Execution results from the dispatcher are normalized back into the provider-specific response format (Anthropic `tool_result` blocks for Tier 1, or XML/JSON for Tier 2 if the model expects continuation in that format).

**Standardized Error Handling:** provider errors (4xx/5xx from `/chat/completions`), parse errors (malformed XML or JSON), and validation errors are all mapped to Anthropic-style error responses: `{ type: 'error', error: { type: 'api_error' | 'invalid_request_error', message: string } }`. IDs, arguments, results, and errors are preserved consistently across both request and response paths.

## Acceptance Criteria

- [ ] Switching `providerId`/`baseUrl`/`modelName` in config requires no changes to the agent loop or tool definitions.
- [ ] A native-tool-calling model (e.g. GPT-4o) routes tool calls through the standard `tools` request parameter — Tier 1 path exercised.
- [ ] A non-tool-calling free model (e.g. `google/gemma-2-9b-it:free`) successfully executes a `navigate` then `click_element` sequence via the Tier 2 XML polyfill.
- [ ] `<tool_call>` blocks are intercepted by the parser and never leak into the user-visible chat UI.
- [ ] **`<thinking>` Block Handling:** Currently (as of `src/lib/openai-compat.ts` lines 197, 229), `<thinking>` content is serialized as literal text `<thinking>...</thinking>` when crossing the provider adapter boundary (both Tier 1 native tool responses and Tier 2 XML responses). Target behavior: strip/remove `<thinking>` blocks before they reach the UI or are stored in conversation history, for both tiers. Test coverage should exist for both native and XML paths.
- [ ] **Conversation Pruning:** history is pruned via sliding window before exceeding `contextWindow` for the active model. The token budget must account for:
  - Tokenizer/provider overhead (e.g., message delimiters, role tags)
  - Reserved tokens for completion output (e.g., 4096 tokens reserved for assistant response)
  - Reserved tokens for tool-call bodies and results (varies by action; budget at least 2048 tokens)
  - The total request must remain within `contextWindow` after all reservations.

  Pruning must preserve:
  - System messages (always retained at the start of the conversation)
  - Paired assistant `tool_use` + user `tool_result` messages (never split a tool call from its result—prune both or neither)

  Malformed or non-JSON tool-call bodies are handled as recoverable errors: logged, replaced with a placeholder `tool_result` containing the error message, and the conversation continues.
- [ ] A malformed or non-JSON `<tool_call>` body is caught and surfaced as a recoverable parse error, not a silent failure or crash.

## Out of Scope
- Specific provider API key management/storage UI
- Cost/rate-limit tracking per provider

## Open Questions
- What is the fallback behavior if a Tier 2 model never emits a well-formed `<tool_call>` block after N turns — abort, retry with a stricter reminder, or hand off to `ask_user`?
- Should `supportsNativeTools` be auto-detected (probe request) or always manually configured per provider entry?
