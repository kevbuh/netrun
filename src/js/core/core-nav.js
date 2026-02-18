// core-nav.js — Navigation history, side panel
// Extracted from core.js
if (window.AetherUI) AetherUI.globals();

// ── Navigation history stack (survives Cmd+Shift+R via localStorage) ──

function _navSave() {
  Settings.setJSON('_navHistory', _navHistory);
  Settings.setJSON('_navForward', _navForward);
}

function _navPush(hash) {
  if (_navNavigating) return;
  if (!hash || hash === '#') return;
  // Don't push duplicates
  if (_navHistory.length && _navHistory[_navHistory.length - 1] === hash) return;
  _navHistory.push(hash);
  // Cap at 50 entries
  if (_navHistory.length > 50) _navHistory = _navHistory.slice(-50);
  // Clear forward stack on new navigation
  _navForward = [];
  _navSave();
}

function navBack() {
  if (_navHistory.length <= 1) return false;
  _navNavigating = true;
  const current = _navHistory.pop();
  _navForward.push(current);
  const prev = _navHistory[_navHistory.length - 1];
  _navSave();
  window.location.hash = prev;
  _navNavigating = false;
  return true;
}

async function openExperimentDetail(id, e) {
  // Redirect through vault — open vault and expand the project folder
  wmOpen('vault');
  window.location.hash = 'experiment/' + encodeURIComponent(id);
  setSidebarActive('sb-vault');
  setTimeout(() => {
    if (typeof vaultExpandProject === 'function') vaultExpandProject(id);
  }, 300);
}

// ── Universal Side Panel ──
const _panelRegistry = {};
let _panelVisible = Settings.get('universalPanelVisible') !== 'false'; // default true
let _panelActiveView = null;
let _panelActiveTab = null;
let _panelWidth = parseInt(Settings.get('universalPanelWidth') || '280', 10);
let _panelScrollPositions = {};
const _panelRenderedViews = {};

function registerPanelTabs(viewKey, config) {
  _panelRegistry[viewKey] = config;
}

function showPanelForView(viewKey) {
  const reg = _panelRegistry[viewKey];
  if (!reg || !reg.tabs || !reg.tabs.length) { hidePanel(); return; }
  const viewChanged = _panelActiveView !== viewKey;
  _panelActiveView = viewKey;
  const panel = document.getElementById('universal-panel');
  const tabBar = document.getElementById('universal-panel-tabs');
  const headerEl = document.getElementById('universal-panel-header');
  if (!panel || !tabBar) return;

  // Render header slot
  if (headerEl) {
    headerEl.innerHTML = '';
    if (reg.header) {
      reg.header(headerEl);
    }
  }

  // Render tab buttons
  var tabBtns = reg.tabs.map(function(t) {
    var btn = new View('button')
      .className('universal-panel-tab-btn' + (_panelActiveTab === t.id ? ' active' : ''))
      .attr('data-tab-id', t.id)
      .attr('title', t.label)
      .onTap(function() { switchPanelTab(t.id); });
    if (t.icon) btn._appendChildren([RawHTML(t.icon)]);
    btn._appendChildren([new View('span').className('panel-tab-label')._bindText(t.label)]);
    return btn;
  });
  AetherUI.mount(HStack(tabBtns), tabBar);

  // For renderAll mode, render all panes once
  const container = document.getElementById('universal-panel-content');
  if (reg.renderAll && container) {
    if (viewChanged || !_panelRenderedViews[viewKey]) {
      container.innerHTML = '';
      reg.renderContent(container);
      _panelRenderedViews[viewKey] = true;
    }
  }

  // Select default tab
  const defaultTab = reg.tabs.find(t => t.id === _panelActiveTab) ? _panelActiveTab : reg.tabs[0].id;
  switchPanelTab(defaultTab);

  if (_panelVisible) {
    panel.style.display = 'flex';
    panel.style.width = _panelWidth + 'px';
    _applyPanelMargin();
    requestAnimationFrame(() => _panelCheckTabOverflow());
  }
}

function hidePanel() {
  const panel = document.getElementById('universal-panel');
  if (panel) panel.style.display = 'none';
  _removePanelMargin();
  if (_panelActiveView && _panelRegistry[_panelActiveView]?.onHide) {
    _panelRegistry[_panelActiveView].onHide();
  }
  _panelActiveView = null;
}

