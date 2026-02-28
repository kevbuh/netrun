// toolbar-island.js — Island expand/collapse, sub-states, tab pill, actions, utility
import Settings from '/js/core/core-settings.js';
import { islandExpanded, islandSubState, isNtp, notifyTabsChanged } from '/js/toolbar/toolbar-state.js';
import { _browseTitleFromUrl, _browseFaviconUrl } from '/js/toolbar/toolbar-nav.js';
import { _pillSyncUrl } from '/js/toolbar/toolbar-url.js';
import { _browseRenderTabs, _getActiveTabBar } from '/js/toolbar/toolbar-tabs.js';
import { icon } from '/js/core/icons.js';
import { browseSelectTab, browseCloseTab } from '/js/browse/browse-passwords.js';
import { toggleCaptions } from '/js/browse/browse-captions.js';

// ── Island pill position sync ──

export function _syncIslandPillPosition() {
  var pill = document.getElementById('sidebar-nav');
  var island = document.getElementById('pill-island');
  var urlWrap = document.getElementById('pill-url-wrap');
  if (!pill || !island || !urlWrap) return;
  var isIsland = pill.classList.contains('island-mode');
  var isNtpActive = pill.classList.contains('ntp-active');
  var tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  var tabsPill = tabsAnchor ? tabsAnchor.querySelector('.pill-island[data-island-id="tabs"]') :
    island.querySelector('.pill-island[data-island-id="tabs"]');
  if (isIsland) {
    if (island.parentElement !== urlWrap) urlWrap.insertBefore(island, urlWrap.firstChild);
    // Keep pill-island-left (tabs anchor container) as first child so tabs render on the left
    var leftCol = document.getElementById('pill-island-left');
    if (leftCol && leftCol.parentElement === urlWrap && urlWrap.firstChild !== leftCol) {
      urlWrap.insertBefore(leftCol, urlWrap.firstChild);
    }
    // NTP: tabs pill inside island (centered capsule); normal: in tabs anchor
    if (isNtpActive && tabsPill && tabsPill.parentElement !== island) island.insertBefore(tabsPill, island.firstChild);
    if (!isNtpActive && tabsPill && tabsAnchor && tabsPill.parentElement !== tabsAnchor) tabsAnchor.insertBefore(tabsPill, tabsAnchor.firstChild);
  } else {
    var navIcons = document.getElementById('pill-nav-icons');
    if (island.parentElement === urlWrap) pill.insertBefore(island, navIcons);
    if (tabsPill && tabsAnchor && tabsPill.parentElement !== tabsAnchor) tabsAnchor.insertBefore(tabsPill, tabsAnchor.firstChild);
  }
}

// ── Layout apply ──

export function _applyBrowseTabLayout() {
  var bar = document.getElementById('browse-bar');
  var pill = document.getElementById('sidebar-nav');
  var browseView = document.getElementById('browse-view');
  var browseOpen = browseView && browseView.style.display === 'flex';
  if (bar) bar.style.display = 'none';
  if (browseOpen) {
    if (pill) { pill.classList.add('browse-mode'); pill.classList.add('island-mode'); }
    _pillSyncUrl();
    _syncIslandPillPosition();
    if (typeof window._islandSyncBookmark === 'function') window._islandSyncBookmark();
  } else {
    if (pill) { pill.classList.remove('browse-mode', 'island-mode', 'ntp-active'); }
    _syncIslandPillPosition();
    _collapseIsland();
    if (typeof window.islandRemove === 'function') {
      window.islandRemove('tabs');
      window.islandRemove('bookmark');
    }
  }
  _browseRenderTabs();
}

// ── Expand/collapse ──

var _islandExpandedOutsideHandler = null;
var _islandExpandedBlurHandler = null;
var _islandAnimating = false;
var _islandAnimCancel = null;

// ── Helper: snapshot favicon rects from the compact strip ──

function _snapshotStripFavicons(wrap) {
  var result = [];
  var strip = wrap.querySelector('.island-favicon-strip');
  if (!strip) return result;
  var kids = strip.children;
  for (var i = 0; i < kids.length; i++) {
    var kid = kids[i];
    var tabId = kid.getAttribute('data-island-tab');
    if (!tabId) continue;
    var favEl = kid.tagName === 'IMG' ? kid : (kid.querySelector('img') || kid.querySelector('svg') || kid);
    if (!favEl) continue;
    var r = favEl.getBoundingClientRect();
    if (r.width === 0) continue;
    result.push({ tabId: tabId, rect: r, clone: favEl.cloneNode(true) });
  }
  return result;
}

// ── Helper: snapshot favicon rects from expanded vtab items ──

