import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';
import { contextIntake } from '../../context/intake.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const parameters = z.object({
  query: z.string().describe('The search query'),
});

/**
 * Web search via DuckDuckGo HTML scraping.
 * Ported from helpers.py:tool_web_search.
 */
export const webSearch: Tool<z.infer<typeof parameters>, { results: SearchResult[] }> = {
  name: 'web-search',
  description: 'Search the web using DuckDuckGo. Returns top results with titles, URLs, and snippets.',
  category: 'search',
  access: ['agent', 'mcp', 'ui'],
  parameters,

  async execute(input): Promise<ToolResult<{ results: SearchResult[] }>> {
    if (!input.query) {
      return { success: true, data: { results: [] } };
    }

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    const html = await resp.text();

    const results: SearchResult[] = [];

    // Parse results using regex (matching Python implementation)
    const titlePattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs;
    const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs;

    const titles = [...html.matchAll(titlePattern)];
    const snippets = [...html.matchAll(snippetPattern)];

    for (let i = 0; i < Math.min(titles.length, 5); i++) {
      let [, url, title] = titles[i];
      const cleanTitle = title.replace(/<[^>]+>/g, '').trim();
      const snippet = i < snippets.length
        ? snippets[i][1].replace(/<[^>]+>/g, '').trim()
        : '';

      // Decode DuckDuckGo redirect URL
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        url = decodeURIComponent(uddgMatch[1]);
      }

      results.push({ title: cleanTitle, url, snippet });
    }

    // Capture top results into living context
    if (results.length > 0) {
      const lines = results.slice(0, 3).map(r => `- [${r.title}](${r.url})`).join('\n');
      contextIntake.ingest({
        source: 'search', section: '## Research',
        content: `**Web:** "${input.query}"\n${lines}`,
        dedupeKey: `ws-${input.query.toLowerCase().trim()}`,
      });
    }

    return { success: true, data: { results } };
  },
};
