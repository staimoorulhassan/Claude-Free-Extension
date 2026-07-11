import { useEffect } from 'react';
import { useStore } from './store';
import { Header } from './components/Header';
import { Chat } from './components/Chat';
import { MessageInput } from './components/MessageInput';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ApprovalCard } from './components/ApprovalCard';
import { AskUserCard } from './components/AskUserCard';
import { RecordingsPanel } from './components/RecordingsPanel';

function applyTheme(theme: 'auto' | 'light' | 'dark') {
  const isDark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

export function App() {
  const init = useStore(s => s.init);
  const showSettings = useStore(s => s.showSettings);
  const showHistory = useStore(s => s.showHistory);
  const showRecordings = useStore(s => s.showRecordings);
  const settings = useStore(s => s.settings);
  const error = useStore(s => s.error);
  const clearError = useStore(s => s.clearError);

  useEffect(() => { init(); }, [init]);

  useEffect(() => {
    applyTheme(settings.theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (settings.theme === 'auto') applyTheme('auto'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [settings.theme]);

  return (
    <div className="app">
      <Header />

      {showSettings ? (
        <SettingsPanel />
      ) : showHistory ? (
        <HistoryPanel />
      ) : showRecordings ? (
        <RecordingsPanel />
      ) : (
        <>
          <Chat />
          {error && (
            <div className="error-bar">
              <span>{error}</span>
              <button onClick={clearError}>×</button>
            </div>
          )}
          <ApprovalCard />
          <AskUserCard />
          <MessageInput />
        </>
      )}
    </div>
  );
}