function _snapshotVtabFavicons(wrap, opts) {
  opts = opts || {};
  var onlyVisible = opts.onlyVisible !== false;
  var result = [];
  var items = wrap.querySelectorAll('.island-vtab-item[data-island-tab]');
  // Get the scrollable container bounds to cull offscreen items
  var leftCol = onlyVisible ? document.getElementById('pill-island-left') : null;
  var containerRect = leftCol ? leftCol.getBoundingClientRect() : null;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var tabId = item.getAttribute('data-island-tab');
    var img = item.querySelector('img') || item.querySelector('svg');
    if (!img) continue;
    var r = img.getBoundingClientRect();
    if (r.width === 0) continue;
    // Skip items scrolled out of the visible area
    if (containerRect && (r.bottom < containerRect.top || r.top > containerRect.bottom)) continue;
    result.push({ tabId: tabId, rect: r, clone: img.cloneNode(true) });
  }
  return result;
}

// ── Helper: build a ghost layer + create ghosts, animate from→to ──

// Dynamic Island-style easing: fluid deceleration, no overshoot
var _islandEasing = 'cubic-bezier(0.5, 0.0, 0.0, 1.0)';

function _createGhostAnimation(fromFavicons, toMap, duration, stagger, opts) {
  opts = opts || {};
  var layer = document.createElement('div');
  layer.className = 'island-ghost-layer';
  document.body.appendChild(layer);
  var anims = [];
  var easing = _islandEasing;
  var scalePulse = opts.scalePulse !== false;
  var crossFade = opts.crossFade !== false;

  for (var i = 0; i < fromFavicons.length; i++) {
    var f = fromFavicons[i];
    var ghost = f.clone;
    ghost.style.cssText = 'position:fixed;pointer-events:none;margin:0;padding:0;border:none;' +
      'left:' + f.rect.left + 'px;top:' + f.rect.top + 'px;' +
      'width:' + f.rect.width + 'px;height:' + f.rect.height + 'px;' +
      'border-radius:3px;object-fit:contain;will-change:transform,opacity;';
    layer.appendChild(ghost);

    var target = toMap[f.tabId];
    if (target) {
      var dx = target.left - f.rect.left;
      var dy = target.top - f.rect.top;
      var midScale = scalePulse ? ' scale(1.04)' : ' scale(1)';
      var endOpacity = crossFade ? 0 : 1;
      anims.push(ghost.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
          { transform: 'translate(' + (dx*0.5) + 'px,' + (dy*0.5) + 'px)' + midScale, opacity: 1, offset: 0.5 },
          { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1)', opacity: endOpacity, offset: 1 }
        ],
        { duration: duration, easing: easing, fill: 'forwards', delay: (stagger || 0) * i }
      ));
    } else {
      anims.push(ghost.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: duration * 0.6, easing: easing, fill: 'forwards' }
      ));
    }
  }
  return { layer: layer, anims: anims };
}

// ── Animated expand: FLIP ghost-clone favicons + height morph ──

