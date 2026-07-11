import { describe, it, expect } from 'vitest';
import { isValidToolCallEnvelope, type ToolCallEnvelope } from '@/lib/types';

describe('isValidToolCallEnvelope', () => {
  it('accepts a well-formed native envelope', () => {
    const envelope: ToolCallEnvelope = {
      name: 'click_element',
      arguments: { selector: '#submit' },
      source: 'native',
    };
    expect(isValidToolCallEnvelope(envelope)).toBe(true);
  });

  it('accepts a well-formed tier2-xml envelope', () => {
    expect(
      isValidToolCallEnvelope({ name: 'navigate', arguments: { url: 'https://example.com' }, source: 'tier2-xml' })
    ).toBe(true);
  });

  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
    ['click_element', 'a bare string'],
    [{ arguments: {}, source: 'native' }, 'missing name'],
    [{ name: '', arguments: {}, source: 'native' }, 'empty name'],
    [{ name: 'x', arguments: null, source: 'native' }, 'null arguments'],
    [{ name: 'x', arguments: [], source: 'native' }, 'array arguments'],
    [{ name: 'x', arguments: {}, source: 'ours' }, 'unknown source'],
    [{ name: 'x', arguments: {} }, 'missing source'],
  ])('rejects %s (%s)', (value) => {
    expect(isValidToolCallEnvelope(value)).toBe(false);
  });
});
