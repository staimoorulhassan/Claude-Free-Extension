import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOpenAICompatibleFetch } from '@/lib/openai-compat';
import type { ProviderConfig } from '@/lib/types';

// T041 (reclassified from e2e to unit — see tasks.md): createOpenAICompatibleFetch
// only depends on fetch/ReadableStream/TextEncoder, all available in Node, so the
// Tier-2 streaming path can be verified directly and deterministically here
// rather than through a browser-dependent e2e harness. The originally-planned
// Playwright spec (tests/e2e/tier2-polyfill.spec.ts) still exists as a structural
// placeholder for a future full end-to-end run through the actual sidepanel UI.

function sseFrom(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const line of lines) ctrl.enqueue(enc.encode(`data: ${line}\n\n`));
      ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      ctrl.close();
    },
  });
}

async function readAnthropicEvents(resp: Response): Promise<Array<Record<string, unknown>>> {
  const text = await resp.text();
  const events: Array<Record<string, unknown>> = [];
  for (const block of text.split('\n\n')) {
    const dataLine = block.split('\n').find(l => l.startsWith('data:'));
    if (!dataLine) continue;
    events.push(JSON.parse(dataLine.slice(5).trim()));
  }
  return events;
}

const TIER2_CONFIG: ProviderConfig = {
  provider: 'custom',
  apiKey: 'test-key',
  baseURL: 'https://mock.example.com/v1',
  defaultModel: 'small-model',
  supportsTools: false, // the case under test
};

describe('createOpenAICompatibleFetch — Tier-2 XML tool-call polyfill', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts a tool_use block from a <tool_call> response with no tag leakage', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        sseFrom([
          JSON.stringify({ choices: [{ delta: { content: '<thinking>I should click.</thinking>' } }] }),
          JSON.stringify({ choices: [{ delta: { content: '<tool_call>\n{"name": "click_element", "arguments": {"ref_id": "ref_1"}}\n</tool_call>' }, finish_reason: 'stop' }] }),
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const customFetch = createOpenAICompatibleFetch(TIER2_CONFIG);
    const resp = await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        messages: [{ role: 'user', content: 'click the button' }],
        stream: true,
        tools: [{ name: 'computer', description: 'browser control', input_schema: { type: 'object', properties: {}, required: [] } }],
      }),
    });

    const events = await readAnthropicEvents(resp);
    const toolUseStart = events.find(e => e.type === 'content_block_start' && (e.content_block as Record<string, unknown>)?.type === 'tool_use');
    expect(toolUseStart).toBeTruthy();
    expect((toolUseStart!.content_block as Record<string, unknown>).name).toBe('click_element');

    const textDeltas = events.filter(e => e.type === 'content_block_delta' && (e.delta as Record<string, unknown>)?.type === 'text_delta');
    for (const d of textDeltas) {
      const text = (d.delta as Record<string, unknown>).text as string;
      expect(text).not.toContain('<tool_call>');
      expect(text).not.toContain('<thinking>');
    }

    const messageDelta = events.find(e => e.type === 'message_delta');
    expect((messageDelta!.delta as Record<string, unknown>).stop_reason).toBe('tool_use');

    // Confirms the request never sent a native `tools` param for this provider.
    const [, requestInit] = mockFetch.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.tools).toBeUndefined();
    expect(sentBody.messages[0].content).toContain('<tool_call>'); // the injected protocol instructions
  });

  it('surfaces a malformed tool call as a recoverable error, not a silent drop', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        sseFrom([
          JSON.stringify({ choices: [{ delta: { content: '<tool_call>{not valid json}</tool_call>' }, finish_reason: 'stop' }] }),
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const customFetch = createOpenAICompatibleFetch(TIER2_CONFIG);
    const resp = await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        messages: [{ role: 'user', content: 'do something' }],
        stream: true,
        tools: [{ name: 'computer', input_schema: { type: 'object', properties: {}, required: [] } }],
      }),
    });

    const events = await readAnthropicEvents(resp);
    const errorText = events
      .filter(e => e.type === 'content_block_delta')
      .map(e => ((e.delta as Record<string, unknown>).text as string) ?? '')
      .join('');
    expect(errorText).toContain('parse error');

    const toolUseStart = events.find(e => e.type === 'content_block_start' && (e.content_block as Record<string, unknown>)?.type === 'tool_use');
    expect(toolUseStart).toBeUndefined(); // no tool call executed from malformed input
  });
});
