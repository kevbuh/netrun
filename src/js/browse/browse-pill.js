// browse-pill.js — Re-export stub (delegates to toolbar/ modules)

export { _getActiveTabBar } from '/js/toolbar/toolbar-tabs.js';
export { _togglePillMenu, _closePillMenu } from '/js/toolbar/toolbar-island.js';

// _islandSyncTabs — previously used by core-audio.js, now a no-op
export function _islandSyncTabs() {}

// _populatePillMenuMoreItems — no longer needed, menu is built by toolbar-menu.js
export function _populatePillMenuMoreItems() {}