function _animateExpand(wrap) {
  if (_islandAnimCancel) { _islandAnimCancel(); _islandAnimCancel = null; }
  _islandAnimating = true;

  // 1. Snapshot compact state
  var compactRect = wrap.getBoundingClientRect();
  var compactFavicons = _snapshotStripFavicons(wrap);

  // 2. Lock width to compact width
  wrap.style.width = compactRect.width + 'px';

  // 3. Apply expanded state + render content
  wrap.classList.add('island-expanded');
  islandExpanded.value = true;
  var input = document.getElementById('pill-browse-url-input');
  if (input) { input.style.width = ''; input.style.maxWidth = ''; input.style.opacity = ''; input.style.display = ''; input.style.overflow = ''; }
  _moveElementsIntoIsland();
  _renderIslandTabPill();
  _renderIslandActions();
  _pillSyncUrl();

  // 4. Force layout to get expanded dimensions
  wrap.style.width = '';
  void wrap.offsetHeight;
  var expandedRect = wrap.getBoundingClientRect();
  var expandedHeight = expandedRect.height;
  var expandedWidth = expandedRect.width;

  // 5. Snapshot expanded favicon positions → map by tab ID
  var expandedVtabs = _snapshotVtabFavicons(wrap);
  var expandedMap = {};
  for (var i = 0; i < expandedVtabs.length; i++) expandedMap[expandedVtabs[i].tabId] = expandedVtabs[i].rect;

  // 6. Set wrapper to compact dimensions for animation start
  wrap.style.width = compactRect.width + 'px';
  wrap.style.height = compactRect.height + 'px';
  wrap.style.overflow = 'hidden';
  wrap.classList.add('island-animating');

  // 7. Hide expanded tab list rows (will stagger-reveal during animation)
  var leftCol = document.getElementById('pill-island-left');
  var vtabItems = leftCol ? leftCol.querySelectorAll('.island-vtab-item, .island-vtab-header') : [];
  if (leftCol) leftCol.style.opacity = '0';

  // 8. Create ghost favicons with subtle scale pulse + cross-fade
  var cancelled = false;
  var ghosts = _createGhostAnimation(compactFavicons, expandedMap, 260, 20, { scalePulse: true, crossFade: true });

  // 9. Animate wrapper height + width + border-radius growth (Dynamic Island style)
  wrap.style.willChange = 'width, height, border-radius';
  var morphAnim = wrap.animate(
    [
      { height: compactRect.height + 'px', width: compactRect.width + 'px', borderRadius: '12px' },
      { height: expandedHeight + 'px', width: expandedWidth + 'px', borderRadius: '16px' }
    ],
    { duration: 260, easing: _islandEasing, fill: 'forwards' }
  );

  // 10. Staggered per-row reveal of tab list — fluid fade-up
  var rowStagger = 22;
  var rowBaseDelay = 70;
  var fadeTimer = setTimeout(function() {
    if (cancelled) return;
    if (leftCol) leftCol.style.opacity = '1';
    for (var ri = 0; ri < vtabItems.length; ri++) {
      (function(item, idx) {
        item.style.opacity = '0';
        item.style.transform = 'translateY(4px)';
        setTimeout(function() {
          if (cancelled) return;
          item.style.transition = 'opacity 180ms cubic-bezier(0.4, 0.0, 0.0, 1.0), transform 180ms cubic-bezier(0.4, 0.0, 0.0, 1.0)';
          item.style.opacity = '1';
          item.style.transform = 'translateY(0)';
          setTimeout(function() {
            item.style.transition = '';
            item.style.transform = '';
          }, 190);
        }, idx * rowStagger);
      })(vtabItems[ri], ri);
    }
  }, rowBaseDelay);

  // Cancel function
  _islandAnimCancel = function() {
    cancelled = true;
    clearTimeout(fadeTimer);
    try { morphAnim.cancel(); } catch(e) {}
    for (var ai = 0; ai < ghosts.anims.length; ai++) try { ghosts.anims[ai].cancel(); } catch(e) {}
    ghosts.layer.remove();
    _clearRowStyles(leftCol, vtabItems);
    wrap.style.width = '';
    wrap.style.height = '';
    wrap.style.overflow = '';
    wrap.style.willChange = '';
    wrap.classList.remove('island-animating');
    _islandAnimating = false;
    _islandAnimCancel = null;
  };

  // 11. Cleanup on finish
  morphAnim.finished.then(function() {
    if (cancelled) return;
    try { morphAnim.cancel(); } catch(e) {}
    ghosts.layer.remove();
    _clearRowStyles(leftCol, vtabItems);
    wrap.style.width = '';
    wrap.style.height = '';
    wrap.style.overflow = '';
    wrap.style.willChange = '';
    wrap.classList.remove('island-animating');
    _islandAnimating = false;
    _islandAnimCancel = null;
  }).catch(function() {
    ghosts.layer.remove();
    _clearRowStyles(leftCol, vtabItems);
    wrap.style.width = '';
    wrap.style.height = '';
    wrap.style.overflow = '';
    wrap.style.willChange = '';
    wrap.classList.remove('island-animating');
    _islandAnimating = false;
  });
}

function _clearRowStyles(leftCol, vtabItems) {
  if (leftCol) { leftCol.style.opacity = ''; leftCol.style.transition = ''; }
  for (var i = 0; i < vtabItems.length; i++) {
    vtabItems[i].style.opacity = '';
    vtabItems[i].style.transform = '';
    vtabItems[i].style.transition = '';
  }
}

// ── Animated collapse: reverse FLIP — favicons fly back to compact strip ──

