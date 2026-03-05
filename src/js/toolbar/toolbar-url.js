// toolbar-url.js — URL input, capsule, browseNavigate, URL resolution
import Settings from '/js/core/core-settings.js';
import { isNtp, islandExpanded, tabListVersion, notifyTabsChanged } from '/js/toolbar/toolbar-state.js';
import { _browseTitleFromUrl, _browseFaviconUrl } from '/js/toolbar/toolbar-nav.js';
import { _browseSetUrlDisplay, _browseUrlKeydown, _browseUrlHideHistory, _browseApplyAdaptiveColor, _saveBrowseVisit, _saveWebSearch } from '/js/browse-urlbar.js';
import { _browseCreateFrame, _browseProxyUrl, _browseSetFrameAllow } from '/js/browse/browse-ntp.js';
import { _browseBindFrame } from '/js/browse/browse-frame-bind.js';
import { _browseUpdateNewTabPage, browseSelectTab, browseCloseTab } from '/js/browse/browse-passwords.js';
import { _browseUpdateSaveBtn } from '/js/browse/browse-features.js';
import { _annotationsEnabled, _updateAnnotateButtonState } from '/js/browse/browse-annotations.js';

// ── Bang shortcuts ──

export var _BANGS = {
  g:        'https://www.google.com/search?q=%s',
  ddg:      'https://duckduckgo.com/?q=%s',
  b:        'https://www.bing.com/search?q=%s',
  yt:       'https://www.youtube.com/results?search_query=%s',
  w:        'https://en.wikipedia.org/wiki/Special:Search?search=%s',
  r:        'https://www.reddit.com/search/?q=%s',
  gh:       'https://github.com/search?q=%s',
  so:       'https://stackoverflow.com/search?q=%s',
  npm:      'https://www.npmjs.com/search?q=%s',
  mdn:      'https://developer.mozilla.org/en-US/search?q=%s',
  tw:       'https://x.com/search?q=%s',
  twitch:   'https://www.twitch.tv/search?term=%s',
  am:       'https://www.amazon.com/s?k=%s',
  maps:     'https://www.google.com/maps/search/%s',
  img:      'https://www.google.com/search?tbm=isch&q=%s',
  imdb:     'https://www.imdb.com/find/?q=%s',
  sp:       'https://open.spotify.com/search/%s',
  arxiv:    'https://arxiv.org/search/?query=%s',
  py:       'https://pypi.org/search/?q=%s',
  crates:   'https://crates.io/search?q=%s',
  hn:       'https://hn.algolia.com/?q=%s',
  wa:       'https://www.wolframalpha.com/input?i=%s',
  nix:      'https://search.nixos.org/packages?query=%s',
};

// ── URL resolution ──

export function _browseResolveUrl(input) {
  input = (input || '').trim();
  if (!input) return 'https://www.google.com';
  if (/^(https?|file|blob|data|aether|chat|nerd):\/\//i.test(input)) return input.replace(/\s+/g, '');
  if (/^\//.test(input)) {
    const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
    if (tab && tab.url) {
      try { return new URL(input, tab.url).href; } catch(e) {}
    }
  }
  const bangPrefix = input.match(/^!(\S+)\s+(.+)/);
  const bangSuffix = input.match(/^(.+)\s+!(\S+)$/);
  if (bangPrefix || bangSuffix) {
    const bang = (bangPrefix ? bangPrefix[1] : bangSuffix[2]).toLowerCase();
    const query = (bangPrefix ? bangPrefix[2] : bangSuffix[1]).trim();
    const template = _BANGS[bang];
    if (template) return template.replace('%s', encodeURIComponent(query));
  }
  const collapsed = input.replace(/\s+/g, '');
  if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(collapsed) && !/\.(cpp|py|js|ts|rs|go|rb|java|cs|swift|kt|c|h|hpp|md|txt|json|xml|yaml|yml|toml|csv|sql|sh|bat|exe|dll|so|o|a|wasm|log|cfg|ini|conf|env|lock|gitignore)$/i.test(collapsed)) return 'https://' + collapsed;
  return 'https://www.google.com/search?q=' + encodeURIComponent(input);
}

