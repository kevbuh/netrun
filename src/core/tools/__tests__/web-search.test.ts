import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webSearch } from '../search/web-search';

describe('web-search tool', () => {
  it('has correct metadata', () => {
    expect(webSearch.name).toBe('web-search');
    expect(webSearch.category).toBe('search');
    expect(webSearch.access).toContain('agent');
    expect(webSearch.access).toContain('mcp');
  });

  it('returns empty results for empty query', async () => {
    const result = await webSearch.execute({ query: '' }, {});
    expect(result.success).toBe(true);
    expect(result.data!.results).toEqual([]);
  });

  it('parses DuckDuckGo HTML results', async () => {
    const mockHtml = `
      <div class="result">
        <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Example Title</a>
        <a class="result__snippet">This is a snippet</a>
      </div>
      <div class="result">
        <a class="result__a" href="/l/?uddg=https%3A%2F%2Ftest.com">Test <b>Bold</b> Title</a>
        <a class="result__snippet">Another snippet</a>
      </div>
    `;

    const mockFetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(mockHtml),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await webSearch.execute({ query: 'test query' }, {});

    expect(result.success).toBe(true);
    expect(result.data!.results).toHaveLength(2);
    expect(result.data!.results[0]).toEqual({
      title: 'Example Title',
      url: 'https://example.com',
      snippet: 'This is a snippet',
    });
    expect(result.data!.results[1].title).toBe('Test Bold Title');

    vi.unstubAllGlobals();
  });
});
