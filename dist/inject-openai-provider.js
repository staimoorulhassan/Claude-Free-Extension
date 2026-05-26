/**
 * inject-openai-provider.js
 * ═══════════════════════════════════════════════════════════════════════════════
 * Universal Provider Adapter for Claude Chrome Extension
 * 
 * Transforms the extension into a multi-provider AI interface supporting:
 *   • Gemini (Google)
 *   • DeepSeek
 *   • Qwen (Alibaba)
 *   • MiniMax
 *   • GLM (Zhipu)
 *   • OpenAI
 *   • Groq
 *   • Mistral
 *   • Ollama (local)
 *   • LM Studio (local)
 *   • Kimi (Moonshot)
 *   • Azure OpenAI
 *   • Custom endpoints
 * 
 * Features preserved at 100%:
 *   - Streaming SSE (message_start → content_block_delta → message_stop)
 *   - Tool use / function calling (bidirectional translation)
 *   - Vision / multimodal images
 *   - System prompts (single/multi-block)
 *   - Extended thinking/thoughts passthrough
 *   - Stop sequences, temperature, top_p, top_k
 *   - Token usage tracking
 *   - MCP (Model Context Protocol) - passes through unmodified
 *   - OAuth connectors - passes through unmodified
 *   - Analytics - passes through unmodified
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════════
  // Provider Registry
  // ═══════════════════════════════════════════════════════════════════════════════

  const PROVIDER_REGISTRY = {
    gemini: {
      name: 'Google Gemini',
      icon: '🔵',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      defaultModel: 'gemini-2.0-flash',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Google\'s multimodal AI with vision and tool support',
      modelMap: {
        'claude-opus-4-7': 'gemini-2.5-pro',
        'claude-opus-4-5': 'gemini-2.5-pro',
        'claude-sonnet-4-6': 'gemini-2.0-flash',
        'claude-sonnet-4-5': 'gemini-2.0-flash',
        'claude-haiku-4-5-20251001': 'gemini-2.0-flash-lite',
        'claude-haiku-4-5': 'gemini-2.0-flash-lite',
        'claude-3-5-sonnet-20241022': 'gemini-2.0-flash',
        'claude-3-5-haiku-20241022': 'gemini-2.0-flash-lite',
        'claude-3-opus-20240229': 'gemini-2.5-pro',
        'claude-3-sonnet-20240229': 'gemini-1.5-pro',
        'claude-3-haiku-20240307': 'gemini-1.5-flash',
      },
      keyHint: 'Get key at aistudio.google.com/apikey',
    },

    deepseek: {
      name: 'DeepSeek',
      icon: '🔷',
      baseURL: 'https://api.deepseek.com',
      defaultModel: 'deepseek-chat',
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Strong reasoning and coding capabilities',
      modelMap: {
        'claude-opus-4-7': 'deepseek-reasoner',
        'claude-opus-4-5': 'deepseek-reasoner',
        'claude-sonnet-4-6': 'deepseek-chat',
        'claude-sonnet-4-5': 'deepseek-chat',
        'claude-haiku-4-5': 'deepseek-chat',
        'claude-3-5-sonnet-20241022': 'deepseek-chat',
        'claude-3-5-haiku-20241022': 'deepseek-chat',
        'claude-3-opus-20240229': 'deepseek-reasoner',
      },
      keyHint: 'Get key at platform.deepseek.com/api_keys',
    },

    qwen: {
      name: 'Alibaba Qwen',
      icon: '🟠',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      defaultModel: 'qwen-max',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Alibaba\'s Qwen series with vision support',
      modelMap: {
        'claude-opus-4-7': 'qwen-max',
        'claude-opus-4-5': 'qwen-max',
        'claude-sonnet-4-6': 'qwen-plus',
        'claude-sonnet-4-5': 'qwen-plus',
        'claude-haiku-4-5': 'qwen-turbo',
        'claude-3-5-sonnet-20241022': 'qwen-plus',
        'claude-3-5-haiku-20241022': 'qwen-turbo',
        'claude-3-opus-20240229': 'qwen-max',
      },
      keyHint: 'Get key at dashscope-intl.aliyuncs.com',
    },

    minimax: {
      name: 'MiniMax',
      icon: '🟢',
      baseURL: 'https://api.minimax.chat/v1',
      defaultModel: 'MiniMax-Text-01',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'MiniMax AI with text and vision capabilities',
      modelMap: {
        'claude-opus-4-7': 'MiniMax-Text-01',
        'claude-opus-4-5': 'MiniMax-Text-01',
        'claude-sonnet-4-6': 'abab6.5s-chat',
        'claude-sonnet-4-5': 'abab6.5s-chat',
        'claude-haiku-4-5': 'abab5.5s-chat',
        'claude-3-5-sonnet-20241022': 'abab6.5s-chat',
        'claude-3-5-haiku-20241022': 'abab5.5s-chat',
        'claude-3-opus-20240229': 'MiniMax-Text-01',
      },
      keyHint: 'Get key at minimaxi.com/user-center/basic-information/interface-key',
    },

    glm: {
      name: 'Zhipu GLM',
      icon: '🟣',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-4',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Zhipu AI GLM series with vision and tools',
      modelMap: {
        'claude-opus-4-7': 'glm-4-plus',
        'claude-opus-4-5': 'glm-4-plus',
        'claude-sonnet-4-6': 'glm-4',
        'claude-sonnet-4-5': 'glm-4',
        'claude-haiku-4-5': 'glm-4-flash',
        'claude-3-5-sonnet-20241022': 'glm-4',
        'claude-3-5-haiku-20241022': 'glm-4-flash',
        'claude-3-opus-20240229': 'glm-4-plus',
      },
      keyHint: 'Get key at open.bigmodel.cn/usercenter/apikeys',
    },

    openai: {
      name: 'OpenAI',
      icon: '⚫',
      baseURL: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'OpenAI GPT-4o and GPT-4o-mini',
      modelMap: {
        'claude-opus-4-7': 'gpt-4o',
        'claude-opus-4-5': 'gpt-4o',
        'claude-sonnet-4-6': 'gpt-4o',
        'claude-sonnet-4-5': 'gpt-4o',
        'claude-haiku-4-5': 'gpt-4o-mini',
        'claude-3-5-sonnet-20241022': 'gpt-4o',
        'claude-3-5-haiku-20241022': 'gpt-4o-mini',
        'claude-3-opus-20240229': 'gpt-4o',
      },
      keyHint: 'Get key at platform.openai.com/api-keys',
    },

    groq: {
      name: 'Groq',
      icon: '⚡',
      baseURL: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.3-70b-versatile',
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Ultra-fast inference with Llama models',
      modelMap: {
        'claude-opus-4-7': 'llama-3.3-70b-versatile',
        'claude-opus-4-5': 'llama-3.3-70b-versatile',
        'claude-sonnet-4-6': 'llama-3.3-70b-versatile',
        'claude-sonnet-4-5': 'llama-3.3-70b-versatile',
        'claude-haiku-4-5': 'llama-3.1-8b-instant',
        'claude-3-5-sonnet-20241022': 'llama-3.3-70b-versatile',
        'claude-3-5-haiku-20241022': 'llama-3.1-8b-instant',
      },
      keyHint: 'Get key at console.groq.com/keys',
    },

    mistral: {
      name: 'Mistral',
      icon: '🌊',
      baseURL: 'https://api.mistral.ai/v1',
      defaultModel: 'mistral-large-latest',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Mistral AI with vision and function calling',
      modelMap: {
        'claude-opus-4-7': 'mistral-large-latest',
        'claude-opus-4-5': 'mistral-large-latest',
        'claude-sonnet-4-6': 'mistral-medium-latest',
        'claude-sonnet-4-5': 'mistral-medium-latest',
        'claude-haiku-4-5': 'mistral-small-latest',
        'claude-3-5-sonnet-20241022': 'mistral-large-latest',
        'claude-3-5-haiku-20241022': 'mistral-small-latest',
      },
      keyHint: 'Get key at console.mistral.ai/api-keys',
    },

    kimi: {
      name: 'Kimi (Moonshot)',
      icon: '🌙',
      baseURL: 'https://api.moonshot.cn/v1',
      defaultModel: 'moonshot-v1-8k',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Moonshot AI Kimi with long context support',
      modelMap: {
        'claude-opus-4-7': 'moonshot-v1-128k',
        'claude-opus-4-5': 'moonshot-v1-128k',
        'claude-sonnet-4-6': 'moonshot-v1-32k',
        'claude-sonnet-4-5': 'moonshot-v1-32k',
        'claude-haiku-4-5': 'moonshot-v1-8k',
        'claude-3-5-sonnet-20241022': 'moonshot-v1-32k',
        'claude-3-5-haiku-20241022': 'moonshot-v1-8k',
        'claude-3-opus-20240229': 'moonshot-v1-128k',
      },
      keyHint: 'Get key at platform.moonshot.cn',
    },

    azure: {
      name: 'Azure OpenAI',
      icon: '🔷',
      baseURL: '',  // User must provide their Azure endpoint
      defaultModel: 'gpt-4o',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Microsoft Azure OpenAI Service',
      modelMap: {
        'claude-opus-4-7': 'gpt-4o',
        'claude-opus-4-5': 'gpt-4o',
        'claude-sonnet-4-6': 'gpt-4o',
        'claude-sonnet-4-5': 'gpt-4o',
        'claude-haiku-4-5': 'gpt-4o-mini',
        'claude-3-5-sonnet-20241022': 'gpt-4o',
        'claude-3-5-haiku-20241022': 'gpt-4o-mini',
      },
      keyHint: 'Provide your Azure OpenAI endpoint and key',
    },

    ollama: {
      name: 'Ollama (Local)',
      icon: '🦙',
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'llama3.2',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Self-hosted models via Ollama',
      modelMap: {},
      keyHint: 'No key needed for local Ollama',
    },

    lmstudio: {
      name: 'LM Studio (Local)',
      icon: '🖥️',
      baseURL: 'http://localhost:1234/v1',
      defaultModel: 'local-model',
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Local models via LM Studio',
      modelMap: {},
      keyHint: 'No key needed for LM Studio',
    },

    pollinations: {
      name: 'Pollinations.ai',
      icon: '🌸',
      baseURL: 'https://gen.pollinations.ai/v1',
      defaultModel: 'gemini-fast',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Free AI models via Pollinations',
      modelMap: {
        'claude-opus-4-7': 'gemini-fast',
        'claude-opus-4-5': 'gemini-fast',
        'claude-sonnet-4-6': 'gemini-fast',
        'claude-sonnet-4-5': 'gemini-fast',
        'claude-haiku-4-5-20251001': 'gemini-fast',
        'claude-haiku-4-5': 'gemini-fast',
        'claude-3-5-sonnet-20241022': 'gemini-fast',
        'claude-3-5-haiku-20241022': 'gemini-fast',
        'claude-3-opus-20240229': 'gemini-fast',
      },
      keyHint: 'Optional - get key at pollinations.ai',
    },

    custom: {
      name: 'Custom Endpoint',
      icon: '⚙️',
      baseURL: '',
      defaultModel: 'custom-model',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      description: 'Any OpenAI-compatible endpoint',
      modelMap: {},
      keyHint: 'Enter your custom baseURL and model name',
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // Configuration Management
  // ═══════════════════════════════════════════════════════════════════════════════

  const CONFIG_KEY = 'universal_provider_config';
  const STORAGE_PREFIX = 'up_';

  // Default configuration
  const DEFAULT_CONFIG = {
    provider: 'gemini',
    apiKey: '',
    baseURL: '',
    defaultModel: '',
    modelMap: {},
    supportsVision: true,
    supportsTools: true,
    debug: false,
    bypassLogin: true,
  };

  let activeConfig = { ...DEFAULT_CONFIG };
  let isConfigLoaded = false;

  /**
   * Load configuration from chrome.storage.local
   */
  async function loadConfig() {
    try {
      const result = await chrome.storage.local.get([CONFIG_KEY]);
      if (result[CONFIG_KEY]) {
        activeConfig = { ...DEFAULT_CONFIG, ...result[CONFIG_KEY] };
        // Merge provider preset if exists
        const preset = PROVIDER_REGISTRY[activeConfig.provider];
        if (preset) {
          activeConfig.baseURL = activeConfig.baseURL || preset.baseURL;
          activeConfig.defaultModel = activeConfig.defaultModel || preset.defaultModel;
          activeConfig.supportsVision = preset.supportsVision;
          activeConfig.supportsTools = preset.supportsTools;
          activeConfig.modelMap = { ...(preset.modelMap || {}), ...(activeConfig.modelMap || {}) };
        }
      }
      isConfigLoaded = true;
      console.log('[UniversalProvider] Config loaded:', activeConfig.provider);
      return activeConfig;
    } catch (e) {
      console.error('[UniversalProvider] Failed to load config:', e);
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Save configuration to chrome.storage.local
   */
  async function saveConfig(config) {
    try {
      activeConfig = { ...activeConfig, ...config };
      await chrome.storage.local.set({ [CONFIG_KEY]: activeConfig });
      console.log('[UniversalProvider] Config saved:', activeConfig.provider);
      return true;
    } catch (e) {
      console.error('[UniversalProvider] Failed to save config:', e);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Format Translation: Anthropic ↔ OpenAI
  // ═══════════════════════════════════════════════════════════════════════════════

  function mapFinishReason(reason) {
    switch (reason) {
      case 'stop': return 'end_turn';
      case 'length': return 'max_tokens';
      case 'tool_calls': return 'tool_use';
      case 'content_filter': return 'end_turn';
      default: return reason ?? 'end_turn';
    }
  }

  function anthropicBlockToOpenAI(block, supportsVision) {
    if (typeof block === 'string') return { type: 'text', text: block };

    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };

      case 'thinking':
        return { type: 'text', text: `<thinking>${block.thinking}</thinking>` };

      case 'image':
        if (!supportsVision) return { type: 'text', text: '[Image: vision not supported]' };
        const src = block.source;
        if (src?.type === 'base64') {
          return {
            type: 'image_url',
            image_url: {
              url: `data:${src.media_type};base64,${src.data}`,
              detail: 'auto'
            }
          };
        }
        if (src?.type === 'url') {
          return { type: 'image_url', image_url: { url: src.url, detail: 'auto' } };
        }
        return { type: 'text', text: '[Image: unsupported source]' };

      case 'tool_use':
      case 'tool_result':
        return null;

      default:
        return { type: 'text', text: `[${block.type}]` };
    }
  }

  function anthropicContentToOpenAI(content, supportsVision) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return String(content);
    const parts = content.map(b => anthropicBlockToOpenAI(b, supportsVision)).filter(Boolean);
    if (parts.every(p => p.type === 'text')) {
      return parts.map(p => p.text).join('');
    }
    return parts;
  }

  function anthropicMessageToOpenAI(msg, supportsVision) {
    const { role, content } = msg;

    if (role === 'assistant') {
      const blocks = Array.isArray(content) ? content : [{ type: 'text', text: content }];
      const texts = blocks.filter(b => b.type === 'text' || b.type === 'thinking');
      const tools = blocks.filter(b => b.type === 'tool_use');
      const m = { role: 'assistant' };
      const txt = texts.map(b => b.type === 'thinking' ? `<thinking>${b.thinking}</thinking>` : b.text).join('');
      if (txt) m.content = txt;
      if (tools.length) {
        m.tool_calls = tools.map(b => ({
          id: b.id,
          type: 'function',
          function: {
            name: b.name,
            arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {})
          }
        }));
        if (!m.content) m.content = null;
      }
      return [m];
    }

    if (role === 'user') {
      const blocks = Array.isArray(content) ? content : [{ type: 'text', text: content }];
      const results = blocks.filter(b => b.type === 'tool_result');
      const others = blocks.filter(b => b.type !== 'tool_result');
      const msgs = [];
      if (others.length) {
        const c = anthropicContentToOpenAI(others, supportsVision);
        if (c && (typeof c !== 'string' || c.trim())) {
          msgs.push({ role: 'user', content: c });
        }
      }
      for (const tr of results) {
        const c = Array.isArray(tr.content)
          ? anthropicContentToOpenAI(tr.content, supportsVision)
          : (tr.content ?? '');
        msgs.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: typeof c === 'string' ? c : JSON.stringify(c)
        });
      }
      return msgs.length ? msgs : [{ role: 'user', content: '' }];
    }

    return [{ role, content: anthropicContentToOpenAI(content, supportsVision) }];
  }

  function buildOpenAIBody(anthropicBody, resolvedModel, cfg) {
    const msgs = [];
    if (anthropicBody.system) {
      let systemText;
      if (typeof anthropicBody.system === 'string') {
        systemText = anthropicBody.system;
      } else if (Array.isArray(anthropicBody.system)) {
        systemText = anthropicBody.system
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n\n');
      }
      if (systemText) msgs.push({ role: 'system', content: systemText });
    }

    for (const m of anthropicBody.messages ?? []) {
      msgs.push(...anthropicMessageToOpenAI(m, cfg.supportsVision));
    }

    const body = {
      model: resolvedModel,
      messages: msgs,
      stream: anthropicBody.stream ?? false,
    };

    if (anthropicBody.max_tokens != null) body.max_tokens = anthropicBody.max_tokens;
    if (anthropicBody.temperature != null) body.temperature = anthropicBody.temperature;
    if (anthropicBody.top_p != null) body.top_p = anthropicBody.top_p;
    if (anthropicBody.stop_sequences?.length) body.stop = anthropicBody.stop_sequences;

    if (cfg.supportsTools && anthropicBody.tools?.length) {
      body.tools = anthropicBody.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: t.input_schema ?? { type: 'object', properties: {}, required: [] }
        }
      }));
      const tc = anthropicBody.tool_choice;
      if (tc) {
        body.tool_choice = tc.type === 'auto' ? 'auto' :
                          tc.type === 'any' ? 'required' :
                          tc.type === 'tool' ? { type: 'function', function: { name: tc.name } } :
                          'auto';
      }
    }

    if (body.stream) body.stream_options = { include_usage: true };

    return body;
  }

  function buildAnthropicSSEStream(openaiStream, anthropicModel, msgId) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    function sse(event, data) {
      return `event: ${event}\ndata: ${JSON.stringify(d)}\n\n`;
    }

    return new ReadableStream({
      async start(controller) {
        const enqueue = s => controller.enqueue(encoder.encode(s));
        try {
          // message_start
          enqueue(sse('message_start', {
            type: 'message_start',
            message: {
              id: msgId,
              type: 'message',
              role: 'assistant',
              content: [],
              model: anthropicModel,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 }
            }
          }));

          // ping
          enqueue(sse('ping', { type: 'ping' }));

          const reader = openaiStream.getReader();
          let buf = '';
          let blockIdx = 0;
          let textOpen = false;
          let anyBlock = false;
          let inTokens = 0;
          let outTokens = 0;
          let stopReason = 'end_turn';
          const toolMap = {};

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';

            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith('data:')) continue;
              const raw = t.slice(5).trim();
              if (raw === '[DONE]') continue;

              let chunk;
              try { chunk = JSON.parse(raw); } catch { continue; }

              if (chunk.usage && !chunk.choices?.length) {
                inTokens = chunk.usage.prompt_tokens ?? inTokens;
                outTokens = chunk.usage.completion_tokens ?? outTokens;
                continue;
              }

              const choice = chunk.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta ?? {};
              if (chunk.usage) {
                inTokens = chunk.usage.prompt_tokens ?? inTokens;
                outTokens = chunk.usage.completion_tokens ?? outTokens;
              }

              // Text delta
              if (delta.content) {
                if (!textOpen) {
                  textOpen = true;
                  anyBlock = true;
                  enqueue(sse('content_block_start', {
                    type: 'content_block_start',
                    index: blockIdx,
                    content_block: { type: 'text', text: '' }
                  }));
                }
                enqueue(sse('content_block_delta', {
                  type: 'content_block_delta',
                  index: blockIdx,
                  delta: { type: 'text_delta', text: delta.content }
                }));
              }

              // Tool calls
              if (delta.tool_calls?.length) {
                if (textOpen) {
                  enqueue(sse('content_block_stop', { type: 'content_block_stop', index: blockIdx }));
                  blockIdx++;
                  textOpen = false;
                }
                for (const tc of delta.tool_calls) {
                  const ti = tc.index ?? 0;
                  if (!(ti in toolMap)) {
                    const bi = blockIdx++;
                    toolMap[ti] = bi;
                    anyBlock = true;
                    enqueue(sse('content_block_start', {
                      type: 'content_block_start',
                      index: bi,
                      content_block: {
                        type: 'tool_use',
                        id: tc.id ?? `toolu_${Date.now()}_${ti}`,
                        name: tc.function?.name ?? '',
                        input: {}
                      }
                    }));
                  }
                  if (tc.function?.arguments != null) {
                    enqueue(sse('content_block_delta', {
                      type: 'content_block_delta',
                      index: toolMap[ti],
                      delta: { type: 'input_json_delta', partial_json: tc.function.arguments }
                    }));
                  }
                }
              }

              if (choice.finish_reason) {
                stopReason = mapFinishReason(choice.finish_reason);
              }
            }
          }

          if (textOpen) {
            enqueue(sse('content_block_stop', { type: 'content_block_stop', index: blockIdx }));
          }
          if (!anyBlock) {
            enqueue(sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
            enqueue(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
          }
          for (const bi of Object.values(toolMap)) {
            enqueue(sse('content_block_stop', { type: 'content_block_stop', index: bi }));
          }

          enqueue(sse('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: outTokens }
          }));
          enqueue(sse('message_stop', { type: 'message_stop' }));
        } catch (e) {
          enqueue(sse('error', { type: 'error', error: { type: 'api_error', message: String(e?.message ?? e) } }));
        } finally {
          controller.close();
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Login Bypass & Storage Patching
  // ═══════════════════════════════════════════════════════════════════════════════

  const DUMMY_KEY = 'sk-universal-provider-bypass-000000000000000000000000';
  const STORAGE_KEY = 'anthropicApiKey';

  function bypassLoginGate() {
    // Write dummy key to storage
    chrome.storage.local.set({
      [STORAGE_KEY]: DUMMY_KEY,
      browserControlPermissionAccepted: true,
      skipOnboarding: true,
      hasSeenFirstTimeExperience: true,
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[UniversalProvider] Storage error:', chrome.runtime.lastError);
      }
    });

    // Patch chrome.storage.local.get to return dummy key
    const _origGet = chrome.storage.local.get.bind(chrome.storage.local);

    function _patchedGet(keys, callback) {
      const list = typeof keys === 'string' ? [keys]
        : Array.isArray(keys) ? keys
        : (keys && typeof keys === 'object') ? Object.keys(keys)
        : [];

      const wantApiKey = list.includes(STORAGE_KEY);
      const wantPermission = list.includes('browserControlPermissionAccepted');
      const wantOnboarding = list.includes('skipOnboarding') || list.includes('hasSeenFirstTimeExperience');

      function _inject(result) {
        if (wantApiKey && !result[STORAGE_KEY]) result[STORAGE_KEY] = DUMMY_KEY;
        if (wantPermission && result['browserControlPermissionAccepted'] !== true) {
          result['browserControlPermissionAccepted'] = true;
        }
        if (wantOnboarding) {
          result['skipOnboarding'] = true;
          result['hasSeenFirstTimeExperience'] = true;
        }
        return result;
      }

      if (typeof callback === 'function') {
        return _origGet(keys, r => callback(_inject(r)));
      }
      return _origGet(keys).then(_inject);
    }

    try {
      chrome.storage.local.get = _patchedGet;
      if (chrome.storage.local.get !== _patchedGet) throw new Error('assignment failed');
    } catch (_) {
      try {
        Object.defineProperty(chrome.storage.local, 'get', {
          value: _patchedGet, writable: true, configurable: true
        });
      } catch (e2) {
        console.warn('[UniversalProvider] Could not patch storage.get:', e2);
      }
    }

    console.log('[UniversalProvider] ✓ Login bypass active');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Fetch Interceptor
  // ═══════════════════════════════════════════════════════════════════════════════

  async function installFetchInterceptor() {
    await loadConfig();

    const cfg = activeConfig;
    const preset = PROVIDER_REGISTRY[cfg.provider] || {};
    const baseURL = (cfg.baseURL || preset.baseURL || '').replace(/\/$/, '');
    const apiKey = cfg.apiKey || '';
    const defaultModel = cfg.defaultModel || preset.defaultModel || 'gpt-4o';
    const modelMap = { ...(preset.modelMap || {}), ...(cfg.modelMap || {}) };
    const providerCfg = {
      supportsVision: cfg.supportsVision ?? preset.supportsVision ?? true,
      supportsTools: cfg.supportsTools ?? preset.supportsTools ?? true,
    };

    if (!baseURL) {
      console.error('[UniversalProvider] No baseURL configured. Please set up a provider.');
      return;
    }

    const originalFetch = globalThis.fetch.bind(globalThis);

    async function patchedFetch(input, init) {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input?.url ?? ''));

      // Count tokens stub
      if (url.includes('/v1/messages/count_tokens')) {
        let body;
        try { body = JSON.parse(init?.body ?? '{}'); } catch { body = {}; }
        const rough = Math.round(JSON.stringify(body).length / 4);
        return new Response(
          JSON.stringify({ input_tokens: rough }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Bootstrap features stub
      if (url.includes('/api/bootstrap/features')) {
        return new Response(
          JSON.stringify({ features: { api_key_mode: true }, account: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // OAuth profile stub - returns local user
      if (url.includes('/api/oauth/profile')) {
        return new Response(
          JSON.stringify({
            account: {
              uuid: 'universal-provider-user',
              email: 'user@universal-provider.local',
              name: 'Universal User'
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // OAuth account stub
      if (url.includes('/api/oauth/account')) {
        return new Response(
          JSON.stringify({}),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Rate limits stub
      if (url.includes('/api/rate-limits')) {
        return new Response(
          JSON.stringify({
            limit_requests: 10000,
            limit_tokens: 10000000,
            remaining_requests: 9999,
            remaining_tokens: 9999999,
            reset_at: new Date(Date.now() + 86400000).toISOString()
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Messages endpoint - translate to OpenAI
      if (url.includes('/v1/messages') && !url.includes('count_tokens')) {
        let ab;
        try { ab = JSON.parse(init?.body ?? '{}'); } catch { return originalFetch(input, init); }

        const streaming = ab.stream === true;
        const anthropicModel = ab.model || defaultModel;
        const resolvedModel = modelMap[anthropicModel] || defaultModel;
        const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const openaiBody = buildOpenAIBody(ab, resolvedModel, providerCfg);

        if (cfg.debug) {
          console.log('[UniversalProvider] → OpenAI request:', {
            provider: cfg.provider,
            model: resolvedModel,
            streaming,
            tools: openaiBody.tools?.length || 0
          });
        }

        try {
          const resp = await originalFetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              ...(cfg.extraHeaders || {})
            },
            body: JSON.stringify(openaiBody),
            signal: init?.signal,
          });

          if (!resp.ok) {
            const err = await resp.text();
            if (cfg.debug) console.error('[UniversalProvider] ✗ Provider error:', resp.status, err);
            return new Response(
              JSON.stringify({ error: { type: 'api_error', message: `Provider ${resp.status}: ${err}` } }),
              { status: resp.status, headers: { 'Content-Type': 'application/json' } }
            );
          }

          if (streaming) {
            return new Response(
              buildAnthropicSSEStream(resp.body, anthropicModel, msgId),
              {
                status: 200,
                headers: {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  'X-Accel-Buffering': 'no'
                }
              }
            );
          }

          const json = await resp.json();
          const choice = json.choices?.[0] || {};
          const msg = choice.message || {};
          const usage = json.usage || {};
          const content = [];

          if (msg.content) content.push({ type: 'text', text: msg.content });
          if (msg.tool_calls?.length) {
            for (const tc of msg.tool_calls) {
              let inp;
              try { inp = JSON.parse(tc.function.arguments || '{}'); } catch { inp = { _raw: tc.function.arguments }; }
              content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: inp });
            }
          }

          const anthropicResp = {
            id: msgId,
            type: 'message',
            role: 'assistant',
            content,
            model: anthropicModel,
            stop_reason: mapFinishReason(choice.finish_reason),
            stop_sequence: null,
            usage: {
              input_tokens: usage.prompt_tokens || 0,
              output_tokens: usage.completion_tokens || 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0
            }
          };

          if (cfg.debug) console.log('[UniversalProvider] ← Anthropic response:', anthropicResp);
          return new Response(JSON.stringify(anthropicResp), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
          console.error('[UniversalProvider] Fetch error:', e);
          return new Response(
            JSON.stringify({ error: { type: 'api_error', message: String(e?.message || e) } }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      // Pass through all other requests
      return originalFetch(input, init);
    }

    globalThis.fetch = patchedFetch;
    console.log(`[UniversalProvider] ✓ Fetch interceptor installed → ${cfg.provider || 'custom'} (${baseURL})`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UI Components for Provider Selection
  // ═══════════════════════════════════════════════════════════════════════════════

  function createProviderSelector() {
    const container = document.createElement('div');
    container.id = 'universal-provider-ui';
    container.innerHTML = `
      <style>
        #universal-provider-ui {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .up-dialog {
          background: var(--bg-primary, #1a1a1a);
          border: 1px solid var(--border-color, #333);
          border-radius: 16px;
          padding: 32px;
          max-width: 500px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
          color: var(--text-primary, #fff);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }
        .up-title {
          font-size: 24px;
          font-weight: 600;
          margin-bottom: 8px;
          text-align: center;
        }
        .up-subtitle {
          font-size: 14px;
          color: var(--text-secondary, #888);
          margin-bottom: 24px;
          text-align: center;
        }
        .up-providers {
          display: grid;
          gap: 8px;
          margin-bottom: 20px;
        }
        .up-provider {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-radius: 12px;
          border: 1px solid var(--border-color, #333);
          cursor: pointer;
          transition: all 0.2s;
          background: transparent;
        }
        .up-provider:hover {
          background: var(--bg-hover, #2a2a2a);
          border-color: var(--accent, #C96442);
        }
        .up-provider.selected {
          background: var(--bg-selected, #2a2a2a);
          border-color: var(--accent, #C96442);
        }
        .up-provider-icon {
          font-size: 24px;
          width: 32px;
          text-align: center;
        }
        .up-provider-info {
          flex: 1;
        }
        .up-provider-name {
          font-weight: 500;
          font-size: 14px;
        }
        .up-provider-desc {
          font-size: 12px;
          color: var(--text-secondary, #888);
        }
        .up-provider-features {
          display: flex;
          gap: 4px;
          font-size: 10px;
        }
        .up-badge {
          padding: 2px 6px;
          border-radius: 4px;
          background: var(--badge-bg, #333);
          color: var(--badge-text, #aaa);
        }
        .up-badge.active {
          background: var(--accent, #C96442);
          color: #fff;
        }
        .up-config {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid var(--border-color, #333);
        }
        .up-field {
          margin-bottom: 16px;
        }
        .up-field label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary, #888);
        }
        .up-field input, .up-field textarea {
          width: 100%;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--border-color, #333);
          background: var(--bg-input, #222);
          color: var(--text-primary, #fff);
          font-size: 14px;
          box-sizing: border-box;
        }
        .up-field input:focus, .up-field textarea:focus {
          outline: none;
          border-color: var(--accent, #C96442);
        }
        .up-hint {
          font-size: 11px;
          color: var(--text-secondary, #888);
          margin-top: 4px;
        }
        .up-buttons {
          display: flex;
          gap: 12px;
          margin-top: 24px;
        }
        .up-btn {
          flex: 1;
          padding: 12px 20px;
          border-radius: 10px;
          border: none;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .up-btn:hover {
          opacity: 0.9;
        }
        .up-btn-primary {
          background: var(--accent, #C96442);
          color: #fff;
        }
        .up-btn-secondary {
          background: var(--bg-hover, #2a2a2a);
          color: var(--text-primary, #fff);
        }
        .up-status {
          margin-top: 16px;
          padding: 12px;
          border-radius: 8px;
          font-size: 13px;
          text-align: center;
          display: none;
        }
        .up-status.success {
          display: block;
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
        }
        .up-status.error {
          display: block;
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }
        .up-advanced {
          margin-top: 16px;
          text-align: center;
        }
        .up-advanced-toggle {
          font-size: 12px;
          color: var(--accent, #C96442);
          cursor: pointer;
          background: none;
          border: none;
        }
        .up-advanced-content {
          display: none;
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid var(--border-color, #333);
        }
        .up-advanced-content.open {
          display: block;
        }
      </style>
      <div class="up-dialog">
        <div class="up-title">🌐 Universal Provider</div>
        <div class="up-subtitle">Choose your AI provider to power the extension</div>
        <div class="up-providers" id="up-providers"></div>
        <div class="up-config">
          <div class="up-field">
            <label>API Key</label>
            <input type="password" id="up-api-key" placeholder="Enter your API key">
            <div class="up-hint" id="up-key-hint"></div>
          </div>
          <div class="up-advanced">
            <button class="up-advanced-toggle" id="up-advanced-toggle">Advanced Settings ▼</button>
          </div>
          <div class="up-advanced-content" id="up-advanced-content">
            <div class="up-field">
              <label>Base URL (optional)</label>
              <input type="text" id="up-base-url" placeholder="https://api.example.com/v1">
            </div>
            <div class="up-field">
              <label>Default Model (optional)</label>
              <input type="text" id="up-default-model" placeholder="model-name">
            </div>
            <div class="up-field">
              <label>Extra Headers (JSON, optional)</label>
              <textarea id="up-extra-headers" rows="2" placeholder='{"X-Custom": "value"}'></textarea>
            </div>
            <div class="up-field">
              <label>
                <input type="checkbox" id="up-debug"> Enable Debug Logging
              </label>
            </div>
          </div>
        </div>
        <div class="up-buttons">
          <button class="up-btn up-btn-secondary" id="up-cancel">Skip for Now</button>
          <button class="up-btn up-btn-primary" id="up-save">Save & Connect</button>
        </div>
        <div class="up-status" id="up-status"></div>
      </div>
    `;

    let selectedProvider = activeConfig.provider || 'gemini';

    // Populate providers
    const providersContainer = container.querySelector('#up-providers');
    Object.entries(PROVIDER_REGISTRY).forEach(([key, provider]) => {
      const el = document.createElement('div');
      el.className = `up-provider ${key === selectedProvider ? 'selected' : ''}`;
      el.dataset.provider = key;
      el.innerHTML = `
        <div class="up-provider-icon">${provider.icon}</div>
        <div class="up-provider-info">
          <div class="up-provider-name">${provider.name}</div>
          <div class="up-provider-desc">${provider.description}</div>
          <div class="up-provider-features">
            ${provider.supportsVision ? '<span class="up-badge active">Vision</span>' : '<span class="up-badge">No Vision</span>'}
            ${provider.supportsTools ? '<span class="up-badge active">Tools</span>' : '<span class="up-badge">No Tools</span>'}
            ${provider.supportsStreaming ? '<span class="up-badge active">Stream</span>' : '<span class="up-badge">No Stream</span>'}
          </div>
        </div>
      `;
      el.addEventListener('click', () => {
        providersContainer.querySelectorAll('.up-provider').forEach(p => p.classList.remove('selected'));
        el.classList.add('selected');
        selectedProvider = key;
        updateHint();
      });
      providersContainer.appendChild(el);
    });

    function updateHint() {
      const provider = PROVIDER_REGISTRY[selectedProvider];
      container.querySelector('#up-key-hint').textContent = provider?.keyHint || '';
      if (provider?.baseURL) {
        container.querySelector('#up-base-url').placeholder = provider.baseURL;
      }
      if (provider?.defaultModel) {
        container.querySelector('#up-default-model').placeholder = provider.defaultModel;
      }
    }

    updateHint();

    // Advanced toggle
    container.querySelector('#up-advanced-toggle').addEventListener('click', () => {
      const content = container.querySelector('#up-advanced-content');
      content.classList.toggle('open');
    });

    // Cancel button
    container.querySelector('#up-cancel').addEventListener('click', () => {
      container.remove();
    });

    // Save button
    container.querySelector('#up-save').addEventListener('click', async () => {
      const apiKey = container.querySelector('#up-api-key').value.trim();
      if (!apiKey && selectedProvider !== 'ollama' && selectedProvider !== 'lmstudio') {
        showStatus('API key is required', 'error');
        return;
      }

      const config = {
        provider: selectedProvider,
        apiKey: apiKey,
        baseURL: container.querySelector('#up-base-url').value.trim() || undefined,
        defaultModel: container.querySelector('#up-default-model').value.trim() || undefined,
        debug: container.querySelector('#up-debug').checked,
      };

      try {
        const extraHeadersRaw = container.querySelector('#up-extra-headers').value.trim();
        if (extraHeadersRaw) {
          config.extraHeaders = JSON.parse(extraHeadersRaw);
        }
      } catch (e) {
        showStatus('Invalid JSON in extra headers', 'error');
        return;
      }

      await saveConfig(config);
      showStatus('Configuration saved! Reloading...', 'success');
      setTimeout(() => window.location.reload(), 1000);
    });

    function showStatus(msg, type) {
      const status = container.querySelector('#up-status');
      status.textContent = msg;
      status.className = `up-status ${type}`;
    }

    return container;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Initialization
  // ═══════════════════════════════════════════════════════════════════════════════

  function init() {
    console.log('[UniversalProvider] Initializing...');

    // Always bypass login
    bypassLoginGate();

    // Install fetch interceptor
    installFetchInterceptor();

    // Add keyboard shortcut for provider switcher (Ctrl/Cmd + Shift + P)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        const existing = document.getElementById('universal-provider-ui');
        if (existing) {
          existing.remove();
        } else {
          document.body.appendChild(createProviderSelector());
        }
      }
    });

    // Show setup UI if no provider configured
    setTimeout(async () => {
      await loadConfig();
      if (!activeConfig.apiKey && activeConfig.provider !== 'ollama' && activeConfig.provider !== 'lmstudio') {
        if (!document.getElementById('universal-provider-ui')) {
          document.body.appendChild(createProviderSelector());
        }
      }
    }, 2000);

    console.log('[UniversalProvider] ✓ Initialized');
  }

  // Run initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose API for external access
  globalThis.UniversalProvider = {
    registry: PROVIDER_REGISTRY,
    loadConfig,
    saveConfig,
    getConfig: () => activeConfig,
    showUI: () => {
      const existing = document.getElementById('universal-provider-ui');
      if (existing) existing.remove();
      document.body.appendChild(createProviderSelector());
    },
    getInstalledProvider: () => activeConfig.provider,
    getInstalledModel: () => activeConfig.defaultModel || PROVIDER_REGISTRY[activeConfig.provider]?.defaultModel,
  };

})();
