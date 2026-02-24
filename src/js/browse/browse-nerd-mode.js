// browse-nerd-mode.js — Nerd Mode orchestrator
// Academic research reading mode: replaces webview with PDF.js viewer + lookup panel
// Depends on: browse-state.js, browse-pdf-viewer.js, browse-nerd-panel.js
import { islandUpdate, islandRemove } from '/js/core/core-ui.js';
import { icon } from '/js/core/icons.js';
import { showPanelForView, hidePanel, _invalidatePanelRender, ensurePanelVisible } from '/js/core/core-nav.js';
import { _pdfViewerInit, _pdfViewerDestroy, _pdfViewerGetText } from '/js/browse/browse-pdf-viewer.js';
import { _nerdPanelRegister, _nerdPanelRefresh } from '/js/browse/browse-nerd-panel.js';
import { _browseResetAdaptiveColor, _browseApplyAdaptiveColor } from '/js/browse-urlbar.js';
import { View } from '/aether/ui/aether-ui.js';

// ── Per-tab state ──
export const _nerdModeEnabled = new Map(); // tabId → bool
export const _nerdModeSticky = new Set(); // tabIds that should auto-enable nerd mode on PDF navigation

// ── Helpers ──

function _isPdfTab(tab) {
  if (!tab) return false;
  if (tab.pdfUrl || tab.localPath) return true;
  var url = (tab.url || '').toLowerCase();
  if (url.endsWith('.pdf')) return true;
  if (url.includes('/pdf/') && url.includes('arxiv.org')) return true;
  return false;
}

export function _isNerdAutoEligible(url) {
  if (!url) return false;
  var lower = url.toLowerCase();
  return lower.endsWith('.pdf') || (lower.includes('/pdf/') && lower.includes('arxiv.org'));
}

function _getPdfUrl(tab) {
  if (tab.localPath) return '/api/local-file?path=' + encodeURIComponent(tab.localPath);
  if (tab.pdfUrl) return tab.pdfUrl;
  return tab.url || '';
}

// ── Toggle ──

export function toggleNerdMode(tab) {
  if (!tab) {
    var win = window._getCurrentWindow();
    if (!win) return;
    tab = win.tabs.find(function(t) { return t.id === win.activeTab; });
  }
  if (!tab) return;

  var enabled = _nerdModeEnabled.get(tab.id);
  if (enabled) {
    _nerdModeDisable(tab);
  } else {
    _nerdModeEnable(tab);
  }
}

function _nerdModeEnable(tab) {
  if (!_isPdfTab(tab)) {
    if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Nerd Mode requires a PDF tab');
    return;
  }

  _nerdModeEnabled.set(tab.id, true);
  _nerdModeSticky.add(tab.id);

  // Remove offer pill if present
  islandRemove('nerd-offer');

  // Reset adaptive color so glass surfaces use native theme colors
  _browseResetAdaptiveColor();

  // Register panel if not done already
  _nerdPanelRegister();
  _nerdPanelRefresh(tab);

  // Hide the webview, create PDF viewer
  if (tab.el) tab.el.style.display = 'none';

  var container = document.getElementById('browse-content');
  if (!container) return;

  // Create viewer container using AetherUI
  var viewerView = new View()
    .id('nerd-pdf-viewer-' + tab.id)
    .className('pdf-viewer-container')
    .cssText('position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;z-index:3;');
  container.appendChild(viewerView.el);
  tab._nerdViewerEl = viewerView.el;

  var pdfUrl = _getPdfUrl(tab);
  _pdfViewerInit(tab, viewerView.el, pdfUrl);

  // Show lookup panel
  ensurePanelVisible();
  _invalidatePanelRender('browse');
  showPanelForView('browse');

  // Island pill
  islandUpdate('nerd', {
    type: 'nerd',
    label: 'Nerd Mode',
    icon: icon('glasses', { size: 14 }),
    onTap: function() { toggleNerdMode(tab); }
  });

  // Inject PDF text as context for AI chat
  setTimeout(function() {
    _pdfViewerGetText(tab, 1, Math.min(20, tab._pdfPageCount || 20)).then(function(text) {
      if (!text) return;
      var title = (tab.title || 'PDF Document');
      if (!window._pendingTabContexts) window._pendingTabContexts = [];
      window._pendingTabContexts = window._pendingTabContexts.filter(function(t) { return t.tabId !== tab.id; });
      window._pendingTabContexts.push({ tabId: tab.id, title: title, url: tab.url || '', content: text.slice(0, 30000) });
    });
  }, 1000);
}

function _nerdModeDisable(tab) {
  _nerdModeEnabled.delete(tab.id);

  // Remove HUD mode if active
  document.body.classList.remove('nerd-hud-active');

  // Destroy PDF viewer
  _pdfViewerDestroy(tab);
  if (tab._nerdViewerEl) {
    tab._nerdViewerEl.remove();
    tab._nerdViewerEl = null;
  }

  // Restore webview
  if (tab.el) tab.el.style.display = '';

  // Re-apply adaptive color for the restored webview
  _browseApplyAdaptiveColor(tab);

  // Hide panel
  hidePanel();

  // Remove island pill
  islandRemove('nerd');
}

// ── Tab lifecycle hooks ──

export function _nerdModeOnTabSelect(tab) {
  if (!tab) return;
  var win = window._getCurrentWindow();
  if (!win) return;

  // Hide all nerd viewers from other tabs
  win.tabs.forEach(function(t) {
    if (t._nerdViewerEl && t.id !== tab.id) {
      t._nerdViewerEl.style.display = 'none';
    }
  });

  if (_nerdModeEnabled.get(tab.id)) {
    // Reset adaptive color so glass surfaces use native theme colors
    _browseResetAdaptiveColor();

    // Show this tab's nerd viewer
    if (tab._nerdViewerEl) {
      tab._nerdViewerEl.style.display = 'flex';
    }
    if (tab.el) tab.el.style.display = 'none';

    // Restore HUD mode class if this tab has it active
    document.body.classList.toggle('nerd-hud-active', !!tab._pdfHudMode);

    // Show nerd pill
    islandUpdate('nerd', {
      type: 'nerd',
      label: 'Nerd Mode',
      icon: icon('glasses', { size: 14 }),
      onTap: function() { toggleNerdMode(tab); }
    });

    // Show panel
    _nerdPanelRegister();
    _nerdPanelRefresh(tab);
    ensurePanelVisible();
    _invalidatePanelRender('browse');
    showPanelForView('browse');
  } else {
    // Remove nerd pill and HUD mode if switching to non-nerd tab
    document.body.classList.remove('nerd-hud-active');
    islandRemove('nerd');
  }
}

export function _nerdModeOnTabClose(tabId) {
  _nerdModeSticky.delete(tabId);
  if (_nerdModeEnabled.has(tabId)) {
    _nerdModeEnabled.delete(tabId);
    islandRemove('nerd');
  }
}

export function _isNerdMode(tabId) {
  return !!_nerdModeEnabled.get(tabId);
}

// ── Window bridge ──
window._nerdModeEnabled = _nerdModeEnabled;
window._nerdModeSticky = _nerdModeSticky;
window.toggleNerdMode = toggleNerdMode;
window._isNerdMode = _isNerdMode;
window._isNerdAutoEligible = _isNerdAutoEligible;
