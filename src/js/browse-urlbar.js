// browse-urlbar.js — Orchestrator: imports sub-modules, re-exports for external consumers, window bindings
import Settings from '/js/core/core-settings.js';
import { openUserProfile } from '/js/core/core-profile.js';
import { _aetherShowCursor } from '/js/panel-commands.js';
import { _pillSyncUrl, _pillUrlKeydown, browseNavigate } from '/js/toolbar/toolbar-url.js';
import { _browseFaviconUrl, _browseTitleFromUrl, browseBack, browseForward, browseReload } from '/js/toolbar/toolbar-nav.js';
import { browseNewTab, browseSelectWindow, openBrowse, openLocalPdfDialog } from '/js/browse/browse-windows.js';
import { _browseUpdateNewTabPage, browseCloseTab, browseReopenTab, browseSelectTab } from '/js/browse/browse-passwords.js';
import { _relativeTime, submitSearch } from '/js/search.js';
import { browsePrintPage } from '/js/toolbar/toolbar-menu.js';
import { chatViewNewThread, chatViewUnmorph, openChatPage } from '/js/chat-view.js';
import { drawViewUnmorph } from '/js/draw-view.js';

// ── Re-exports from urlbar-instant.js ──
export {
  _computeInstantAnswer, _tryMathAnswer, _tryColorAnswer, _tryConversionAnswer,
  _tzCityMap, _tryTimezoneAnswer,
  _fetchWeatherAnswer, _weatherEmoji,
  _sportsLeagues, _sportsTeams, _matchSportsQuery, _fetchSportsAnswer,
  _fetchStockAnswer,
  _instantAnswer, _instantDebounce, _instantCache,
} from '/js/urlbar/urlbar-instant.js';

// ── Re-exports from urlbar-history.js ──
export {
  _getWebSearchHistory, _saveWebSearch, _removeWebSearch, _clearWebSearchHistory,
  _getBrowseHistory, _saveBrowseVisit, _removeBrowseVisit, _clearBrowseHistory,
  openSearchHistoryPage, openHelpPage, _renderHelpPage,
  _historyPageTab, _renderWebSearchHistoryPage, _filterWebSearchHistory,
  _renderWebSearchHistoryListView, _renderBrowseHistoryListView,
} from '/js/urlbar/urlbar-history.js';

// ── Re-exports from urlbar-permissions.js ──
export {
  toggleAdBlock, _browseUpdateAdBlockBtn, toggleDoH, _browseUpdateDohBtn,
  _browseUpdateAdBlockBadge,
  _SITE_PERM_KEYS, _SITE_PERM_LABELS, _SITE_PERM_PROMPTS,
  _SITE_PERM_ICONS, _SITE_PERM_ICONS_LG,
  _getSitePermissions, _setSitePermission, _getAllSitePermissions, _clearSitePermissions,
  _getCurrentBrowseDomain, _showPermissionPrompt,
  _sessionPermissions, _getEffectivePermissions, _renderSitePermissionsDropdown,
  toggleTrackingStrip, toggleHttpsOnly, toggleCookieBlock,
} from '/js/urlbar/urlbar-permissions.js';

// ── Re-exports from urlbar-dropdown.js ──
export {
  _URL_BAR_SECTIONS, _QUICK_OPEN_VIEWS, _getUrlBarSections, _saveUrlBarSections,
  _browseUrlHistIdx, _browseUrlOriginalInput,
  _suggestDebounce, _suggestAbort, _suggestCache, _currentSuggestions,
  _defCache, _defDebounce, _currentDef, _currentChatThreads,
  _browseUrlAutocompleteSuggestion, _browseUrlTypedLength, _browseUrlAcSuppressed,
  _browseUrlGetAutocomplete, _browseUrlApplyAutocomplete, _browseUrlClearAutocomplete,
  _getOmniInput, _browseUrlKeydown, _browseUrlHighlight,
  _browseUrlShowHistory, _browseUrlRenderHistoryCommand,
  _BANG_LABELS, _ddSectionHeader, _ddSvgIcon, _ddFaviconWithFallback,
  _browseUrlRenderDropdown,
  _fetchSearchSuggestions, _fetchWordDefinition,
  _browseUrlHideTimeout, _browseUrlScheduleHide, _browseUrlCancelHide,
  _browseUrlHideHistory,
} from '/js/urlbar/urlbar-dropdown.js';

