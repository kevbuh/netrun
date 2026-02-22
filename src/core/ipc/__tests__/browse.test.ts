import { describe, it, expect } from 'vitest';
import { parseLinkPreview, extractLinks } from '../browse.js';

describe('parseLinkPreview', () => {
  it('extracts og:title and og:description', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Test Page">
        <meta property="og:description" content="A test page description">
      </head><body></body></html>
    `;
    const result = parseLinkPreview(html, 'https://example.com/page');
    expect(result.title).toBe('Test Page');
    expect(result.description).toBe('A test page description');
  });

  it('falls back to <title> tag when no og:title', () => {
    const html = '<html><head><title>Fallback Title</title></head><body></body></html>';
    const result = parseLinkPreview(html, 'https://example.com');
    expect(result.title).toBe('Fallback Title');
  });

  it('falls back to twitter:title', () => {
    const html = '<html><head><meta name="twitter:title" content="Twitter Title"></head><body></body></html>';
    const result = parseLinkPreview(html, 'https://example.com');
    expect(result.title).toBe('Twitter Title');
  });

  it('extracts og:image', () => {
    const html = '<meta property="og:image" content="https://example.com/image.jpg">';
    const result = parseLinkPreview(html, 'https://example.com');
    expect(result.image).toBe('https://example.com/image.jpg');
  });

  it('resolves protocol-relative image URLs', () => {
    const html = '<meta property="og:image" content="//cdn.example.com/img.jpg">';
    const result = parseLinkPreview(html, 'https://example.com/page');
    expect(result.image).toBe('https://cdn.example.com/img.jpg');
  });

  it('resolves absolute-path image URLs', () => {
    const html = '<meta property="og:image" content="/images/photo.png">';
    const result = parseLinkPreview(html, 'https://example.com/page');
    expect(result.image).toBe('https://example.com/images/photo.png');
  });

  it('resolves relative image URLs', () => {
    const html = '<meta property="og:image" content="photo.png">';
    const result = parseLinkPreview(html, 'https://example.com/path/page');
    expect(result.image).toBe('https://example.com/path/photo.png');
  });

  it('extracts domain and strips www', () => {
    const html = '<html><head><title>Test</title></head></html>';
    const result = parseLinkPreview(html, 'https://www.example.com/page');
    expect(result.domain).toBe('example.com');
  });

  it('constructs favicon URL', () => {
    const html = '<html><head><title>Test</title></head></html>';
    const result = parseLinkPreview(html, 'https://example.com/some/page');
    expect(result.favicon).toBe('https://example.com/favicon.ico');
  });

  it('uses og:site_name for site field', () => {
    const html = '<meta property="og:site_name" content="My Site"><title>Page</title>';
    const result = parseLinkPreview(html, 'https://example.com');
    expect(result.site).toBe('My Site');
  });

  it('falls back to domain for site field when no og:site_name', () => {
    const html = '<title>Page</title>';
    const result = parseLinkPreview(html, 'https://blog.example.com');
    expect(result.site).toBe('blog.example.com');
  });

  it('truncates title to 200 chars', () => {
    const longTitle = 'A'.repeat(300);
    const html = `<title>${longTitle}</title>`;
    const result = parseLinkPreview(html, 'https://example.com');
    expect(result.title.length).toBe(200);
  });

  it('truncates description to 300 chars', () => {
    const longDesc = 'B'.repeat(400);
    const html = `<meta property="og:description" content="${longDesc}"><title>T</title>`;
    const result = parseLinkPreview(html, 'https://example.com');
    expect(result.description.length).toBe(300);
  });

  it('handles meta tags with content before property', () => {
    const html = '<meta content="Reversed Order" property="og:title"><title>Fallback</title>';
    const result = parseLinkPreview(html, 'https://example.com');
    expect(result.title).toBe('Reversed Order');
  });

  it('returns empty strings for missing fields', () => {
    const html = '<html><body>No meta tags here</body></html>';
    const result = parseLinkPreview(html, 'https://example.com');
    expect(result.title).toBe('');
    expect(result.description).toBe('');
    expect(result.image).toBe('');
  });
});

describe('extractLinks', () => {
  it('extracts links with text', () => {
    const html = '<a href="https://example.com">Example</a>';
    const links = extractLinks(html, 'https://base.com');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ text: 'Example', url: 'https://example.com/' });
  });

  it('resolves relative URLs against base', () => {
    const html = '<a href="/about">About</a>';
    const links = extractLinks(html, 'https://example.com/page');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://example.com/about');
  });

  it('deduplicates links by URL', () => {
    const html = `
      <a href="https://example.com">First</a>
      <a href="https://example.com">Second</a>
    `;
    const links = extractLinks(html, 'https://base.com');
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('First');
  });

  it('strips HTML tags from link text', () => {
    const html = '<a href="https://example.com"><b>Bold</b> text</a>';
    const links = extractLinks(html, 'https://base.com');
    expect(links[0].text).toBe('Bold text');
  });

  it('skips links with empty text', () => {
    const html = '<a href="https://example.com">  </a>';
    const links = extractLinks(html, 'https://base.com');
    expect(links).toHaveLength(0);
  });

  it('skips non-http links', () => {
    const html = '<a href="mailto:test@example.com">Email</a><a href="javascript:void(0)">Click</a>';
    const links = extractLinks(html, 'https://base.com');
    expect(links).toHaveLength(0);
  });

  it('handles multiple links', () => {
    const html = `
      <a href="https://a.com">A</a>
      <a href="https://b.com">B</a>
      <a href="https://c.com">C</a>
    `;
    const links = extractLinks(html, 'https://base.com');
    expect(links).toHaveLength(3);
  });

  it('returns empty array for no links', () => {
    const links = extractLinks('<p>No links here</p>', 'https://base.com');
    expect(links).toEqual([]);
  });
});
