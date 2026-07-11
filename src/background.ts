/**
 * Service worker — side panel lifecycle, keyboard commands,
 * and CDP-based computer use execution.
 */

import { createOrJoinGroup, setGroupState, getGroupId, forgetGroup } from './lib/tabGroups';
import {
  newJournal, writeJournal, readJournal,
  findInProgressJournals, resolveJournalOnStartup,
} from './lib/journal';
import type { ExecutionJournal } from './lib/types';

// ── Offscreen keepalive lifecycle (T033/T034) ────────────────────────────────────
// Created lazily on the first active task, closed once no journal is in_progress —
// not held open at all times, so an idle extension has zero extra background cost.

let offscreenReady: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const existing = await chrome.runtime.getContexts?.({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] }).catch(() => []) ?? [];
    if (existing.length > 0) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.BLOBS], // closest available justification for a long-lived keepalive port
      justification: 'Keep the service worker alive during a long-running agent task (spec 001-claude-free-extension US3).',
    });
  })();
  try {
    await offscreenReady;
  } catch {
    offscreenReady = null; // allow retry on the next task if creation failed
  }
}

async function closeOffscreenDocumentIfIdle(): Promise<void> {
  const stillActive = await findInProgressJournals();
  if (stillActive.length > 0) return;
  try {
    await chrome.offscreen.closeDocument();
  } catch { /* already closed, or never opened */ }
  offscreenReady = null;
}

// ── Resume-on-startup (T036/T037) ─────────────────────────────────────────────────
// Service workers re-run their top-level module code on every wake, including after
// an MV3 idle-termination restart — this IS the "auto-hydration on restart" hook.

async function resumeInProgressTasksOnStartup(): Promise<void> {
  const journals = await findInProgressJournals();
  for (const journal of journals) {
    const { journal: resolved, resumed } = await resolveJournalOnStartup(journal, verifyJournalTabExists);
    if (resumed) {
      chrome.runtime.sendMessage({ type: 'TASK_RESUMED', taskId: resolved.taskId, fromRound: resolved.roundCount }).catch(() => {});
      // No sidepanel may be listening yet — the conversation history is safely on
      // disk regardless, so a later-opened sidepanel can still recover it via
      // readJournal(taskId). Fully autonomous, sidepanel-less continuation of the
      // LLM loop itself is out of scope for this pass (see tasks.md T035 note).
    } else {
      chrome.runtime.sendMessage({ type: 'TASK_ORPHANED', taskId: resolved.taskId, reason: 'tab_closed' }).catch(() => {});
    }
  }
  if (journals.length > 0) await ensureOffscreenDocument();
}

async function verifyJournalTabExists(journal: ExecutionJournal): Promise<boolean> {
  if (journal.activeTabId === null) return true;
  try {
    await chrome.tabs.get(journal.activeTabId);
    return true;
  } catch {
    return false;
  }
}

resumeInProgressTasksOnStartup().catch(() => {});

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

// ── Recording state ───────────────────────────────────────────────────────────

interface RecordedStep {
  action: string;
  url?: string;
  x?: number; y?: number;
  elementTag?: string; elementText?: string; elementHref?: string;
  text?: string; inputName?: string;
}

let recordingActive = false;
let recordingTabId: number | null = null;
let recordingSteps: RecordedStep[] = [];

// Track navigations that happen while recording
function maybeRecordNavigation(tabId: number, url: string) {
  if (recordingActive && recordingTabId === tabId && url) {
    recordingSteps.push({ action: 'navigate', url });
  }
}

// ── CDP debugger state ────────────────────────────────────────────────────────
//
// One debugger session per tab (not a single global) so a task can drive more than
// one tab at once — required for multi-tab tool execution (spec 001-claude-free-extension
// FR-005) and tab-grouped parallel extraction (FR-006-008). Each attached tab keeps its
// own Page/Log/Network domain state; sessions are torn down on tab close/navigate-away/
// external detach, same lifecycle the old single-global version had, just per-tab now.

interface DebuggerSession {
  attachedAt: number;
  logNetworkEnabled: boolean;
}

