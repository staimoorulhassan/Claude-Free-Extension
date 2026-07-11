import type { AnthropicTool } from './types';
import { isValidToolCallEnvelope, type ToolCallEnvelope } from './types';

/**
 * Tier-2 tool-calling polyfill for providers with supportsTools: false (spec
 * 001-claude-free-extension, US4 / FR-013-016). Mirrors the existing
 * supportsVision:false fallback pattern in openai-compat.ts (research.md §8):
 * inject a text protocol instead of the native `tools` request param, then parse
 * it back out of the response text into the same ToolCallEnvelope shape the
 * native tool_use path produces.
 */

const TOOL_CALL_OPEN = '<tool_call>';
const TOOL_CALL_CLOSE = '</tool_call>';
const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;

export interface ParsedToolCallResult {
  /** Response text with all <thinking>/<tool_call> blocks stripped, safe to show the user. */
  visibleText: string;
  toolCalls: ToolCallEnvelope[];
  /** Populated when a <tool_call> block's body wasn't valid JSON/envelope shape —
   * surfaced as a recoverable tool-result error (FR-016), not a silent drop. */
  parseErrors: string[];
}

/** Builds the system-prompt addendum instructing the model to emit tool calls as
 * XML instead of using native function calling. */
export function buildTier2SystemPromptAddendum(tools: AnthropicTool[]): string {
  const toolDescriptions = tools.map(t => {
    const props = t.input_schema?.properties ?? {};
    const required = t.input_schema?.required ?? [];
    return `- ${t.name}: ${t.description ?? ''}\n  arguments: ${JSON.stringify(props)}${required.length ? ` (required: ${required.join(', ')})` : ''}`;
  }).join('\n');

  return [
    'TOOL CALLING PROTOCOL (this model does not support native function calling — use this text protocol instead):',
    'When you need to use a tool, think through your reasoning inside <thinking></thinking> tags, then emit exactly',
    'one tool call as JSON inside <tool_call></tool_call> tags, in this exact format:',
    '<tool_call>',
    '{"name": "tool_name", "arguments": {"key": "value"}}',
    '</tool_call>',
    '',
    'Available tools:',
    toolDescriptions,
    '',
    'Rules:',
    '- Emit at most one <tool_call> block per response.',
    '- The JSON inside <tool_call> must be valid, parseable JSON — no trailing commas, no comments.',
    '- Do not wrap the JSON in markdown code fences.',
    '- If you are not calling a tool, just respond normally with no <tool_call> block.',
  ].join('\n');
}

/** Parses a Tier-2 model response: strips <thinking>/<tool_call> tags from the
 * visible text and extracts any tool calls (or parse errors) found. */
export function parseTier2Response(rawText: string): ParsedToolCallResult {
  const toolCalls: ToolCallEnvelope[] = [];
  const parseErrors: string[] = [];

  let match: RegExpExecArray | null;
  TOOL_CALL_RE.lastIndex = 0;
  while ((match = TOOL_CALL_RE.exec(rawText)) !== null) {
    const body = match[1].trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parseErrors.push(`Malformed <tool_call> JSON: ${body.slice(0, 200)}`);
      continue;
    }
    const candidate = { ...(parsed as Record<string, unknown>), source: 'tier2-xml' as const };
    if (isValidToolCallEnvelope(candidate)) {
      toolCalls.push(candidate);
    } else {
      parseErrors.push(`<tool_call> body did not match {name, arguments}: ${body.slice(0, 200)}`);
    }
  }

  const visibleText = rawText
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(TOOL_CALL_RE, '')
    .trim();

  return { visibleText, toolCalls, parseErrors };
}

/** True if a chunk of streamed text contains (or might be starting) a tool-call
 * tag — used to decide whether streamed text should be buffered rather than
 * shown to the user immediately, since we can't stream-strip tags mid-tag. */
export function containsToolCallMarkers(text: string): boolean {
  return text.includes(TOOL_CALL_OPEN) || text.includes(TOOL_CALL_CLOSE) || text.includes('<thinking>') || text.includes('</thinking>');
}
