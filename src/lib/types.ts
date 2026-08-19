// ─── Anthropic API types ───────────────────────────────────────────────────────

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: ContentBlock[] | string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AnthropicBody {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
}

// ─── Streaming event types ─────────────────────────────────────────────────────

export type AnthropicStreamEvent =
  | { type: 'message_start'; message: { id: string; model: string } }
  | { type: 'ping' }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | {
      type: 'content_block_delta';
      index: number;
      delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string };
    }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string; stop_sequence: string | null } }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } };

// ─── App types ─────────────────────────────────────────────────────────────────

export interface ProviderConfig {
  provider: string;
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
  modelMap?: Record<string, string>;
  supportsVision?: boolean;
  supportsTools?: boolean;
  debug?: boolean;
  /** Token context window for this provider/model. Drives contextWindow-aware sliding-window
   * pruning in compressForApi (see spec 001-claude-free-extension FR-015). Falls back to the
   * existing message-count heuristic when absent. */
  contextWindow?: number;
  /** Arbitrary extra headers merged into every request to this provider's
   * OpenAI-compatible surface (e.g. Opik's Comet-Workspace, OpenRouter's
   * HTTP-Referer). Values must be plain strings; user-supplied headers win
   * over the adapter's defaults. */
  extraHeaders?: Record<string, string>;
}

// ─── Agent engine types (spec 001-claude-free-extension) ──────────────────────


/** Persistent memory entry for cross-session context retention. */
export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  category: 'task' | 'site' | 'user_pref' | 'learned';
  createdAt: number;
  updatedAt: number;
  /** How many times this memory was accessed (for relevance scoring). */
  accessCount: number;
}

/** Progress tracking for long-running tasks. */
export interface TaskProgress {
  taskId: string;
  /** Current step number (1-indexed). */
  currentStep: number;
  /** Total steps in the plan. */
  totalSteps: number;
  /** Description of the current step. */
  currentStepDescription: string;
  /** Overall task description/plan. */
  planSummary: string;
  /** Timestamps for each step completion. */
  stepHistory: Array<{
    step: number;
    description: string;
    completedAt: number;
    durationMs: number;
  }>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Persisted to chrome.storage.local under key `journal:<taskId>` after every completed
 * tool round, so a task survives MV3 service-worker termination/restart.
 * See specs/001-claude-free-extension/data-model.md.
 */
export interface ExecutionJournal {
  taskId: string;
  roundCount: number;
  conversationHistory: AnthropicMessage[];
  activeTabId: number | null;
  activeGroupId: number | null;
  /** The tab ids this task opened via manage_tabs('open'), persisted so tab
   * ownership survives service-worker restarts (journal.ts addTaskTab/removeTaskTab).
   * Optional because the sidepanel's round snapshot doesn't know the set —
   * background.ts preserves the persisted value when writing such snapshots. */
  openedTabIds?: number[];
  pendingAction: ToolCallEnvelope | null;
  status: 'in_progress' | 'orphaned' | 'completed' | 'aborted';
  createdAt: number;
  updatedAt: number;
}

/**
 * A chrome.tabGroups group created for a task that opens/drives more than one tab.
 * Only memberTabIds/taskId are persisted (via ExecutionJournal.activeGroupId); title/color
 * are re-derived from chrome.tabGroups on resume rather than duplicated, so they can't drift
 * from actual browser state.
 */
export interface AgentTabGroup {
  groupId: number;
  taskId: string;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  memberTabIds: number[];
}

/**
 * The common shape both the native tool_use path and the Tier-2 \`<\`XML-polyfill
 * parser produce, so executeTool() never needs to know which path produced a given call.
 */
export interface ToolCallEnvelope {
  name: string;
  arguments: Record<string, unknown>;
  source: 'native' | 'tier2-xml';
}

/** Runtime guard used by both the native tool_use path and toolCallPolyfill.ts (T042) to
 * confirm a candidate object is a well-formed ToolCallEnvelope before it reaches executeTool(). */
export function isValidToolCallEnvelope(value: unknown): value is ToolCallEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    v.name.length > 0 &&
    typeof v.arguments === 'object' &&
    v.arguments !== null &&
    !Array.isArray(v.arguments) &&
    (v.source === 'native' || v.source === 'tier2-xml')
  );
}

export interface SteelConfig {
  apiKey?: string;
  sessionId?: string;
  solveCaptcha?: boolean;
  proxy?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
  };
  region?: 'us-east-1' | 'eu-west-1' | 'ap-southeast-1';
}

export interface AppSettings {
  provider: ProviderConfig;
  systemPrompt: string;
  maxTokens: number;
  /** Cap on agent-loop tool rounds per task (the loop's 25-round default). */
  maxToolRounds: number;
  computerUseEnabled: boolean;
  requireApproval: boolean;
  /** Boss mode: maximum-authority system prompt + red glow indicator. */
  bossMode: boolean;
  theme: 'auto' | 'light' | 'dark';
  useSteel?: boolean;
  steel?: SteelConfig;
  /** Task timeout in minutes. 0 = no timeout (for long-running projects). Default 10. */
  taskTimeoutMinutes: number;
  /** Enable cross-session memory persistence for learned context. */
  enableMemory: boolean;
  /** Maximum number of memory entries to persist. */
  maxMemoryEntries: number;
  /** Group confinement: the extension only works inside its "Claude Free" tab
   * group — it hides (panel closes, agent stops) when a tab outside the group
   * is selected and shuts down when the group is closed. */
  groupConfinement: boolean;
  /** Voice input (Web Speech API) recognition language, BCP-47 code. */
  voiceInputLanguage: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  provider: {
    provider: 'pollinations',
    apiKey: '',
    defaultModel: 'openai-large',
  },
  systemPrompt: '',
  maxTokens: 4096,
  maxToolRounds: 25,
  computerUseEnabled: true,
  requireApproval: true,
  bossMode: false,
  theme: 'auto',
  useSteel: false,
  steel: {
    apiKey: '',
    solveCaptcha: true,
    region: 'us-east-1',
  },
  taskTimeoutMinutes: 10,
  enableMemory: true,
  maxMemoryEntries: 100,
  groupConfinement: true,
  voiceInputLanguage: 'en-US',
};

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  timestamp: number;
}