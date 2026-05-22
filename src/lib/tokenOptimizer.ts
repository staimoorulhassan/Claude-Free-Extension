// Token optimization and pattern learning engine
// Implements interact.md: minimization, speed, intelligent patterns

import type { Message, ContentBlock } from './types';

interface PatternStats {
  avgLength: number;
  preferredStyle: 'direct' | 'code' | 'detailed';
  tokenSavings: number;
  responseTime: number;
}

interface InteractionCache {
  patterns: Map<string, PatternStats>;
  abbreviations: Map<string, string>;
  lastAccess: number;
}

const CACHE_TTL = 3600000; // 1 hour

const cache: InteractionCache = {
  patterns: new Map(),
  abbreviations: new Map([
    ['function', 'fn'],
    ['interface', 'iface'],
    ['implement', 'impl'],
    ['configuration', 'config'],
    ['authentication', 'auth'],
  ]),
  lastAccess: Date.now()
};

export function detectPattern(text: string): 'direct' | 'code' | 'detailed' {
  const short = text.length < 50;
  const hasCode = /[{}`]/.test(text);
  if (short && !hasCode) return 'direct';
  if (hasCode) return 'code';
  return 'detailed';
}

export function compressResponse(text: string): string {
  return text
    .replace(/\b(\w{4,})\b/g, (m) => cache.abbreviations.get(m) || m)
    .replace(/\s+/g, ' ')
    .trim();
}

export function optimizeContext(messages: Message[]): Message[] {
  const now = Date.now();
  if (now - cache.lastAccess > CACHE_TTL) clearCache();
  cache.lastAccess = now;

  return messages.map(m => ({
    ...m,
    content: optimizeBlocks(m.content)
  }));
}

function optimizeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map(b => {
    if (b.type === 'tool_result' && typeof b.content === 'string') {
      return { ...b, content: truncateText(b.content) };
    }
    if (b.type === 'text' && b.text.length > 2000) {
      return { ...b, text: b.text.slice(0, 2000) + '\n…[truncated]' };
    }
    return b;
  });
}

function truncateText(s: string, max = 2000): string {
  return s.length > max ? s.slice(0, max) + '\n…[truncated]' : s;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function selectStrategy(pattern: 'direct' | 'code' | 'detailed'): string {
  const strategies = {
    direct: 'answer concisely in 1-2 sentences',
    code: 'use file:line references, minimal explanation',
    detailed: 'provide structured response with key points first'
  };
  return strategies[pattern];
}

export function recordPattern(id: string, stats: Partial<PatternStats>): void {
  const current = cache.patterns.get(id) || {
    avgLength: 0, preferredStyle: 'direct', tokenSavings: 0, responseTime: 0
  };
  cache.patterns.set(id, { ...current, ...stats });
}

export function getPattern(id: string): PatternStats | null {
  return cache.patterns.get(id) || null;
}

export function clearCache(): void {
  cache.patterns.clear();
  cache.lastAccess = Date.now();
}

export const tokenUtils = {
  detectPattern,
  compressResponse,
  optimizeContext,
  estimateTokens,
  selectStrategy
};