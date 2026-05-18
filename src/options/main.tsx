import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Apply base styles inline for the options page
const style = document.createElement('style');
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #faf9f5; min-height: 100vh; }
  input, select, textarea { width: 100%; padding: 7px 10px; border: 1px solid #e0dbd0; border-radius: 6px; background: #fff; color: #1a1a1a; font-family: inherit; font-size: 13px; outline: none; }
  input:focus, select:focus, textarea:focus { border-color: #c96442; }
  textarea { resize: vertical; }
`;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
