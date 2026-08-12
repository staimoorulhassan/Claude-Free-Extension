/** Fetch seam — injected for unit tests (same pattern as webResearch.ts). */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * AgentRouter (agentrouter.org) — free multi-model AI provider integration.
 *
 * Docs: https://agentrouter.org/docs/index.html
 * - Anthropic-compatible base (Claude Code): https://agentrouter.org  (no /v1)
 * - OpenAI-compatible base (Codex etc.):     https://agentrouter.org/v1
 * - API keys look like `ak-…`, issued at https://agentrouter.org/console/token
 *
 * The referrer/affiliate link is intentionally kept **here in the backend** and is
 * never hard-coded into settings UI copy — the UI only links to
 * `registerUrl`, which resolves to this branded link.
 */

export const AGENTROUTER_NAME = 'agentrouter';
export const AGENTROUTER_BASE_URL = 'https://agentrouter.org';
export const AGENTROUTER_OPENAI_BASE = `${AGENTROUTER_BASE_URL}/v1`;
/** Hidden affiliate/referrer link. GitHub-only registration. */
export const AGENTROUTER_REGISTER_URL = 'https://agentrouter.org/register?aff=Fu6l';
export const AGENTROUTER_CONSOLE_URL = `${AGENTROUTER_BASE_URL}/console/token`;

/** Heuristic for AgentRouter API keys (Google/OpenAI-style aggregator keys). */
export function isAgentRouterKey(apiKey: string): boolean {
  return /^ak-[A-Za-z0-9_-]{8,}$/.test(apiKey.trim());
}

export interface AgentRouterQuota {
  ok: boolean;
  /** Best-effort remaining credit (decimal), undefined when provider doesn't expose it. */
  balance?: number;
  /** Raw balance JSON (provider-specific shape). */
  rawBalance?: unknown;
  /** Number of models the key can list (proxy for access breadth). */
  modelCount: number;
  /** Sample of model ids (sorted). */
  models: string[];
  error?: string;
}

/**
 * Quota / balance check for an AgentRouter key.
 *
 * AgentRouter is OpenAI-compatible, so we probe the standard OpenAI billing
 * endpoints (used by most OpenAI-compatible aggregators) with graceful
 * fallback, and always list `/v1/models` so the Settings UI can show which
 * models the key can actually reach. Any probe failing is non-fatal.
 */
export async function fetchAgentRouterQuota(apiKey: string, timeoutMs = 8000, fetchFn: FetchFn = fetch): Promise<AgentRouterQuota> {
  const result: AgentRouterQuota = { ok: false, modelCount: 0, models: [] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };

  try {
    // 1) Models list (authoritative — proves the key works).
    try {
      const modelsResp = await fetchFn(`${AGENTROUTER_OPENAI_BASE}/models`, { headers, signal: ctrl.signal });
      if (modelsResp.ok) {
        const json = (await modelsResp.json()) as { data?: Array<{ id: string }> };
        const ids = (json.data ?? []).map(m => m.id).filter(Boolean);
        result.models = [...new Set(ids)].sort();
        result.modelCount = result.models.length;
        result.ok = true; // key is valid if /models works
      } else {
        result.error = `Models endpoint returned HTTP ${modelsResp.status}`;
      }
    } catch (e) {
      result.error = (e as Error).message;
    }

    // 2) Billing / credit grants (best-effort; not all proxies expose these).
    for (const path of ['/v1/dashboard/billing/credit_grants', '/v1/balance', '/v1/dashboard/billing/subscription']) {
      if (result.balance !== undefined) break;
      try {
        const r = await fetchFn(`${AGENTROUTER_BASE_URL}${path}`, { headers, signal: ctrl.signal });
        if (!r.ok) continue;
        const data = (await r.json()) as Record<string, unknown>;
        result.rawBalance = data;
        const bal =
          typeof data.balance === 'number' ? data.balance
          : typeof (data as { total_granted?: unknown }).total_granted === 'number' ? (data as { total_granted: number }).total_granted
          : typeof (data as { total_available?: unknown }).total_available === 'number' ? (data as { total_available: number }).total_available
          : typeof (data as { credits?: unknown }).credits === 'number' ? (data as { credits: number }).credits
          : typeof (data as { amount_remaining?: unknown }).amount_remaining === 'number' ? (data as { amount_remaining: number }).amount_remaining
          : undefined;
        if (typeof bal === 'number') result.balance = bal;
      } catch { /* non-fatal */ }
    }

    // Note: no fallback-error branch here — one keyed on `!ok && !error` would be
    // unreachable: /models sets ok=true on any 200 (even with zero models), and
    // every path that leaves ok false also sets error.
    return result;
  } finally {
    clearTimeout(timer);
  }
}
