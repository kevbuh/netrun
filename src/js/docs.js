// docs.js — AetherUI auto-generated documentation view
// Parses AetherUI source files at runtime and renders docs using AetherUI itself.

import { hideAllViews, ensureView } from '/js/core/core-views.js';
import { setSidebarActive } from '/js/core/core-layout.js';
import { _HELP_DATA } from '/js/settings/settings-helpers.js';

// ── Source file manifest ──
const SOURCE_FILES = [
  { path: '/aether/ui/state.js',      category: 'State' },
  { path: '/aether/ui/view.js',       category: 'Modifiers' },
  { path: '/aether/ui/primitives.js',  category: null }, // split into Layout + Text & Media
  { path: '/aether/ui/controls.js',    category: 'Controls' },
  { path: '/aether/ui/containers.js',  category: 'Containers' },
  { path: '/aether/ui/overlay.js',     category: 'Overlays' },
  { path: '/aether/ui/component.js',   category: 'Component' },
  { path: '/aether/ui/aether-ui.js',   category: 'Mount' },
];

// Items in these categories from primitives.js
const LAYOUT_NAMES = new Set(['VStack','HStack','ZStack','Grid','Spacer','Divider','ScrollView']);
const TEXT_MEDIA_NAMES = new Set(['Text','Label','Link','Image','Icon','RawHTML']);

// ── Parser ──

let _parsedData = null; // cached parse result

async function _fetchSource(file) {
  try {
    const resp = await fetch(file.path);
    return await resp.text();
  } catch { return ''; }
}

function _parseFile(source, file) {
  const items = [];

  // Extract file header comment
  const headerMatch = source.match(/^\/\*([^]*?)\*\//);
  const headerComment = headerMatch ? headerMatch[1].trim().replace(/^\s*\*\s?/gm, '').trim() : '';

  // Find section headers: // ─── Name ───
  // and constructor functions: function Name(params) {
  // Build component entries

  const lines = source.split('\n');
  let currentSection = null;
  let currentItem = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Section header
    const sectionMatch = line.match(/\/\/\s*───\s*(\S.*?\S)\s*─/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].replace(/\s*─+$/, '').trim();
      continue;
    }

    // Exported/top-level constructor: function Name(params) {
    // Skip private helpers (leading underscore or lowercase)
    const fnMatch = line.match(/^function\s+([A-Z]\w*)\s*\(([^)]*)\)\s*\{/);
    if (fnMatch) {
      const name = fnMatch[1];
      const params = fnMatch[2].trim();
      // Skip internal helpers like _extend, _makeStack
      if (name.startsWith('_')) continue;

      currentItem = {
        name,
        params,
        section: currentSection,
        methods: [],
        file: file.path,
        description: '',
      };
      items.push(currentItem);

      // Scan ahead for description comment on the previous few lines
      for (let j = Math.max(0, i - 3); j < i; j++) {
        const prevLine = lines[j].trim();
        if (prevLine.startsWith('//') && !prevLine.match(/^\/\/\s*─/)) {
          currentItem.description = prevLine.replace(/^\/\/\s*/, '');
        }
      }
      continue;
    }

    // Instance methods: v.name = function(params) or v.name = function() {
    if (currentItem) {
      const methodMatch = line.match(/\bv\.(\w+)\s*=\s*function\s*\(([^)]*)\)/);
      if (methodMatch) {
        const mName = methodMatch[1];
        const mParams = methodMatch[2].trim();
        // Skip private methods
        if (!mName.startsWith('_')) {
          currentItem.methods.push({ name: mName, params: mParams });
        }
        continue;
      }
    }

    // Prototype methods: VP.name = function(params) or View.prototype.name = function(params)
    const protoMatch = line.match(/(?:VP|View\.prototype)\.(\w+)\s*=\s*function\s*\(([^)]*)\)/);
    if (protoMatch) {
      const mName = protoMatch[1];
      const mParams = protoMatch[2].trim();
      if (!mName.startsWith('_')) {
        items.push({
          name: mName,
          params: mParams,
          section: currentSection,
          methods: [],
          file: file.path,
          description: '',
          isModifier: true,
        });
      }
    }
  }

  return { items, headerComment };
}