function _animateCollapse(wrap) {
  _islandAnimating = true;
  var cancelled = false;

  // 1. Snapshot expanded state
  var expandedRect = wrap.getBoundingClientRect();
  var expandedHeight = expandedRect.height;
  var expandedWidth = expandedRect.width;
  var expandedFavicons = _snapshotVtabFavicons(wrap);

  // 2. Hide expanded content BEFORE collapsing to prevent flash
  var leftCol = document.getElementById('pill-island-left');
  if (leftCol) leftCol.style.visibility = 'hidden';

  // 3. Instantly apply compact state
  _doCollapse(wrap);
  void wrap.offsetHeight;

  // 4. Measure compact favicon positions + compact dimensions
  var compactRect = wrap.getBoundingClientRect();
  var compactHeight = compactRect.height;
  var compactWidth = compactRect.width;
  var compactFavicons = _snapshotStripFavicons(wrap);
  var compactMap = {};
  for (var i = 0; i < compactFavicons.length; i++) compactMap[compactFavicons[i].tabId] = compactFavicons[i].rect;

  // 5. Hide each compact favicon individually (will reveal one-by-one as ghosts land)
  var strip = wrap.querySelector('.island-favicon-strip');
  var stripFavEls = strip ? strip.querySelectorAll('[data-island-tab]') : [];
  var stripOverflow = strip ? strip.querySelector('.island-strip-overflow') : null;
  for (var fi = 0; fi < stripFavEls.length; fi++) stripFavEls[fi].style.opacity = '0';
  if (stripOverflow) stripOverflow.style.opacity = '0';

  // 6. Temporarily set dimensions to expanded (will animate down)
  wrap.style.width = expandedWidth + 'px';
  wrap.style.height = expandedHeight + 'px';
  wrap.style.overflow = 'hidden';

  // 7. Create ghost favicons — least recent (furthest) departs first
  var ghostCount = expandedFavicons.length;
  var ghostDuration = 200 + ghostCount * 10;  // 3 tabs → 230ms, 7 tabs → 270ms
  var ghostStagger = 10 + ghostCount * 2;     // 3 tabs → 16ms, 7 tabs → 24ms
  // Reverse so bottom items (least recent, most distance) fly first
  var departOrder = expandedFavicons.slice().reverse();
  var totalGhostTime = ghostDuration + ghostStagger * Math.max(0, ghostCount - 1);
  var ghosts = _createGhostAnimation(departOrder, compactMap, ghostDuration, ghostStagger, { scalePulse: true, crossFade: true });

  // 8. Reveal each compact favicon as its ghost arrives (staggered pop-in, same order as departure)
  var revealTimers = [];
  for (var ri = 0; ri < departOrder.length; ri++) {
    (function(idx) {
      var arriveAt = ghostStagger * idx + ghostDuration * 0.7; // reveal at 70% of ghost flight
      var timer = setTimeout(function() {
        if (cancelled) return;
        var tabId = departOrder[idx].tabId;
        // Find matching compact favicon by data-island-tab
        var el = strip ? strip.querySelector('[data-island-tab="' + tabId + '"]') : null;
        if (el) {
          el.style.transition = 'opacity 80ms ease';
          el.style.opacity = '1';
          setTimeout(function() { el.style.transition = ''; }, 90);
        }
      }, arriveAt);
      revealTimers.push(timer);
    })(ri);
  }
  // Reveal overflow count label at the end
  var overflowTimer = setTimeout(function() {
    if (cancelled || !stripOverflow) return;
    stripOverflow.style.transition = 'opacity 80ms ease';
    stripOverflow.style.opacity = '1';
    setTimeout(function() { if (stripOverflow) stripOverflow.style.transition = ''; }, 90);
  }, totalGhostTime * 0.8);

  // 9. Animate wrapper height + width + border-radius shrink (Dynamic Island style)
  wrap.style.willChange = 'width, height, border-radius';
  var morphAnim = wrap.animate(
    [
      { height: expandedHeight + 'px', width: expandedWidth + 'px', borderRadius: '16px' },
      { height: compactHeight + 'px', width: compactWidth + 'px', borderRadius: '12px' }
    ],
    { duration: totalGhostTime, easing: _islandEasing, fill: 'forwards' }
  );

  var _cleanup = function() {
    for (var ci = 0; ci < revealTimers.length; ci++) clearTimeout(revealTimers[ci]);
    clearTimeout(overflowTimer);
    ghosts.layer.remove();
    // Reset per-favicon styles
    for (var fi = 0; fi < stripFavEls.length; fi++) { stripFavEls[fi].style.opacity = ''; stripFavEls[fi].style.transition = ''; }
    if (stripOverflow) { stripOverflow.style.opacity = ''; stripOverflow.style.transition = ''; }
    var lc = document.getElementById('pill-island-left');
    if (lc) lc.style.visibility = '';
    wrap.style.width = '';
    wrap.style.height = '';
    wrap.style.overflow = '';
    wrap.style.willChange = '';
    _islandAnimating = false;
    _islandAnimCancel = null;
  };

  _islandAnimCancel = function() {
    cancelled = true;
    try { morphAnim.cancel(); } catch(e) {}
    for (var ai = 0; ai < ghosts.anims.length; ai++) try { ghosts.anims[ai].cancel(); } catch(e) {}
    _cleanup();
  };

  morphAnim.finished.then(function() {
    if (cancelled) return;
    try { morphAnim.cancel(); } catch(e) {}
    _cleanup();
  }).catch(function() {
    _cleanup();
  });
}

