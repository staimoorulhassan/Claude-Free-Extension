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
  /* WCAG 2.4.7 / 1.4.11: visible keyboard focus indicator */
  :focus-visible { outline: 2px solid #c96442; outline-offset: 2px; }
  :focus { scroll-margin-block: 16px; }
  /* WCAG 2.4.1: skip link (visually hidden until focused) */
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .a11y-skip:focus { position: static; width: auto; height: auto; margin: 0; clip: auto; white-space: normal; padding: 8px 12px; background: #c96442; color: #fff; border-radius: 0 0 8px 0; z-index: 999; }
`;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
