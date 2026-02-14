import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

const listFeedsParams = z.object({
  sources: z.array(z.string()).optional().describe('Feed source keys to fetch'),
  limit: z.number().optional().describe('Max items to return'),
});

export const feedList: Tool<z.infer<typeof listFeedsParams>, any> = {
  name: 'feed-list',
  description: 'List feed items from subscribed sources.',
  category: 'feed',
  access: ['agent', 'mcp', 'ui'],
  parameters: listFeedsParams,
  async execute(input): Promise<ToolResult> {
    // In full integration, this would use DB queries.
    // For now, fetch from arXiv RSS directly as a proof of concept.
    const sources = input.sources ?? ['arxiv'];
    const limit = input.limit ?? 20;

    try {
      if (sources.includes('arxiv')) {
        const resp = await fetch('https://rss.arxiv.org/rss/cs.AI', {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const xml = await resp.text();
        const items = parseRssItems(xml, 'arxiv').slice(0, limit);
        return { success: true, data: { items } };
      }
      return { success: true, data: { items: [] } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const fetchFeedParams = z.object({
  url: z.string().describe('RSS/Atom feed URL to fetch'),
});

export const feedFetch: Tool<z.infer<typeof fetchFeedParams>, any> = {
  name: 'feed-fetch',
  description: 'Fetch and parse an RSS/Atom feed URL.',
  category: 'feed',
  access: ['agent', 'mcp', 'ui'],
  parameters: fetchFeedParams,
  async execute(input): Promise<ToolResult> {
    try {
      const resp = await fetch(input.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000),
      });
      const xml = await resp.text();
      const items = parseRssItems(xml, input.url);
      return { success: true, data: { items, count: items.length } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const qualityFilterParams = z.object({
  titles: z.array(z.string()).describe('Titles to score for relevance'),
});

export const feedQualityFilter: Tool<z.infer<typeof qualityFilterParams>, any> = {
  name: 'feed-quality-filter',
  description: 'Score feed item titles for relevance using the LLM quality filter.',
  category: 'feed',
  access: ['agent', 'ui'],
  parameters: qualityFilterParams,
  async execute(input): Promise<ToolResult> {
    // Quality filtering requires LLM calls - placeholder for now.
    // In full integration, this calls the provider to score titles.
    const scores: Record<string, number> = {};
    for (const title of input.titles) {
      scores[title] = 50; // neutral score
    }
    return { success: true, data: { scores } };
  },
};

/** Simple RSS/Atom parser - extracts items from XML */
function parseRssItems(xml: string, source: string): Array<{
  title: string; link: string; description: string; pubDate: string | null; source: string;
}> {
  const items: any[] = [];

  // Try Atom format first
  const atomEntries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  if (atomEntries.length > 0) {
    for (const [, entry] of atomEntries) {
      const title = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
      const link = entry.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/)?.[1]
        ?? entry.match(/<id>(.*?)<\/id>/)?.[1] ?? '';
      const desc = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 300) ?? '';
      const pubDate = entry.match(/<(?:published|updated)>(.*?)<\/(?:published|updated)>/)?.[1] ?? null;
      items.push({ title, link, description: desc, pubDate, source });
    }
    return items;
  }

  // RSS 2.0 format
  const rssItems = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  for (const [, item] of rssItems) {
    const title = item.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() ?? '';
    const link = item.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? '';
    const desc = item.match(/<description[^>]*>([\s\S]*?)<\/description>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim().slice(0, 300) ?? '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? null;
    items.push({ title, link, description: desc, pubDate, source });
  }

  return items;
}
