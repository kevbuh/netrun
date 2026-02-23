// browse-urlbar.js — URL bar, instant answers, history, ad blocker
import Settings from '/js/core/core-settings.js';
import { apiPost, apiGet } from '/js/api.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { openUserProfile } from '/js/core/core-profile.js';
import { islandUpdate, islandRemove } from '/js/core/core-ui.js';
import { _browseRenderTabs } from '/js/toolbar/toolbar-tabs.js';
import { _BANGS, _pillSyncUrl, _pillUrlKeydown, browseNavigate } from '/js/toolbar/toolbar-url.js';
import { _browseFaviconUrl, _browseTitleFromUrl, browseBack, browseForward, browseReload } from '/js/toolbar/toolbar-nav.js';
import { _HELP_DATA } from '/js/settings/settings-helpers.js';
import { _aetherShowCursor } from '/js/panel-commands.js';
import { _browseApplyPermissions, _browseProxyUrl } from '/js/browse/browse-ntp.js';
import { _browseUpdateNewTabPage, browseCloseTab, browseReopenTab, browseSelectTab } from '/js/browse/browse-passwords.js';
import { _relativeTime, submitSearch } from '/js/search.js';
import { browseNewTab, browseSelectWindow, openBrowse, openLocalPdfDialog } from '/js/browse/browse-windows.js';
import { browsePrintPage } from '/js/toolbar/toolbar-menu.js';
import { chatViewNewThread, chatViewUnmorph, openChatPage } from '/js/chat-view.js';
import { drawViewUnmorph } from '/js/draw-view.js';

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
  // When island is expanded, URL input is full-width via CSS grid — don't override
  const wrap = document.getElementById('pill-url-wrap');
  if (wrap && wrap.classList.contains('island-expanded')) {
    input.style.width = '';
    input.style.maxWidth = '';
    input.style.opacity = '';
    return;
  }
  const canvas = _browseAutoSizeUrlInput._c || (_browseAutoSizeUrlInput._c = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  ctx.font = getComputedStyle(input).font;
  const text = input.value || input.placeholder || '';
  const w = Math.ceil(ctx.measureText(text).width) + 24; // 24 for padding
  const isFocused = document.activeElement === input;
  const maxW = isFocused ? 420 : 320;
  input.style.width = Math.min(Math.max(w, 80), maxW) + 'px';
}

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

export function _browseUrlOnFocus(input) {
  const full = input.dataset.fullUrl;
  if (full) input.value = full;
  _browseAutoSizeUrlInput(input);
}