// ── Imports for local use ──
import { _browseUrlKeydown as _urlKeydown, _browseUrlShowHistory as _urlShowHistory, _browseUrlCancelHide as _urlCancelHide, _browseUrlScheduleHide as _urlScheduleHide, _browseUrlHideHistory as _urlHideHistory } from '/js/urlbar/urlbar-dropdown.js';
import { _browseUrlClearAutocomplete as _urlClearAc } from '/js/urlbar/urlbar-dropdown.js';
import { openSearchHistoryPage as _openSearchHistoryPage } from '/js/urlbar/urlbar-history.js';

// ── URL Shortening ──

export function _browseUrlDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function _browseShortUrl(url) {
  const domain = _browseUrlDomain(url);
  const tab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
    ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
  if (tab && tab.title && tab.title !== _browseTitleFromUrl(tab.url)) {
    return domain + '  /  ' + tab.title;
  }
  return domain;
}

export function _browseAutoSizeUrlInput(input) {
  if (!input || input.id !== 'pill-browse-url-input') return;
  const pill = document.getElementById('sidebar-nav');
  if (!pill || !pill.classList.contains('island-mode')) return;
  const canvas = _browseAutoSizeUrlInput._c || (_browseAutoSizeUrlInput._c = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  ctx.font = getComputedStyle(input).font;
  const text = input.value || input.placeholder || '';
  const w = Math.ceil(ctx.measureText(text).width) + 24; // 24 for padding
  const isPopupOpen = !!window._urlPopupEl;
  const isFocused = document.activeElement === input || isPopupOpen;
  const maxW = isPopupOpen ? 600 : isFocused ? 420 : 320;
  input.style.width = Math.min(Math.max(w, 80), maxW) + 'px';
  input.style.maxWidth = isPopupOpen ? 'none' : '';
}
window._browseAutoSizeUrlInput = _browseAutoSizeUrlInput;

export function _browseSetUrlDisplay(input, url) {
  if (!input) return;
  input.dataset.fullUrl = url || '';
  if (document.activeElement === input || input.matches(':hover')) {
    input.value = url || '';
  } else if (Settings.get('urlShorten') !== 'false' && url && !url.startsWith('netrun://')) {
    input.value = _browseShortUrl(url);
  } else {
    input.value = url || '';
  }
  _browseAutoSizeUrlInput(input);
}
window._browseSetUrlDisplay = _browseSetUrlDisplay;

export function _browseUrlOnFocus(input) {
  const full = input.dataset.fullUrl;
  if (full) input.value = full;
  _browseAutoSizeUrlInput(input);
}

export function _browseUrlOnBlur(input) {
  _urlClearAc();
  const full = input.dataset.fullUrl || input.value;
  input.dataset.fullUrl = full;
  if (Settings.get('urlShorten') !== 'false' && full && !full.startsWith('netrun://')) {
    input.value = _browseShortUrl(full);
  }
  _browseAutoSizeUrlInput(input);
}

export function _browseUrlOnMouseEnter(input) {
  if (document.activeElement === input) return;
  const full = input.dataset.fullUrl;
  if (full) input.value = full;
  _browseAutoSizeUrlInput(input);
}

export function _browseUrlOnMouseLeave(input) {
  if (document.activeElement === input) return;
  const full = input.dataset.fullUrl || input.value;
  if (Settings.get('urlShorten') !== 'false' && full && !full.startsWith('netrun://')) {
    input.value = _browseShortUrl(full);
  }
  _browseAutoSizeUrlInput(input);
}

// ── Adaptive URL Bar Color ──

export function _browseParseColor(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();
  // Hex
  const hex = str.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length === 6 || h.length === 8) {
      return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
    }
  }
  // rgb/rgba
  const rgb = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return null;
}

