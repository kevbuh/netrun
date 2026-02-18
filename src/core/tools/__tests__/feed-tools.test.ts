import { describe, it, expect, vi } from 'vitest';
import { feedList, feedFetch } from '../feed/index';

describe('feed tools', () => {
  it('has correct metadata', () => {
    expect(feedList.name).toBe('feed-list');
    expect(feedList.category).toBe('feed');
    expect(feedFetch.name).toBe('feed-fetch');
  });

  it('fetches and parses RSS feed', async () => {
    const mockRss = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>Test Article</title>
            <link>https://example.com/1</link>
            <description>A test article</description>
            <pubDate>Mon, 01 Jan 2025 00:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve(mockRss),
    }));

    const result = await feedFetch.execute({ url: 'https://example.com/feed.xml' }, {});
    expect(result.success).toBe(true);
    expect(result.data.items.length).toBe(1);
    expect(result.data.items[0].title).toBe('Test Article');

    vi.unstubAllGlobals();
  });

  it('parses Atom feeds', async () => {
    const mockAtom = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Atom Entry</title>
          <link href="https://example.com/atom/1"/>
          <summary>An atom entry</summary>
          <published>2025-01-01T00:00:00Z</published>
        </entry>
      </feed>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve(mockAtom),
    }));

    const result = await feedFetch.execute({ url: 'https://example.com/atom.xml' }, {});
    expect(result.success).toBe(true);
    expect(result.data.items[0].title).toBe('Atom Entry');

    vi.unstubAllGlobals();
  });

});
