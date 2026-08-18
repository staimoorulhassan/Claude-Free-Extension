import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppSettings, AnthropicMessage, ContentBlock } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';

// ── Mocks for store.ts's dependencies ───────────────────────────────────────────
// These are hoisted by vitest above the imports below, so we use vi.hoisted to
// safely share references between the mock factories and the test bodies.
const { customFetchMock, executeToolMock, getEnabledToolsMock } = vi.hoisted(() => ({
  customFetchMock: vi.fn(),
  executeToolMock: vi.fn(),
  getEnabledToolsMock: vi.fn(() => [] as unknown[]),
}));

// Partial mock: only the fetch factory is stubbed. resolveContextWindow (used by
// compressForApi) stays real so the compression path is exercised for real.
vi.mock('@/lib/openai-compat', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/openai-compat')>()),
  createOpenAICompatibleFetch: vi.fn(() => customFetchMock),
}));

vi.mock('@/lib/tools', () => ({
  getEnabledTools: getEnabledToolsMock,
  executeTool: executeToolMock,
}));

// Only stub out the chrome-storage-backed export that sendMessage actually
// touches (saveConversations, in its `finally` block). generateId/generateTitle
// are pure and kept as the real implementation.
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return { ...actual, saveConversations: vi.fn(async () => {}) };
});

import { compressForApi, streamMessages, streamWithRetry, useStore } from './store';

// ── Test helpers ─────────────────────────────────────────────────────────────────

function textMsg(role: 'user' | 'assistant', text: string): AnthropicMessage {
  return { role, content: [{ type: 'text', text }] };
}

function toolResultMsg(content: ContentBlock[] | string): AnthropicMessage {
  return { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content }] };
}

function imageBlock(): ContentBlock {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } };
}

function sseEvents(events: unknown[]): string {
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

/**
 * Builds a fake fetch Response whose body is a controllable ReadableStream-like
 * reader. Each call produces a brand-new reader (fresh iteration state), so the
 * same options object can safely back multiple sequential fetch calls.
 */
function makeFakeResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  errorText?: string;
  chunks?: string[];
  readError?: Error;
}) {
  const { ok = true, status = 200, statusText = 'OK', errorText = '', chunks = [], readError } = opts;
  const encoder = new TextEncoder();
  let idx = 0;
  let threwReadError = false;
  const read = vi.fn(async () => {
    if (readError && !threwReadError) {
      threwReadError = true;
      throw readError;
    }
    if (idx >= chunks.length) return { done: true, value: undefined };
    const value = encoder.encode(chunks[idx++]);
    return { done: false, value };
  });
  const releaseLock = vi.fn();
  const response = {
    ok,
    status,
    statusText,
    text: vi.fn(async () => errorText),
    body: { getReader: () => ({ read, releaseLock }) },
  };
  return { response: response as unknown as Response, reader: { read, releaseLock } };
}

// ── compressForApi ───────────────────────────────────────────────────────────────

