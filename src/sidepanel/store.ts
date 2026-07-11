import { create } from 'zustand';
import type { AppSettings, Conversation, Message, ContentBlock, AnthropicMessage, AnthropicStreamEvent, ToolUseBlock, ExecutionJournal } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import { getSettings, saveSettings, getConversations, saveConversations, generateId, generateTitle, getProviderVault, saveProviderVault } from '@/lib/storage';
import type { ProviderVault } from '@/lib/storage';
import { getRecordings, saveRecordings, recordingToText } from '@/lib/recordings';
import type { Recording } from '@/lib/recordings';
import { createOpenAICompatibleFetch, resolveContextWindow } from '@/lib/openai-compat';
import { getEnabledTools, executeTool } from '@/lib/tools';
import { detectPattern, selectStrategy } from '@/lib/tokenOptimizer';
import { createSteelManager } from '@/lib/steel-session';
import type { SteelSession } from '@/lib/steel-client';

export interface PendingApproval {
  blocks: ToolUseBlock[];
  resolve: (decision: 'approve' | 'reject' | string) => void;
}

// T019: ask_user pauses the loop until the user answers, distinct from the tool-
// approval gate above (this is the agent proactively asking, not the user vetting
// a planned action).
export interface PendingAskUser {
  prompt: string;
  requiresManualAction: boolean;
  resolve: (response: string) => void;
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
  pendingAskUser: PendingAskUser | null;
  currentTaskId: string | null; // T024-T029: drives tab-group scoping + "Terminate Task"
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
  respondToAskUser: (response: string) => void;
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

function truncateText(text: string, maxChars: number = CTX_MAX_TEXT_CHARS): string {
  return text.length > maxChars
    ? text.slice(0, maxChars) + '\n…[truncated to save context]'
    : text;
}

// T046: contextWindow-aware sliding window. Falls back to the fixed
// CTX_MAX_MESSAGES/CTX_MAX_TEXT_CHARS heuristic (unchanged behavior) when no
// contextWindow is known for the active provider — see research.md §9.
function computeEffectiveLimits(contextWindow?: number): { maxMessages: number; maxTextChars: number } {
  if (!contextWindow) return { maxMessages: CTX_MAX_MESSAGES, maxTextChars: CTX_MAX_TEXT_CHARS };
  const HISTORY_TOKEN_BUDGET_FRACTION = 0.5; // leave room for system prompt, tool schema, response
  const AVG_TOKENS_PER_MESSAGE = 300;        // rough heuristic, not exact
  const tokenBudget = contextWindow * HISTORY_TOKEN_BUDGET_FRACTION;
  const maxMessages = Math.max(10, Math.min(CTX_MAX_MESSAGES, Math.floor(tokenBudget / AVG_TOKENS_PER_MESSAGE)));
  const maxTextChars = contextWindow < 16_000
    ? Math.max(2000, Math.floor(CTX_MAX_TEXT_CHARS * (contextWindow / 32_000)))
    : CTX_MAX_TEXT_CHARS;
  return { maxMessages, maxTextChars };
}

function compressBlock(block: ContentBlock, keepImage: boolean, maxTextChars: number): ContentBlock {
  if (block.type !== 'tool_result') return block;
  if (typeof block.content === 'string') {
    return { ...block, content: truncateText(block.content, maxTextChars) };
  }
  if (!Array.isArray(block.content)) return block;

  const hasImage = block.content.some(b => b.type === 'image');
  if (hasImage && !keepImage) {
    const textParts = block.content.filter(b => b.type === 'text');
    return {
      ...block,
      content: textParts.length > 0
        ? textParts.map(b => b.type === 'text' ? { ...b, text: truncateText(b.text, maxTextChars) } : b)
        : [{ type: 'text' as const, text: '[screenshot removed — older than last 2]' }],
    };
  }
  return {
    ...block,
    content: block.content.map(b =>
      b.type === 'text' ? { ...b, text: truncateText(b.text, maxTextChars) } : b
    ),
  };
}

export function compressForApi(messages: AnthropicMessage[], debugMode: boolean = false): AnthropicMessage[] {
  // Issue 10: drop empty assistant placeholder messages (failed streams)
  const noEmpty = messages.filter(msg =>
    !(msg.role === 'assistant' && Array.isArray(msg.content) && msg.content.length === 0)
  );

  const { maxMessages, maxTextChars } = computeEffectiveLimits(contextWindow);
  if (debugMode && contextWindow) {
    console.log(`[Context Compression] contextWindow=${contextWindow} → maxMessages=${maxMessages}, maxTextChars=${maxTextChars}`);
  }

  // Sliding window
  const windowed = noEmpty.length > maxMessages
    ? noEmpty.slice(-maxMessages)
    : noEmpty;

  // Split: always-keep tail vs compressible head
  const cutoff = Math.max(0, windowed.length - CTX_ALWAYS_KEEP);
  const head = windowed.slice(0, cutoff);
  const tail = windowed.slice(cutoff);

  // If conversation is VERY long (50+ messages), use more aggressive compression
  const isVeryLong = noEmpty.length > 50;
  const effectiveScreenshotBudget = isVeryLong ? 1 : CTX_MAX_SCREENSHOTS;

  if (isVeryLong && debugMode) {
    console.log(`[Context Compression] Very long conversation (${noEmpty.length} msgs), reducing screenshot budget to ${effectiveScreenshotBudget}`);
  }

  // Compress only the head — walk newest→oldest to count screenshots correctly
  let screenshots = 0;
  const compressedHead = [...head].reverse().map(msg => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
    const newContent = (msg.content as ContentBlock[]).map(block => {
      if (block.type !== 'tool_result') return block;
      const hasImg = Array.isArray(block.content) && block.content.some(b => b.type === 'image');
      if (hasImg) screenshots++;
      return compressBlock(block, hasImg && screenshots <= effectiveScreenshotBudget, maxTextChars);
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

export async function* streamMessages(
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

export async function* streamWithRetry(
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
        msg.includes('429') || msg.includes('500') || msg.includes('502') || 
        msg.includes('503') || msg.includes('504') || msg.includes('Provider') || isNetworkError || isTimeout;
      
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
  pendingAskUser: null,
  currentTaskId: null,
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
      // T038/T039: background.ts found a journal on service-worker restart. Full
      // autonomous resume of the LLM loop isn't implemented in this pass (see
      // tasks.md T035) — surface it so the user knows their conversation state was
      // preserved and isn't silently lost, even though they need to continue it.
      if (msg.type === 'TASK_RESUMED') {
        set({ error: `A task (round ${msg.fromRound}) survived a background restart — its state was preserved. Open a new message to continue it.` });
      }
      if (msg.type === 'TASK_ORPHANED') {
        set({ error: `A previous task could not be resumed (its tab was closed) and was marked orphaned.` });
      }
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
    // Reject any pending approval / ask_user prompt so the agent loop exits cleanly
    get().pendingApproval?.resolve('reject');
    get().pendingAskUser?.resolve('');
    // T029: "Terminate Task" — close exactly the tabs this task opened (scoped
    // cleanup in background.ts), leaving pre-existing user tabs untouched.
    const { currentTaskId } = get();
    if (currentTaskId) {
      chrome.runtime.sendMessage({ type: 'TAB_GROUP_TERMINATE', taskId: currentTaskId }).catch(() => {});
    }
    set({ isStreaming: false, abortController: null, pendingApproval: null, pendingAskUser: null, currentTaskId: null });
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

  respondToAskUser: (response: string) => {
    const { pendingAskUser } = get();
    if (!pendingAskUser) return;
    set({ pendingAskUser: null });
    pendingAskUser.resolve(response);
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

    set({ currentTaskId: taskId });
    if (settings.computerUseEnabled) {
      chrome.runtime.sendMessage({ type: 'AGENT_STARTED', taskId, taskName }).catch(() => {});
    }

    // Declare timeout timer outside try block so it's accessible in finally
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

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
              '  navigate        → go to a URL',
              '  read_page_state → get labelled interactive elements plus any console/network errors (prefer this over read_page)',
              '  click_element   → click by ref ID from read_page_state',
              '  type_text       → type into a specific field by ref ID, with optional submit',
              '  type            → type text into whatever is already focused',
              '  key             → press Return/Enter/Escape/Tab/arrow keys',
              '  screenshot      → see the page visually (use sparingly — prefer read_page_state)',
              '  scroll          → scroll up/down/left/right',
              '  wait            → wait N seconds for page to load',
              '  execute_js      → run custom JavaScript for complex data extraction (always asks for your approval first)',
              '  manage_tabs     → open/switch/close tabs as part of this task',
              '  ask_user        → pause and ask the user a question, or wait for them to handle a CAPTCHA/2FA/irreversible action',
              '',
              'EFFICIENCY: prefer read_page_state → click_element over screenshot → coordinate click.',
              'Only take a screenshot when you must SEE something (images, charts, CAPTCHAs).',
              'After navigate, always call read_page_state or wait before any click.',
              'If click_element reports the target is obscured by an overlay, it will be auto-retried after dismissal — you don\'t need to handle that yourself.',
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

        // T022: execute_js always requires approval regardless of settings.requireApproval —
        // it's the one action with unbounded blast radius (arbitrary script execution).
        const containsExecuteJs = toolUseBlocks.some(b =>
          b.name === 'computer' && (b.input as Record<string, unknown>).action === 'execute_js'
        );

        // Approval gate — pause and show pending actions to the user before executing
        if ((settings.requireApproval || containsExecuteJs) && settings.computerUseEnabled) {
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
            // T019: ask_user pauses the loop for a direct user response instead of
            // going through executeTool()/background.ts at all — there's no CDP
            // action to run, only a UI prompt to wait on.
            if (block.name === 'computer' && (block.input as Record<string, unknown>).action === 'ask_user') {
              const input = block.input as Record<string, unknown>;
              const response = await new Promise<string>(resolve => {
                set({
                  pendingAskUser: {
                    prompt: (input.prompt as string) ?? 'The agent needs your input.',
                    requiresManualAction: Boolean(input.requires_manual_action),
                    resolve,
                  },
                });
              });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: [{ type: 'text', text: response || '(no response)' }],
              });
              continue;
            }

            const resultContent = await executeTool(block, steelSession);

            if (block.name === 'computer') {
              const act = (block.input as Record<string, unknown>).action as string;
              if (act === 'click_element') {
                const refId = ((block.input as Record<string, unknown>).ref_id as string) ?? '';
                const firstText = resultContent.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
                const isObscured = firstText?.text.includes('is obscured by');
                const isStale = firstText && (firstText.text.includes('not found') || firstText.text.includes('no longer'));

                // T020: obscured by an overlay — try to auto-dismiss it, then retry
                // the original click once, before ever falling back to the model.
                if (isObscured) {
                  try {
                    const stateBlock: ToolUseBlock = {
                      type: 'tool_use', id: block.id + '_auto_state', name: 'computer',
                      input: { action: 'read_page_state', filter: 'interactive' },
                    };
                    const stateResult = await executeTool(stateBlock, steelSession);
                    const stateText = stateResult
                      .filter(b => b.type === 'text')
                      .map(b => (b as { type: 'text'; text: string }).text)
                      .join('');
                    const dismissRef = findDismissRefId(stateText);
                    if (dismissRef) {
                      await executeTool(
                        { type: 'tool_use', id: block.id + '_auto_dismiss', name: 'computer', input: { action: 'click_element', ref_id: dismissRef } },
                        steelSession,
                      );
                      const retryResult = await executeTool(
                        { type: 'tool_use', id: block.id + '_retry', name: 'computer', input: { action: 'click_element', ref_id: refId } },
                        steelSession,
                      );
                      const retryText = retryResult
                        .filter(b => b.type === 'text')
                        .map(b => (b as { type: 'text'; text: string }).text)
                        .join('');
                      toolResults.push({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: [{ type: 'text', text: `[Auto-dismissed an overlay (${dismissRef}), then retried] ${retryText}` }],
                        is_error: !retryText.toLowerCase().startsWith('clicked'),
                      });
                      continue;
                    }
                  } catch { /* fall through to normal (obscured) result below */ }
                }

                // Issue 19 / T021: when click_element says the element wasn't found or
                // is stale, auto-retry once via a fresh read; escalate to ask_user on
                // the second consecutive failure for the same ref_id instead of
                // retrying indefinitely.
                if (isStale) {
                  const failCount = (staleRetryCounts.get(refId) ?? 0) + 1;
                  staleRetryCounts.set(refId, failCount);

                  if (failCount >= 2) {
                    const response = await new Promise<string>(resolve => {
                      set({
                        pendingAskUser: {
                          prompt: `I couldn't click "${refId}" after retrying — the page may have changed unexpectedly. How should I proceed?`,
                          requiresManualAction: false,
                          resolve,
                        },
                      });
                    });
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: block.id,
                      content: [{ type: 'text', text: `${firstText?.text ?? 'Element click failed twice.'}\n\nUser guidance: ${response || '(no response)'}` }],
                      is_error: true,
                    });
                    continue;
                  }

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
                        text: `${firstText?.text ?? ''}\n\n[Auto read_page after element not found]\n${truncateText(readText)}`,
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

        // T035/T036: journal write-after-every-round, so background.ts (which
        // survives independently of this side panel) always has current state on
        // disk. See tasks.md T035 for the scope note on why the loop itself still
        // runs here rather than being fully relocated into the service worker.
        {
          const currentHistory = toAnthropicMessages(activeConversation(get)?.messages ?? []);
          const journalSnapshot: ExecutionJournal = {
            taskId,
            roundCount: agentIteration,
            conversationHistory: currentHistory,
            activeTabId: null,
            activeGroupId: null,
            pendingAction: null,
            status: 'in_progress',
            createdAt: agentStartTime,
            updatedAt: Date.now(),
          };
          chrome.runtime.sendMessage({ type: 'TASK_ROUND_COMPLETE', taskId, journal: journalSnapshot }).catch(() => {});
        }
      }
    } catch (e) {
      const wasAbort = (e as Error).name === 'AbortError';
      // Don't show generic abort error if timeout already set the error message
      if (!wasAbort) {
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
      // Clear timeout timer to avoid leaks
      if (typeof timeoutTimer !== 'undefined' && timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
      }

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
      // Task finished on its own (not via stopGeneration) — clear the id but leave the
      // tab group itself alone (still 'done'-colored, tabs stay open for the user to review).
      if (get().currentTaskId) set({ currentTaskId: null });
    }
  },
}));
