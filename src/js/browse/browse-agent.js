/* browse-agent.js — Browser automation primitives for agentic control.
   Provides DOM extraction (accessible tree), click, type, scroll actions.
   Elements are tagged with data-agent-id attributes directly in the webview DOM. */

/* global _browseTabs, _browseActiveTab */

// ── DOM extraction: build compressed accessible tree ──

async function agentGetAccessibleDOM(tab) {
  if (!tab || !tab.webview) return { error: 'no active tab' };
  const wc = tab.webview.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const code = `(function() {
    // Clear previous agent IDs
    document.querySelectorAll('[data-agent-id]').forEach(el => el.removeAttribute('data-agent-id'));

    const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY']);
    const TEXT_BLOCKS = new Set(['H1','H2','H3','H4','H5','H6','P','LI','TD','TH','LABEL','SPAN','FIGCAPTION']);
    const MAX_ELEMENTS = 150;
    const MAX_TEXT = 80;

    function isVisible(el) {
      if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      return true;
    }

    function textOf(el) {
      let t = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '…' : t;
    }

    function attrStr(el) {
      const parts = [];
      const tag = el.tagName.toLowerCase();
      if (el.type && el.tagName === 'INPUT') parts.push('type="' + el.type + '"');
      if (el.placeholder) parts.push('placeholder="' + el.placeholder + '"');
      if (el.name) parts.push('name="' + el.name + '"');
      if (el.href && el.tagName === 'A') {
        let h = el.getAttribute('href') || '';
        if (h.length > 60) h = h.slice(0, 60) + '…';
        parts.push('href="' + h + '"');
      }
      if (el.role) parts.push('role="' + el.role + '"');
      if (el.ariaLabel) parts.push('aria-label="' + el.ariaLabel + '"');
      if (el.value && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        let v = el.value;
        if (v.length > 40) v = v.slice(0, 40) + '…';
        parts.push('value="' + v + '"');
      }
      return parts.length ? ' ' + parts.join(' ') : '';
    }

    const lines = [];
    let id = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode()) && id < MAX_ELEMENTS) {
      if (!isVisible(node)) continue;
      const tag = node.tagName;
      const isInteractive = INTERACTIVE.has(tag) || node.onclick || node.getAttribute('role') === 'button' ||
        node.getAttribute('tabindex') !== null;
      const isTextBlock = TEXT_BLOCKS.has(tag);

      if (!isInteractive && !isTextBlock) continue;

      // Skip text blocks that are inside an interactive element (avoid duplication)
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
    return {
      elements: lines.join('\\n'),
      url: location.href,
      title: document.title,
      elementCount: id
    };
  })()`;

  try {
    const result = await window.electronAPI.agentExecJs(wc, code);
    if (result.error) return { error: result.error };
    return result.result;
  } catch (e) {
    return { error: e.message };
  }
}

// ── Click element by agent ID ──

async function agentClick(tab, elementId) {
  if (!tab || !tab.webview) return { error: 'no active tab' };
  const wc = tab.webview.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const code = `(function() {
    const el = document.querySelector('[data-agent-id="${elementId}"]');
    if (!el) return { error: 'element not found: ${elementId}' };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.outline = '3px solid #ff4444';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 1500);
    el.click();
    return { ok: true };
  })()`;

  try {
    const result = await window.electronAPI.agentExecJs(wc, code);
    if (result.error) return { error: result.error };
    return result.result;
  } catch (e) {
    return { error: e.message };
  }
}

// ── Type into element by agent ID ──

async function agentType(tab, elementId, text) {
  if (!tab || !tab.webview) return { error: 'no active tab' };
  const wc = tab.webview.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const safeText = JSON.stringify(text);
  const code = `(function() {
    const el = document.querySelector('[data-agent-id="${elementId}"]');
    if (!el) return { error: 'element not found: ${elementId}' };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
    el.style.outline = '3px solid #ff4444';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 1500);
    // Use native setter pattern to trigger React/Vue/framework events
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(el, ${safeText});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`;

  try {
    const result = await window.electronAPI.agentExecJs(wc, code);
    if (result.error) return { error: result.error };
    return result.result;
  } catch (e) {
    return { error: e.message };
  }
}

// ── Scroll page up or down ──

async function agentScroll(tab, direction) {
  if (!tab || !tab.webview) return { error: 'no active tab' };
  const wc = tab.webview.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const dir = direction === 'up' ? -1 : 1;
  const code = `(function() {
    window.scrollBy(0, window.innerHeight * 0.8 * ${dir});
    return { scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight };
  })()`;

  try {
    const result = await window.electronAPI.agentExecJs(wc, code);
    if (result.error) return { error: result.error };
    return result.result;
  } catch (e) {
    return { error: e.message };
  }
}

// ── Take screenshot of current tab ──

async function agentScreenshot(tab) {
  if (!tab || !tab.webview) return { error: 'no active tab' };
  const wc = tab.webview.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  try {
    const base64 = await window.electronAPI.captureWebview(wc);
    if (!base64) return { error: 'screenshot failed' };
    return { image: base64 };
  } catch (e) {
    return { error: e.message };
  }
}
