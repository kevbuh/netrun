// netrun-page.js — netrun:// hub page
// Replaces the old openHelpPage with a polished hub + help reference

import { _HELP_DATA } from '/js/settings/settings-helpers.js';
import { _browseSetUrlDisplay } from '/js/browse-urlbar.js';
import { _browseRenderTabs, browseNavigate } from '/js/browse/browse-island.js';
import { _browseUpdateNewTabPage, browseSelectTab } from '/js/browse/browse-passwords.js';
import { browseSelectWindow, openBrowse } from '/js/browse/browse-windows.js';
import { _browseWindows, getBrowseActiveWindow } from '/js/browse/browse-state.js';
import { wmOpen } from '/js/core/core-views.js';
import { getSavedPosts } from '/js/feed.js';
import { apiGet } from '/js/api.js';
import { initNetrunner } from '/js/netrunner-game.js';

// ─── Open / reuse the netrun:// tab ─────────────────────────

export function openNetrunPage() {
  openBrowse();

  // Reuse existing netrun tab
  for (const w of _browseWindows) {
    const existing = w.tabs.find(t => t._netrunPage);
    if (existing) {
      if (w.id !== getBrowseActiveWindow()) browseSelectWindow(w.id);
      browseSelectTab(existing.id);
      return;
    }
  }

  const win = _browseWindows.find(w => w.id === getBrowseActiveWindow());
  if (!win) return;
  const tab = win.tabs.find(t => t.id === win.activeTab);
  if (!tab) return;

  tab.blank = false;
  tab.url = 'netrun://';
  tab.title = 'Netrun';
  tab.favicon = '';
  tab._netrunPage = true;

  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-netrun-' + tab.id;
  el.className = 'nr-hub-scroll';
  el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;';
  container.appendChild(el);
  tab.el = el;

  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, 'netrun://');

  _renderNetrunPage(tab.el);
}

// ─── Render the hub page into an element ─────────────────────

export function _renderNetrunPage(el) {
  if (!el) return;
  el.innerHTML = '';
  el.className = 'nr-hub-scroll';

  const content = document.createElement('div');
  content.className = 'nr-hub-content';

  // Hero
  content.appendChild(_buildHero());

  // Feature cards
  content.appendChild(_buildFeatureCards());

  // Dashboard strip (async — renders in-place when data loads)
  const dashSlot = document.createElement('div');
  content.appendChild(dashSlot);
  _buildDashboardStrip(dashSlot);

  // Special routes
  content.appendChild(_buildRoutes());

  // Help sections
  _buildHelpSections(content);

  el.appendChild(content);

  // Easter egg: Konami code starts the netrunner game
  initNetrunner();
}

// ─── Hero ────────────────────────────────────────────────────

function _buildHero() {
  const hero = document.createElement('div');
  hero.className = 'nr-hub-hero';

  // Fingerprint logo
  const logo = document.createElement('div');
  logo.className = 'nr-hub-hero-logo';
  logo.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22 2 2 0 1 1 3.16 2.44"/></svg>';
  hero.appendChild(logo);

  const title = document.createElement('div');
  title.className = 'nr-hub-hero-title';
  title.textContent = 'netrun';
  hero.appendChild(title);

  const tagline = document.createElement('div');
  tagline.className = 'nr-hub-hero-tagline';
  tagline.textContent = 'Browse, read, chat, draw.';
  hero.appendChild(tagline);

  const version = document.createElement('div');
  version.className = 'nr-hub-hero-version';
  version.textContent = 'v' + (window.electronAPI?.getVersion?.() || '0');
  hero.appendChild(version);

  return hero;
}

// ─── Feature Cards ───────────────────────────────────────────

const _FEATURES = [
  { icon: 'globe',      title: 'Browse',    desc: 'Web browser with ad blocking, split tabs, and bangs.', action: () => browseNavigate('ntp://') },
  { icon: 'chatBubble', title: 'Chat',      desc: 'AI assistant with tools. Search, fetch, navigate.',    action: () => browseNavigate('chat://') },
  { icon: 'edit',       title: 'Draw',      desc: 'Whiteboard with pen, shapes, text.',                   action: () => browseNavigate('draw://') },
  { icon: 'feed',       title: 'Feed',      desc: '125+ sources. arXiv, HN, RSS, and more.',              action: () => wmOpen('feed') },
  { icon: 'home',       title: 'Dashboard', desc: 'Reading list, calendar, quick actions.',                action: () => wmOpen('dashboard') },
  { icon: 'clock',      title: 'History',   desc: 'Browse and search history.',                            action: () => browseNavigate('netrun://history') },
];

