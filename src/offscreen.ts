/**
 * Offscreen document keepalive heartbeat (spec 001-claude-free-extension, US3 / FR-011).
 * Created lazily by background.ts when a task starts, closed when no journal is
 * in_progress (research.md §6). Pings every 20s over a long-lived connect port —
 * that port traffic is what resets MV3's service-worker idle timer, not the ping
 * content itself.
 */

const PING_INTERVAL_MS = 20_000;

const port = chrome.runtime.connect({ name: 'offscreen-heartbeat' });

function ping() {
  try {
    port.postMessage({ type: 'OFFSCREEN_PING', timestamp: Date.now() });
  } catch {
    // Port may have disconnected if the service worker was torn down between
    // ticks — the next chrome.offscreen.createDocument() call (background.ts)
    // will spin up a fresh document with a fresh port.
  }
}

ping();
setInterval(ping, PING_INTERVAL_MS);