function _categorize(items, file) {
  return items.map(item => {
    if (item.isModifier) {
      return { ...item, category: 'Modifiers' };
    }
    if (file.category) {
      return { ...item, category: file.category };
    }
    // primitives.js: split by name
    if (LAYOUT_NAMES.has(item.name)) return { ...item, category: 'Layout' };
    if (TEXT_MEDIA_NAMES.has(item.name)) return { ...item, category: 'Text & Media' };
    return { ...item, category: 'Layout' };
  });
}

async function parseAll() {
  if (_parsedData) return _parsedData;

  const sources = await Promise.all(SOURCE_FILES.map(f => _fetchSource(f)));
  const allItems = [];
  const fileDescriptions = {};

  for (let i = 0; i < SOURCE_FILES.length; i++) {
    const file = SOURCE_FILES[i];
    const { items, headerComment } = _parseFile(sources[i], file);
    fileDescriptions[file.path] = headerComment;
    const categorized = _categorize(items, file);
    allItems.push(...categorized);
  }

  // Deduplicate modifiers (group them, don't list as individual cards)
  const modifiers = allItems.filter(it => it.isModifier);
  const components = allItems.filter(it => !it.isModifier);

  // Group by category
  const CATEGORY_ORDER = ['State','Layout','Text & Media','Controls','Containers','Overlays','Component','Mount','Modifiers','Help'];
  const byCategory = {};
  for (const cat of CATEGORY_ORDER) byCategory[cat] = [];
  for (const item of components) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }

  _parsedData = { components, modifiers, byCategory, fileDescriptions, categoryOrder: CATEGORY_ORDER };
  return _parsedData;
}

// ── Live Preview Builders ──

const PREVIEWS = {
  VStack() {
    return VStack(
      Text('Item 1').font('body'),
      Text('Item 2').font('body'),
      Text('Item 3').font('body')
    ).spacing(2).padding(3);
  },
  HStack() {
    return HStack(
      Text('Left').font('body'),
      Spacer(),
      Text('Right').font('body')
    ).padding(3);
  },
  ZStack() {
    return ZStack(
      Text('Behind').font('body').foregroundColor('quaternary'),
      Text('Front').font('headline')
    ).padding(3).frame({ height: 60 });
  },
  Text() {
    return VStack(
      Text('Large Title').font('largeTitle'),
      Text('Headline').font('headline'),
      Text('Body text').font('body'),
      Text('Caption').font('caption1').foregroundColor('tertiary')
    ).spacing(2).padding(3);
  },
  Button() {
    return HStack(
      Button('Primary'),
      Button('Secondary').secondary(),
      Button('Ghost').ghost(),
      Button('Danger').danger()
    ).spacing(2).padding(3);
  },
  TextField() {
    return VStack(
      TextField('Enter text...'),
      TextField('Disabled').disabled(true)
    ).spacing(2).padding(3).frame({ maxWidth: 300 });
  },
  Toggle() {
    const s = State(true);
    return HStack(
      Toggle(s.binding(), 'Enabled'),
    ).padding(3);
  },
  Slider() {
    const s = State(50);
    return VStack(
      Slider(s.binding(), 0, 100),
    ).padding(3).frame({ maxWidth: 300 });
  },
  Picker() {
    const s = State('a');
    return Picker(s.binding(), [
      { value: 'a', label: 'Option A' },
      { value: 'b', label: 'Option B' },
      { value: 'c', label: 'Option C' },
    ]).padding(3);
  },
  Divider() {
    return VStack(
      Text('Above').font('body'),
      Divider(),
      Text('Below').font('body')
    ).spacing(2).padding(3);
  },
  Spacer() {
    return HStack(
      Text('Left').font('body'),
      Spacer(),
      Text('Right').font('body')
    ).padding(3).background('sunken').cornerRadius('md');
  },
  ForEach() {
    const items = State(['Apple', 'Banana', 'Cherry']);
    return VStack(
      ForEach(items, (item) => Text(item).font('body'))
    ).spacing(1).padding(3);
  },
  Section() {
    return Section('Settings',
      Text('Content goes here').font('body')
    ).padding(3);
  },
  Grid() {
    return Grid(
      Text('1').padding(2).background('surface').cornerRadius('sm'),
      Text('2').padding(2).background('surface').cornerRadius('sm'),
      Text('3').padding(2).background('surface').cornerRadius('sm'),
      Text('4').padding(2).background('surface').cornerRadius('sm'),
    ).padding(3);
  },
};

