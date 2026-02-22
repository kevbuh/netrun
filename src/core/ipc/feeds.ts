import { ipcMain } from 'electron';
import * as feedQueries from '../db/queries/feeds.js';
import { cachedFetch, getActiveProvider } from './shared.js';

export const STALE_THRESHOLD = 600; // 10 minutes in seconds

export function parseRSSItems(xml: string, sourceKey: string): any[] {
  const items: any[] = [];
  // Try RSS <item> blocks first
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const tag = (t: string) => { const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''; };
    const title = tag('title');
    const link = tag('link') || tag('guid');
    if (!title || !link) continue;
    items.push({
      source: sourceKey, title, link,
      authors: tag('dc:creator') || tag('author'),
      categories: '[]', description: tag('description').slice(0, 500),
      display_date: tag('pubDate') || tag('dc:date') || tag('published'),
      pub_date: tag('pubDate') || tag('dc:date') || tag('published'),
      arxiv_id: null, extra: '{}',
    });
  }
  // If no RSS items found, try Atom <entry> blocks
  if (items.length === 0) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1];
      const tag = (t: string) => { const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''; };
      const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
      const title = tag('title');
      const link = linkMatch ? linkMatch[1] : tag('link');
      if (!title || !link) continue;
      items.push({
        source: sourceKey, title, link,
        authors: tag('author') ? tag('name') || tag('author') : '',
        categories: '[]', description: (tag('summary') || tag('content')).slice(0, 500),
        display_date: tag('published') || tag('updated'),
        pub_date: tag('published') || tag('updated'),
        arxiv_id: null, extra: '{}',
      });
    }
  }
  return items;
}

export function mapRowToFrontend(row: any): any {
  const extra = typeof row.extra === 'string' ? (() => { try { return JSON.parse(row.extra); } catch { return {}; } })() : (row.extra ?? {});
  return {
    ...row,
    pubDate: row.pub_date,
    date: row.display_date,
    arxivId: row.arxiv_id,
    categories: typeof row.categories === 'string' ? (() => { try { return JSON.parse(row.categories); } catch { return []; } })() : (row.categories ?? []),
    ...extra,
  };
}

