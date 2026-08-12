import { describe, it, expect, vi } from 'vitest';
import type { FetchFn } from './agentrouter';
import { fetchAgentRouterQuota } from './agentrouter';

// ── Fake fetch (the module's FetchFn seam, same driver as webResearch.test.ts) ─
// Rejects unexpected URLs loudly and honors the AbortSignal.

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const MODELS_URL = 'https://agentrouter.org/v1/models';
const CREDIT_URL = 'https://agentrouter.org/v1/dashboard/billing/credit_grants';
const BALANCE_URL = 'https://agentrouter.org/v1/balance';
const SUB_URL = 'https://agentrouter.org/v1/dashboard/billing/subscription';

const KEY = 'ak-test-key-1234';

describe('fetchAgentRouterQuota', () => {
  it('lists and dedups models, then stops at the first successful billing probe', async () => {
    const handler = vi.fn();
    const fetchFn = fakeFetch((url, init) => {
      handler(url, init);
      if (url === MODELS_URL) return Promise.resolve(jsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] }));
      if (url === CREDIT_URL) return Promise.resolve(jsonResponse({ balance: 12.5 }));
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const result = await fetchAgentRouterQuota(KEY, 8000, fetchFn);

    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(2); // deduped
    expect(result.models).toEqual(['gpt-4o', 'gpt-4o-mini']); // sorted
    expect(result.balance).toBe(12.5);
    expect(result.rawBalance).toEqual({ balance: 12.5 });
    // Exact probe sequence: models, then credit_grants — and nothing after (early break).
    expect(handler.mock.calls.map((c) => c[0])).toEqual([MODELS_URL, CREDIT_URL]);
    expect(handler).toHaveBeenCalledWith(
      MODELS_URL,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${KEY}` }) }),
    );
  });

  it('falls through to later billing probes and extracts alternate balance shapes', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url === MODELS_URL) return Promise.resolve(jsonResponse({ data: [{ id: 'm1' }] }));
      if (url === CREDIT_URL) return Promise.resolve(jsonResponse({}, 404));
      if (url === BALANCE_URL) return Promise.resolve(jsonResponse({ total_granted: 100 }));
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const result = await fetchAgentRouterQuota(KEY, 8000, fetchFn);

    expect(result.ok).toBe(true);
    expect(result.balance).toBe(100); // total_granted shape
    expect(result.rawBalance).toEqual({ total_granted: 100 });
  });

  it('reports a models HTTP error but keeps probing billing', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url === MODELS_URL) return Promise.resolve(jsonResponse({}, 401));
      if (url === CREDIT_URL) return Promise.resolve(jsonResponse({ credits: 5 }));
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const result = await fetchAgentRouterQuota(KEY, 8000, fetchFn);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Models endpoint returned HTTP 401');
    expect(result.balance).toBe(5); // credits shape still extracted
  });

  it('captures the models probe rejection message as the error', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url === MODELS_URL) return Promise.reject(new TypeError('network down'));
      if (url === CREDIT_URL) return Promise.resolve(jsonResponse({ amount_remaining: 7 }));
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const result = await fetchAgentRouterQuota(KEY, 8000, fetchFn);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('network down');
    expect(result.balance).toBe(7); // amount_remaining shape
  });

  it('treats an OK-but-empty /models as a valid key with zero models', async () => {
    // Pins the reachable behavior that makes the old fallback-error branch
    // (keyed on `!ok && !error`) unreachable — it was removed as dead code:
    // `ok` is true whenever /models returns 200 even with zero models, and
    // every path that leaves ok false also sets error.
    const fetchFn = fakeFetch((url) => {
      if (url === MODELS_URL) return Promise.resolve(jsonResponse({ data: [] }));
      if (url === CREDIT_URL) return Promise.resolve(jsonResponse({}, 404));
      if (url === BALANCE_URL) return Promise.resolve(jsonResponse({}, 404));
      if (url === SUB_URL) return Promise.resolve(jsonResponse({}, 404));
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const result = await fetchAgentRouterQuota(KEY, 8000, fetchFn);

    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(0);
    expect(result.models).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(result.balance).toBeUndefined();
  });

  it('aborts on the timeout and reports the abort as the error', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = fakeFetch(() => new Promise<Response>(() => {})); // never settles
      const promise = fetchAgentRouterQuota(KEY, 8000, fetchFn);
      vi.advanceTimersByTime(8000);
      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/abort/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
