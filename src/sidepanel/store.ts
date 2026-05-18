import { create } from 'zustand';
import type { AppSettings, Conversation, Message, ContentBlock, AnthropicMessage, AnthropicStreamEvent } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import { getSettings, saveSettings, getConversations, saveConversations, generateId, generateTitle } from '@/lib/storage';
import { createOpenAICompatibleFetch } from '@/lib/openai-compat';
import { getEnabledTools, executeTool } from '@/lib/tools';

interface Store {
  conversations: Conversation[];
  activeConversationId: string | null;
  settings: AppSettings;
  isStreaming: boolean;
  showSettings: boolean;
  showHistory: boolean;
  abortController: AbortController | null;
  error: string | null;

  init: () => Promise<void>;
  newConversation: () => void;
  setActiveConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  sendMessage: (userContent: ContentBlock[]) => Promise<void>;
  stopGeneration: () => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setShowSettings: (v: boolean) => void;
  setShowHistory: (v: boolean) => void;
  clearError: () => void;
}

function activeConversation(get: () => Store): Conversation | undefined {
  const { conversations, activeConversationId } = get();
  return conversations.find(c => c.id === activeConversationId);
}

function patchConversation(
  conversations: Conversation[],
  id: string,
  patch: (c: Conversation) => Conversation,
): Conversation[] {
  return conversations.map(c => (c.id === id ? patch(c) : c));
}

function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  return messages.map(m => ({ role: m.role, content: m.content }));
}

// ── Context compression ────────────────────────────────────────────────────────
// Screenshots are base64 PNGs (~50-200 KB each as text). Sending 3+ in history
// easily pushes past any provider's token limit and causes 400 errors.
// This runs before every API call — it never touches the stored conversation.

const CTX_MAX_MESSAGES = 30;       // sliding window (15 user+assistant pairs)
const CTX_MAX_SCREENSHOTS = 2;     // only last 2 screenshots kept verbatim
const CTX_MAX_TEXT_CHARS = 6000;   // truncate long read_page / tool results

function truncateText(text: string): string {
  return text.length > CTX_MAX_TEXT_CHARS
    ? text.slice(0, CTX_MAX_TEXT_CHARS) + '\n…[truncated to save context]'
    : text;
}

function compressBlock(block: ContentBlock, keepImage: boolean): ContentBlock {
  if (block.type !== 'tool_result') return block;

  // String content — just truncate
  if (typeof block.content === 'string') {
    return { ...block, content: truncateText(block.content) };
  }

  if (!Array.isArray(block.content)) return block;

  const hasImage = block.content.some(b => b.type === 'image');

  if (hasImage && !keepImage) {
    // Drop the screenshot, keep any text parts
    const textParts = block.content.filter(b => b.type === 'text');
    return {
      ...block,
      content: textParts.length > 0
        ? textParts.map(b => b.type === 'text' ? { ...b, text: truncateText(b.text) } : b)
        : [{ type: 'text' as const, text: '[screenshot removed — keeping only last 2 in context]' }],
    };
  }

  // Keep image but truncate any text siblings
  return {
    ...block,
    content: block.content.map(b =>
      b.type === 'text' ? { ...b, text: truncateText(b.text) } : b
    ),
  };
}

function compressForApi(messages: AnthropicMessage[]): AnthropicMessage[] {
  // 1. Sliding window — oldest messages dropped first
  const windowed = messages.length > CTX_MAX_MESSAGES
    ? messages.slice(-CTX_MAX_MESSAGES)
    : messages;

  // 2. Walk newest→oldest, counting screenshots; strip images beyond the limit
  let screenshots = 0;
  const result = [...windowed].reverse().map(msg => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;

    const newContent = (msg.content as ContentBlock[]).map(block => {
      if (block.type !== 'tool_result') return block;
      const hasImg = Array.isArray(block.content) && block.content.some(b => b.type === 'image');
      if (hasImg) screenshots++;
      return compressBlock(block, hasImg && screenshots <= CTX_MAX_SCREENSHOTS);
    });

    return { ...msg, content: newContent };
  });

  return result.reverse();
}

async function* streamMessages(
  body: Record<string, unknown>,
  customFetch: typeof fetch,
  signal: AbortSignal,
): AsyncGenerator<AnthropicStreamEvent> {
  const resp = await customFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'sk-ant-compat',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }

  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const raw = t.slice(5).trim();
      try { yield JSON.parse(raw) as AnthropicStreamEvent; } catch { /* skip */ }
    }
  }
}

