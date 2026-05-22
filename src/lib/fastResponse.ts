// Fast response handler - implements interact.md optimization patterns
// Minimizes tokens, maximizes speed, learns user patterns

import { tokenUtils } from './tokenOptimizer';
import type { Message, ContentBlock } from './types';

interface ResponseConfig {
  pattern: 'direct' | 'code' | 'detailed';
  tokenBudget: number;
  useAbbreviations: boolean;
}

export function buildPrompt(
  messages: Message[],
  systemPrompt: string,
  config: ResponseConfig
): string {
  const strategy = tokenUtils.selectStrategy(config.pattern);
  const history = optimizeMessages(messages, config.tokenBudget);
  
  return [
    systemPrompt,
    `[Strategy: ${strategy}]`,
    '[Constraints: direct, no preamble]',
    '',
    'History:',
    history,
    '',
    'Respond:'
  ].join('\n').slice(0, config.tokenBudget * 4);
}

function optimizeMessages(messages: Message[], budget: number): string {
  const lines: string[] = [];
  let currentTokens = 0;
  
  for (const m of messages.slice(-10)) {
    const txt = extractText(m.content);
    const tokens = txt.length / 4;
    if (currentTokens + tokens > budget) break;
    lines.push(`${m.role}: ${txt}`);
    currentTokens += tokens;
  }
  
  return lines.join('\n');
}

function extractText(blocks: ContentBlock[]): string {
  const textBlocks = blocks.filter(b => b.type === 'text');
  return textBlocks.map(b => b.text).join(' ').slice(0, 500);
}

export function formatResponse(text: string, pattern: 'direct' | 'code' | 'detailed'): string {
  if (pattern === 'direct') return directFormat(text);
  if (pattern === 'code') return codeFormat(text);
  return text;
}

function directFormat(text: string): string {
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  return sentences.slice(0, 2).join('. ') + '.';
}

function codeFormat(text: string): string {
  const match = text.match(/`[^`]+`/);
  return match ? match[0] : text.split('\n')[0];
}

export const fastResponse = {
  buildPrompt,
  formatResponse
};