// toolbar-root.js — Mount logic, layout switch, global API shims
// This is the single entry point for the new toolbar system.
// It imports all toolbar modules and re-exports public APIs onto window.

import { browseActive, isNtp, islandExpanded, islandSubState,
         tabListVersion, pillMenuOpen, moreMenuOpen, historyDropdown,
         activeTabData, canGoBack, canGoForward, visibleActivities, aiPillState,
         getCurrentTabs, getCurrentGroups, getActiveTabId, notifyTabsChanged } from '/js/toolbar/toolbar-state.js';

import { browseBack, browseForward, browseReload, browseZoom, _browseApplyZoom,
         NavButtons, _browseTitleFromUrl, _browseFaviconUrl, _isBrowseStackNavigation, _clearBrowseStackNavigation,
         _showHistoryDropdown, _scheduleHideHistoryDropdown, _hideHistoryDropdownNow } from '/js/toolbar/toolbar-nav.js';

import { _BANGS, _browseResolveUrl, browseNavigate, _pillSyncUrl,
         _pillUrlKeydown, _showTabsInPillDropdown } from '/js/toolbar/toolbar-url.js';

import { _getActiveTabBar, _browseRenderTabs,
         browseTogglePin, browseAddTabToNewGroup, browseAddTabToGroup,
         browseRemoveTabFromGroup, _browseToggleGroupCollapse,
         _browseChangeGroupColor, _browseShowGroupContextMenu } from '/js/toolbar/toolbar-tabs.js';

import { _syncIslandPillPosition, _applyBrowseTabLayout,
         _expandIsland, _collapseIsland,
         _togglePillMenu, _closePillMenu, _renderIslandActions } from '/js/toolbar/toolbar-island.js';

import { islandUpdate, islandRemove, showAchievement, _islandRender,
         _islandRenderPill, _islandBuildTray, _islandAttachHandlers,
         _islandInitGuard, _getPulseState, _getPageInfoState,
         _setIslandActivity, _clearIslandActivity, _updateLiveTray } from '/js/toolbar/toolbar-activities.js';

import { _initUnifiedPill, renderAIPanelContent } from '/js/toolbar/toolbar-ai-pill.js';



import { toggleBrowseMoreMenu, _togglePermissionsInMenu, _toggleConvertInMenu,
         browsePrintPage, browseShowAIView, _showTextOverlay,
         _getPdfPath, _pdfParseAction, _pdfExtractAction, _pdfSplitAction,
         _pdfMergeAction, _pdfCompressAction, _pdfToPngAction, _pdfToJpegAction,
         _pdfFromImagesAction, _pdfToMdAction, _pdfMdToPdfAction,
         _setupOverflowDrag, _refreshOverflowBookmark } from '/js/toolbar/toolbar-menu.js';

// ── Global API shims ──
// Re-export all public function names onto window so callers across ~15 files need zero changes.

// Navigation
window.browseBack = browseBack;
window.browseForward = browseForward;
window.browseReload = browseReload;
window.browseZoom = browseZoom;
window._browseApplyZoom = _browseApplyZoom;
window.browseNavigate = browseNavigate;
window._browseResolveUrl = _browseResolveUrl;
window._BANGS = _BANGS;
window._isBrowseStackNavigation = _isBrowseStackNavigation;
window._clearBrowseStackNavigation = _clearBrowseStackNavigation;

// URL helpers
window._browseTitleFromUrl = _browseTitleFromUrl;
window._browseFaviconUrl = _browseFaviconUrl;
window._pillSyncUrl = _pillSyncUrl;
window._pillUrlKeydown = _pillUrlKeydown;
window._showTabsInPillDropdown = _showTabsInPillDropdown;