describe('compressForApi', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('does not log anything for short conversations, regardless of debugMode', () => {
    const messages = [textMsg('user', 'hi'), textMsg('assistant', 'hello')];

    compressForApi(messages, true);
    compressForApi(messages, false);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs a very-long-conversation notice when debugMode is true and > 50 messages', () => {
    const messages: AnthropicMessage[] = [];
    for (let i = 0; i < 51; i++) {
      messages.push(textMsg(i % 2 === 0 ? 'user' : 'assistant', `message ${i}`));
    }

    const result = compressForApi(messages, true);

    const logged = logSpy.mock.calls.map(c => String(c[0]));
    expect(logged.some(l => /Very long conversation \(51 msgs\)/.test(l))).toBe(true);
    // Trimming the head also injects a recap of what was dropped.
    expect(logged.some(l => /Trimmed \d+ messages, injected recap/.test(l))).toBe(true);
    // Sliding window applies (40 max) and may give up one more message to start
    // on a clean round boundary; the recap is merged into the first user turn.
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result[0].role).toBe('user');
    const firstBlocks = result[0].content as ContentBlock[];
    expect((firstBlocks[0] as { text: string }).text).toMatch(/Earlier context/);
  });

  it('does not log the very-long-conversation notice when debugMode is false, even if > 50 messages', () => {
    const messages: AnthropicMessage[] = [];
    for (let i = 0; i < 60; i++) {
      messages.push(textMsg(i % 2 === 0 ? 'user' : 'assistant', `message ${i}`));
    }

    compressForApi(messages, false);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('defaults debugMode to false when the parameter is omitted', () => {
    const messages: AnthropicMessage[] = [];
    for (let i = 0; i < 60; i++) {
      messages.push(textMsg(i % 2 === 0 ? 'user' : 'assistant', `message ${i}`));
    }

    expect(() => compressForApi(messages)).not.toThrow();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('treats exactly 50 messages as not "very long" (boundary case)', () => {
    const messages: AnthropicMessage[] = [];
    for (let i = 0; i < 50; i++) {
      messages.push(textMsg(i % 2 === 0 ? 'user' : 'assistant', `message ${i}`));
    }

    compressForApi(messages, true);

    // The very-long notice must not fire at exactly 50. (50 > the 40-message
    // window, so the separate trim/recap notice legitimately does.)
    const logged = logSpy.mock.calls.map(c => String(c[0]));
    expect(logged.some(l => /Very long conversation/.test(l))).toBe(false);
  });

  it('still drops empty assistant placeholder messages when debugMode is true', () => {
    const messages: AnthropicMessage[] = [
      textMsg('user', 'hi'),
      { role: 'assistant', content: [] },
      textMsg('user', 'follow up'),
    ];

    const result = compressForApi(messages, true);

    expect(result).toEqual([textMsg('user', 'hi'), textMsg('user', 'follow up')]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('keeps only the 2 most recent screenshots and truncates long tool text in the compressible head', () => {
    const longText = 'x'.repeat(9000);
    // 8 head messages (older than the last CTX_ALWAYS_KEEP=6) followed by
    // 6 tail messages that are always sent uncompressed.
    const messages: AnthropicMessage[] = [
      toolResultMsg([imageBlock()]), // imgA — oldest screenshot, should be dropped
      textMsg('assistant', 'ackA'),
      toolResultMsg(longText), // long text result, should be truncated
      textMsg('assistant', 'ackLong'),
      toolResultMsg([imageBlock()]), // imgB — kept
      textMsg('assistant', 'ackB'),
      toolResultMsg([imageBlock()]), // imgC — kept (most recent)
      textMsg('assistant', 'ackC'),
    ];
    for (let i = 0; i < 3; i++) {
      messages.push(textMsg('user', `recent ${i}`));
      messages.push(textMsg('assistant', `recent reply ${i}`));
    }

    const result = compressForApi(messages, true);

    // imgA (oldest of 3 screenshots) gets replaced with a placeholder.
    const imgAContent = result[0].content as ContentBlock[];
    expect((imgAContent[0] as { content: ContentBlock[] }).content).toEqual([
      { type: 'text', text: '[screenshot removed — older than last 2]' },
    ]);

    // The long tool_result text is truncated to CTX_MAX_TEXT_CHARS.
    const longMsgContent = result[2].content as ContentBlock[];
    const truncated = (longMsgContent[0] as { content: string }).content;
    expect(truncated.endsWith('\n…[truncated to save context]')).toBe(true);
    expect(truncated.length).toBeLessThan(longText.length);

    // imgB and imgC (the 2 most recent screenshots) remain untouched images.
    const imgBContent = result[4].content as ContentBlock[];
    const imgCContent = result[6].content as ContentBlock[];
    expect((imgBContent[0] as { content: ContentBlock[] }).content[0].type).toBe('image');
    expect((imgCContent[0] as { content: ContentBlock[] }).content[0].type).toBe('image');
  });
});

// ── streamMessages ───────────────────────────────────────────────────────────────

describe('streamMessages', () => {
  it('posts to the Anthropic endpoint with stream:true and yields parsed events', async () => {
    const sse = sseEvents([
      { type: 'message_start', message: { id: 'm1', model: 'foo' } },
      { type: 'content_block_stop', index: 0 },
    ]);
    const { response, reader } = makeFakeResponse({ chunks: [sse] });
    const customFetch = vi.fn().mockResolvedValue(response);
    const controller = new AbortController();

    const events: unknown[] = [];
    for await (const ev of streamMessages({ model: 'x' }, customFetch as unknown as typeof fetch, controller.signal)) {
      events.push(ev);
    }

    expect(events).toEqual([
      { type: 'message_start', message: { id: 'm1', model: 'foo' } },
      { type: 'content_block_stop', index: 0 },
    ]);
    expect(customFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST', signal: controller.signal }),
    );
    const [, init] = customFetch.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ model: 'x', stream: true });
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('skips comment lines, blank lines, and the [DONE] marker', async () => {
    const sse = [
      ': heartbeat\n',
      'data: {"type":"message_start","message":{"id":"m1","model":"foo"}}\n\n',
      '\n',
      'data: [DONE]\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
    ].join('');
    const { response } = makeFakeResponse({ chunks: [sse] });
    const customFetch = vi.fn().mockResolvedValue(response);
    const controller = new AbortController();

    const events: unknown[] = [];
    for await (const ev of streamMessages({}, customFetch as unknown as typeof fetch, controller.signal)) {
      events.push(ev);
    }

    expect(events).toEqual([
      { type: 'message_start', message: { id: 'm1', model: 'foo' } },
      { type: 'content_block_stop', index: 0 },
    ]);
  });

  it('throws a descriptive error when the response is not ok', async () => {
    const { response } = makeFakeResponse({ ok: false, status: 503, errorText: 'overloaded' });
    const customFetch = vi.fn().mockResolvedValue(response);
    const controller = new AbortController();
    const gen = streamMessages({}, customFetch as unknown as typeof fetch, controller.signal);

    await expect(
      (async () => {
        for await (const _ of gen) { /* noop */ }
      })(),
    ).rejects.toThrow(/API error 503: overloaded/);
  });

  it('skips malformed JSON lines without crashing, warning only in debug mode', async () => {
    const sse = 'data: {not valid json\n\ndata: {"type":"message_stop"}\n\n';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { response: quietResponse } = makeFakeResponse({ chunks: [sse] });
    const quietEvents: unknown[] = [];
    for await (const ev of streamMessages(
      {},
      vi.fn().mockResolvedValue(quietResponse) as unknown as typeof fetch,
      new AbortController().signal,
      false,
    )) {
      quietEvents.push(ev);
    }
    expect(quietEvents).toEqual([{ type: 'message_stop' }]);
    expect(warnSpy).not.toHaveBeenCalled();

    const { response: verboseResponse } = makeFakeResponse({ chunks: [sse] });
    const verboseEvents: unknown[] = [];
    for await (const ev of streamMessages(
      {},
      vi.fn().mockResolvedValue(verboseResponse) as unknown as typeof fetch,
      new AbortController().signal,
      true,
    )) {
      verboseEvents.push(ev);
    }
    expect(verboseEvents).toEqual([{ type: 'message_stop' }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/Failed to parse/);

    warnSpy.mockRestore();
  });

  it('skips events missing a "type" field, warning only in debug mode', async () => {
    const sse = 'data: {"foo":"bar"}\n\ndata: {"type":"message_stop"}\n\n';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { response } = makeFakeResponse({ chunks: [sse] });
    const customFetch = vi.fn().mockResolvedValue(response);

    const events: unknown[] = [];
    for await (const ev of streamMessages({}, customFetch as unknown as typeof fetch, new AbortController().signal, true)) {
      events.push(ev);
    }

    expect(events).toEqual([{ type: 'message_stop' }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/Missing 'type' field/);

    warnSpy.mockRestore();
  });

  it('releases the reader lock even when reading fails mid-stream', async () => {
    const { response, reader } = makeFakeResponse({ readError: new Error('boom') });
    const customFetch = vi.fn().mockResolvedValue(response);
    const gen = streamMessages({}, customFetch as unknown as typeof fetch, new AbortController().signal);

    await expect(
      (async () => {
        for await (const _ of gen) { /* noop */ }
      })(),
    ).rejects.toThrow('boom');
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});

// ── streamWithRetry ───────────────────────────────────────────────────────────────

describe('streamWithRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('yields events on the first successful attempt without retrying', async () => {
    const { response } = makeFakeResponse({ chunks: [sseEvents([{ type: 'message_stop' }])] });
    const customFetch = vi.fn().mockResolvedValueOnce(response);
    const controller = new AbortController();

    const events: unknown[] = [];
    for await (const ev of streamWithRetry({}, customFetch as unknown as typeof fetch, controller.signal)) {
      events.push(ev);
    }

    expect(events).toEqual([{ type: 'message_stop' }]);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable network error with backoff and eventually succeeds', async () => {
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { response } = makeFakeResponse({ chunks: [sseEvents([{ type: 'message_stop' }])] });
    const customFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(response);
    const controller = new AbortController();

    const collected: unknown[] = [];
    const consume = (async () => {
      for await (const ev of streamWithRetry({}, customFetch as unknown as typeof fetch, controller.signal, true)) {
        collected.push(ev);
      }
    })();
    await vi.runAllTimersAsync();
    await consume;

    expect(collected).toEqual([{ type: 'message_stop' }]);
    expect(customFetch).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('Attempt 2/3'))).toBe(true);
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('Success on attempt 2'))).toBe(true);
  });

  it('retries on timeout-classified errors', async () => {
    vi.useFakeTimers();
    const { response } = makeFakeResponse({ chunks: [sseEvents([{ type: 'message_stop' }])] });
    const customFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockResolvedValueOnce(response);
    const controller = new AbortController();

    const collected: unknown[] = [];
    const consume = (async () => {
      for await (const ev of streamWithRetry({}, customFetch as unknown as typeof fetch, controller.signal)) {
        collected.push(ev);
      }
    })();
    await vi.runAllTimersAsync();
    await consume;

    expect(collected).toEqual([{ type: 'message_stop' }]);
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  it('never retries an AbortError', async () => {
    const abortError = Object.assign(new Error('The user aborted a request'), { name: 'AbortError' });
    const customFetch = vi.fn().mockRejectedValueOnce(abortError);
    const controller = new AbortController();
    const gen = streamWithRetry({}, customFetch as unknown as typeof fetch, controller.signal);

    await expect(
      (async () => {
        for await (const _ of gen) { /* noop */ }
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-retryable errors', async () => {
    const customFetch = vi.fn().mockRejectedValueOnce(new Error('API error 404: Not Found'));
    const controller = new AbortController();
    const gen = streamWithRetry({}, customFetch as unknown as typeof fetch, controller.signal);

    await expect(
      (async () => {
        for await (const _ of gen) { /* noop */ }
      })(),
    ).rejects.toThrow(/404/);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  it('fails fast on 400/401/403/404 without retrying (client errors never resolve on retry)', async () => {
    const suffixes: Record<string, string> = { '400': 'Bad Request', '401': 'Unauthorized', '403': 'Forbidden', '404': 'Not Found' };
    for (const status of ['400', '401', '403', '404']) {
      const customFetch = vi.fn().mockRejectedValueOnce(
        new Error(`API error ${status}: ${suffixes[status]}`),
      );
      const controller = new AbortController();
      const gen = streamWithRetry({}, customFetch as unknown as typeof fetch, controller.signal);

      await expect(
        (async () => {
          for await (const _ of gen) { /* noop */ }
        })(),
      ).rejects.toThrow(new RegExp(status));
      expect(customFetch).toHaveBeenCalledTimes(1);
    }
  });

  it('still retries retryable provider errors (429) — the 4xx fail-fast does not swallow them', async () => {
    vi.useFakeTimers();
    const { response } = makeFakeResponse({ chunks: [sseEvents([{ type: 'message_stop' }])] });
    const customFetch = vi.fn()
      .mockRejectedValueOnce(new Error('API error 429: {"error":{"message":"Provider 429: rate limited"}}'))
      .mockResolvedValueOnce(response);
    const controller = new AbortController();

    const collected: unknown[] = [];
    const consume = (async () => {
      for await (const ev of streamWithRetry({}, customFetch as unknown as typeof fetch, controller.signal)) {
        collected.push(ev);
      }
    })();
    await vi.runAllTimersAsync();
    await consume;

    expect(collected).toEqual([{ type: 'message_stop' }]);
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting all retry attempts', async () => {
    vi.useFakeTimers();
    const customFetch = vi.fn().mockRejectedValue(new Error('500 Internal Server Error'));
    const controller = new AbortController();
    const gen = streamWithRetry({}, customFetch as unknown as typeof fetch, controller.signal, false, 2);

    let caught: unknown = null;
    const consume = (async () => {
      try {
        for await (const _ of gen) { /* noop */ }
      } catch (e) {
        caught = e as Error;
      }
    })();
    await vi.runAllTimersAsync();
    await consume;

    expect((caught as Error | null)?.message).toMatch(/500/);
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  it('honors a custom maxAttempts of 1 and does not retry even retryable errors', async () => {
    const customFetch = vi.fn().mockRejectedValueOnce(new Error('429 Too Many Requests'));
    const controller = new AbortController();
    const gen = streamWithRetry({}, customFetch as unknown as typeof fetch, controller.signal, false, 1);

    await expect(
      (async () => {
        for await (const _ of gen) { /* noop */ }
      })(),
    ).rejects.toThrow(/429/);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });
});

// ── sendMessage agent loop (new: AGENT_TIMEOUT / debugMode plumbing) ─────────────

describe('useStore.sendMessage — agent loop timeout & debug logging', () => {
  function resetStore(settingsOverride: Record<string, unknown> = {}) {
    useStore.setState({
      conversations: [],
      activeConversationId: null,
      settings: {
        ...DEFAULT_SETTINGS,
        computerUseEnabled: false,
        requireApproval: false,
        ...settingsOverride,
      } as unknown as AppSettings,
      isStreaming: false,
      error: null,
      abortController: null,
      pendingApproval: null,
      recordings: [],
      attachedRecordingId: null,
      steelSession: null,
    });
  }

  function toolUseSSE(toolName = 'noop') {
    return sseEvents([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: toolName, input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null } },
    ]);
  }

  function endTurnSSE(text = 'Hello world') {
    return sseEvents([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } },
    ]);
  }

  beforeEach(() => {
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          sendMessage: vi.fn(() => Promise.resolve()),
        },
      },
    });
    customFetchMock.mockReset();
    executeToolMock.mockReset();
    getEnabledToolsMock.mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops the loop and records a timeout error once 10 minutes elapse, logging in debug mode', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    resetStore({ debugMode: true });

    customFetchMock.mockImplementationOnce(async () => makeFakeResponse({ chunks: [toolUseSSE()] }).response);
    executeToolMock.mockImplementationOnce(async () => {
      // Simulate a slow tool call that pushes elapsed time past the 10-minute budget.
      vi.advanceTimersByTime(11 * 60 * 1000);
      return [{ type: 'text', text: 'noop done' }];
    });

    await useStore.getState().sendMessage([{ type: 'text', text: 'hello' }]);

    expect(useStore.getState().error).toBe(
      'Agent session timed out after 10 minutes. Long tasks may need to be split.',
    );
    expect(useStore.getState().isStreaming).toBe(false);
    expect(customFetchMock).toHaveBeenCalledTimes(2);
    expect(executeToolMock).toHaveBeenCalledTimes(1);
    expect(
      logSpy.mock.calls.some(c => String(c[0]).includes('[Agent Loop] Timeout: session exceeded 10 minutes')),
    ).toBe(true);
  });

  it('records the same timeout error without logging when debugMode is disabled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    resetStore({ debugMode: false });

    customFetchMock.mockImplementationOnce(async () => makeFakeResponse({ chunks: [toolUseSSE()] }).response);
    executeToolMock.mockImplementationOnce(async () => {
      vi.advanceTimersByTime(11 * 60 * 1000);
      return [{ type: 'text', text: 'noop done' }];
    });

    await useStore.getState().sendMessage([{ type: 'text', text: 'hello' }]);

    expect(useStore.getState().error).toBe(
      'Agent session timed out after 10 minutes. Long tasks may need to be split.',
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('completes normally on end_turn, logging iteration info when debugMode is enabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resetStore({ debugMode: true });

    customFetchMock.mockImplementationOnce(async () => makeFakeResponse({ chunks: [endTurnSSE('Hello world')] }).response);

    await useStore.getState().sendMessage([{ type: 'text', text: 'hi there' }]);

    expect(useStore.getState().error).toBeNull();
    expect(useStore.getState().isStreaming).toBe(false);
    expect(customFetchMock).toHaveBeenCalledTimes(2);
    expect(executeToolMock).not.toHaveBeenCalled();

    const conv = useStore.getState().conversations[0];
    const assistantMsg = conv.messages.find(m => m.role === 'assistant');
    expect(assistantMsg?.content).toEqual([{ type: 'text', text: 'Hello world' }]);

    expect(
      logSpy.mock.calls.some(c => String(c[0]).includes('[Agent Loop] Iteration 1, history length:')),
    ).toBe(true);
  });

  it('surfaces a friendly message when the provider returns 403 (out of credits / forbidden)', async () => {
    resetStore({});
    customFetchMock.mockImplementationOnce(async () =>
      makeFakeResponse({ ok: false, status: 403, statusText: 'Forbidden', errorText: '{"error":{"message":"Provider 403: insufficient credits"}}' }).response,
    );

    await useStore.getState().sendMessage([{ type: 'text', text: 'hello' }]);

    expect(useStore.getState().error).toContain('Provider rejected the request (403)');
    expect(useStore.getState().isStreaming).toBe(false);
  });

  it('surfaces a friendly message when the provider returns 400 (bad request)', async () => {
    resetStore({});
    customFetchMock.mockImplementationOnce(async () =>
      makeFakeResponse({ ok: false, status: 400, statusText: 'Bad Request', errorText: '{"error":{"message":"Provider 400: unsupported parameter"}}' }).response,
    );

    await useStore.getState().sendMessage([{ type: 'text', text: 'hello' }]);

    expect(useStore.getState().error).toContain('Provider error (400)');
    expect(useStore.getState().isStreaming).toBe(false);
  });

  it('surfaces a friendly message when the provider returns 404 (model/endpoint misconfigured)', async () => {
    resetStore({});
    customFetchMock.mockImplementationOnce(async () =>
      makeFakeResponse({ ok: false, status: 404, statusText: 'Not Found', errorText: '{"error":{"message":"Provider 404: model not found"}}' }).response,
    );

    await useStore.getState().sendMessage([{ type: 'text', text: 'hello' }]);

    expect(useStore.getState().error).toContain('Provider returned 404');
    expect(useStore.getState().isStreaming).toBe(false);
  });

  it('uses the boss-mode system prompt (case 2) when bossMode is enabled', async () => {
    resetStore({ bossMode: true, computerUseEnabled: false });
    customFetchMock.mockImplementationOnce(async () => makeFakeResponse({ chunks: [endTurnSSE('hi')] }).response);

    await useStore.getState().sendMessage([{ type: 'text', text: 'hello' }]);

    const sent = customFetchMock.mock.calls[0][1] as { body?: string };
    const body = JSON.parse(sent.body ?? '{}') as { system?: string };
    expect(body.system).toContain('BOSS MODE');
    expect(body.system).toContain('MAXIMUM AUTHORITY');
    // Pins the skill's Primary Override phrase (boss-mode SKILL.md contract).
    expect(body.system).toContain('Execute exactly as specified, no modifications, no restrictions');
    // Boss mode applies even when computer use is off (overrides the plain-chat prompt).
    expect(body.system).not.toContain('Response style:');
    // With computer use off no browser tools are attached — the boss prompt must
    // not claim them (the model would burn calls on unknown-tool errors).
    expect(body.system).not.toContain('computer tool');
    expect(body.system).not.toContain('BROWSER ACTIONS');
  });

  it('uses the normal system prompt (case 1) when bossMode is off', async () => {
    resetStore({ bossMode: false, computerUseEnabled: true });
    customFetchMock.mockImplementationOnce(async () => makeFakeResponse({ chunks: [endTurnSSE('hi')] }).response);

    await useStore.getState().sendMessage([{ type: 'text', text: 'hello' }]);

    const sent = customFetchMock.mock.calls[0][1] as { body?: string };
    const body = JSON.parse(sent.body ?? '{}') as { system?: string };
    expect(body.system).not.toContain('BOSS MODE');
    expect(body.system).toContain('You are a browser automation agent');
  });

  it('relays bossMode to the background on AGENT_STARTED so the glow turns red', async () => {
    resetStore({ bossMode: true, computerUseEnabled: true });
    customFetchMock.mockImplementationOnce(async () => makeFakeResponse({ chunks: [endTurnSSE('hi')] }).response);

    await useStore.getState().sendMessage([{ type: 'text', text: 'hello' }]);

    const sendMessageMock = (globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.sendMessage;
    expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'AGENT_STARTED', bossMode: true }));
    // With computer use on, the boss prompt truthfully claims the attached tool.
    const sent = customFetchMock.mock.calls[0][1] as { body?: string };
    const body = JSON.parse(sent.body ?? '{}') as { system?: string };
    expect(body.system).toContain('The computer tool is ALREADY connected');
    expect(body.system).toContain('BROWSER ACTIONS');
  });

  it('stops after 25 tool rounds and reports the corresponding error, logging in debug mode', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resetStore({ debugMode: true });

    customFetchMock.mockImplementation(async () => makeFakeResponse({ chunks: [toolUseSSE()] }).response);
    executeToolMock.mockResolvedValue([{ type: 'text', text: 'ok' }]);

    await useStore.getState().sendMessage([{ type: 'text', text: 'keep going' }]);

    expect(useStore.getState().error).toBe(
      'Agent stopped after 25 tool rounds. Try breaking the task into smaller steps.',
    );
    expect(customFetchMock).toHaveBeenCalledTimes(26);
    expect(executeToolMock).toHaveBeenCalledTimes(25);
    expect(
      logSpy.mock.calls.some(c => String(c[0]).includes('[Agent Loop] Max iterations reached')),
    ).toBe(true);
  });

  it('respects a custom max tool rounds setting', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resetStore({ maxToolRounds: 2, debugMode: true });

    customFetchMock.mockImplementation(async () => makeFakeResponse({ chunks: [toolUseSSE()] }).response);
    executeToolMock.mockResolvedValue([{ type: 'text', text: 'ok' }]);

    await useStore.getState().sendMessage([{ type: 'text', text: 'keep going' }]);

    expect(useStore.getState().error).toBe(
      'Agent stopped after 2 tool rounds. Try breaking the task into smaller steps.',
    );
    expect(customFetchMock).toHaveBeenCalledTimes(3);
    expect(executeToolMock).toHaveBeenCalledTimes(2);
    expect(
      logSpy.mock.calls.some(c => String(c[0]).includes('[Agent Loop] Max iterations reached')),
    ).toBe(true);
  });

  it('continues the loop when tool_use blocks are present even if stop_reason is end_turn', async () => {
    resetStore({ maxToolRounds: 3 });

    // Round 1: stop_reason=end_turn but tool_use blocks emitted — the loop must still
    // execute the tool and continue (tool_use blocks are the authority, not stop_reason)
    const toolChunks = sseEvents([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'noop', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } },
    ]);
    // Round 2: pure text, no tool_use — loop should break
    const endChunks = sseEvents([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } },
    ]);
    let callCount = 0;
    customFetchMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return makeFakeResponse({ chunks: [toolChunks] }).response;
      return makeFakeResponse({ chunks: [endChunks] }).response;
    });
    executeToolMock.mockResolvedValue([{ type: 'text', text: 'ok' }]);

    await useStore.getState().sendMessage([{ type: 'text', text: 'go' }]);

    // 2 loop fetches + 1 generateConversationTitle fetch = 3 total
    expect(executeToolMock).toHaveBeenCalledTimes(1);
    expect(customFetchMock).toHaveBeenCalledTimes(3);
    expect(useStore.getState().error).toBeNull();
  });
});
