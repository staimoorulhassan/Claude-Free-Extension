/**
 * Self-contained functions injected into a page via chrome.scripting.executeScript.
 * IMPORTANT: these are serialized and run in the tab — they must NOT reference any
 * outer-scope binding (no imports, no closures over module state). Everything they
 * need must be defined inside the function body.
 */

export interface InjectedPageText {
  title: string;
  url: string;
  text: string;
}

/** Extracts readable page text: strips scripts/styles/media, caps output. */
export const injectedGetPageText = function (): InjectedPageText {
  const maxChars = 50000;
  let text = '';
  try {
    const clone = document.body ? (document.body.cloneNode(true) as HTMLElement) : null;
    if (clone) {
      clone.querySelectorAll('script,style,noscript,svg,canvas,iframe,audio,video,template,[hidden]').forEach((el: Element) => el.remove());
      text = (clone.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
    }
  } catch { /* fall through */ }
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…[truncated]';
  return { title: document.title ?? '', url: window.location.href ?? '', text };
};

/**
 * Natural-language element search over the accessibility tree.
 * Uses __generateAccessibilityTree (MAIN world, injected by accessibility-tree.js)
 * and fuzzy-matches tokens of the query against accessible names.
 */
export const injectedFind = function (query: string): { error?: string; matches: string[] } {
  const win = window as unknown as Record<string, unknown>;
  const fn = win.__generateAccessibilityTree as ((filter: string, depth: number, cap: number, _r?: unknown) => { pageContent?: string } | undefined) | undefined;
  if (typeof fn !== 'function') {
    return { error: 'Accessibility tree not ready.', matches: [] };
  }
  const tree = fn('interactive', 15, 50000, undefined);
  const pageContent = tree?.pageContent ?? '';
  const lines = pageContent.split('\n');

  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2)
    .slice(0, 12);

  const scored: Array<{ line: string; score: number }> = [];
  for (const line of lines) {
    const name = (line.match(/"([^"]*)"/) ?? [])[1] ?? '';
    if (!name) continue;
    const lower = name.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (lower.includes(t)) score += t.length;
    }
    if (score > 0) {
      scored.push({ line: line.slice(0, 400), score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return { matches: scored.slice(0, 20).map(s => s.line) };
};

/**
 * Returns metadata about the current page to help with tab context: title, url,
 * whether the page documents are readable, and whether bot-protection is suspected.
 */
export const injectedTabContext = function (): {
  title: string;
  url: string;
  readyState: string;
  suspectedBotWall: boolean;
} {
  const bodyText = (document.body?.innerText ?? '');
  const suspectedBotWall =
    /just a moment|verify you are human|attention required|cf-browser-verification/i.test(bodyText.slice(0, 4000)) ||
    document.title.toLowerCase().includes('just a moment');
  return {
    title: document.title ?? '',
    url: window.location.href ?? '',
    readyState: document.readyState,
    suspectedBotWall,
  };
};