function togglePanel() {
  _panelVisible = !_panelVisible;
  Settings.set('universalPanelVisible', _panelVisible ? 'true' : 'false');
  if (_panelVisible && _panelActiveView) {
    showPanelForView(_panelActiveView);
  } else {
    const panel = document.getElementById('universal-panel');
    if (panel) panel.style.display = 'none';
    _removePanelMargin();
  }
}

function switchPanelTab(tabId) {
  const reg = _panelRegistry[_panelActiveView];
  if (!reg) return;
  const tab = reg.tabs.find(t => t.id === tabId);
  if (!tab) return;
  const oldTab = _panelActiveTab;
  _panelActiveTab = tabId;

  // Update tab button active states
  document.querySelectorAll('#universal-panel-tabs .universal-panel-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tabId === tabId);
  });

  const container = document.getElementById('universal-panel-content');
  if (!container) return;

  if (reg.renderAll) {
    // Save scroll position of outgoing pane
    if (oldTab && oldTab !== tabId) {
      const oldPane = container.querySelector('[data-pane-id="' + oldTab + '"]');
      if (oldPane) _panelScrollPositions[oldTab] = oldPane.scrollTop;
    }
    // Show/hide panes by data-pane-id
    container.querySelectorAll('[data-pane-id]').forEach(pane => {
      pane.style.display = pane.dataset.paneId === tabId ? '' : 'none';
    });
    // Restore scroll position
    const newPane = container.querySelector('[data-pane-id="' + tabId + '"]');
    if (newPane && _panelScrollPositions[tabId] !== undefined) {
      setTimeout(() => { newPane.scrollTop = _panelScrollPositions[tabId]; }, 0);
    }
    // Notify tab switch callback
    if (reg.onTabSwitch) reg.onTabSwitch(oldTab, tabId);
  } else {
    container.innerHTML = '';
    tab.render(container);
  }
}

function _panelCheckTabOverflow() {
  const tabBar = document.getElementById('universal-panel-tabs');
  if (!tabBar) return;
  tabBar.classList.remove('icons-only');
  // If tabs overflow, collapse to icons only
  if (tabBar.scrollWidth > tabBar.clientWidth) {
    tabBar.classList.add('icons-only');
  }
}

function _applyPanelMargin() {
  // Set margin-right on the active view element
  const vaultView = document.getElementById('vault-view');
  if (vaultView && vaultView.style.display !== 'none') {
    vaultView.style.marginRight = _panelWidth + 'px';
  }
  // home-main
  const homeMain = document.getElementById('home-main');
  if (homeMain && homeMain.style.display !== 'none') {
    homeMain.style.marginRight = _panelWidth + 'px';
  }
  // browse-content
  const browseContent = document.getElementById('browse-content');
  if (browseContent && browseContent.offsetParent) {
    browseContent.style.marginRight = _panelWidth + 'px';
  }
}

function _removePanelMargin() {
  document.querySelectorAll('.view, #home-main').forEach(el => {
    el.style.marginRight = '';
  });
  // Also handle vault-view specifically
  const vaultView = document.getElementById('vault-view');
  if (vaultView) vaultView.style.marginRight = '';
  // browse-content
  const browseContent = document.getElementById('browse-content');
  if (browseContent) browseContent.style.marginRight = '';
}

function _invalidatePanelRender(viewKey) {
  delete _panelRenderedViews[viewKey];
  _panelScrollPositions = {};
}

function _initPanelResize() {
  const handle = document.getElementById('universal-panel-resize');
  const panel = document.getElementById('universal-panel');
  if (!handle || !panel) return;
  let startX, startW;
  function onMouseMove(e) {
    const newW = Math.max(200, Math.min(700, startW + (startX - e.clientX)));
    _panelWidth = newW;
    panel.style.width = newW + 'px';
    _applyPanelMargin();
    _panelCheckTabOverflow();
  }
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.userSelect = '';
    Settings.set('universalPanelWidth', String(_panelWidth));
  }
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = panel.offsetWidth;
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// Init resize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initPanelResize);
} else {
  _initPanelResize();
}

// Global Cmd+[/] shortcuts — browse back/forward when in browse, panel toggle otherwise
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const browseView = document.getElementById('browse-view');
  const browseVisible = browseView && browseView.style.display !== 'none';
  if (e.key === '[') {
    e.preventDefault();
    if (browseVisible && typeof browseBack === 'function') browseBack();
  } else if (e.key === ']') {
    e.preventDefault();
    if (browseVisible && typeof browseForward === 'function') browseForward();
    else togglePanel();
  }
});

// ── Route table — exact hash → action ──