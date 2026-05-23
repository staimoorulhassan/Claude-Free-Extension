/**
 * Visual indicator content script — injected into all pages.
 * Shows animated glow border, phantom cursor, and stop button during agent automation.
 * No AudioContext — avoids browser autoplay policy violations.
 */

let glowBorder: HTMLDivElement | null = null;
let stopContainer: HTMLDivElement | null = null;
let phantomCursor: HTMLDivElement | null = null;
let isActive = false;
let wasActiveBeforeHide = false;

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('claude-agent-styles')) return;
  const style = document.createElement('style');
  style.id = 'claude-agent-styles';
  style.textContent = `
    @keyframes claude-pulse {
      0%   { box-shadow: inset 0 0 12px rgba(59,130,246,0.55), inset 0 0 24px rgba(59,130,246,0.35), inset 0 0 40px rgba(59,130,246,0.15), 0 0 0 2px rgba(59,130,246,0.6); }
      50%  { box-shadow: inset 0 0 18px rgba(59,130,246,0.80), inset 0 0 32px rgba(59,130,246,0.55), inset 0 0 50px rgba(59,130,246,0.25), 0 0 0 2px rgba(59,130,246,0.9); }
      100% { box-shadow: inset 0 0 12px rgba(59,130,246,0.55), inset 0 0 24px rgba(59,130,246,0.35), inset 0 0 40px rgba(59,130,246,0.15), 0 0 0 2px rgba(59,130,246,0.6); }
    }
  `;
  document.head.appendChild(style);
}

// ── Glow border ───────────────────────────────────────────────────────────────

function showGlow() {
  if (!glowBorder) {
    glowBorder = document.createElement('div');
    glowBorder.id = 'claude-agent-glow-border';
    glowBorder.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; z-index: 2147483646;
      opacity: 0; transition: opacity 0.3s ease-in-out;
      animation: claude-pulse 2s ease-in-out infinite;
      box-shadow: inset 0 0 12px rgba(59,130,246,0.55), inset 0 0 24px rgba(59,130,246,0.35), inset 0 0 40px rgba(59,130,246,0.15), 0 0 0 2px rgba(59,130,246,0.6);
    `;
    document.body.appendChild(glowBorder);
  }
  glowBorder.style.display = '';
  requestAnimationFrame(() => { if (glowBorder) glowBorder.style.opacity = '1'; });
}

function hideGlow() {
  if (glowBorder) glowBorder.style.opacity = '0';
}

// ── Stop button ───────────────────────────────────────────────────────────────

function showStopButton() {
  if (!stopContainer) {
    stopContainer = document.createElement('div');
    stopContainer.id = 'claude-agent-stop-container';
    stopContainer.style.cssText = `
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      display: flex; justify-content: center; align-items: center;
      pointer-events: none; z-index: 2147483647;
    `;

    const btn = document.createElement('button');
    btn.id = 'claude-agent-stop-button';
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" style="margin-right:10px;vertical-align:middle;">
        <path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Zm40-112v56a12,12,0,0,1-12,12H100a12,12,0,0,1-12-12V100a12,12,0,0,1,12-12h56A12,12,0,0,1,168,100Z"/>
      </svg>
      <span style="vertical-align:middle;">Stop Claude</span>
    `;
    btn.style.cssText = `
      position: relative; transform: translateY(100px);
      padding: 10px 16px; background: #FAF9F5; color: #141413;
      border: 0.5px solid rgba(31,30,29,0.4); border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px; font-weight: 600; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 24px rgba(59,130,246,0.35);
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      opacity: 0; user-select: none; pointer-events: auto; white-space: nowrap;
    `;
    btn.addEventListener('mouseenter', () => { btn.style.background = '#F5F4F0'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#FAF9F5'; });
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'STOP_AGENT', fromTabId: 'CURRENT_TAB' });
    });

    stopContainer.appendChild(btn);
    document.body.appendChild(stopContainer);
  }

  stopContainer.style.display = '';
  requestAnimationFrame(() => {
    const btn = stopContainer?.querySelector<HTMLElement>('#claude-agent-stop-button');
    if (btn) { btn.style.transform = 'translateY(0)'; btn.style.opacity = '1'; }
  });
}

