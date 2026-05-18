/**
 * TypeScript port of openai-compat-fetch.js.
 * Intercepts Anthropic /v1/messages calls and routes to any OpenAI-compatible provider.
 */

import type { ProviderConfig } from './types';

// ─── Provider presets ──────────────────────────────────────────────────────────

interface ProviderPreset {
  baseURL: string;
  defaultModel: string;
  supportsVision: boolean;
  supportsTools: boolean;
  modelMap: Record<string, string>;
}

export const PROVIDERS: Record<string, ProviderPreset> = {
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    supportsVision: true,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'gemini-2.5-pro',
      'claude-opus-4-5': 'gemini-2.5-pro',
      'claude-sonnet-4-6': 'gemini-2.0-flash',
      'claude-sonnet-4-5': 'gemini-2.0-flash',
      'claude-haiku-4-5': 'gemini-2.0-flash-lite',
      'claude-3-5-sonnet-20241022': 'gemini-2.0-flash',
      'claude-3-5-haiku-20241022': 'gemini-2.0-flash-lite',
      'claude-3-opus-20240229': 'gemini-2.5-pro',
    },
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    supportsVision: false,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'deepseek-reasoner',
      'claude-opus-4-5': 'deepseek-reasoner',
      'claude-sonnet-4-6': 'deepseek-chat',
      'claude-sonnet-4-5': 'deepseek-chat',
      'claude-haiku-4-5': 'deepseek-chat',
    },
  },
  qwen: {
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-max',
    supportsVision: true,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'qwen-max',
      'claude-sonnet-4-6': 'qwen-plus',
      'claude-haiku-4-5': 'qwen-turbo',
    },
  },
  minimax: {
    baseURL: 'https://api.minimax.chat/v1',
    defaultModel: 'MiniMax-Text-01',
    supportsVision: true,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'MiniMax-Text-01',
      'claude-sonnet-4-6': 'abab6.5s-chat',
      'claude-haiku-4-5': 'abab5.5s-chat',
    },
  },
  glm: {
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4',
    supportsVision: true,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'glm-4-plus',
      'claude-sonnet-4-6': 'glm-4',
      'claude-haiku-4-5': 'glm-4-flash',
    },
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    supportsVision: true,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'gpt-4o',
      'claude-sonnet-4-6': 'gpt-4o',
      'claude-haiku-4-5': 'gpt-4o-mini',
    },
  },
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    supportsVision: false,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'llama-3.3-70b-versatile',
      'claude-haiku-4-5': 'llama-3.1-8b-instant',
    },
  },
  mistral: {
    baseURL: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    supportsVision: true,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'mistral-large-latest',
      'claude-haiku-4-5': 'mistral-small-latest',
    },
  },
  ollama: {
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    supportsVision: true,
    supportsTools: true,
    modelMap: {},
  },
  lmstudio: {
    baseURL: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    supportsVision: false,
    supportsTools: true,
    modelMap: {},
  },
  pollinations: {
    baseURL: 'https://gen.pollinations.ai/v1',
    defaultModel: 'openai-large',
    supportsVision: true,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'openai-large',
      'claude-opus-4-5': 'openai-large',
      'claude-sonnet-4-6': 'openai-large',
      'claude-sonnet-4-5': 'openai-large',
      'claude-haiku-4-5': 'openai-large',
      'claude-3-5-sonnet-20241022': 'openai-large',
      'claude-3-5-haiku-20241022': 'openai-large',
      'claude-3-opus-20240229': 'openai-large',
    },
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o',
    supportsVision: true,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'anthropic/claude-opus-4',
      'claude-opus-4-5': 'anthropic/claude-opus-4-5',
      'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-5',
      'claude-sonnet-4-5': 'anthropic/claude-sonnet-4-5',
      'claude-haiku-4-5': 'anthropic/claude-haiku-4-5',
      'claude-3-5-sonnet-20241022': 'anthropic/claude-3.5-sonnet',
      'claude-3-5-haiku-20241022': 'anthropic/claude-3.5-haiku',
      'claude-3-opus-20240229': 'anthropic/claude-3-opus',
    },
  },
  fireworks: {
    baseURL: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    supportsVision: true,
    supportsTools: true,
    modelMap: {
      'claude-opus-4-7': 'accounts/fireworks/models/llama-v3p1-405b-instruct',
      'claude-sonnet-4-6': 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      'claude-haiku-4-5': 'accounts/fireworks/models/llama-v3p1-8b-instruct',
    },
  },
};

