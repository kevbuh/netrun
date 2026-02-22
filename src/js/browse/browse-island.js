// browse-island.js — Re-export stub (delegates to toolbar/ modules)
// This file exists for backwards compatibility with imports from other files.

export { _syncIslandPillPosition, _applyBrowseTabLayout,
         _expandIsland, _collapseIsland, _togglePillMenu, _closePillMenu } from '/js/toolbar/toolbar-island.js';

export { _pillSyncUrl, _pillUrlKeydown, _showTabsInPillDropdown,
         _BANGS, _browseResolveUrl, browseNavigate } from '/js/toolbar/toolbar-url.js';

export { browseBack, browseForward, browseReload, browseZoom, _browseApplyZoom,
         _browseTitleFromUrl, _browseFaviconUrl, _clearBrowseNavDirection,
         NavButtons, _showHistoryDropdown, _scheduleHideHistoryDropdown,
         _hideHistoryDropdownNow } from '/js/toolbar/toolbar-nav.js';

export { _browseRenderTabs, _getActiveTabBar,
         browseTogglePin, browseAddTabToNewGroup, browseAddTabToGroup,
         browseRemoveTabFromGroup, _browseToggleGroupCollapse,
         _browseChangeGroupColor, _browseShowGroupContextMenu,
         _tabDragStart, _tabDragMove, _tabDragEnd,
         _splitPillDragStart } from '/js/toolbar/toolbar-tabs.js';

export { islandUpdate, islandRemove, showAchievement, _islandRender,
         _islandRenderPill, _islandBuildTray, _islandAttachHandlers,
         _islandInitGuard } from '/js/toolbar/toolbar-activities.js';

// Exports that live on window (not moved to a specific toolbar module)
// These thin shims read from window globals set by the original files or toolbar-root.js

export function _browseActiveEl() {
  var tab = (typeof _browseTabs !== 'undefined' ? _browseTabs : []).find(function(t) { return t.id === (typeof _browseActiveTab !== 'undefined' ? _browseActiveTab : -1); });
  return tab ? tab.el : null;
}

// Navigation direction flag — used by browse-downloads.js did-navigate handler
export var _browseNavDirection = null;
// _clearBrowseNavDirection is re-exported from toolbar-nav.js above

// Mic recording state — these are set/read by core-audio.js and browse-ai-pill.js
export var _pillMicRecorder = null;
export var _pillMicRecognition = null;
export var _pillMicTranscript = '';
export var _pillMicLiveText = '';

export function _pillMicClick() {
  if (typeof window._pillMicClick === 'function') window._pillMicClick();
}

// Tab hover timeouts (used by browse-features.js)
export var _tabHoverTimeout = null;
export var _tabHoverDismissTimeout = null;

// Tab drag state (used by browse-pill.js)
export var _tabDragState = null;
export var TAB_DRAG_THRESHOLD = 5;

// Zoom state vars (used by browse-features.js, browse-passwords.js)
export var _browseZoomLevel = 1.0;
export var _browseZoomPanX = 0;
export var _browseZoomPanY = 0;

// No-op stubs for functions now handled reactively
export function _updateIslandNavButtons() {}

// Close other tabs helper (used by panel-chat.js)
export function _browseCloseOtherTabs(keepId) {
  if (typeof window._browseCloseOtherTabs === 'function') window._browseCloseOtherTabs(keepId);
}

// Pill tabs dropdown cleanup
export function _pillTabsDropdownCleanup() {}
export var _pillTabsOutsideHandler = null;
export var _pillTabsBlurHandler = null;
export var _pillTabsBlurTimer = null;

// History dropdown state
export var _historyDropdownEl = null;
export var _historyDropdownHideTimer = 0;

export function _historyDropdownNavigate(direction, steps) {
  for (var i = 0; i < steps; i++) {
    if (direction === 'back') browseBack();
    else browseForward();
  }
}

// Group helpers that delegate to window
export function _browseUngroupAll(groupId) { if (typeof window._browseUngroupAll === 'function') window._browseUngroupAll(groupId); }
export function _browseCloseGroup(groupId) { if (typeof window._browseCloseGroup === 'function') window._browseCloseGroup(groupId); }
export function _browseStartRenameGroup(groupId, nameEl) { if (typeof window._browseStartRenameGroup === 'function') window._browseStartRenameGroup(groupId, nameEl); }
export function _browseDismissTabContextMenu() { if (typeof window._browseDismissTabContextMenu === 'function') window._browseDismissTabContextMenu(); }
export function _browseShowZoomControls() {}
export function _tabDragUpdatePosition(clientPos) {}
