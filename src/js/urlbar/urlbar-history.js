// urlbar-history.js — Web search history, browsing history CRUD, history page, help page
import Settings from '/js/core/core-settings.js';
import { icon } from '/js/core/icons.js';
import { _browseFaviconUrl, _browseTitleFromUrl } from '/js/toolbar/toolbar-nav.js';
import { _browseRenderTabs } from '/js/toolbar/toolbar-tabs.js';
import { _relativeTime } from '/js/search.js';
import { _browseUpdateNewTabPage, browseSelectTab } from '/js/browse/browse-passwords.js';
import { browseSelectWindow, openBrowse, browseNewTab } from '/js/browse/browse-windows.js';
import { browseNavigate } from '/js/toolbar/toolbar-url.js';
import { _HELP_DATA } from '/js/settings/settings-helpers.js';

// ── SVG constants (local copies to avoid circular deps with dropdown) ──
const _SEARCH_SVG = '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/>';
const _CLOSE_SVG = '<svg style="width:14px;height:14px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';

function _ddSvgIcon(svgInner, size, color) {
  return RawHTML('<svg style="width:' + size + ';height:' + size + ';color:' + (color || 'var(--nr-text-quaternary)') + ';flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' + svgInner + '</svg>');
}

// ── Web Search History ──

export function _getWebSearchHistory() {
  try {
    const raw = Settings.getJSON('webSearchHistory', []);
    return raw.map(h => typeof h === 'string' ? { q: h, ts: 0 } : h);
  } catch { return []; }
}

export function _saveWebSearch(query) {
  const q = (query || '').trim();
  if (!q) return;
  let hist = _getWebSearchHistory().filter(h => h.q !== q);
  hist.unshift({ q, ts: Date.now() });
  if (hist.length > 200) hist = hist.slice(0, 200);
  Settings.setJSON('webSearchHistory', hist);
}

export function _removeWebSearch(index) {
  const hist = _getWebSearchHistory();
  hist.splice(index, 1);
  Settings.setJSON('webSearchHistory', hist);
}

export function _clearWebSearchHistory() {
  Settings.setJSON('webSearchHistory', []);
}

// ── Browsing History ──

export function _getBrowseHistory() {
  try { return Settings.getJSON('browseHistory', []); } catch { return []; }
}

export function _saveBrowseVisit(url, title) {
  if (!url || url === 'about:blank') return;
  let hist = _getBrowseHistory();
  if (hist.length && hist[0].url === url) {
    hist[0].title = title || hist[0].title;
    hist[0].ts = Date.now();
  } else {
    hist.unshift({ url, title: title || _browseTitleFromUrl(url), ts: Date.now() });
  }
  if (hist.length > 1000) hist = hist.slice(0, 1000);
  Settings.setJSON('browseHistory', hist);
}

export function _removeBrowseVisit(index) {
  const hist = _getBrowseHistory();
  hist.splice(index, 1);
  Settings.setJSON('browseHistory', hist);
}

export function _clearBrowseHistory() {
  Settings.setJSON('browseHistory', []);
}

// ── History Page ──

export function openSearchHistoryPage() {
  // Open as a blank-style tab in browse view
  if (typeof openBrowse === 'function') openBrowse();

  // Reuse existing history tab if one exists
  for (const w of window._browseWindows) {
    const existing = w.tabs.find(t => t._historyPage);
    if (existing) {
      if (w.id !== window._browseActiveWindow) browseSelectWindow(w.id);
      browseSelectTab(existing.id);
      // Re-render to pick up new history entries
      if (existing.el) _renderWebSearchHistoryPage(existing.el);
      return;
    }
  }

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) return;

  // Mark it as a history tab
  tab.blank = false;
  tab.url = 'netrun://history';
  tab.title = 'History';
  tab.favicon = '';
  tab._historyPage = true;

  // Remove existing iframe/content
  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const elView = new window.View('div').attr('id', 'browse-history-' + tab.id);
  elView.cssText('width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--nr-bg-body);color:var(--nr-text-primary);z-index:3;');
  container.appendChild(elView.el);
  tab.el = elView.el;

  // Hide new tab page
  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  // Update URL bar
  const urlInput = document.getElementById('browse-url-input');
  window._browseSetUrlDisplay(urlInput, 'netrun://history');

  _renderWebSearchHistoryPage(tab.el);
}

export function openHelpPage() {
  // Redirect to the new netrun:// hub page
  if (typeof window.openNetrunPage === 'function') {
    window.openNetrunPage();
  }
}

