// browse-nerd-mode.js — Nerd Mode orchestrator
// Academic research reading mode: replaces webview with PDF.js viewer + lookup panel
// Depends on: browse-state.js, browse-pdf-viewer.js, browse-nerd-panel.js
import { islandUpdate, islandRemove } from '/js/core/core-ui.js';
import { icon } from '/js/core/icons.js';
import { showPanelForView, hidePanel, _invalidatePanelRender, ensurePanelVisible } from '/js/core/core-nav.js';
import { _pdfViewerInit, _pdfViewerDestroy, _pdfViewerGetText } from '/js/browse/browse-pdf-viewer.js';
import { _notebookViewerInit, _notebookViewerDestroy, _notebookViewerGetText } from '/js/browse/browse-notebook-viewer.js';
import { _nerdPanelRegister, _nerdPanelRefresh } from '/js/browse/browse-nerd-panel.js';
import { _renderImplTreeInline } from '/js/browse/browse-impl-session.js';
import { _browseResetAdaptiveColor, _browseApplyAdaptiveColor } from '/js/browse-urlbar.js';
import { View } from '/aether/ui/aether-ui.js';

// ── Per-tab state ──
export const _nerdModeEnabled = new Map(); // tabId → bool
export const _nerdModeSticky = new Set(); // tabIds that should auto-enable nerd mode on PDF navigation

// ── Helpers ──

function _isNotebookTab(tab) {
  if (!tab) return false;
  if (tab._nbParsedData) return true;
  var url = (tab.url || tab.localPath || '').toLowerCase();
  return url.endsWith('.ipynb');
}

export function _getNerdDocType(tab) {
  if (_isNotebookTab(tab)) return 'notebook';
  return 'pdf';
}

function _isNerdTab(tab) {
  if (!tab) return false;
  if (_isNotebookTab(tab)) return true;
  if (tab.pdfUrl || tab.localPath) return true;
  var url = (tab.url || '').toLowerCase();
  if (url.endsWith('.pdf')) return true;
  if (url.includes('/pdf/') && url.includes('arxiv.org')) return true;
  return false;
}

// Keep old name for compatibility
var _isPdfTab = _isNerdTab;

export function _isNerdAutoEligible(url, tab) {
  if (!url) return false;
  // Notebooks
  if (tab && tab._nbParsedData) return true;
  var lower = (url || '').toLowerCase();
  if (lower.endsWith('.ipynb')) return true;
  // Local PDFs opened via nerd:// or Cmd+O
  if (tab && (tab.localPath || tab.pdfUrl)) return true;
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
  if (!_isNerdTab(tab)) {
    if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Nerd Mode requires a PDF or notebook tab');
    return;
  }

  var isNotebook = _isNotebookTab(tab);

  _nerdModeEnabled.set(tab.id, true);
  _nerdModeSticky.add(tab.id);
  if (window._browseSaveTabs) window._browseSaveTabs();

  // Remove offer pill if present
  islandRemove('nerd-offer');

  // Reset adaptive color so glass surfaces use native theme colors
  _browseResetAdaptiveColor();

  // Register panel if not done already
  _nerdPanelRegister();
  _nerdPanelRefresh(tab);

  // Hide the webview, create viewer
  if (tab.el) tab.el.style.display = 'none';

  var container = document.getElementById('browse-content');
  if (!container) return;

  var viewerId = isNotebook ? 'nerd-nb-viewer-' : 'nerd-pdf-viewer-';
  var viewerView = new View()
    .id(viewerId + tab.id)
    .className(isNotebook ? 'nb-viewer-container' : 'pdf-viewer-container')
    .cssText('position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;z-index:3;');
  container.appendChild(viewerView.el);
  tab._nerdViewerEl = viewerView.el;

  if (isNotebook) {
    // Notebook path
    var nbData = tab._nbParsedData;
    if (!nbData) {
      // Try loading from localPath
      if (tab.localPath) {
        var url = '/api/local-file?path=' + encodeURIComponent(tab.localPath);
        fetch(url).then(function(r) { return r.json(); }).then(function(data) {
          tab._nbParsedData = data;
          _notebookViewerInit(tab, viewerView.el, data);
          _injectNotebookContext(tab);
        }).catch(function(e) {
          console.error('Failed to load notebook:', e);
          if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Failed to load notebook');
        });
      }
    } else {
      _notebookViewerInit(tab, viewerView.el, nbData);
      _injectNotebookContext(tab);
    }
  } else {
    // PDF path
    var pdfUrl = _getPdfUrl(tab);
    _pdfViewerInit(tab, viewerView.el, pdfUrl);

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

  // Show lookup panel
  ensurePanelVisible();
  _invalidatePanelRender('browse');
  showPanelForView('browse');

  // Refresh files lists across all viewers
  _refreshFilesContent();

  // Island pill
  var pillLabel = isNotebook ? 'Notebook view' : 'PDF view';
  islandUpdate('nerd', {
    type: 'nerd',
    label: pillLabel,
    icon: icon('glasses', { size: 14 }),
    action: function() { toggleNerdMode(tab); }
  });
}

function _injectNotebookContext(tab) {
  var text = _notebookViewerGetText(tab);
  if (!text) return;
  var title = (tab.title || tab.localPath || 'Notebook');
  if (!window._pendingTabContexts) window._pendingTabContexts = [];
  window._pendingTabContexts = window._pendingTabContexts.filter(function(t) { return t.tabId !== tab.id; });
  window._pendingTabContexts.push({ tabId: tab.id, title: title, url: tab.url || '', content: text.slice(0, 30000) });
}

function _nerdModeDisable(tab) {
  _nerdModeEnabled.delete(tab.id);
  if (window._browseSaveTabs) window._browseSaveTabs();

  // Tear down impl session if active
  if (window._isImplSessionActive && window._isImplSessionActive(tab.id)) {
    window._implSessionDisable && window._implSessionDisable(tab);
  }

  // Destroy viewer (notebook or PDF)
  if (_isNotebookTab(tab)) {
    _notebookViewerDestroy(tab);
  } else {
    _pdfViewerDestroy(tab);
  }
  if (tab._nerdViewerEl) {
    tab._nerdViewerEl.remove();
    tab._nerdViewerEl = null;
  }

  // Restore webview
  if (tab.el) tab.el.style.display = '';

  // Re-apply adaptive color for the restored webview
  _browseApplyAdaptiveColor(tab);

  // Refresh files lists across remaining viewers
  _refreshFilesContent();

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

    // Always show PDF viewer when nerd mode is on (no more overlay workspace)
    if (tab._nerdViewerEl) tab._nerdViewerEl.style.display = 'flex';
    if (tab.el) tab.el.style.display = 'none';

    // Refresh files lists
    _refreshFilesContent();

    // Show nerd pill
    var tabPillLabel = _isNotebookTab(tab) ? 'Notebook view' : 'PDF view';
    islandUpdate('nerd', {
      type: 'nerd',
      label: tabPillLabel,
      icon: icon('glasses', { size: 14 }),
      action: function() { toggleNerdMode(tab); }
    });

    // Show panel
    _nerdPanelRegister();
    _nerdPanelRefresh(tab);
    ensurePanelVisible();
    _invalidatePanelRender('browse');
    showPanelForView('browse');
  } else {
    islandRemove('nerd');
  }
}