// ── Renderer ──

let _activeNavItem = null;
let _searchQuery = '';
let _rootView = null;

function _buildSidebar(data) {
  const sidebar = VStack().className('docs-sidebar');

  // Search
  const searchWrap = document.createElement('div');
  searchWrap.className = 'docs-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search docs...';
  searchInput.value = _searchQuery;
  searchInput.addEventListener('input', () => {
    _searchQuery = searchInput.value;
    _renderContent(data);
  });
  searchWrap.appendChild(searchInput);
  sidebar.el.appendChild(searchWrap);

  // Nav items
  for (const cat of data.categoryOrder) {
    const items = data.byCategory[cat];
    if (!items || items.length === 0) {
      // Still show Modifiers category
      if (cat !== 'Modifiers') continue;
    }

    const catEl = document.createElement('div');
    catEl.className = 'docs-nav-category';
    catEl.textContent = cat;
    sidebar.el.appendChild(catEl);

    if (cat === 'Modifiers') {
      const navItem = document.createElement('div');
      navItem.className = 'docs-nav-item';
      navItem.textContent = 'View Modifiers (' + data.modifiers.length + ')';
      navItem.addEventListener('click', () => {
        _setActiveNav(navItem, 'modifiers');
        _scrollToItem('modifiers');
      });
      sidebar.el.appendChild(navItem);
      continue;
    }

    if (cat === 'Help') {
      for (const sec of _HELP_SECTIONS) {
        const navItem = document.createElement('div');
        navItem.className = 'docs-nav-item';
        navItem.textContent = sec.title;
        navItem.addEventListener('click', () => {
          _setActiveNav(navItem, 'help-' + sec.id);
          _scrollToItem('help-' + sec.id);
        });
        sidebar.el.appendChild(navItem);
      }
      continue;
    }

    for (const item of items) {
      const navItem = document.createElement('div');
      navItem.className = 'docs-nav-item';
      navItem.textContent = item.name;
      navItem.addEventListener('click', () => {
        _setActiveNav(navItem, item.name);
        _scrollToItem(item.name);
      });
      sidebar.el.appendChild(navItem);
    }
  }

  return sidebar;
}

function _setActiveNav(el, name) {
  if (_activeNavItem) _activeNavItem.classList.remove('active');
  _activeNavItem = el;
  if (el) el.classList.add('active');
}

