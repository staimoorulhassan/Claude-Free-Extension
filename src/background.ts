/**
 * Service worker — side panel lifecycle, keyboard commands,
 * and CDP-based computer use execution.
 */

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-side-panel') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// ── CDP debugger state ────────────────────────────────────────────────────────

let attachedTabId: number | null = null;

async function getWebTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({ active: true });
  const tab = tabs.find(
    t => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'),
  );
  if (!tab?.id) throw new Error('No active browser tab found');
  return tab.id;
}

async function ensureDebugger(tabId: number): Promise<void> {
  if (attachedTabId === tabId) return;
  if (attachedTabId !== null && attachedTabId !== tabId) {
    try { await chrome.debugger.detach({ tabId: attachedTabId }); } catch { /* ignore */ }
    attachedTabId = null;
  }
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    if (!(e as Error).message?.toLowerCase().includes('already attached')) throw e;
  }
  attachedTabId = tabId;
}

async function cdp(tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown> {
  await ensureDebugger(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabId === tabId) attachedTabId = null;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (attachedTabId === tabId && changeInfo.status === 'loading') attachedTabId = null;
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === attachedTabId) attachedTabId = null;
});

// ── Broadcast helpers ─────────────────────────────────────────────────────────

async function broadcastToWebTabs(message: Record<string, unknown>): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

// ── Key mapping ───────────────────────────────────────────────────────────────

interface KeyInfo { key: string; code: string; text?: string }

const KEY_MAP: Record<string, KeyInfo> = {
  'Return':     { key: 'Enter',      code: 'Enter',       text: '\r' },
  'Enter':      { key: 'Enter',      code: 'Enter',       text: '\r' },
  'Escape':     { key: 'Escape',     code: 'Escape' },
  'Tab':        { key: 'Tab',        code: 'Tab',         text: '\t' },
  'Backspace':  { key: 'Backspace',  code: 'Backspace' },
  'Delete':     { key: 'Delete',     code: 'Delete' },
  'ArrowUp':    { key: 'ArrowUp',    code: 'ArrowUp' },
  'ArrowDown':  { key: 'ArrowDown',  code: 'ArrowDown' },
  'ArrowLeft':  { key: 'ArrowLeft',  code: 'ArrowLeft' },
  'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight' },
  'Home':       { key: 'Home',       code: 'Home' },
  'End':        { key: 'End',        code: 'End' },
  'PageUp':     { key: 'PageUp',     code: 'PageUp' },
  'PageDown':   { key: 'PageDown',   code: 'PageDown' },
  'space':      { key: ' ',          code: 'Space',       text: ' ' },
  'F1':  { key: 'F1',  code: 'F1'  }, 'F2':  { key: 'F2',  code: 'F2'  },
  'F3':  { key: 'F3',  code: 'F3'  }, 'F4':  { key: 'F4',  code: 'F4'  },
  'F5':  { key: 'F5',  code: 'F5'  }, 'F6':  { key: 'F6',  code: 'F6'  },
  'F7':  { key: 'F7',  code: 'F7'  }, 'F8':  { key: 'F8',  code: 'F8'  },
  'F9':  { key: 'F9',  code: 'F9'  }, 'F10': { key: 'F10', code: 'F10' },
  'F11': { key: 'F11', code: 'F11' }, 'F12': { key: 'F12', code: 'F12' },
};

// ── Computer use action types ─────────────────────────────────────────────────

interface ComputerAction {
  action: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  url?: string;
  ref_id?: string;
  filter?: string;
  direction?: string;
  num_clicks?: number;
  duration?: number;
}

interface ComputerToolResult {
  type: 'text' | 'image';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

// ── Computer use handler ──────────────────────────────────────────────────────

async function handleComputerUse(action: ComputerAction): Promise<ComputerToolResult[]> {
  const tabId = await getWebTabId();

  switch (action.action) {

    case 'screenshot': {
      await broadcastToWebTabs({ type: 'HIDE_FOR_TOOL_USE' });
      await new Promise(r => setTimeout(r, 100));
      const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
      await broadcastToWebTabs({ type: 'SHOW_AFTER_TOOL_USE' });
      const base64 = dataUrl.split(',')[1] ?? '';
      return [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } }];
    }