export function _nerdModeOnTabClose(tabId) {
  _nerdModeSticky.delete(tabId);
  if (_nerdModeEnabled.has(tabId)) {
    // Clean up impl session state
    var win = window._getCurrentWindow();
    if (win) {
      var tab = win.tabs.find(function(t) { return t.id === tabId; });
      if (tab && window._isImplSessionActive && window._isImplSessionActive(tabId)) {
        window._implSessionDisable && window._implSessionDisable(tab);
      }
    }
    _nerdModeEnabled.delete(tabId);
    islandRemove('nerd');
  }
}

export function _isNerdMode(tabId) {
  return !!_nerdModeEnabled.get(tabId);
}

// ── Shared Files Content Builder ──

export function _buildFilesContent(container) {
  container.innerHTML = '';

  var win = window._getCurrentWindow();
  var activeTabId = win ? win.activeTab : null;
  var tabs = win ? win.tabs : [];

  // ── Implementation section ──
  var activeTab2 = win ? tabs.find(function(t) { return t.id === activeTabId; }) : null;
  if (activeTab2 && activeTab2._implSessionId && activeTab2._implFolderPath) {
    var implContainer = document.createElement('div');
    implContainer.className = 'nerd-files-browser';
    container.appendChild(implContainer);

    _renderImplTreeInline(activeTab2, implContainer);
  }
}

export function _refreshFilesContent() {
  // Refresh all visible files panels
  var panels = document.querySelectorAll('.nerd-files-scroll');
  for (var i = 0; i < panels.length; i++) {
    _buildFilesContent(panels[i]);
  }
}

// ── Window bridge ──
window._nerdModeEnabled = _nerdModeEnabled;
window._nerdModeSticky = _nerdModeSticky;
window.toggleNerdMode = toggleNerdMode;
window._isNerdMode = _isNerdMode;
window._isNerdAutoEligible = _isNerdAutoEligible;
window._getNerdDocType = _getNerdDocType;
window._isNotebookTab = _isNotebookTab;
window._buildFilesContent = _buildFilesContent;
window._refreshFilesContent = _refreshFilesContent;

// ── Restore nerd mode for tabs from previous session ──
setTimeout(function() {
  var win = window._getCurrentWindow();
  if (!win) return;
  win.tabs.forEach(function(tab) {
    if (tab._nerdMode && !_nerdModeEnabled.get(tab.id) && _isNerdTab(tab)) {
      delete tab._nerdMode;
      if (tab.id === win.activeTab) {
        _nerdModeEnable(tab);
      } else {
        // Mark as sticky so it auto-enables when the tab is selected
        _nerdModeSticky.add(tab.id);
      }
    }
  });
}, 300);
