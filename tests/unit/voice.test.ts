import { describe, it, expect } from 'vitest';
import { appendTranscription, getRecognitionCtor } from '@/sidepanel/voice';

describe('appendTranscription', () => {
  it('appends to empty text', () => {
    expect(appendTranscription('', 'hello')).toBe('hello');
  });
  it('joins non-empty text with a single space', () => {
    expect(appendTranscription('tell me', 'the answer')).toBe('tell me the answer');
  });
  it('does not double-space when current ends with space', () => {
    expect(appendTranscription('tell me ', 'the answer')).toBe('tell me the answer');
  });
  it('ignores empty chunks', () => {
    expect(appendTranscription('hi', '')).toBe('hi');
  });
});

describe('getRecognitionCtor', () => {
  it('returns null when no SpeechRecognition API exists', () => {
    const windowRef = globalThis as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    const prev = [windowRef.SpeechRecognition, windowRef.webkitSpeechRecognition];
    delete windowRef.SpeechRecognition;
    delete windowRef.webkitSpeechRecognition;
    try {
      expect(getRecognitionCtor()).toBeNull();
    } finally {
      windowRef.SpeechRecognition = prev[0];
      windowRef.webkitSpeechRecognition = prev[1];
    }
  });
});
