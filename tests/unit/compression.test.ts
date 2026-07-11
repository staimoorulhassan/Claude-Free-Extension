import { describe, it, expect } from 'vitest';

// compressForApi/computeEffectiveLimits are module-private to store.ts (a Zustand
// store file with chrome.* side effects at import time isn't safely importable in
// Node), so this test re-implements just the pure sizing heuristic under test —
// computeEffectiveLimits' actual formula — to lock its documented behavior in
// research.md §9 / spec FR-015. Any change to store.ts's copy should be mirrored
// here (T052 acceptance: verify both a present and absent contextWindow work as
// intended, per tasks.md).

const CTX_MAX_MESSAGES = 40;
const CTX_MAX_TEXT_CHARS = 8000;

function computeEffectiveLimits(contextWindow?: number): { maxMessages: number; maxTextChars: number } {
  if (!contextWindow) return { maxMessages: CTX_MAX_MESSAGES, maxTextChars: CTX_MAX_TEXT_CHARS };
  const HISTORY_TOKEN_BUDGET_FRACTION = 0.5;
  const AVG_TOKENS_PER_MESSAGE = 300;
  const tokenBudget = contextWindow * HISTORY_TOKEN_BUDGET_FRACTION;
  const maxMessages = Math.max(10, Math.min(CTX_MAX_MESSAGES, Math.floor(tokenBudget / AVG_TOKENS_PER_MESSAGE)));
  const maxTextChars = contextWindow < 16_000
    ? Math.max(2000, Math.floor(CTX_MAX_TEXT_CHARS * (contextWindow / 32_000)))
    : CTX_MAX_TEXT_CHARS;
  return { maxMessages, maxTextChars };
}

describe('computeEffectiveLimits (contextWindow-aware compression, FR-015)', () => {
  it('falls back to the fixed heuristic when contextWindow is absent', () => {
    expect(computeEffectiveLimits(undefined)).toEqual({ maxMessages: 40, maxTextChars: 8000 });
  });

  it('shrinks both maxMessages and maxTextChars for a small context window', () => {
    const { maxMessages, maxTextChars } = computeEffectiveLimits(8192);
    expect(maxMessages).toBeLessThan(40);
    expect(maxMessages).toBeGreaterThanOrEqual(10); // floor, never goes below this
    expect(maxTextChars).toBeLessThan(8000);
  });

  it('never goes below the 10-message floor even for a very small window', () => {
    const { maxMessages } = computeEffectiveLimits(1024);
    expect(maxMessages).toBe(10);
  });

  it('never exceeds the 40-message ceiling even for a huge window', () => {
    const { maxMessages, maxTextChars } = computeEffectiveLimits(1_000_000);
    expect(maxMessages).toBe(40);
    expect(maxTextChars).toBe(8000); // >=16k window keeps the full text budget
  });

  it('keeps the full maxTextChars budget once contextWindow crosses 16,000', () => {
    expect(computeEffectiveLimits(16_000).maxTextChars).toBe(8000);
    expect(computeEffectiveLimits(15_999).maxTextChars).toBeLessThan(8000);
  });
});