const debuggerSessions = new Map<number, DebuggerSession>();

function isAttached(tabId: number): boolean {
  return debuggerSessions.has(tabId);
}

async function detachDebugger(tabId: number): Promise<void> {
  if (!debuggerSessions.has(tabId)) return;
  debuggerSessions.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch { /* ignore */ }
}

async function getWebTabId(windowId?: number): Promise<number> {
  // Only exclude the extension's own pages; allow chrome://newtab and other chrome:// tabs
  const isUsable = (t: chrome.tabs.Tab) =>
    !!t.id && !!t.url && !t.url.startsWith('chrome-extension://');

  if (windowId) {
    // 1. Active tab in the specific side-panel window
    const [active] = await chrome.tabs.query({ active: true, windowId });
    if (active && isUsable(active)) return active.id!;
    // 2. Any usable tab in that window (covers chrome://newtab as active tab)
    const all = await chrome.tabs.query({ windowId });
    const any = all.find(isUsable);
    if (any?.id) return any.id;
  }

  // 3. Global fallback: last focused window's active tab
  const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (fallback && isUsable(fallback)) return fallback.id!;

  throw new Error('No browser tab found. Please open a webpage first.');
}

// Issue 5+8: enable Page domain after attach; retry on transient detach errors.
// No longer detaches other tabs first — each tab keeps its own session (T005).
// Log/Network domain enabling is layered on in T016 (enableLogNetworkDomains, below).
async function ensureDebugger(tabId: number): Promise<void> {
  if (debuggerSessions.has(tabId)) return;
  // Issue 8: retry attach — handles pages that detach mid-sequence (redirects etc.)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      break;
    } catch (e) {
      if ((e as Error).message?.toLowerCase().includes('already attached')) break;
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  debuggerSessions.set(tabId, { attachedAt: Date.now(), logNetworkEnabled: false });
  // Issue 5: enable Page domain so Page.captureScreenshot and Page.loadEventFired work
  try { await chrome.debugger.sendCommand({ tabId }, 'Page.enable'); } catch { /* ignore */ }
}

// Issue 8: retry CDP commands on transient detach/attach errors
async function cdp(tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureDebugger(tabId);
      return await chrome.debugger.sendCommand({ tabId }, method, params);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const isDetach = msg.includes('detach') || msg.includes('no such') || msg.includes('No target');
      if (attempt === 1 || !isDetach) throw e;
      debuggerSessions.delete(tabId); // force re-attach next attempt
      await new Promise(r => setTimeout(r, 400));
    }
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  debuggerSessions.delete(tabId);
  consoleErrorsByTab.delete(tabId);
  networkErrorsByTab.delete(tabId);
  currentTaskOpenedTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (debuggerSessions.has(tabId) && changeInfo.status === 'loading') debuggerSessions.delete(tabId);
  if (changeInfo.url) maybeRecordNavigation(tabId, changeInfo.url);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) debuggerSessions.delete(source.tabId);
});

// ── Console/network error capture (T016) ────────────────────────────────────────
// Accumulated per tab since the last read_page_state call, via CDP Log/Network
// domains — not visible to a content script (cross-origin iframes, SW-initiated
// requests). Cleared each time read_page_state drains them.

interface ConsoleErrorEntry { level: 'error' | 'warning'; text: string; timestamp: number }
interface NetworkErrorEntry { url: string; status: number; method: string; timestamp: number }

const consoleErrorsByTab = new Map<number, ConsoleErrorEntry[]>();
const networkErrorsByTab = new Map<number, NetworkErrorEntry[]>();
// Composite key (tabId:requestId) prevents collision across tabs and allows cleanup when a request terminates
const inflightRequests = new Map<string, { url: string; method: string }>();

