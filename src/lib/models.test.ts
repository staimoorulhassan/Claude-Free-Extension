import { describe, it, expect, vi } from 'vitest';
import type { ProviderConfig } from './types';
import type { FetchFn } from './models';
import { fetchProviderModels } from './models';

// ── Fake fetch (the module's FetchFn seam, same driver as webResearch.test.ts) ─
// Rejects unexpected URLs loudly and honors the AbortSignal, so wiring bugs and
// the 8s timeout path are exercised for real without any network.

function fakeFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): FetchFn {
  return (url, init) => {
    const signal = init?.signal;
    if (!signal) return handler(url, init);
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      handler(url, init).then(
        (r) => { signal.removeEventListener('abort', onAbort); resolve(r); },
        (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
      );
    });
  };
}

function routeFake(routes: Record<string, { body: unknown; status?: number }>): FetchFn {
  return fakeFetch((url) => {
    const hit = routes[url];
    if (!hit) return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    return Promise.resolve(
      new Response(JSON.stringify(hit.body), { status: hit.status ?? 200, headers: { 'Content-Type': 'application/json' } }),
    );
  });
}

// 'test' provider has no preset, so the base comes from the explicit baseURL
// and the FREE_PATTERN heuristic decides classification — no coupling to the
// PROVIDERS table's data.
function config(over: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: 'test',
    apiKey: 'sk-test',
    baseURL: 'https://openrouter.ai/api/v1',
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('fetchProviderModels', () => {
  it('classifies by FREE_PATTERN, filters non-chat models, and sorts; sends auth + signal', async () => {
    const handler = vi.fn();
    const fetchFn = fakeFetch((url, init) => {
      handler(url, init);
      return Promise.resolve(jsonResponse({
        data: [
          { id: 'gpt-4o-mini' },          // FREE_PATTERN -> free
          { id: 'gpt-4o' },               // paid
          { id: 'text-embedding-3-small' }, // NON_CHAT -> dropped
          { id: 'zephyr-7b' },            // unknown -> paid (conservative)
        ],
      }));
    });

    const result = await fetchProviderModels(config(), fetchFn);

    expect(result).toEqual({ free: ['gpt-4o-mini'], paid: ['gpt-4o', 'zephyr-7b'] });
    expect(handler).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('normalizes the { models: [...] } response shape and treats ALL_FREE providers as all-free', async () => {
    const fetchFn = routeFake({
      'http://localhost:11434/models': { body: { models: [{ id: 'llama3.1' }, { id: 'mistral-7b' }] } },
    });
    const result = await fetchProviderModels(config({ provider: 'ollama', apiKey: '', baseURL: 'http://localhost:11434' }), fetchFn);
    expect(result).toEqual({ free: ['llama3.1', 'mistral-7b'], paid: [] });
  });

  it('uses explicit pricing when present: zero-cost is free, positive-cost is paid', async () => {
    const fetchFn = routeFake({
      'https://openrouter.ai/api/v1/models': {
        body: { data: [
          { id: 'freebie', pricing: { prompt: '0' } },
          { id: 'paying', pricing: { prompt: '0.0000015' } },
        ] },
      },
    });
    const result = await fetchProviderModels(config(), fetchFn);
    expect(result).toEqual({ free: ['freebie'], paid: ['paying'] });
  });

  it('returns empty without fetching for a half-typed base URL (host without a registrable domain)', async () => {
    const handler = vi.fn(fakeFetch(() => Promise.resolve(jsonResponse({ data: [] }))));
    const result = await fetchProviderModels(config({ baseURL: 'https://agentrou' }), handler);
    expect(result).toEqual({ free: [], paid: [] });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns empty without fetching for an unparseable base URL', async () => {
    const handler = vi.fn(fakeFetch(() => Promise.resolve(jsonResponse({ data: [] }))));
    const result = await fetchProviderModels(config({ baseURL: 'not a url' }), handler);
    expect(result).toEqual({ free: [], paid: [] });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns empty on a non-OK response', async () => {
    const fetchFn = routeFake({ 'https://openrouter.ai/api/v1/models': { body: {}, status: 500 } });
    expect(await fetchProviderModels(config(), fetchFn)).toEqual({ free: [], paid: [] });
  });

  it('returns empty on a network rejection', async () => {
    const fetchFn = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await fetchProviderModels(config(), fetchFn)).toEqual({ free: [], paid: [] });
  });

  it('returns empty when no chat-compatible models remain after filtering', async () => {
    const fetchFn = routeFake({
      'https://openrouter.ai/api/v1/models': { body: { data: [{ id: 'text-embedding-3-small' }] } },
    });
    expect(await fetchProviderModels(config(), fetchFn)).toEqual({ free: [], paid: [] });
  });

  it('aborts on the 8s timeout and returns empty lists', async () => {
    vi.useFakeTimers();
    try {
      // Never-settling handler: only the module's AbortController can end it.
      const fetchFn = fakeFetch(() => new Promise<Response>(() => {}));
      const promise = fetchProviderModels(config(), fetchFn);
      vi.advanceTimersByTime(8000);
      await expect(promise).resolves.toEqual({ free: [], paid: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});
