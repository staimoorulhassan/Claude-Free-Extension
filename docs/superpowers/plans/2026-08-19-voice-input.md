# Voice Input (Speech-to-Text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mic button to the message composer that transcribes speech into the input box via the Chrome Web Speech API (STT only).

**Architecture:** A small pure helper module (`src/sidepanel/voice.ts`) with testable transcription-append logic; a `useSpeechRecognition` hook in `MessageInput.tsx` wires the Web Speech API events to that helper; a new `voiceInputLanguage` setting (default `en-US`) is surfaced in the sidepanel settings and options page. No manifest/background changes.

**Tech Stack:** TypeScript, React (zustand store), Vitest, Chrome Web Speech API (`SpeechRecognition`).

## Global Constraints

- No new npm dependencies.
- No changes to `manifest.json`, `background.ts`, or the tool loop.
- Follow existing patterns: buttons styled like `.attach-btn`/`.send-btn` in `src/sidepanel/sidepanel.css`; settings via `updateSettings(patch)` from the zustand store.
- All existing tests must stay green: `npm run type-check`, `npm test` (143 vitest + 52 spec-conformance), `npm run build` must produce byte-identical-able dist.
- Commit style: Conventional Commits (e.g. `feat: voice input — speech-to-text into the composer`).
- SpeechRecognition is referenced as `window.SpeechRecognition || window.webkitSpeechRecognition`; guard with `typeof window !== 'undefined'` for tests.

---

### Task 1: `voiceInputLanguage` setting

**Files:**
- Modify: `src/lib/types.ts:218-241` (interface `AppSettings`) and `src/lib/types.ts:246-267` (`DEFAULT_SETTINGS`)
- Test: `src/sidepanel/store.test.ts` (settings round-trip test)

**Interfaces:**
- Produces: `AppSettings.voiceInputLanguage: string` (BCP-47 code, default `"en-US"`). Consumers: `MessageInput` (Task 2) reads it via `useStore(s => s.settings.voiceInputLanguage)`; SettingsPanel (Task 3) and options page (Task 4) patch it via `updateSettings({ voiceInputLanguage })`.

- [ ] **Step 1: Add the field to the type and defaults**

In `src/lib/types.ts`:

```typescript
  /** Group confinement: the extension only works inside its "Claude Free" tab
   * group — it hides (panel closes, agent stops) when a tab outside the group
   * is selected and shuts down when the group is closed. */
  groupConfinement: boolean;
  /** Voice input (Web Speech API) recognition language, BCP-47 code. */
  voiceInputLanguage: string;
```

In `DEFAULT_SETTINGS`:

```typescript
  groupConfinement: true,
  voiceInputLanguage: 'en-US',
```

- [ ] **Step 2: Run existing tests to confirm nothing breaks**

Run: `npm test 2>&1 | grep -aE "Test Files|Tests "`
Expected: `143 passed`, `52 passed`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(settings): add voiceInputLanguage setting (default en-US)"
```

---

### Task 2: Pure helper module `src/sidepanel/voice.ts`

**Files:**
- Create: `src/sidepanel/voice.ts`
- Test: `tests/unit/voice.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RecognitionEngine = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: { final: string; interim: string }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; start(): void; stop(): void; abort(): void; }` (structural type; the real `SpeechRecognition` instance satisfies it).
  - `export function getRecognitionCtor(): { new (): RecognitionEngine } | null` — returns the browser ctor or null if unsupported.
  - `export function appendTranscription(current: string, chunk: string): string` — appends `chunk` to `current`, inserting a single space between when `current` is non-empty and does not already end with a space. Returns `current` unchanged when `chunk` is empty.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/voice.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/voice.test.ts`
Expected: FAIL — module/file not found.

- [ ] **Step 3: Write the implementation**

Create `src/sidepanel/voice.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/voice.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/voice.ts tests/unit/voice.test.ts
git commit -m "feat(voice): add recognition helpers (getRecognitionCtor, appendTranscription)"
```

---

### Task 3: Mic button + recognition hook in the composer

**Files:**
- Modify: `src/sidepanel/components/MessageInput.tsx`
- Modify: `src/sidepanel/sidepanel.css`

