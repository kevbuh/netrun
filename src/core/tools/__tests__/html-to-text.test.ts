import { describe, it, expect } from 'vitest';

/**
 * Replicate htmlToText from extract-text.ts for unit testing.
 * This is a pure function — no external dependencies.
 */
function htmlToText(html: string): string {
  let cleaned = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '');
  cleaned = cleaned.replace(/<[^>]+>/g, '\n');
  const lines = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  return lines.join('\n');
}

describe('htmlToText', () => {
  it('strips basic HTML tags', () => {
    expect(htmlToText('<p>Hello</p>')).toBe('Hello');
  });

  it('strips nested HTML', () => {
    const result = htmlToText('<div><p><strong>Bold</strong> text</p></div>');
    expect(result).toContain('Bold');
    expect(result).toContain('text');
  });

  it('removes script blocks entirely', () => {
    const html = '<p>Before</p><script>alert("xss")</script><p>After</p>';
    const result = htmlToText(html);
    expect(result).toContain('Before');
    expect(result).toContain('After');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('script');
  });

  it('removes style blocks entirely', () => {
    const html = '<p>Content</p><style>body { color: red; }</style>';
    const result = htmlToText(html);
    expect(result).toBe('Content');
  });

  it('removes noscript blocks entirely', () => {
    const html = '<p>Content</p><noscript>Enable JS</noscript>';
    const result = htmlToText(html);
    expect(result).toBe('Content');
  });

  it('handles script with attributes', () => {
    const html = '<script type="text/javascript" src="app.js">var x=1;</script><p>OK</p>';
    expect(htmlToText(html)).toBe('OK');
  });

  it('handles style with attributes', () => {
    const html = '<style type="text/css">.foo { display: none; }</style><p>Visible</p>';
    expect(htmlToText(html)).toBe('Visible');
  });

  it('handles multiline script blocks', () => {
    const html = `<script>
      function foo() {
        return 42;
      }
    </script><p>Result</p>`;
    expect(htmlToText(html)).toBe('Result');
  });

  it('collapses multiple blank lines', () => {
    const html = '<p>Line 1</p><br><br><br><p>Line 2</p>';
    const result = htmlToText(html);
    expect(result).toBe('Line 1\nLine 2');
  });

  it('trims whitespace from lines', () => {
    const html = '<p>   padded   </p>';
    expect(htmlToText(html)).toBe('padded');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(htmlToText('Hello world')).toBe('Hello world');
  });

  it('handles self-closing tags', () => {
    expect(htmlToText('Line 1<br/>Line 2')).toBe('Line 1\nLine 2');
  });

  it('handles multiple scripts and styles', () => {
    const html = '<script>a()</script><p>Keep</p><style>.x{}</style><script>b()</script>';
    expect(htmlToText(html)).toBe('Keep');
  });

  it('handles real-world HTML structure', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Test</title><style>body{}</style></head>
      <body>
        <nav>Navigation</nav>
        <main>
          <h1>Title</h1>
          <p>Paragraph text here.</p>
        </main>
        <script>analytics();</script>
      </body>
      </html>
    `;
    const result = htmlToText(html);
    expect(result).toContain('Title');
    expect(result).toContain('Paragraph text here.');
    expect(result).not.toContain('analytics');
    expect(result).not.toContain('body{}');
  });

  it('preserves text between tags on same line', () => {
    const html = '<span>Hello</span> <span>World</span>';
    const result = htmlToText(html);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('handles HTML entities as plain text', () => {
    // htmlToText doesn't decode entities — they pass through
    const html = '<p>&amp; &lt; &gt;</p>';
    expect(htmlToText(html)).toBe('&amp; &lt; &gt;');
  });

  it('handles tags with attributes', () => {
    const html = '<a href="https://example.com" class="link">Click here</a>';
    expect(htmlToText(html)).toBe('Click here');
  });

  it('handles deeply nested structure', () => {
    const html = '<div><div><div><div><span>Deep</span></div></div></div></div>';
    expect(htmlToText(html)).toBe('Deep');
  });
});
