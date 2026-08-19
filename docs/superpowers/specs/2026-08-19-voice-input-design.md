# Voice Input (Speech-to-Text) — Design

Date: 2026-08-19
Status: Approved (user approved the design summary on 2026-08-19)

## Purpose

Add a voice chat feature to the Claude Free side panel: a microphone button in the
message composer that transcribes the user's speech into the message input box
using the browser's built-in Web Speech API. This is speech-to-text only — no
text-to-speech, no voice settings beyond a language selector.

## Decisions

- **Engine:** Chrome Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`).
  Free, offline-capable, no API key, no network round-trip. The side panel is a
  normal extension page so the API is available. The browser shows a microphone
  permission prompt on first use. No new manifest permission is required.
- **Behavior:** Transcription fills the message input box. Interim results stream
  live into the textarea (editable while listening); the final result is committed
  to the box. The user reviews/edits, then sends as usual. No auto-send.

## Components

### 1. Setting: `voiceInputLanguage`

- `AppSettings.voiceInputLanguage: string` (BCP-47 code, default `"en-US"`).
- Exposed in the side panel settings (`SettingsPanel.tsx`) and the options page
  (`src/options/App.tsx`) as a small text input.
- Read by the composer to set `recognition.lang`.

### 2. Mic button in the composer (`MessageInput.tsx`)

- A mic icon button placed next to the existing attach button in `.input-actions`.
- Idle: neutral color, title "Voice input".
- Listening: red + pulse animation, title "Stop listening".
- Clicking toggles listening on/off.

### 3. Speech recognition logic

- Inline `useSpeechRecognition` hook (in `MessageInput.tsx` or a small module).
- Uses `window.SpeechRecognition || window.webkitSpeechRecognition`.
- `continuous: false`, `interimResults: true`, `lang` from the setting.
- While listening, interim transcripts append into the textarea alongside any
  existing typed text (pure helper `appendTranscription(current, chunk)`).
- On `result` events: build up interim text; on a `final` result, commit it.
- On `end`: stop listening state. If there was final text, keep it in the box.
- On `error`:
  - `not-allowed` / `service-not-allowed` → inline hint "Microphone access
    denied — allow it in the browser prompt", stop listening.
  - `no-speech` → inline hint "No speech detected", stop listening.
  - `network`/other → inline hint "Voice input unavailable", stop listening.
- Hints shown as a small transient message near the composer; cleared on next
  start or after a few seconds.

### 4. Styling

- Mic button follows existing `.attach-btn` / `.send-btn` patterns; a
  `.mic-btn--listening` modifier adds red color + a pulse animation (CSS keyframes
  in `sidepanel.css`).
- Composer disabled state (`isStreaming`) disables the mic button too.

### 5. Testing

- Unit test for the pure helper `appendTranscription` (append behavior, interim
  vs final, empty current text).
- Existing suite must stay green (143 vitest + 52 spec-conformance).
- Mic itself is not automatable in e2e; manual verification only.

## Non-Goals

- No text-to-speech.
- No cloud STT (Whisper etc.) — no API keys, no per-use cost.
- No auto-send, no voice commands, no wake-word.
- No changes to the manifest, background worker, or tool loop.

## Open Questions

None — design approved.