export function _renderHelpPage(el) {
  if (!el) return;
  const secStyle = 'margin-bottom:24px;';
  const h2Style = 'font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);margin-bottom:10px;';
  const tableStyle = 'width:100%;border-collapse:collapse;font-size:0.82rem;';
  const thStyle = 'text-align:left;padding:6px 12px;font-size:0.7rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--nr-border-default);';
  const tdkStyle = 'padding:6px 12px;border-bottom:1px solid var(--nr-border-subtle);color:var(--nr-text-primary);font-weight:500;white-space:nowrap;';
  const tdvStyle = 'padding:6px 12px;border-bottom:1px solid var(--nr-border-subtle);color:var(--nr-text-secondary);';
  const descStyle = 'font-size:0.78rem;color:var(--nr-text-secondary);margin-bottom:8px;';

  // Helper: build a two-column table from rows
  function helpTable(headers, rows) {
    const tbl = new View('table').cssText(tableStyle);
    const headTr = new View('tr');
    headers.forEach(h => {
      const thEl = new View('th').cssText(thStyle);
      thEl.el.textContent = h;
      headTr.add(thEl);
    });
    tbl.add(headTr);
    rows.forEach(([k, v, opts]) => {
      const tr = new View('tr');
      if (opts && opts.spanRow) {
        const td = new View('td').attr('colspan', '2').cssText('padding:10px 12px 4px;');
        td.add(RawHTML(v));
        tr.add(td);
      } else {
        const tdk = new View('td').cssText(tdkStyle);
        tdk.add(RawHTML(k));
        const tdv = new View('td').cssText(tdvStyle);
        tdv.add(RawHTML(v));
        tr.add(tdk, tdv);
      }
      tbl.add(tr);
    });
    return tbl;
  }

  function helpSection(title, desc, tbl) {
    const sec = VStack().cssText(secStyle);
    sec.add(Text(title).cssText(h2Style));
    if (desc) sec.add(Text(desc).cssText(descStyle));
    if (tbl) sec.add(tbl);
    return sec;
  }

  const page = VStack().cssText('max-width:640px;margin:0 auto;padding:40px 24px;');
  page.add(RawHTML('<h1 style="font-size:1.4rem;font-weight:700;color:var(--nr-text-primary);margin-bottom:4px;">Help</h1>'));
  page.add(Text('Everything you can do from the URL bar and aether panel.').cssText('font-size:0.82rem;color:var(--nr-text-secondary);margin-bottom:32px;'));

  // Instant Answers
  page.add(helpSection('Instant Answers', 'Type in the URL bar \u2014 results appear inline as you type.',
    helpTable(['Type', 'Try'], _HELP_DATA.instantAnswers)));

  // Search Syntax
  page.add(helpSection('Search Syntax', 'Use these in the Papers search on new tab pages.',
    helpTable(['Syntax', 'Effect'], _HELP_DATA.searchSyntax.map(([k, v]) => ['<code style="font-size:0.8rem;">' + k + '</code>', v]))));

  // Bangs
  const bangs = _HELP_DATA.getBangs();
  if (bangs.length) {
    const bangSec = helpSection('Bangs', 'Type <code style="font-size:0.8rem;">!</code> followed by a shortcut and your query to search a specific site.',
      helpTable(['Bang', 'Site'], bangs.map(([k, v]) => ['<code style="font-size:0.8rem;">' + k + '</code>', v])));
    page.add(bangSec);
  }

  // Slash Commands
  page.add(helpSection('Slash Commands', 'Right-click \u2192 type / in the aether panel.',
    helpTable(['Command', 'Action'], _HELP_DATA.slashCommands)));

  // Keyboard Shortcuts
  const shortcutRows = _HELP_DATA.shortcuts.map(([k, v]) => {
    if (!k) return ['', v, { spanRow: true }];
    return ['<kbd style="font-family:inherit;font-size:0.78rem;padding:1px 6px;border-radius:4px;border:1px solid var(--nr-border-default);background:var(--nr-bg-surface);">' + k + '</kbd>', v];
  });
  page.add(helpSection('Keyboard Shortcuts', null, helpTable(['Key', 'Action'], shortcutRows)));

  // Aether Panel
  const aetherSec = VStack().cssText(secStyle);
  aetherSec.add(Text('Aether Panel').cssText(h2Style));
  aetherSec.add(RawHTML('<div style="font-size:0.82rem;color:var(--nr-text-secondary);line-height:1.6;"><strong style="color:var(--nr-text-primary);">Right-click</strong> anywhere to open the panel.<br>Type to <strong style="color:var(--nr-text-primary);">chat with AI</strong> about the current page.<br><strong style="color:var(--nr-text-primary);">Select text</strong> \u2192 highlight, quote, or define.<br><strong style="color:var(--nr-text-primary);">Drag</strong> while panel is open to capture a screenshot region.</div>'));
  page.add(aetherSec);

  // Chat Tools
  page.add(helpSection('Chat Tools', 'When enabled, the chat assistant can use these tools autonomously. Requires qwen3:8b.',
    helpTable(['Tool', 'Description'], _HELP_DATA.chatTools)));

  // Internal Pages
  page.add(helpSection('Internal Pages', null,
    helpTable(['URL', 'Page'], [['netrun://help', 'This page'], ['netrun://history', 'Browsing & search history']])));

  AetherUI.mount(page, el);
}

