// browse-nerd-mode.js — Nerd Mode orchestrator
// Academic research reading mode: replaces webview with PDF.js viewer + lookup panel
// Depends on: browse-state.js, browse-pdf-viewer.js, browse-nerd-panel.js
import { islandRemove } from '/js/core/core-ui.js';
import { toast } from '/js/core/core-utils.js';
import { hidePanel, _invalidatePanelRender } from '/js/core/core-nav.js';
import { _pdfViewerInit, _pdfViewerDestroy, _pdfViewerGetText, _pdfApplyDarkBg } from '/js/browse/browse-pdf-viewer.js';
import { _notebookViewerInit, _notebookViewerDestroy, _notebookViewerGetText } from '/js/browse/browse-notebook-viewer.js';
import { _nerdPanelRegister, _nerdPanelRefresh } from '/js/browse/browse-nerd-panel.js';
import { _paperState } from '/js/browse/browse-paper.js';
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
  const url = (tab.url || tab.localPath || '').toLowerCase();
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
  const url = (tab.url || '').toLowerCase();
  if (url.endsWith('.pdf')) return true;
  if (url.includes('/pdf/') && url.includes('arxiv.org')) return true;
  return false;
}

// Keep old name for compatibility
const _isPdfTab = _isNerdTab;

export function _isNerdAutoEligible(url, tab) {
  if (!url) return false;
  // Notebooks
  if (tab && tab._nbParsedData) return true;
  // Strip fragment (#...) and query for extension checks
  var lower = (url || '').toLowerCase();
  var bare = lower.split('#')[0].split('?')[0];
  if (bare.endsWith('.ipynb')) return true;
  // Local PDFs opened via nerd:// or Cmd+O
  if (tab && (tab.localPath || tab.pdfUrl)) return true;
  if (bare.endsWith('.pdf')) return true;
  if (lower.includes('/pdf/') && lower.includes('arxiv.org')) return true;
  // /api/local-file?path=...pdf
  if (lower.includes('/api/local-file') && lower.includes('.pdf')) return true;
  return false;
}

function _getPdfUrl(tab) {
  if (tab.localPath) return '/api/local-file?path=' + encodeURIComponent(tab.localPath);
  if (tab.pdfUrl) return tab.pdfUrl;
  return tab.url || '';
}

// ── Toggle ──

export function toggleNerdMode(tab) {
  if (!tab) {
    const win = window._getCurrentWindow();
    if (!win) return;
    tab = win.tabs.find(function(t) { return t.id === win.activeTab; });
  }
  if (!tab) return;

  const enabled = _nerdModeEnabled.get(tab.id);
  if (enabled) {
    _nerdModeDisable(tab);
  } else {
    _nerdModeEnable(tab);
  }
}

function _nerdModeEnable(tab) {
  if (!_isNerdTab(tab)) {
    toast('Nerd Mode requires a PDF or notebook tab');
    return;
  }

  const isNotebook = _isNotebookTab(tab);

  _nerdModeEnabled.set(tab.id, true);
  _nerdModeSticky.add(tab.id);
  if (window._browseSaveTabs) window._browseSaveTabs();

  // Reset adaptive color so glass surfaces use native theme colors
  _browseResetAdaptiveColor();

  // Register panel if not done already
  _nerdPanelRegister();
  _nerdPanelRefresh(tab);

  // Hide the webview, create viewer
  if (tab.el) tab.el.style.display = 'none';

  const container = document.getElementById('browse-content');
  if (!container) return;

  const viewerId = isNotebook ? 'nerd-nb-viewer-' : 'nerd-pdf-viewer-';
  const viewerView = new View()
    .id(viewerId + tab.id)
    .className(isNotebook ? 'nb-viewer-container' : 'pdf-viewer-container')
    .cssText('position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;z-index:3;');
  container.appendChild(viewerView.el);
  tab._nerdViewerEl = viewerView.el;

  if (isNotebook) {
    // Notebook path
    const nbData = tab._nbParsedData;
    if (!nbData) {
      // Try loading from localPath
      if (tab.localPath) {
        const url = '/api/local-file?path=' + encodeURIComponent(tab.localPath);
        fetch(url).then(function(r) { return r.json(); }).then(function(data) {
          tab._nbParsedData = data;
          _notebookViewerInit(tab, viewerView.el, data);
          _injectNotebookContext(tab);
        }).catch(function(e) {
          console.error('Failed to load notebook:', e);
          toast('Failed to load notebook');
        });
      }
    } else {
      _notebookViewerInit(tab, viewerView.el, nbData);
      _injectNotebookContext(tab);
    }
  } else {
    // PDF path
    const pdfUrl = _getPdfUrl(tab);
    _pdfViewerInit(tab, viewerView.el, pdfUrl);
    _pdfApplyDarkBg(tab._pdfDarkMode);

    // Inject PDF text as context for AI chat
    setTimeout(function() {
      _pdfViewerGetText(tab, 1, Math.min(20, tab._pdfPageCount || 20)).then(function(text) {
        if (!text) return;
        const title = (tab.title || 'PDF Document');
        if (!window._pendingTabContexts) window._pendingTabContexts = [];
        window._pendingTabContexts = window._pendingTabContexts.filter(function(t) { return t.tabId !== tab.id; });
        window._pendingTabContexts.push({ tabId: tab.id, title: title, url: tab.url || '', content: text.slice(0, 30000) });
      });
    }, 1000);
  }

  // Register panel content but don't force it open — user can toggle it manually
  _invalidatePanelRender('browse');

  // Refresh files lists across all viewers
  _refreshFilesContent();

}

