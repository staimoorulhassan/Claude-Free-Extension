import { describe, it, expect, vi } from 'vitest';
import type { FetchFn } from './webResearch';
import {
  searchWeb,
  fetchSitemapUrls,
  discoverSite,
  fetchPageAsText,
} from './webResearch';

// ── Fake fetch (the module's FetchFn seam, see webResearch.ts) ──────────────
// The module always calls fetch with a string URL plus a RequestInit carrying
// an AbortSignal (fetchWithTimeout). The fake dispatches to a per-URL handler
// and rejects with an AbortError when the signal fires, so the timeout path is
// exercised for real without any network.

function fakeFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): FetchFn {
  return (url, init) => {
    const signal = init?.signal;
    if (!signal) return handler(url, init);
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      handler(url, init).then(
        (r) => { signal.removeEventListener('abort', onAbort); resolve(r); },
        (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
      );
    });
  };
}

/** Routes by exact URL; any unexpected URL rejects loudly so a wiring bug (e.g.
 * the seam not threading into an internal call) fails the test instead of
 * silently falling through to the real network. */
function routeFake(routes: Record<string, { body: string; status?: number }>): FetchFn {
  return fakeFetch((url) => {
    const hit = routes[url];
    if (!hit) return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    return Promise.resolve(new Response(hit.body, { status: hit.status ?? 200 }));
  });
}

const DDG_HTML = `
<div class="result">
  <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=abc">Example &amp; Co Docs</a></h2>
  <a class="result__snippet">The <b>example</b> documentation.</a>
</div>
<div class="result">
  <h2 class="result__title"><a class="result__a" href="https://example.com/blog">Second result</a></h2>
</div>
<div class="result">
  <h2 class="result__title"><a class="result__a" href="https://example.com/docs">Example &amp; Co Docs</a></h2>
  <a class="result__snippet">Duplicate URL, should be skipped.</a>
</div>
`;

const HOME_HTML = `<html><head><title>Home</title></head>
<body>
<nav>
  <a href="/">Home</a>
  <a href="/pricing">Pricing</a>
  <a href="https://other.com/x">External</a>
  <a href="#section">Hash</a>
  <a href="/deep/deeper/deepest">Deep</a>
  <a href="/about">About</a>
</nav>
</body></html>`;

describe('searchWeb', () => {
  it('parses DDG HTML results, decoding the uddg redirect, entities and snippet', async () => {
    const handler = vi.fn().mockResolvedValue(new Response(DDG_HTML, { status: 200 }));
    const results = await searchWeb('my query', 6, fakeFetch(handler));

    // The module really drives the fetch: encoded query, abort signal, follow redirects.
    expect(handler).toHaveBeenCalledWith(
      'https://html.duckduckgo.com/html/?q=my%20query',
      expect.objectContaining({ signal: expect.any(AbortSignal), redirect: 'follow' }),
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Example & Co Docs',
      url: 'https://example.com/docs', // decoded from the uddg redirect param
      snippet: 'The example documentation.',
    });
    expect(results[1]).toEqual({ title: 'Second result', url: 'https://example.com/blog', snippet: '' });
  });

  it('caps at maxResults', async () => {
    // Dedup itself is pinned by the parse test (3 blocks, 2 results); this one
    // exercises the cap — maxResults=1 breaks before the duplicate block is seen.
    const results = await searchWeb('q', 1, fakeFetch(() => Promise.resolve(new Response(DDG_HTML, { status: 200 }))));
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://example.com/docs');
  });

  it('throws on a non-OK HTTP response', async () => {
    const fetchFn = fakeFetch(() => Promise.resolve(new Response('', { status: 429 })));
    await expect(searchWeb('q', 6, fetchFn)).rejects.toThrow('Search failed with HTTP 429');
  });

  it('throws when no result blocks are found', async () => {
    const fetchFn = fakeFetch(() => Promise.resolve(new Response('<html><body>No results.</body></html>', { status: 200 })));
    await expect(searchWeb('q', 6, fetchFn)).rejects.toThrow('No search results returned.');
  });

  it('propagates a network rejection', async () => {
    const fetchFn = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(searchWeb('q', 6, fetchFn)).rejects.toThrow('Failed to fetch');
  });
});

describe('fetchSitemapUrls', () => {
  it('parses <loc> entries, including nested sitemap-index files, and skips non-http URLs', async () => {
    const body = '<sitemapindex>' +
      '<sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>' +
      '<sitemap><loc>ftp://skip-me.example/x</loc></sitemap>' +
      '<sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>' +
      '</sitemapindex>';
    const fetchFn = routeFake({ 'https://example.com/sitemap.xml': { body } });
    const urls = await fetchSitemapUrls('Example.COM', 5000, fetchFn);
    expect(urls).toEqual(['https://example.com/sitemap-1.xml', 'https://example.com/sitemap-2.xml']);
  });

  it('returns [] on a non-OK response', async () => {
    const fetchFn = routeFake({ 'https://example.com/sitemap.xml': { body: 'not found', status: 404 } });
    expect(await fetchSitemapUrls('example.com', 5000, fetchFn)).toEqual([]);
  });

  it('returns [] when the fetch rejects (network error / timeout)', async () => {
    const fetchFn = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await fetchSitemapUrls('example.com', 5000, fetchFn)).toEqual([]);
  });

  it('returns [] for an invalid domain', async () => {
    expect(await fetchSitemapUrls('', 5000, routeFake({}))).toEqual([]);
    expect(await fetchSitemapUrls('not a url!!', 5000, routeFake({}))).toEqual([]);
  });
});

