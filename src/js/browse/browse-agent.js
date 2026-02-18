/* browse-agent.js — Browser automation primitives for agentic control.
   Provides DOM extraction (accessible tree), click, type, scroll actions.
   Elements are tagged with data-agent-id attributes directly in the webview DOM. */

/* global _browseTabs, _browseActiveTab */

// ── DOM extraction: build compressed accessible tree ──

async function agentGetAccessibleDOM(tab) {
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const code = `(function() {
    // Clear previous agent IDs
    document.querySelectorAll('[data-agent-id]').forEach(el => el.removeAttribute('data-agent-id'));

    const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY']);
    const TEXT_BLOCKS = new Set(['H1','H2','H3','H4','H5','H6','P','LI','TD','TH','LABEL','SPAN','FIGCAPTION']);
    const BASE_CAP = 300;
    const MAX_TEXT = 80;
    const VIEWPORT_BUFFER = 200;

    var vpTop = window.scrollY - VIEWPORT_BUFFER;
    var vpBottom = window.scrollY + window.innerHeight + VIEWPORT_BUFFER;

    function isVisible(el) {
      if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      var elTop = r.top + window.scrollY;
      var elBottom = r.bottom + window.scrollY;
      if (elBottom < vpTop || elTop > vpBottom) return false;
      return true;
    }

    function textOf(el) {
      let t = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '…' : t;
    }

    function attrStr(el) {
      const parts = [];
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
      // Accessibility state attributes
      var ariaExpanded = el.getAttribute('aria-expanded');
      if (ariaExpanded !== null) parts.push('aria-expanded="' + ariaExpanded + '"');
      var ariaChecked = el.getAttribute('aria-checked');
      if (ariaChecked !== null) parts.push('aria-checked="' + ariaChecked + '"');
      var ariaSelected = el.getAttribute('aria-selected');
      if (ariaSelected !== null) parts.push('aria-selected="' + ariaSelected + '"');
      var ariaDisabled = el.getAttribute('aria-disabled');
      if (ariaDisabled !== null) parts.push('aria-disabled="' + ariaDisabled + '"');
      if (el.disabled) parts.push('disabled');
      if (el.checked) parts.push('checked');
      if (el.value && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        let v = el.value;
        if (v.length > 40) v = v.slice(0, 40) + '…';
        parts.push('value="' + v + '"');
      }
      var title = el.getAttribute('title');
      if (title) {
        if (title.length > 40) title = title.slice(0, 40) + '…';
        parts.push('title="' + title + '"');
      }
      return parts.length ? ' ' + parts.join(' ') : '';
    }

    function bboxStr(el) {
      var r = el.getBoundingClientRect();
      return ' @' + Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + ',' + Math.round(r.height);
    }

    // Two-pass adaptive cap: collect interactive first, then fill with text
    var interactiveNodes = [];
    var textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (!isVisible(node)) continue;
      const tag = node.tagName;
      const isInteractive = INTERACTIVE.has(tag) || node.onclick || node.getAttribute('role') === 'button' ||
        node.getAttribute('tabindex') !== null;
      const isTextBlock = TEXT_BLOCKS.has(tag);
      if (!isInteractive && !isTextBlock) continue;
      if (isTextBlock && !isInteractive && node.closest('a, button')) continue;
      if (isInteractive) interactiveNodes.push(node);
      else textNodes.push(node);
    }

    // Adaptive cap: at least BASE_CAP, scale up for complex pages
    var totalVisible = interactiveNodes.length + textNodes.length;
    var cap = Math.max(BASE_CAP, Math.min(totalVisible, 500));

    // First pass: all interactive elements (up to cap)
    var selected = interactiveNodes.slice(0, cap);
    // Second pass: fill remaining with text nodes
    var remaining = cap - selected.length;
    if (remaining > 0) selected = selected.concat(textNodes.slice(0, remaining));

    const lines = [];
    let id = 0;
    for (var i = 0; i < selected.length; i++) {
      var el = selected[i];
      id++;
      el.setAttribute('data-agent-id', id);
      var tagLower = el.tagName.toLowerCase();
      var text = textOf(el);
      var attrs = attrStr(el);
      var bbox = bboxStr(el);
      var isInt = INTERACTIVE.has(el.tagName) || el.onclick || el.getAttribute('role') === 'button' || el.getAttribute('tabindex') !== null;
      if (isInt) {
        lines.push('[' + id + '] <' + tagLower + attrs + '>' + (text ? ' "' + text + '"' : '') + bbox);
      } else {
        lines.push('[' + id + '] <' + tagLower + '> "' + text + '"' + bbox);
      }
    }
    var viewportMeta = 'VIEWPORT: scrollY=' + Math.round(window.scrollY) + ', pageHeight=' + document.documentElement.scrollHeight + ', viewportHeight=' + window.innerHeight;
    return {
      elements: viewportMeta + '\\n' + lines.join('\\n'),
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
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
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
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
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
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
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
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  try {
    const base64 = await window.electronAPI.captureWebview(wc);
    if (!base64) return { error: 'screenshot failed' };
    return { image: base64 };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Query selector: find elements by CSS selector ──

async function agentQuerySelector(tab, selector, maxResults) {
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const safeSelector = JSON.stringify(selector);
  const limit = maxResults || 20;
  const code = `(function() {
    var MAX_RESULTS = ${limit};
    var MAX_TEXT = 80;
    var INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY']);

    function textOf(el) {
      var t = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '…' : t;
    }

    function attrStr(el) {
      var parts = [];
      if (el.type && el.tagName === 'INPUT') parts.push('type="' + el.type + '"');
      if (el.placeholder) parts.push('placeholder="' + el.placeholder + '"');
      if (el.name) parts.push('name="' + el.name + '"');
      if (el.href && el.tagName === 'A') {
        var h = el.getAttribute('href') || '';
        if (h.length > 60) h = h.slice(0, 60) + '…';
        parts.push('href="' + h + '"');
      }
      if (el.role) parts.push('role="' + el.role + '"');
      if (el.ariaLabel) parts.push('aria-label="' + el.ariaLabel + '"');
      if (el.value && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        var v = el.value;
        if (v.length > 40) v = v.slice(0, 40) + '…';
        parts.push('value="' + v + '"');
      }
      return parts.length ? ' ' + parts.join(' ') : '';
    }

    try {
      var els = document.querySelectorAll(${safeSelector});
      var lines = [];
      var nextId = 1;
      // Find highest existing agent ID to continue from
      var existing = document.querySelectorAll('[data-agent-id]');
      for (var i = 0; i < existing.length; i++) {
        var eid = parseInt(existing[i].getAttribute('data-agent-id'));
        if (eid >= nextId) nextId = eid + 1;
      }
      var count = 0;
      for (var j = 0; j < els.length && count < MAX_RESULTS; j++) {
        var el = els[j];
        var s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        var id = nextId++;
        el.setAttribute('data-agent-id', id);
        var tag = el.tagName.toLowerCase();
        var text = textOf(el);
        var attrs = attrStr(el);
        var isInteractive = INTERACTIVE.has(el.tagName) || el.onclick || el.getAttribute('role') === 'button';
        if (isInteractive) {
          lines.push('[' + id + '] <' + tag + attrs + '>' + (text ? ' "' + text + '"' : ''));
        } else {
          lines.push('[' + id + '] <' + tag + attrs + '>' + (text ? ' "' + text + '"' : ''));
        }
        count++;
      }
      return { elements: lines.join('\\n'), count: count };
    } catch (e) {
      return { error: 'Invalid selector: ' + e.message };
    }
  })()`;

  try {
    const result = await window.electronAPI.agentExecJs(wc, code);
    if (result.error) return { error: result.error };
    return result.result;
  } catch (e) {
    return { error: e.message };
  }
}

// ── Wait for selector to appear ──

async function agentWaitFor(tab, selector, timeoutMs) {
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const timeout = timeoutMs || 5000;
  const safeSelector = JSON.stringify(selector);
  const pollInterval = 200;
  const maxAttempts = Math.ceil(timeout / pollInterval);

  const checkCode = `(function() {
    var el = document.querySelector(${safeSelector});
    if (!el) return { found: false };
    var s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return { found: false };
    var text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (text.length > 200) text = text.slice(0, 200) + '…';
    return { found: true, text: text, tag: el.tagName.toLowerCase() };
  })()`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await window.electronAPI.agentExecJs(wc, checkCode);
      if (result.result && result.result.found) {
        return result.result;
      }
    } catch (e) {
      return { error: e.message };
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  return { found: false, timeout: true };
}

// ── Get current URL and title ──

async function agentGetUrl(tab) {
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const code = `({ url: location.href, title: document.title })`;

  try {
    const result = await window.electronAPI.agentExecJs(wc, code);
    if (result.error) return { error: result.error };
    return result.result;
  } catch (e) {
    return { error: e.message };
  }
}

// ── Get all open tabs ──

function agentGetTabs() {
  if (typeof _browseTabs === 'undefined') return { error: 'browse not initialized' };
  const tabs = _browseTabs.map(t => ({
    id: t.id,
    title: t.title || '',
    url: t.url || '',
    active: t.id === _browseActiveTab,
  }));
  return { tabs };
}

// ── Switch to a tab ──

function agentSwitchTab(tabId) {
  if (typeof _browseTabs === 'undefined') return { error: 'browse not initialized' };
  const tab = _browseTabs.find(t => t.id === tabId);
  if (!tab) return { error: 'tab not found: ' + tabId };
  if (typeof browseSelectTab === 'function') browseSelectTab(tabId);
  return { ok: true, url: tab.url || '', title: tab.title || '' };
}

// ── Navigate back ──

function agentBack() {
  if (typeof browseBack === 'function') browseBack();
  const tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
  return { ok: true, url: tab ? tab.url : '', title: tab ? tab.title : '' };
}

// ── Navigate forward ──

function agentForward() {
  if (typeof browseForward === 'function') browseForward();
  const tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
  return { ok: true, url: tab ? tab.url : '', title: tab ? tab.title : '' };
}

// ── Press a keyboard key ──

async function agentPressKey(tab, key, modifiers, elementId) {
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const safeKey = JSON.stringify(key);
  const safeMods = JSON.stringify(modifiers || []);
  const code = `(function() {
    var target = ${elementId ? 'document.querySelector(\'[data-agent-id="' + elementId + '"]\')' : 'document.activeElement'} || document.body;
    if (${!!elementId} && !target) return { error: 'element not found: ${elementId || ""}' };
    if (${!!elementId}) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.focus(); }
    var mods = ${safeMods};
    var opts = {
      key: ${safeKey},
      code: ${safeKey},
      bubbles: true,
      cancelable: true,
      ctrlKey: mods.indexOf('ctrl') !== -1,
      shiftKey: mods.indexOf('shift') !== -1,
      altKey: mods.indexOf('alt') !== -1,
      metaKey: mods.indexOf('meta') !== -1,
    };
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keypress', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
    // For Enter on forms, try to submit
    if (${safeKey} === 'Enter' && target.form) target.form.requestSubmit ? target.form.requestSubmit() : target.form.submit();
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

// ── Read page storage (cookies, localStorage, sessionStorage) ──

async function agentGetStorage(tab, storageType, keyFilter) {
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const safeType = JSON.stringify(storageType);
  const safeFilter = JSON.stringify(keyFilter || '');
  const code = `(function() {
    var type = ${safeType};
    var filter = ${safeFilter};
    var MAX_ENTRIES = 50;
    var MAX_VALUE_LEN = 200;
    var entries = [];

    if (type === 'cookies') {
      var pairs = document.cookie.split(';');
      for (var i = 0; i < pairs.length && entries.length < MAX_ENTRIES; i++) {
        var p = pairs[i].trim();
        if (!p) continue;
        var eq = p.indexOf('=');
        var k = eq === -1 ? p : p.slice(0, eq);
        var v = eq === -1 ? '' : p.slice(eq + 1);
        if (filter && k.indexOf(filter) === -1) continue;
        if (v.length > MAX_VALUE_LEN) v = v.slice(0, MAX_VALUE_LEN) + '…';
        entries.push({ key: k, value: v });
      }
    } else {
      var store = type === 'localStorage' ? localStorage : sessionStorage;
      for (var j = 0; j < store.length && entries.length < MAX_ENTRIES; j++) {
        var key = store.key(j);
        if (filter && key.indexOf(filter) === -1) continue;
        var val = store.getItem(key) || '';
        if (val.length > MAX_VALUE_LEN) val = val.slice(0, MAX_VALUE_LEN) + '…';
        entries.push({ key: key, value: val });
      }
    }
    return { type: type, count: entries.length, entries: entries };
  })()`;

  try {
    const result = await window.electronAPI.agentExecJs(wc, code);
    if (result.error) return { error: result.error };
    return result.result;
  } catch (e) {
    return { error: e.message };
  }
}