function _injectNotebookContext(tab) {
  const text = _notebookViewerGetText(tab);
  if (!text) return;
  const title = (tab.title || tab.localPath || 'Notebook');
  if (!window._pendingTabContexts) window._pendingTabContexts = [];
  window._pendingTabContexts = window._pendingTabContexts.filter(function(t) { return t.tabId !== tab.id; });
  window._pendingTabContexts.push({ tabId: tab.id, title: title, url: tab.url || '', content: text.slice(0, 30000) });
}

function _nerdModeDisable(tab) {
  _nerdModeEnabled.delete(tab.id);
  _nerdModeSticky.delete(tab.id);
  if (window._browseSaveTabs) window._browseSaveTabs();

  // Tear down impl session if active
  if (window._isImplSessionActive && window._isImplSessionActive(tab.id)) {
    window._implSessionDisable && window._implSessionDisable(tab);
  }

  // Destroy viewer (notebook or PDF)
  if (_isNotebookTab(tab)) {
    _notebookViewerDestroy(tab);
  } else {
    // Clear dark bg override before destroying
    _pdfApplyDarkBg(false);
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
  const win = window._getCurrentWindow();
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

    // Apply dark bg override for PDF dark mode
    _pdfApplyDarkBg(tab._pdfDarkMode);

    // Always show PDF viewer when nerd mode is on (no more overlay workspace)
    if (tab._nerdViewerEl) tab._nerdViewerEl.style.display = 'flex';
    if (tab.el) tab.el.style.display = 'none';

    // Refresh files lists
    _refreshFilesContent();

    // Refresh panel content but don't force it open
    _nerdPanelRegister();
    _nerdPanelRefresh(tab);
    _invalidatePanelRender('browse');
  } else {
    // Clear dark bg override when switching to a non-nerd tab
    _pdfApplyDarkBg(false);
    islandRemove('nerd');
  }
}

export function _nerdModeOnTabClose(tabId) {
  _nerdModeSticky.delete(tabId);
  if (_nerdModeEnabled.has(tabId)) {
    // Clean up impl session state
    const win = window._getCurrentWindow();
    if (win) {
      const tab = win.tabs.find(function(t) { return t.id === tabId; });
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

  const win = window._getCurrentWindow();
  const activeTabId = win ? win.activeTab : null;
  const tabs = win ? win.tabs : [];

  // ── Implementation section ──
  const activeTab2 = win ? tabs.find(function(t) { return t.id === activeTabId; }) : null;
  if (activeTab2 && activeTab2._implSessionId && activeTab2._implFolderPath) {
    const implContainer = document.createElement('div');
    implContainer.className = 'nerd-files-browser';
    implContainer.style.cssText = 'display:flex;flex-direction:column;flex:1;';
    container.appendChild(implContainer);

    _renderImplTreeInline(activeTab2, implContainer);
  }
}

export function _refreshFilesContent() {
  // Refresh all visible files panels
  const panels = document.querySelectorAll('.nerd-files-scroll');
  for (let i = 0; i < panels.length; i++) {
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
// Eagerly mark nerd-mode tabs so adaptive color guards work before the full restore
(function() {
  const win = window._getCurrentWindow && window._getCurrentWindow();
  if (win) {
    win.tabs.forEach(function(tab) {
      if (tab._nerdMode && _isNerdTab(tab)) {
        _nerdModeEnabled.set(tab.id, true);
      }
    });
  }
})();
setTimeout(function() {
  const win = window._getCurrentWindow();
  if (!win) return;
  win.tabs.forEach(function(tab) {
    if (tab._nerdMode && _isNerdTab(tab)) {
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