function _buildFeatureCards() {
  const grid = document.createElement('div');
  grid.className = 'nr-hub-cards';

  for (const f of _FEATURES) {
    const card = document.createElement('div');
    card.className = 'nr-hub-card';
    card.addEventListener('click', f.action);

    const iconEl = document.createElement('div');
    iconEl.className = 'nr-hub-card-icon';
    iconEl.innerHTML = icon(f.icon, { size: 24 });
    card.appendChild(iconEl);

    const text = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'nr-hub-card-title';
    titleEl.textContent = f.title;
    text.appendChild(titleEl);

    const descEl = document.createElement('div');
    descEl.className = 'nr-hub-card-desc';
    descEl.textContent = f.desc;
    text.appendChild(descEl);

    card.appendChild(text);
    grid.appendChild(card);
  }

  return grid;
}

// ─── Dashboard Strip (compact) ───────────────────────────────

async function _buildDashboardStrip(slot) {
  // Gather data in parallel
  const saved = getSavedPosts();
  const calPromise = apiGet('/api/calendar').catch(() => []);

  // Activity counts from settings
  const searchHist = window.Settings?.getJSON('searchHistory', []) || [];
  const webHist = window.Settings?.getJSON('webSearchHistory', []) || [];

  const todayStr = new Date().toISOString().slice(0, 10);
  const todaySearches = searchHist.filter(e => e?.ts && new Date(e.ts).toISOString().slice(0, 10) === todayStr).length
    + webHist.filter(e => e?.ts && new Date(e.ts).toISOString().slice(0, 10) === todayStr).length;
  const savedEntries = Object.values(saved);
  const savedCount = savedEntries.length;

  // Wait for calendar
  const events = (await calPromise) || [];
  const todayEvents = events.filter(e => e.date === todayStr);

  // Nothing to show?
  if (savedCount === 0 && todayEvents.length === 0 && todaySearches === 0) return;

  const wrap = document.createElement('div');
  wrap.className = 'nr-hub-dash';

  // ── Today header ──
  const header = document.createElement('div');
  header.className = 'nr-hub-dash-header';

  const dateEl = document.createElement('div');
  dateEl.className = 'nr-hub-dash-date';
  dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  dateEl.addEventListener('click', () => wmOpen('dashboard'));
  header.appendChild(dateEl);

  if (todaySearches > 0) {
    const chip = document.createElement('span');
    chip.className = 'nr-hub-dash-chip';
    chip.textContent = todaySearches + ' search' + (todaySearches === 1 ? '' : 'es');
    header.appendChild(chip);
  }
  if (savedCount > 0) {
    const chip = document.createElement('span');
    chip.className = 'nr-hub-dash-chip';
    chip.textContent = savedCount + ' saved';
    header.appendChild(chip);
  }
  if (todayEvents.length > 0) {
    const chip = document.createElement('span');
    chip.className = 'nr-hub-dash-chip';
    chip.textContent = todayEvents.length + ' event' + (todayEvents.length === 1 ? '' : 's');
    header.appendChild(chip);
  }

  wrap.appendChild(header);

  // ── Reading List (max 5) ──
  if (savedCount > 0) {
    const card = document.createElement('div');
    card.className = 'nr-hub-dash-card';

    const title = document.createElement('div');
    title.className = 'nr-hub-dash-card-title';
    title.textContent = 'Reading List';
    card.appendChild(title);

    const sorted = savedEntries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).slice(0, 5);
    for (const entry of sorted) {
      const paper = entry.paper || {};
      const row = document.createElement('div');
      row.className = 'nr-hub-saved-row';
      row.addEventListener('click', () => browseNavigate(paper.link));

      let hostname = '';
      try { hostname = new URL(paper.link).hostname.replace(/^www\./, ''); } catch {}

      const fav = document.createElement('img');
      fav.className = 'nr-hub-saved-favicon';
      fav.src = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostname) + '&sz=32';
      fav.alt = '';
      fav.loading = 'lazy';
      row.appendChild(fav);

      const titleEl = document.createElement('div');
      titleEl.className = 'nr-hub-saved-title';
      titleEl.textContent = paper.title || paper.link || 'Untitled';
      row.appendChild(titleEl);

      if (hostname) {
        const hostEl = document.createElement('div');
        hostEl.className = 'nr-hub-saved-host';
        hostEl.textContent = hostname;
        row.appendChild(hostEl);
      }

      card.appendChild(row);
    }

    if (savedCount > 5) {
      const more = document.createElement('div');
      more.className = 'nr-hub-dash-more';
      more.textContent = 'View all ' + savedCount + ' saved \u2192';
      more.addEventListener('click', () => wmOpen('dashboard'));
      card.appendChild(more);
    }

    wrap.appendChild(card);
  }

  // ── Upcoming Events (max 3) ──
  if (todayEvents.length > 0) {
    const card = document.createElement('div');
    card.className = 'nr-hub-dash-card';

    const title = document.createElement('div');
    title.className = 'nr-hub-dash-card-title';
    title.textContent = 'Today\u2019s Events';
    card.appendChild(title);

    for (const ev of todayEvents.slice(0, 3)) {
      const row = document.createElement('div');
      row.className = 'nr-hub-event-row';
      row.addEventListener('click', () => wmOpen('calendar'));

      const dot = document.createElement('div');
      dot.className = 'nr-hub-event-dot';
      dot.style.background = ev.color || 'var(--nr-accent)';
      row.appendChild(dot);

      const titleEl = document.createElement('div');
      titleEl.className = 'nr-hub-event-title';
      titleEl.textContent = ev.title || 'Event';
      row.appendChild(titleEl);

      if (ev.description) {
        const descEl = document.createElement('div');
        descEl.className = 'nr-hub-event-desc';
        descEl.textContent = ev.description;
        row.appendChild(descEl);
      }

      card.appendChild(row);
    }

    if (todayEvents.length > 3) {
      const more = document.createElement('div');
      more.className = 'nr-hub-dash-more';
      more.textContent = 'View all ' + todayEvents.length + ' events \u2192';
      more.addEventListener('click', () => wmOpen('calendar'));
      card.appendChild(more);
    }

    wrap.appendChild(card);
  }

  slot.appendChild(wrap);
}

