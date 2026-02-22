import { describe, it, expect } from 'vitest';
import { parseRSSItems, mapRowToFrontend, STALE_THRESHOLD } from '../feeds.js';

describe('STALE_THRESHOLD', () => {
  it('is 600 seconds (10 minutes)', () => {
    expect(STALE_THRESHOLD).toBe(600);
  });
});

describe('parseRSSItems', () => {
  it('parses basic RSS items', () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Test Article</title>
          <link>https://example.com/article</link>
          <description>A test description</description>
          <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
        </item>
      </channel></rss>
    `;
    const items = parseRSSItems(xml, 'test-source');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'test-source',
      title: 'Test Article',
      link: 'https://example.com/article',
      description: 'A test description',
      display_date: 'Mon, 01 Jan 2024 00:00:00 GMT',
      pub_date: 'Mon, 01 Jan 2024 00:00:00 GMT',
      arxiv_id: null,
    });
  });

  it('parses multiple RSS items', () => {
    const xml = `
      <rss><channel>
        <item><title>First</title><link>https://a.com/1</link></item>
        <item><title>Second</title><link>https://a.com/2</link></item>
        <item><title>Third</title><link>https://a.com/3</link></item>
      </channel></rss>
    `;
    const items = parseRSSItems(xml, 'multi');
    expect(items).toHaveLength(3);
    expect(items.map((i: any) => i.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('handles CDATA in title and description', () => {
    const xml = `
      <rss><channel>
        <item>
          <title><![CDATA[Title with <special> chars]]></title>
          <link>https://example.com/cdata</link>
          <description><![CDATA[Desc with <b>bold</b>]]></description>
        </item>
      </channel></rss>
    `;
    const items = parseRSSItems(xml, 'cdata');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Title with <special> chars');
    expect(items[0].description).toBe('Desc with <b>bold</b>');
  });

  it('skips items missing title', () => {
    const xml = `
      <rss><channel>
        <item><link>https://example.com/no-title</link></item>
        <item><title>Has Title</title><link>https://example.com/ok</link></item>
      </channel></rss>
    `;
    const items = parseRSSItems(xml, 'skip');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Has Title');
  });

  it('skips items missing link', () => {
    const xml = `
      <rss><channel>
        <item><title>No Link</title></item>
      </channel></rss>
    `;
    const items = parseRSSItems(xml, 'skip');
    expect(items).toHaveLength(0);
  });

  it('falls back to guid when link is missing', () => {
    const xml = `
      <rss><channel>
        <item>
          <title>GUID Item</title>
          <guid>https://example.com/guid-link</guid>
        </item>
      </channel></rss>
    `;
    const items = parseRSSItems(xml, 'guid');
    expect(items).toHaveLength(1);
    expect(items[0].link).toBe('https://example.com/guid-link');
  });

  it('extracts dc:creator as author', () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Authored</title>
          <link>https://example.com/a</link>
          <dc:creator>John Doe</dc:creator>
        </item>
      </channel></rss>
    `;
    const items = parseRSSItems(xml, 'auth');
    expect(items[0].authors).toBe('John Doe');
  });

  it('falls back to Atom entry format when no RSS items', () => {
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Atom Entry</title>
          <link href="https://example.com/atom" />
          <summary>An atom summary</summary>
          <published>2024-01-01T00:00:00Z</published>
        </entry>
      </feed>
    `;
    const items = parseRSSItems(xml, 'atom-source');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'atom-source',
      title: 'Atom Entry',
      link: 'https://example.com/atom',
      description: 'An atom summary',
      display_date: '2024-01-01T00:00:00Z',
    });
  });

  it('prefers RSS items over Atom entries when both present', () => {
    const xml = `
      <item><title>RSS Item</title><link>https://rss.com</link></item>
      <entry><title>Atom Entry</title><link href="https://atom.com" /></entry>
    `;
    const items = parseRSSItems(xml, 'mixed');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('RSS Item');
  });

  it('returns empty array for empty XML', () => {
    expect(parseRSSItems('', 'empty')).toEqual([]);
  });

  it('returns empty array for XML with no items or entries', () => {
    expect(parseRSSItems('<rss><channel></channel></rss>', 'none')).toEqual([]);
  });

  it('truncates description to 500 chars', () => {
    const longDesc = 'x'.repeat(600);
    const xml = `
      <rss><channel>
        <item>
          <title>Long</title>
          <link>https://example.com</link>
          <description>${longDesc}</description>
        </item>
      </channel></rss>
    `;
    const items = parseRSSItems(xml, 'trunc');
    expect(items[0].description.length).toBe(500);
  });
});

describe('mapRowToFrontend', () => {
  it('maps pub_date to pubDate and display_date to date', () => {
    const row = { pub_date: '2024-01-01', display_date: '2024-01-01', arxiv_id: '2401.00001', extra: '{}', categories: '[]' };
    const result = mapRowToFrontend(row);
    expect(result.pubDate).toBe('2024-01-01');
    expect(result.date).toBe('2024-01-01');
    expect(result.arxivId).toBe('2401.00001');
  });

  it('parses JSON extra and spreads properties', () => {
    const row = { extra: '{"hnScore":42,"hnComments":10}', categories: '[]', pub_date: '', display_date: '', arxiv_id: null };
    const result = mapRowToFrontend(row);
    expect(result.hnScore).toBe(42);
    expect(result.hnComments).toBe(10);
  });

  it('parses JSON categories string into array', () => {
    const row = { extra: '{}', categories: '["ml","ai"]', pub_date: '', display_date: '', arxiv_id: null };
    const result = mapRowToFrontend(row);
    expect(result.categories).toEqual(['ml', 'ai']);
  });

  it('handles invalid JSON extra gracefully', () => {
    const row = { extra: 'not-json', categories: '[]', pub_date: '', display_date: '', arxiv_id: null };
    const result = mapRowToFrontend(row);
    expect(result.pubDate).toBe('');
  });

  it('handles invalid JSON categories gracefully', () => {
    const row = { extra: '{}', categories: 'not-json', pub_date: '', display_date: '', arxiv_id: null };
    const result = mapRowToFrontend(row);
    expect(result.categories).toEqual([]);
  });

  it('handles already-parsed extra object', () => {
    const row = { extra: { polyYesPct: 65 }, categories: [], pub_date: '', display_date: '', arxiv_id: null };
    const result = mapRowToFrontend(row);
    expect(result.polyYesPct).toBe(65);
  });

  it('handles null/undefined extra', () => {
    const row = { extra: null, categories: null, pub_date: '', display_date: '', arxiv_id: null };
    const result = mapRowToFrontend(row);
    expect(result.categories).toEqual([]);
  });
});
