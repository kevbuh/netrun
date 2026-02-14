import { describe, it, expect, vi } from 'vitest';
import { paperSearch } from '../search/paper-search';

describe('paper-search tool', () => {
  it('has correct metadata', () => {
    expect(paperSearch.name).toBe('paper-search');
    expect(paperSearch.category).toBe('search');
    expect(paperSearch.access).toContain('agent');
  });

  it('returns empty for empty query', async () => {
    const result = await paperSearch.execute({ query: '' }, {});
    expect(result.success).toBe(true);
    expect(result.data!.papers).toEqual([]);
  });

  it('parses arXiv XML response', async () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
      <feed>
        <entry>
          <id>http://arxiv.org/abs/2301.00001</id>
          <title>Attention Is All You Need</title>
          <summary>We propose a new architecture based on attention mechanisms.</summary>
          <author><name>Vaswani</name></author>
          <author><name>Shazeer</name></author>
          <author><name>Parmar</name></author>
          <author><name>Jones</name></author>
        </entry>
      </feed>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve(mockXml),
    }));

    const result = await paperSearch.execute({ query: 'attention' }, {});

    expect(result.success).toBe(true);
    expect(result.data!.papers).toHaveLength(1);
    expect(result.data!.papers[0].title).toBe('Attention Is All You Need');
    expect(result.data!.papers[0].url).toBe('http://arxiv.org/abs/2301.00001');
    expect(result.data!.papers[0].authors).toEqual(['Vaswani', 'Shazeer', 'Parmar']);
    expect(result.data!.papers[0].authors).toHaveLength(3); // max 3

    vi.unstubAllGlobals();
  });
});
