import { describe, it, expect, vi } from 'vitest';
import { extractText } from '../content/extract-text';

describe('extract-text tool', () => {
  it('has correct metadata', () => {
    expect(extractText.name).toBe('extract-text');
    expect(extractText.category).toBe('content');
    expect(extractText.access).toContain('agent');
  });

  it('returns error for empty URL', async () => {
    const result = await extractText.execute({ url: '' }, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('URL required');
  });

  it('extracts text from HTML page', async () => {
    const mockHtml = `
      <html>
        <head><title>Test</title></head>
        <body>
          <script>var x = 1;</script>
          <style>.foo { color: red; }</style>
          <h1>Hello World</h1>
          <p>This is a paragraph.</p>
          <noscript>Enable JS</noscript>
        </body>
      </html>
    `;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve(mockHtml),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));

    const result = await extractText.execute({ url: 'https://example.com/page' }, {});

    expect(result.success).toBe(true);
    expect(result.data!.text).toContain('Hello World');
    expect(result.data!.text).toContain('This is a paragraph');
    expect(result.data!.text).not.toContain('var x = 1');
    expect(result.data!.text).not.toContain('color: red');
    expect(result.data!.text).not.toContain('Enable JS');

    vi.unstubAllGlobals();
  });

  it('truncates long text', async () => {
    const longText = 'x'.repeat(10000);
    const mockHtml = `<html><body><p>${longText}</p></body></html>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve(mockHtml),
    }));

    const result = await extractText.execute({ url: 'https://example.com/long' }, {});

    expect(result.success).toBe(true);
    expect(result.data!.text.length).toBe(8000);
    expect(result.data!.truncated).toBe(true);

    vi.unstubAllGlobals();
  });
});