async function enableLogNetworkDomains(tabId: number): Promise<void> {
  const session = debuggerSessions.get(tabId);
  if (!session || session.logNetworkEnabled) return;
  try { await chrome.debugger.sendCommand({ tabId }, 'Log.enable'); } catch { /* ignore */ }
  try { await chrome.debugger.sendCommand({ tabId }, 'Network.enable'); } catch { /* ignore */ }
  session.logNetworkEnabled = true;
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId === undefined) return;

  if (method === 'Log.entryAdded') {
    const entry = (params as { entry?: { level?: string; text?: string; timestamp?: number } })?.entry;
    if (entry && (entry.level === 'error' || entry.level === 'warning')) {
      const list = consoleErrorsByTab.get(tabId) ?? [];
      list.push({ level: entry.level, text: entry.text ?? '', timestamp: entry.timestamp ?? Date.now() });
      consoleErrorsByTab.set(tabId, list.slice(-50)); // cap per-tab backlog
    }
    return;
  }

  if (method === 'Network.requestWillBeSent') {
    const p = params as { requestId?: string; request?: { url?: string; method?: string } };
    if (p.requestId) {
      const key = `${tabId}:${p.requestId}`;
      inflightRequests.set(key, { url: p.request?.url ?? '', method: p.request?.method ?? 'GET' });
    }
    return;
  }

  if (method === 'Network.responseReceived') {
    const p = params as { requestId?: string; response?: { url?: string; status?: number } };
    const key = p.requestId ? `${tabId}:${p.requestId}` : undefined;
    const info = key ? inflightRequests.get(key) : undefined;
    const status = p.response?.status ?? 0;
    if (status >= 400) {
      const list = networkErrorsByTab.get(tabId) ?? [];
      list.push({
        url: p.response?.url ?? info?.url ?? '',
        status,
        method: info?.method ?? 'GET',
        timestamp: Date.now(),
      });
      networkErrorsByTab.set(tabId, list.slice(-50));
    }
    // Clean up the inflight entry now that the request has terminated
    if (key) inflightRequests.delete(key);
    return;
  }

  if (method === 'Network.loadingFailed') {
    const p = params as { requestId?: string; errorText?: string };
    const key = p.requestId ? `${tabId}:${p.requestId}` : undefined;
    const info = key ? inflightRequests.get(key) : undefined;
    if (info) {
      const list = networkErrorsByTab.get(tabId) ?? [];
      list.push({ url: info.url, status: 0, method: info.method, timestamp: Date.now() });
      networkErrorsByTab.set(tabId, list.slice(-50));
    }
    // Clean up the inflight entry now that the request has terminated
    if (key) inflightRequests.delete(key);
  }
});

// Redact potential secrets from console error text before sending to LLM provider
function sanitizeConsoleError(text: string): string {
  return text
    // Redact common secret patterns: API keys, tokens, bearer tokens
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
    .replace(/(?:api[_-]?key|token|secret|password|auth)[\s:=]+[^\s&<>"']+/gi, '$&[REDACTED]')
    .replace(/bearer\s+[^\s&<>"']+/gi, 'bearer [REDACTED]')
    .replace(/authorization:\s*[^\s&<>"']+/gi, 'authorization: [REDACTED]');
}

// Normalize network error URL by stripping query params and fragments while preserving method/status
function sanitizeNetworkErrorUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Not a valid URL, strip query/fragment manually
    return url.split('?')[0].split('#')[0];
  }
}

function drainErrors(tabId: number): { consoleErrors: ConsoleErrorEntry[]; networkErrors: NetworkErrorEntry[] } {
  const consoleErrors = consoleErrorsByTab.get(tabId) ?? [];
  const networkErrors = networkErrorsByTab.get(tabId) ?? [];
  consoleErrorsByTab.delete(tabId);
  networkErrorsByTab.delete(tabId);
  return { consoleErrors, networkErrors };
}

// ── DOM settlement wait (T013) ───────────────────────────────────────────────────
// Replaces fixed setTimeout()s after click/type/navigate with an actual
// MutationObserver-based DOM-quiet check (bounded by a timeout so a page that
// never goes quiet — e.g. a live-updating dashboard — can't hang the loop).

async function waitForSettlement(tabId: number, opts?: { timeoutMs?: number; quietMs?: number }): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 3000;
  const quietMs = opts?.quietMs ?? 500;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN' as chrome.scripting.ExecutionWorld,
      func: (quiet: number, timeout: number) => new Promise<void>((resolve) => {
        let lastMutation = Date.now();
        const observer = new MutationObserver(() => { lastMutation = Date.now(); });
        try {
          observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        } catch { /* documentElement not ready */ }
        const start = Date.now();
        const check = () => {
          const now = Date.now();
          if (now - lastMutation >= quiet || now - start >= timeout) {
            observer.disconnect();
            resolve();
            return;
          }
          setTimeout(check, 100);
        };
        check();
      }),
      args: [quietMs, timeoutMs],
    });
  } catch {
    // Page may have navigated away mid-wait, or script injection was blocked — fall
    // back to a short fixed delay so callers still get a minimal settle window.
    await new Promise(r => setTimeout(r, 200));
  }
}

