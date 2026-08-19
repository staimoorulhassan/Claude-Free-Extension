export interface RecognitionEngine {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { final: string; interim: string }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function getRecognitionCtor(): { new (): RecognitionEngine } | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: { new (): RecognitionEngine };
    webkitSpeechRecognition?: { new (): RecognitionEngine };
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function appendTranscription(current: string, chunk: string): string {
  if (!chunk) return current;
  if (!current) return chunk;
  return current.endsWith(' ') ? current + chunk : `${current} ${chunk}`;
}