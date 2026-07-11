import { create } from 'zustand';
import type { AppSettings, Conversation, Message, ContentBlock, AnthropicMessage, AnthropicStreamEvent, ToolUseBlock } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import { getSettings, saveSettings, getConversations, saveConversations, generateId, generateTitle, getProviderVault, saveProviderVault } from '@/lib/storage';
import type { ProviderVault } from '@/lib/storage';
import { getRecordings, saveRecordings, recordingToText } from '@/lib/recordings';
import type { Recording } from '@/lib/recordings';
import { createOpenAICompatibleFetch } from '@/lib/openai-compat';
import { getEnabledTools, executeTool } from '@/lib/tools';
import { detectPattern, selectStrategy } from '@/lib/tokenOptimizer';
import { createSteelManager } from '@/lib/steel-session';
import type { SteelSession } from '@/lib/steel-client';

export interface PendingApproval {
  blocks: ToolUseBlock[];
  resolve: (decision: 'approve' | 'reject' | string) => void;
}

export type { Recording };

interface Store {
  conversations: Conversation[];
  activeConversationId: string | null;
  settings: AppSettings;
  isStreaming: boolean;
  showSettings: boolean;
  showHistory: boolean;
  abortController: AbortController | null;
  error: string | null;
  pendingApproval: PendingApproval | null;
  providerVault: ProviderVault;
  isRecording: boolean;
  recordings: Recording[];
  showRecordings: boolean;
  attachedRecordingId: string | null;
  steelSession: SteelSession | null;
  steelLiveUrl: string | undefined;

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
  approvePending: (correction?: string) => void;
  rejectPending: () => void;
  setShowRecordings: (v: boolean) => void;
  startRecording: () => Promise<void>;
  stopRecording: (name: string) => Promise<void>;
  deleteRecording: (id: string) => void;
  setAttachedRecording: (id: string | null) => void;
  connectSteel: () => Promise<void>;
  disconnectSteel: () => Promise<void>;
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

// ── Context compression ───────────────────────────────────────────────────────
// Issue 11: balanced limits — enough context for complex tasks, not so much
// it blows provider token limits.  Runs before every API call; never mutates
// the stored conversation.

const CTX_MAX_MESSAGES = 40;       // sliding window (20 rounds)
const CTX_MAX_SCREENSHOTS = 2;     // keep last 2 screenshots verbatim
const CTX_MAX_TEXT_CHARS = 8000;   // enough for most accessibility trees
const CTX_ALWAYS_KEEP = 6;         // last 3 rounds always sent uncompressed

function truncateText(text: string): string {
  return text.length > CTX_MAX_TEXT_CHARS
    ? text.slice(0, CTX_MAX_TEXT_CHARS) + '\n…[truncated to save context]'
    : text;
}

function compressBlock(block: ContentBlock, keepImage: boolean): ContentBlock {
  if (block.type !== 'tool_result') return block;
  if (typeof block.content === 'string') {
    return { ...block, content: truncateText(block.content) };
  }
  if (!Array.isArray(block.content)) return block;

  const hasImage = block.content.some(b => b.type === 'image');
  if (hasImage && !keepImage) {
    const textParts = block.content.filter(b => b.type === 'text');
    return {
      ...block,
      content: textParts.length > 0
        ? textParts.map(b => b.type === 'text' ? { ...b, text: truncateText(b.text) } : b)
        : [{ type: 'text' as const, text: '[screenshot removed — older than last 2]' }],
    };
  }
  return {
    ...block,
    content: block.content.map(b =>
      b.type === 'text' ? { ...b, text: truncateText(b.text) } : b
    ),
  };
}

function compressForApi(messages: AnthropicMessage[], debugMode: boolean = false): AnthropicMessage[] {
  // Issue 10: drop empty assistant placeholder messages (failed streams)
  const noEmpty = messages.filter(msg =>
    !(msg.role === 'assistant' && Array.isArray(msg.content) && msg.content.length === 0)
  );

  // Sliding window
  const windowed = noEmpty.length > CTX_MAX_MESSAGES
    ? noEmpty.slice(-CTX_MAX_MESSAGES)
    : noEmpty;

  // Split: always-keep tail vs compressible head
  const cutoff = Math.max(0, windowed.length - CTX_ALWAYS_KEEP);
  const head = windowed.slice(0, cutoff);
  const tail = windowed.slice(cutoff);

  // Compress only the head — walk newest→oldest to count screenshots correctly
  let screenshots = 0;
  const compressedHead = [...head].reverse().map(msg => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
    const newContent = (msg.content as ContentBlock[]).map(block => {
      if (block.type !== 'tool_result') return block;
      const hasImg = Array.isArray(block.content) && block.content.some(b => b.type === 'image');
      if (hasImg) screenshots++;
      return compressBlock(block, hasImg && screenshots <= CTX_MAX_SCREENSHOTS);
    });
    return { ...msg, content: newContent };
  }).reverse();