export let _historyPageTab = 'browse'; // 'browse' or 'search'

export function _renderWebSearchHistoryPage(el) {
  if (!el) return;
  const searchHist = _getWebSearchHistory();
  const browseHist = _getBrowseHistory();
  const isBrowse = _historyPageTab === 'browse';
  const activeHist = isBrowse ? browseHist : searchHist;

  const tabStyle = (active) => 'padding:6px 14px;border:none;border-bottom:2px solid ' + (active ? 'var(--nr-accent)' : 'transparent') + ';background:none;color:' + (active ? 'var(--nr-text-primary)' : 'var(--nr-text-secondary)') + ';font-size:0.82rem;cursor:pointer;font-weight:' + (active ? '600' : '400') + ';';

  // Header
  const headerLeft = HStack(
    RawHTML(icon('clock', {size: 20, style: 'color:var(--nr-text-quaternary);'})),
    Text('History').cssText('font-size:1.1rem;font-weight:600;color:var(--nr-text-primary);')
  ).cssText('display:flex;align-items:center;gap:10px;');

  const headerRow = HStack(headerLeft).cssText('display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;');
  if (activeHist.length) {
    const clearBtn = Button('Clear all').cssText('padding:4px 10px;border-radius:6px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-secondary);font-size:0.75rem;cursor:pointer;');
    clearBtn.onTap(function() {
      if (isBrowse) _clearBrowseHistory(); else _clearWebSearchHistory();
      _renderWebSearchHistoryPage(el);
    });
    headerRow.add(clearBtn);
  }

  // Tab switcher
  const browseTab = Button(
    RawHTML('Sites <span style="font-size:0.7rem;color:var(--nr-text-quaternary);">' + browseHist.length + '</span>')
  ).cssText(tabStyle(isBrowse));
  browseTab.onTap(function() { _historyPageTab = 'browse'; _renderWebSearchHistoryPage(el); });

  const searchTab = Button(
    RawHTML('Searches <span style="font-size:0.7rem;color:var(--nr-text-quaternary);">' + searchHist.length + '</span>')
  ).cssText(tabStyle(!isBrowse));
  searchTab.onTap(function() { _historyPageTab = 'search'; _renderWebSearchHistoryPage(el); });

  const tabBar = HStack(browseTab, searchTab).cssText('display:flex;gap:0;border-bottom:1px solid var(--nr-border-strong);margin-bottom:16px;');

  // Filter
  const filterWrap = new View('div').cssText('position:relative;margin-bottom:16px;');
  const filterIcon = RawHTML(icon('search', {size: 14, style: 'position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--nr-text-quaternary);pointer-events:none;'}));
  const filterInput = new View('input').attr('type', 'text').attr('id', 'history-page-filter').attr('placeholder', 'Filter history...');
  filterInput.cssText('width:100%;padding:7px 12px 7px 32px;border-radius:8px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.82rem;outline:none;');
  filterInput.on('input', function() { _filterWebSearchHistory(); });
  filterWrap.add(filterIcon, filterInput);

  // List
  const listContainer = new View('div').attr('id', 'history-page-list');
  const listView = isBrowse ? _renderBrowseHistoryListView(browseHist) : _renderWebSearchHistoryListView(searchHist);
  if (listView) listContainer.add(listView);

  const page = VStack(headerRow, tabBar, filterWrap, listContainer).cssText('max-width:680px;margin:0 auto;padding:32px 24px 64px;');
  AetherUI.mount(page, el);
}

export function _filterWebSearchHistory() {
  const filter = (document.getElementById('history-page-filter')?.value || '').trim().toLowerCase();
  const list = document.getElementById('history-page-list');
  if (!list) return;
  if (_historyPageTab === 'browse') {
    const hist = _getBrowseHistory();
    const filtered = filter ? hist.filter(h => (h.title || '').toLowerCase().includes(filter) || (h.url || '').toLowerCase().includes(filter)) : hist;
    const view = _renderBrowseHistoryListView(filtered);
    AetherUI.mount(view || VStack(), list);
  } else {
    const hist = _getWebSearchHistory();
    const filtered = filter ? hist.filter(h => h.q.toLowerCase().includes(filter)) : hist;
    const view = _renderWebSearchHistoryListView(filtered);
    AetherUI.mount(view || VStack(), list);
  }
}

