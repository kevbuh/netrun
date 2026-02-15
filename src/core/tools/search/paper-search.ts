import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';
import { contextIntake } from '../../context/intake.js';

interface PaperResult {
  title: string;
  url: string;
  authors: string[];
  summary: string;
}

const parameters = z.object({
  query: z.string().describe('The search query for papers'),
});

/**
 * Build arXiv API search_query from user input.
 * Supports: title:"phrase", title:word, "phrase", by:author, bare words.
 * Ported from helpers.py:build_arxiv_query.
 */
function buildArxivQuery(raw: string): string {
  const parts: string[] = [];

  // Extract by:author
  const byMatch = raw.match(/\bby:(.+)/);
  if (byMatch) {
    const author = byMatch[1].trim();
    if (author) parts.push(`au:"${author}"`);
    raw = raw.slice(0, byMatch.index).trim();
  }

  // Extract title:"phrase"
  raw = raw.replace(/title:"([^"]+)"/g, (_, phrase) => {
    parts.push(`ti:"${phrase}"`);
    return '';
  });

  // Extract "phrase"
  raw = raw.replace(/"([^"]+)"/g, (_, phrase) => {
    parts.push(`all:"${phrase}"`);
    return '';
  });

  // Process remaining tokens
  const bareWords: string[] = [];
  for (const token of raw.split(/\s+/).filter(Boolean)) {
    if (token.startsWith('title:')) {
      const val = token.slice(6);
      if (val) parts.push(`ti:${val}`);
    } else if (token.startsWith('source:') || token.startsWith('sort:')) {
      continue;
    } else {
      bareWords.push(token);
    }
  }

  if (bareWords.length > 0) {
    parts.push(`all:"${bareWords.join(' ')}"`);
  }

  return parts.length > 0 ? parts.join(' AND ') : 'all:*';
}

/**
 * Search for academic papers on arXiv.
 * Ported from helpers.py:tool_search_papers.
 */
export const paperSearch: Tool<z.infer<typeof parameters>, { papers: PaperResult[] }> = {
  name: 'paper-search',
  description: 'Search for academic papers on arXiv. Returns titles, URLs, authors, and summaries.',
  category: 'search',
  access: ['agent', 'mcp', 'ui'],
  parameters,

  async execute(input): Promise<ToolResult<{ papers: PaperResult[] }>> {
    if (!input.query) {
      return { success: true, data: { papers: [] } };
    }

    const arxivQuery = buildArxivQuery(input.query);
    const searchUrl =
      `https://export.arxiv.org/api/query?` +
      `search_query=${encodeURIComponent(arxivQuery)}` +
      `&start=0&max_results=5` +
      `&sortBy=relevance&sortOrder=descending`;

    const resp = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const data = await resp.text();

    const papers: PaperResult[] = [];
    const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;

    for (const match of data.matchAll(entryPattern)) {
      const entry = match[1];
      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
      const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
      const idMatch = entry.match(/<id>(.*?)<\/id>/);
      const authors = [...entry.matchAll(/<name>(.*?)<\/name>/g)].map(m => m[1]);

      papers.push({
        title: titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '',
        url: idMatch ? idMatch[1].trim() : '',
        authors: authors.slice(0, 3),
        summary: summaryMatch
          ? summaryMatch[1].replace(/\s+/g, ' ').trim().slice(0, 300)
          : '',
      });

      if (papers.length >= 5) break;
    }

    // Capture top results into living context
    if (papers.length > 0) {
      const lines = papers.slice(0, 3).map(p => `- [${p.title}](${p.url})`).join('\n');
      contextIntake.ingest({
        source: 'search', section: '## Research',
        content: `**Papers:** "${input.query}"\n${lines}`,
        dedupeKey: `ps-${input.query.toLowerCase().trim()}`,
      });
    }

    return { success: true, data: { papers } };
  },
};
