import { useState } from 'react';
import { useStore } from '../store';

function NewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 5v14M5 12h14"/>
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  );
}

function RecordIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="8"/>
      {active && <circle cx="12" cy="12" r="4" fill="white"/>}
    </svg>
  );
}

function RecordingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M15 10l4.553-2.277A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"/>
    </svg>
  );
}

export function Header() {
  const conversations = useStore(s => s.conversations);
  const activeId = useStore(s => s.activeConversationId);
  const showSettings = useStore(s => s.showSettings);
  const showHistory = useStore(s => s.showHistory);
  const showRecordings = useStore(s => s.showRecordings);
  const isRecording = useStore(s => s.isRecording);
  const recordings = useStore(s => s.recordings);
  const newConversation = useStore(s => s.newConversation);
  const setShowSettings = useStore(s => s.setShowSettings);
  const setShowHistory = useStore(s => s.setShowHistory);
  const setShowRecordings = useStore(s => s.setShowRecordings);
  const startRecording = useStore(s => s.startRecording);
  const stopRecording = useStore(s => s.stopRecording);
  const settings = useStore(s => s.settings);

  const [namingRecording, setNamingRecording] = useState(false);
  const [recordingName, setRecordingName] = useState('');

  const activeConv = conversations.find(c => c.id === activeId);
  const isAuxPanel = showSettings || showHistory || showRecordings;
  const title = showSettings ? 'Settings' : showHistory ? 'History' : showRecordings ? 'Recordings' : (activeConv?.title ?? 'Claude Free');
  const providerLabel = `${settings.provider.provider} · ${settings.provider.defaultModel ?? '—'}`;

  const handleRecordToggle = async () => {
    if (isRecording) {
      setNamingRecording(true);
      setRecordingName(`Recording ${recordings.length + 1}`);
    } else {
      await startRecording();
    }
  };

  const handleSaveName = async () => {
    const name = recordingName.trim() || `Recording ${recordings.length + 1}`;
    setNamingRecording(false);
    setRecordingName('');
    await stopRecording(name);
  };

  const handleCancelName = async () => {
    setNamingRecording(false);
    setRecordingName('');
    await stopRecording(''); // stop without saving (empty name → store ignores it)
  };

  if (namingRecording) {
    return (
      <div className="header header--naming">
        <input
          className="recording-name-input"
          value={recordingName}
          onChange={e => setRecordingName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') handleCancelName(); }}
          placeholder="Recording name…"
          autoFocus
        />
        <button className="icon-btn recording-save-btn" onClick={handleSaveName} title="Save recording">✓</button>
        <button className="icon-btn" onClick={handleCancelName} title="Discard recording">✕</button>
      </div>
    );
  }

  if (isAuxPanel) {
    return (
      <div className="header">
        <button className="icon-btn" onClick={() => { setShowSettings(false); setShowHistory(false); setShowRecordings(false); }} title="Back">
          <BackIcon />
        </button>
        <span className="header-title">{title}</span>
      </div>
    );
  }

  return (
    <div className="header">
      <span className="header-title">{title}</span>
      <span className="header-provider">{providerLabel}</span>
      {settings.computerUseEnabled && (
        <button
          className={`icon-btn ${isRecording ? 'icon-btn--recording' : ''}`}
          onClick={handleRecordToggle}
          title={isRecording ? 'Stop recording' : 'Record my actions'}
        >
          <RecordIcon active={isRecording} />
        </button>
      )}
      <button className="icon-btn" onClick={() => setShowRecordings(true)} title="Recordings">
        <RecordingsIcon />
      </button>
      <button className="icon-btn" onClick={newConversation} title="New conversation">
        <NewIcon />
      </button>
      <button className="icon-btn" onClick={() => setShowHistory(true)} title="History">
        <HistoryIcon />
      </button>
      <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
        <SettingsIcon />
      </button>
    </div>
  );
}
