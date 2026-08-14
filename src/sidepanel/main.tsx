import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './sidepanel.css';

// Tell the background the panel is open so it can group the current tab into
// the extension's tab group (fire-and-forget; the background no-ops when the
// active tab is already grouped or isn't a web tab).
chrome.runtime.sendMessage({ type: 'PANEL_OPENED' }).catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
