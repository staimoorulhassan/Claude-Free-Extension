/**
 * Content script — injected into all pages.
 * Provides a communication bridge for the side panel to interact with page content.
 */

// Notify the extension that the page is ready
chrome.runtime.sendMessage({ type: 'PING' }).catch(() => {});

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((_message, _sender, _sendResponse) => {
  // Reserved for future use (e.g. page scraping, DOM queries)
  return false;
});
