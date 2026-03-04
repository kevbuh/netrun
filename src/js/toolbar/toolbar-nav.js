// toolbar-nav.js — Back/Forward/Reload buttons + history dropdown
import { canGoBack, canGoForward, activeTabData, tabListVersion, notifyTabsChanged } from '/js/toolbar/toolbar-state.js';
import { icon } from '/js/core/icons.js';
import { _browseProxyUrl, _browseSetFrameAllow } from '/js/browse/browse-ntp.js';
import { browseCloseTab, _browseUpdateNewTabPage } from '/js/browse/browse-passwords.js';
import { _browseSetUrlDisplay } from '/js/browse-urlbar.js';
import { _browseUpdateSaveBtn } from '/js/browse/browse-features.js';
import { goHome } from '/js/core/core-views.js';

// ── Navigation functions (ported from browse-island.js) ──

// Flag set by browseBack()/browseForward() before changing el.src — tells
// the did-navigate handler to skip stack manipulation (caller already did it)
let _browseStackNavigation = false;
export function _isBrowseStackNavigation() { return _browseStackNavigation; }
export function _clearBrowseStackNavigation() { _browseStackNavigation = false; }

function _browseActiveEl() {
  const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  return tab ? tab.el : null;
}

export function browseBack() {
  // Intercept back nav when in Nerd Mode
  const tab0Nerd = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  if (tab0Nerd && typeof window._isNerdMode === 'function' && window._isNerdMode(tab0Nerd.id)) {
    if (typeof window.toggleNerdMode === 'function') window.toggleNerdMode(tab0Nerd);
    return;
  }
  // Intercept back nav when in chat mode
  const tab0 = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  if (tab0 && tab0._chatPage) {
    const ntp = document.getElementById('browse-content');
    const ntpMorphed = ntp ? ntp.querySelector('.browse-ntp.chat-mode') : null;
    if (ntpMorphed && typeof window.chatViewUnmorph === 'function') {
      window.chatViewUnmorph();
      return;
    }
    if (tab0.el) { tab0.el.remove(); tab0.el = null; }
    delete tab0._chatPage;
    delete tab0._chatThreadId;
    tab0.url = 'ntp://';
    tab0.title = 'New Tab';
    tab0.favicon = '';
    tab0.blank = true;
    tab0.backStack = [];
    tab0.forwardStack = [];
    _browseUpdateNewTabPage(tab0);
    if (typeof window._browseRenderTabs === 'function') window._browseRenderTabs();
    var urlInput = document.getElementById('browse-url-input');
    if (urlInput) _browseSetUrlDisplay(urlInput, 'ntp://');
    return;
  }
  const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  if (!tab) return;
  // If tab has no back history and came from feed → close tab + go to feed
  if ((!tab.backStack || !tab.backStack.length) && tab.origin === 'feed') {
    browseCloseTab(tab.id);
    goHome();
    return;
  }
  if (tab.backStack && tab.backStack.length) {
    if (!tab.forwardStack) tab.forwardStack = [];
    tab.forwardStack.push(tab.url);
    const prevUrl = tab.backStack.pop();
    tab.url = prevUrl;
    tab.title = _browseTitleFromUrl(prevUrl);
    tab.favicon = _browseFaviconUrl(prevUrl);
    const el = _browseActiveEl();
    if (el) {
      _browseStackNavigation = true;
      _browseSetFrameAllow(el, prevUrl);
      const proxied = _browseProxyUrl(prevUrl);
      el.dataset.originalUrl = prevUrl;
      el.src = proxied;
    }
    var urlInput = document.getElementById('browse-url-input');
    if (urlInput) _browseSetUrlDisplay(urlInput, prevUrl);
    if (typeof window._browseRenderTabs === 'function') window._browseRenderTabs();
    _browseUpdateSaveBtn();
    window._browseSaveTabs();
    notifyTabsChanged();
    return;
  }
}

export function browseForward() {
  const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  if (!tab || !tab.forwardStack || !tab.forwardStack.length) return;
  if (!tab.backStack) tab.backStack = [];
  tab.backStack.push(tab.url);
  const nextUrl = tab.forwardStack.pop();
  tab.url = nextUrl;
  tab.title = _browseTitleFromUrl(nextUrl);
  tab.favicon = _browseFaviconUrl(nextUrl);
  const el = _browseActiveEl();
  if (el) {
    _browseStackNavigation = true;
    _browseSetFrameAllow(el, nextUrl);
    const proxied = _browseProxyUrl(nextUrl);
    el.dataset.originalUrl = nextUrl;
    el.src = proxied;
  }
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) _browseSetUrlDisplay(urlInput, nextUrl);
  if (typeof window._browseRenderTabs === 'function') window._browseRenderTabs();
  _browseUpdateSaveBtn();
  window._browseSaveTabs();
  notifyTabsChanged();
}

