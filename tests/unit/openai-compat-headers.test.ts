import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOpenAICompatibleFetch, parseExtraHeaders, PROVIDERS } from '@/lib/openai-compat';
import type { ProviderConfig } from '@/lib/types';

// Extra-header support (the Opik / Comet-Workspace path): ProviderConfig
// carries arbitrary extra headers, merged into every request to the provider's
// OpenAI-compatible surface. parseExtraHeaders is the settings-UI validator;
// createOpenAICompatibleFetch is where the merge actually lands.

describe('parseExtraHeaders', () => {
  it('returns an empty map for blank input', () => {
    expect(parseExtraHeaders('')).toEqual({ headers: {} });
    expect(parseExtraHeaders('   ')).toEqual({ headers: {} });
  });

  it('parses a valid object of string values', () => {
    expect(parseExtraHeaders('{"Comet-Workspace":"my-ws","X-Extra":"yes"}')).toEqual({
      headers: { 'Comet-Workspace': 'my-ws', 'X-Extra': 'yes' },
    });
  });

  it('rejects malformed JSON with a clear error', () => {
    const { headers, error } = parseExtraHeaders('{"Comet-Workspace":');
    expect(headers).toEqual({});
    expect(error).toMatch(/valid JSON/);
  });

  it('rejects non-object input (array / string)', () => {
    expect(parseExtraHeaders('[1,2]').error).toMatch(/object of string values/);
    expect(parseExtraHeaders('"just a string"').error).toMatch(/object of string values/);
  });

  it('rejects non-string values, naming the offending key', () => {
    const { error } = parseExtraHeaders('{"X-Extra":42}');
    expect(error).toMatch(/X-Extra/);
    expect(error).toMatch(/string value/);
  });
});

describe('PROVIDERS — tabi router preset', () => {
  it('points at the OpenAI-compatible Tabi surface with a Claude default model', () => {
    const tabi = PROVIDERS['tabi'];
    expect(tabi).toBeDefined();
    expect(tabi.baseURL).toBe('https://tabitoken.com/v1');
    expect(tabi.defaultModel).toBe('claude-opus-4-8');
    expect(tabi.supportsTools).toBe(true);
    // Every Claude-family request maps to tabi's own Claude model id.
    for (const claudeId of ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']) {
      expect(tabi.modelMap?.[claudeId]).toBe('claude-opus-4-8');
    }
  });
});

describe('PROVIDERS — novarouter preset', () => {
  it('points at the OpenAI-compatible Novarouter surface with the free Fable 5 default', () => {
    const novarouter = PROVIDERS['novarouter'];
    expect(novarouter).toBeDefined();
    expect(novarouter.baseURL).toBe('https://novarouter.site/v1');
    expect(novarouter.defaultModel).toBe('claude-fable-5');
    expect(novarouter.supportsTools).toBe(true);
    // Every Claude-family request maps to the free Fable 5 model.
    for (const claudeId of ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']) {
      expect(novarouter.modelMap?.[claudeId]).toBe('claude-fable-5');
    }
  });
});

describe('createOpenAICompatibleFetch — extra header merge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges extraHeaders into the OpenAI /chat/completions request, keeping the Bearer auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const config: ProviderConfig = {
      provider: 'custom',
      apiKey: 'opik-key',
      baseURL: 'https://www.comet.com/opik/api/v1/private',
      defaultModel: 'my-model',
      extraHeaders: { 'Comet-Workspace': 'staimoorulhassan' },
    };
    const customFetch = createOpenAICompatibleFetch(config);
    const resp = await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(resp.status).toBe(200);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.comet.com/opik/api/v1/private/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers['Comet-Workspace']).toBe('staimoorulhassan');
    expect(headers['Authorization']).toBe('Bearer opik-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('merges extraHeaders into the Anthropic-native passthrough surface as well', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const config: ProviderConfig = {
      provider: 'agentrouter', // anthropicNative preset → every request passes through
      apiKey: 'ar-key',
      extraHeaders: { 'X-Extra': 'yes' },
    };
    const customFetch = createOpenAICompatibleFetch(config);
    await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }] }),
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://agentrouter.org/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Extra']).toBe('yes');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('sends no extra headers when none are configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const customFetch = createOpenAICompatibleFetch({ provider: 'custom', apiKey: 'k', baseURL: 'https://mock.example.com/v1', defaultModel: 'm' });
    await customFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }),
    });

    const headers = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['Comet-Workspace']).toBeUndefined();
  });
});