// Helper: group history items by date label
function _groupHistByDate(hist) {
  const groups = [];
  const groupMap = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 604800000;
  hist.forEach(h => {
    let label;
    const ts = h.ts || 0;
    if (!ts) { label = 'Older'; }
    else if (ts >= today) { label = 'Today'; }
    else if (ts >= yesterday) { label = 'Yesterday'; }
    else if (ts >= weekAgo) { label = 'This Week'; }
    else { label = new Date(ts).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
    if (!groupMap[label]) { groupMap[label] = []; groups.push(label); }
    groupMap[label].push(h);
  });
  return { groups, groupMap };
}

export function _renderWebSearchHistoryListView(hist) {
  if (!hist.length) return Text('No searches found').cssText('text-align:center;padding:48px 0;color:var(--nr-text-secondary);font-size:0.85rem;');

  const allHist = _getWebSearchHistory();
  const { groups, groupMap } = _groupHistByDate(hist);

  const root = VStack();
  for (const label of groups) {
    const group = VStack().cssText('margin-bottom:16px;');
    group.add(Text(label).cssText('font-size:0.7rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;padding:0 4px;'));
    groupMap[label].forEach(h => {
      const origIdx = allHist.findIndex(a => a.q === h.q && a.ts === h.ts);
      const time = _relativeTime(h.ts);
      const delBtn = Button(RawHTML(_CLOSE_SVG))
        .cssText('background:none;border:none;cursor:pointer;padding:2px;color:var(--nr-text-quaternary);opacity:0;flex-shrink:0;transition:opacity 0.15s;');
      delBtn.el.className = 'hist-del';
      delBtn.onTap(function(ev) { ev.stopPropagation(); _removeWebSearch(origIdx); _filterWebSearchHistory(); });

      const row = HStack(
        _ddSvgIcon(_SEARCH_SVG, '14px'),
        Text(h.q).cssText('font-size:0.82rem;color:var(--nr-text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
        Text(time).cssText('font-size:0.7rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;'),
        delBtn
      ).cssText('display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background 0.15s;');
      row.on('mouseenter', function() { this.style.background = 'var(--nr-bg-raised)'; this.querySelector('.hist-del').style.opacity = '1'; });
      row.on('mouseleave', function() { this.style.background = 'none'; this.querySelector('.hist-del').style.opacity = '0'; });
      row.on('click', function() { browseNewTab(h.q); });
      group.add(row);
    });
    root.add(group);
  }
  return root;
}

export function _renderBrowseHistoryListView(hist) {
  if (!hist.length) return Text('No browsing history').cssText('text-align:center;padding:48px 0;color:var(--nr-text-secondary);font-size:0.85rem;');

  const allHist = _getBrowseHistory();
  const { groups, groupMap } = _groupHistByDate(hist);

  const root = VStack();
  for (const label of groups) {
    const group = VStack().cssText('margin-bottom:16px;');
    group.add(Text(label).cssText('font-size:0.7rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;padding:0 4px;'));
    groupMap[label].forEach(h => {
      const origIdx = allHist.findIndex(a => a.url === h.url && a.ts === h.ts);
      const time = _relativeTime(h.ts);
      let domain = '';
      try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
      const favicon = _browseFaviconUrl(h.url);

      const img = new View('img').attr('src', favicon).cssText('width:16px;height:16px;flex-shrink:0;border-radius:2px;');
      img.el.onerror = function() { this.style.display = 'none'; };

      const info = VStack(
        Text(h.title || domain).cssText('font-size:0.82rem;color:var(--nr-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
        Text(domain).cssText('font-size:0.7rem;color:var(--nr-text-quaternary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')
      ).cssText('flex:1;overflow:hidden;min-width:0;');

      const delBtn = Button(RawHTML(_CLOSE_SVG))
        .cssText('background:none;border:none;cursor:pointer;padding:2px;color:var(--nr-text-quaternary);opacity:0;flex-shrink:0;transition:opacity 0.15s;');
      delBtn.el.className = 'hist-del';
      delBtn.onTap(function(ev) { ev.stopPropagation(); _removeBrowseVisit(origIdx); _filterWebSearchHistory(); });

      const row = HStack(
        img, info,
        Text(time).cssText('font-size:0.7rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;'),
        delBtn
      ).cssText('display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background 0.15s;');
      row.on('mouseenter', function() { this.style.background = 'var(--nr-bg-raised)'; this.querySelector('.hist-del').style.opacity = '1'; });
      row.on('mouseleave', function() { this.style.background = 'none'; this.querySelector('.hist-del').style.opacity = '0'; });
      row.on('click', function() { browseNewTab(h.url); });
      group.add(row);
    });
    root.add(group);
  }
  return root;
}