async function* streamWithRetry(
  body: Record<string, unknown>,
  customFetch: typeof fetch,
  signal: AbortSignal,
): AsyncGenerator<AnthropicStreamEvent> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    try {
      for await (const ev of streamMessages(body, customFetch, signal)) yield ev;
      return;
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') throw e;
      if (attempt === maxAttempts - 1) throw e;
      const msg = err.message;
      const retryable = msg.includes('400') || msg.includes('429') || msg.includes('500') || msg.includes('503') || msg.includes('Provider');
      if (!retryable) throw e;
    }
  }
}

export const useStore = create<Store>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  settings: DEFAULT_SETTINGS,
  isStreaming: false,
  showSettings: false,
  showHistory: false,
  abortController: null,
  error: null,

  init: async () => {
    const [settings, conversations] = await Promise.all([getSettings(), getConversations()]);
    set({ settings, conversations });
    // Listen for stop requests from the in-page "Stop Claude" button
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'STOP_GENERATION') get().stopGeneration();
    });
  },

  newConversation: () => {
    const id = generateId();
    const conv: Conversation = { id, title: 'New conversation', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    const conversations = [conv, ...get().conversations];
    set({ conversations, activeConversationId: id });
    saveConversations(conversations);
  },

  setActiveConversation: (id) => set({ activeConversationId: id, showHistory: false }),

  deleteConversation: (id) => {
    const conversations = get().conversations.filter(c => c.id !== id);
    const activeId = get().activeConversationId === id ? (conversations[0]?.id ?? null) : get().activeConversationId;
    set({ conversations, activeConversationId: activeId });
    saveConversations(conversations);
  },

  stopGeneration: () => {
    get().abortController?.abort();
    set({ isStreaming: false, abortController: null });
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch, provider: { ...get().settings.provider, ...(patch.provider ?? {}) } };
    set({ settings });
    await saveSettings(settings);
  },

  setShowSettings: (v) => set({ showSettings: v }),
  setShowHistory: (v) => set({ showHistory: v }),
  clearError: () => set({ error: null }),

  sendMessage: async (userContent: ContentBlock[]) => {
    const { settings } = get();

    if (!get().activeConversationId) get().newConversation();
    const convId = get().activeConversationId!;

    // Add the user message first, before the loop
    const userMessage: Message = { id: generateId(), role: 'user', content: userContent, timestamp: Date.now() };
    const firstText = (userContent.find(b => b.type === 'text') as { text?: string } | undefined)?.text ?? '';

    set(s => ({
      conversations: patchConversation(s.conversations, convId, c => ({
        ...c,
        messages: [...c.messages, userMessage],
        title: c.messages.length === 0 ? generateTitle(firstText || 'New conversation') : c.title,
        updatedAt: Date.now(),
      })),
    }));

    const abortController = new AbortController();
    set({ isStreaming: true, abortController, error: null });

    const customFetch = createOpenAICompatibleFetch(settings.provider);
    const tools = getEnabledTools(settings.computerUseEnabled);

    if (settings.computerUseEnabled) {
      chrome.runtime.sendMessage({ type: 'AGENT_STARTED' }).catch(() => {});
    }

    try {
      // Agent loop — each iteration gets its own unique assistantId
      while (true) {
        // Fresh ID for THIS turn's assistant message
        const assistantId = generateId();

        // Add empty placeholder for the current turn
        set(s => ({
          conversations: patchConversation(s.conversations, convId, c => ({
            ...c,
            messages: [...c.messages, { id: assistantId, role: 'assistant' as const, content: [], timestamp: Date.now() }],
          })),
        }));

        // Build history excluding the placeholder we just added,
        // then compress (drop old screenshots, truncate big tool results, sliding window)
        const historyMessages = compressForApi(
          toAnthropicMessages(activeConversation(get)?.messages.slice(0, -1) ?? []),
        );

        const body: Record<string, unknown> = {
          model: settings.provider.defaultModel ?? 'claude-opus-4-7',
          max_tokens: settings.maxTokens,
          messages: historyMessages,
        };
        const effectiveSystem = settings.computerUseEnabled
          ? [
              'You are an AI browser automation agent with FULL CONTROL of the user\'s active browser tab.',
              'You have a `computer` tool. USE IT for every web task. Never say you cannot access the browser.',
              '',
              'WORKFLOW for any request involving websites:',
              '1. action="navigate", url="https://..." to go to a URL (NEVER click the address bar)',
              '2. action="screenshot" to see the current page',
              '3. action="read_page" to get labelled elements (e.g. button "Search" [ref_4])',
              '4. action="click_element", ref_id="ref_4" OR action="left_click", coordinate=[x,y]',
              '5. action="type", text="..." to type into the focused field',
              '6. action="key", text="Return" to submit',
              '7. action="screenshot" again to verify the result',
              '',
              'ALWAYS start browser tasks immediately — do not ask for permission or clarification.',
              settings.systemPrompt ? `\nAdditional instructions:\n${settings.systemPrompt}` : '',
            ].join('\n').trim()
          : settings.systemPrompt;
        if (effectiveSystem) body['system'] = effectiveSystem;
        if (tools.length > 0) body['tools'] = tools;

        // Stream response
        let textBuf = '';
        const finishedBlocks: ContentBlock[] = [];
        let currentToolInput = '';
        let currentToolBlock: ContentBlock | null = null;
        let stopReason = 'end_turn';

        for await (const event of streamWithRetry(body, customFetch, abortController.signal)) {
          if (event.type === 'content_block_start') {
            const cb = event.content_block;
            if (cb.type === 'text') {
              textBuf = '';
            } else if (cb.type === 'tool_use') {
              currentToolBlock = { ...cb } as ContentBlock;
              currentToolInput = '';
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              textBuf += event.delta.text;
              // Update ONLY this iteration's assistant message (unique assistantId)
              set(s => ({
                conversations: patchConversation(s.conversations, convId, c => ({
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === assistantId
                      ? { ...m, content: [...finishedBlocks, { type: 'text' as const, text: textBuf }] }
                      : m,
                  ),
                })),
              }));
            } else if (event.delta.type === 'input_json_delta') {
              currentToolInput += event.delta.partial_json;
            }
          } else if (event.type === 'content_block_stop') {
            if (textBuf) {
              finishedBlocks.push({ type: 'text', text: textBuf });
              textBuf = '';
            } else if (currentToolBlock?.type === 'tool_use') {
              try {
                (currentToolBlock as Record<string, unknown>)['input'] = JSON.parse(currentToolInput || '{}');
              } catch {
                (currentToolBlock as Record<string, unknown>)['input'] = {};
              }
              finishedBlocks.push(currentToolBlock);
              currentToolBlock = null;
              currentToolInput = '';
            }
          } else if (event.type === 'message_delta') {
            stopReason = event.delta.stop_reason;
          } else if (event.type === 'error') {
            throw new Error(event.error.message);
          }
        }

        // Finalize this iteration's assistant message
        set(s => ({
          conversations: patchConversation(s.conversations, convId, c => ({
            ...c,
            messages: c.messages.map(m => m.id === assistantId ? { ...m, content: finishedBlocks } : m),
            updatedAt: Date.now(),
          })),
        }));

        if (stopReason !== 'tool_use') break;

        const toolUseBlocks = finishedBlocks.filter(b => b.type === 'tool_use') as import('@/lib/types').ToolUseBlock[];
        if (!toolUseBlocks.length) break;

        // Execute tool calls
        const toolResults: ContentBlock[] = [];
        for (const block of toolUseBlocks) {
          try {
            const resultContent = await executeTool(block);
            // Truncate oversized text results (e.g. huge accessibility trees) at the source
            const trimmed = resultContent.map(b =>
              b.type === 'text' && b.text.length > CTX_MAX_TEXT_CHARS
                ? { ...b, text: truncateText(b.text) }
                : b
            );
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: trimmed });
          } catch (e) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${(e as Error).message}`, is_error: true });
          }
        }

        // Add tool results — next loop iteration will add its own fresh assistant placeholder
        set(s => ({
          conversations: patchConversation(s.conversations, convId, c => ({
            ...c,
            messages: [...c.messages, { id: generateId(), role: 'user' as const, content: toolResults, timestamp: Date.now() }],
            updatedAt: Date.now(),
          })),
        }));
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        const raw = (e as Error).message;
        let display = raw;
        if (raw.includes('400') || raw.includes('Bad Request') || raw.includes('Provider returned error')) {
          display = 'Provider returned a 400 error. The model may not support tool use or the conversation is too long. Starting a new chat usually fixes this. You can also switch to Gemini or DeepSeek in Settings for more reliable tool support.';
        } else if (raw.includes('429')) {
          display = 'Rate limit reached. Wait a moment then try again, or switch to a different provider in Settings.';
        } else if (raw.includes('401') || raw.includes('Unauthorized') || raw.includes('Invalid API key')) {
          display = 'Invalid API key. Check your key in Settings.';
        }
        set({ error: display });
      }
    } finally {
      set({ isStreaming: false, abortController: null });
      saveConversations(get().conversations);
      if (settings.computerUseEnabled) {
        chrome.runtime.sendMessage({ type: 'AGENT_STOPPED' }).catch(() => {});
      }
    }
  },
}));