// ─── Special Routes ──────────────────────────────────────────

const _ROUTES = [
  ['netrun://',        'This page — hub and help reference'],
  ['netrun://history', 'Browse and search history'],
  ['chat://',          'Chat threads view'],
  ['chat://<id>',      'Open a specific chat thread'],
  ['draw://',          'Drawing whiteboard'],
  ['ntp://',           'New tab page'],
];

function _buildRoutes() {
  const section = document.createElement('div');
  section.className = 'nr-hub-section';

  section.appendChild(_sectionTitle('Special Routes', 'Type these in the URL bar to open internal pages.'));

  for (const [url, desc] of _ROUTES) {
    const row = document.createElement('div');
    row.className = 'nr-hub-route';
    // Make clickable routes (skip template URLs with <>)
    if (!url.includes('<')) {
      row.addEventListener('click', () => browseNavigate(url));
    }

    const urlEl = document.createElement('span');
    urlEl.className = 'nr-hub-route-url';
    urlEl.textContent = url;
    row.appendChild(urlEl);

    const descEl = document.createElement('span');
    descEl.className = 'nr-hub-route-desc';
    descEl.textContent = desc;
    row.appendChild(descEl);

    section.appendChild(row);
  }

  return section;
}

// ─── Help Sections ───────────────────────────────────────────

function _buildHelpSections(container) {
  // Instant Answers
  container.appendChild(_tableSection(
    'Instant Answers',
    'Type in the URL bar \u2014 results appear inline as you type.',
    ['Type', 'Try'],
    _HELP_DATA.instantAnswers
  ));

  // Search Syntax
  container.appendChild(_tableSection(
    'Search Syntax',
    'Use these in the Papers search on new tab pages.',
    ['Syntax', 'Effect'],
    _HELP_DATA.searchSyntax,
    true // mono keys
  ));

  // Bangs
  const bangs = _HELP_DATA.getBangs();
  if (bangs.length) {
    container.appendChild(_tableSection(
      'Bangs',
      'Type ! followed by a shortcut and your query to search a specific site.',
      ['Bang', 'Site'],
      bangs,
      true
    ));
  }

  // Slash Commands
  container.appendChild(_tableSection(
    'Slash Commands',
    'Right-click \u2192 type / in the aether panel.',
    ['Command', 'Action'],
    _HELP_DATA.slashCommands
  ));

  // Keyboard Shortcuts
  container.appendChild(_buildShortcuts());

  // Aether Panel
  container.appendChild(_buildAetherPanel());

  // Chat Tools
  container.appendChild(_tableSection(
    'Chat Tools',
    'When enabled, the chat assistant can use these tools autonomously.',
    ['Tool', 'Description'],
    _HELP_DATA.chatTools,
    true
  ));

  // AI Models
  container.appendChild(_tableSection(
    'AI Models',
    'Local Ollama models. All optional \u2014 features degrade gracefully.',
    ['Model', 'Used for'],
    _HELP_DATA.aiModels,
    true
  ));
}

