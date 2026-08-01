/**
 * Computer use tool — delegates all actions to the background service worker
 * which uses CDP (chrome.debugger) for trusted input events.
 */

export interface ComputerAction {
  action: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  url?: string;
  ref_id?: string;
  filter?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  num_clicks?: number;
  duration?: number;
  // ── spec 001-claude-free-extension additions (contracts/tools.md) ──────────
  selector?: string;          // type_text: ref_id-style selector for the target element
  submit?: boolean;           // type_text: press Enter after typing
  include_vision?: boolean;   // read_page_state: also return a base64 screenshot
  script?: string;            // execute_js: JS source to run in an isolated world
  op?: 'open' | 'switch' | 'close' | 'group_status'; // manage_tabs
  tab_id?: number;            // manage_tabs
  prompt?: string;            // ask_user
  requires_manual_action?: boolean; // ask_user
  // ── Agent intelligence additions ───────────────────────────────────────────
  query?: string;             // web_search: search query; find: natural-language element query
  domain?: string;            // discover_site: site to analyze without navigating
  max_chars?: number;         // web_fetch / get_page_text: output cap
}

export interface ComputerToolResult {
  type: 'text' | 'image';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

export async function executeComputerAction(action: ComputerAction): Promise<ComputerToolResult[]> {
  // Include the windowId so the background targets the active tab in THIS window, not any window
  const windowId: number | undefined = await chrome.windows.getCurrent().then(w => w.id).catch(() => undefined);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'computer_use', action, windowId }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'Extension messaging error'));
        return;
      }
      if (response?.error) { reject(new Error(response.error)); return; }
      resolve(response?.result ?? [{ type: 'text', text: 'No result' }]);
    });
  });
}

export const COMPUTER_TOOL = {
  name: 'computer',
  description: [
    'Control the active browser tab using real input events, and research the web without opening a tab.',
    'IMPORTANT:',
    '- RESEARCH FIRST, NAVIGATE SECOND. Never guess a deep URL like "site.com/pricing" — guessed URLs 404 or trip bot walls.',
    '  Use action="web_search" to find the exact page, action="discover_site" to learn a site\'s real structure (sitemap + nav + robots.txt),',
    '  and action="web_fetch" to READ a page without opening a tab (cheapest, no bot wall). Only navigate a tab when you must interact with the page.',
    '- To open a URL: use action="navigate" with the url field. NEVER try to click the address bar.',
    '- To understand the page: use action="read_page_state" to get a labelled accessibility tree plus any console/network errors (read_page still works but has no error capture).',
    '- To click a specific element: use action="click_element" with a ref_id from read_page_state.',
    '- To type into a specific field: use action="type_text" with a ref_id-style selector; use action="type" only when something is already focused.',
    '- To click by position: take a screenshot first to see the layout, then click coordinates.',
    '- To run custom JavaScript for data extraction: use action="execute_js" (always requires user approval).',
    '- To open/switch/close tabs as part of a task: use action="manage_tabs".',
    '- To read a page as plain text (cheaper than the accessibility tree): use action="get_page_text".',
    '- To locate an element by description instead of reading the whole page: use action="find" with a query.',
    '- To see all open tabs: use action="tabs_context".',
    '- To pause for a CAPTCHA, 2FA, or an irreversible action: use action="ask_user".',
    '- If you hit a CAPTCHA, 403 or "Just a moment" page: STOP navigating. Use web_search/web_fetch instead, or ask_user. Never try to bypass a bot check.',
    '- A glowing border and cursor appear on the page while you are in control.',
    'Preferred flow: web_search/discover_site → web_fetch (read) → navigate only if interaction is needed → read_page_state → click_element/type_text → read_page_state to verify.',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'web_search', 'web_fetch', 'discover_site', 'sitemap_urls',
          'screenshot', 'navigate', 'read_page', 'read_page_state',
          'get_page_text', 'find', 'tabs_context',
          'left_click', 'right_click', 'double_click', 'middle_click',
          'click_element', 'type', 'type_text', 'key', 'scroll', 'left_click_drag', 'wait',
          'execute_js', 'manage_tabs', 'ask_user',
        ],
        description: 'Action to perform.',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (action="navigate"), to read without opening a tab (action="web_fetch"), or to open a new tab to (action="manage_tabs", op="open"). Example: "https://google.com"',
      },
      query: {
        type: 'string',
        description: 'Search query (action="web_search") or natural-language element description (action="find"). Example: "agentrouter pricing page"',
      },
      domain: {
        type: 'string',
        description: 'Site to analyze without navigating (action="discover_site"/"sitemap_urls"). Example: "agentrouter.org"',
      },
      max_chars: {
        type: 'integer',
        description: 'Output cap in characters (action="web_fetch"/"get_page_text"). Default 20000.',
      },
      ref_id: {
        type: 'string',
        description: 'Element identifier from read_page_state output (action="click_element"). Example: "ref_5"',
      },
      selector: {
        type: 'string',
        description: 'Element identifier from read_page_state output, same format as ref_id (action="type_text")',
      },
      submit: {
        type: 'boolean',
        description: 'Press Enter after typing (action="type_text")',
      },
      filter: {
        type: 'string',
        enum: ['interactive', 'all'],
        description: 'read_page/read_page_state filter: "interactive" (default) = buttons/inputs/links only; "all" = entire visible DOM',
      },
      include_vision: {
        type: 'boolean',
        description: 'Also return a base64 screenshot (action="read_page_state"). Only set this if the model supports vision.',
      },
      coordinate: {
        type: 'array',
        items: { type: 'number' },
        description: '[x, y] CSS-pixel coordinate for click or scroll actions',
      },
      start_coordinate: {
        type: 'array',
        items: { type: 'number' },
        description: 'Start [x, y] for left_click_drag',
      },
      text: {
        type: 'string',
        description: 'Text to type (action="type"/"type_text") or key name (action="key"). Key examples: "Return", "Escape", "Tab", "ctrl+a", "ctrl+c", "shift+Tab"',
      },
      direction: {
        type: 'string',
        enum: ['up', 'down', 'left', 'right'],
        description: 'Scroll direction',
      },
      num_clicks: {
        type: 'integer',
        description: 'Scroll steps (default 3)',
      },
      duration: {
        type: 'number',
        description: 'Seconds to wait (action="wait")',
      },
      script: {
        type: 'string',
        description: 'JavaScript source to execute in an isolated world against the active tab (action="execute_js"). Return a JSON-serializable value. Always requires user approval.',
      },
      op: {
        type: 'string',
        enum: ['open', 'switch', 'close', 'group_status'],
        description: 'Tab operation (action="manage_tabs")',
      },
      tab_id: {
        type: 'integer',
        description: 'Target tab id (action="manage_tabs", op="switch"|"close")',
      },
      prompt: {
        type: 'string',
        description: 'Question or instruction to show the user (action="ask_user")',
      },
      requires_manual_action: {
        type: 'boolean',
        description: 'True if the user must physically do something (CAPTCHA, 2FA, confirm a payment) vs. just answer a question (action="ask_user")',
      },
    },
    required: ['action'],
  },
};