// ─── Format translators — Anthropic → OpenAI ──────────────────────────────────

interface OAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail: string };
}

interface OAIMessage {
  role: string;
  content: string | null | OAIContentPart[];
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
}

interface OAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

function blockToOAI(block: unknown, vision: boolean): OAIContentPart | null {
  const b = block as Record<string, unknown>;
  if (typeof b === 'string') return { type: 'text', text: b as string };
  switch (b.type) {
    case 'text': return { type: 'text', text: b.text as string };
    case 'thinking': return { type: 'text', text: `<thinking>${b.thinking}</thinking>` };
    case 'image': {
      if (!vision) return { type: 'text', text: '[Image omitted — provider does not support vision]' };
      const src = b.source as Record<string, unknown>;
      if (src.type === 'base64')
        return { type: 'image_url', image_url: { url: `data:${src.media_type};base64,${src.data}`, detail: 'auto' } };
      if (src.type === 'url')
        return { type: 'image_url', image_url: { url: src.url as string, detail: 'auto' } };
      return { type: 'text', text: '[Unsupported image source]' };
    }
    case 'tool_use':
    case 'tool_result':
      return null;
    default:
      return { type: 'text', text: `[${b.type}]` };
  }
}

function contentToOAI(content: unknown, vision: boolean): string | OAIContentPart[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content);
  const parts = (content as unknown[]).map(b => blockToOAI(b, vision)).filter(Boolean) as OAIContentPart[];
  return parts.every(p => p.type === 'text') ? parts.map(p => p.text!).join('') : parts;
}

function messageToOAI(msg: { role: string; content: unknown }, vision: boolean): OAIMessage[] {
  const { role, content } = msg;
  if (role === 'assistant') {
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: content }];
    const texts = (blocks as Record<string, unknown>[]).filter(b => b.type === 'text' || b.type === 'thinking');
    const toolBlocks = (blocks as Record<string, unknown>[]).filter(b => b.type === 'tool_use');
    const m: OAIMessage = { role: 'assistant', content: null };
    const txt = texts.map(b => b.type === 'thinking' ? `<thinking>${b.thinking}</thinking>` : b.text as string).join('');
    if (txt) m.content = txt;
    if (toolBlocks.length) {
      m.tool_calls = toolBlocks.map(b => ({
        id: b.id as string,
        type: 'function' as const,
        function: { name: b.name as string, arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {}) },
      }));
      if (!m.content) m.content = null;
    }
    return [m];
  }
  if (role === 'user') {
    const blocks = Array.isArray(content) ? content as Record<string, unknown>[] : [{ type: 'text', text: content }];
    const toolResults = blocks.filter(b => b.type === 'tool_result');
    const others = blocks.filter(b => b.type !== 'tool_result');
    const msgs: OAIMessage[] = [];
    if (others.length) {
      const c = contentToOAI(others, vision);
      if (c && (typeof c !== 'string' || c.trim())) msgs.push({ role: 'user', content: c });
    }
    for (const tr of toolResults) {
      let c: string;
      if (Array.isArray(tr.content)) {
        const r = contentToOAI(tr.content as unknown[], vision);
        c = typeof r === 'string' ? r : JSON.stringify(r);
      } else {
        c = String(tr.content ?? '');
      }
      msgs.push({ role: 'tool', content: c, tool_call_id: tr.tool_use_id as string });
    }
    return msgs.length ? msgs : [{ role: 'user', content: '' }];
  }
  return [{ role, content: contentToOAI(content, vision) }];
}

function mapFinishReason(r: string | null | undefined): string {
  switch (r) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool_calls': return 'tool_use';
    default: return r ?? 'end_turn';
  }
}

// ─── SSE stream translator — OpenAI → Anthropic ───────────────────────────────