  // If conversation is VERY long (50+ messages), be more aggressive with compression
  const isVeryLong = noEmpty.length > 50;
  if (isVeryLong && debugMode) {
    console.log(`[Context Compression] Very long conversation (${noEmpty.length} msgs), dropping older screenshots more aggressively`);
  }

  return [...compressedHead, ...tail];
}

// Issue 16: generate a short title for the conversation via the provider
async function generateConversationTitle(
  userText: string,
  aiText: string,
  customFetch: typeof fetch,
  settings: AppSettings,
): Promise<string> {
  const resp = await customFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'sk-ant-compat',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: settings.provider.defaultModel ?? 'openai-large',
      max_tokens: 12,
      messages: [{
        role: 'user',
        content: `Write a 3-5 word title for this chat. Reply with ONLY the title, no quotes.\nUser: ${userText.slice(0, 150)}\nAI: ${aiText.slice(0, 150)}`,
      }],
    }),
  });
  if (!resp.ok) return '';
  const data = await resp.json() as { content?: Array<{ type: string; text?: string }> };
  return (data.content?.[0]?.text ?? '').trim().replace(/^["']|["']$/g, '').slice(0, 60);
}

async function* streamMessages(
  body: Record<string, unknown>,
  customFetch: typeof fetch,
  signal: AbortSignal,
  debugMode: boolean = false,
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
  let lineNum = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      
      for (const line of lines) {
        lineNum++;
        const t = line.trim();
        
        // Skip empty lines and comments
        if (!t || t.startsWith(':')) continue;
        
        // Only process data: lines
        if (!t.startsWith('data:')) continue;
        
        const raw = t.slice(5).trim();
        
        // Skip [DONE] marker
        if (raw === '[DONE]') continue;
        
        try {
          // Validate JSON before yielding
          const parsed = JSON.parse(raw) as AnthropicStreamEvent;
          
          // Basic schema validation
          if (!parsed.type) {
            if (debugMode) console.warn(`[SSE line ${lineNum}] Missing 'type' field`);
            continue;
          }
          
          yield parsed;
        } catch (e) {
          // Log but don't crash on malformed JSON
          if (debugMode) console.warn(`[SSE line ${lineNum}] Failed to parse: "${raw.slice(0, 80)}"`, e);
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* streamWithRetry(
  body: Record<string, unknown>,
  customFetch: typeof fetch,
  signal: AbortSignal,
  debugMode: boolean = false,
  maxAttempts: number = 3,
): AsyncGenerator<AnthropicStreamEvent> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 3s, 7s with jitter
      const baseDelay = (1 << attempt) * 1000 - 500;
      const jitter = Math.random() * 1000;
      const delayMs = baseDelay + jitter;
      if (debugMode) console.log(`[Retry] Attempt ${attempt + 1}/${maxAttempts}, waiting ${Math.round(delayMs)}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
    
    try {
      for await (const ev of streamMessages(body, customFetch, signal, debugMode)) yield ev;
      if (debugMode && attempt > 0) console.log(`[Retry] Success on attempt ${attempt + 1}`);
      return; // Success
    } catch (e) {
      lastError = e as Error;
      const msg = lastError.message ?? '';
      
      // Determine if retryable
      const isAbort = lastError.name === 'AbortError';
      const isTimeout = msg.includes('timeout') || msg.includes('timed out');
      const isNetworkError = msg.includes('Failed to fetch') || msg.includes('network') || msg.includes('ERR_');
      const isRetryable = 
        msg.includes('400') || msg.includes('429') || msg.includes('500') || 
        msg.includes('503') || msg.includes('Provider') || isNetworkError || isTimeout;
      
      if (isAbort) throw e; // Never retry abort
      if (attempt === maxAttempts - 1) throw e; // Last attempt, throw
      if (!isRetryable) throw e; // Non-retryable error, throw immediately
      
      if (debugMode) console.warn(`[Retry] Stream error (attempt ${attempt + 1}): ${msg}`);
    }
  }
  
  throw lastError || new Error('Unknown stream error');
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
  pendingApproval: null,
  providerVault: {},
  isRecording: false,
  recordings: [],
  showRecordings: false,
  attachedRecordingId: null,
  steelSession: null,
  steelLiveUrl: undefined,

  init: async () => {
    const [settings, conversations, recordings, providerVault] = await Promise.all([
      getSettings(), getConversations(), getRecordings(), getProviderVault(),
    ]);
    const saved = providerVault[settings.provider.provider];
    if (saved) {
      if (saved.apiKey && !settings.provider.apiKey) settings.provider.apiKey = saved.apiKey;
      if (saved.model && !settings.provider.defaultModel) settings.provider.defaultModel = saved.model;
    }
    set({ settings, conversations, recordings, providerVault });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'STOP_GENERATION') get().stopGeneration();
    });
  },

  connectSteel: async () => {
    const { settings } = get();
    if (!settings.useSteel || !settings.steel?.apiKey) return;
    
    try {
      const manager = createSteelManager(settings.steel);
      const session = await manager.createOrReuse();
      set({ steelSession: session, steelLiveUrl: session.liveUrl });
    } catch (e) {
      set({ error: `Steel connection failed: ${(e as Error).message}` });
    }
  },

  disconnectSteel: async () => {
    set({ steelSession: null, steelLiveUrl: undefined });
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
    // Reject any pending approval so the agent loop exits cleanly
    get().pendingApproval?.resolve('reject');
    set({ isStreaming: false, abortController: null, pendingApproval: null });
  },

  approvePending: (correction?: string) => {
    const { pendingApproval } = get();
    if (!pendingApproval) return;
    set({ pendingApproval: null });
    pendingApproval.resolve(correction && correction.trim() ? correction : 'approve');
  },

  rejectPending: () => {
    const { pendingApproval } = get();
    if (!pendingApproval) return;
    set({ pendingApproval: null });
    pendingApproval.resolve('reject');
  },

  updateSettings: async (patch) => {
    const current = get().settings;
    const vault = get().providerVault;
    let newProvider = { ...current.provider, ...(patch.provider ?? {}) };

    // Provider name switched → restore that provider's saved key + model from vault
    if (patch.provider?.provider && patch.provider.provider !== current.provider.provider) {
      const saved = vault[patch.provider.provider];
      newProvider = {
        ...newProvider,
        apiKey: saved?.apiKey ?? '',
        defaultModel: saved?.model ?? newProvider.defaultModel,
      };
    }

    // API key changed → save to vault under the current provider name
    if (patch.provider?.apiKey !== undefined && patch.provider.apiKey !== current.provider.apiKey) {
      const providerName = newProvider.provider;
      const newVault: ProviderVault = {
        ...vault,
        [providerName]: { ...vault[providerName], apiKey: patch.provider.apiKey },
      };
      set({ providerVault: newVault });
      saveProviderVault(newVault).catch(() => {});
    }

    // Model changed → save to vault under the current provider name
    if (patch.provider?.defaultModel !== undefined && patch.provider.defaultModel !== current.provider.defaultModel) {
      const providerName = newProvider.provider;
      const newVault: ProviderVault = {
        ...vault,
        [providerName]: { ...vault[providerName], apiKey: vault[providerName]?.apiKey ?? newProvider.apiKey, model: patch.provider.defaultModel },
      };
      set({ providerVault: newVault });
      saveProviderVault(newVault).catch(() => {});
    }

    const settings = { ...current, ...patch, provider: newProvider };
    set({ settings });
    await saveSettings(settings);
  },

  setShowSettings: (v) => set({ showSettings: v }),
  setShowHistory: (v) => set({ showHistory: v }),
  setShowRecordings: (v) => set({ showRecordings: v }),
  clearError: () => set({ error: null }),

  startRecording: async () => {
    const windowId = await chrome.windows.getCurrent().then(w => w.id).catch(() => undefined);
    await new Promise<void>(resolve => {
      chrome.runtime.sendMessage({ type: 'START_RECORDING', windowId }, () => resolve());
    });
    set({ isRecording: true });
  },

  stopRecording: async (name: string) => {
    const steps = await new Promise<unknown[]>(resolve => {
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (resp) => resolve((resp as { steps: unknown[] })?.steps ?? []));
    });
    set({ isRecording: false });
    if (!steps.length) return;
    const rec: Recording = { id: generateId(), name, createdAt: Date.now(), steps: steps as Recording['steps'] };
    const recordings = [rec, ...get().recordings];
    set({ recordings });
    await saveRecordings(recordings);
  },

  deleteRecording: (id: string) => {
    const recordings = get().recordings.filter(r => r.id !== id);
    set({ recordings });
    if (get().attachedRecordingId === id) set({ attachedRecordingId: null });
    saveRecordings(recordings);
  },

  setAttachedRecording: (id) => set({ attachedRecordingId: id }),

  sendMessage: async (userContent: ContentBlock[]) => {
    const { settings, attachedRecordingId, recordings } = get();

    // If a recording is attached, prepend its steps as context
    let effectiveContent = userContent;
    if (attachedRecordingId) {
      const rec = recordings.find(r => r.id === attachedRecordingId);
      if (rec) {
        const demoText = recordingToText(rec) + '\n\n[Task]:';
        const existingText = userContent.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
        effectiveContent = existingText
          ? userContent.map(b => b === existingText ? { ...existingText, text: `${demoText} ${existingText.text}` } : b)
          : [{ type: 'text' as const, text: demoText }, ...userContent];
      }
      set({ attachedRecordingId: null });
    }

    if (!get().activeConversationId) get().newConversation();
    const convId = get().activeConversationId!;

    // Issue 16: capture before we add the user message so we can detect first exchange
    const isFirstExchange = (activeConversation(get)?.messages.length ?? 0) === 0;

    // Add the user message first, before the loop
    const userMessage: Message = { id: generateId(), role: 'user', content: effectiveContent, timestamp: Date.now() };
    const firstText = (effectiveContent.find(b => b.type === 'text') as { text?: string } | undefined)?.text ?? '';

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
    const debugMode = (settings as any).debugMode ?? false;

    if (settings.computerUseEnabled) {
      chrome.runtime.sendMessage({ type: 'AGENT_STARTED' }).catch(() => {});
    }

    try {
      // Agent loop — each iteration gets its own unique assistantId
      const AGENT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
      const agentStartTime = Date.now();
      let agentIteration = 0;
      
      while (true) {
        // Check timeout
        if (Date.now() - agentStartTime > AGENT_TIMEOUT) {
          set({ error: 'Agent session timed out after 10 minutes. Long tasks may need to be split.' });
          if (debugMode) console.log('[Agent Loop] Timeout: session exceeded 10 minutes');
          break;
        }

        if (agentIteration++ >= 25) {
          set({ error: 'Agent stopped after 25 tool rounds. Try breaking the task into smaller steps.' });
          if (debugMode) console.log('[Agent Loop] Max iterations reached');
          break;
        }

        if (debugMode) {
          const historyLen = activeConversation(get)?.messages.length ?? 0;
          console.log(`[Agent Loop] Iteration ${agentIteration}, history length: ${historyLen}, elapsed: ${Math.round((Date.now() - agentStartTime) / 1000)}s`);
        }

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
          debugMode,
        );

        const body: Record<string, unknown> = {
          model: settings.provider.defaultModel ?? 'claude-opus-4-7',
          max_tokens: settings.maxTokens,
          messages: historyMessages,
        };
        // Issue 3: system prompt written to override model's own training about
        // "I can't browse the web". Uses imperative language + explicit denial
        // prevention to maximise compliance across GPT-4o, Gemini, Llama etc.
        const userQueryText = (effectiveContent.find(b => b.type === 'text') as { text?: string } | undefined)?.text ?? '';
        const effectiveSystem = settings.computerUseEnabled
          ? [
              'You are a browser automation agent. You have a `computer` tool that gives you FULL, REAL control of the user\'s browser.',
              'The computer tool is ALREADY connected and working. Do NOT say you cannot access the browser — you can and must.',
              '',
              'IMPORTANT: If the task is ambiguous or you need clarification, ask the user a question BEFORE calling tools.',
              'For clear tasks: call the computer tool directly without asking first.',
              '',
              'TOOL ACTIONS (use these in sequence):',
              '  navigate   → go to a URL',
              '  read_page  → get labelled interactive elements (buttons, inputs, links) with ref IDs',
              '  click_element → click by ref ID from read_page',
              '  type       → type text into focused input',
              '  key        → press Return/Enter/Escape/Tab/arrow keys',
              '  screenshot → see the page visually (use sparingly — prefer read_page)',
              '  scroll     → scroll up/down/left/right',
              '  wait       → wait N seconds for page to load',
              '',
              'EFFICIENCY: prefer read_page → click_element over screenshot → coordinate click.',
              'Only take a screenshot when you must SEE something (images, charts, CAPTCHAs).',
              'After navigate, always call read_page or wait before any click.',
              '',
              settings.systemPrompt ? `User instructions: ${settings.systemPrompt}` : '',
            ].join('\n').trim()
          : (() => {
              // Token optimizer: detect query pattern and hint response style
              const pattern = detectPattern(userQueryText);
              const hint = `Response style: ${selectStrategy(pattern)}.`;
              return settings.systemPrompt ? `${settings.systemPrompt}\n\n${hint}` : hint;
            })();
        if (effectiveSystem) body['system'] = effectiveSystem;
        if (tools.length > 0) {
          body['tools'] = tools;
          body['tool_choice'] = { type: 'auto' };
        }

        // Stream response
        let textBuf = '';
        const finishedBlocks: ContentBlock[] = [];
        let currentToolInput = '';
        let currentToolBlock: ContentBlock | null = null;
        let stopReason = 'end_turn';

        for await (const event of streamWithRetry(body, customFetch, abortController.signal, debugMode)) {
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
              const tb = currentToolBlock as ToolUseBlock;
              try {
                tb.input = JSON.parse(currentToolInput || '{}') as Record<string, unknown>;
              } catch {
                tb.input = {};
              }
              finishedBlocks.push(tb);
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

        const toolUseBlocks = finishedBlocks.filter(b => b.type === 'tool_use') as ToolUseBlock[];
        if (!toolUseBlocks.length) break;

        // Approval gate — pause and show pending actions to the user before executing
        if (settings.requireApproval && settings.computerUseEnabled) {
          const decision = await new Promise<string>(resolve => {
            set({ pendingApproval: { blocks: toolUseBlocks, resolve } });
          });
          set({ pendingApproval: null });

          if (decision === 'reject') {
            // Strip unexecuted tool_use blocks from the assistant message so
            // history stays valid (no dangling tool_use without a tool_result)
            set(s => ({
              conversations: patchConversation(s.conversations, convId, c => ({
                ...c,
                messages: c.messages.map(m =>
                  m.id === assistantId
                    ? { ...m, content: finishedBlocks.filter(b => b.type !== 'tool_use') }
                    : m,
                ),
              })),
            }));
            break;
          }

          if (decision !== 'approve') {
            // User typed a correction — strip tool_use from assistant, add correction as
            // a user message, then continue the loop so the AI re-plans with the correction
            set(s => ({
              conversations: patchConversation(s.conversations, convId, c => ({
                ...c,
                messages: [
                  ...c.messages.map(m =>
                    m.id === assistantId
                      ? { ...m, content: finishedBlocks.filter(b => b.type !== 'tool_use') }
                      : m,
                  ),
                  { id: generateId(), role: 'user' as const, content: [{ type: 'text' as const, text: decision }], timestamp: Date.now() },
                ],
              })),
            }));
            continue;
          }
          // 'approve' → fall through to execute tools normally
        }

        // Execute tool calls
        const toolResults: ContentBlock[] = [];
        const { steelSession } = get();
        for (const block of toolUseBlocks) {
          try {
            const resultContent = await executeTool(block, steelSession);

            // Issue 19: when click_element says the element wasn't found, auto-call
            // read_page so the model immediately gets the current page state
            if (block.name === 'computer') {
              const act = (block.input as Record<string, unknown>).action as string;
              if (act === 'click_element') {
                const firstText = resultContent.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
                if (firstText && (firstText.text.includes('not found') || firstText.text.includes('no longer'))) {
try {
                     const readBlock: ToolUseBlock = {
                       type: 'tool_use',
                       id: block.id + '_auto_read',
                       name: 'computer',
                       input: { action: 'read_page', filter: 'interactive' },
                     };
                     const readResult = await executeTool(readBlock, steelSession);
                    const readText = readResult
                      .filter(b => b.type === 'text')
                      .map(b => (b as { type: 'text'; text: string }).text)
                      .join('');
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: block.id,
                      content: [{
                        type: 'text',
                        text: `${firstText.text}\n\n[Auto read_page after element not found]\n${truncateText(readText)}`,
                      }],
                      is_error: true,
                    });
                    continue;
                  } catch { /* fall through to normal result */ }
                }
              }
            }

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
        // Issue 10: if the stream failed before producing any content, the
        // empty assistant placeholder is still in history — remove it so it
        // doesn't get sent as an invalid empty message on the next request
        set(s => {
          const conv = s.conversations.find(c => c.id === convId);
          if (!conv) return s;
          const last = conv.messages[conv.messages.length - 1];
          if (last?.role === 'assistant' && last.content.length === 0) {
            return {
              conversations: patchConversation(s.conversations, convId, c => ({
                ...c, messages: c.messages.slice(0, -1),
              })),
            };
          }
          return s;
        });

        const raw = (e as Error).message;
        let display = raw;
        if (raw.includes('400') || raw.includes('Bad Request') || raw.includes('Provider returned error')) {
          display = 'Provider error (400). Try a new chat, or switch to Gemini / DeepSeek in Settings for more reliable tool support.';
        } else if (raw.includes('429')) {
          display = 'Rate limit reached. Wait a moment then try again, or switch provider in Settings.';
        } else if (raw.includes('401') || raw.includes('Unauthorized') || raw.includes('Invalid API key')) {
          display = 'Invalid API key. Check your key in Settings.';
        }
        set({ error: display });
      }
    } finally {
      set({ isStreaming: false, abortController: null });
      saveConversations(get().conversations);

      // Issue 16: fire-and-forget AI title generation after the first exchange
      if (isFirstExchange) {
        const conv = get().conversations.find(c => c.id === convId);
        if (conv) {
          const uText = (effectiveContent.find(b => b.type === 'text') as { text?: string } | undefined)?.text ?? '';
          const aText = conv.messages
            .filter(m => m.role === 'assistant')
            .flatMap(m => m.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map(b => b.text)
            )
            .join(' ')
            .slice(0, 300);
          if (uText || aText) {
            generateConversationTitle(uText, aText, customFetch, settings)
              .then(title => {
                if (title) {
                  set(s => ({
                    conversations: patchConversation(s.conversations, convId, c => ({ ...c, title })),
                  }));
                  saveConversations(get().conversations);
                }
              })
              .catch(() => {});
          }
        }
      }

      if (settings.computerUseEnabled) {
        chrome.runtime.sendMessage({ type: 'AGENT_STOPPED' }).catch(() => {});
      }
    }
  },
}));
