import { ipcMain } from 'electron';
import * as dns from 'dns';
import * as contentQueries from '../db/queries/content.js';
import { cachedFetch, rewriteProxyHtml } from './shared.js';

export function parseLinkPreview(html: string, url: string): { title: string; description: string; image: string; site: string; favicon: string; domain: string } {
  const meta = (prop: string): string => {
    for (const attr of ['property', 'name']) {
      const m = html.match(new RegExp(`<meta\\s+${attr}="${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+content="([^"]*)"`, 'i'))
        ?? html.match(new RegExp(`<meta\\s+content="([^"]*)"\\s+${attr}="${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i'));
      if (m) return m[1];
    }
    return '';
  };
  let title = meta('og:title') || meta('twitter:title');
  if (!title) {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
  }
  const desc = meta('og:description') || meta('twitter:description') || meta('description');
  let image = meta('og:image') || meta('twitter:image');
  if (image && !image.startsWith('http')) {
    const u = new URL(url);
    if (image.startsWith('//')) image = u.protocol + image;
    else if (image.startsWith('/')) image = u.origin + image;
    else image = url.replace(/\/[^/]*$/, '/') + image;
  }
  const site = meta('og:site_name');
  const u = new URL(url);
  const domain = u.hostname.replace(/^www\./, '');
  const favicon = u.origin + '/favicon.ico';
  return { title: title.slice(0, 200), description: desc.slice(0, 300), image, site: site || domain, favicon, domain };
}

export function extractLinks(html: string, baseUrl: string): Array<{ text: string; url: string }> {
  const linkRegex = /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  const links: Array<{ text: string; url: string }> = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    if (!text || !href) continue;
    try {
      href = new URL(href, baseUrl).href;
    } catch { continue; }
    if (!href.startsWith('http')) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ text, url: href });
  }
  return links;
}

export function registerBrowseIPC(): void {
  // ── Semantic Scholar API ──
  ipcMain.handle('db:author-details', async (_event, authorId: string) => {
    if (!authorId) return { error: 'authorId required' };
    try {
      const s2Url = `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}?fields=name,affiliations,homepage,hIndex,citationCount,paperCount,url`;
      const [authorResp, papersResp] = await Promise.all([
        fetch(s2Url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) }),
        fetch(`https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}/papers?fields=title,year,citationCount,url,venue&limit=10`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) }),
      ]);
      const authorData = await authorResp.json() as any;
      const papersData = await papersResp.json() as any;
      const papers = (papersData.data ?? []).sort((a: any, b: any) => (b.citationCount ?? 0) - (a.citationCount ?? 0));
      return {
        name: authorData.name ?? '', affiliations: authorData.affiliations ?? [],
        homepage: authorData.homepage, hIndex: authorData.hIndex,
        citationCount: authorData.citationCount, paperCount: authorData.paperCount,
        url: authorData.url, papers: papers.slice(0, 10),
      };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:citation-lookup', async (_event, query: string) => {
    if (!query) return { error: 'query required' };
    try {
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=1&fields=title,authors,year,abstract,citationCount,url,venue,externalIds`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
      const data = await resp.json() as any;
      const papers = data.data ?? [];
      if (!papers.length) return { error: 'not found' };
      const p = papers[0];
      return {
        title: p.title ?? '', authors: (p.authors ?? []).slice(0, 5).map((a: any) => a.name ?? ''),
        year: p.year, abstract: p.abstract?.slice(0, 500) ?? null,
        citationCount: p.citationCount, venue: p.venue, url: p.url,
        arxivId: p.externalIds?.ArXiv ?? null,
      };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:paper-references', async (_event, arxivId: string, refNum?: number) => {
    if (!arxivId) return { error: 'arxivId required' };
    try {
      let references = contentQueries.getCachedReferences(arxivId) as any[] | null;
      if (references === null) {
        const url = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${encodeURIComponent(arxivId)}?fields=references.title,references.authors,references.year,references.abstract,references.citationCount,references.url,references.venue,references.externalIds`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
        const data = await resp.json() as any;
        references = data.references ?? [];
        contentQueries.setCachedReferences(arxivId, references!);
      }
      if (!references || !references.length) return { error: 'no references found' };
      if (refNum != null && refNum >= 1) {
        const ref = references[refNum - 1];
        if (!ref) return { error: `reference ${refNum} not found (paper has ${references.length} references)` };
        return {
          title: ref.title ?? '', authors: (ref.authors ?? []).slice(0, 5).map((a: any) => a.name ?? ''),
          year: ref.year, abstract: ref.abstract?.slice(0, 500) ?? null,
          citationCount: ref.citationCount, venue: ref.venue, url: ref.url,
          arxivId: ref.externalIds?.ArXiv ?? null,
        };
      }
      const result = references.filter(Boolean).map((ref: any, i: number) => ({
        num: i + 1, title: ref.title ?? '',
        authors: (ref.authors ?? []).slice(0, 3).map((a: any) => a.name ?? ''),
        year: ref.year, citationCount: ref.citationCount,
      }));
      return { references: result, total: references.length };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:author-lookup', async (_event, query: string) => {
    if (!query) return { error: 'query required' };
    try {
      const { data: cached, needsRefresh } = contentQueries.getCachedAuthor(query) as { data: any; needsRefresh: boolean };
      if (cached && !needsRefresh) return cached;
      try {
        const url = `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(query)}&limit=1&fields=name,affiliations,paperCount,citationCount,hIndex,url`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
        const data = await resp.json() as any;
        const authors = data.data ?? [];
        if (!authors.length) return cached ?? { error: 'not found' };
        const author = authors[0];
        let topPapers: any[] = [];
        if (author.authorId) {
          try {
            const pUrl = `https://api.semanticscholar.org/graph/v1/author/${author.authorId}/papers?fields=title,year,citationCount&limit=3&sort=citationCount:desc`;
            const pResp = await fetch(pUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
            const pData = await pResp.json() as any;
            topPapers = (pData.data ?? []).slice(0, 3).map((p: any) => ({ title: p.title ?? '', year: p.year, citationCount: p.citationCount ?? 0 }));
          } catch {
            if (cached?.topPapers) topPapers = cached.topPapers;
          }
        }
        const result = {
          authorId: author.authorId, name: author.name ?? '',
          affiliations: author.affiliations ?? [], paperCount: author.paperCount,
          citationCount: author.citationCount, hIndex: author.hIndex,
          url: author.url, topPapers,
        };
        contentQueries.setCachedAuthor(query, result);
        return result;
      } catch {
        if (cached) return cached;
        throw new Error('API request failed');
      }
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:citations-batch', async (_event, arxivIds: string[]) => {
    if (!arxivIds?.length) return { error: 'ids required' };
    try {
      const paperIds = arxivIds.map(id => `ArXiv:${id}`);
      const resp = await fetch('https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount,externalIds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ ids: paperIds }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await resp.json() as any[];
      const result: Record<string, number> = {};
      for (const item of data) {
        if (item?.externalIds?.ArXiv) {
          result[item.externalIds.ArXiv] = item.citationCount ?? 0;
        }
      }
      return result;
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // Generic Semantic Scholar proxy — allows renderer to fetch any S2 API path
  // without CORS restrictions (fetch runs in main process).
  // Responses are cached in DB for 7 days (serve stale + background refresh).
  ipcMain.handle('db:s2-proxy', async (_event, urlPath: string) => {
    if (!urlPath || typeof urlPath !== 'string') return { error: 'urlPath required' };
    const cached = contentQueries.getCachedS2Response(urlPath);
    if (cached && !cached.isStale) return cached.data;

    const doFetch = async () => {
      try {
        const base = 'https://api.semanticscholar.org/graph/v1';
        const url = urlPath.startsWith('http') ? urlPath : base + urlPath;
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        contentQueries.setCachedS2Response(urlPath, data);
        return data;
      } catch { return null; }
    };

    if (cached && cached.isStale) {
      // Return stale data immediately, refresh in background
      doFetch();
      return cached.data;
    }
    return await doFetch();
  });

  // Papers With Code proxy with DB caching
  ipcMain.handle('db:pwc-proxy', async (_event, url: string) => {
    if (!url || typeof url !== 'string') return { error: 'url required' };
    const cached = contentQueries.getCachedPwcResponse(url);
    if (cached && !cached.isStale) return cached.data;

    const doFetch = async () => {
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        contentQueries.setCachedPwcResponse(url, data);
        return data;
      } catch { return null; }
    };

    if (cached && cached.isStale) {
      doFetch();
      return cached.data;
    }
    return await doFetch();
  });

  // GitHub API proxy with DB caching
  ipcMain.handle('db:github-proxy', async (_event, url: string) => {
    if (!url || typeof url !== 'string') return { error: 'url required' };
    const cached = contentQueries.getCachedGithubResponse(url);
    if (cached && !cached.isStale) return cached.data;

    const doFetch = async () => {
      try {
        const resp = await fetch(url, {
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        contentQueries.setCachedGithubResponse(url, data);
        return data;
      } catch { return null; }
    };

    if (cached && cached.isStale) {
      doFetch();
      return cached.data;
    }
    return await doFetch();
  });

  // S2 cache info — returns cached_at epoch (seconds) or null
  ipcMain.handle('db:s2-cache-age', (_event, urlPath: string) => {
    if (!urlPath) return null;
    return contentQueries.getS2CacheAge(urlPath);
  });

  // S2 cache clear — deletes a single entry so next s2-proxy call hits API
  ipcMain.handle('db:s2-cache-clear', (_event, urlPath: string) => {
    if (!urlPath) return;
    contentQueries.deleteS2CacheEntry(urlPath);
  });

  // ── Browse utilities ──
  ipcMain.handle('db:link-preview', async (_event, url: string) => {
    if (!url) return { error: 'url required' };
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(8_000),
      });
      const html = (await resp.text()).slice(0, 200_000);
      return parseLinkPreview(html, url);
    } catch (e: any) {
      return { title: '', description: '', image: '', site: '', domain: '', error: e.message ?? String(e) };
    }
  });

  ipcMain.handle('db:stock-quote', async (_event, symbol: string) => {
    if (!symbol) return { error: 'symbol required' };
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?range=1d&interval=1d`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5_000) });
      const data = await resp.json() as any;
      const result = data?.chart?.result?.[0] ?? {};
      const m = result.meta ?? {};
      const price = m.regularMarketPrice ?? 0;
      const prev = m.chartPreviousClose ?? 0;
      const change = prev ? Math.round((price - prev) * 100) / 100 : 0;
      const changePct = prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0;
      const name = m.shortName ?? m.longName ?? symbol;
      return { price, change, changePercent: changePct, name };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:extract-links', async (_event, url: string) => {
    if (!url) return { error: 'url required' };
    try {
      const buf = await cachedFetch(url, 30_000);
      const html = buf.toString('utf-8');
      return { links: extractLinks(html, url) };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── arXiv search ──
  ipcMain.handle('db:arxiv-search-xml', async (_event, query: string, start?: number, maxResults?: number) => {
    try {
      const q = encodeURIComponent(query);
      const s = start ?? 0;
      const m = maxResults ?? 100;
      const url = `https://export.arxiv.org/api/query?search_query=all:${q}&start=${s}&max_results=${m}&sortBy=relevance&sortOrder=descending`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30_000) });
      return { xml: await resp.text() };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── File proxies ──
  ipcMain.handle('db:image-proxy', async (_event, url: string) => {
    if (!url) return { error: 'Missing url' };
    try {
      const buf = await cachedFetch(url, 15_000);
      const ext = url.split('.').pop()?.toLowerCase().split('?')[0] ?? '';
      const ctMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' };
      return { _proxy: true, data: buf.toString('base64'), mime: ctMap[ext] ?? 'image/png' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:arxiv-pdf', async (_event, arxivId: string) => {
    if (!arxivId) return { error: 'id required' };
    try {
      const url = `https://arxiv.org/pdf/${encodeURIComponent(arxivId)}.pdf`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30_000) });
      const buf = Buffer.from(await resp.arrayBuffer());
      return { _proxy: true, data: buf.toString('base64'), mime: 'application/pdf' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:pdf-proxy', async (_event, url: string) => {
    if (!url?.startsWith('http')) return { error: 'url required' };
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30_000) });
      const buf = Buffer.from(await resp.arrayBuffer());
      return { _proxy: true, data: buf.toString('base64'), mime: 'application/pdf' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Browse proxy (HTML rewriting) ──
  ipcMain.handle('db:browse-proxy', async (_event, url: string) => {
    if (!url) return { error: 'Missing url parameter' };
    try {
      const buf = await cachedFetch(url, 20_000);
      const htmlStr = buf.toString('utf-8');
      const rewritten = rewriteProxyHtml(htmlStr, url);
      return { _proxy: true, data: Buffer.from(rewritten).toString('base64'), mime: 'text/html' };
    } catch (e: any) {
      return { error: e.message ?? String(e) };
    }
  });

  // ── IP geolocation ──
  const _ipGeoCache = new Map<string, { data: any; ts: number }>();
  const _IP_GEO_TTL = 30 * 60 * 1000; // 30 minutes

  ipcMain.handle('db:ip-geo', async (_event, hostname: string) => {
    if (!hostname) return { error: 'hostname required' };
    // Check cache
    const cached = _ipGeoCache.get(hostname);
    if (cached && (Date.now() - cached.ts) < _IP_GEO_TTL) return cached.data;
    try {
      // Resolve hostname to IP
      const addresses = await dns.promises.resolve4(hostname);
      const ip = addresses[0];
      if (!ip) return { error: 'could not resolve' };
      // Geolocation lookup
      const resp = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,org,as`, {
        signal: AbortSignal.timeout(5_000),
      });
      const geo = await resp.json() as any;
      if (geo.status !== 'success') return { ip, error: 'geo lookup failed' };
      const result = {
        ip,
        city: geo.city || null,
        region: geo.regionName || null,
        country: geo.country || null,
        isp: geo.isp || null,
        org: geo.org || null,
        as: geo.as || null,
      };
      _ipGeoCache.set(hostname, { data: result, ts: Date.now() });
      return result;
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });
}
