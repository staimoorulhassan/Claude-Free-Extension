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
}

// ─── Agent engine types (spec 001-claude-free-extension) ──────────────────────

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
 * The common shape both the native tool_use path and the Tier-2 <tool_call> XML-polyfill
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
  computerUseEnabled: boolean;
  requireApproval: boolean;
  theme: 'auto' | 'light' | 'dark';
  useSteel?: boolean;
  steel?: SteelConfig;
}

export const DEFAULT_SETTINGS: AppSettings = {
  provider: {
    provider: 'pollinations',
    apiKey: '',
    defaultModel: 'openai-large',
  },
  systemPrompt: '',
  maxTokens: 4096,
  computerUseEnabled: true,
  requireApproval: true,
  theme: 'auto',
  useSteel: false,
  steel: {
    apiKey: '',
    solveCaptcha: true,
    region: 'us-east-1',
  },
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