export function _browseApplyAdaptiveColor(tab) {
  if (Settings.get('adaptiveUrlBar') === 'off') {
    _browseResetAdaptiveColor();
    return;
  }
  const color = tab && tab.themeColor ? _browseParseColor(tab.themeColor) : null;
  if (!color) {
    _browseResetAdaptiveColor();
    return;
  }
  const el = document.documentElement;
  el.style.setProperty('--nr-bg-body', `rgb(${color.r},${color.g},${color.b})`);
  // Adaptive text: flip text tokens to contrast with the adaptive background
  _browseApplyAdaptiveText(color);
}

// Compute relative luminance (sRGB → linear → BT.709)
function _relativeLuminance(r, g, b) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Set text + tint + aether token overrides to guarantee contrast against adaptive bg
export function _browseApplyAdaptiveText(color) {
  if (!color) return;
  const { r, g, b } = color;
  const lum = _relativeLuminance(r, g, b);
  const el = document.documentElement;
  if (lum > 0.4) {
    // Light background → dark text & dark tints
    el.style.setProperty('--nr-text-primary',    'rgba(0,0,0,0.85)');
    el.style.setProperty('--nr-text-secondary',   'rgba(0,0,0,0.60)');
    el.style.setProperty('--nr-text-tertiary',    'rgba(0,0,0,0.50)');
    el.style.setProperty('--nr-text-quaternary',  'rgba(0,0,0,0.35)');
    el.style.setProperty('--nr-tint',             'rgba(0,0,0,0.07)');
    el.style.setProperty('--nr-tint-strong',      'rgba(0,0,0,0.12)');
    // Aether panel vars (island, pill bar, etc.)
    el.style.setProperty('--aether-text',          'rgba(0,0,0,0.85)');
    el.style.setProperty('--aether-text-secondary', 'rgba(0,0,0,0.60)');
    el.style.setProperty('--aether-text-dim',      'rgba(0,0,0,0.50)');
    el.style.setProperty('--aether-text-dimmer',   'rgba(0,0,0,0.35)');
    el.style.setProperty('--aether-text-dimmest',  'rgba(0,0,0,0.20)');
    el.style.setProperty('--aether-text-muted',    'rgba(0,0,0,0.50)');
    el.style.setProperty('--aether-placeholder',   'rgba(0,0,0,0.35)');
    el.style.setProperty('--aether-border',        'rgba(0,0,0,0.10)');
    el.style.setProperty('--aether-hover',         'rgba(0,0,0,0.05)');
    el.style.setProperty('--aether-hover-subtle',  'rgba(0,0,0,0.04)');
    el.style.setProperty('--aether-scrollbar',     'rgba(0,0,0,0.12)');
    // Adaptive dropdown bg — light frosted surface for light pages
    el.style.setProperty('--aether-dropdown-bg', `rgba(${Math.min(r+20,255)},${Math.min(g+20,255)},${Math.min(b+20,255)},0.95)`);
  } else if (lum < 0.15) {
    // Dark background → light text & light tints
    el.style.setProperty('--nr-text-primary',    'rgba(255,255,255,0.90)');
    el.style.setProperty('--nr-text-secondary',   'rgba(255,255,255,0.60)');
    el.style.setProperty('--nr-text-tertiary',    'rgba(255,255,255,0.50)');
    el.style.setProperty('--nr-text-quaternary',  'rgba(255,255,255,0.35)');
    el.style.setProperty('--nr-tint',             'rgba(255,255,255,0.10)');
    el.style.setProperty('--nr-tint-strong',      'rgba(255,255,255,0.15)');
    // Aether panel vars
    el.style.setProperty('--aether-text',          'rgba(255,255,255,0.90)');
    el.style.setProperty('--aether-text-secondary', 'rgba(255,255,255,0.60)');
    el.style.setProperty('--aether-text-dim',      'rgba(255,255,255,0.50)');
    el.style.setProperty('--aether-text-dimmer',   'rgba(255,255,255,0.35)');
    el.style.setProperty('--aether-text-dimmest',  'rgba(255,255,255,0.20)');
    el.style.setProperty('--aether-text-muted',    'rgba(255,255,255,0.50)');
    el.style.setProperty('--aether-placeholder',   'rgba(255,255,255,0.35)');
    el.style.setProperty('--aether-border',        'rgba(255,255,255,0.08)');
    el.style.setProperty('--aether-hover',         'rgba(255,255,255,0.08)');
    el.style.setProperty('--aether-hover-subtle',  'rgba(255,255,255,0.06)');
    el.style.setProperty('--aether-scrollbar',     'rgba(255,255,255,0.12)');
    // Adaptive dropdown bg — dark frosted surface for dark pages
    el.style.setProperty('--aether-dropdown-bg', `rgba(${Math.max(r-10,0)},${Math.max(g-10,0)},${Math.max(b-10,0)},0.95)`);
  } else {
    // Mid-range — let theme tokens handle it
    _browseResetAdaptiveText();
  }
}

