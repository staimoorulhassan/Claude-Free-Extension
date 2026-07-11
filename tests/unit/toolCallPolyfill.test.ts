import { describe, it, expect } from 'vitest';
import { parseTier2Response, buildTier2SystemPromptAddendum, containsToolCallMarkers } from '@/lib/toolCallPolyfill';
import type { AnthropicTool } from '@/lib/types';

describe('parseTier2Response', () => {
  it('extracts a valid tool call and strips it from visible text', () => {
    const raw = 'I will click the button.\n<tool_call>\n{"name": "click_element", "arguments": {"ref_id": "ref_3"}}\n</tool_call>';
    const result = parseTier2Response(raw);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({ name: 'click_element', arguments: { ref_id: 'ref_3' }, source: 'tier2-xml' });
    expect(result.visibleText).not.toContain('<tool_call>');
    expect(result.visibleText).toContain('I will click the button.');
    expect(result.parseErrors).toHaveLength(0);
  });

  it('strips <thinking> blocks from visible text', () => {
    const raw = '<thinking>Let me plan this out.</thinking>Navigating now.';
    const result = parseTier2Response(raw);
    expect(result.visibleText).toBe('Navigating now.');
  });

  it('captures a parse error for malformed JSON instead of silently dropping it', () => {
    const raw = '<tool_call>{name: click_element, not valid json}</tool_call>';
    const result = parseTier2Response(raw);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0]).toMatch(/Malformed/);
  });

  it('captures a parse error for valid JSON that does not match the envelope shape', () => {
    const raw = '<tool_call>{"foo": "bar"}</tool_call>';
    const result = parseTier2Response(raw);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0]).toMatch(/did not match/);
  });

  it('handles multiple tool calls in one response', () => {
    const raw = '<tool_call>{"name":"a","arguments":{}}</tool_call>text<tool_call>{"name":"b","arguments":{}}</tool_call>';
    const result = parseTier2Response(raw);
    expect(result.toolCalls.map(t => t.name)).toEqual(['a', 'b']);
  });

  it('returns the full text as visibleText when there are no tags', () => {
    const result = parseTier2Response('Just a plain response.');
    expect(result.visibleText).toBe('Just a plain response.');
    expect(result.toolCalls).toHaveLength(0);
  });
});

describe('buildTier2SystemPromptAddendum', () => {
  it('includes tool names and the <tool_call> protocol instructions', () => {
    const tools: AnthropicTool[] = [{ name: 'computer', description: 'Control the browser', input_schema: { type: 'object', properties: { action: {} }, required: ['action'] } }];
    const addendum = buildTier2SystemPromptAddendum(tools);
    expect(addendum).toContain('computer');
    expect(addendum).toContain('<tool_call>');
    expect(addendum).toContain('required: action');
  });
});

describe('containsToolCallMarkers', () => {
  it('detects an opening tag', () => {
    expect(containsToolCallMarkers('here comes <tool_call>')).toBe(true);
  });
  it('returns false for plain text', () => {
    expect(containsToolCallMarkers('nothing special here')).toBe(false);
  });
});