describe('discoverSite', () => {
  it('harvests sitemap, robots disallows and same-origin top-level nav links', async () => {
    const routes = {
      'https://example.com/sitemap.xml': {
        body: '<urlset><url><loc>https://example.com/</loc></url>' +
          '<url><loc>https://example.com/docs</loc></url></urlset>',
      },
      'https://example.com/robots.txt': {
        body: 'User-agent: *\nDisallow: /Private\nDisallow: /admin\nAllow: /public\n',
      },
      'https://example.com/': { body: HOME_HTML },
    };
    const site = await discoverSite('  Example.COM ', routeFake(routes));

    expect(site.domain).toBe('example.com');
    expect(site.homepage).toBe('https://example.com/');
    expect(site.sitemapUrls).toEqual(['https://example.com/', 'https://example.com/docs']);
    // Disallow lines are captured and lowercased; Allow is ignored.
    expect(site.robotsDisallowed).toEqual(['/private', '/admin']);
    // Same-origin, non-root, non-hash links only, shallowest paths first.
    expect(site.navLinks).toEqual([
      'https://example.com/pricing',
      'https://example.com/about',
      'https://example.com/deep/deeper/deepest',
    ]);
  });

  it('throws on an invalid domain', async () => {
    // NB: '!!!' is actually a valid WHATWG host (! is not a forbidden host code
    // point), so the module treats it as a domain; a space is what breaks URL parsing.
    await expect(discoverSite('not a url!!', routeFake({}))).rejects.toThrow('Invalid site: "not a url!!"');
  });

  it('is best-effort: robots and homepage failures still return the site structure', async () => {
    const routes = { 'https://example.com/sitemap.xml': { body: '<urlset></urlset>' } };
    const site = await discoverSite('example.com', routeFake(routes));
    expect(site.domain).toBe('example.com');
    expect(site.sitemapUrls).toEqual([]);
    expect(site.robotsDisallowed).toEqual([]);
    expect(site.navLinks).toEqual([]);
  });
});

describe('fetchPageAsText', () => {
  const PAGE_HTML = `<html><head><title>  My Page &amp; Title </title></head>
<body>
<script>var x = "<b>not visible</b>";</script>
<style>.x{display:none}</style>
<p>Hello <b>world</b> &amp; friends &nbsp; spaced</p>
</body></html>`;

  it('extracts the title and converts HTML to text (stripping script/style, decoding entities)', async () => {
    const fetchFn = fakeFetch(() => Promise.resolve(new Response(PAGE_HTML, { status: 200 })));
    const page = await fetchPageAsText('https://example.com/page', 40000, 10000, fetchFn);
    expect(page.url).toBe('https://example.com/page');
    expect(page.finalUrl).toBe('https://example.com/page'); // empty resp.url falls back to the input
    // Title is entity-decoded (after tag-stripping) like the text path, so the
    // model never sees literal entities in citations.
    expect(page.title).toBe('My Page & Title');
    expect(page.text).toBe('Hello world & friends spaced');
  });

  it('decodes HTML entities in the extracted title', async () => {
    const html = '<html><head><title>R&amp;D &quot;FAQ&quot;</title></head><body><p>x</p></body></html>';
    const fetchFn = fakeFetch(() => Promise.resolve(new Response(html, { status: 200 })));
    const page = await fetchPageAsText('https://example.com/page', 1000, 10000, fetchFn);
    expect(page.title).toBe('R&D "FAQ"');
  });

  it('truncates long text at maxChars with a marker', async () => {
    const fetchFn = fakeFetch(() => Promise.resolve(new Response(PAGE_HTML, { status: 200 })));
    const page = await fetchPageAsText('https://example.com/page', 20, 10000, fetchFn);
    expect(page.text).toBe('Hello world & friend\n…[truncated]');
  });

  it('throws on a non-OK HTTP response', async () => {
    const fetchFn = fakeFetch(() => Promise.resolve(new Response('missing', { status: 404 })));
    await expect(fetchPageAsText('https://example.com/gone', 1000, 10000, fetchFn)).rejects.toThrow(
      'web_fetch failed with HTTP 404',
    );
  });

  it('aborts and rejects when the fetch exceeds the timeout', async () => {
    // Never-settling handler: only the module's AbortController can end it.
    const fetchFn = fakeFetch(() => new Promise<Response>(() => {}));
    await expect(fetchPageAsText('https://slow.example/page', 1000, 50, fetchFn)).rejects.toThrow(/abort/i);
  });
});