**Interfaces:**
- Consumes: `appendTranscription`, `getRecognitionCtor` from Task 2; `AppSettings.voiceInputLanguage` from Task 1; existing store API (`isStreaming`, `useStore`).
- Produces: mic toggle button in `.input-actions`; inline `useSpeechRecognition` hook with state `{ listening, hint }`; exposes nothing to later tasks.

- [ ] **Step 1: Add the recognition hook and mic button**

In `src/sidepanel/components/MessageInput.tsx`:

Add imports and the hook (place after the icon components):

```typescript
import { appendTranscription, getRecognitionCtor, type RecognitionEngine } from '../voice';

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={14} height={14} aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>
    </svg>
  );
}
```

Inside `MessageInput`, add state and the hook logic (replace the `const attachedRecording = ...` line region; add after the existing `useStore` selectors):

```typescript
  const voiceInputLanguage = useStore(s => s.settings.voiceInputLanguage);
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState('');
  const recognitionRef = useRef<RecognitionEngine | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) { setVoiceHint('Voice input is not supported in this browser'); return; }
    setVoiceHint('');
    const rec = new Ctor();
    rec.lang = voiceInputLanguage;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const next = e.final || e.interim;
      if (next) setText(prev => appendTranscription(prev.trimEnd(), next));
      setVoiceHint('');
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setVoiceHint('Microphone access denied — allow it in the browser prompt');
      } else if (e.error === 'no-speech') {
        setVoiceHint('No speech detected');
      } else {
        setVoiceHint('Voice input unavailable');
      }
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }, [voiceInputLanguage]);

  const toggleVoice = () => {
    if (listening) stopListening();
    else startListening();
  };

  // clear the hint a few seconds after it appears
  useEffect(() => {
    if (!voiceHint) return;
    const t = setTimeout(() => setVoiceHint(''), 4000);
    return () => clearTimeout(t);
  }, [voiceHint]);
```

Add the mic button in the `.input-actions` div (before the attach button) and the hint line (after the `.input-row` close, inside `.input-area`):

```tsx
        <div className="input-actions">
          <button
            className={`mic-btn${listening ? ' mic-btn--listening' : ''}`}
            onClick={toggleVoice}
            disabled={isStreaming}
            title={listening ? 'Stop listening' : 'Voice input'}
            aria-label={listening ? 'Stop listening' : 'Voice input'}
            aria-pressed={listening}
          >
            <MicIcon />
          </button>
          <button className="attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach image" aria-label="Attach image">
            <PaperclipIcon />
          </button>
          {isStreaming ? (
            <button className="send-btn stop-btn" onClick={stopGeneration} title="Stop" aria-label="Stop">
              <StopIcon />
            </button>
          ) : (
            <button className="send-btn" onClick={send} disabled={!canSend} title="Send (Enter)" aria-label="Send (Enter)">
              <SendIcon />
            </button>
          )}
        </div>
      </div>
      {voiceHint && <div className="voice-hint" role="status">{voiceHint}</div>}
```

Update imports: add `useEffect` to the React import line (currently `useState, useRef, useCallback`). When `listening` becomes true, focus stays on the textarea is NOT required — the textarea receives the transcription via state.

- [ ] **Step 2: Add CSS for the mic button and hint**

In `src/sidepanel/sidepanel.css`, after the `.attach-btn` rules (line ~164):

```css
.mic-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: none; border: none; cursor: pointer; color: var(--text3); border-radius: 6px; }
.mic-btn:hover:not(:disabled) { background: var(--bg3); color: var(--text2); }
.mic-btn:disabled { opacity: .4; cursor: not-allowed; }
.mic-btn--listening { color: #fff; background: #c0392b; animation: mic-pulse 1.2s ease-in-out infinite; }
@keyframes mic-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(192, 57, 43, .5); } 50% { box-shadow: 0 0 0 6px rgba(192, 57, 43, 0); } }
.voice-hint { font-size: 11px; color: var(--text3); padding: 4px 12px 2px; min-height: 0; }
```

- [ ] **Step 3: Build + test**

