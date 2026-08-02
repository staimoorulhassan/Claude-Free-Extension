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

describe('createOpenAICompatibleFetch — AgentRouter Anthropic passthrough', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const AGENTROUTER_CONFIG: ProviderConfig = {
    provider: 'agentrouter',
    apiKey: 'sk-test-agentrouter',
  };

  it('routes Claude models to the native /v1/messages surface untranslated with both auth schemes', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(sseFrom([JSON.stringify({ type: 'message_stop' })]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const customFetch = createOpenAICompatibleFetch(AGENTROUTER_CONFIG);
    await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });

    const [calledUrl, requestInit] = mockFetch.mock.calls[0];
    // Anthropic surface = base WITHOUT /v1 suffix, then /v1/messages — never /chat/completions.
    expect(calledUrl).toBe('https://agentrouter.org/v1/messages');
    expect(requestInit.headers['Authorization']).toBe('Bearer sk-test-agentrouter');
    expect(requestInit.headers['x-api-key']).toBe('sk-test-agentrouter');
    expect(requestInit.headers['anthropic-version']).toBe('2023-06-01');

    // Body is passed through untranslated — no OpenAI `choices`/`chat` shape,
    // model rewritten to the resolved Claude id, messages preserved verbatim.
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.model).toBe('claude-opus-4-7');
    expect(sentBody.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(sentBody.stream).toBe(true);
  });

  it('derives the native surface from a custom baseURL (backup domain) instead of the preset host', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(sseFrom([JSON.stringify({ type: 'message_stop' })]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    // AgentRouter publishes backup domains; a key issued for one is rejected by
    // the other, so the passthrough must follow the user's configured host.
    const customFetch = createOpenAICompatibleFetch({
      ...AGENTROUTER_CONFIG,
      baseURL: 'https://ps.air-outer.com/v1',
    });
    await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });

    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://ps.air-outer.com/v1/messages');
    expect(calledUrl).not.toContain('agentrouter.org');
  });

  it('omits auth headers entirely when no API key is configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(sseFrom([JSON.stringify({ type: 'message_stop' })]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const customFetch = createOpenAICompatibleFetch({ ...AGENTROUTER_CONFIG, apiKey: '' });
    await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });

    const [, requestInit] = mockFetch.mock.calls[0];
    expect(requestInit.headers['Authorization']).toBeUndefined();
    expect(requestInit.headers['x-api-key']).toBeUndefined();
    // Non-auth headers must still be present.
    expect(requestInit.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('routes non-Claude models through the native /v1/messages surface too (Anthropic endpoint profile)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(sseFrom([JSON.stringify({ type: 'message_stop' })]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    // The `agentrouter` preset is the Anthropic-native profile: every model —
    // including GPT/GLM — is sent untranslated to /v1/messages.
    const customFetch = createOpenAICompatibleFetch({ ...AGENTROUTER_CONFIG, defaultModel: 'gpt-5.6' });
    await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-5.6',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });

    const [calledUrl, requestInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://agentrouter.org/v1/messages');
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.model).toBe('gpt-5.6');
  });
});

describe('createOpenAICompatibleFetch — AgentRouter OpenAI-compatible endpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const OPENAI_CONFIG: ProviderConfig = {
    provider: 'agentrouter-openai',
    apiKey: 'sk-test-agentrouter',
  };

  it('translates GPT/GLM models through the OpenAI /v1/chat/completions surface', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(sseFrom([JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const customFetch = createOpenAICompatibleFetch({ ...OPENAI_CONFIG, defaultModel: 'gpt-5.6' });
    await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-5.6',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });

    const [calledUrl, requestInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://agentrouter.org/v1/chat/completions');
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.model).toBe('gpt-5.6');
    expect(sentBody.messages[0].content).toBe('hi');
  });

  it('remaps Claude model requests to AgentRouter OpenAI models with native tool support', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(sseFrom([JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const customFetch = createOpenAICompatibleFetch(OPENAI_CONFIG);
    await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });

    const [calledUrl, requestInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://agentrouter.org/v1/chat/completions');
    const sentBody = JSON.parse(requestInit.body as string);
    // Claude → AgentRouter OpenAI model mapping on this surface.
    expect(sentBody.model).toBe('glm-5.2');
  });
});