// Tabs
window._browseRenderTabs = function() { notifyTabsChanged(); };
window._getActiveTabBar = _getActiveTabBar;
window.browseTogglePin = browseTogglePin;
window.browseAddTabToNewGroup = browseAddTabToNewGroup;
window.browseAddTabToGroup = browseAddTabToGroup;
window.browseRemoveTabFromGroup = browseRemoveTabFromGroup;
window._browseToggleGroupCollapse = _browseToggleGroupCollapse;
window._browseChangeGroupColor = _browseChangeGroupColor;
window._browseShowGroupContextMenu = _browseShowGroupContextMenu;

// Island
window._syncIslandPillPosition = _syncIslandPillPosition;
window._expandIsland = _expandIsland;
window._collapseIsland = _collapseIsland;
window._togglePillMenu = _togglePillMenu;
window._closePillMenu = _closePillMenu;
window._renderIslandActions = _renderIslandActions;

// Activities
window.islandUpdate = islandUpdate;
window.islandRemove = islandRemove;
window.showAchievement = showAchievement;
window._islandRender = _islandRender;
window._islandRenderPill = _islandRenderPill;
window._islandBuildTray = _islandBuildTray;
window._islandAttachHandlers = _islandAttachHandlers;
window._islandInitGuard = _islandInitGuard;
window._getPulseState = _getPulseState;
window._getPageInfoState = _getPageInfoState;
window._setIslandActivity = _setIslandActivity;
window._clearIslandActivity = _clearIslandActivity;

// AI pill
window.renderAIPanelContent = renderAIPanelContent;

// Live tray
window._updateLiveTray = _updateLiveTray;

// Teleprompter (no-op stubs — teleprompter replaced by island CC/mic trays)
window.showTeleprompter = function() {};
window.hideTeleprompter = function() {};
window.teleprompterAppend = function() {};

// Menu
window.toggleBrowseMoreMenu = toggleBrowseMoreMenu;
window._togglePermissionsInMenu = _togglePermissionsInMenu;
window._toggleConvertInMenu = _toggleConvertInMenu;
window.browsePrintPage = browsePrintPage;
window.browseShowAIView = browseShowAIView;
window._showTextOverlay = _showTextOverlay;
window._getPdfPath = _getPdfPath;
window._pdfParseAction = _pdfParseAction;
window._pdfExtractAction = _pdfExtractAction;
window._pdfSplitAction = _pdfSplitAction;
window._pdfMergeAction = _pdfMergeAction;
window._pdfCompressAction = _pdfCompressAction;
window._pdfToPngAction = _pdfToPngAction;
window._pdfToJpegAction = _pdfToJpegAction;
window._pdfFromImagesAction = _pdfFromImagesAction;
window._pdfToMdAction = _pdfToMdAction;
window._pdfMdToPdfAction = _pdfMdToPdfAction;
window._setupOverflowDrag = _setupOverflowDrag;
window._refreshOverflowBookmark = _refreshOverflowBookmark;

// History dropdown
window._showHistoryDropdown = _showHistoryDropdown;
window._scheduleHideHistoryDropdown = _scheduleHideHistoryDropdown;
window._hideHistoryDropdownNow = _hideHistoryDropdownNow;

// No-op shims for functions that are now reactive
window._updateIslandNavButtons = function() { notifyTabsChanged(); };

// ── Init ──
// Attach island event handlers and guard on DOMContentLoaded
function _toolbarInit() {
  _islandAttachHandlers();
  _islandInitGuard();
  _islandRender();
  _applyBrowseTabLayout();

  // Bind static HTML nav buttons to reactive canGoBack/canGoForward signals
  const backEl = document.getElementById('pill-browse-back');
  const fwdEl = document.getElementById('pill-browse-fwd');
  if (backEl) {
    Effect(function() { backEl.style.display = canGoBack.value ? 'flex' : 'none'; });
  }
  if (fwdEl) {
    Effect(function() { fwdEl.style.display = canGoForward.value ? 'flex' : 'none'; });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _toolbarInit);
} else {
  setTimeout(_toolbarInit, 0);
}
