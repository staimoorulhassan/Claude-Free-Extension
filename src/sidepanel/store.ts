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

        // Build history excluding the placeholder we just added
        const historyMessages = toAnthropicMessages(
          activeConversation(get)?.messages.slice(0, -1) ?? [],
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

        for await (const event of streamMessages(body, customFetch, abortController.signal)) {
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
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultContent });
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
        set({ error: `Error: ${(e as Error).message}` });
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