Run: `npm run type-check && npm test 2>&1 | grep -aE "Test Files|Tests "`
Expected: type-check clean; `143 passed`, `52 passed`.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/components/MessageInput.tsx src/sidepanel/sidepanel.css
git commit -m "feat(voice): add mic button with Web Speech API transcription into the composer"
```

---

### Task 4: Language setting UI

**Files:**
- Modify: `src/sidepanel/components/SettingsPanel.tsx` (after the Group confinement toggle row, ~line 395)
- Modify: `src/options/App.tsx` (after the task-timeout field)

**Interfaces:**
- Consumes: `AppSettings.voiceInputLanguage`, `updateSettings`/`set` (already in scope in both files).

- [ ] **Step 1: Add the field to the sidepanel settings**

In `src/sidepanel/components/SettingsPanel.tsx`, after the Group confinement `toggle-row` div:

```tsx
          <div className="toggle-row">
            <label>
              Voice input language
              <span className="toggle-hint">BCP-47 code used by speech-to-text (e.g. en-US, en-GB, ur-PK, ar-SA)</span>
            </label>
            <input
              type="text"
              className="settings-input"
              aria-label="Voice input language"
              value={settings.voiceInputLanguage}
              onChange={e => set({ voiceInputLanguage: e.target.value })}
              style={{ width: 90 }}
            />
          </div>
```

- [ ] **Step 2: Add the field to the options page**

In `src/options/App.tsx`, after the task-timeout `Field` block:

```tsx
          <Field label="Voice input language">
            <input
              type="text"
              value={settings.voiceInputLanguage}
              onChange={e => update({ voiceInputLanguage: e.target.value })}
              placeholder="en-US"
            />
            <p className="field-hint">BCP-47 code used by speech-to-text (e.g. en-US, en-GB, ur-PK, ar-SA)</p>
          </Field>
```

- [ ] **Step 3: Build + test**

Run: `npm run type-check && npm test 2>&1 | grep -aE "Test Files|Tests "`
Expected: type-check clean; `143 passed`, `52 passed`.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/components/SettingsPanel.tsx src/options/App.tsx
git commit -m "feat(settings): surface voice input language in sidepanel and options"
```

---

### Task 5: Final verification + version bump + release (v3.6.0)

**Files:**
- Modify: `package.json`, `manifest.json`, `README.md` (version badge + changelog row), rebuild `dist/`

**Interfaces:**
- Consumes: all prior tasks.

- [ ] **Step 1: Run the full gate**

Run:
```bash
npm run type-check
npm test
npm run build
npx playwright test
```
Expected: type-check clean; 143 vitest + 52 spec tests pass; build succeeds; e2e suite green (10 specs).

- [ ] **Step 2: Version bump 3.5.1 → 3.6.0**

```bash
sed -i 's/"version": "3.5.1"/"version": "3.6.0"/' package.json manifest.json
sed -i 's/badge\/version-3.5.1-blue/badge\/version-3.6.0-blue/' README.md
npm run build
```

Add README changelog row (top of the changelog table):

```markdown
| **v3.6.0** | Voice input — a mic button in the composer transcribes speech into the message box via the Web Speech API (speech-to-text only); new `Voice input language` setting (BCP-47, default en-US) in the sidepanel and options |
```

- [ ] **Step 3: Manual verification (unpacked load)**

Load the workspace copy (Downloads) as an unpacked extension, open the sidepanel, click the mic, allow the browser microphone prompt, speak — confirm words land in the message box live and the final text stays for editing.

- [ ] **Step 4: Commit, push, tag, release**

```bash
git add -A
git commit -m "feat: voice input — speech-to-text into the composer (Web Speech API); version bump 3.5.1 → 3.6.0"
git push origin main
git tag v3.6.0
git push origin v3.6.0
```

Then wait for CI (`gh run watch`), confirm the release has `claude-free-extension-v3.6.0.zip` attached, and write release notes (voice input + the v3.5.1 CSP fix recap).

- [ ] **Step 5: Refresh the workspace copy**

Copy `dist/*` into `C:\Users\Taimoor\Downloads\claude-free-extension-v3.3.3`, re-apply the Opik bridge hand-edits (opik-client.js script tag in `sidepanel.html`; `http://127.0.0.1:4571 http://localhost:4571` in `manifest.json` connect-src), backup the previous build as `dist-pre-3.6.0-backup`.