export function browseReload() {
  const el = _browseActiveEl();
  if (!el) return;
  if (window._browseIsElectron && el.reload) { el.reload(); return; }
  if (!window._browseIsElectron) { try { el.contentWindow.location.reload(); } catch(e) {} }
}

// ── History dropdown ──

let _historyDropdownEl = null;
let _historyDropdownHideTimer = 0;

export function _showHistoryDropdown(direction, buttonEl) {
  clearTimeout(_historyDropdownHideTimer);
  const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  if (!tab) return;
  const stack = direction === 'back' ? (tab.backStack || []) : (tab.forwardStack || []);
  if (!stack.length) return;
  _hideHistoryDropdownNow();

  const items = stack.slice().reverse().slice(0, 15);
  const rows = items.map(function(url, i) {
    const favImg = window.Image(_browseFaviconUrl(url))
      .frame({ width: 14, height: 14 }).cornerRadius('xs')
      .styles({ flexShrink: '0' })
      .on('error', function() { this.style.display = 'none'; });
    const label = window.Text(_browseTitleFromUrl(url)).truncate();
    return window.HStack([favImg, label]).className('browse-history-dropdown-item nr-menu-item')
      .onTap(function() { _historyDropdownNavigate(direction, i + 1); _hideHistoryDropdownNow(); });
  });

  const ddView = window.VStack(rows).className('browse-history-dropdown nr-menu')
    .material('thin')
    .on('mouseenter', function() { clearTimeout(_historyDropdownHideTimer); })
    .on('mouseleave', function() { _scheduleHideHistoryDropdown(); });

  const dd = ddView.el;
  document.body.appendChild(dd);
  _historyDropdownEl = dd;
  const rect = buttonEl.getBoundingClientRect();
  dd.style.top = rect.bottom + 4 + 'px';
  dd.style.left = Math.max(4, rect.left - 60) + 'px';
}

export function _scheduleHideHistoryDropdown() {
  clearTimeout(_historyDropdownHideTimer);
  _historyDropdownHideTimer = setTimeout(_hideHistoryDropdownNow, 200);
}

export function _hideHistoryDropdownNow() {
  clearTimeout(_historyDropdownHideTimer);
  if (_historyDropdownEl) { _historyDropdownEl.remove(); _historyDropdownEl = null; }
}

function _historyDropdownNavigate(direction, steps) {
  for (let i = 0; i < steps; i++) {
    if (direction === 'back') browseBack();
    else browseForward();
  }
}

// ── Pure helpers (ported from browse-island.js) ──

export function _browseTitleFromUrl(url) {
  if (url === 'ntp://' || url === 'ntp://newtab') return 'New Tab';
  if (url === 'chat://') return 'Chats';
  if (url === 'netrun://' || url === 'netrun:///') return 'Netrun';
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/search') {
      const q = u.searchParams.get('q');
      return q ? q + ' - Google' : 'Google';
    }
    if (u.protocol === 'file:') return u.pathname.split('/').pop() || 'Local File';
    return u.hostname.replace(/^www\./, '');
  } catch(e) { return url; }
}

export function _browseFaviconUrl(url) {
  try {
    const u = new URL(url);
    return '/api/favicon?domain=' + u.hostname;
  } catch(e) { return ''; }
}

// ── NavButtons View builder ──