function buildAnthropicStream(openaiStream: ReadableStream<Uint8Array>, anthropicModel: string, msgId: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function sse(event: string, data: unknown) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  return new ReadableStream({
    async start(ctrl) {
      const enq = (s: string) => ctrl.enqueue(enc.encode(s));
      try {
        enq(sse('message_start', { type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', content: [], model: anthropicModel, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }));
        enq(sse('ping', { type: 'ping' }));

        const reader = openaiStream.getReader();
        let buf = '', blockIdx = 0, textOpen = false, anyBlock = false;
        let outTokens = 0, stopReason = 'end_turn';
        const toolMap: Record<number, number> = {};

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const raw = t.slice(5).trim();
            if (raw === '[DONE]') continue;
            let chunk: Record<string, unknown>;
            try { chunk = JSON.parse(raw); } catch { continue; }

            if (chunk['usage'] && !chunk['choices']) {
              outTokens = (chunk['usage'] as Record<string, number>)['completion_tokens'] ?? outTokens;
              continue;
            }
            const choice = (chunk['choices'] as Record<string, unknown>[])?.[0];
            if (!choice) continue;
            const delta = (choice['delta'] ?? {}) as Record<string, unknown>;
            if (chunk['usage']) outTokens = (chunk['usage'] as Record<string, number>)['completion_tokens'] ?? outTokens;

            if (delta['content']) {
              if (!textOpen) {
                textOpen = true; anyBlock = true;
                enq(sse('content_block_start', { type: 'content_block_start', index: blockIdx, content_block: { type: 'text', text: '' } }));
              }
              enq(sse('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: delta['content'] } }));
            }

            if (Array.isArray(delta['tool_calls'])) {
              if (textOpen) { enq(sse('content_block_stop', { type: 'content_block_stop', index: blockIdx })); blockIdx++; textOpen = false; }
              for (const tc of delta['tool_calls'] as Record<string, unknown>[]) {
                const ti = (tc['index'] as number) ?? 0;
                if (!(ti in toolMap)) {
                  const bi = blockIdx++;
                  toolMap[ti] = bi; anyBlock = true;
                  enq(sse('content_block_start', { type: 'content_block_start', index: bi, content_block: { type: 'tool_use', id: tc['id'] ?? `toolu_${Date.now()}_${ti}`, name: (tc['function'] as Record<string, unknown>)?.['name'] ?? '', input: {} } }));
                }
                const fn = tc['function'] as Record<string, unknown> | undefined;
                if (fn?.['arguments'] != null)
                  enq(sse('content_block_delta', { type: 'content_block_delta', index: toolMap[ti], delta: { type: 'input_json_delta', partial_json: fn['arguments'] } }));
              }
            }
            if (choice['finish_reason']) stopReason = mapFinishReason(choice['finish_reason'] as string);
          }
        }

        if (textOpen) enq(sse('content_block_stop', { type: 'content_block_stop', index: blockIdx }));
        if (!anyBlock) {
          enq(sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
          enq(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
        }
        for (const bi of Object.values(toolMap)) enq(sse('content_block_stop', { type: 'content_block_stop', index: bi }));
        enq(sse('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outTokens } }));
        enq(sse('message_stop', { type: 'message_stop' }));
      } catch (e) {
        enq(sse('error', { type: 'error', error: { type: 'api_error', message: String((e as Error)?.message ?? e) } }));
      } finally {
        ctrl.close();
      }
    },
  });
}

// ─── Main factory ──────────────────────────────────────────────────────────────

export function createOpenAICompatibleFetch(config: ProviderConfig): typeof fetch {
  const preset = PROVIDERS[config.provider] ?? {};
  const baseURL = (config.baseURL ?? preset.baseURL ?? '').replace(/\/$/, '');
  const apiKey = config.apiKey ?? '';
  const defaultModel = config.defaultModel ?? preset.defaultModel ?? 'gpt-4o';
  const modelMap = { ...(preset.modelMap ?? {}), ...(config.modelMap ?? {}) };
  const supportsVision = config.supportsVision ?? preset.supportsVision ?? true;
  const supportsTools = config.supportsTools ?? preset.supportsTools ?? true;
  const debug = config.debug ?? false;

  if (!baseURL) throw new Error('[openai-compat] No baseURL configured.');

  return async function customFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

    // Count tokens stub
    if (url.includes('/v1/messages/count_tokens')) {
      let body: unknown;
      try { body = JSON.parse((init?.body as string) ?? '{}'); } catch { body = {}; }
      return new Response(JSON.stringify({ input_tokens: Math.round(JSON.stringify(body).length / 4) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (!url.includes('/v1/messages')) return fetch(input, init);

    let ab: Record<string, unknown>;
    try { ab = JSON.parse((init?.body as string) ?? '{}'); } catch { return fetch(input, init); }

    const streaming = ab['stream'] === true;
    const anthropicModel = (ab['model'] as string) ?? defaultModel;
    const resolvedModel = modelMap[anthropicModel] ?? defaultModel;
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Build OpenAI messages
    const oaiMessages: OAIMessage[] = [];
    if (ab['system']) {
      const sys = typeof ab['system'] === 'string' ? ab['system'] : (Array.isArray(ab['system']) ? (ab['system'] as Record<string, unknown>[]).filter(b => b.type === 'text').map(b => b.text as string).join('\n\n') : '');
      if (sys) oaiMessages.push({ role: 'system', content: sys });
    }
    for (const msg of (ab['messages'] as Record<string, unknown>[]) ?? []) {
      oaiMessages.push(...messageToOAI(msg as { role: string; content: unknown }, supportsVision));
    }

    const oaiBody: Record<string, unknown> = {
      model: resolvedModel,
      messages: oaiMessages,
      stream: streaming,
    };
    if (ab['max_tokens'] != null) oaiBody['max_tokens'] = ab['max_tokens'];
    if (ab['temperature'] != null) oaiBody['temperature'] = ab['temperature'];
    if (ab['top_p'] != null) oaiBody['top_p'] = ab['top_p'];
    if (Array.isArray(ab['stop_sequences']) && ab['stop_sequences'].length) oaiBody['stop'] = ab['stop_sequences'];
    if (supportsTools && Array.isArray(ab['tools']) && ab['tools'].length) {
      oaiBody['tools'] = (ab['tools'] as Record<string, unknown>[]).map(t => ({
        type: 'function',
        function: { name: t['name'], description: t['description'] ?? '', parameters: t['input_schema'] ?? { type: 'object', properties: {}, required: [] } },
      }));
      const tc = ab['tool_choice'] as Record<string, unknown> | undefined;
      if (tc) oaiBody['tool_choice'] = tc['type'] === 'auto' ? 'auto' : tc['type'] === 'any' ? 'required' : tc['type'] === 'tool' ? { type: 'function', function: { name: tc['name'] } } : 'auto';
    }
    if (streaming) oaiBody['stream_options'] = { include_usage: true };

    if (debug) console.log('[openai-compat] →', { provider: config.provider, model: resolvedModel });

    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(oaiBody),
      signal: init?.signal ?? undefined,
    });

    if (!resp.ok) {
      const err = await resp.text();
      if (debug) console.error('[openai-compat] ✗', resp.status, err);
      return new Response(JSON.stringify({ error: { type: 'api_error', message: `Provider ${resp.status}: ${err}` } }), { status: resp.status, headers: { 'Content-Type': 'application/json' } });
    }

    if (streaming) {
      return new Response(buildAnthropicStream(resp.body!, anthropicModel, msgId), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }

    const json = await resp.json() as Record<string, unknown>;
    const choice = ((json['choices'] as Record<string, unknown>[])?.[0] ?? {}) as Record<string, unknown>;
    const msg = (choice['message'] ?? {}) as Record<string, unknown>;
    const usage = (json['usage'] ?? {}) as Record<string, number>;
    const content: unknown[] = [];
    if (msg['content']) content.push({ type: 'text', text: msg['content'] });
    if (Array.isArray(msg['tool_calls'])) {
      for (const tc of msg['tool_calls'] as Record<string, unknown>[]) {
        const fn = tc['function'] as Record<string, unknown>;
        let inp: unknown;
        try { inp = JSON.parse(fn['arguments'] as string || '{}'); } catch { inp = { _raw: fn['arguments'] }; }
        content.push({ type: 'tool_use', id: tc['id'], name: fn['name'], input: inp });
      }
    }
    return new Response(JSON.stringify({ id: msgId, type: 'message', role: 'assistant', content, model: anthropicModel, stop_reason: mapFinishReason(choice['finish_reason'] as string), stop_sequence: null, usage: { input_tokens: usage['prompt_tokens'] ?? 0, output_tokens: usage['completion_tokens'] ?? 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}