// ── Per-task tab tracking (T018) ─────────────────────────────────────────────────
// Tabs opened via manage_tabs('open') during the current agent run, so 'close' can
// refuse to close anything the task didn't create itself. Reset on AGENT_STARTED.

let currentTaskOpenedTabs = new Set<number>();
let currentTaskId: string | null = null;
let currentTaskName = 'Task';

// ── Broadcast helpers ─────────────────────────────────────────────────────────

async function broadcastToWebTabs(message: Record<string, unknown>): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

// Issue 6: ensure tab is active before dispatching input events
async function activateTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { active: true });
    await new Promise(r => setTimeout(r, 50));
  } catch { /* ignore if tab is gone */ }
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
  // ── spec 001-claude-free-extension additions ────────────────────────────────
  selector?: string;
  submit?: boolean;
  include_vision?: boolean;
  script?: string;
  op?: 'open' | 'switch' | 'close' | 'group_status';
  tab_id?: number;
  prompt?: string;
  requires_manual_action?: boolean;
}

interface ComputerToolResult {
  type: 'text' | 'image';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

// ── Computer use handler ──────────────────────────────────────────────────────

async function handleComputerUse(action: ComputerAction, windowId?: number): Promise<ComputerToolResult[]> {
  const tabId = await getWebTabId(windowId);

  switch (action.action) {

    case 'screenshot': {
      await broadcastToWebTabs({ type: 'HIDE_FOR_TOOL_USE' }).catch(() => {});
      await new Promise(r => setTimeout(r, 150));

      let base64: string;
      let mediaType = 'image/jpeg';
      try {
        try {
          // Issue 4: get DPR and viewport so we can normalise to CSS pixels
          const metrics = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => ({
              dpr: window.devicePixelRatio || 1,
              w: document.documentElement.clientWidth || window.innerWidth,
              h: document.documentElement.clientHeight || window.innerHeight,
            }),
          });
          const { dpr = 1, w = 1280, h = 800 } =
            (metrics[0]?.result as { dpr: number; w: number; h: number }) ?? {};

          // clip.scale = 1/dpr forces output at CSS-pixel resolution so the
          // coordinates the AI sends back match what CDP Input.* expects
          const shot = await cdp(tabId, 'Page.captureScreenshot', {
            format: 'jpeg',
            quality: 70,
            captureBeyondViewport: false,
            clip: { x: 0, y: 0, width: w, height: h, scale: 1 / dpr },
          }) as { data: string };
          base64 = shot.data;
        } catch {
          // Fallback: captureVisibleTab with explicit windowId (avoids activeTab issue)
          const tab = await chrome.tabs.get(tabId);
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: 'jpeg', quality: 70 });
          base64 = dataUrl.split(',')[1] ?? '';
        }
      } finally {
        // Always restore the automation indicator, even if screenshot capture failed
        await broadcastToWebTabs({ type: 'SHOW_AFTER_TOOL_USE' }).catch(() => {});
      }

      return [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }];
    }

    case 'navigate': {
      const raw = action.url ?? '';
      const url = raw.startsWith('http') ? raw : `https://${raw}`;
      if (isAttached(tabId)) await detachDebugger(tabId);
      await chrome.tabs.update(tabId, { url });

      // Issue 7 / T012: wait for DOMContentReady (tab status 'complete') instead of a fixed sleep
      await new Promise<void>(resolve => {
        const MAX_WAIT = 15000;
        const timer = setTimeout(resolve, MAX_WAIT);
        const listener = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
          if (updatedId === tabId && info.status === 'complete') {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
      // T013: DOM-mutation settlement instead of a fixed extra sleep, so JS-framework
      // hydration gets exactly as long as it actually needs (bounded by the timeout).
      await waitForSettlement(tabId);
      return [{ type: 'text', text: `Navigated to ${url}` }];
    }

    case 'left_click': {
      await activateTab(tabId); // Issue 6
      const [x, y] = action.coordinate ?? [0, 0];
      await broadcastToWebTabs({ type: 'UPDATE_PHANTOM_CURSOR', x, y });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved',    x, y, button: 'none',  modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'left',  clickCount: 1, modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left',  clickCount: 1, modifiers: 0 });
      // Issue 12 / T013: DOM-mutation settlement instead of a fixed sleep
      await waitForSettlement(tabId);
      return [{ type: 'text', text: `Left-clicked at (${x}, ${y})` }];
    }

    case 'double_click': {
      await activateTab(tabId); // Issue 6
      const [x, y] = action.coordinate ?? [0, 0];
      await broadcastToWebTabs({ type: 'UPDATE_PHANTOM_CURSOR', x, y });
      for (const clickCount of [1, 2]) {
        await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'left', clickCount, modifiers: 0 });
        await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount, modifiers: 0 });
      }
      return [{ type: 'text', text: `Double-clicked at (${x}, ${y})` }];
    }

    case 'right_click': {
      await activateTab(tabId); // Issue 6
      const [x, y] = action.coordinate ?? [0, 0];
      await broadcastToWebTabs({ type: 'UPDATE_PHANTOM_CURSOR', x, y });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'right', clickCount: 1, modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1, modifiers: 0 });
      return [{ type: 'text', text: `Right-clicked at (${x}, ${y})` }];
    }

    case 'middle_click': {
      await activateTab(tabId); // Issue 6
      const [x, y] = action.coordinate ?? [0, 0];
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'middle', clickCount: 1, modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'middle', clickCount: 1, modifiers: 0 });
      return [{ type: 'text', text: `Middle-clicked at (${x}, ${y})` }];
    }

    case 'type': {
      await activateTab(tabId); // Issue 6
      await cdp(tabId, 'Input.insertText', { text: action.text ?? '' });
      return [{ type: 'text', text: `Typed: "${action.text}"` }];
    }

    case 'type_text': {
      // T014: unlike 'type' (types into whatever already has focus), this focuses a
      // specific element by ref-id/selector first, then types, with optional submit.
      await activateTab(tabId);
      const selector = action.selector ?? action.ref_id ?? '';
      const focusResult = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN' as chrome.scripting.ExecutionWorld,
        func: (id: string) => {
          const map = (window as unknown as Record<string, unknown>).__claudeElementMap as Record<string, WeakRef<Element>> | undefined;
          if (!map?.[id]) return { error: `Element ${id} not found. Call read_page_state first.` };
          const el = map[id].deref();
          if (!el) return { error: `Element ${id} no longer in DOM.` };
          (el as HTMLElement).focus?.();
          return { ok: true };
        },
        args: [selector],
      });
      const focusRes = focusResult[0]?.result as { ok?: boolean; error?: string } | null;
      if (focusRes?.error) return [{ type: 'text', text: `Error: ${focusRes.error}` }];

      await cdp(tabId, 'Input.insertText', { text: action.text ?? '' });
      if (action.submit) {
        const info = KEY_MAP['Return'];
        await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: info.key, code: info.code, text: info.text });
        await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: info.key, code: info.code });
      }
      await waitForSettlement(tabId);
      return [{ type: 'text', text: `Typed "${action.text}" into ${selector}${action.submit ? ' and pressed Enter' : ''}` }];
    }

    case 'key': {
      await activateTab(tabId); // Issue 6
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
      // Issue 12: after Enter/Return give the page time to submit forms or trigger navigation
      if (base === 'Return' || base === 'Enter') {
        await new Promise(r => setTimeout(r, 800));
      }
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
      await activateTab(tabId); // Issue 6
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

    case 'read_page_state': {
      // T015/T016: read_page's accessibility tree + viewport, plus console/network
      // errors accumulated since the last call, plus an optional screenshot.
      await ensureDebugger(tabId);
      await enableLogNetworkDomains(tabId);

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
      const { consoleErrors, networkErrors } = drainErrors(tabId);

      const parts: string[] = [];
      if (result?.error) {
        parts.push(`Error: ${result.error}`);
      } else {
        parts.push(`Viewport: ${result?.viewport?.width}x${result?.viewport?.height}`);
        if (consoleErrors.length) {
          parts.push(`Console errors (${consoleErrors.length}): ` + consoleErrors.map(e => `[${e.level}] ${sanitizeConsoleError(e.text)}`).join(' | '));
        }
        if (networkErrors.length) {
          parts.push(`Network errors (${networkErrors.length}): ` + networkErrors.map(e => `${e.method} ${sanitizeNetworkErrorUrl(e.url)} → ${e.status || 'failed'}`).join(' | '));
        }
        parts.push(result?.pageContent ?? '');
      }

      const blocks: ComputerToolResult[] = [{ type: 'text', text: parts.join('\n') }];

      if (action.include_vision) {
        try {
          await broadcastToWebTabs({ type: 'HIDE_FOR_TOOL_USE' }).catch(() => {});
          await new Promise(r => setTimeout(r, 150));
          try {
            const metrics = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => ({
                dpr: window.devicePixelRatio || 1,
                w: document.documentElement.clientWidth || window.innerWidth,
                h: document.documentElement.clientHeight || window.innerHeight,
              }),
            });
            const { dpr = 1, w = 1280, h = 800 } = (metrics[0]?.result as { dpr: number; w: number; h: number }) ?? {};
            const shot = await cdp(tabId, 'Page.captureScreenshot', {
              format: 'jpeg', quality: 70, captureBeyondViewport: false,
              clip: { x: 0, y: 0, width: w, height: h, scale: 1 / dpr },
            }) as { data: string };
            blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot.data } });
          } finally {
            // Always restore the automation indicator, even if screenshot capture failed
            await broadcastToWebTabs({ type: 'SHOW_AFTER_TOOL_USE' }).catch(() => {});
          }
        } catch { /* vision is best-effort; text state above is still returned */ }
      }

      return blocks;
    }

    case 'click_element': {
      await activateTab(tabId); // Issue 6
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
          const x = Math.round(rect.left + rect.width / 2);
          const y = Math.round(rect.top + rect.height / 2);
          // T020: detect whether something else is actually on top at this point
          // (cookie banners, modals) before we blindly synthesize a click there.
          const topEl = document.elementFromPoint(x, y);
          const obscured = !!topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el);
          if (obscured && topEl) {
            const desc = topEl.tagName.toLowerCase() +
              (topEl.id ? `#${topEl.id}` : '') +
              (topEl.textContent ? ` "${topEl.textContent.trim().slice(0, 40)}"` : '');
            return { x, y, obscured: true, obscuredBy: desc };
          }
          return { x, y, obscured: false };
        },
        args: [refId],
      });
      const res = results[0]?.result as { x?: number; y?: number; error?: string; obscured?: boolean; obscuredBy?: string } | null;
      if (res?.error) return [{ type: 'text', text: `Error: ${res.error}` }];
      if (res?.obscured) {
        return [{ type: 'text', text: `Error: element ${refId} is obscured by ${res.obscuredBy}. Try dismissing the overlay first, then retry click_element.` }];
      }
      const { x = 0, y = 0 } = res ?? {};
      await broadcastToWebTabs({ type: 'UPDATE_PHANTOM_CURSOR', x, y });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved',    x, y, button: 'none', modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'left', clickCount: 1, modifiers: 0 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers: 0 });
      // Issue 12 / T013: DOM-mutation settlement instead of a fixed sleep
      await waitForSettlement(tabId);
      return [{ type: 'text', text: `Clicked element ${refId} at (${x},${y})` }];
    }

    case 'wait': {
      await new Promise(r => setTimeout(r, (action.duration ?? 1) * 1000));
      return [{ type: 'text', text: `Waited ${action.duration ?? 1}s` }];
    }

    case 'execute_js': {
      // T017: arbitrary script execution — isolated (non-MAIN) world, so agent-generated
      // script can't reach into page globals. Caller (store.ts) always requires approval
      // for this action regardless of the user's general approval setting (T022).
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (src: string) => {
            // eslint-disable-next-line no-new-func
            const fn = new Function(src);
            return fn();
          },
          args: [action.script ?? ''],
        });
        const value = results[0]?.result;
        return [{ type: 'text', text: `Result: ${JSON.stringify(value) ?? 'undefined'}` }];
      } catch (e) {
        return [{ type: 'text', text: `Error: ${(e as Error).message}` }];
      }
    }

    case 'manage_tabs': {
      // T018 + T026: single-task tab tracking, now tab-group-aware (US2). A group is
      // only created once a task opens its *second* tab (FR-006: "more than one tab") —
      // a single-tab task stays ungrouped.
      const op = action.op ?? 'group_status';

      if (op === 'open') {
        const raw = action.url ?? '';
        const url = raw ? (raw.startsWith('http') ? raw : `https://${raw}`) : undefined;
        const newTab = await chrome.tabs.create({ url, active: false });
        if (!newTab.id) return [{ type: 'text', text: JSON.stringify({ success: false, error: 'Failed to create tab' }) }];

        const wasFirstTab = currentTaskOpenedTabs.size === 1; // the one already there before this add
        const priorFirstTabId = wasFirstTab ? [...currentTaskOpenedTabs][0] : undefined;
        currentTaskOpenedTabs.add(newTab.id);

        let groupId: number | undefined;
        if (currentTaskId && currentTaskOpenedTabs.size > 1) {
          groupId = await createOrJoinGroup(currentTaskId, currentTaskName, newTab.id);
          // First time crossing the 1→2 threshold: the earlier tab also needs to join.
          if (priorFirstTabId !== undefined) {
            try { await chrome.tabs.group({ groupId, tabIds: [priorFirstTabId] }); } catch { /* tab may be gone */ }
          }
        }
        return [{ type: 'text', text: JSON.stringify({ success: true, tabId: newTab.id, groupId }) }];
      }

      if (op === 'switch') {
        if (action.tab_id === undefined) return [{ type: 'text', text: JSON.stringify({ success: false, error: 'tab_id required for switch' }) }];
        await chrome.tabs.update(action.tab_id, { active: true });
        return [{ type: 'text', text: JSON.stringify({ success: true, tabId: action.tab_id }) }];
      }

      if (op === 'close') {
        if (action.tab_id === undefined) return [{ type: 'text', text: JSON.stringify({ success: false, error: 'tab_id required for close' }) }];
        if (!currentTaskOpenedTabs.has(action.tab_id)) {
          return [{ type: 'text', text: JSON.stringify({ success: false, error: 'Refusing to close a tab this task did not open' }) }];
        }
        await chrome.tabs.remove(action.tab_id);
        currentTaskOpenedTabs.delete(action.tab_id);
        return [{ type: 'text', text: JSON.stringify({ success: true, tabId: action.tab_id }) }];
      }

      // group_status
      return [{ type: 'text', text: JSON.stringify({
        success: true,
        memberTabIds: [...currentTaskOpenedTabs],
        groupId: currentTaskId ? getGroupId(currentTaskId) : undefined,
      }) }];
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
    handleComputerUse(msg.action as ComputerAction, msg.windowId as number | undefined)
      .then(result => sendResponse({ result }))
      .catch(e => sendResponse({ error: (e as Error).message }));
    return true;
  }

  if (msg.type === 'START_RECORDING') {
    (async () => {
      recordingSteps = [];
      recordingActive = true;
      const windowId = msg.windowId as number | undefined;
      const query = windowId ? { active: true, windowId } : { active: true, lastFocusedWindow: true };
      const tabs = await chrome.tabs.query(query);
      const tab = tabs.find(t => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
      if (tab?.id) {
        recordingTabId = tab.id;
        if (tab.url) recordingSteps.push({ action: 'navigate', url: tab.url });
        chrome.tabs.sendMessage(tab.id, { type: 'ENABLE_RECORDING' }).catch(() => {});
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'STOP_RECORDING') {
    recordingActive = false;
    if (recordingTabId !== null) {
      chrome.tabs.sendMessage(recordingTabId, { type: 'DISABLE_RECORDING' }).catch(() => {});
      recordingTabId = null;
    }
    const steps = [...recordingSteps];
    recordingSteps = [];
    sendResponse({ steps });
    return true;
  }

  if (msg.type === 'RECORD_STEP') {
    if (recordingActive) recordingSteps.push(msg.step as RecordedStep);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'AGENT_STARTED') {
    currentTaskOpenedTabs = new Set(); // T018: fresh per-task tab tracking for manage_tabs
    currentTaskId = (msg.taskId as string | undefined) ?? null;
    currentTaskName = (msg.taskName as string | undefined) ?? 'Task';
    broadcastToWebTabs({ type: 'SHOW_AGENT_INDICATORS' });
    if (currentTaskId) {
      const taskId = currentTaskId;
      (async () => {
        await writeJournal(newJournal(taskId));
        await ensureOffscreenDocument();
      })().catch(() => {});
    }
    return false;
  }

  if (msg.type === 'AGENT_STOPPED') {
    // T027: group turns green (done/awaiting-approval) rather than closing —
    // TAB_GROUP_TERMINATE (explicit user action) is what actually closes tabs.
    if (currentTaskId) setGroupState(currentTaskId, 'done').catch(() => {});
    broadcastToWebTabs({ type: 'HIDE_AGENT_INDICATORS' });
    if (currentTaskId) {
      const taskId = currentTaskId;
      (async () => {
        const journal = await readJournal(taskId);
        if (journal) await writeJournal({ ...journal, status: 'completed', pendingAction: null });
        await closeOffscreenDocumentIfIdle();
      })().catch(() => {});
    }
    return false;
  }

  if (msg.type === 'STOP_AGENT') {
    chrome.runtime.sendMessage({ type: 'STOP_GENERATION' }).catch(() => {});
    return false;
  }

  if (msg.type === 'TAB_GROUP_TERMINATE') {
    // T028: close exactly the tabs this task opened, leave everything else untouched.
    (async () => {
      const taskId = (msg.taskId as string | undefined) ?? currentTaskId;
      const tabIds = [...currentTaskOpenedTabs];
      for (const id of tabIds) {
        try { await chrome.tabs.remove(id); } catch { /* already gone */ }
        currentTaskOpenedTabs.delete(id);
      }
      if (taskId) {
        forgetGroup(taskId);
        const journal = await readJournal(taskId);
        if (journal) await writeJournal({ ...journal, status: 'aborted', pendingAction: null });
        await closeOffscreenDocumentIfIdle();
      }
      sendResponse({ ok: true, closedTabIds: tabIds });
    })();
    return true;
  }

  if (msg.type === 'TASK_ROUND_COMPLETE') {
    // T035/T036: journal write-after-every-round. Sent by store.ts's loop (still the
    // loop owner in this pass — see tasks.md T035 note on scope) so background.ts,
    // which does survive independently of the sidepanel, always has the latest state
    // on disk if it gets torn down and restarted mid-task.
    (async () => {
      const snapshot = msg.journal as ExecutionJournal | undefined;
      if (snapshot) await writeJournal(snapshot);
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});
