/**
 * Web research primitives for the agent:
 *  - searchWeb(): privacy-friendly HTML search (DuckDuckGo HTML endpoint, no JS).
 *  - discoverSite(): reads /sitemap.xml, /robots.txt, and visible nav anchors so the
 *    agent learns the REAL structure of a site before navigating — instead of guessing
 *    deep URLs (`xyz.com/anything`) which is exactly what trips Cloudflare/bot checks.
 *
 * All helpers are pure async functions in the service worker context (no DOM needed),
 * so they can also be unit-tested under Node.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Fetch seam — injected so the research flow is unit-testable without network
 * access; defaults to the service-worker global fetch (same pattern as
 * JournalStorage in journal.ts). */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_RESULTS = 6;
const MAX_SNIPPET = 240;
const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, fetchFn: FetchFn, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchFn(url, { signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

// NOTE: entity patterns are written as &(?:…); alternations (never the literal
// &/</… sequences) so the bundler's HTML-entity processing can't corrupt them.
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#38);/g, '&')
    .replace(/&(?:lt|#60);/g, '<')
    .replace(/&(?:gt|#62);/g, '>')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:#39|#x27|apos);/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeDomain(target: string): string {
  const t = target.trim();
  if (!t) return '';
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    return new URL(withProto).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Text search via DuckDuckGo's HTML endpoint (no key, no JS).
 * Returns up to MAX_RESULTS with stable, non-redirect URLs.
 */
export async function searchWeb(query: string, maxResults = MAX_RESULTS, fetchFn: FetchFn = fetch): Promise<SearchResult[]> {
  const q = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  const resp = await fetchWithTimeout(url, fetchFn, TIMEOUT_MS);
  if (!resp.ok) throw new Error(`Search failed with HTTP ${resp.status}`);

  const html = await resp.text();
  const results: SearchResult[] = [];

  // DuckDuckGo HTML layout: <div class="result"> <h2 class="result__title"><a class="result__a" href="...">Title</a></h2>
  // <a class="result__snippet">Snippet</a>
  const blocks = html.split('<div class="result"');
  for (const block of blocks.slice(1)) {
    const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
    const titleMatch = block.match(/class="result__a"[^>]*>(.*?)<\/a>/s);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>(.*?)<\/a>/s);
    if (!hrefMatch || !titleMatch) continue;

    let urlRaw = decodeEntities(stripTags(hrefMatch[1]));
    // DDG wraps external URLs in an onclick-redirect param.
    const uddg = urlRaw.match(/uddg=([^&]+)/);
    if (uddg) {
      try { urlRaw = decodeURIComponent(uddg[1]); } catch { /* keep raw */ }
    }

    const title = decodeEntities(stripTags(titleMatch[1])).slice(0, 160);
    if (!title) continue;

    const resultsSnippet = snippetMatch
      ? decodeEntities(stripTags(snippetMatch[1])).slice(0, MAX_SNIPPET)
      : '';

    // De-duplicate by normalized URL.
    if (results.some(r => r.url === urlRaw)) continue;
    results.push({ title, url: urlRaw, snippet: resultsSnippet });
    if (results.length >= maxResults) break;
  }
  if (results.length === 0) throw new Error('No search results returned.');
  return results;
}

/**
 * Fetches a domain's /sitemap.xml, extracting the canonical URL list.
 * Returns [] when no sitemap exists (non-fatal).
 */
export async function fetchSitemapUrls(domain: string, timeoutMs = 5000, fetchFn: FetchFn = fetch): Promise<string[]> {
  const host = normalizeDomain(domain);
  if (!host) return [];
  try {
    const resp = await fetchWithTimeout(`https://${host}/sitemap.xml`, fetchFn, timeoutMs);
    if (!resp.ok) return [];
    const text = await resp.text();
    // Parse <loc>…</loc> entries (handles sitemap-index files which simply nest
    // another level of <loc> URLs pointing to sub-sitemaps).
    const matches = text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi);
    const urls: string[] = [];
    for (const m of matches) {
      const u = m[1].trim();
      if (/^https?:\/\//i.test(u)) urls.push(u);
      if (urls.length >= 500) break;
    }
    return urls;
  } catch {
    return [];
  }
}

export interface DiscoveredSite {
  domain: string;
  homepage: string;
  sitemapUrls: string[];
  robotsDisallowed: string[];
  navLinks: string[];
}

/**
 * One-shot site discovery: homepage + sitemap + robots.txt + top-level nav links.
 * The agent calls this BEFORE navigating so it never guesses deep paths.
 */
export async function discoverSite(domain: string, fetchFn: FetchFn = fetch): Promise<DiscoveredSite> {
  const host = normalizeDomain(domain);
  if (!host) throw new Error(`Invalid site: "${domain}"`);
  const homepage = `https://${host}/`;
  const out: DiscoveredSite = {
    domain: host,
    homepage,
    sitemapUrls: [],
    robotsDisallowed: [],
    navLinks: [],
  };

  const [sitemapUrls, robotsText] = await Promise.all([
    fetchSitemapUrls(host, 5000, fetchFn),
    fetchWithTimeout(`https://${host}/robots.txt`, fetchFn, 4000)
      .then(r => (r.ok ? r.text() : ''))
      .catch(() => ''),
  ]);
  out.sitemapUrls = sitemapUrls;

  // Parse robots.txt Disallow lines (path only).
  for (const line of robotsText.split('\n')) {
    const m = line.match(/^\s*disallow\s*:\s*(\S+)/i);
    if (m) out.robotsDisallowed.push(m[1].toLowerCase());
  }

  // Fetch homepage and harvest top-level <nav> and header anchors — capped,
  // so the returned payload stays small even on huge pages.
  try {
    const homeResp = await fetchWithTimeout(homepage, fetchFn, 6000);
    if (homeResp.ok) {
      const html = await homeResp.text();
      const anchors = new Set<string>();
      const navTags = html.match(/<(?:nav|header)[^>]*>[\s\S]*?<\/(?:nav|header)>/gi) ?? [];
      // Prefer nav/header slices; fall back to the whole body if none found.
      const regions = navTags.length > 0 ? navTags : [html];
      for (const region of regions) {
        for (const a of region.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
          let href = a[1];
          // Keep same-origin, non-empty paths; skip anchors/hash-links and media.
          if (!/^(https?:\/\/|#|mailto:|tel:|javascript:)/i.test(href) && href.trim() !== '' && href !== '/') {
            try {
              href = new URL(href, homepage).href;
            } catch { continue; }
            if (normalizeDomain(href) !== host) continue;
            anchors.add(href);
          }
          if (anchors.size >= 30) break;
        }
        if (anchors.size >= 30) break;
      }
      // Keep the most "top-level" looking links (fewest path segments) first.
      out.navLinks = [...anchors]
        .sort((a, b) => a.split('/').length - b.split('/').length)
        .slice(0, 20);
    }
  } catch { /* homepage fetch is best-effort */ }

  return out;
}

/** Formats discovered site structure into a compact, model-friendly text block. */
export function formatDiscoveredSite(site: DiscoveredSite): string {
  const lines: string[] = [
    `Site structure for ${site.domain}:`,
    `Homepage: ${site.homepage}`,
  ];
  if (site.navLinks.length) {
    lines.push(`Top-level links: ${site.navLinks.join(' | ')}`);
  }
  if (site.robotsDisallowed.length) {
    lines.push(`Robots-disallowed paths (avoid these): ${site.robotsDisallowed.join(' | ')}`);
  }
  if (site.sitemapUrls.length) {
    const shown = site.sitemapUrls.slice(0, 25);
    lines.push(`Sitemap (${site.sitemapUrls.length} pages, showing ${shown.length}):`);
    lines.push(shown.join('\n'));
    if (site.sitemapUrls.length > shown.length) {
      lines.push(`… and ${site.sitemapUrls.length - shown.length} more (use sitemap_urls to fetch individual pages).`);
    }
  } else {
    lines.push('No sitemap.xml found — read the homepage and click through links to explore.');
  }
  return lines.join('\n');
}

/** Compact single-line summary for the tool result header. */
export function summarizeDiscoveredSite(site: DiscoveredSite): string {
  return `${site.domain}: ${site.sitemapUrls.length} sitemap pages, ${site.navLinks.length} nav links, ${site.robotsDisallowed.length} disallowed paths`;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
}

/**
 * Worker-safe page fetch + HTML→text conversion (no DOM available in the
 * service worker). Used by the `web_fetch` action so the agent can read a
 * page without navigating a tab to it (privacy + no bot-wall triggered).
 * Tags are stripped with regexes; script/style contents are removed first.
 */
export async function fetchPageAsText(targetUrl: string, maxChars = 40000, timeoutMs = 10000, fetchFn: FetchFn = fetch): Promise<FetchedPage> {
  const raw = targetUrl.trim();
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const resp = await fetchWithTimeout(url, fetchFn, timeoutMs);
  if (!resp.ok) throw new Error(`web_fetch failed with HTTP ${resp.status}`);
  const html = await resp.text();

  let title = '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = stripTags(titleMatch[1]).slice(0, 200);

  // Remove script/style/noscript/svg blocks first, then strip remaining tags.
  let text = html
    .replace(/<(script|style|noscript|svg|canvas|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|#38);/g, '&')
    .replace(/&(?:lt|#60);/g, '<')
    .replace(/&(?:gt|#62);/g, '>')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:#39|#x27|apos);/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&(?:nbsp);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…[truncated]';

  return {
    url,
    finalUrl: resp.url || url,
    title,
    text,
  };
}