export function _browseResetAdaptiveColor() {
  document.documentElement.style.removeProperty('--nr-bg-body');
  _browseResetAdaptiveText();
}

const _adaptiveTextProps = [
  '--nr-text-primary', '--nr-text-secondary', '--nr-text-tertiary',
  '--nr-text-quaternary', '--nr-tint', '--nr-tint-strong',
  '--aether-text', '--aether-text-secondary', '--aether-text-dim',
  '--aether-text-dimmer', '--aether-text-dimmest', '--aether-text-muted',
  '--aether-placeholder', '--aether-border', '--aether-hover',
  '--aether-hover-subtle', '--aether-scrollbar', '--aether-dropdown-bg'
];
function _browseResetAdaptiveText() {
  const el = document.documentElement;
  for (const p of _adaptiveTextProps) el.style.removeProperty(p);
}

// ── Window bindings ──
window.submitSearch = submitSearch;
window.openUserProfile = openUserProfile;
window.openSearchHistoryPage = _openSearchHistoryPage;

// ── Listen for browse commands from Electron main process ──
if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onBrowseCommand) {
  window.electronAPI.onBrowseCommand((event, command) => {
    const browseView = document.getElementById('browse-view');
    const browseHidden = !browseView || browseView.style.display !== 'flex';
    // open-file works even when browse isn't open
    if (command === 'open-file') {
      if (browseHidden && typeof openBrowse === 'function') openBrowse();
      if (typeof openLocalPdfDialog === 'function') {
        if (browseHidden) setTimeout(openLocalPdfDialog, 50);
        else openLocalPdfDialog();
      }
      return;
    }
    // new-tab works globally — always opens NTP regardless of current view
    if (command === 'new-tab') {
      if (browseHidden && typeof openBrowse === 'function') openBrowse();
      const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
      const active = win && win.tabs && win.tabs.find(t => t.id === win.activeTab);
      if (active && active.blank) {
        const inp = document.querySelector('.browse-ntp #search-query');
        if (inp) { inp.focus(); inp.select(); }
      } else {
        if (typeof browseNewTab === 'function') browseNewTab();
      }
      return;
    }

    if (browseHidden) return;

    // Dismiss aether panel on any browse command
    const _cmdPopup = document.getElementById('doc-chat-ask-float');
    if (_cmdPopup) { _cmdPopup.remove(); window._aetherTrackMode = false; _aetherShowCursor(); }

    if (command === 'reload') {
      if (typeof browseReload === 'function') browseReload();
    } else if (command === 'force-reload') {
      if (typeof browseReload === 'function') browseReload();
    } else if (command === 'close-tab') {
      const win = window._getCurrentWindow();
      if (win && win.activeTab) {
        // If the active tab is in chat-mode or draw-mode, unmorph back to NTP instead of closing
        const _activeTab = win.tabs.find(t => t.id === win.activeTab);
        if (_activeTab && _activeTab._chatPage && typeof chatViewUnmorph === 'function') {
          chatViewUnmorph();
        } else if (_activeTab && _activeTab._drawPage && typeof drawViewUnmorph === 'function') {
          drawViewUnmorph();
        } else {
          browseCloseTab(win.activeTab);
        }
      }
    } else if (command === 'reopen-tab') {
      browseReopenTab();
    } else if (command === 'print') {
      if (typeof browsePrintPage === 'function') {
        browsePrintPage();
      }
    } else if (command === 'back') {
      browseBack();
    } else if (command === 'forward') {
      browseForward();
    }
  });
}

