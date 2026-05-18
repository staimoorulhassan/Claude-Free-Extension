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

export function Header() {
  const conversations = useStore(s => s.conversations);
  const activeId = useStore(s => s.activeConversationId);
  const showSettings = useStore(s => s.showSettings);
  const showHistory = useStore(s => s.showHistory);
  const newConversation = useStore(s => s.newConversation);
  const setShowSettings = useStore(s => s.setShowSettings);
  const setShowHistory = useStore(s => s.setShowHistory);
  const settings = useStore(s => s.settings);

  const activeConv = conversations.find(c => c.id === activeId);
  const title = showSettings ? 'Settings' : showHistory ? 'History' : (activeConv?.title ?? 'Claude Free');
  const providerLabel = `${settings.provider.provider} · ${settings.provider.defaultModel ?? '—'}`;

  if (showSettings || showHistory) {
    return (
      <div className="header">
        <button className="icon-btn" onClick={() => { setShowSettings(false); setShowHistory(false); }} title="Back">
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
