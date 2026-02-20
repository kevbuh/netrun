import { z } from 'zod';
import type { Tool, ToolResult, ToolContext } from '../types.js';
import { webSearch } from './web-search.js';
import { extractText } from '../content/extract-text.js';

interface ResearchResult {
  query: string;
  results: {
    title: string;
    url: string;
    snippet: string;
    content?: string;
    contentTruncated?: boolean;
  }[];
}

const parameters = z.object({
  query: z.string().describe('The search query'),
  extractCount: z.number().optional().describe('Number of top results to extract full text from (default 3, max 5)'),
});

/**
 * Composite search tool: searches the web and extracts full text from
 * top results in parallel. Replaces the web-search → extract-text × N
 * multi-step pattern with a single tool call.
 */
export const webResearch: Tool<z.infer<typeof parameters>, ResearchResult> = {
  name: 'web-research',
  description: 'Search the web and extract full text from top results in one step. Returns search results with full page content extracted in parallel.',
  category: 'search',
  access: ['agent', 'mcp', 'ui'],
  parameters,

  async execute(input, context: ToolContext): Promise<ToolResult<ResearchResult>> {
    if (!input.query) {
      return { success: true, data: { query: '', results: [] } };
    }

    // Step 1: Search
    const searchResult = await webSearch.execute({ query: input.query }, context);
    if (!searchResult.success || !searchResult.data?.results?.length) {
      return {
        success: true,
        data: { query: input.query, results: searchResult.data?.results ?? [] },
      };
    }

    const results = searchResult.data.results;
    const extractCount = Math.min(Math.max(input.extractCount ?? 3, 0), 5);

    // Step 2: Extract text from top N results in parallel
    const toExtract = results.slice(0, extractCount);
    const extractions = await Promise.all(
      toExtract.map(r =>
        extractText.execute({ url: r.url }, context).catch(() => null)
      )
    );

    // Combine search results with extracted content
    const combined = results.map((r, i) => {
      const extraction = i < extractions.length ? extractions[i] : null;
      return {
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        content: extraction?.success ? (extraction.data as any)?.text : undefined,
        contentTruncated: extraction?.success ? (extraction.data as any)?.truncated : undefined,
      };
    });

    return {
      success: true,
      data: { query: input.query, results: combined },
    };
  },
};
