/**
 * Content script — injected into all pages.
 * Bridges the side panel to page content, and records user actions when in recording mode.
 */

import type { RecordedStep } from './lib/recordings';

// Notify the extension that the page is ready
chrome.runtime.sendMessage({ type: 'PING' }).catch(() => {});

// ── Recording ─────────────────────────────────────────────────────────────────

let isRecording = false;

function sendStep(step: RecordedStep) {
  chrome.runtime.sendMessage({ type: 'RECORD_STEP', step }).catch(() => {});
}

function onRecordClick(e: MouseEvent) {
  if (!isRecording) return;
  const target = e.target as HTMLElement;

  const elementText = (
    target.getAttribute('aria-label') ||
    target.getAttribute('placeholder') ||
    target.textContent?.trim().slice(0, 80) ||
    target.getAttribute('title') ||
    target.getAttribute('name') ||
    ''
  ).replace(/\s+/g, ' ').trim();

  const elementHref = (target instanceof HTMLAnchorElement ? target.href : undefined) ||
    (target.closest('a') ? (target.closest('a') as HTMLAnchorElement).href : undefined);

  sendStep({
    action: 'click',
    x: Math.round(e.clientX),
    y: Math.round(e.clientY),
    elementTag: target.tagName.toLowerCase(),
    elementText: elementText || undefined,
    elementHref: elementHref || undefined,
  });
}

function onInputBlur(e: FocusEvent) {
  if (!isRecording) return;
  const el = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (!('value' in el) || !el.value) return;
  if (el.type === 'password') return; // never record passwords

  const fieldLabel = (
    el.getAttribute('aria-label') ||
    el.placeholder ||
    el.name ||
    el.id ||
    ''
  ).trim();

  sendStep({
    action: 'type',
    text: el.value,
    inputName: fieldLabel || undefined,
  });
}

function enableRecording() {
  isRecording = true;
  document.addEventListener('click', onRecordClick, { capture: true });
  document.addEventListener('blur', onInputBlur, { capture: true });
}

function disableRecording() {
  isRecording = false;
  document.removeEventListener('click', onRecordClick, { capture: true });
  document.removeEventListener('blur', onInputBlur, { capture: true });
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'ENABLE_RECORDING') {
    enableRecording();
  } else if (message.type === 'DISABLE_RECORDING') {
    disableRecording();
  }
  return false;
});