export function _expandIsland() {
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap || wrap.classList.contains('island-expanded')) return;

  // Cancel any in-flight animation
  if (_islandAnimCancel) { _islandAnimCancel(); _islandAnimCancel = null; }

  // Lock width to compact pill width BEFORE expanding — flex-wrap on an absolutely
  // positioned element would otherwise stretch to the containing block width.
  wrap.style.width = wrap.getBoundingClientRect().width + 'px';

  if (typeof Motion !== 'undefined' && Motion.animate) {
    _animateExpand(wrap);
  } else {
    // Fallback: instant expand (Motion not loaded yet)
    wrap.classList.add('island-expanded');
    islandExpanded.value = true;
    var input = document.getElementById('pill-browse-url-input');
    if (input) { input.style.width = ''; input.style.maxWidth = ''; input.style.opacity = ''; input.style.display = ''; input.style.overflow = ''; }
    _moveElementsIntoIsland();
    _renderIslandTabPill();
    _renderIslandActions();
    _pillSyncUrl();
  }

  _collapseIslandCleanup();
  _islandExpandedOutsideHandler = function(e) {
    if (wrap.contains(e.target)) return;
    if (_islandTabsDropdownEl && _islandTabsDropdownEl.contains(e.target)) return;
    _collapseIsland();
  };
  _islandExpandedBlurHandler = function() { _collapseIsland(); };
  setTimeout(function() {
    document.addEventListener('mousedown', _islandExpandedOutsideHandler, true);
    window.addEventListener('blur', _islandExpandedBlurHandler);
  }, 0);
}

export function _collapseIsland() {
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;

  // Cancel any in-flight animation
  if (_islandAnimCancel) { _islandAnimCancel(); _islandAnimCancel = null; }

  // Animate collapse when expanded and Motion is available
  if (wrap.classList.contains('island-expanded') && typeof Motion !== 'undefined' && Motion.animate) {
    _animateCollapse(wrap);
  } else {
    _doCollapse(wrap);
  }
}

function _doCollapse(wrap) {
  wrap.classList.remove('island-expanded', 'island-ai-expanded', 'island-cc-live', 'island-animating');
  wrap.style.width = '';
  wrap.style.height = '';
  wrap.style.overflow = '';
  islandExpanded.value = false;
  islandSubState.value = 'default';
  _closeIslandTabsDropdown();
  _collapseIslandCleanup();
  _restoreElementsFromIsland();
  var aiFull = document.getElementById('pill-island-ai-full');
  var actionsRow = document.getElementById('pill-island-actions-row');
  if (aiFull) AetherUI.mount(new View('div'), aiFull);
  if (actionsRow) actionsRow.remove();
  var tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  if (tabsAnchor) tabsAnchor.style.display = '';
  // Re-render compact pill content (replaces expanded tab list in leftCol)
  _renderIslandActions();
}

function _collapseIslandCleanup() {
  if (_islandExpandedOutsideHandler) {
    document.removeEventListener('mousedown', _islandExpandedOutsideHandler, true);
    _islandExpandedOutsideHandler = null;
  }
  if (_islandExpandedBlurHandler) {
    window.removeEventListener('blur', _islandExpandedBlurHandler);
    _islandExpandedBlurHandler = null;
  }
}

function _moveElementsIntoIsland() {
  // AI pill is now a satellite — no elements to move
}

function _restoreElementsFromIsland() {
  var leftCol = document.getElementById('pill-island-left');
  if (leftCol) { AetherUI.mount(new View('div'), leftCol); leftCol.onclick = null; }
  var rightCol = document.getElementById('pill-island-right-col');
  if (rightCol) { AetherUI.mount(new View('div'), rightCol); rightCol.onclick = null; }
}

// ── Sub-state management ──

function _setIslandSubState(state) {
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  wrap.classList.remove('island-ai-expanded');
  if (islandSubState.value === state) {
    islandSubState.value = 'default';
    return;
  }
  islandSubState.value = state;
  if (state === 'ai') {
    wrap.classList.add('island-ai-expanded');
    _renderIslandAIFull();
  }
}

// ── Render island tab pill (expanded left column) ──

function _renderIslandTabPill() {
  var leftCol = document.getElementById('pill-island-left');
  if (!leftCol) return;
  var tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  if (tabsAnchor) tabsAnchor.style.display = 'none';

  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) { AetherUI.mount(new View('div'), leftCol); return; }
  var activeTabId = win.activeTab;

  // Sort tabs by recency (most recently visited first) — matches compact favicon strip order
  var sortedTabs = win.tabs.filter(function(t) { return !t.blank; }).slice();
  sortedTabs.sort(function(a, b) { return (b.lastVisited || 0) - (a.lastVisited || 0); });

  var globeSvg = '<svg style="width:16px;height:16px;opacity:0.4;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  var plusSvg = '<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>';

  var rows = sortedTabs.map(function(t) {
    var isActive = t.id === activeTabId;
    var title = t.title || 'New Tab';
    var truncTitle = title;
    var favView = t.favicon
      ? window.Image(t.favicon).frame({ width: 16, height: 16 }).cornerRadius('xs').styles({ flexShrink: '0' })
          .on('error', function() { this.style.display = 'none'; })
      : window.RawHTML(globeSvg);
    var nameView = window.Text(truncTitle).className('island-vtab-item-title');
    var closeBtn = window.Text('\u00d7').className('island-vtab-item-close').attr('title', 'Close tab')
      .onTap(function(e) {
        e.stopPropagation();
        browseCloseTab(t.id);
        setTimeout(_renderIslandTabPill, 50);
      });
    return window.HStack([favView, nameView, closeBtn])
      .className('island-vtab-item' + (isActive ? ' active' : ''))
      .attr('data-island-tab', t.id)
      .onTap(function(e) {
        e.stopPropagation();
        browseSelectTab(t.id);
        setTimeout(_renderIslandTabPill, 50);
      });
  });

  AetherUI.mount(window.VStack(rows), leftCol);
  leftCol.onclick = null;
}