function _scrollToItem(name) {
  const target = document.getElementById('docs-item-' + name);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function _matchesSearch(item) {
  if (!_searchQuery) return true;
  const q = _searchQuery.toLowerCase();
  if (item.name.toLowerCase().includes(q)) return true;
  if (item.category && item.category.toLowerCase().includes(q)) return true;
  if (item.params && item.params.toLowerCase().includes(q)) return true;
  if (item.methods) {
    for (const m of item.methods) {
      if (m.name.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

function _buildComponentCard(item) {
  const card = document.createElement('div');
  card.className = 'docs-card';
  card.id = 'docs-item-' + item.name;

  // Title
  const title = document.createElement('h2');
  title.className = 'docs-card-title';
  title.textContent = item.name;
  card.appendChild(title);

  // File path
  const fileEl = document.createElement('div');
  fileEl.className = 'docs-card-file';
  fileEl.textContent = item.file;
  card.appendChild(fileEl);

  // Description
  if (item.description) {
    const desc = document.createElement('div');
    desc.className = 'docs-card-desc';
    desc.textContent = item.description;
    card.appendChild(desc);
  }

  // Signature
  const sig = document.createElement('div');
  sig.className = 'docs-signature';
  sig.innerHTML = '<span class="sig-fn">' + item.name + '</span>(<span class="sig-param">' +
    _escapeHtml(item.params || '') + '</span>)';
  card.appendChild(sig);

  // Instance methods
  if (item.methods.length > 0) {
    const methodsTitle = document.createElement('div');
    methodsTitle.className = 'docs-methods-title';
    methodsTitle.textContent = 'Methods';
    card.appendChild(methodsTitle);

    for (const m of item.methods) {
      const mEl = document.createElement('div');
      mEl.className = 'docs-method';
      mEl.innerHTML = '<span class="docs-method-name">.' + m.name + '</span>' +
        '<span class="docs-method-params">(' + _escapeHtml(m.params) + ')</span>';
      card.appendChild(mEl);
    }
  }

  // Live preview
  if (PREVIEWS[item.name]) {
    try {
      const preview = document.createElement('div');
      preview.className = 'docs-preview';
      const header = document.createElement('div');
      header.className = 'docs-preview-header';
      header.textContent = 'Live Preview';
      preview.appendChild(header);
      const body = document.createElement('div');
      body.className = 'docs-preview-body';
      const view = PREVIEWS[item.name]();
      if (view instanceof View) {
        AetherUI.append(view, body);
        for (let k = 0; k < view._onAppearFns.length; k++) view._onAppearFns[k]();
      }
      preview.appendChild(body);
      card.appendChild(preview);
    } catch (e) {
      // Preview failed, skip it
    }
  }

  return card;
}

function _buildModifiersCard(modifiers) {
  const card = document.createElement('div');
  card.className = 'docs-card';
  card.id = 'docs-item-modifiers';

  const title = document.createElement('h2');
  title.className = 'docs-card-title';
  title.textContent = 'View Modifiers';
  card.appendChild(title);

  const fileEl = document.createElement('div');
  fileEl.className = 'docs-card-file';
  fileEl.textContent = '/aether/ui/view.js';
  card.appendChild(fileEl);

  const desc = document.createElement('div');
  desc.className = 'docs-card-desc';
  desc.textContent = 'Chainable modifiers available on all views. Returns this for chaining.';
  card.appendChild(desc);

  // Group modifiers by section
  const sections = {};
  for (const m of modifiers) {
    const sec = m.section || 'Other';
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(m);
  }

  for (const [sec, items] of Object.entries(sections)) {
    if (!_searchQuery || items.some(it => _matchesModifier(it))) {
      const secTitle = document.createElement('div');
      secTitle.className = 'docs-methods-title';
      secTitle.textContent = sec;
      secTitle.style.marginTop = '12px';
      card.appendChild(secTitle);

      const grid = document.createElement('div');
      grid.className = 'docs-modifier-grid';
      for (const m of items) {
        if (_searchQuery && !_matchesModifier(m)) continue;
        const mEl = document.createElement('div');
        mEl.className = 'docs-modifier-item';
        mEl.innerHTML = '<span class="docs-modifier-dot"></span>' +
          '<span class="docs-method-name">.' + m.name + '</span>' +
          '<span class="docs-method-params">(' + _escapeHtml(m.params) + ')</span>';
        grid.appendChild(mEl);
      }
      card.appendChild(grid);
    }
  }

  return card;
}

function _matchesModifier(m) {
  if (!_searchQuery) return true;
  const q = _searchQuery.toLowerCase();
  return m.name.toLowerCase().includes(q) || (m.params && m.params.toLowerCase().includes(q));
}

// ── Help Reference Sections ──

const _HELP_SECTIONS = [
  { id: 'routes', title: 'Special Routes', subtitle: 'Type these in the URL bar to open internal pages.', headers: ['URL', 'Page'], rows: [
    ['netrun://', 'Hub page \u2014 dashboard and quick links'],
    ['netrun://history', 'Browse and search history'],
    ['netrun://docs', 'This page \u2014 AetherUI API reference'],
    ['chat://', 'Chat threads view'],
    ['chat://<id>', 'Open a specific chat thread'],
    ['draw://', 'Drawing whiteboard'],
    ['ntp://', 'New tab page'],
  ]},
  { id: 'instant', title: 'Instant Answers', subtitle: 'Type in the URL bar \u2014 results appear inline as you type.', headers: ['Type', 'Try'], get rows() { return _HELP_DATA.instantAnswers; } },
  { id: 'search', title: 'Search Syntax', subtitle: 'Use these in the Papers search on new tab pages.', headers: ['Syntax', 'Effect'], mono: true, get rows() { return _HELP_DATA.searchSyntax; } },
  { id: 'bangs', title: 'Bangs', subtitle: 'Type ! followed by a shortcut and your query to search a specific site.', headers: ['Bang', 'Site'], mono: true, get rows() { return _HELP_DATA.getBangs(); } },
  { id: 'slash', title: 'Slash Commands', subtitle: 'Right-click \u2192 type / in the aether panel.', headers: ['Command', 'Action'], get rows() { return _HELP_DATA.slashCommands; } },
  { id: 'shortcuts', title: 'Keyboard Shortcuts', headers: ['Key', 'Action'], isShortcuts: true },
  { id: 'panel', title: 'Aether Panel', isPanel: true },
  { id: 'tools', title: 'Chat Tools', subtitle: 'When enabled, the chat assistant can use these tools autonomously.', headers: ['Tool', 'Description'], mono: true, get rows() { return _HELP_DATA.chatTools; } },
  { id: 'models', title: 'AI Models', subtitle: 'Local Ollama models. All optional \u2014 features degrade gracefully.', headers: ['Model', 'Used for'], mono: true, get rows() { return _HELP_DATA.aiModels; } },
];

function _buildHelpCard(sec) {
  const card = document.createElement('div');
  card.className = 'docs-card';
  card.id = 'docs-item-help-' + sec.id;

  const title = document.createElement('h2');
  title.className = 'docs-card-title';
  title.textContent = sec.title;
  card.appendChild(title);

  if (sec.subtitle) {
    const desc = document.createElement('div');
    desc.className = 'docs-card-desc';
    desc.textContent = sec.subtitle;
    card.appendChild(desc);
  }

  // Aether Panel — special content
  if (sec.isPanel) {
    const panelDesc = document.createElement('div');
    panelDesc.className = 'docs-card-desc';
    panelDesc.style.lineHeight = '1.7';
    panelDesc.innerHTML = '<strong>Right-click</strong> anywhere to open the panel.<br>Type to <strong>chat with AI</strong> about the current page.<br><strong>Select text</strong> \u2192 highlight, quote, or define.<br><strong>Drag</strong> while panel is open to capture a screenshot region.';
    card.appendChild(panelDesc);
    return card;
  }

  // Keyboard Shortcuts — special table with section headers and Kbd rendering
  if (sec.isShortcuts) {
    const table = document.createElement('table');
    table.className = 'nr-hub-table';
    table.style.width = '100%';
    const thead = document.createElement('tr');
    for (const h of ['Key', 'Action']) { const th = document.createElement('th'); th.className = 'nr-hub-th'; th.textContent = h; thead.appendChild(th); }
    table.appendChild(thead);

    for (const [key, val] of _HELP_DATA.shortcuts) {
      const tr = document.createElement('tr');
      tr.className = 'nr-hub-tr';
      if (!key) {
        const td = document.createElement('td'); td.colSpan = 2; td.style.cssText = 'padding:12px 12px 4px;'; td.innerHTML = val; tr.appendChild(td);
      } else {
        const tdKey = document.createElement('td'); tdKey.className = 'nr-hub-td-key';
        if (window.Kbd) { AetherUI.append(window.Kbd(key), tdKey); } else { const kbd = document.createElement('kbd'); kbd.className = 'nr-hub-kbd'; kbd.textContent = key; tdKey.appendChild(kbd); }
        tr.appendChild(tdKey);
        const tdVal = document.createElement('td'); tdVal.className = 'nr-hub-td-val'; tdVal.textContent = val; tr.appendChild(tdVal);
      }
      table.appendChild(tr);
    }
    card.appendChild(table);
    return card;
  }

  // Standard table section
  const rows = sec.rows;
  if (!rows || rows.length === 0) return null;

  const table = document.createElement('table');
  table.className = 'nr-hub-table';
  table.style.width = '100%';
  const thead = document.createElement('tr');
  for (const h of sec.headers) { const th = document.createElement('th'); th.className = 'nr-hub-th'; th.textContent = h; thead.appendChild(th); }
  table.appendChild(thead);

  for (const [key, val] of rows) {
    const tr = document.createElement('tr'); tr.className = 'nr-hub-tr';
    const tdKey = document.createElement('td'); tdKey.className = 'nr-hub-td-key';
    if (sec.mono) { const code = document.createElement('code'); code.style.fontSize = '0.8rem'; code.textContent = key; tdKey.appendChild(code); }
    else tdKey.textContent = key;
    tr.appendChild(tdKey);
    const tdVal = document.createElement('td'); tdVal.className = 'nr-hub-td-val'; tdVal.textContent = val; tr.appendChild(tdVal);
    table.appendChild(tr);
  }
  card.appendChild(table);
  return card;
}

function _matchesHelpSearch(sec) {
  if (!_searchQuery) return true;
  const q = _searchQuery.toLowerCase();
  if (sec.title.toLowerCase().includes(q)) return true;
  if (sec.subtitle && sec.subtitle.toLowerCase().includes(q)) return true;
  if (sec.rows) {
    for (const [key, val] of sec.rows) {
      if (key.toLowerCase().includes(q) || val.toLowerCase().includes(q)) return true;
    }
  }
  if (sec.isShortcuts) {
    for (const [key, val] of _HELP_DATA.shortcuts) {
      if ((key && key.toLowerCase().includes(q)) || val.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

function _renderContent(data) {
  const main = document.querySelector('.docs-main');
  if (!main) return;
  main.innerHTML = '';

  let hasResults = false;

  for (const cat of data.categoryOrder) {
    if (cat === 'Modifiers') {
      const filtered = data.modifiers.filter(m => _matchesModifier(m));
      if (filtered.length > 0 || !_searchQuery) {
        main.appendChild(_buildModifiersCard(_searchQuery ? filtered : data.modifiers));
        hasResults = true;
      }
      continue;
    }

    if (cat === 'Help') {
      for (const sec of _HELP_SECTIONS) {
        if (!_matchesHelpSearch(sec)) continue;
        const card = _buildHelpCard(sec);
        if (card) { main.appendChild(card); hasResults = true; }
      }
      continue;
    }

    const items = (data.byCategory[cat] || []).filter(it => _matchesSearch(it));
    if (items.length === 0) continue;
    hasResults = true;

    for (const item of items) {
      main.appendChild(_buildComponentCard(item));
    }
  }

  if (!hasResults) {
    const empty = document.createElement('div');
    empty.className = 'docs-empty';
    empty.textContent = 'No results for "' + _searchQuery + '"';
    main.appendChild(empty);
  }
}

function _escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── View opener ──

let _docsRendered = false;

export async function openDocs() {
  hideAllViews();
  const view = await ensureView('docs-view');
  view.classList.add('active');
  view.style.display = 'block';
  if (window.location.hash !== '#docs') window.location.hash = '#docs';
  setSidebarActive(null);
  renderDocs();
}

async function renderDocs() {
  const container = document.getElementById('docs-content');
  if (!container) return;

  // Force re-parse to pick up source changes on reload
  _parsedData = null;
  const data = await parseAll();

  container.innerHTML = '';

  // Sidebar
  const sidebar = _buildSidebar(data);
  AetherUI.append(sidebar, container);

  // Main content area
  const main = document.createElement('div');
  main.className = 'docs-main';
  container.appendChild(main);

  _renderContent(data);
  _docsRendered = true;
}

// Expose for window manager
window.openDocs = openDocs;
