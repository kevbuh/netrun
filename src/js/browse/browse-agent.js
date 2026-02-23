import { browseBack, browseForward } from '/js/toolbar/toolbar-nav.js';
import { browseSelectTab } from '/js/browse/browse-passwords.js';
/* browse-agent.js — Browser automation primitives for agentic control.
   Provides DOM extraction (accessible tree), click, type, scroll actions.
   Elements are tagged with data-agent-id attributes directly in the webview DOM. */

/* global _browseTabs, _browseActiveTab */

// ── DOM extraction: build compressed accessible tree ──

export async function agentGetAccessibleDOM(tab) {
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const code = `(function() {
    // Clear previous agent IDs
    document.querySelectorAll('[data-agent-id]').forEach(el => el.removeAttribute('data-agent-id'));

    const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY']);
    const TEXT_BLOCKS = new Set(['H1','H2','H3','H4','H5','H6','P','LI','TD','TH','LABEL','SPAN','FIGCAPTION']);
    const BASE_CAP = 300;
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
      return (el.textContent || '').trim().replace(/\\s+/g, ' ');
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

// ── Semantic DOM extraction: build component tree ──

export async function agentGetSemanticDOM(tab) {
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const code = `(function() {
    // Clear previous agent IDs
    document.querySelectorAll('[data-agent-id]').forEach(function(el) { el.removeAttribute('data-agent-id'); });

    var VIEWPORT_BUFFER = 200;
    var MAX_DEPTH = 8;
    var MAX_NODES = 500;
    var vpTop = window.scrollY - VIEWPORT_BUFFER;
    var vpBottom = window.scrollY + window.innerHeight + VIEWPORT_BUFFER;
    var nodeCount = 0;

    function isVisible(el) {
      if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') return false;
      var s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      var elTop = r.top + window.scrollY;
      var elBottom = r.bottom + window.scrollY;
      if (elBottom < vpTop || elTop > vpBottom) return false;
      return true;
    }

    function textOf(el) {
      // Direct text only (not from children)
      var text = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) text += el.childNodes[i].textContent;
      }
      return text.trim().replace(/\\s+/g, ' ');
    }

    function deepText(el) {
      return (el.textContent || '').trim().replace(/\\s+/g, ' ');
    }

    function truncate(s, max) {
      if (!s) return '';
      if (s.length > (max || 60)) return s.slice(0, max || 60) + '…';
      return s;
    }

    // ── Semantic type inference ──
    var TAG_MAP = {
      NAV: 'Nav', HEADER: 'Header', MAIN: 'Main', ASIDE: 'Sidebar',
      FOOTER: 'Footer', FORM: 'Form', TABLE: 'Table', DETAILS: 'Disclosure',
      UL: 'List', OL: 'List', VIDEO: 'Video'
    };
    var ROLE_MAP = {
      navigation: 'Nav', banner: 'Header', main: 'Main', complementary: 'Sidebar',
      contentinfo: 'Footer', dialog: 'Dialog', alertdialog: 'Dialog',
      tablist: 'TabView', menu: 'Menu', menubar: 'Menu'
    };
    var HEADING_TAGS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
    var INTERACTIVE_TYPES = new Set(['Button', 'Link', 'TextField', 'Checkbox', 'Radio', 'Slider', 'Picker', 'Textarea', 'Disclosure']);

    function inferType(el) {
      var tag = el.tagName;
      var role = el.getAttribute('role');

      // ARIA role takes priority
      if (role && ROLE_MAP[role]) return { type: ROLE_MAP[role] };

      // Buttons
      if (tag === 'BUTTON' || role === 'button') return { type: 'Button' };
      if (tag === 'INPUT' && el.type === 'submit') return { type: 'Button' };

      // Links
      if (tag === 'A' && el.hasAttribute('href')) return { type: 'Link' };

      // Input types
      if (tag === 'INPUT') {
        var it = (el.type || 'text').toLowerCase();
        if (it === 'checkbox') return { type: 'Checkbox' };
        if (it === 'radio') return { type: 'Radio' };
        if (it === 'range') return { type: 'Slider' };
        if (it === 'password') return { type: 'TextField', secure: true };
        if (it === 'hidden') return { type: null };
        return { type: 'TextField' };
      }
      if (tag === 'SELECT') return { type: 'Picker' };
      if (tag === 'TEXTAREA') return { type: 'Textarea' };

      // Headings
      if (HEADING_TAGS[tag]) return { type: 'Heading', level: HEADING_TAGS[tag] };

      // Landmark tags
      if (TAG_MAP[tag]) return { type: TAG_MAP[tag] };

      // Text elements
      if (tag === 'P' || tag === 'SPAN' || tag === 'LABEL' || tag === 'FIGCAPTION') {
        var t = deepText(el);
        if (t) return { type: 'Text' };
        return { type: null };
      }

      // Images
      if (tag === 'IMG') return { type: 'Image' };

      // Clickable divs
      if (role === 'button' || el.getAttribute('tabindex') !== null && el.onclick) {
        return { type: 'Button' };
      }

      // Layout inference via CSS
      if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
        try {
          var cs = getComputedStyle(el);
          if (cs.display === 'grid') return { type: 'Grid' };
          if (cs.display === 'flex') {
            return { type: cs.flexDirection === 'row' || cs.flexDirection === 'row-reverse' ? 'HStack' : 'VStack' };
          }
        } catch(e) {}
      }

      if (tag === 'ARTICLE') return { type: 'Group' };

      return { type: null };
    }

    // ── Build tree recursively ──
    var nextId = 1;

    function buildNode(el, depth) {
      if (nodeCount >= MAX_NODES) return null;
      if (depth > MAX_DEPTH) return null;
      if (!isVisible(el)) return null;

      var info = inferType(el);
      var semType = info.type;
      var children = [];

      // Process child elements
      var childEls = el.children;
      for (var i = 0; i < childEls.length; i++) {
        var childNode = buildNode(childEls[i], depth + 1);
        if (childNode) children.push(childNode);
      }

      // Collapse single-child wrapper divs with no semantic meaning
      if (!semType && children.length === 1 && !textOf(el)) {
        return children[0];
      }

      // Skip invisible/empty leaf divs
      if (!semType && children.length === 0) {
        var ownText = textOf(el);
        if (!ownText) return null;
        // Promote text-bearing anonymous nodes to Text
        semType = 'Text';
      }

      // Default remaining multi-child containers to Group
      if (!semType && children.length > 1) {
        semType = 'Group';
      }
      if (!semType) semType = 'Group';

      nodeCount++;
      var node = { type: semType, el: el, children: children, info: info };
      return node;
    }

    // ── Format tree as indented string ──
    function formatAttrs(node) {
      var el = node.el;
      var t = node.type;
      var parts = [];
      var isInteractive = INTERACTIVE_TYPES.has(t);

      if (t === 'TextField') {
        if (el.placeholder) parts.push('placeholder="' + truncate(el.placeholder, 40) + '"');
        var inputType = el.type || 'text';
        if (inputType !== 'text') parts.push('type=' + inputType);
        if (node.info.secure) parts.push('secure');
        if (el.value) parts.push('value="' + truncate(el.value, 40) + '"');
        if (el.disabled) parts.push('disabled');
      } else if (t === 'Button') {
        var label = deepText(el);
        if (label) parts.push('"' + truncate(label, 50) + '"');
        if (el.disabled) parts.push('disabled');
      } else if (t === 'Link') {
        var linkText = deepText(el);
        if (linkText) parts.push('"' + truncate(linkText, 50) + '"');
        var href = el.getAttribute('href') || '';
        if (href) parts.push('href="' + truncate(href, 60) + '"');
      } else if (t === 'Checkbox' || t === 'Toggle') {
        var lbl = el.getAttribute('aria-label') || textOf(el);
        if (lbl) parts.push('label="' + truncate(lbl, 40) + '"');
        var inp = el.querySelector('input') || el;
        parts.push('checked=' + !!inp.checked);
      } else if (t === 'Radio') {
        var radioLabel = el.getAttribute('aria-label') || '';
        if (radioLabel) parts.push('label="' + truncate(radioLabel, 40) + '"');
        parts.push('checked=' + !!el.checked);
      } else if (t === 'Slider') {
        if (el.min) parts.push('min=' + el.min);
        if (el.max) parts.push('max=' + el.max);
        parts.push('value=' + (el.value || 0));
      } else if (t === 'Picker') {
        if (el.value) parts.push('value="' + truncate(el.value, 30) + '"');
        parts.push('options=' + el.options.length);
      } else if (t === 'Image') {
        if (el.alt) parts.push('alt="' + truncate(el.alt, 40) + '"');
        if (el.src) parts.push('src="' + truncate(el.src, 50) + '"');
      } else if (t === 'Heading') {
        parts.push('(' + (node.info.level || 1) + ')');
        var hText = deepText(el);
        if (hText) parts.push('"' + truncate(hText, 60) + '"');
      } else if (t === 'Text') {
        var tText = deepText(el);
        if (tText) parts.push('"' + truncate(tText, 80) + '"');
      } else if (t === 'Form') {
        var formLabel = el.getAttribute('aria-label');
        if (!formLabel) {
          var fh = el.querySelector('h1,h2,h3,h4,h5,h6');
          if (fh) formLabel = deepText(fh);
        }
        if (formLabel) parts.push('"' + truncate(formLabel, 50) + '"');
      } else if (t === 'Dialog') {
        var dlgLabel = el.getAttribute('aria-label');
        if (!dlgLabel) {
          var dh = el.querySelector('[class*=title],h1,h2,h3');
          if (dh) dlgLabel = deepText(dh);
        }
        if (dlgLabel) parts.push('"' + truncate(dlgLabel, 50) + '"');
      } else if (t === 'Disclosure') {
        var summary = el.querySelector('summary');
        if (summary) parts.push('"' + truncate(deepText(summary), 50) + '"');
        parts.push(el.open ? 'open' : 'closed');
      } else if (t === 'Textarea') {
        if (el.placeholder) parts.push('placeholder="' + truncate(el.placeholder, 40) + '"');
        if (el.value) parts.push('value="' + truncate(el.value, 40) + '"');
        if (el.disabled) parts.push('disabled');
      }

      return parts.length ? ' ' + parts.join(' ') : '';
    }

    function renderTree(node, depth, lines) {
      var indent = '';
      for (var d = 0; d < depth; d++) indent += '  ';
      var t = node.type;
      var isInteractive = INTERACTIVE_TYPES.has(t);

      // Assign ID only to interactive elements
      if (isInteractive) {
        var id = nextId++;
        node.el.setAttribute('data-agent-id', id);
        lines.push(indent + '[' + id + '] ' + t + formatAttrs(node));
      } else {
        // Skip rendering certain layout-only types that add noise
        if (t === 'Group' && node.children.length <= 1) {
          // Collapse trivial groups — render children at same depth
          for (var g = 0; g < node.children.length; g++) {
            renderTree(node.children[g], depth, lines);
          }
          return;
        }
        lines.push(indent + t + formatAttrs(node));
      }

      // Render children
      for (var i = 0; i < node.children.length; i++) {
        renderTree(node.children[i], depth + 1, lines);
      }
    }

    // ── Execute ──
    var root = buildNode(document.body, 0);
    if (!root) return { elements: '', url: location.href, title: document.title, elementCount: 0 };

    var lines = [];
    // Render from root's children (skip the body node itself)
    if (root.children && root.children.length > 0) {
      for (var i = 0; i < root.children.length; i++) {
        renderTree(root.children[i], 0, lines);
      }
    } else {
      renderTree(root, 0, lines);
    }

    var viewportMeta = 'VIEWPORT: scrollY=' + Math.round(window.scrollY) + ', pageHeight=' + document.documentElement.scrollHeight + ', viewportHeight=' + window.innerHeight;
    return {
      elements: viewportMeta + '\\n' + lines.join('\\n'),
      url: location.href,
      title: document.title,
      elementCount: nextId - 1
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

export async function agentClick(tab, elementId) {
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

export async function agentType(tab, elementId, text) {
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

export async function agentScroll(tab, direction) {
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

export async function agentScreenshot(tab) {
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

export async function agentQuerySelector(tab, selector, maxResults) {
  if (!tab || !tab.el) return { error: 'no active tab' };
  const wc = tab.el.getWebContentsId?.();
  if (!wc) return { error: 'no webContentsId' };

  const safeSelector = JSON.stringify(selector);
  const limit = maxResults || 20;
  const code = `(function() {
    var MAX_RESULTS = ${limit};
    var INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY']);

    function textOf(el) {
      return (el.textContent || '').trim().replace(/\\s+/g, ' ');
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

export async function agentWaitFor(tab, selector, timeoutMs) {
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

export async function agentGetUrl(tab) {
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

export function agentGetTabs() {
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

export function agentSwitchTab(tabId) {
  if (typeof _browseTabs === 'undefined') return { error: 'browse not initialized' };
  const tab = _browseTabs.find(t => t.id === tabId);
  if (!tab) return { error: 'tab not found: ' + tabId };
  if (typeof browseSelectTab === 'function') browseSelectTab(tabId);
  return { ok: true, url: tab.url || '', title: tab.title || '' };
}

// ── Navigate back ──

export function agentBack() {
  if (typeof browseBack === 'function') browseBack();
  const tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
  return { ok: true, url: tab ? tab.url : '', title: tab ? tab.title : '' };
}

// ── Navigate forward ──

export function agentForward() {
  if (typeof browseForward === 'function') browseForward();
  const tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
  return { ok: true, url: tab ? tab.url : '', title: tab ? tab.title : '' };
}

// ── Press a keyboard key ──

export async function agentPressKey(tab, key, modifiers, elementId) {
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

export async function agentGetStorage(tab, storageType, keyFilter) {
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