// ─── Shortcuts (special: has section headers + kbd) ──────────

function _buildShortcuts() {
  const section = document.createElement('div');
  section.className = 'nr-hub-section';
  section.appendChild(_sectionTitle('Keyboard Shortcuts'));

  const table = document.createElement('table');
  table.className = 'nr-hub-table';

  const thead = document.createElement('tr');
  for (const h of ['Key', 'Action']) {
    const th = document.createElement('th');
    th.className = 'nr-hub-th';
    th.textContent = h;
    thead.appendChild(th);
  }
  table.appendChild(thead);

  for (const [key, val] of _HELP_DATA.shortcuts) {
    const tr = document.createElement('tr');
    tr.className = 'nr-hub-tr';
    if (!key) {
      // Section header row
      const td = document.createElement('td');
      td.colSpan = 2;
      td.style.cssText = 'padding:12px 12px 4px;';
      td.innerHTML = val;
      tr.appendChild(td);
    } else {
      const tdKey = document.createElement('td');
      tdKey.className = 'nr-hub-td-key';
      const kbd = document.createElement('kbd');
      kbd.className = 'nr-hub-kbd';
      kbd.textContent = key;
      tdKey.appendChild(kbd);
      tr.appendChild(tdKey);

      const tdVal = document.createElement('td');
      tdVal.className = 'nr-hub-td-val';
      tdVal.textContent = val;
      tr.appendChild(tdVal);
    }
    table.appendChild(tr);
  }

  section.appendChild(table);
  return section;
}

// ─── Aether Panel description ────────────────────────────────

function _buildAetherPanel() {
  const section = document.createElement('div');
  section.className = 'nr-hub-section';
  section.appendChild(_sectionTitle('Aether Panel'));

  const desc = document.createElement('div');
  desc.className = 'nr-hub-panel-desc';
  desc.innerHTML =
    '<strong>Right-click</strong> anywhere to open the panel.<br>' +
    'Type to <strong>chat with AI</strong> about the current page.<br>' +
    '<strong>Select text</strong> \u2192 highlight, quote, or define.<br>' +
    '<strong>Drag</strong> while panel is open to capture a screenshot region.';
  section.appendChild(desc);
  return section;
}

// ─── Helpers ─────────────────────────────────────────────────

function _sectionTitle(title, subtitle) {
  const frag = document.createDocumentFragment();
  const h = document.createElement('div');
  h.className = 'nr-hub-section-title';
  h.textContent = title;
  frag.appendChild(h);
  if (subtitle) {
    const p = document.createElement('div');
    p.className = 'nr-hub-section-desc';
    p.textContent = subtitle;
    frag.appendChild(p);
  }
  return frag;
}

function _tableSection(title, subtitle, headers, rows, monoKeys) {
  const section = document.createElement('div');
  section.className = 'nr-hub-section';
  section.appendChild(_sectionTitle(title, subtitle));

  const table = document.createElement('table');
  table.className = 'nr-hub-table';

  const thead = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.className = 'nr-hub-th';
    th.textContent = h;
    thead.appendChild(th);
  }
  table.appendChild(thead);

  for (const [key, val] of rows) {
    const tr = document.createElement('tr');
    tr.className = 'nr-hub-tr';

    const tdKey = document.createElement('td');
    tdKey.className = 'nr-hub-td-key';
    if (monoKeys) {
      const code = document.createElement('code');
      code.style.fontSize = '0.8rem';
      code.textContent = key;
      tdKey.appendChild(code);
    } else {
      tdKey.textContent = key;
    }
    tr.appendChild(tdKey);

    const tdVal = document.createElement('td');
    tdVal.className = 'nr-hub-td-val';
    tdVal.textContent = val;
    tr.appendChild(tdVal);

    table.appendChild(tr);
  }

  section.appendChild(table);
  return section;
}

// Expose to window for browse modules that use global references
window.openNetrunPage = openNetrunPage;
window._renderNetrunPage = _renderNetrunPage;
