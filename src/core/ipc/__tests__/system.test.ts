import { describe, it, expect } from 'vitest';
import { parseImageDataUri, parseSavedPosts, parseCustomFeeds } from '../system.js';

describe('parseImageDataUri', () => {
  it('returns null for empty string', () => {
    expect(parseImageDataUri('')).toBeNull();
  });

  it('returns null for non-data-uri string', () => {
    expect(parseImageDataUri('https://example.com/image.png')).toBeNull();
  });

  it('returns null for non-image data URI', () => {
    expect(parseImageDataUri('data:text/plain,hello')).toBeNull();
  });

  it('parses PNG data URI', () => {
    const result = parseImageDataUri('data:image/png;base64,iVBORw0KGgo=');
    expect(result).toEqual({ ext: 'png', b64: 'iVBORw0KGgo=' });
  });

  it('parses JPEG data URI', () => {
    const result = parseImageDataUri('data:image/jpeg;base64,/9j/4AAQ=');
    expect(result).toEqual({ ext: 'jpg', b64: '/9j/4AAQ=' });
  });

  it('parses WebP data URI', () => {
    const result = parseImageDataUri('data:image/webp;base64,UklGR=');
    expect(result).toEqual({ ext: 'webp', b64: 'UklGR=' });
  });

  it('defaults to jpg for unknown image subtype', () => {
    const result = parseImageDataUri('data:image/gif;base64,R0lGOD=');
    expect(result).toEqual({ ext: 'jpg', b64: 'R0lGOD=' });
  });
});

describe('parseSavedPosts', () => {
  it('returns empty object for null', () => {
    expect(parseSavedPosts(null)).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(parseSavedPosts(undefined)).toEqual({});
  });

  it('parses JSON string value', () => {
    const result = parseSavedPosts({ value: '{"https://a.com":{"paper":{"title":"A"}}}' });
    expect(result).toEqual({ 'https://a.com': { paper: { title: 'A' } } });
  });

  it('returns object value directly', () => {
    const obj = { 'https://a.com': { paper: { title: 'A' } } };
    const result = parseSavedPosts({ value: obj });
    expect(result).toEqual(obj);
  });

  it('handles invalid JSON string gracefully', () => {
    expect(parseSavedPosts({ value: 'not-json' })).toEqual({});
  });

  it('handles raw string without .value wrapper', () => {
    const result = parseSavedPosts('{"url":"test"}');
    expect(result).toEqual({ url: 'test' });
  });

  it('handles raw object without .value wrapper', () => {
    const obj = { url: 'test' };
    expect(parseSavedPosts(obj)).toEqual(obj);
  });
});

describe('parseCustomFeeds', () => {
  it('returns empty array for null', () => {
    expect(parseCustomFeeds(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(parseCustomFeeds(undefined)).toEqual([]);
  });

  it('parses JSON string into array', () => {
    const result = parseCustomFeeds({ value: '[{"url":"https://feed.com","name":"Feed"}]' });
    expect(result).toEqual([{ url: 'https://feed.com', name: 'Feed' }]);
  });

  it('returns array value directly', () => {
    const arr = [{ url: 'https://feed.com' }];
    const result = parseCustomFeeds({ value: arr });
    expect(result).toEqual(arr);
  });

  it('handles invalid JSON string gracefully', () => {
    expect(parseCustomFeeds({ value: 'not-json' })).toEqual([]);
  });

  it('returns empty array when parsed JSON is not an array', () => {
    expect(parseCustomFeeds({ value: '{"key":"value"}' })).toEqual([]);
  });

  it('handles raw array without .value wrapper', () => {
    const arr = [{ url: 'test' }];
    expect(parseCustomFeeds(arr)).toEqual(arr);
  });
});
