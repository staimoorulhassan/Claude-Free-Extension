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
}

export interface ComputerToolResult {
  type: 'text' | 'image';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

export async function executeComputerAction(action: ComputerAction): Promise<ComputerToolResult[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'computer_use', action }, response => {
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
    'Control the active browser tab using real input events.',
    'IMPORTANT:',
    '- To open a URL: use action="navigate" with the url field. NEVER try to click the address bar.',
    '- To understand the page: use action="read_page" to get a labelled accessibility tree.',
    '- To click a specific element: use action="click_element" with a ref_id from read_page.',
    '- To click by position: take a screenshot first to see the layout, then click coordinates.',
    '- A glowing border and cursor appear on the page while you are in control.',
    'Preferred flow: navigate → screenshot → read_page → click_element/type → screenshot to verify.',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'screenshot', 'navigate', 'read_page',
          'left_click', 'right_click', 'double_click', 'middle_click',
          'click_element', 'type', 'key', 'scroll', 'left_click_drag', 'wait',
        ],
        description: 'Action to perform.',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (action="navigate"). Example: "https://google.com"',
      },
      ref_id: {
        type: 'string',
        description: 'Element identifier from read_page output (action="click_element"). Example: "ref_5"',
      },
      filter: {
        type: 'string',
        enum: ['interactive', 'all'],
        description: 'read_page filter: "interactive" (default) = buttons/inputs/links only; "all" = entire visible DOM',
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
        description: 'Text to type (action="type") or key name (action="key"). Key examples: "Return", "Escape", "Tab", "ctrl+a", "ctrl+c", "shift+Tab"',
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
    },
    required: ['action'],
  },
};