    case 'navigate': {
      const raw = action.url ?? '';
      const url = raw.startsWith('http') ? raw : `https://${raw}`;
      if (attachedTabId === tabId) {
        try { await chrome.debugger.detach({ tabId }); } catch { /* ignore */ }
        attachedTabId = null;
      }
      await chrome.tabs.update(tabId, { url });
      await new Promise(r => setTimeout(r, 2500));
      return [{ type: 'text', text: `Navigated to ${url}` }];
    }

    case 'left_click': {
      const [x, y] = action.coordinate ?? [0, 0];
      await broadcastToWebTabs({ type: 'UPDATE_PHANTOM_CURSOR', x, y });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved',    x, y, button: 'none',  modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'left',  clickCount: 1, modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left',  clickCount: 1, modifiers: 0 });
      return [{ type: 'text', text: `Left-clicked at (${x}, ${y})` }];
    }

    case 'double_click': {
      const [x, y] = action.coordinate ?? [0, 0];
      await broadcastToWebTabs({ type: 'UPDATE_PHANTOM_CURSOR', x, y });
      for (const clickCount of [1, 2]) {
        await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'left', clickCount, modifiers: 0 });
        await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount, modifiers: 0 });
      }
      return [{ type: 'text', text: `Double-clicked at (${x}, ${y})` }];
    }

    case 'right_click': {
      const [x, y] = action.coordinate ?? [0, 0];
      await broadcastToWebTabs({ type: 'UPDATE_PHANTOM_CURSOR', x, y });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'right', clickCount: 1, modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1, modifiers: 0 });
      return [{ type: 'text', text: `Right-clicked at (${x}, ${y})` }];
    }

    case 'middle_click': {
      const [x, y] = action.coordinate ?? [0, 0];
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'middle', clickCount: 1, modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'middle', clickCount: 1, modifiers: 0 });
      return [{ type: 'text', text: `Middle-clicked at (${x}, ${y})` }];
    }

    case 'type': {
      await cdp(tabId, 'Input.insertText', { text: action.text ?? '' });
      return [{ type: 'text', text: `Typed: "${action.text}"` }];
    }

    case 'key': {
      const keyStr = action.text ?? '';
      const isCtrl  = /ctrl\+/i.test(keyStr);
      const isShift = /shift\+/i.test(keyStr);
      const isAlt   = /alt\+/i.test(keyStr);
      const isMeta  = /meta\+|cmd\+/i.test(keyStr);
      const base = keyStr.replace(/ctrl\+|shift\+|alt\+|meta\+|cmd\+/gi, '');
      const info: KeyInfo = KEY_MAP[base] ?? {
        key: base,
        code: base.length === 1 ? `Key${base.toUpperCase()}` : base,
        text: base.length === 1 ? base : undefined,
      };
      const modifiers = (isAlt ? 1 : 0) | (isCtrl ? 2 : 0) | (isMeta ? 4 : 0) | (isShift ? 8 : 0);
      await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: info.key, code: info.code, modifiers, text: info.text });
      await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp',   key: info.key, code: info.code, modifiers });
      return [{ type: 'text', text: `Pressed key: ${keyStr}` }];
    }

    case 'scroll': {
      const [x, y] = action.coordinate ?? [640, 400];
      const delta = (action.num_clicks ?? 3) * 100;
      const deltaY = action.direction === 'up' ? -delta : action.direction === 'down' ? delta : 0;
      const deltaX = action.direction === 'left' ? -delta : action.direction === 'right' ? delta : 0;
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers: 0 });
      return [{ type: 'text', text: `Scrolled ${action.direction}` }];
    }

    case 'left_click_drag': {
      const [sx, sy] = action.start_coordinate ?? [0, 0];
      const [ex, ey] = action.coordinate ?? [0, 0];
      await broadcastToWebTabs({ type: 'UPDATE_PHANTOM_CURSOR', x: sx, y: sy });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1, modifiers: 0 });
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(sx + (ex - sx) * i / steps);
        const y = Math.round(sy + (ey - sy) * i / steps);
        await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', modifiers: 0 });
        await broadcastToWebTabs({ type: 'UPDATE_PHANTOM_CURSOR', x, y });
        await new Promise(r => setTimeout(r, 20));
      }
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex, y: ey, button: 'left', clickCount: 1, modifiers: 0 });
      return [{ type: 'text', text: `Dragged from (${sx},${sy}) to (${ex},${ey})` }];
    }

    case 'read_page': {
      const filter = action.filter ?? 'interactive';
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN' as chrome.scripting.ExecutionWorld,
        func: (f: string) => {
          const fn = (window as unknown as Record<string, unknown>).__generateAccessibilityTree;
          if (typeof fn !== 'function') {
            return { error: 'Accessibility tree not ready. Try again after the page finishes loading.', pageContent: '', viewport: { width: window.innerWidth, height: window.innerHeight } };
          }
          return (fn as (f: string, d: number, c: number, r: undefined) => unknown)(f, 15, 50000, undefined);
        },
        args: [filter],
      });
      const result = results[0]?.result as { pageContent?: string; viewport?: { width: number; height: number }; error?: string } | null;
      if (result?.error) return [{ type: 'text', text: `Error: ${result.error}` }];
      return [{ type: 'text', text: `Viewport: ${result?.viewport?.width}x${result?.viewport?.height}\n${result?.pageContent}` }];
    }

    case 'click_element': {
      const refId = action.ref_id ?? '';
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN' as chrome.scripting.ExecutionWorld,
        func: (id: string) => {
          const map = (window as unknown as Record<string, unknown>).__claudeElementMap as Record<string, WeakRef<Element>> | undefined;
          if (!map?.[id]) return { error: `Element ${id} not found. Call read_page first.` };
          const el = map[id].deref();
          if (!el) return { error: `Element ${id} no longer in DOM.` };
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        },
        args: [refId],
      });
      const res = results[0]?.result as { x?: number; y?: number; error?: string } | null;
      if (res?.error) return [{ type: 'text', text: `Error: ${res.error}` }];
      const { x = 0, y = 0 } = res ?? {};
      await broadcastToWebTabs({ type: 'UPDATE_PHANTOM_CURSOR', x, y });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved',    x, y, button: 'none', modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'left', clickCount: 1, modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers: 0 });
      return [{ type: 'text', text: `Clicked element ${refId} at (${x},${y})` }];
    }

    case 'wait': {
      await new Promise(r => setTimeout(r, (action.duration ?? 1) * 1000));
      return [{ type: 'text', text: `Waited ${action.duration ?? 1}s` }];
    }

    default:
      return [{ type: 'text', text: `Unknown action: ${action.action}` }];
  }
}

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PING') {
    sendResponse({ type: 'PONG' });
    return false;
  }

  if (msg.type === 'computer_use') {
    handleComputerUse(msg.action as ComputerAction)
      .then(result => sendResponse({ result }))
      .catch(e => sendResponse({ error: (e as Error).message }));
    return true;
  }

  if (msg.type === 'AGENT_STARTED') {
    broadcastToWebTabs({ type: 'SHOW_AGENT_INDICATORS' });
    return false;
  }

  if (msg.type === 'AGENT_STOPPED') {
    broadcastToWebTabs({ type: 'HIDE_AGENT_INDICATORS' });
    return false;
  }

  if (msg.type === 'STOP_AGENT') {
    // Stop button clicked in page — relay to side panel
    chrome.runtime.sendMessage({ type: 'STOP_GENERATION' }).catch(() => {});
    return false;
  }

  return false;
});
