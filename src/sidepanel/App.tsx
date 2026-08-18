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

  const isChatView = !showSettings && !showHistory && !showRecordings;

  return (
    <div className="app">
      {isChatView && (
        // First element in the DOM so it is the first tab stop (WCAG 2.4.1);
        // only rendered in the chat view, where its target exists.
        <a className="visually-hidden a11y-skip" href="#a11y-composer">Skip to message input</a>
      )}
      <Header />

      {/* WCAG 1.3.1/4.1.2: primary content in a main landmark. The page needs
          exactly one h1 (WCAG 2.4.6); it is visually-hidden so the visible
          header title (dynamic conversation title) stays as-is. */}
      <main className="app-main">
        <h1 className="visually-hidden">Claude Free</h1>
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
      </main>
    </div>
  );
}