// ── browseNavigate ──

export function browseNavigate(input) {
  const cmd = (input || '').trim().toLowerCase();
  if (cmd === '/history' || cmd === 'netrun://history' || cmd === 'netrun://history/') {
    if (typeof window.openSearchHistoryPage === 'function') window.openSearchHistoryPage();
    return;
  }
  if (cmd === '/help' || cmd === 'netrun://help' || cmd === 'netrun://help/' || cmd === 'netrun://' || cmd === 'netrun:///') {
    if (typeof window.openNetrunPage === 'function') window.openNetrunPage();
    return;
  }
  if (cmd === '/docs' || cmd === 'netrun://docs' || cmd === 'netrun://docs/') {
    if (typeof window.openDocs === 'function') window.openDocs();
    return;
  }
  if (cmd === '/bookmarks' || cmd === '/library' || cmd === 'netrun://bookmarks' || cmd === 'netrun://bookmarks/' || cmd === 'netrun://library' || cmd === 'netrun://library/') {
    if (typeof window.openBookmarks === 'function') window.openBookmarks();
    return;
  }
  if (cmd === '/implementations' || cmd === 'netrun://implementations' || cmd === 'netrun://implementations/') {
    if (typeof window.openImplementations === 'function') window.openImplementations();
    return;
  }
  if (cmd === '/upload') {
    const fi = document.getElementById('browse-pdf-file-input');
    if (fi) { fi.click(); return; }
    const tmp = document.createElement('input');
    tmp.type = 'file'; tmp.style.display = 'none';
    tmp.onchange = function() { if (tmp.files[0] && typeof window.openLocalPdf === 'function') window.openLocalPdf(tmp.files[0]); tmp.remove(); };
    document.body.appendChild(tmp); tmp.click();
    return;
  }
  if (/^chat:\/\//i.test(cmd)) {
    const threadId = cmd.replace(/^chat:\/\//i, '').replace(/\/$/, '');
    if (typeof window.openChatPage === 'function') window.openChatPage(threadId || null);
    return;
  }
  if (/^draw:\/\//i.test(cmd)) {
    const drawId = cmd.replace(/^draw:\/\//i, '').replace(/\/$/, '');
    if (typeof window.openDrawPage === 'function') window.openDrawPage(drawId || undefined);
    return;
  }
  if (/^terminal:\/\//i.test(cmd)) {
    if (typeof window.openTerminalPage === 'function') window.openTerminalPage();
    return;
  }
  if (/^nerd:\/\//i.test(cmd)) {
    const nerdPath = (input || '').trim().replace(/^nerd:\/\//i, '');
    if (nerdPath && typeof window.openLocalPdfByPath === 'function') window.openLocalPdfByPath(nerdPath);
    return;
  }
  const url = _browseResolveUrl(input);
  const trimmed = (input || '').trim();
  if (trimmed && url.startsWith('https://www.google.com/search?q=')) {
    _saveWebSearch(trimmed);
  }
  const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  if (!tab) { if (typeof window.browseNewTab === 'function') window.browseNewTab(url); return; }
  // Tear down special pages
  if (tab._historyPage || tab._helpPage || tab._netrunPage || tab._chatPage || tab._terminalPage || tab._bookmarksPage || tab._implementationsPage) {
    if (tab._chatPage && typeof window.chatViewCleanupMorph === 'function') {
      const ntpMorphed = document.getElementById('browse-content');
      const morphEl = ntpMorphed ? ntpMorphed.querySelector('.browse-ntp.chat-mode') : null;
      if (morphEl) window.chatViewCleanupMorph();
    }
    if (tab.el) tab.el.remove();
    tab.el = null;
    delete tab._historyPage; delete tab._helpPage; delete tab._netrunPage;
    delete tab._chatPage; delete tab._chatThreadId; delete tab._terminalPage;
    delete tab._bookmarksPage; delete tab._implementationsPage;
  }
  // Push current URL onto back stack
  if (tab.url && !tab.blank && !/^#/.test(tab.url) && !/^about:/.test(tab.url)) {
    if (!tab.backStack) tab.backStack = [];
    tab.backStack.push(tab.url);
    if (tab.backStack.length > 50) tab.backStack = tab.backStack.slice(-50);
    tab.forwardStack = [];
  }
  // Clear annotations on navigation
  if (_annotationsEnabled.get(tab.id)) {
    _annotationsEnabled.set(tab.id, false);
    _updateAnnotateButtonState();
  }
  tab.url = url;
  tab.title = _browseTitleFromUrl(url);
  tab.favicon = _browseFaviconUrl(url);
  tab.blank = false;
  _saveBrowseVisit(url, tab.title);
  if (!tab.el) {
    const container = document.getElementById('browse-content');
    tab.el = _browseCreateFrame(tab.id, url);
    container.appendChild(tab.el);
    _browseBindFrame(tab);
  } else {
    _browseSetFrameAllow(tab.el, url);
    const proxied = _browseProxyUrl(url);
    tab.el.dataset.originalUrl = url;
    tab.el.src = proxied;
    if (proxied !== url && typeof window._browseUpdateAdBlockBadge === 'function') {
      tab.el.addEventListener('load', function() { window._browseUpdateAdBlockBadge(url); }, { once: true });
    }
  }
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) _browseSetUrlDisplay(urlInput, url);
  notifyTabsChanged();
  _browseUpdateSaveBtn();
  window._browseSaveTabs();
  if (typeof window._browseUpdateAdBlockBtn === 'function') window._browseUpdateAdBlockBtn();
  _browseUpdateNewTabPage(tab);
  if (typeof window._initSidebarForUrl === 'function') window._initSidebarForUrl(url);
}

window.browseNavigate = browseNavigate;

// ── Pill URL sync ──

export function _pillSyncUrl() {
  const input = document.getElementById('pill-browse-url-input');
  if (!input) return;
  const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  const isBlankNtp = tab && tab.blank;
  _browseSetUrlDisplay(input, (!isBlankNtp && tab && tab.url) ? tab.url : '');
  isNtp.value = !!isBlankNtp;
  const pill = document.getElementById('sidebar-nav');
  if (pill) pill.classList.toggle('ntp-active', !!isBlankNtp);
  if (typeof window._syncIslandPillPosition === 'function') window._syncIslandPillPosition();
  if (typeof _browseApplyAdaptiveColor === 'function') _browseApplyAdaptiveColor(tab);
}

// ── Pill URL keydown handler ──

export function _pillUrlKeydown(e) {
  if (typeof _browseUrlKeydown === 'function') {
    _browseUrlKeydown(e);
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') return;
    if (e.key === 'Escape') {
      // Close popup if open
      if (window._urlPopupEl && typeof window._collapseIsland === 'function') {
        window._collapseIsland();
      }
      e.target.blur();
      return;
    }
  }
}

// ── Tab dropdown in pill ──

export function _showTabsInPillDropdown() {
  const dd = document.getElementById('pill-url-dropdown');
  const wrap = document.getElementById('pill-url-wrap');
  if (!dd || !wrap) return;

  const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) return;

  const tabs = win.tabs;
  const activeTab = win.activeTab;
  const pinnedItems = tabs.filter(function(t) { return t.pinned; });
  const unpinnedItems = tabs.filter(function(t) { return !t.pinned; }).slice().sort(function(x, y) { return (y.lastVisited || 0) - (x.lastVisited || 0); });

  const globeSvg = '<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  function _ddRow(children, opts) {
    opts = opts || {};
    const row = window.HStack(children).alignment('center')
      .padding('6px', '12px').foreground('primary')
      .styles({ gap: '8px', cursor: 'pointer', fontSize: '0.8rem', transition: 'background 0.1s' });
    if (opts.bg) row.el.style.background = opts.bg;
    row.onHover(
      function() { row.el.style.background = 'var(--nr-bg-raised)'; },
      function() { row.el.style.background = opts.bg || 'none'; }
    );
    return row;
  }

  const views = [];
  // New tab row
  const newTabIcon = window.RawHTML('<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>');
  views.push(_ddRow([newTabIcon, window.Text('New tab')]).onTap(function() {
    if (typeof window._collapseIsland === 'function') window._collapseIsland();
    if (typeof window.browseNewTab === 'function') window.browseNewTab();
    _browseUrlHideHistory();
  }));

  function renderTabView(t) {
    const isActive = t.id === activeTab;
    let title = (t.title || 'New Tab');
    if (title.length > 40) title = title.slice(0, 38) + '\u2026';
    const favView = t.favicon
      ? window.Image(t.favicon).frame({ width: 14, height: 14 }).cornerRadius('xs').styles({ flexShrink: '0' })
          .on('error', function() { this.style.display = 'none'; })
      : window.RawHTML(globeSvg);
    const titleView = window.Text(title).flex(1).truncate();
    var closeBtn = window.Text('\u00d7').foreground('quaternary').padding('0', '2px').opacity(0.5)
      .styles({ fontSize: '1rem', lineHeight: '1' })
      .onHover(function() { closeBtn.el.style.opacity = '1'; }, function() { closeBtn.el.style.opacity = '0.5'; })
      .onTap(function(e) {
        e.stopPropagation();
        browseCloseTab(t.id);
        setTimeout(_showTabsInPillDropdown, 50);
      });
    const row = _ddRow([favView, titleView, closeBtn], { bg: isActive ? 'var(--nr-bg-raised)' : '' });
    row.onTap(function() {
      browseSelectTab(t.id);
      _browseUrlHideHistory();
      if (typeof window._collapseIsland === 'function') window._collapseIsland();
    });
    return row;
  }

  if (pinnedItems.length) {
    pinnedItems.forEach(function(t) { views.push(renderTabView(t)); });
    if (unpinnedItems.length) {
      views.push(new window.View('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '2px 12px' }));
    }
  }
  unpinnedItems.forEach(function(t) { views.push(renderTabView(t)); });

  AetherUI.mount(window.VStack(views), dd);
  dd.style.display = '';
  dd.classList.remove('hidden');
  wrap.classList.add('pill-dropdown-open');

  // Outside click cleanup
  _pillTabsDropdownCleanup();
  const _outsideHandler = function(e) {
    if (wrap.contains(e.target) || dd.contains(e.target)) return;
    _browseUrlHideHistory();
    _pillTabsDropdownCleanup();
  };
  const _blurHandler = function() {
    _pillTabsBlurTimer = setTimeout(function() {
      const w = document.getElementById('pill-url-wrap');
      if (w && w.classList.contains('pill-dropdown-open')) {
        _browseUrlHideHistory();
        _pillTabsDropdownCleanup();
      }
    }, 150);
  };
  _pillTabsOutsideHandler = _outsideHandler;
  _pillTabsBlurHandler = _blurHandler;
  setTimeout(function() {
    document.addEventListener('mousedown', _pillTabsOutsideHandler, true);
  }, 0);
  window.addEventListener('blur', _pillTabsBlurHandler);
}

var _pillTabsOutsideHandler = null;
var _pillTabsBlurHandler = null;
var _pillTabsBlurTimer = null;

function _pillTabsDropdownCleanup() {
  if (_pillTabsBlurTimer) { clearTimeout(_pillTabsBlurTimer); _pillTabsBlurTimer = null; }
  if (_pillTabsOutsideHandler) { document.removeEventListener('mousedown', _pillTabsOutsideHandler, true); _pillTabsOutsideHandler = null; }
  if (_pillTabsBlurHandler) { window.removeEventListener('blur', _pillTabsBlurHandler); _pillTabsBlurHandler = null; }
}

// Export pure helpers so they're available on window
export { _browseTitleFromUrl, _browseFaviconUrl };