// ── Tabs dropdown (below capsule) ──

var _islandTabsDropdownEl = null;
var _islandTabsOutsideHandler = null;

function _toggleIslandTabsDropdown() {
  if (_islandTabsDropdownEl) {
    _closeIslandTabsDropdown();
    return;
  }
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) return;
  var activeTabId = win.activeTab;
  var globeSvg = '<svg style="width:14px;height:14px;opacity:0.4;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  var rows = win.tabs.map(function(t) {
    var favView = t.favicon
      ? window.Image(t.favicon).frame({ width: 14, height: 14 }).cornerRadius('xs').styles({ flexShrink: '0' })
          .on('error', function() { this.style.display = 'none'; })
      : window.RawHTML(globeSvg);
    var title = (t.title || 'New Tab');
    var nameView = window.Text(title.length > 32 ? title.slice(0, 30) + '\u2026' : title)
      .flex(1).styles({ minWidth: '0' }).truncate();
    var closeBtn = window.Text('\u00d7').className('island-tabs-full-close').attr('title', 'Close tab')
      .onTap(function(e) {
        e.stopPropagation();
        browseCloseTab(t.id);
        setTimeout(function() { _closeIslandTabsDropdown(); _toggleIslandTabsDropdown(); }, 50);
      });
    return window.HStack([favView, nameView, closeBtn])
      .className('island-tabs-full-item' + (t.id === activeTabId ? ' active' : ''))
      .onTap(function(e) {
        e.stopPropagation();
        browseSelectTab(t.id);
        _closeIslandTabsDropdown();
        setTimeout(_renderIslandTabPill, 50);
      });
  });

  // New tab row
  var newTabIcon = window.RawHTML('<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>');
  rows.push(new window.View('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '2px 10px' }));
  rows.push(window.HStack([newTabIcon, window.Text('New tab')])
    .className('island-tabs-full-item')
    .onTap(function() {
      _closeIslandTabsDropdown();
      _collapseIsland();
      if (typeof window.browseNewTab === 'function') window.browseNewTab();
    }));

  var wrapRect = wrap.getBoundingClientRect();
  var panel = window.VStack(rows)
    .position('fixed')
    .background('overlay')
    .cornerRadius('lg')
    .shadow('popup')
    .border('border-default')
    .colorScheme('dark')
    .frame({ maxHeight: 320, minWidth: Math.round(wrapRect.width) })
    .overflow('auto')
    .zIndex('modal')
    .padding('6px', '0')
    .styles({
      left: Math.round(wrapRect.left) + 'px',
      top: Math.round(wrapRect.bottom + 4) + 'px'
    });
  var dd = panel.el;
  document.body.appendChild(dd);
  _islandTabsDropdownEl = dd;

  setTimeout(function() {
    _islandTabsOutsideHandler = function(e) {
      if (dd.contains(e.target)) return;
      var leftCol = document.getElementById('pill-island-left');
      if (leftCol && leftCol.contains(e.target)) return;
      _closeIslandTabsDropdown();
    };
    document.addEventListener('mousedown', _islandTabsOutsideHandler, true);
  }, 0);
}

function _closeIslandTabsDropdown() {
  if (_islandTabsDropdownEl) {
    _islandTabsDropdownEl.remove();
    _islandTabsDropdownEl = null;
  }
  if (_islandTabsOutsideHandler) {
    document.removeEventListener('mousedown', _islandTabsOutsideHandler, true);
    _islandTabsOutsideHandler = null;
  }
}

// ── Render AI panel ──

function _renderIslandAIFull() {
  var container = document.getElementById('pill-island-ai-full');
  if (!container) return;
  AetherUI.mount(new View('div'), container);
  if (typeof window.renderAIPanelContent === 'function') {
    window.renderAIPanelContent(container, function() { _setIslandSubState('default'); });
  }
}


// ── Render action icons ──

export function _renderIslandActions() {
  var centerCol = document.getElementById('pill-island-center');
  if (!centerCol) return;
  // Remove any previous actions/pageinfo content
  var actionsId = 'pill-island-actions-row';
  var existing = document.getElementById(actionsId);
  if (existing) existing.remove();

  var V = window.View, T = window.Text, H = window.HStack, VS = window.VStack;

  // ── CC Live mode: center column becomes sole column with captions ──
  var wrap = document.getElementById('pill-url-wrap');
  if (window._ccActive) {
    if (wrap) { wrap.classList.add('island-cc-live');  }

    var ccAct = window._islandActivities ? window._islandActivities.value.cc : null;
    var lines = (ccAct && ccAct.lines) ? ccAct.lines : [];
    var visibleCount = 6;
    var start = Math.max(0, lines.length - visibleCount);
    var visible = lines.slice(start);

    var ccRows = [];
    // Header
    var stopBtn = T('Stop').styles({ fontSize: '0.7rem', cursor: 'pointer', color: '#ef4444' })
      .onTap(function() { toggleCaptions(); });
    ccRows.push(H([
      H([
        new V('span').frame({ width: 6, height: 6 }).cornerRadius('full')
          .styles({ background: 'var(--nr-accent)', boxShadow: '0 0 6px var(--nr-accent)' }),
        T('CC Live').styles({ fontSize: '0.65rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.3px' }).opacity(0.5)
      ]).spacing(1),
      stopBtn
    ]).styles({ justifyContent: 'space-between', width: '100%' }));

    // Lines
    var linesView = VS([]).className('ai-unified-cc-lines');
    for (var ci = 0; ci < visible.length; ci++) {
      var fromEnd = visible.length - 1 - ci;
      var op = fromEnd === 0 ? '1' : fromEnd === 1 ? '0.7' : fromEnd === 2 ? '0.45' : '0.25';
      linesView.add(T(visible[ci]).className('ai-unified-cc-line').opacity(op));
    }
    if (visible.length === 0) {
      linesView.add(T('Waiting for audio\u2026').className('ai-unified-cc-line').opacity(0.3));
    }
    ccRows.push(linesView);

    var ccContainer = VS(ccRows).className('ai-unified-cc-tray').styles({ gap: '6px', alignItems: 'stretch', padding: '0 4px' });
    ccContainer.id(actionsId);
    AetherUI.append(ccContainer, centerCol);
    return;
  }
  // ── Mic Live mode: center column becomes sole column with transcript ──
  if (window._pillMicRecorder) {
    if (wrap) { wrap.classList.add('island-cc-live');  }

    var micAct = window._islandActivities ? window._islandActivities.value.mic : null;
    var micLines = (micAct && micAct.lines) ? micAct.lines : [];
    var micVisibleCount = 6;
    var micStart = Math.max(0, micLines.length - micVisibleCount);
    var micVisible = micLines.slice(micStart);

    var micRows = [];
    // Header
    var micStopBtn = T('Stop').styles({ fontSize: '0.7rem', cursor: 'pointer', color: '#ef4444' })
      .onTap(function() { if (typeof window._pillMicClick === 'function') window._pillMicClick(); });
    micRows.push(H([
      H([
        new V('span').frame({ width: 6, height: 6 }).cornerRadius('full')
          .styles({ background: '#ef4444', boxShadow: '0 0 6px #ef4444' }),
        T('Listening\u2026').styles({ fontSize: '0.65rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.3px' }).opacity(0.5)
      ]).spacing(1),
      micStopBtn
    ]).styles({ justifyContent: 'space-between', width: '100%' }));

    // Lines
    var micLinesView = VS([]).className('ai-unified-cc-lines');
    for (var mi = 0; mi < micVisible.length; mi++) {
      var micFromEnd = micVisible.length - 1 - mi;
      var micOp = micFromEnd === 0 ? '1' : micFromEnd === 1 ? '0.7' : micFromEnd === 2 ? '0.45' : '0.25';
      micLinesView.add(T(micVisible[mi]).className('ai-unified-cc-line').opacity(micOp));
    }
    if (micVisible.length === 0) {
      micLinesView.add(T('Waiting for audio\u2026').className('ai-unified-cc-line').opacity(0.3));
    }
    micRows.push(micLinesView);

    var micContainer = VS(micRows).className('ai-unified-cc-tray').styles({ gap: '6px', alignItems: 'stretch', padding: '0 4px' });
    micContainer.id(actionsId);
    AetherUI.append(micContainer, centerCol);
    return;
  }
  // Not in CC/mic mode — remove layout class
  if (wrap) { wrap.classList.remove('island-cc-live'); }
}

// ── Render utility row ──

function _renderIslandUtilityRow() {
  var row = document.getElementById('pill-island-utility-row');
  if (!row) return;
  var buttons = [
    { iconName: 'plus', label: 'New Tab', handler: function() { _collapseIsland(); if (typeof window.browseNewTab === 'function') window.browseNewTab(); } },
    { iconName: 'close', label: 'Close', handler: function() { browseCloseTab(_browseActiveTab); setTimeout(_renderIslandTabPill, 50); } },
    { id: 'pill-island-bookmark-btn', iconName: 'bookmark', label: 'Save', handler: function() { if (typeof window.browseSaveToReadingList === 'function') window.browseSaveToReadingList(); _syncUtilityBookmark(); } },
  ];
  var btnViews = buttons.map(function(b) {
    var view = new window.View('button').className('island-utility-btn')
      .add(window.RawHTML(icon(b.iconName, { size: 14 })), window.Text(b.label))
      .onTap(function(e) { e.stopPropagation(); b.handler(); });
    if (b.id) view.el.id = b.id;
    return view;
  });
  AetherUI.mount(window.HStack(btnViews), row);
  _syncUtilityBookmark();
}

function _syncUtilityBookmark() {
  var btn = document.getElementById('pill-island-bookmark-btn');
  if (!btn) return;
  var tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  if (tab && !tab.blank && tab.url && typeof window.isPostSaved === 'function' && window.isPostSaved(tab.url)) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
}

// ── Pill menu toggle ──

var _pillMenuLeaveTimer = null;

export function _togglePillMenu() {
  var pill = document.getElementById('sidebar-nav');
  if (!pill) return;
  // In browse mode, delegate to the more menu dropdown instead of expanding the pill
  if (pill.classList.contains('browse-mode')) {
    if (typeof window.toggleBrowseMoreMenu === 'function') window.toggleBrowseMoreMenu();
    return;
  }
  var opening = !pill.classList.contains('menu-expanded');
  pill.classList.toggle('menu-expanded');
  if (opening) {
    document.body.classList.add('island-dropdown-guard');
    setTimeout(function() { document.addEventListener('mousedown', _pillMenuOutsideClick); }, 0);
  } else {
    document.body.classList.remove('island-dropdown-guard');
    document.removeEventListener('mousedown', _pillMenuOutsideClick);
  }
}

function _pillMenuOutsideClick(e) {
  var pill = document.getElementById('sidebar-nav');
  if (!pill || !pill.classList.contains('menu-expanded')) {
    document.removeEventListener('mousedown', _pillMenuOutsideClick);
    return;
  }
  if (e.target.closest('#pill-menu-btn') || e.target.closest('#pill-nav-icons') || e.target.closest('#pill-browse-hamburger')) return;
  _closePillMenu();
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

export function _closePillMenu() {
  var pill = document.getElementById('sidebar-nav');
  if (pill) pill.classList.remove('menu-expanded');
  document.body.classList.remove('island-dropdown-guard');
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

export function _openPillMenuHover() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
  var pill = document.getElementById('sidebar-nav');
  if (!pill || pill.classList.contains('menu-expanded') || pill.classList.contains('browse-mode')) return;
  pill.classList.add('menu-expanded');
}

export function _closePillMenuHover() {
  _pillMenuLeaveTimer = setTimeout(function() { _closePillMenu(); }, 200);
}

export function _cancelPillMenuClose() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
}

// ── Favicon click → navigate to tab (capture phase, fires before expand) ──

document.addEventListener('click', function(e) {
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap || wrap.classList.contains('island-expanded')) return;
  var favEl = e.target.closest('[data-island-tab]');
  if (!favEl || !wrap.contains(favEl)) return;
  // Close button inside a favicon wrap
  if (e.target.closest('[data-island-tab-close]')) {
    e.stopPropagation();
    var closeId = +e.target.closest('[data-island-tab-close]').getAttribute('data-island-tab-close');
    browseCloseTab(closeId);
    return;
  }
  e.stopPropagation();
  var tabId = +favEl.getAttribute('data-island-tab');
  browseSelectTab(tabId);
}, true);

// ── Click handler for capsule expand ──

document.addEventListener('click', function(e) {
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  if (wrap.classList.contains('island-expanded')) return;
  // Don't expand when clicking satellite pills — they have their own tray handlers
  if (e.target.closest('.pill-satellite-container')) return;
  if (wrap.contains(e.target)) _expandIsland();
});

document.addEventListener('DOMContentLoaded', function() {
  var input = document.getElementById('pill-browse-url-input');
  if (input) input.addEventListener('focus', function() {
    _expandIsland();
  });
});

// Auto-focus NTP search input when typing
document.addEventListener('keydown', function(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length !== 1) return;
  var browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  var ntp = browseView.querySelector('.browse-ntp');
  if (!ntp || ntp.style.display === 'none') return;
  var active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  var input = ntp.querySelector('#search-query');
  if (input) input.focus();
});

// ── Action registry ──
registerActions({
  _togglePillMenu: function() { _togglePillMenu(); },
  _openPillMenuHover: function() { _openPillMenuHover(); },
  _closePillMenuHover: function() { _closePillMenuHover(); },
  _cancelPillMenuClose: function() { _cancelPillMenuClose(); },
});
