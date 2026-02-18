import { ipcMain } from 'electron';
import * as feedQueries from '../db/queries/feeds.js';
import { cachedFetch, ollamaProvider } from './shared.js';

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

  ipcMain.handle('db:panel-suggest', async (_event, text: string) => {
    if (!text || text.length < 3) return { suggestion: '' };
    try {
      const result = await ollamaProvider.chat({
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
      const result = await ollamaProvider.chat({
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
