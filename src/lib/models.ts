import type { ProviderConfig } from './types';
import { PROVIDERS } from './openai-compat';

export interface ModelList {
  free: string[];
  paid: string[];
}

// Model IDs that indicate non-chat models (embeddings, image-gen, TTS, etc.)
const NON_CHAT =
  /embedding|tts-|whisper|dall-e|stable-diffus|text-to-image|image-gen|moderation|rerank|audio-|omni-mini-tts|babbage|ada-002|davinci-002|text-search|code-search/i;

// Providers where every model is free (local or open-access)
const ALL_FREE = new Set(['ollama', 'lmstudio', 'pollinations']);

// Name patterns that strongly suggest a free / low-cost tier.
// Deliberately conservative: unknown models default to "paid".
const FREE_PATTERN =
  /\bfree\b|gemini-(?:2\.0-)?flash(?!-thinking|-exp-adv)|-flash-lite\b|gpt-4o-mini|o4-mini\b|llama-3\.1-8b|llama-3\.2\b|llama-3\.2-(?:1|3)b|gemma|phi-|mistral-7b|open-mistral-7b|codestral-mamba|ministral-3b|pixtral-12b|qwen-turbo|deepseek-v3\b|glm-4-flash|abab5\.5|llama-3\.1-(?:8b|70b)-instant\b/i;

interface RawModel {
  id: string;
  object?: string;
  pricing?: { prompt?: string | number; completion?: string | number };
}

interface ModelsResponse {
  data?: RawModel[];
  models?: RawModel[];  // some providers use { models: [...] }
  object?: string;
}

export async function fetchProviderModels(config: ProviderConfig): Promise<ModelList> {
  const preset = PROVIDERS[config.provider];
  const base = (config.baseURL || preset?.baseURL || '').replace(/\/$/, '');
  if (!base) return { free: [], paid: [] };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);

  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

    const resp = await fetch(`${base}/models`, { headers, signal: ctrl.signal });
    if (!resp.ok) return { free: [], paid: [] };

    const raw = await resp.json() as ModelsResponse;
    // Normalise: support both { data: [...] } and { models: [...] }
    const items = (raw.data ?? raw.models ?? []) as RawModel[];

    // Keep only chat-compatible models
    const chat = items.filter(m => m.id && !NON_CHAT.test(m.id));
    if (chat.length === 0) return { free: [], paid: [] };

    const allFree = ALL_FREE.has(config.provider);
    const free: string[] = [];
    const paid: string[] = [];

    for (const m of chat) {
      if (allFree) {
        free.push(m.id);
      } else if (m.pricing !== undefined) {
        // OpenRouter and a few others provide explicit pricing
        const cost = parseFloat(String(m.pricing.prompt ?? '1'));
        (cost === 0 ? free : paid).push(m.id);
      } else {
        // Heuristic: classify by well-known model-name patterns
        (FREE_PATTERN.test(m.id) ? free : paid).push(m.id);
      }
    }

    free.sort((a, b) => a.localeCompare(b));
    paid.sort((a, b) => a.localeCompare(b));
    return { free, paid };
  } catch {
    return { free: [], paid: [] };
  } finally {
    clearTimeout(timeout);
  }
}