// ── Image paste in URL bars → open Aether panel with image ──
function _urlBarImagePaste(ev) {
  if (!ev.clipboardData || !ev.clipboardData.items) return;
  for (const item of ev.clipboardData.items) {
    if (item.type.startsWith('image/')) {
      ev.preventDefault();
      const blob = item.getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = function() {
        const base64 = reader.result.split(',')[1];
        if (!base64) return;
        // Lazy import to avoid circular dependency with panel.js
        Promise.all([import('/js/panel.js'), import('/js/panel-chat.js')]).then(([panelMod, chatMod]) => {
          panelMod._showPanel({ anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 } });
          requestAnimationFrame(function() {
            const popup = document.getElementById('doc-chat-ask-float');
            if (popup) chatMod._addScreenshotToPanel(popup, base64);
          });
        });
      };
      reader.readAsDataURL(blob);
      return;
    }
  }
}

// ── Bind URL bar events via addEventListener ──
function _initUrlBarEvents() {
  // Main browse URL input
  const browseInput = document.getElementById('browse-url-input');
  if (browseInput) {
    browseInput.addEventListener('keydown', (e) => _urlKeydown(e));
    browseInput.addEventListener('input', () => _urlShowHistory());
    browseInput.addEventListener('focus', function () {
      _browseUrlOnFocus(this);
      _urlCancelHide();
      this.select();
      _urlShowHistory();
    });
    browseInput.addEventListener('blur', function () {
      _browseUrlOnBlur(this);
      _urlScheduleHide();
    });
    browseInput.addEventListener('mouseenter', function () { _browseUrlOnMouseEnter(this); });
    browseInput.addEventListener('mouseleave', function () { _browseUrlOnMouseLeave(this); });
    browseInput.addEventListener('paste', _urlBarImagePaste);
  }

  // Pill URL input
  const pillInput = document.getElementById('pill-browse-url-input');
  if (pillInput) {
    pillInput.addEventListener('keydown', (e) => _pillUrlKeydown(e));
    pillInput.addEventListener('input', () => _urlShowHistory());
    pillInput.addEventListener('focus', function () {
      _browseUrlOnFocus(this);
      this.select();
      const v = this.value;
      this.value = '';
      _urlShowHistory();
      this.value = v;
      this.select();
    });
    pillInput.addEventListener('blur', function () {
      _browseUrlOnBlur(this);
      _pillSyncUrl();
      _urlScheduleHide();
    });
    pillInput.addEventListener('paste', _urlBarImagePaste);
  }

  // Pill URL wrap hover
  const pillWrap = document.getElementById('pill-url-wrap');
  if (pillWrap) {
    pillWrap.addEventListener('mouseenter', () => {
      const inp = document.getElementById('pill-browse-url-input');
      if (inp) _browseUrlOnMouseEnter(inp);
    });
    pillWrap.addEventListener('mouseleave', () => {
      const inp = document.getElementById('pill-browse-url-input');
      if (inp) _browseUrlOnMouseLeave(inp);
    });
  }

  // Pill URL dropdown
  const pillDropdown = document.getElementById('pill-url-dropdown');
  if (pillDropdown) {
    pillDropdown.addEventListener('mousedown', (e) => {
      e.preventDefault();
      _urlCancelHide();
    });
  }

  // Popup dropdown: prevent blur-triggered hide when clicking inside popup
  document.addEventListener('mousedown', (e) => {
    if (window._urlPopupEl && window._urlPopupEl.contains(e.target)) {
      e.preventDefault();
      _urlCancelHide();
    }
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initUrlBarEvents);
  } else {
    _initUrlBarEvents();
  }
}