export function registerFeedsIPC(): void {
  ipcMain.handle('db:feed-arxiv', async () => {
    try {
      const buf = await cachedFetch('https://rss.arxiv.org/rss/cs');
      return { _proxy: true, data: buf.toString('base64'), mime: 'application/xml' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:feed-hn', async () => {
    try {
      const resp = await fetch('https://hacker-news.firebaseio.com/v0/beststories.json', {
        headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000),
      });
      const ids = ((await resp.json()) as number[]).slice(0, 30);
      const items = await Promise.all(ids.map(async (id) => {
        try {
          const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000),
          });
          return await r.json();
        } catch { return null; }
      }));
      return items.filter((it: any) => it && it.type === 'story');
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:feed-polymarket', async () => {
    try {
      const buf = await cachedFetch('https://polymarket.com/breaking', 15_000);
      const html = buf.toString('utf-8');
      const marker = '__NEXT_DATA__" type="application/json" crossorigin="anonymous">';
      const idx = html.indexOf(marker);
      if (idx === -1) return { error: 'Could not find data' };
      const start = idx + marker.length;
      const end = html.indexOf('</script>', start);
      const nextData = JSON.parse(html.slice(start, end));
      const queries = nextData.props.pageProps.dehydratedState.queries;
      let markets: any[] = [];
      for (const q of queries) {
        if ((q.queryKey ?? []).includes('biggest-movers')) {
          markets = q.state.data?.markets ?? [];
          break;
        }
      }
      return markets.map((m: any) => {
        const prices = m.outcomePrices ?? ['0', '0'];
        const yesPct = Math.round(parseFloat(prices[0]) * 100);
        const changePct = Math.round((m.oneDayPriceChange ?? 0) * 100);
        const volume = m.events?.[0] ? Math.round(m.events[0].volume ?? 0) : 0;
        return {
          question: m.question ?? '', slug: m.slug ?? '',
          url: m.events?.[0] ? `https://polymarket.com/event/${m.events[0].slug}` : `https://polymarket.com/event/${m.slug ?? ''}`,
          image: m.image ?? '', yesPct, changePct, volume,
        };
      });
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:rss-proxy', async (_event, feedUrl: string) => {
    if (!feedUrl) return { error: 'url required' };
    try {
      const buf = await cachedFetch(feedUrl);
      return { _proxy: true, data: buf.toString('base64'), mime: 'application/xml' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:feed-items-custom', async (_event, feeds: Array<{ name?: string; url: string }>) => {
    if (!feeds?.length) return [];
    const results: any[] = [];
    for (const f of feeds) {
      const name = f.name ?? f.url;
      const sourceKey = `custom:${name}`;
      const existing = feedQueries.getFeedItems([sourceKey], 100);
      if (existing.length > 0) {
        results.push(...existing);
        continue;
      }
      try {
        const buf = await cachedFetch(f.url, 15_000);
        const xml = buf.toString('utf-8');
        const items: any[] = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
        let match;
        while ((match = itemRegex.exec(xml)) !== null) {
          const block = match[1];
          const tag = (t: string) => { const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''; };
          const title = tag('title');
          const link = tag('link');
          if (!title || !link) continue;
          items.push({
            source: sourceKey, title, link,
            authors: tag('dc:creator') || tag('author'),
            categories: '[]', description: tag('description').slice(0, 500),
            display_date: tag('pubDate') || tag('dc:date'),
            pub_date: tag('pubDate') || tag('dc:date'),
            arxiv_id: null, extra: '{}',
          });
        }
        if (items.length) {
          feedQueries.upsertFeedItems(items);
          results.push(...items.map(it => ({ ...it, categories: [], date: it.display_date, pubDate: it.pub_date })));
        }
      } catch { /* skip failed feeds */ }
    }
    return results;
  });

  // ── Catalog feed handler (on-demand fetch) ──

  async function fetchRSSItems(key: string, url: string): Promise<any[]> {
    const buf = await cachedFetch(url, 15_000);
    return parseRSSItems(buf.toString('utf-8'), key);
  }

  async function fetchArxivItems(): Promise<any[]> {
    const buf = await cachedFetch('https://rss.arxiv.org/rss/cs', 15_000);
    const items = parseRSSItems(buf.toString('utf-8'), 'arxiv');
    for (const item of items) {
      // Extract arXiv ID from link
      const idMatch = item.link.match(/(\d{4}\.\d{4,5})/);
      if (idMatch) item.arxiv_id = idMatch[1];
      // Clean "arXiv:XXXX.XXXXX" prefix from description
      item.description = (item.description || '').replace(/^arXiv:\d{4}\.\d{4,5}\s*/i, '');
    }
    return items;
  }

  async function fetchHNItems(): Promise<any[]> {
    const resp = await fetch('https://hacker-news.firebaseio.com/v0/beststories.json', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000),
    });
    const ids = ((await resp.json()) as number[]).slice(0, 30);
    const stories = await Promise.all(ids.map(async (id) => {
      try {
        const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000),
        });
        return await r.json();
      } catch { return null; }
    }));
    const now = Date.now() / 1000;
    return stories.filter((s: any) => s && s.type === 'story').map((s: any) => ({
      source: 'hn', title: s.title ?? '', link: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
      authors: s.by ?? '', categories: '[]', description: '',
      display_date: s.time ? new Date(s.time * 1000).toISOString() : '',
      pub_date: s.time ? new Date(s.time * 1000).toISOString() : '',
      arxiv_id: null, fetched_at: now,
      extra: JSON.stringify({ hnId: s.id, hnScore: s.score ?? 0, hnComments: s.descendants ?? 0 }),
    }));
  }

  async function fetchPolymarketItems(): Promise<any[]> {
    const buf = await cachedFetch('https://polymarket.com/breaking', 15_000);
    const html = buf.toString('utf-8');
    const marker = '__NEXT_DATA__" type="application/json" crossorigin="anonymous">';
    const idx = html.indexOf(marker);
    if (idx === -1) return [];
    const start = idx + marker.length;
    const end = html.indexOf('</script>', start);
    const nextData = JSON.parse(html.slice(start, end));
    const queries = nextData.props.pageProps.dehydratedState.queries;
    let markets: any[] = [];
    for (const q of queries) {
      if ((q.queryKey ?? []).includes('biggest-movers')) {
        markets = q.state.data?.markets ?? [];
        break;
      }
    }
    const now = Date.now() / 1000;
    return markets.map((m: any) => {
      const prices = m.outcomePrices ?? ['0', '0'];
      const yesPct = Math.round(parseFloat(prices[0]) * 100);
      const changePct = Math.round((m.oneDayPriceChange ?? 0) * 100);
      const volume = m.events?.[0] ? Math.round(m.events[0].volume ?? 0) : 0;
      const url = m.events?.[0] ? `https://polymarket.com/event/${m.events[0].slug}` : `https://polymarket.com/event/${m.slug ?? ''}`;
      return {
        source: 'polymarket', title: m.question ?? '', link: url,
        authors: '', categories: '[]', description: '',
        display_date: new Date().toISOString(), pub_date: new Date().toISOString(),
        arxiv_id: null, fetched_at: now,
        extra: JSON.stringify({ polyYesPct: yesPct, polyChangePct: changePct, polyVolume: volume, polyImage: m.image ?? '', polySlug: m.slug ?? '' }),
      };
    });
  }

  async function fetchCatalogSource(entry: { key: string; url?: string | null; special?: string | null }): Promise<any[]> {
    if (entry.special === 'arxiv') return fetchArxivItems();
    if (entry.special === 'hn') return fetchHNItems();
    if (entry.special === 'polymarket') return fetchPolymarketItems();
    if (entry.url) return fetchRSSItems(entry.key, entry.url);
    return [];
  }

  ipcMain.handle('db:feed-items-catalog', async (_event, entries: Array<{ key: string; url?: string | null; special?: string | null }>, limit: number = 500) => {
    if (!entries?.length) return [];
    const keys = entries.map(e => e.key);
    const nowSec = Date.now() / 1000;

    // Check freshness per source
    const freshness = feedQueries.getSourceFreshness(keys);
    const staleEntries = entries.filter(e => {
      const lastFetch = freshness[e.key];
      return !lastFetch || (nowSec - lastFetch) > STALE_THRESHOLD;
    });

    // Fetch stale/missing sources concurrently
    if (staleEntries.length > 0) {
      const fetchResults = await Promise.all(
        staleEntries.map(e => fetchCatalogSource(e).catch(() => []))
      );
      const allItems: any[] = [];
      for (const items of fetchResults) {
        for (const item of items) {
          if (!item.fetched_at) item.fetched_at = nowSec;
          allItems.push(item);
        }
      }
      if (allItems.length > 0) {
        feedQueries.upsertFeedItems(allItems);
      }
    }

    // Read from DB and return
    const rows = feedQueries.getFeedItems(keys, limit);
    return rows.map(mapRowToFrontend);
  });

  ipcMain.handle('db:panel-suggest', async (_event, text: string) => {
    if (!text || text.length < 3) return { suggestion: '' };
    try {
      const result = await getActiveProvider().chat({
        model: 'qwen3:0.6b',
        messages: [
          { role: 'system', content: 'Given some text the user selected or is looking at, suggest ONE short question (under 12 words) they might want to ask about it. Return ONLY the question, nothing else. No quotes.' },
          { role: 'user', content: text.slice(0, 300) },
        ],
        temperature: 0.7,
        maxTokens: 40,
      });
      let suggestion = (result.message.content ?? '').trim().replace(/^["']|["']$/g, '');
      suggestion = suggestion.split('\n')[0].trim();
      if (suggestion.length > 80) suggestion = suggestion.slice(0, 77) + '\u2026';
      return { suggestion };
    } catch { return { suggestion: '' }; }
  });

  ipcMain.handle('db:search-suggest', async (_event, query: string) => {
    if (!query || query.length < 2) return { suggestions: [] };
    try {
      const result = await getActiveProvider().chat({
        model: 'qwen3:0.6b',
        messages: [
          { role: 'system', content: 'You are a search autocomplete engine. Given a partial search query, suggest 4 completions. Return ONLY a JSON array of strings, nothing else. Example: ["machine learning basics", "machine learning tutorial"]' },
          { role: 'user', content: query },
        ],
        temperature: 0.7,
        maxTokens: 120,
      });
      const raw = (result.message.content ?? '').trim();
      const arrMatch = raw.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        const parsed = JSON.parse(arrMatch[0]);
        return { suggestions: parsed.filter((s: any) => typeof s === 'string' && s.trim()).slice(0, 4) };
      }
      return { suggestions: [] };
    } catch { return { suggestions: [] }; }
  });

}
