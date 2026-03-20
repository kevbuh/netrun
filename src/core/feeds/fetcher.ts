import * as feedQueries from '../db/queries/feeds.js';
import * as feedStore from '../db/queries/feed-store.js';
import { parseRSSItems } from '../ipc/feeds.js';

const STALE_THRESHOLD = 600; // 10 minutes in seconds
const MAX_CONCURRENT = 10;
const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let sources: feedStore.FeedSource[] = [];

async function fetchURL(url: string, timeoutMs = 15_000): Promise<string> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NetRun/1.0)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return resp.text();
}

async function fetchArxivItems(): Promise<any[]> {
  const body = await fetchURL('https://rss.arxiv.org/rss/cs');
  const items = parseRSSItems(body, 'arxiv');
  for (const item of items) {
    const idMatch = item.link.match(/(\d{4}\.\d{4,5})/);
    if (idMatch) item.arxiv_id = idMatch[1];
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
  const now = Math.floor(Date.now() / 1000);
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
  const html = await fetchURL('https://polymarket.com/breaking');
  const marker = '__NEXT_DATA__" type="application/json" crossorigin="anonymous">';
  const idx = html.indexOf(marker);
  if (idx === -1) return [];
  const start = idx + marker.length;
  const end = html.indexOf('</script>', start);
  const nextData = JSON.parse(html.slice(start, end));
  const queries = nextData.props.pageProps.dehydratedState.queries;
  let markets: any[] = [];
  for (const q of queries) {
    if ((q.queryKey ?? []).includes('biggest-movers')) { markets = q.state.data?.markets ?? []; break; }
  }
  const now = Math.floor(Date.now() / 1000);
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

async function fetchRSSItems(key: string, url: string): Promise<any[]> {
  const body = await fetchURL(url);
  return parseRSSItems(body, key);
}

async function fetchSource(src: feedStore.FeedSource): Promise<any[]> {
  switch (src.special) {
    case 'arxiv': return fetchArxivItems();
    case 'hn': return fetchHNItems();
    case 'polymarket': return fetchPolymarketItems();
    default:
      if (!src.url) return [];
      return fetchRSSItems(src.key, src.url);
  }
}

// ── Concurrent fetch with semaphore ──

async function withConcurrencyLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  const executing = new Set<Promise<void>>();
  for (const task of tasks) {
    const p = task().then(r => { results.push(r); }).catch(() => {});
    executing.add(p.then(() => { executing.delete(p); }));
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}

// ── Public API ──

export function setSources(s: feedStore.FeedSource[]): void {
  sources = s;
}

export function addSource(src: feedStore.FeedSource): void {
  if (!sources.find(s => s.key === src.key)) sources.push(src);
}

export async function refreshAll(): Promise<number> {
  const keys = sources.map(s => s.key);
  const freshness = feedQueries.getSourceFreshness(keys);
  const now = Math.floor(Date.now() / 1000);
  const stale = sources.filter(s => {
    const lastFetch = freshness[s.key];
    return !lastFetch || (now - lastFetch) > STALE_THRESHOLD;
  });

  if (stale.length === 0) return 0;

  console.debug(`[feeds] Refreshing ${stale.length} stale sources`);
  const allItems: any[] = [];

  await withConcurrencyLimit(
    stale.map(src => async () => {
      try {
        const items = await fetchSource(src);
        const ts = Math.floor(Date.now() / 1000);
        for (const item of items) {
          if (!item.fetched_at) item.fetched_at = ts;
        }
        allItems.push(...items);
        console.debug(`[feeds] Fetched ${src.key}: ${items.length} items`);
      } catch (e) {
        console.debug(`[feeds] Error fetching ${src.key}:`, e);
      }
    }),
    MAX_CONCURRENT
  );

  if (allItems.length > 0) {
    feedQueries.upsertFeedItems(allItems);
  }

  return allItems.length;
}

export async function refreshSources(keys: string[]): Promise<number> {
  const toFetch = sources.filter(s => keys.includes(s.key));
  const allItems: any[] = [];

  await withConcurrencyLimit(
    toFetch.map(src => async () => {
      try {
        const items = await fetchSource(src);
        const ts = Math.floor(Date.now() / 1000);
        for (const item of items) if (!item.fetched_at) item.fetched_at = ts;
        allItems.push(...items);
      } catch { /* skip failed */ }
    }),
    MAX_CONCURRENT
  );

  if (allItems.length > 0) feedQueries.upsertFeedItems(allItems);
  return allItems.length;
}

export function startBackgroundRefresh(): void {
  if (refreshTimer) return;
  // Initial refresh
  refreshAll().then(n => console.debug(`[feeds] Initial refresh: ${n} items`)).catch(() => {});
  // Periodic refresh
  refreshTimer = setInterval(() => {
    refreshAll().then(n => console.debug(`[feeds] Periodic refresh: ${n} items`)).catch(() => {});
  }, REFRESH_INTERVAL);
}

export function stopBackgroundRefresh(): void {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}