function hideStopButton() {
  const btn = stopContainer?.querySelector<HTMLElement>('#claude-agent-stop-button');
  if (btn) { btn.style.transform = 'translateY(100px)'; btn.style.opacity = '0'; }
}

// ── Phantom cursor ────────────────────────────────────────────────────────────

function moveCursor(x: number, y: number): Promise<void> {
  if (!isActive) return Promise.resolve();

  if (!phantomCursor) {
    const ns = 'http://www.w3.org/2000/svg';
    const mkPath = (attrs: Record<string, string>) => {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', 'M0 0 L0 18 L4.5 14 L7.5 21.5 L11 20 L8 13 L14 13 Z');
      for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
      return p;
    };
    const mkSvg = (id: string, stroke: string, fill: string, css: string) => {
      const svg = document.createElementNS(ns, 'svg');
      svg.id = id;
      svg.setAttribute('width', '20'); svg.setAttribute('height', '26');
      svg.setAttribute('viewBox', '0 0 20 26');
      svg.style.cssText = `position:absolute;top:0;left:0;overflow:visible;${css}`;
      svg.appendChild(mkPath({ stroke, 'stroke-width': '3', 'stroke-linejoin': 'round', fill: stroke }));
      svg.appendChild(mkPath({ fill }));
      return svg;
    };

    phantomCursor = document.createElement('div');
    phantomCursor.id = 'claude-phantom-cursor';
    phantomCursor.setAttribute('aria-hidden', 'true');
    phantomCursor.style.cssText = `
      position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147483646;
      transform: translate3d(${x}px, ${y}px, 0);
      transition: transform 180ms cubic-bezier(0.2,0,0,1);
      will-change: transform;
    `;
    phantomCursor.appendChild(mkSvg('claude-phantom-cursor-plain', 'white', '#111', ''));
    phantomCursor.appendChild(mkSvg(
      'claude-phantom-cursor-styled', '#3B82F6', '#EFF6FF',
      'filter:drop-shadow(0 0 5px rgba(59,130,246,1)) drop-shadow(0 0 12px rgba(59,130,246,0.7)) drop-shadow(0 0 20px rgba(59,130,246,0.4));',
    ));
    document.body.appendChild(phantomCursor);
    return Promise.resolve();
  }

  phantomCursor.style.display = '';
  phantomCursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;

  if (document.hidden) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; phantomCursor?.removeEventListener('transitionend', finish); resolve(); } };
    phantomCursor!.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 220);
  });
}

function removeCursor() {
  phantomCursor?.remove();
  phantomCursor = null;
}

// ── Show / hide all ───────────────────────────────────────────────────────────

function showAll() {
  isActive = true;
  injectStyles();
  showGlow();
  showStopButton();
  // Place cursor at center if not yet positioned
  if (!phantomCursor) {
    moveCursor(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
  } else {
    phantomCursor.style.display = '';
  }
}

function hideAll() {
  if (!isActive) return;
  isActive = false;
  hideGlow();
  hideStopButton();
  setTimeout(() => {
    if (isActive) return;
    glowBorder?.remove(); glowBorder = null;
    stopContainer?.remove(); stopContainer = null;
    removeCursor();
  }, 300);
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'SHOW_AGENT_INDICATORS':
      showAll();
      sendResponse({ success: true });
      break;
    case 'HIDE_AGENT_INDICATORS':
      hideAll();
      sendResponse({ success: true });
      break;
    case 'UPDATE_PHANTOM_CURSOR':
      moveCursor(msg.x as number, msg.y as number).then(() => sendResponse({ success: true }));
      return true; // async
    case 'HIDE_FOR_TOOL_USE':
      wasActiveBeforeHide = isActive;
      if (glowBorder) glowBorder.style.display = 'none';
      if (stopContainer) stopContainer.style.display = 'none';
      if (phantomCursor) phantomCursor.style.display = 'none';
      sendResponse({ success: true });
      break;
    case 'SHOW_AFTER_TOOL_USE':
      if (wasActiveBeforeHide) {
        if (glowBorder) glowBorder.style.display = '';
        if (stopContainer) stopContainer.style.display = '';
      }
      if (phantomCursor) phantomCursor.style.display = '';
      wasActiveBeforeHide = false;
      sendResponse({ success: true });
      break;
  }
  return false;
});

window.addEventListener('beforeunload', () => {
  hideAll();
});