export function _browseUrlOnBlur(input) {
  _browseUrlClearAutocomplete();
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
function _browseApplyAdaptiveText({ r, g, b }) {
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

// ── Browse URL Bar History Dropdown ──

export const _URL_BAR_SECTIONS = [
  { key: 'quickopen',  label: 'Quick Open' },
  { key: 'chat',       label: 'Chat' },
  { key: 'search',     label: 'Search' },
  { key: 'bangs',      label: 'Bangs' },
  { key: 'definition', label: 'Definition' },
  { key: 'instant',    label: 'Instant Answers' },
  { key: 'recent',     label: 'Recent Sites' },
  { key: 'suggestions',label: 'Suggestions' },
  { key: 'projects',   label: 'Projects' },
  { key: 'users',      label: 'Users' },
  { key: 'threads',    label: 'Chat History' },
  { key: 'notes',      label: 'Notes' },
  { key: 'history',    label: 'Search History' },
  { key: 'lucky',      label: 'Feeling Lucky' },
];

const _QUICK_OPEN_VIEWS = [
  // ── Main views ──
  { key: 'feed',      label: 'Feed',      aliases: ['feed'],               icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/>' },
  { key: 'chat',      label: 'Chat',      aliases: ['chat', 'ai'],         icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>' },
  { key: 'browse',    label: 'Browse',    aliases: ['browse', 'web'],      icon: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke-linecap="round" stroke-linejoin="round"/>' },
  { key: 'docs',      label: 'Docs',      aliases: ['docs', 'documents'],  icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>' },
  { key: 'settings',  label: 'Settings',  aliases: ['settings', 'prefs', 'preferences'], icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>' },
  { key: 'dashboard', label: 'Dashboard', aliases: ['dashboard', 'home'],  icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/>' },
  { key: 'inbox',     label: 'Inbox',     aliases: ['inbox', 'notifications', 'messages'], icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3"/>' },
  { key: 'draw',      label: 'Draw',      aliases: ['draw', 'canvas', 'sketch'], icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.764m3.42 3.42a6.776 6.776 0 00-3.42-3.42"/>' },
  { key: 'neuralook', label: 'Neuralook', aliases: ['neuralook', 'neural', 'ml', 'machine learning'], icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/>' },
  { key: 'dev',       label: 'Dev Stats',  aliases: ['dev', 'developer', 'stats'], icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"/>' },
  { key: 'history',   label: 'History',   aliases: ['history'], action: 'history', icon: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/>' },
  // ── Features ──
  { key: 'terminal',  label: 'Terminal',  aliases: ['terminal', 'console', 'shell'], action: 'terminal', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"/>' },
  { key: 'research',  label: 'Research',  aliases: ['research', 'search'], action: 'research', icon: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/>' },
  { key: 'downloads', label: 'Downloads', aliases: ['downloads'], action: 'downloads', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>' },
  { key: 'newtab',    label: 'New Tab',   aliases: ['new tab', 'newtab', 'tab'], action: 'newtab', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>' },
  // ── Settings sub-sections ──
  { key: 'appearance', label: 'Appearance', aliases: ['appearance', 'theme', 'themes', 'colors'], action: 'settings:appearance', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z"/>' },
  { key: 'ai-settings', label: 'AI Settings', aliases: ['ai settings', 'llm', 'models', 'providers'], action: 'settings:ai', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"/>' },
  { key: 'browser-settings', label: 'Browser Settings', aliases: ['browser settings', 'bookmarks', 'passwords'], action: 'settings:browser', icon: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke-linecap="round" stroke-linejoin="round"/>' },
  // ── Fun ──
  { key: 'pixelpet',  label: 'Pixel Pet', aliases: ['pixel pet', 'pixelpet', 'pet'], action: 'pixelpet', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z"/>' },
  { key: 'netrunner', label: 'Netrunner', aliases: ['netrunner', 'game', 'konami'], action: 'netrunner', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z"/>' },
];

export function _getUrlBarSections() {
  let saved = null;
  try { saved = Settings.getJSON('urlBarSections', null); } catch {}
  if (!Array.isArray(saved)) return _URL_BAR_SECTIONS.map(s => ({ key: s.key, label: s.label, enabled: true }));
  const result = [];
  const seen = new Set();
  for (const s of saved) {
    const def = _URL_BAR_SECTIONS.find(d => d.key === s.key);
    if (def && !seen.has(s.key)) {
      seen.add(s.key);
      result.push({ key: s.key, label: def.label, enabled: s.enabled !== false });
    }
  }
  for (const d of _URL_BAR_SECTIONS) {
    if (!seen.has(d.key)) result.push({ key: d.key, label: d.label, enabled: true });
  }
  return result;
}

export function _saveUrlBarSections(sections) {
  Settings.setJSON('urlBarSections', sections.map(s => ({ key: s.key, enabled: s.enabled })));
}

export let _browseUrlHistIdx = -1;
export let _browseUrlOriginalInput = '';
export let _suggestDebounce = null;
export let _suggestAbort = null;
export const _suggestCache = {};
export let _currentSuggestions = [];
export const _defCache = {};
export let _defDebounce = null;
export let _currentDef = null; // cached definition entry for current word
export let _currentChatThreads = []; // cached chat threads matching filter
export let _instantAnswer = null; // { type, html } for non-definition instant answers
export let _instantDebounce = null;
export const _instantCache = {};

// ── Inline Autocomplete (Chrome-style selection) ──

export let _browseUrlAutocompleteSuggestion = ''; // full domain suggestion currently shown
export let _browseUrlTypedLength = 0; // length of the user's actual typed text
export let _browseUrlAcSuppressed = false; // suppress re-autocomplete after delete

export function _browseUrlGetAutocomplete(filter) {
  if (!filter || filter.includes(' ') || filter.startsWith('/')) return '';
  const lf = filter.toLowerCase();
  const browseHist = _getBrowseHistory();
  let best = '';
  let bestTs = 0;
  for (const h of browseHist) {
    try {
      const u = new URL(h.url);
      const domain = u.hostname.replace(/^www\./, '');
      if (domain.toLowerCase().startsWith(lf) && (h.ts || 0) > bestTs) {
        best = domain;
        bestTs = h.ts || 0;
      }
    } catch { /* skip invalid */ }
  }
  // Also check common TLDs for bare words (e.g. "x" → "x.com")
  if (!best) {
    const tlds = ['.com', '.org', '.net', '.io', '.dev', '.ai', '.co'];
    for (const tld of tlds) {
      const candidate = lf + tld;
      for (const h of browseHist) {
        try {
          const domain = new URL(h.url).hostname.replace(/^www\./, '').toLowerCase();
          if (domain === candidate && (h.ts || 0) > bestTs) {
            best = domain;
            bestTs = h.ts || 0;
          }
        } catch { /* skip */ }
      }
      if (best) break;
    }
  }
  return best;
}

export function _browseUrlApplyAutocomplete(input, suggestion) {
  if (!input) return;
  const typed = input.value;
  if (!suggestion || suggestion.toLowerCase() === typed.toLowerCase()) {
    _browseUrlAutocompleteSuggestion = '';
    return;
  }
  _browseUrlAutocompleteSuggestion = suggestion;
  _browseUrlTypedLength = typed.length;
  // Set the full suggestion as the value, then select only the suffix
  input.value = typed + suggestion.slice(typed.length);
  input.setSelectionRange(typed.length, suggestion.length);
}

export function _browseUrlClearAutocomplete() {
  _browseUrlAutocompleteSuggestion = '';
  _browseUrlTypedLength = 0;
}

// Returns the active omnibox input & dropdown elements (NTP search or URL bar)
export function _getOmniInput() {
  // NTP check first: if the NTP is visible, use its search input + dropdown
  const ntpEl = document.getElementById('browse-content')?.querySelector('.browse-ntp');
  if (ntpEl && ntpEl.style.display !== 'none') {
    const input = document.getElementById('search-query');
    const dd = document.getElementById('search-history-dropdown-view');
    if (input && dd) return { input, dd, ntp: true };
  }
  // Island mode: use pill input + pill dropdown (or center column when expanded)
  const nav = document.getElementById('sidebar-nav');
  if (nav && nav.classList.contains('island-mode') && nav.classList.contains('browse-mode')) {
    const pillInput = document.getElementById('pill-browse-url-input');
    const pillWrap = document.getElementById('pill-url-wrap');
    const isExpanded = pillWrap && pillWrap.classList.contains('island-expanded');
    if (isExpanded) {
      const centerCol = document.getElementById('pill-island-center');
      if (pillInput && centerCol) return { input: pillInput, dd: centerCol, ntp: false, island: true, islandCenter: true };
    }
    const pillDd = document.getElementById('pill-url-dropdown');
    if (pillInput && pillDd) return { input: pillInput, dd: pillDd, ntp: false, island: true };
  }
  const bar = document.getElementById('browse-bar');
  if (bar && bar.style.display === 'none') {
    const input = document.getElementById('search-query');
    const dd = document.getElementById('search-history-dropdown-view');
    if (input && dd) return { input, dd, ntp: true };
  }
  return { input: document.getElementById('browse-url-input'), dd: document.getElementById('browse-url-history-dd'), ntp: false };
}

export function _browseUrlKeydown(e) {
  const { input, dd, ntp, island } = _getOmniInput();
  const visible = island
    ? !!(document.getElementById('pill-url-wrap') && document.getElementById('pill-url-wrap').classList.contains('pill-dropdown-open'))
    : dd && dd.style.display !== 'none' && !dd.classList.contains('hidden');

  // Backspace/Delete: clear autocomplete, keep only the typed portion
  if ((e.key === 'Backspace' || e.key === 'Delete') && _browseUrlAutocompleteSuggestion) {
    e.preventDefault();
    if (input) {
      input.value = input.value.slice(0, _browseUrlTypedLength);
      input.setSelectionRange(_browseUrlTypedLength, _browseUrlTypedLength);
    }
    _browseUrlClearAutocomplete();
    _browseUrlAcSuppressed = true;
    // Dispatch input event so oninput handler re-renders dropdown (with suppression flag active)
    if (input) input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Tab: accept inline autocomplete suggestion
  if (e.key === 'Tab' && _browseUrlAutocompleteSuggestion) {
    e.preventDefault();
    if (input) {
      input.value = _browseUrlAutocompleteSuggestion;
      input.setSelectionRange(input.value.length, input.value.length);
    }
    _browseUrlClearAutocomplete();
    _browseAutoSizeUrlInput(input);
    return;
  }

  if (e.key === 'Enter') {
    if (visible && _browseUrlHistIdx >= 0) {
      e.preventDefault();
      const items = dd.querySelectorAll('[data-histq]');
      if (items[_browseUrlHistIdx]) {
        const q = items[_browseUrlHistIdx].dataset.histq;
        _browseUrlHideHistory();
        if (q.startsWith('chat:')) {
          if (typeof chatViewNewThread === 'function') chatViewNewThread(q.slice(5));
        } else if (q.startsWith('project:')) {
          openExperimentDetail(q.slice(8));
        } else {
          browseNavigate(q);
        }
      }
    } else if (ntp) {
      // NTP: hide dropdown, let form onsubmit (submitSearch) handle Enter
      _browseUrlHideHistory();
    } else {
      _browseUrlHideHistory();
      browseNavigate(input ? input.value : '');
    }
    return;
  }
  if (!visible) return;
  _browseUrlClearAutocomplete();
  const items = dd.querySelectorAll('[data-histq]');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (_browseUrlHistIdx === -1) _browseUrlOriginalInput = input ? input.value : '';
    _browseUrlHistIdx = Math.min(_browseUrlHistIdx + 1, items.length - 1);
    _browseUrlHighlight(items);
    if (input && _browseUrlHistIdx >= 0 && items[_browseUrlHistIdx]) {
      const q = items[_browseUrlHistIdx].dataset.histq;
      input.value = q.startsWith('project:') ? items[_browseUrlHistIdx].querySelector('span').textContent : q.startsWith('chat:') ? q.slice(5) : q;
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _browseUrlHistIdx = Math.max(_browseUrlHistIdx - 1, -1);
    _browseUrlHighlight(items);
    if (input) {
      if (_browseUrlHistIdx === -1) {
        input.value = _browseUrlOriginalInput;
      } else if (items[_browseUrlHistIdx]) {
        const q = items[_browseUrlHistIdx].dataset.histq;
        input.value = q.startsWith('project:') ? items[_browseUrlHistIdx].querySelector('span').textContent : q.startsWith('chat:') ? q.slice(5) : q;
      }
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    // Restore just the typed portion if autocomplete was active
    if (_browseUrlAutocompleteSuggestion && input) {
      input.value = input.value.slice(0, _browseUrlTypedLength);
    }
    _browseUrlClearAutocomplete();
    _browseUrlHideHistory();
  }
}

export function _browseUrlHighlight(items) {
  items.forEach((el, i) => {
    if (i === _browseUrlHistIdx) {
      el.style.background = 'color-mix(in srgb, var(--nr-accent) 18%, transparent)';
      el.style.borderRadius = '6px';
    } else {
      el.style.background = 'none';
      el.style.borderRadius = '';
    }
  });
  if (_browseUrlHistIdx >= 0 && items[_browseUrlHistIdx]) {
    items[_browseUrlHistIdx].scrollIntoView({ block: 'nearest' });
  }
}

export let _feelingLuckyQuery = '';
export let _feelingLuckyLoading = false;

export function _browseUrlFeelingLucky() {
  const { input, dd } = _getOmniInput();
  _feelingLuckyLoading = true;
  _feelingLuckyQuery = '';
  _browseUrlRenderLuckyRow(dd);
  const model = Settings.get('chatModel') || 'qwen2.5:3b';
  islandUpdate('ai-lucky', { type: 'ai', label: model, detail: 'Feeling Lucky \u00B7 ' + model });
  apiPost('/api/doc-chat', {
    messages: [{ role: 'user', content: 'Give me a single interesting, surprising, or obscure topic to search on the web right now. Just reply with the search query, nothing else. No quotes. Be creative and varied — pick from science, history, art, philosophy, technology, nature, space, culture, or anything fascinating. Do not repeat yourself.' }],
    model: model
  }).then(result => {
    if (!result || !result._stream) { _feelingLuckyLoading = false; _browseUrlRenderLuckyRow(dd); return; }
    const handler = (_ev, sid, evt) => {
      if (sid !== result.sessionId) return;
      if (evt.event === 'token') {
        _feelingLuckyQuery += (evt.data || '');
        _browseUrlRenderLuckyRow(dd);
      } else if (evt.event === 'done' || evt.event === 'error') {
        window.electronAPI.removeDocChatEventListener(handler);
        islandRemove('ai-lucky');
        _feelingLuckyLoading = false;
        _feelingLuckyQuery = _feelingLuckyQuery.replace(/^["']|["']$/g, '').trim();
        _browseUrlRenderLuckyRow(dd);
      }
    };
    window.electronAPI.onDocChatEvent(handler);
  }).catch(() => { _feelingLuckyLoading = false; _browseUrlRenderLuckyRow(dd); });
}

export function _browseUrlRenderLuckyRow(dd) {
  // Re-render the full dropdown so styles (pointer-events, redo btn) update
  _browseUrlShowHistory();
}

export function _browseUrlShowHistory() {
  const { input, dd, ntp, islandCenter } = _getOmniInput();
  if (!input || !dd) return;
  // When autocomplete was active and user types, the selection gets replaced.
  // Detect this: if cursor is NOT at the autocomplete boundary, user typed new input.
  let rawVal = input.value || '';
  if (_browseUrlAutocompleteSuggestion) {
    if (input.selectionStart !== _browseUrlTypedLength) {
      // User typed something new — reset autocomplete state
      _browseUrlClearAutocomplete();
    } else {
      // Autocomplete still active — use only the typed portion as filter
      rawVal = rawVal.slice(0, _browseUrlTypedLength);
    }
  }
  const filter = rawVal.trim().toLowerCase();

  // In expanded island mode, only show dropdown when user is actually typing
  if (!filter && islandCenter) {
    _islandCenterRestorePageInfo();
    return;
  }

  // Don't show dropdown on blank new-tab pages with no input (URL bar only, NTP always shows)
  if (!filter && !ntp) {
    const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
    const tab = win?.tabs?.find(t => t.id === win.activeTab);
    if (tab && tab.blank) {
      const _pw = document.getElementById('pill-url-wrap');
      if (_pw) _pw.classList.remove('pill-dropdown-open');
      dd.style.display = 'none';
      return;
    }
  }

  // /history command — show browsing history in the dropdown
  if (filter === '/history') {
    _browseUrlRenderHistoryCommand(dd, input);
    return;
  }

  // Search history matches
  const hist = _getWebSearchHistory();
  const filteredHist = filter ? hist.filter(h => h.q.toLowerCase().includes(filter)) : hist;
  let showHist = filteredHist.slice(0, 8);
  if (showHist.length === 1 && showHist[0].q.toLowerCase() === filter) showHist = [];

  // Browsing history matches
  const browseHist = _getBrowseHistory();
  const filteredBrowse = filter ? browseHist.filter(h => {
    const t = (h.title || '').toLowerCase();
    const u = (h.url || '').toLowerCase();
    return t.includes(filter) || u.includes(filter);
  }) : browseHist;
  // Deduplicate by hostname — show only one entry per unique site
  const _seenHosts = new Set();
  const dedupedBrowse = filteredBrowse.filter(h => {
    try { const host = new URL(h.url).hostname.replace('www.', ''); if (_seenHosts.has(host)) return false; _seenHosts.add(host); return true; } catch { return true; }
  });
  let showBrowse = dedupedBrowse.slice(0, filter ? 6 : 4);
  // Don't show if exact URL match
  if (showBrowse.length === 1 && showBrowse[0].url.toLowerCase() === filter) showBrowse = [];

  // Project matches (only when there's a filter)
  const projects = (filter && typeof allExperiments !== 'undefined') ?
    allExperiments.filter(exp => exp.title.toLowerCase().includes(filter) || (exp.desc || '').toLowerCase().includes(filter)).slice(0, 5) : [];

  // Chat thread matches — also fetch recent threads for NTP with no filter
  const chatThreads = [];
  if (filter && filter.length >= 2 && typeof electronAPI !== 'undefined') {
    electronAPI.dbQuery('chat-thread-list', 50, 0).then(threads => {
      if (!threads) return;
      _currentChatThreads = threads.filter(t =>
        (t.title || '').toLowerCase().includes(filter)
      ).slice(0, 4);
      // Re-render dropdown with thread results
      const { dd: dd2, input: input2 } = _getOmniInput();
      if (dd2 && dd2.style.display !== 'none') {
        _browseUrlRenderDropdown(dd2, input2, projects, showHist, filter, showBrowse);
      }
    });
  } else if (!filter && ntp && typeof electronAPI !== 'undefined') {
    electronAPI.dbQuery('chat-thread-list', 10, 0).then(threads => {
      if (!threads) return;
      _currentChatThreads = threads.slice(0, 6);
      const { dd: dd2, input: input2 } = _getOmniInput();
      if (dd2 && dd2.style.display !== 'none') {
        _browseUrlRenderDropdown(dd2, input2, projects, showHist, filter, showBrowse);
      }
    });
  } else {
    _currentChatThreads = [];
  }

  // Kick off suggestion fetch (debounced)
  if (filter && filter.length >= 2) {
    _fetchSearchSuggestions(filter);
  } else {
    _currentSuggestions = [];
    if (_suggestDebounce) { clearTimeout(_suggestDebounce); _suggestDebounce = null; }
  }

  // Kick off definition fetch for single words
  if (filter && /^[a-zA-Z]{2,}$/.test(filter)) {
    _fetchWordDefinition(filter);
  } else {
    _currentDef = null;
    if (_defDebounce) { clearTimeout(_defDebounce); _defDebounce = null; }
  }

  // Kick off instant answers (math, color, conversion, weather, timezone, sports, stocks)
  _computeInstantAnswer(filter);

  _browseUrlRenderDropdown(dd, input, projects, showHist, filter, showBrowse);

  // Update inline autocomplete (Chrome-style: fill input + select suffix)
  if (_browseUrlAcSuppressed) {
    _browseUrlAcSuppressed = false;
  } else if (filter && document.activeElement === input) {
    // Only apply autocomplete if cursor is at end and no selection active from user
    const atEnd = input.selectionStart === filter.length && input.selectionEnd === filter.length;
    // Also apply if our own autocomplete selection is active
    const ownAcActive = _browseUrlAutocompleteSuggestion && input.selectionStart === _browseUrlTypedLength;
    if (atEnd || ownAcActive) {
      const ac = _browseUrlGetAutocomplete(filter.slice(0, atEnd ? filter.length : _browseUrlTypedLength));
      _browseUrlApplyAutocomplete(input, ac);
    }
  } else {
    _browseUrlClearAutocomplete();
  }
}

export function _browseUrlRenderHistoryCommand(dd, input) {
  const hist = _getBrowseHistory().slice(0, 20);
  _browseUrlHistIdx = -1;
  _browseUrlOriginalInput = '/history';

  const isIsland = dd.id === 'pill-url-dropdown';
  if (isIsland) {
    dd.style.position = '';
    dd.style.left = '';
    dd.style.top = '';
    dd.style.width = '';
    dd.style.maxHeight = '';
    dd.style.overflowY = '';
    const pillWrap = document.getElementById('pill-url-wrap');
    if (pillWrap) pillWrap.classList.add('pill-dropdown-open');
  } else {
    const rect = input.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.left = rect.left + 'px';
    dd.style.top = (rect.bottom + 2) + 'px';
    dd.style.width = rect.width + 'px';
    dd.style.maxHeight = '380px';
    dd.style.overflowY = 'auto';
  }

  if (!hist.length) {
    AetherUI.mount(
      Text('No browsing history').cssText('padding:12px;font-size:0.8rem;color:var(--nr-text-secondary);text-align:center;'),
      dd
    );
    dd.style.display = '';
    dd.classList.remove('hidden');
    return;
  }

  const header = Text('Recent Sites').cssText('padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;');
  const rows = VStack(header);
  hist.forEach((h, i) => {
    const favicon = _browseFaviconUrl(h.url);
    let domain = '';
    try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
    const time = _relativeTime(h.ts);
    const img = new View('img').attr('src', favicon).cssText('width:14px;height:14px;flex-shrink:0;border-radius:2px;');
    img.el.onerror = function() { this.style.display = 'none'; };
    const row = HStack(
      img,
      Text(h.title || domain).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
      Text(domain).cssText('font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;'),
      Text(time).cssText('font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;')
    ).cssText('display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;color:var(--nr-text-primary);transition:background 0.1s;');
    row.el.dataset.idx = String(i);
    row.el.dataset.histq = h.url;
    row.on('mouseenter', function() { this.style.background = 'var(--nr-bg-raised)'; });
    row.on('mouseleave', function() { if (this.dataset.idx != window._browseUrlHistIdx) this.style.background = 'none'; });
    row.on('mousedown', function(ev) {
      ev.preventDefault();
      const _i = _getOmniInput().input;
      if (_i) _i.value = h.url;
      _browseUrlHideHistory();
      browseNavigate(h.url);
    });
    rows.add(row);
  });

  AetherUI.mount(rows, dd);
  dd.style.display = '';
  dd.classList.remove('hidden');
}

export const _BANG_LABELS = {
  g: 'Google', ddg: 'DuckDuckGo', b: 'Bing', yt: 'YouTube', w: 'Wikipedia',
  r: 'Reddit', gh: 'GitHub', so: 'Stack Overflow', npm: 'npm', mdn: 'MDN',
  tw: 'X / Twitter', twitch: 'Twitch', am: 'Amazon', maps: 'Google Maps',
  img: 'Google Images', imdb: 'IMDb', sp: 'Spotify', arxiv: 'arXiv',
  py: 'PyPI', crates: 'crates.io', hn: 'Hacker News', wa: 'Wolfram Alpha',
  nix: 'Nix Packages',
};

// ── Dropdown row helper — creates a styled HStack with hover + mousedown ──
function _ddRow(opts) {
  // opts: { histq, rowStyle, hoverBg, children[], onMousedown }
  const row = HStack(...opts.children).cssText(opts.rowStyle);
  row.el.dataset.histq = opts.histq;
  if (opts.className) row.el.className = opts.className;
  if (opts.extraStyle) row.cssText(opts.rowStyle + opts.extraStyle);
  row.on('mouseenter', function() { this.style.background = opts.hoverBg; });
  row.on('mouseleave', function() { this.style.background = opts.hoverOffBg || 'none'; });
  row.on('mousedown', opts.onMousedown);
  return row;
}

function _ddSectionHeader(label) {
  return Text(label).cssText('padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;');
}

function _ddSvgIcon(svgInner, size, color) {
  return RawHTML('<svg style="width:' + size + ';height:' + size + ';color:' + (color || 'var(--nr-text-quaternary)') + ';flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' + svgInner + '</svg>');
}

function _ddFaviconWithFallback(faviconUrl, size) {
  const img = new View('img').attr('src', faviconUrl).cssText('width:' + size + ';height:' + size + ';flex-shrink:0;border-radius:3px;');
  const fallback = _ddSvgIcon('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke-linecap="round" stroke-linejoin="round"/>', size, 'var(--nr-text-quaternary)');
  fallback.cssText(fallback.el.style.cssText + 'display:none;');
  img.el.onerror = function() { this.style.display = 'none'; this.nextElementSibling.style.display = ''; };
  return { img, fallback };
}

const _SEARCH_SVG = '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/>';
const _CHAT_SVG = '<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>';
const _CLOCK_SVG = '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/>';
const _BOLT_SVG = '<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>';
const _STAR_SVG = '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>';
const _USER_SVG = '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>';
const _FLASK_SVG = '<path d="M7 2v2h1v7.15L5.03 17.49C4.08 19.3 5.36 21.5 7.41 21.5h9.18c2.05 0 3.33-2.2 2.38-4.01L16 11.15V4h1V2H7zm7 9.85l2.88 5.15H7.12L10 11.85V4h4v7.85z"/>';

export function _browseUrlRenderDropdown(dd, input, projects, showHist, filter, showBrowse) {
  showBrowse = showBrowse || [];
  const suggestions = filter ? _currentSuggestions.filter(s => s.toLowerCase() !== filter) : [];
  const hasDef = _currentDef && /^[a-zA-Z]{2,}$/.test(filter);
  const hasInstant = _instantAnswer && _instantAnswer.html;
  const { ntp } = _getOmniInput();
  const showLucky = !filter && !ntp;

  // Match bangs: input starts with "!" and has no space yet (still picking a bang)
  const bangFilter = filter && /^!(\S*)$/.test(filter) ? filter.slice(1).toLowerCase() : null;
  const matchedBangs = bangFilter !== null && typeof _BANGS !== 'undefined'
    ? Object.keys(_BANGS).filter(k => k.startsWith(bangFilter)).slice(0, 8)
    : [];

  // Quick open: match view keywords
  const quickOpenMatches = filter && filter.length >= 2
    ? _QUICK_OPEN_VIEWS.filter(v => v.aliases.some(a => a.startsWith(filter)) || v.label.toLowerCase().startsWith(filter))
    : [];

  const pillWrap = document.getElementById('pill-url-wrap');
  const isIsland = dd.id === 'pill-url-dropdown';
  const isIslandCenter = dd.id === 'pill-island-center';

  if (!showHist.length && !projects.length && !suggestions.length && !hasDef && !hasInstant && !showLucky && !showBrowse.length && !matchedBangs.length && !quickOpenMatches.length && !(ntp && filter)) {
    if (isIslandCenter) {
      _islandCenterRestorePageInfo();
    } else {
      dd.style.display = 'none'; dd.classList.add('hidden');
      if (isIsland && pillWrap) pillWrap.classList.remove('pill-dropdown-open');
    }
    return;
  }

  _browseUrlHistIdx = -1;

  if (ntp) {
    dd.style.position = '';
    dd.style.left = '';
    dd.style.top = '';
    dd.style.width = '';
    dd.style.maxHeight = '320px';
    dd.style.overflowY = 'auto';
  } else if (isIslandCenter) {
    dd.style.position = '';
    dd.style.left = '';
    dd.style.top = '';
    dd.style.width = '';
    dd.style.maxHeight = '';
    dd.style.overflowY = 'auto';
  } else if (isIsland) {
    dd.style.position = '';
    dd.style.left = '';
    dd.style.top = '';
    dd.style.width = '';
    dd.style.maxHeight = '';
    dd.style.overflowY = '';
    if (pillWrap) pillWrap.classList.add('pill-dropdown-open');
  } else {
    const rect = input.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.left = rect.left + 'px';
    dd.style.top = (rect.bottom + 2) + 'px';
    dd.style.width = rect.width + 'px';
    dd.style.maxHeight = '380px';
    dd.style.overflowY = 'auto';
  }

  const rowStyle = ntp
    ? 'display:flex;align-items:center;gap:10px;padding:8px 4px;cursor:pointer;font-size:0.85rem;color:var(--nr-text-primary);transition:background 0.12s;border-radius:8px;margin:0 -4px;'
    : 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;color:var(--nr-text-primary);transition:background 0.1s;';
  const hoverBg = ntp ? 'color-mix(in srgb, var(--nr-accent) 12%, transparent)' : 'var(--nr-bg-raised)';
  const iconSize = ntp ? '16px' : '14px';
  const smallIconSize = ntp ? '16px' : '13px';
  const trailSize = ntp ? '0.75rem' : '0.68rem';

  // Section renderers — each returns a View or null
  const _urlBarRenderers = {
    quickopen: () => {
      if (!quickOpenMatches.length) return null;
      const qoSize = ntp ? '16px' : '14px';
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Open'));
      quickOpenMatches.forEach(v => {
        const actionFn = _resolveQuickOpenAction(v);
        const row = _ddRow({
          histq: 'open:' + v.key, rowStyle, hoverBg,
          children: [
            RawHTML('<svg style="width:' + qoSize + ';height:' + qoSize + ';color:var(--nr-accent);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">' + v.icon + '</svg>'),
            Text('Open ' + v.label).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;'),
            Text('View').cssText('font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;')
          ],
          onMousedown: function(ev) { ev.preventDefault(); actionFn(); }
        });
        container.add(row);
      });
      return container;
    },
    chat: () => {
      if (!filter || !ntp) return null;
      const row = _ddRow({
        histq: 'chat:' + filter, rowStyle, hoverBg: 'color-mix(in srgb, var(--nr-accent) 30%, transparent)',
        hoverOffBg: 'color-mix(in srgb, var(--nr-accent) 20%, transparent)',
        extraStyle: 'background:color-mix(in srgb, var(--nr-accent) 20%, transparent);font-weight:500;',
        className: 'ntp-chat-row',
        children: [
          _ddSvgIcon(_CHAT_SVG, '16px', 'var(--nr-accent)'),
          RawHTML('<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(filter) + ' <span style="color:var(--nr-text-secondary);font-weight:400;">\u2014 Chat</span></span>')
        ],
        onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); if (typeof chatViewNewThread === 'function') chatViewNewThread(filter); }
      });
      return row;
    },
    search: () => {
      if (!filter || !ntp) return null;
      return _ddRow({
        histq: filter, rowStyle, hoverBg,
        children: [
          _ddSvgIcon(_SEARCH_SVG, '16px'),
          RawHTML('<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(filter) + ' <span style="color:var(--nr-text-secondary);">\u2014 Google</span></span>')
        ],
        onMousedown: function(ev) {
          ev.preventDefault();
          const sq = document.getElementById('search-query');
          if (sq) sq.value = filter;
          _browseUrlHideHistory();
          submitSearch();
        }
      });
    },
    bangs: () => {
      if (!matchedBangs.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Bangs'));
      matchedBangs.forEach(key => {
        const label = _BANG_LABELS[key] || key;
        const fillValue = '!' + key + ' ';
        const row = _ddRow({
          histq: 'bang:' + key, rowStyle, hoverBg,
          children: [
            _ddSvgIcon(_BOLT_SVG, smallIconSize),
            RawHTML('<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span style="font-weight:600;color:var(--nr-accent);">!' + escapeHtml(key) + '</span> <span style="color:var(--nr-text-secondary);">' + escapeHtml(label) + '</span></span>')
          ],
          onMousedown: function(ev) {
            ev.preventDefault();
            const el = ntp ? document.getElementById('search-query') : document.getElementById('browse-url-input');
            if (el) { el.value = fillValue; el.focus(); }
            _browseUrlShowHistory();
          }
        });
        container.add(row);
      });
      return container;
    },
    lucky: () => {
      if (!showLucky) return null;
      const hasText = !!_feelingLuckyQuery;
      const waiting = _feelingLuckyLoading && !hasText;
      if (!_feelingLuckyQuery && !_feelingLuckyLoading) setTimeout(_browseUrlFeelingLucky, 0);

      const starIcon = _ddSvgIcon(_STAR_SVG, '14px');
      const labelSpan = Text('Feeling Lucky').cssText('font-weight:600;color:var(--nr-text-primary);');
      const luckyText = hasText
        ? Text(_feelingLuckyQuery).cssText('margin-left:6px;color:var(--nr-text-secondary);font-size:0.75rem;')
        : (waiting ? RawHTML('<span style="margin-left:6px;color:var(--nr-text-quaternary);font-size:0.75rem;">Thinking\u2026</span>') : Text('').cssText('margin-left:6px;'));
      luckyText.el.className = 'browse-lucky-text';

      const textWrap = HStack(labelSpan, luckyText).cssText('flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;');

      const children = [starIcon, textWrap];
      if (hasText && !_feelingLuckyLoading) {
        const redo = Text('\u21BB').cssText('flex-shrink:0;cursor:pointer;padding:2px 4px;border-radius:4px;color:var(--nr-text-quaternary);font-size:0.7rem;');
        redo.el.className = 'browse-lucky-redo';
        redo.on('mousedown', function(ev) { ev.preventDefault(); ev.stopPropagation(); _browseUrlFeelingLucky(); });
        redo.on('mouseenter', function() { this.style.color = 'var(--nr-accent)'; });
        redo.on('mouseleave', function() { this.style.color = 'var(--nr-text-quaternary)'; });
        children.push(redo);
      }

      const row = HStack(...children).cssText(rowStyle + 'border-bottom:1px solid var(--nr-border-default);' + (waiting ? 'opacity:0.7;cursor:wait;' : ''));
      row.el.className = 'browse-lucky-row';
      row.el.dataset.histq = _feelingLuckyQuery || '';
      row.on('mousedown', function(ev) {
        if (ev.target.closest('.browse-lucky-redo')) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (_feelingLuckyQuery) {
          const inp = document.getElementById('browse-url-input');
          if (inp) inp.value = _feelingLuckyQuery;
          _browseUrlHideHistory();
          browseNavigate(_feelingLuckyQuery);
        }
      });
      return row;
    },
    definition: () => {
      if (!hasDef) return null;
      const entry = _currentDef;
      const container = VStack();
      container.cssText('padding:10px 14px;border-bottom:1px solid var(--nr-border-default);');

      const headerRow = HStack(
        Text(entry.word).cssText('font-size:1rem;font-weight:700;color:var(--nr-text-primary);')
      ).cssText('display:flex;align-items:baseline;gap:8px;');

      const phonetic = entry.phonetics?.find(p => p.text)?.text;
      if (phonetic) headerRow.add(Text(phonetic).cssText('font-size:0.78rem;color:var(--nr-text-secondary);'));
      const audio = entry.phonetics?.find(p => p.audio);
      if (audio) {
        const playBtn = Button(RawHTML('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>'))
          .cssText('background:none;border:none;cursor:pointer;color:var(--nr-text-quaternary);padding:0;margin-left:2px;')
          .attr('title', 'Listen');
        playBtn.onTap(function(ev) { ev.stopPropagation(); ev.preventDefault(); new Audio(audio.audio).play(); });
        headerRow.add(playBtn);
      }
      container.add(headerRow);

      for (const meaning of (entry.meanings || []).slice(0, 2)) {
        container.add(Text(meaning.partOfSpeech).cssText('margin-top:6px;font-size:0.65rem;font-weight:600;color:var(--nr-accent);text-transform:uppercase;letter-spacing:0.04em;'));
        for (const def of (meaning.definitions || []).slice(0, 1)) {
          container.add(Text(def.definition).cssText('font-size:0.8rem;color:var(--nr-text-primary);line-height:1.45;margin-top:2px;padding-left:8px;border-left:2px solid color-mix(in srgb, var(--nr-accent) 30%, transparent);'));
          if (def.example) container.add(Text('"' + def.example + '"').cssText('font-size:0.72rem;color:var(--nr-text-secondary);font-style:italic;margin-top:1px;padding-left:8px;'));
        }
      }
      return container;
    },
    instant: () => {
      if (!hasInstant) return null;
      return RawHTML(_instantAnswer.html);
    },
    recent: () => {
      // On NTP with no filter, merge browse history and recent chat threads sorted by recency
      if (ntp && !filter) {
        const merged = [
          ...showBrowse.map(bh => ({ type: 'browse', data: bh, ts: bh.ts || 0 })),
          ..._currentChatThreads.map(t => ({ type: 'thread', data: t, ts: (t.updated_at || 0) * 1000 })),
        ].sort((a, b) => b.ts - a.ts).slice(0, 8);
        if (!merged.length) return null;
        const container = VStack();
        merged.forEach(item => {
          if (item.type === 'browse') {
            const bh = item.data;
            const favicon = _browseFaviconUrl(bh.url);
            let domain = '';
            try { domain = new URL(bh.url).hostname.replace('www.', ''); } catch {}
            const { img, fallback } = _ddFaviconWithFallback(favicon, iconSize);
            const row = _ddRow({
              histq: bh.url, rowStyle, hoverBg,
              children: [
                img, fallback,
                Text(bh.title || domain).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
                Text(domain).cssText('font-size:0.75rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;')
              ],
              onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); browseNavigate(bh.url); }
            });
            container.add(row);
          } else {
            const t = item.data;
            const time = _relativeTime(t.updated_at * 1000);
            const row = _ddRow({
              histq: 'thread:' + t.id, rowStyle, hoverBg,
              children: [
                _ddSvgIcon(_CHAT_SVG, iconSize),
                RawHTML('<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(t.title || 'Untitled') + ' <span style="color:var(--nr-text-secondary);">\u2014 Chat</span></span>'),
                Text(time).cssText('font-size:0.75rem;color:var(--nr-text-quaternary);flex-shrink:0;')
              ],
              onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); if (typeof openChatPage === 'function') openChatPage(t.id); }
            });
            container.add(row);
          }
        });
        return container;
      }
      if (!showBrowse.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Recent Sites'));
      showBrowse.forEach(bh => {
        const favicon = _browseFaviconUrl(bh.url);
        let domain = '';
        try { domain = new URL(bh.url).hostname.replace('www.', ''); } catch {}
        const { img, fallback } = _ddFaviconWithFallback(favicon, iconSize);
        const row = _ddRow({
          histq: bh.url, rowStyle, hoverBg,
          children: [
            img, fallback,
            Text(bh.title || domain).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
            Text(domain).cssText('font-size:' + trailSize + ';color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;')
          ],
          onMousedown: function(ev) {
            ev.preventDefault();
            if (!ntp) { const ui = document.getElementById('browse-url-input'); if (ui) ui.value = bh.url; }
            _browseUrlHideHistory();
            browseNavigate(bh.url);
          }
        });
        container.add(row);
      });
      return container;
    },
    suggestions: () => {
      if (!suggestions.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Suggestions'));
      suggestions.forEach(s => {
        const row = _ddRow({
          histq: s, rowStyle, hoverBg,
          children: [
            _ddSvgIcon(_SEARCH_SVG, smallIconSize),
            Text(s).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')
          ],
          onMousedown: function(ev) {
            ev.preventDefault();
            if (ntp) { const sq = document.getElementById('search-query'); if (sq) sq.value = s; _browseUrlHideHistory(); submitSearch(); }
            else { const ui = document.getElementById('browse-url-input'); if (ui) ui.value = s; _browseUrlHideHistory(); browseNavigate(s); }
          }
        });
        container.add(row);
      });
      return container;
    },
    projects: () => {
      if (!projects.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Projects'));
      projects.forEach(exp => {
        const updated = exp.lastUpdated ? _relativeTime(exp.lastUpdated) : '';
        const children = [
          _ddSvgIcon(_FLASK_SVG, smallIconSize),
          Text(exp.title).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')
        ];
        if (updated) children.push(Text(updated).cssText('font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;'));
        const row = _ddRow({
          histq: 'project:' + exp.id, rowStyle, hoverBg, children,
          onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); if (typeof openExperimentDetail === 'function') openExperimentDetail(exp.id); }
        });
        container.add(row);
      });
      return container;
    },
    users: () => {
      if (!filter) return null;
      const unique = [];
      const matched = unique.filter(u => u.toLowerCase().includes(filter)).slice(0, 5);
      if (!matched.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Users'));
      matched.forEach(username => {
        const row = _ddRow({
          histq: 'user:' + username, rowStyle, hoverBg,
          children: [
            _ddSvgIcon(_USER_SVG, smallIconSize),
            Text(username).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')
          ],
          onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); if (typeof openUserProfile === 'function') openUserProfile(username); }
        });
        container.add(row);
      });
      return container;
    },
    threads: () => {
      if (!_currentChatThreads.length || !ntp) return null;
      if (!filter) return null; // no-filter threads are mixed into 'recent' section
      const container = VStack();
      _currentChatThreads.forEach(t => {
        const time = _relativeTime(t.updated_at * 1000);
        const row = _ddRow({
          histq: 'thread:' + t.id, rowStyle, hoverBg,
          children: [
            _ddSvgIcon(_CHAT_SVG, '16px'),
            RawHTML('<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(t.title || 'Untitled') + ' <span style="color:var(--nr-text-secondary);">\u2014 Chat</span></span>'),
            Text(time).cssText('font-size:0.75rem;color:var(--nr-text-quaternary);flex-shrink:0;')
          ],
          onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); if (typeof openChatPage === 'function') openChatPage(t.id); }
        });
        container.add(row);
      });
      return container;
    },
    notes: () => null,
    history: () => {
      if (!showHist.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Recent Searches'));
      showHist.forEach(sh => {
        const time = _relativeTime(sh.ts);
        const row = _ddRow({
          histq: sh.q, rowStyle, hoverBg,
          children: [
            _ddSvgIcon(_CLOCK_SVG, smallIconSize),
            Text(sh.q).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
            Text(time).cssText('font-size:' + trailSize + ';color:var(--nr-text-quaternary);flex-shrink:0;')
          ],
          onMousedown: function(ev) {
            ev.preventDefault();
            if (ntp) { const sq = document.getElementById('search-query'); if (sq) sq.value = sh.q; _browseUrlHideHistory(); submitSearch(); }
            else { const ui = document.getElementById('browse-url-input'); if (ui) ui.value = sh.q; _browseUrlHideHistory(); browseNavigate(sh.q); }
          }
        });
        container.add(row);
      });
      return container;
    },
  };

  const root = VStack();
  const sections = _getUrlBarSections();
  let hasContent = false;
  for (const sec of sections) {
    if (sec.enabled === false) continue;
    const renderer = _urlBarRenderers[sec.key];
    if (renderer) {
      const view = renderer();
      if (view) { root.add(view); hasContent = true; }
    }
  }

  if (!hasContent) {
    if (isIslandCenter) {
      _islandCenterRestorePageInfo();
    } else {
      dd.style.display = 'none'; dd.classList.add('hidden');
      if (isIsland && pillWrap) pillWrap.classList.remove('pill-dropdown-open');
    }
    return;
  }

  if (isIslandCenter) {
    // Hide tabs + page info, show dropdown spanning full width
    const leftCol = document.getElementById('pill-island-left');
    const actionsRow = document.getElementById('pill-island-actions-row');
    const titleEl = document.getElementById('pill-island-title');
    const navRow = document.getElementById('pill-island-nav-row');
    if (leftCol) leftCol.style.display = 'none';
    if (actionsRow) actionsRow.style.display = 'none';
    if (titleEl) titleEl.style.display = 'none';
    if (navRow) navRow.style.display = 'none';
    dd.classList.add('island-center-dd-active');
    let ddWrap = document.getElementById('island-center-dropdown');
    if (!ddWrap) {
      ddWrap = new View('div').attr('id', 'island-center-dropdown').el;
      const pillWrapEl = document.getElementById('pill-url-wrap');
      if (pillWrapEl) pillWrapEl.appendChild(ddWrap);
    }
    AetherUI.mount(root, ddWrap);
    ddWrap.style.display = '';
  } else {
    AetherUI.mount(root, dd);
    dd.style.display = '';
    dd.classList.remove('hidden');
  }
}

// Resolve quick-open action to a function
function _resolveQuickOpenAction(v) {
  if (v.action === 'history') return function() { const _i = _getOmniInput().input; if (_i) { _i.value = '/history'; } _browseUrlShowHistory(); };
  if (v.action === 'terminal') return function() { _browseUrlHideHistory(); if (typeof toggleBottomTerminal === 'function') toggleBottomTerminal(); };
  if (v.action === 'research') return function() { _browseUrlHideHistory(); if (typeof openResearch === 'function') openResearch(); };
  if (v.action === 'downloads') return function() { _browseUrlHideHistory(); if (typeof toggleBrowseDownloads === 'function') toggleBrowseDownloads(); };
  if (v.action === 'newtab') return function() { _browseUrlHideHistory(); if (typeof browseNewTab === 'function') browseNewTab(); };
  if (v.action === 'pixelpet') return function() { _browseUrlHideHistory(); if (typeof togglePixelPet === 'function') togglePixelPet(true); };
  if (v.action === 'netrunner') return function() { _browseUrlHideHistory(); if (typeof startNetrunner === 'function') startNetrunner(); };
  if (v.action && v.action.startsWith('settings:')) {
    const section = v.action.split(':')[1];
    return function() { _browseUrlHideHistory(); if (typeof wmOpen === 'function') wmOpen('settings'); if (typeof _setSettingsSection === 'function') setTimeout(function() { _setSettingsSection(section); }, 50); };
  }
  if (v.key === 'draw') return function() { _browseUrlHideHistory(); if (typeof openDrawPage === 'function') openDrawPage(); };
  return function() { _browseUrlHideHistory(); if (typeof wmOpen === 'function') wmOpen(v.key); };
}

export function _fetchSearchSuggestions(query) {
  // Check cache
  if (_suggestCache[query]) {
    _currentSuggestions = _suggestCache[query];
    return;
  }
  // Debounce: wait 300ms after last keystroke
  if (_suggestDebounce) clearTimeout(_suggestDebounce);
  _suggestDebounce = setTimeout(async () => {
    if (_suggestAbort) _suggestAbort.abort();
    const controller = new AbortController();
    _suggestAbort = controller;
    try {
      const data = await apiPost('/api/search-suggest', { query });
      const suggestions = data.suggestions || [];
      _suggestCache[query] = suggestions;
      _currentSuggestions = suggestions;
      // Re-render dropdown if input still matches
      const { input } = _getOmniInput();
      if (input && input.value.trim().toLowerCase() === query) {
        _browseUrlShowHistory();
      }
    } catch (e) {
      if (e.name !== 'AbortError') _currentSuggestions = [];
    }
  }, 300);
}

export function _fetchWordDefinition(word) {
  const key = word.toLowerCase();
  if (_defCache[key]) {
    _currentDef = _defCache[key];
    return;
  }
  if (_defDebounce) clearTimeout(_defDebounce);
  _defDebounce = setTimeout(async () => {
    try {
      // External API - keep raw fetch
      const resp = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(key));
      if (!resp.ok) { _defCache[key] = null; _currentDef = null; return; }
      const data = await resp.json();
      const entry = data[0] || null;
      _defCache[key] = entry;
      _currentDef = entry;
      // Re-render dropdown if input still matches
      const { input } = _getOmniInput();
      if (input && input.value.trim().toLowerCase() === key) {
        _browseUrlShowHistory();
      }
    } catch {
      _defCache[key] = null;
      _currentDef = null;
    }
  }, 250);
}

// ── Instant Answers engine ──

export function _computeInstantAnswer(query) {
  if (!query) { _instantAnswer = null; return; }

  // 1. Math expressions — detect and evaluate synchronously
  const mathResult = _tryMathAnswer(query);
  if (mathResult) { _instantAnswer = mathResult; return; }

  // 2. Color preview — hex or rgb
  const colorResult = _tryColorAnswer(query);
  if (colorResult) { _instantAnswer = colorResult; return; }

  // 3. Unit conversion
  const convResult = _tryConversionAnswer(query);
  if (convResult) { _instantAnswer = convResult; return; }

  // 4. Timezone / world clock
  const tzResult = _tryTimezoneAnswer(query);
  if (tzResult) { _instantAnswer = tzResult; return; }

  // 5. Async answers (weather, sports, stocks) — debounced
  const weatherMatch = query.match(/^weather\s+(.+)$/i);
  const sportsMatch = _matchSportsQuery(query);
  const stockMatch = query.match(/^\$([A-Za-z]{1,5})$/) || query.match(/^([A-Za-z]{1,5})\s+stock$/i);

  if (weatherMatch || sportsMatch || stockMatch) {
    const cacheKey = query.toLowerCase();
    if (_instantCache[cacheKey]) {
      _instantAnswer = _instantCache[cacheKey];
      return;
    }
    // Keep previous instant answer while loading (don't flash)
    if (_instantDebounce) clearTimeout(_instantDebounce);
    _instantDebounce = setTimeout(async () => {
      let result = null;
      try {
        if (weatherMatch) result = await _fetchWeatherAnswer(weatherMatch[1].trim());
        else if (sportsMatch) result = await _fetchSportsAnswer(sportsMatch);
        else if (stockMatch) result = await _fetchStockAnswer(stockMatch[1].toUpperCase());
      } catch {}
      if (result) {
        _instantCache[cacheKey] = result;
        _instantAnswer = result;
      } else {
        _instantAnswer = null;
      }
      const { input } = _getOmniInput();
      if (input && input.value.trim().toLowerCase() === query.toLowerCase()) {
        _browseUrlShowHistory();
      }
    }, 300);
    return;
  }

  _instantAnswer = null;
}

// ── Math ──
export function _tryMathAnswer(q) {
  // Only match math-like patterns
  if (!/[\d]/.test(q)) return null;
  if (/[a-zA-Z]{3,}/.test(q) && !/^(sqrt|cbrt|abs|log|ln|sin|cos|tan|pi|e|ceil|floor|round|pow|min|max)/i.test(q.replace(/[^a-zA-Z]/g, ''))) return null;
  // Sanitize: only allow digits, operators, parens, spaces, dots, and math functions
  const sanitized = q.replace(/\s/g, '')
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/\^/g, '**')
    .replace(/%\s*of\s*/i, '/100*');
  if (!/^[\d+\-*/().%,\s^eπ]*$/.test(sanitized) && !/^[\d+\-*/().\s]*(?:sqrt|cbrt|abs|log|ln|sin|cos|tan|pi|ceil|floor|round|pow|min|max)[\d+\-*/().\s]*$/i.test(sanitized)) return null;
  try {
    const expr = sanitized
      .replace(/\bpi\b/gi, 'Math.PI').replace(/\be\b/g, 'Math.E')
      .replace(/\bsqrt\(/gi, 'Math.sqrt(').replace(/\bcbrt\(/gi, 'Math.cbrt(')
      .replace(/\babs\(/gi, 'Math.abs(').replace(/\blog\(/gi, 'Math.log10(')
      .replace(/\bln\(/gi, 'Math.log(').replace(/\bsin\(/gi, 'Math.sin(')
      .replace(/\bcos\(/gi, 'Math.cos(').replace(/\btan\(/gi, 'Math.tan(')
      .replace(/\bceil\(/gi, 'Math.ceil(').replace(/\bfloor\(/gi, 'Math.floor(')
      .replace(/\bround\(/gi, 'Math.round(').replace(/\bpow\(/gi, 'Math.pow(')
      .replace(/\bmin\(/gi, 'Math.min(').replace(/\bmax\(/gi, 'Math.max(');
    // Safety check: no identifiers besides Math
    if (/[a-zA-Z_$]/.test(expr.replace(/Math\.[a-zA-Z]+/g, '').replace(/[eE][+-]?\d/g, ''))) return null;
    const result = Function('"use strict"; return (' + expr + ')')();
    if (typeof result !== 'number' || !isFinite(result)) return null;
    // Don't show if result equals input (e.g. just a number)
    if (String(result) === sanitized || String(result) === q.trim()) return null;
    const formatted = Number.isInteger(result) ? result.toLocaleString() : parseFloat(result.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 10 });
    return { type: 'math', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
      ${icon('hashtag', {size: 16, stroke: 'var(--nr-accent)'})}
      <div><span style="font-size:0.8rem;color:var(--nr-text-secondary);">${escapeHtml(q)} =</span> <span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(formatted)}</span></div>
    </div>` };
  } catch { return null; }
}

// ── Color ──
export function _tryColorAnswer(q) {
  let color = null, label = q;
  const hexMatch = q.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    color = '#' + hex;
    label = '#' + hex.toUpperCase();
  }
  const rgbMatch = q.match(/^rgb[a]?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgbMatch) {
    color = `rgb(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]})`;
    label = color;
  }
  const hslMatch = q.match(/^hsl[a]?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})%?\s*,\s*(\d{1,3})%?/i);
  if (hslMatch) {
    color = `hsl(${hslMatch[1]},${hslMatch[2]}%,${hslMatch[3]}%)`;
    label = color;
  }
  if (!color) return null;
  return { type: 'color', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:12px;">
    <div style="width:36px;height:36px;border-radius:8px;background:${color};border:1px solid var(--nr-border-default);flex-shrink:0;"></div>
    <div><div style="font-size:0.95rem;font-weight:600;color:var(--nr-text-primary);">${escapeHtml(label)}</div>
    <div style="font-size:0.72rem;color:var(--nr-text-secondary);">Color preview</div></div>
  </div>` };
}

// ── Unit Conversion ──
export function _tryConversionAnswer(q) {
  const m = q.match(/^([\d.,]+)\s*([a-zA-Z°℃℉]+)\s+(?:to|in|as|=)\s+([a-zA-Z°℃℉]+)$/i);
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ''));
  if (isNaN(val)) return null;
  const from = m[2].toLowerCase(), to = m[3].toLowerCase();
  const conversions = {
    'km_mi': v => v * 0.621371, 'mi_km': v => v * 1.60934,
    'km_m': v => v * 1000, 'm_km': v => v / 1000,
    'm_ft': v => v * 3.28084, 'ft_m': v => v / 3.28084,
    'mi_ft': v => v * 5280, 'ft_mi': v => v / 5280,
    'cm_in': v => v / 2.54, 'in_cm': v => v * 2.54,
    'mm_in': v => v / 25.4, 'in_mm': v => v * 25.4,
    'kg_lb': v => v * 2.20462, 'lb_kg': v => v / 2.20462,
    'kg_lbs': v => v * 2.20462, 'lbs_kg': v => v / 2.20462,
    'g_oz': v => v / 28.3495, 'oz_g': v => v * 28.3495,
    'l_gal': v => v * 0.264172, 'gal_l': v => v / 0.264172,
    'ml_oz': v => v / 29.5735, 'oz_ml': v => v * 29.5735,
    'c_f': v => v * 9/5 + 32, 'f_c': v => (v - 32) * 5/9,
    '°c_°f': v => v * 9/5 + 32, '°f_°c': v => (v - 32) * 5/9,
    'celsius_fahrenheit': v => v * 9/5 + 32, 'fahrenheit_celsius': v => (v - 32) * 5/9,
    '℃_℉': v => v * 9/5 + 32, '℉_℃': v => (v - 32) * 5/9,
    'mph_kph': v => v * 1.60934, 'kph_mph': v => v / 1.60934,
    'mph_kmh': v => v * 1.60934, 'kmh_mph': v => v / 1.60934,
    'yd_m': v => v * 0.9144, 'm_yd': v => v / 0.9144,
  };
  const key = from + '_' + to;
  const fn = conversions[key];
  if (!fn) return null;
  const result = fn(val);
  const formatted = parseFloat(result.toPrecision(6)).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return { type: 'conversion', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
    ${icon('repost', {size: 16, stroke: 'var(--nr-accent)'})}
    <div><span style="font-size:0.8rem;color:var(--nr-text-secondary);">${escapeHtml(m[1])} ${escapeHtml(m[2])} =</span> <span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(formatted)} ${escapeHtml(m[3])}</span></div>
  </div>` };
}

// ── Timezone ──
export const _tzCityMap = {
  'tokyo': 'Asia/Tokyo', 'london': 'Europe/London', 'paris': 'Europe/Paris',
  'new york': 'America/New_York', 'nyc': 'America/New_York', 'ny': 'America/New_York',
  'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles',
  'chicago': 'America/Chicago', 'denver': 'America/Denver',
  'sydney': 'Australia/Sydney', 'melbourne': 'Australia/Melbourne',
  'berlin': 'Europe/Berlin', 'amsterdam': 'Europe/Amsterdam',
  'dubai': 'Asia/Dubai', 'singapore': 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong', 'seoul': 'Asia/Seoul',
  'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'india': 'Asia/Kolkata',
  'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'china': 'Asia/Shanghai',
  'moscow': 'Europe/Moscow', 'toronto': 'America/Toronto',
  'vancouver': 'America/Vancouver', 'sf': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles', 'seattle': 'America/Los_Angeles',
  'austin': 'America/Chicago', 'boston': 'America/New_York',
  'miami': 'America/New_York', 'atlanta': 'America/New_York',
  'hawaii': 'Pacific/Honolulu', 'honolulu': 'Pacific/Honolulu',
  'alaska': 'America/Anchorage', 'bangkok': 'Asia/Bangkok',
  'istanbul': 'Europe/Istanbul', 'cairo': 'Africa/Cairo',
  'rome': 'Europe/Rome', 'madrid': 'Europe/Madrid',
  'lisbon': 'Europe/Lisbon', 'dublin': 'Europe/Dublin',
  'zurich': 'Europe/Zurich', 'stockholm': 'Europe/Stockholm',
  'oslo': 'Europe/Oslo', 'helsinki': 'Europe/Helsinki',
  'warsaw': 'Europe/Warsaw', 'prague': 'Europe/Prague',
  'vienna': 'Europe/Vienna', 'budapest': 'Europe/Budapest',
  'taipei': 'Asia/Taipei', 'jakarta': 'Asia/Jakarta',
  'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  'johannesburg': 'Africa/Johannesburg', 'nairobi': 'Africa/Nairobi',
  'auckland': 'Pacific/Auckland',
};

export function _tryTimezoneAnswer(q) {
  const m = q.match(/^(?:time\s+in|what\s+time\s+(?:is\s+it\s+)?in)\s+(.+)$/i);
  if (!m) return null;
  const city = m[1].trim().toLowerCase();
  const tz = _tzCityMap[city];
  if (!tz) return null;
  try {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const date = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
    const offset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || '';
    return { type: 'timezone', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
      ${icon('clock', {size: 16, stroke: 'var(--nr-accent)'})}
      <div><div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(time)}</span><span style="font-size:0.75rem;color:var(--nr-text-secondary);">${escapeHtml(date)}</span></div>
      <div style="font-size:0.72rem;color:var(--nr-text-secondary);">${escapeHtml(m[1].trim())} · ${escapeHtml(offset)}</div></div>
    </div>` };
  } catch { return null; }
}

// ── Weather (async) ──
export async function _fetchWeatherAnswer(city) {
  // External API - keep raw fetch
  const resp = await fetch('https://wttr.in/' + encodeURIComponent(city) + '?format=j1', { signal: AbortSignal.timeout(4000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  const cur = data.current_condition?.[0];
  if (!cur) return null;
  const temp = cur.temp_C;
  const tempF = cur.temp_F;
  const desc = cur.weatherDesc?.[0]?.value || '';
  const feelsC = cur.FeelsLikeC;
  const humidity = cur.humidity;
  const wind = cur.windspeedKmph;
  const emoji = _weatherEmoji(desc);
  return { type: 'weather', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:12px;">
    <span style="font-size:1.6rem;">${emoji}</span>
    <div style="flex:1;">
      <div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:1.1rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(temp)}°C</span><span style="font-size:0.82rem;color:var(--nr-text-secondary);">${escapeHtml(tempF)}°F</span></div>
      <div style="font-size:0.78rem;color:var(--nr-text-secondary);">${escapeHtml(desc)}</div>
      <div style="font-size:0.7rem;color:var(--nr-text-quaternary);margin-top:2px;">Feels ${escapeHtml(feelsC)}°C · Humidity ${escapeHtml(humidity)}% · Wind ${escapeHtml(wind)} km/h</div>
    </div>
    <div style="font-size:0.72rem;color:var(--nr-text-secondary);text-align:right;">${escapeHtml(city)}</div>
  </div>` };
}

export function _weatherEmoji(desc) {
  const d = (desc || '').toLowerCase();
  if (d.includes('sunny') || d.includes('clear')) return '☀️';
  if (d.includes('partly cloudy')) return '⛅';
  if (d.includes('cloud') || d.includes('overcast')) return '☁️';
  if (d.includes('rain') || d.includes('drizzle')) return '🌧️';
  if (d.includes('thunder') || d.includes('storm')) return '⛈️';
  if (d.includes('snow') || d.includes('blizzard')) return '🌨️';
  if (d.includes('fog') || d.includes('mist')) return '🌫️';
  if (d.includes('wind')) return '💨';
  return '🌤️';
}

// ── Sports ──
export const _sportsLeagues = {
  'nba': 'basketball', 'nfl': 'football', 'mlb': 'baseball', 'nhl': 'hockey',
  'premier league': 'soccer', 'epl': 'soccer', 'la liga': 'soccer',
  'bundesliga': 'soccer', 'serie a': 'soccer', 'ligue 1': 'soccer',
  'champions league': 'soccer', 'mls': 'soccer', 'ucl': 'soccer',
};
export const _sportsTeams = {
  'lakers': 'nba', 'celtics': 'nba', 'warriors': 'nba', 'bulls': 'nba', 'nets': 'nba',
  'knicks': 'nba', 'heat': 'nba', 'bucks': 'nba', 'suns': 'nba', 'nuggets': 'nba',
  'mavericks': 'nba', 'mavs': 'nba', 'clippers': 'nba', 'rockets': 'nba',
  'sixers': 'nba', '76ers': 'nba', 'raptors': 'nba', 'spurs': 'nba', 'thunder': 'nba',
  'timberwolves': 'nba', 'wolves': 'nba', 'grizzlies': 'nba', 'pelicans': 'nba',
  'chiefs': 'nfl', 'eagles': 'nfl', '49ers': 'nfl', 'cowboys': 'nfl', 'bills': 'nfl',
  'ravens': 'nfl', 'dolphins': 'nfl', 'lions': 'nfl', 'packers': 'nfl', 'jets': 'nfl',
  'patriots': 'nfl', 'steelers': 'nfl', 'bears': 'nfl', 'chargers': 'nfl',
  'yankees': 'mlb', 'dodgers': 'mlb', 'red sox': 'mlb', 'cubs': 'mlb', 'mets': 'mlb',
  'astros': 'mlb', 'braves': 'mlb', 'phillies': 'mlb', 'padres': 'mlb',
  'arsenal': 'epl', 'chelsea': 'epl', 'liverpool': 'epl', 'man city': 'epl',
  'manchester city': 'epl', 'man united': 'epl', 'manchester united': 'epl',
  'tottenham': 'epl', 'spurs fc': 'epl', 'barcelona': 'la liga', 'real madrid': 'la liga',
  'bayern': 'bundesliga', 'bayern munich': 'bundesliga', 'psg': 'ligue 1',
  'juventus': 'serie a', 'inter milan': 'serie a', 'ac milan': 'serie a',
};

export function _matchSportsQuery(q) {
  const lower = q.toLowerCase().trim();
  if (_sportsLeagues[lower]) return { type: 'league', key: lower };
  // Check for "X score" or "X game"
  const scoreMatch = lower.match(/^(.+?)\s+(?:score|game|scores|games|schedule|results?)$/);
  const teamName = scoreMatch ? scoreMatch[1] : lower;
  if (_sportsTeams[teamName]) return { type: 'team', key: teamName, league: _sportsTeams[teamName] };
  if (_sportsLeagues[teamName]) return { type: 'league', key: teamName };
  return null;
}

export async function _fetchSportsAnswer(match) {
  // Use ESPN's public API for scores
  const leagueMap = {
    'nba': 'basketball/nba', 'nfl': 'football/nfl', 'mlb': 'baseball/mlb', 'nhl': 'hockey/nhl',
    'premier league': 'soccer/eng.1', 'epl': 'soccer/eng.1', 'la liga': 'soccer/esp.1',
    'bundesliga': 'soccer/ger.1', 'serie a': 'soccer/ita.1', 'ligue 1': 'soccer/fra.1',
    'champions league': 'soccer/uefa.champions', 'ucl': 'soccer/uefa.champions',
    'mls': 'soccer/usa.1',
  };
  const league = match.type === 'league' ? match.key : match.league;
  const espnPath = leagueMap[league];
  if (!espnPath) return null;

  // External API - keep raw fetch
  const resp = await fetch('https://site.api.espn.com/apis/site/v2/sports/' + espnPath + '/scoreboard', { signal: AbortSignal.timeout(4000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  let events = data.events || [];
  if (!events.length) return null;

  // Filter by team if searching for a specific team
  if (match.type === 'team') {
    const teamLower = match.key.toLowerCase();
    events = events.filter(ev => {
      const names = (ev.name || '').toLowerCase() + ' ' + (ev.shortName || '').toLowerCase();
      return names.includes(teamLower);
    });
    if (!events.length) return null;
  }

  // Show up to 4 games
  const games = events.slice(0, 4);
  let html = '<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);">';
  html += '<div style="font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">' + escapeHtml(league.toUpperCase()) + ' Scores</div>';
  for (const ev of games) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const teams = comp.competitors || [];
    if (teams.length < 2) continue;
    const away = teams.find(t => t.homeAway === 'away') || teams[1];
    const home = teams.find(t => t.homeAway === 'home') || teams[0];
    const status = ev.status?.type?.shortDetail || '';
    const isLive = ev.status?.type?.state === 'in';
    html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:0.8rem;">`;
    html += `<div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;">`;
    if (away.team?.logo) html += `<img src="${escapeHtml(away.team.logo)}" style="width:16px;height:16px;flex-shrink:0;" onerror="this.style.display='none'">`;
    html += `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--nr-text-primary);${away.winner ? 'font-weight:700;' : ''}">${escapeHtml(away.team?.abbreviation || away.team?.shortDisplayName || '?')}</span>`;
    html += `<span style="font-weight:700;color:var(--nr-text-primary);min-width:18px;text-align:center;">${escapeHtml(away.score || '-')}</span>`;
    html += `</div>`;
    html += `<span style="color:var(--nr-text-quaternary);font-size:0.7rem;">@</span>`;
    html += `<div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;">`;
    html += `<span style="font-weight:700;color:var(--nr-text-primary);min-width:18px;text-align:center;">${escapeHtml(home.score || '-')}</span>`;
    if (home.team?.logo) html += `<img src="${escapeHtml(home.team.logo)}" style="width:16px;height:16px;flex-shrink:0;" onerror="this.style.display='none'">`;
    html += `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--nr-text-primary);${home.winner ? 'font-weight:700;' : ''}">${escapeHtml(home.team?.abbreviation || home.team?.shortDisplayName || '?')}</span>`;
    html += `</div>`;
    html += `<span style="font-size:0.68rem;color:${isLive ? 'var(--nr-accent)' : 'var(--nr-text-quaternary)'};white-space:nowrap;flex-shrink:0;min-width:50px;text-align:right;${isLive ? 'font-weight:600;' : ''}">${escapeHtml(status)}</span>`;
    html += `</div>`;
  }
  if (events.length > 4) html += `<div style="font-size:0.7rem;color:var(--nr-text-quaternary);padding-top:4px;">+${events.length - 4} more games</div>`;
  html += '</div>';
  return { type: 'sports', html };
}

// ── Stocks ──
export async function _fetchStockAnswer(ticker) {
  const data = await apiGet('/api/stock-quote?symbol=' + encodeURIComponent(ticker));
  if (!data.price && data.price !== 0) return null;
  const price = data.price;
  const change = data.change || 0;
  const changePct = data.changePercent || 0;
  const name = data.name || ticker;
  const isUp = change >= 0;
  const arrow = isUp ? '▲' : '▼';
  const color = isUp ? '#22c55e' : '#ef4444';
  return { type: 'stock', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
    ${icon('trendingUp', {size: 16, stroke: 'var(--nr-accent)'})}
    <div style="flex:1;">
      <div style="display:flex;align-items:baseline;gap:8px;">
        <span style="font-size:0.82rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(ticker)}</span>
        <span style="font-size:0.72rem;color:var(--nr-text-secondary);">${escapeHtml(name)}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px;">
        <span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">$${parseFloat(price).toFixed(2)}</span>
        <span style="font-size:0.78rem;font-weight:600;color:${color};">${arrow} ${Math.abs(change).toFixed(2)} (${Math.abs(changePct).toFixed(2)}%)</span>
      </div>
    </div>
  </div>` };
}

export let _browseUrlHideTimeout = null;

export function _browseUrlScheduleHide() {
  clearTimeout(_browseUrlHideTimeout);
  _browseUrlHideTimeout = setTimeout(_browseUrlHideHistory, 150);
}

export function _browseUrlCancelHide() {
  clearTimeout(_browseUrlHideTimeout);
  _browseUrlHideTimeout = null;
}

function _islandCenterRestorePageInfo() {
  const ddWrap = document.getElementById('island-center-dropdown');
  if (ddWrap) { ddWrap.innerHTML = ''; ddWrap.style.display = 'none'; }
  const leftCol = document.getElementById('pill-island-left');
  const actionsRow = document.getElementById('pill-island-actions-row');
  const titleEl = document.getElementById('pill-island-title');
  const navRow = document.getElementById('pill-island-nav-row');
  const centerCol = document.getElementById('pill-island-center');
  if (leftCol) leftCol.style.display = '';
  if (actionsRow) actionsRow.style.display = '';
  if (titleEl) titleEl.style.display = '';
  if (navRow) navRow.style.display = '';
  if (centerCol) centerCol.classList.remove('island-center-dd-active');
}

export function _browseUrlHideHistory() {
  _browseUrlClearAutocomplete();
  _browseUrlHideTimeout = null;
  const dd = document.getElementById('browse-url-history-dd');
  if (dd) dd.style.display = 'none';
  const ntpDd = document.getElementById('search-history-dropdown-view');
  if (ntpDd) { ntpDd.style.display = 'none'; ntpDd.classList.add('hidden'); }
  const pillWrap = document.getElementById('pill-url-wrap');
  if (pillWrap) pillWrap.classList.remove('pill-dropdown-open');
  _islandCenterRestorePageInfo();
  _browseUrlHistIdx = -1;
}
window._browseUrlHideHistory = _browseUrlHideHistory;
window._browseUrlShowHistory = _browseUrlShowHistory;
window._getOmniInput = _getOmniInput;
window.submitSearch = submitSearch;
window.openUserProfile = openUserProfile;

document.addEventListener('mousedown', (e) => {
  const { input, dd, island, islandCenter } = _getOmniInput();
  if (!dd) return;
  // Check visibility: pill dropdown uses class, others use display
  if (islandCenter) {
    const ddWrap = document.getElementById('island-center-dropdown');
    if (!ddWrap || ddWrap.style.display === 'none') return;
    if ((input && input.contains(e.target)) || (e.target.closest && e.target.closest('#pill-url-wrap'))) return;
  } else if (island) {
    const pillWrap = document.getElementById('pill-url-wrap');
    if (!pillWrap || !pillWrap.classList.contains('pill-dropdown-open')) return;
    if ((input && input.contains(e.target)) || dd.contains(e.target) || (e.target.closest && e.target.closest('#pill-url-wrap'))) return;
  } else {
    if (dd.style.display === 'none' && dd.classList.contains('hidden')) return;
    if ((input && input.contains(e.target)) || dd.contains(e.target)) return;
  }
  _browseUrlHideHistory();
});

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
  _browseSetUrlDisplay(urlInput, 'netrun://history');

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

const _CLOSE_SVG = '<svg style="width:14px;height:14px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';

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

// ── Ad Blocker toggle & badge ──

export function toggleAdBlock() {
  const on = Settings.get('adBlockEnabled') === 'true';
  const newState = !on;
  Settings.set('adBlockEnabled', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.adblockSetEnabled) {
    window.electronAPI.adblockSetEnabled(newState);
  }
  _browseUpdateAdBlockBtn();
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
  // Reload current tab to apply/remove blocking
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.url && !tab.blank && tab.el) {
    if (window._browseIsElectron) {
      // Electron: just reload the webview — main process handles blocking
      if (tab.el.reload) tab.el.reload();
    } else {
      const proxied = _browseProxyUrl(tab.url);
      tab.el.dataset.originalUrl = tab.url;
      tab.el.src = proxied;
    }
  }
}

export function _browseUpdateAdBlockBtn() {
  const btn = document.getElementById('browse-adblock-btn');
  if (!btn) return;
  const on = Settings.get('adBlockEnabled') === 'true';
  btn.style.color = on ? 'var(--nr-accent)' : '';
  btn.title = on ? 'Ad Blocker (on)' : 'Ad Blocker (off)';
  btn.classList.toggle('text-dimmer', !on);
}

export function toggleDoH() {
  const on = Settings.get('dohEnabled') !== 'false';
  const newState = !on;
  Settings.set('dohEnabled', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.dohSetConfig) {
    window.electronAPI.dohSetConfig(newState, Settings.get('dohProvider') || 'cloudflare');
  }
  _browseUpdateDohBtn();
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
}

export function _browseUpdateDohBtn() {
  const btn = document.getElementById('browse-doh-btn');
  if (!btn) return;
  const on = Settings.get('dohEnabled') !== 'false';
  btn.style.color = on ? 'var(--nr-accent)' : '';
  btn.title = on ? 'Encrypted DNS (on)' : 'Encrypted DNS (off)';
  btn.classList.toggle('text-dimmer', !on);
}

export function _browseUpdateAdBlockBadge(url) {
  const badge = document.getElementById('browse-adblock-badge');
  if (!badge) return;
  if (Settings.get('adBlockEnabled') !== 'true') {
    badge.style.display = 'none';
    return;
  }
  if (window._browseIsElectron && window.electronAPI && window.electronAPI.adblockGetCount) {
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    if (tab && tab.el && typeof tab.el.getWebContentsId === 'function') {
      try {
        const wcId = tab.el.getWebContentsId();
        window.electronAPI.adblockGetCount(wcId).then(count => {
          if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'flex';
          } else {
            badge.style.display = 'none';
          }
        }).catch(() => { badge.style.display = 'none'; });
      } catch { badge.style.display = 'none'; }
    } else {
      badge.style.display = 'none';
    }
    return;
  }
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.el) {
    try {
      const doc = tab.el.contentDocument;
      if (doc) {
        const meta = doc.querySelector('meta[name="adblock-count"]');
        if (meta) {
          const count = parseInt(meta.getAttribute('content') || '0', 10);
          if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'flex';
          } else {
            badge.style.display = 'none';
          }
          return;
        }
      }
    } catch (e) { /* cross-origin */ }
  }
  badge.style.display = 'none';
}

// ── Site Permissions ──

export const _SITE_PERM_KEYS = ['camera', 'microphone', 'location', 'notifications', 'popups'];
export const _SITE_PERM_LABELS = { camera: 'Camera', microphone: 'Microphone', location: 'Location', notifications: 'Notifications', popups: 'Pop-ups' };
export const _SITE_PERM_PROMPTS = {
  camera: 'Use your camera',
  microphone: 'Use your microphone',
  location: 'Know your location',
  notifications: 'Send you notifications',
  popups: 'Open pop-up windows'
};
export const _SITE_PERM_ICONS = {
  camera: icon('videoCamera', {size: 14}),
  microphone: icon('microphone', {size: 14}),
  location: icon('location', {size: 14}),
  notifications: icon('bell', {size: 14}),
  popups: icon('popups', {size: 14})
};
export const _SITE_PERM_ICONS_LG = {
  camera: icon('videoCamera', {size: 22, strokeWidth: '1.5'}),
  microphone: icon('microphone', {size: 22, strokeWidth: '1.5'}),
  location: icon('location', {size: 22, strokeWidth: '1.5'}),
  notifications: icon('bell', {size: 22, strokeWidth: '1.5'}),
  popups: icon('popups', {size: 22, strokeWidth: '1.5'})
};

export function _getSitePermissions(domain) {
  try {
    const all = Settings.getJSON('sitePermissions', {});
    return all[domain] || {};
  } catch { return {}; }
}

export function _setSitePermission(domain, perm, value) {
  try {
    const all = Settings.getJSON('sitePermissions', {});
    if (!all[domain]) all[domain] = {};
    if (value === 'ask') {
      delete all[domain][perm];
      if (!Object.keys(all[domain]).length) delete all[domain];
    } else {
      all[domain][perm] = value;
    }
    Settings.setJSON('sitePermissions', all);
  } catch {}
}

export function _getAllSitePermissions() {
  try { return Settings.getJSON('sitePermissions', {}); } catch { return {}; }
}

export function _clearSitePermissions(domain) {
  try {
    const all = Settings.getJSON('sitePermissions', {});
    delete all[domain];
    Settings.setJSON('sitePermissions', all);
  } catch {}
}

export function _getCurrentBrowseDomain() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.url || tab.blank) return '';
  try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; }
}

// ── Permission Confirmation Prompt ──
// Shows a browser-style dialog when user tries to allow a permission.
// Nothing is granted until the user explicitly confirms in this dialog.

export function _showPermissionPrompt(domain, permKey) {
  // Remove any existing prompt
  const existing = document.getElementById('site-permission-prompt');
  if (existing) existing.remove();

  const label = _SITE_PERM_PROMPTS[permKey] || permKey;
  const icon = _SITE_PERM_ICONS_LG[permKey] || '';

  const overlayView = new window.View('div').attr('id', 'site-permission-prompt');
  overlayView.cssText('position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px;background:rgba(0,0,0,0.45);');
  const overlay = overlayView.el;

  // Build select element for remember decision
  const selectView = new window.View('select');
  selectView.cssText('padding:4px 8px;border-radius:6px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.75rem;cursor:pointer;');
  const optSession = new window.View('option').attr('value', 'session');
  optSession.el.textContent = 'Until I close this site';
  const optAlways = new window.View('option').attr('value', 'always');
  optAlways.el.textContent = 'Always';
  optAlways.el.selected = true;
  selectView.el.appendChild(optSession.el);
  selectView.el.appendChild(optAlways.el);

  function _getRememberVal() { return selectView.el.value; }
  function _dismissPrompt() { overlay.remove(); }

  const closeSvg = icon('close', {size: 18});

  const card = window.VStack(
    // Header row
    window.HStack(
      window.VStack(
        window.RawHTML('<div style="font-size:0.92rem;font-weight:600;color:var(--nr-text-primary);line-height:1.4;"><strong>' + escapeHtml(domain) + '</strong> wants to</div>'),
        window.HStack(
          window.RawHTML('<span style="color:var(--nr-text-quaternary);flex-shrink:0;">' + icon + '</span>'),
          window.Text(label).cssText('font-size:0.84rem;color:var(--nr-text-primary);')
        ).cssText('display:flex;align-items:center;gap:8px;margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--nr-bg-raised);')
      ).cssText('flex:1;'),
      window.Button(window.RawHTML(closeSvg)).cssText('background:none;border:none;cursor:pointer;color:var(--nr-text-quaternary);padding:2px;flex-shrink:0;').attr('title', 'Dismiss').onTap(function() { _dismissPrompt(); })
    ).cssText('padding:20px 20px 12px;display:flex;align-items:flex-start;gap:12px;'),
    // Remember + action buttons
    window.VStack(
      window.HStack(
        window.Text('Remember my decision').cssText('font-size:0.75rem;color:var(--nr-text-secondary);')
      ).cssText('display:flex;align-items:center;gap:8px;margin-bottom:16px;'),
      window.HStack(
        window.Button('Block').cssText('padding:6px 20px;border-radius:8px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.82rem;font-weight:500;cursor:pointer;').onTap(function() {
          if (_getRememberVal() === 'always') _setSitePermission(domain, permKey, 'block');
          if (typeof _resolvePendingPermissionRequest === 'function') _resolvePendingPermissionRequest(domain, permKey, false);
          _browseApplyPermissions();
          _dismissPrompt();
          _renderSitePermissionsDropdown();
        }),
        window.Button('Allow').cssText('padding:6px 20px;border-radius:8px;border:1px solid var(--nr-accent);background:var(--nr-accent);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;').onTap(function() {
          if (_getRememberVal() === 'always') {
            _setSitePermission(domain, permKey, 'allow');
          } else {
            _sessionPermissions[domain] = _sessionPermissions[domain] || {};
            _sessionPermissions[domain][permKey] = 'allow';
          }
          if (typeof _resolvePendingPermissionRequest === 'function') _resolvePendingPermissionRequest(domain, permKey, true);
          _browseApplyPermissions();
          _dismissPrompt();
          _renderSitePermissionsDropdown();
        })
      ).cssText('display:flex;gap:8px;justify-content:flex-end;')
    ).cssText('padding:0 20px 16px;'),
    // Footer
    window.Text('You can change your site permissions at any time from the more menu in the toolbar.').cssText('padding:8px 20px;border-top:1px solid var(--nr-border-subtle);font-size:0.68rem;color:var(--nr-text-quaternary);')
  ).cssText('background:var(--nr-bg-overlay);border:1px solid var(--nr-border-default);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);width:380px;overflow:hidden;');

  // Insert select into the remember row
  const rememberRow = card.el.querySelector('.nr-hstack');
  // The remember row is the first HStack inside the second VStack child
  const actionSection = card.el.children[1]; // second window.VStack(padding:0 20px 16px)
  const rememberHStack = actionSection && actionSection.children[0];
  if (rememberHStack) rememberHStack.appendChild(selectView.el);

  AetherUI.mount(card, overlay);

  document.body.appendChild(overlay);

  // Close on overlay background click
  overlayView.on('mousedown', function(e) {
    if (e.target === overlay) _dismissPrompt();
  });
}

// Session-only permissions (not persisted to localStorage, cleared on tab close/navigate)
export const _sessionPermissions = {};

// Get effective permissions: localStorage merged with session overrides
export function _getEffectivePermissions(domain) {
  const stored = _getSitePermissions(domain);
  const session = _sessionPermissions[domain] || {};
  return { ...stored, ...session };
}

export function _renderSitePermissionsDropdown(container) {
  const dd = container || document.getElementById('browse-menu-perms-panel');
  if (!dd) return;
  const domain = _getCurrentBrowseDomain();

  if (!domain) {
    AetherUI.mount(
      Text('Navigate to a site first').cssText('padding:12px;text-align:center;font-size:0.78rem;color:var(--aether-text-dim);'),
      dd
    );
    return;
  }

  const perms = _getSitePermissions(domain);
  const effective = _getEffectivePermissions(domain);

  const root = VStack(
    Text(domain).cssText('padding:6px 8px 4px;font-size:0.72rem;color:var(--aether-text-dimmer);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
    Text('Blocked by default. Click Allow to grant access.').cssText('padding:0 8px 4px;font-size:0.65rem;color:var(--aether-text-dimmest);line-height:1.3;')
  );

  for (const key of _SITE_PERM_KEYS) {
    const current = effective[key] || 'ask';
    const label = _SITE_PERM_LABELS[key];
    const permIcon = _SITE_PERM_ICONS[key];
    const isSession = !perms[key] && (_sessionPermissions[domain] || {})[key];

    const btnGroup = HStack().cssText('display:flex;border-radius:6px;overflow:hidden;border:1px solid var(--aether-border);');
    for (const val of ['ask', 'allow', 'block']) {
      const active = current === val;
      const bg = active ? (val === 'allow' ? 'color-mix(in srgb, #22c55e 20%, var(--aether-dropdown-bg))' : val === 'block' ? 'color-mix(in srgb, #ef4444 20%, var(--aether-dropdown-bg))' : 'color-mix(in srgb, var(--nr-accent) 20%, var(--aether-dropdown-bg))') : 'var(--aether-dropdown-bg)';
      const fg = active ? (val === 'allow' ? '#22c55e' : val === 'block' ? '#ef4444' : 'var(--nr-accent)') : 'var(--aether-text-dimmer)';
      const btn = Button(val).cssText('padding:2px 7px;font-size:0.65rem;border:none;cursor:pointer;background:' + bg + ';color:' + fg + ';font-weight:' + (active ? '600' : '400') + ';text-transform:capitalize;');
      btn.onTap(function() {
        if (val === 'allow') {
          _showPermissionPrompt(domain, key);
        } else {
          _setSitePermission(domain, key, val);
          if (_sessionPermissions[domain]) delete _sessionPermissions[domain][key];
          _renderSitePermissionsDropdown();
          _browseApplyPermissions();
        }
      });
      btnGroup.add(btn);
    }

    const row = HStack(
      RawHTML('<span style="color:var(--aether-text-dimmer);flex-shrink:0;">' + permIcon + '</span>'),
      Text(label).cssText('flex:1;font-size:0.75rem;color:var(--aether-text);')
    ).cssText('display:flex;align-items:center;gap:6px;padding:4px 8px;');
    if (isSession) row.add(Text('session').cssText('font-size:0.58rem;color:var(--aether-text-dimmest);margin-right:2px;'));
    row.add(btnGroup);
    root.add(row);
  }

  // Reset button
  const resetWrap = new View('div').cssText('padding:4px 8px 6px;border-top:1px solid var(--aether-border);margin-top:2px;');
  const resetBtn = Button('Reset all to default').cssText('width:100%;padding:4px;border-radius:6px;border:1px solid var(--aether-border);background:var(--aether-dropdown-bg);color:var(--aether-text-dim);font-size:0.72rem;cursor:pointer;');
  resetBtn.onTap(function() {
    _clearSitePermissions(domain);
    delete _sessionPermissions[domain];
    _renderSitePermissionsDropdown();
    _browseApplyPermissions();
  });
  resetWrap.add(resetBtn);
  root.add(resetWrap);

  AetherUI.mount(root, dd);
}

// Initialize button state on load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', _browseUpdateAdBlockBtn);
  document.addEventListener('DOMContentLoaded', _browseUpdateDohBtn);
}

// Listen for browse commands from Electron main process (for Cmd+T and Cmd+W)
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

export function toggleTrackingStrip() {
  const on = Settings.get('trackingStripEnabled') !== 'false';
  const newState = !on;
  Settings.set('trackingStripEnabled', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.trackingStripSetEnabled) {
    window.electronAPI.trackingStripSetEnabled(newState);
  }
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
}

export function toggleHttpsOnly() {
  const on = Settings.get('httpsOnlyEnabled') !== 'false';
  const newState = !on;
  Settings.set('httpsOnlyEnabled', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.httpsOnlySetEnabled) {
    window.electronAPI.httpsOnlySetEnabled(newState);
  }
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
}

export function toggleCookieBlock() {
  const on = Settings.get('thirdPartyCookiesBlocked') !== 'false';
  const newState = !on;
  Settings.set('thirdPartyCookiesBlocked', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.cookieBlockSetEnabled) {
    window.electronAPI.cookieBlockSetEnabled(newState);
  }
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
}

// ── Action registry ──
registerActions({
  toggleAdBlock: () => toggleAdBlock(),
  toggleDoH: () => toggleDoH(),
  toggleTrackingStrip: () => toggleTrackingStrip(),
  toggleHttpsOnly: () => toggleHttpsOnly(),
  toggleCookieBlock: () => toggleCookieBlock(),
  openSearchHistoryPage: () => openSearchHistoryPage(),
});

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

// ── Bind URL bar events via addEventListener (replaces inline handlers) ──
function _initUrlBarEvents() {
  // Main browse URL input
  const browseInput = document.getElementById('browse-url-input');
  if (browseInput) {
    browseInput.addEventListener('keydown', (e) => _browseUrlKeydown(e));
    browseInput.addEventListener('input', () => _browseUrlShowHistory());
    browseInput.addEventListener('focus', function () {
      _browseUrlOnFocus(this);
      _browseUrlCancelHide();
      this.select();
      _browseUrlShowHistory();
    });
    browseInput.addEventListener('blur', function () {
      _browseUrlOnBlur(this);
      _browseUrlScheduleHide();
    });
    browseInput.addEventListener('mouseenter', function () { _browseUrlOnMouseEnter(this); });
    browseInput.addEventListener('mouseleave', function () { _browseUrlOnMouseLeave(this); });
    browseInput.addEventListener('paste', _urlBarImagePaste);
  }

  // Pill URL input
  const pillInput = document.getElementById('pill-browse-url-input');
  if (pillInput) {
    pillInput.addEventListener('keydown', (e) => _pillUrlKeydown(e));
    pillInput.addEventListener('input', () => _browseUrlShowHistory());
    pillInput.addEventListener('focus', function () {
      _browseUrlOnFocus(this);
      this.select();
      const v = this.value;
      this.value = '';
      _browseUrlShowHistory();
      this.value = v;
      this.select();
    });
    pillInput.addEventListener('blur', function () {
      _browseUrlOnBlur(this);
      _pillSyncUrl();
      _browseUrlScheduleHide();
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
      _browseUrlCancelHide();
    });
  }

  // Island center dropdown (when expanded, dropdown renders inside pill-url-wrap)
  const pillWrapEl = document.getElementById('pill-url-wrap');
  if (pillWrapEl) {
    pillWrapEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('#island-center-dropdown')) {
        e.preventDefault();
        _browseUrlCancelHide();
      }
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initUrlBarEvents);
  } else {
    _initUrlBarEvents();
  }
}