export function NavButtons() {
  const backBtn = new window.View('button').className('sidebar-icon pill-island-nav').attr('title', 'Back')
    .html('<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>')
    .onTap(function() { browseBack(); });
  backBtn.el.id = 'pill-browse-back';
  // History dropdown on hover
  backBtn.on('mouseenter', function() { _showHistoryDropdown('back', backBtn.el); });
  backBtn.on('mouseleave', function() { _scheduleHideHistoryDropdown(); });
  // Reactive visibility
  Effect(function() {
    const show = canGoBack.value;
    backBtn.el.style.display = show ? '' : 'none';
    backBtn.el.classList.remove('nav-disabled');
  });

  const fwdBtn = new window.View('button').className('sidebar-icon pill-island-nav').attr('title', 'Forward')
    .html('<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>')
    .onTap(function() { browseForward(); });
  fwdBtn.el.id = 'pill-browse-fwd';
  fwdBtn.on('mouseenter', function() { _showHistoryDropdown('forward', fwdBtn.el); });
  fwdBtn.on('mouseleave', function() { _scheduleHideHistoryDropdown(); });
  Effect(function() {
    const show = canGoForward.value;
    fwdBtn.el.style.display = show ? '' : 'none';
    fwdBtn.el.classList.remove('nav-disabled');
  });

  const reloadBtn = new window.View('button').className('sidebar-icon pill-island-nav').attr('title', 'Refresh')
    .html('<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"/></svg>')
    .onTap(function() { browseReload(); });
  reloadBtn.el.id = 'pill-browse-reload';

  return { backBtn: backBtn, fwdBtn: fwdBtn, reloadBtn: reloadBtn };
}

// ── Zoom controls (ported from browse-island.js) ──

let _browseZoomLevel = 1.0;
let _browseZoomPanX = 0;
let _browseZoomPanY = 0;
let _browseZoomHideTimer = null;

function _browseShowZoomControls() {
  const controls = document.getElementById('browse-zoom-controls');
  if (!controls) return;
  controls.style.display = 'flex';
  clearTimeout(_browseZoomHideTimer);
  _browseZoomHideTimer = setTimeout(function() { controls.style.display = 'none'; }, 1500);
}

export function browseZoom(dir) {
  if (dir === 0) { _browseZoomLevel = 1.0; _browseZoomPanX = 0; _browseZoomPanY = 0; }
  else _browseZoomLevel = Math.min(5.0, Math.max(1.0, _browseZoomLevel + dir * 0.1));
  _browseApplyZoom();
  const po = document.querySelector('.browse-pinch-overlay');
  if (po) po.style.pointerEvents = _browseZoomLevel > 1 ? 'auto' : 'none';
}

export function _browseApplyZoom(focalX, focalY) {
  const el = _browseActiveEl();
  const container = document.getElementById('browse-content');
  if (el && container) {
    if (window._browseIsElectron && el.setZoomFactor) {
      el.setZoomFactor(_browseZoomLevel);
    } else {
      const oldZoom = parseFloat(el.dataset.zoom || '1');
      const newZoom = _browseZoomLevel;
      el.dataset.zoom = newZoom;
      el.style.width = '100%';
      el.style.height = '100%';
      const spacer = container.querySelector('.browse-zoom-spacer');
      if (spacer) spacer.remove();
      if (newZoom <= 1) {
        _browseZoomPanX = 0; _browseZoomPanY = 0;
        el.style.transform = 'none'; el.style.transformOrigin = '';
      } else {
        if (focalX !== undefined && focalY !== undefined && oldZoom !== newZoom) {
          const contentX = (_browseZoomPanX + focalX) / oldZoom;
          const contentY = (_browseZoomPanY + focalY) / oldZoom;
          _browseZoomPanX = contentX * newZoom - focalX;
          _browseZoomPanY = contentY * newZoom - focalY;
        }
        const maxPanX = container.clientWidth * (newZoom - 1);
        const maxPanY = container.clientHeight * (newZoom - 1);
        _browseZoomPanX = Math.max(0, Math.min(maxPanX, _browseZoomPanX));
        _browseZoomPanY = Math.max(0, Math.min(maxPanY, _browseZoomPanY));
        el.style.transformOrigin = '0 0';
        el.style.transform = 'scale(' + newZoom + ') translate(' + (-_browseZoomPanX / newZoom) + 'px, ' + (-_browseZoomPanY / newZoom) + 'px)';
      }
    }
  }
  const label = document.getElementById('browse-zoom-level');
  if (label) label.textContent = Math.round(_browseZoomLevel * 100) + '%';
  _browseShowZoomControls();
}

// ── Action registry ──
registerActions({
  browseBack: function() { browseBack(); },
  browseForward: function() { browseForward(); },
  browseReload: function() { browseReload(); },
  browseZoom: function(_e, arg) { browseZoom(Number(arg)); },
  showHistoryDropdown: function(_e, arg, el) { _showHistoryDropdown(arg, el); },
  scheduleHideHistoryDropdown: function() { _scheduleHideHistoryDropdown(); },
});
