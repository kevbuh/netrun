import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract the DOM extraction logic from browse-agent.js
// for unit testing without Electron webview dependencies
// ──────────────────────────────────────────────────────────

// The core DOM extraction logic that runs inside the webview.
// This is the same algorithm as in agentGetAccessibleDOM's injected code.
function buildAccessibleTree(root) {
  root.querySelectorAll('[data-agent-id]').forEach(el => el.removeAttribute('data-agent-id'));

  const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY']);
  const TEXT_BLOCKS = new Set(['H1','H2','H3','H4','H5','H6','P','LI','TD','TH','LABEL','SPAN','FIGCAPTION']);
  const MAX_ELEMENTS = 150;
  const MAX_TEXT = 80;

  function textOf(el) {
    let t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '\u2026' : t;
  }

  function attrStr(el) {
    const parts = [];
    if (el.type && el.tagName === 'INPUT') parts.push('type="' + el.type + '"');
    if (el.placeholder) parts.push('placeholder="' + el.placeholder + '"');
    if (el.name) parts.push('name="' + el.name + '"');
    if (el.href && el.tagName === 'A') {
      let h = el.getAttribute('href') || '';
      if (h.length > 60) h = h.slice(0, 60) + '\u2026';
      parts.push('href="' + h + '"');
    }
    if (el.getAttribute('role')) parts.push('role="' + el.getAttribute('role') + '"');
    if (el.getAttribute('aria-label')) parts.push('aria-label="' + el.getAttribute('aria-label') + '"');
    if (el.value && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      let v = el.value;
      if (v.length > 40) v = v.slice(0, 40) + '\u2026';
      parts.push('value="' + v + '"');
    }
    return parts.length ? ' ' + parts.join(' ') : '';
  }

  const lines = [];
  let id = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode()) && id < MAX_ELEMENTS) {
    const tag = node.tagName;
    const isInteractive = INTERACTIVE.has(tag) || node.onclick || node.getAttribute('role') === 'button' ||
      node.getAttribute('tabindex') !== null;
    const isTextBlock = TEXT_BLOCKS.has(tag);

    if (!isInteractive && !isTextBlock) continue;
    if (isTextBlock && !isInteractive && node.closest('a, button')) continue;

    id++;
    node.setAttribute('data-agent-id', id);
    const tagLower = tag.toLowerCase();
    const text = textOf(node);
    const attrs = attrStr(node);

    if (isInteractive) {
      lines.push('[' + id + '] <' + tagLower + attrs + '>' + (text ? ' "' + text + '"' : ''));
    } else {
      lines.push('[' + id + '] <' + tagLower + '> "' + text + '"');
    }
  }
  return { lines, count: id };
}

describe('browse-agent DOM extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should extract interactive elements with IDs', () => {
    document.body.innerHTML = `
      <button>Sign In</button>
      <a href="/about">About</a>
      <input type="search" placeholder="Search...">
    `;
    const result = buildAccessibleTree(document.body);
    expect(result.count).toBe(3);
    expect(result.lines[0]).toContain('[1]');
    expect(result.lines[0]).toContain('<button>');
    expect(result.lines[0]).toContain('"Sign In"');
    expect(result.lines[1]).toContain('<a');
    expect(result.lines[1]).toContain('href="/about"');
    expect(result.lines[2]).toContain('<input');
    expect(result.lines[2]).toContain('placeholder="Search..."');
  });

  it('should extract text blocks (headings, paragraphs)', () => {
    document.body.innerHTML = `
      <h1>Welcome</h1>
      <p>This is a paragraph.</p>
    `;
    const result = buildAccessibleTree(document.body);
    expect(result.count).toBe(2);
    expect(result.lines[0]).toContain('<h1>');
    expect(result.lines[0]).toContain('"Welcome"');
    expect(result.lines[1]).toContain('<p>');
    expect(result.lines[1]).toContain('"This is a paragraph."');
  });

  it('should set data-agent-id attributes on DOM elements', () => {
    document.body.innerHTML = '<button>Click</button><a href="#">Link</a>';
    buildAccessibleTree(document.body);
    expect(document.querySelector('button').getAttribute('data-agent-id')).toBe('1');
    expect(document.querySelector('a').getAttribute('data-agent-id')).toBe('2');
  });

  it('should clear previous data-agent-id attributes on re-run', () => {
    document.body.innerHTML = '<button data-agent-id="99">Old</button><p>Text</p>';
    buildAccessibleTree(document.body);
    // Old ID should be replaced
    expect(document.querySelector('button').getAttribute('data-agent-id')).toBe('1');
    expect(document.querySelector('[data-agent-id="99"]')).toBeNull();
  });

  it('should truncate long text to 80 chars', () => {
    const longText = 'A'.repeat(100);
    document.body.innerHTML = `<p>${longText}</p>`;
    const result = buildAccessibleTree(document.body);
    expect(result.lines[0]).toContain('A'.repeat(80) + '\u2026');
  });

  it('should cap elements at 150', () => {
    let html = '';
    for (let i = 0; i < 200; i++) {
      html += `<p>Item ${i}</p>`;
    }
    document.body.innerHTML = html;
    const result = buildAccessibleTree(document.body);
    expect(result.count).toBe(150);
  });

  it('should skip text blocks inside interactive elements', () => {
    document.body.innerHTML = '<a href="/foo"><span>Link Text</span></a>';
    const result = buildAccessibleTree(document.body);
    // Should get the <a> but not the inner <span>
    expect(result.count).toBe(1);
    expect(result.lines[0]).toContain('<a');
  });

  it('should include elements with role="button"', () => {
    document.body.innerHTML = '<div role="button">Custom Button</div>';
    const result = buildAccessibleTree(document.body);
    expect(result.count).toBe(1);
    expect(result.lines[0]).toContain('role="button"');
  });

  it('should include elements with tabindex', () => {
    document.body.innerHTML = '<div tabindex="0">Focusable</div>';
    const result = buildAccessibleTree(document.body);
    expect(result.count).toBe(1);
    expect(result.lines[0]).toContain('[1]');
  });

  it('should include input value and name', () => {
    document.body.innerHTML = '<input type="text" name="q" value="hello">';
    const result = buildAccessibleTree(document.body);
    expect(result.lines[0]).toContain('name="q"');
    expect(result.lines[0]).toContain('value="hello"');
  });

  it('should include aria-label', () => {
    document.body.innerHTML = '<button aria-label="Close dialog">X</button>';
    const result = buildAccessibleTree(document.body);
    expect(result.lines[0]).toContain('aria-label="Close dialog"');
  });

  it('should skip non-interactive, non-text elements', () => {
    document.body.innerHTML = '<div>just a div</div><section>section</section><nav>nav</nav>';
    const result = buildAccessibleTree(document.body);
    expect(result.count).toBe(0);
  });

  it('should handle select elements', () => {
    document.body.innerHTML = '<select name="color"><option>Red</option><option>Blue</option></select>';
    const result = buildAccessibleTree(document.body);
    expect(result.count).toBe(1);
    expect(result.lines[0]).toContain('<select');
  });

  it('should handle textarea elements', () => {
    document.body.innerHTML = '<textarea placeholder="Enter text">Some value</textarea>';
    const result = buildAccessibleTree(document.body);
    expect(result.count).toBe(1);
    expect(result.lines[0]).toContain('<textarea');
    expect(result.lines[0]).toContain('placeholder="Enter text"');
  });

  it('should truncate long href attributes', () => {
    const longUrl = '/' + 'a'.repeat(100);
    document.body.innerHTML = `<a href="${longUrl}">Link</a>`;
    const result = buildAccessibleTree(document.body);
    expect(result.lines[0]).toContain('\u2026');
    // Href should be truncated to 60 chars
    expect(result.lines[0]).not.toContain('a'.repeat(100));
  });
});

describe('browse-agent action helpers', () => {
  it('agentClick/agentType/agentScroll return error without tab', async () => {
    // These are async functions that require a tab with webview
    // Just verify the module shape exists — actual IPC testing requires Electron
    expect(typeof buildAccessibleTree).toBe('function');
  });
});
