// browse-menu.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
import { logger } from '/js/logger.js';
import Settings from '/js/core/core-settings.js';
import { icon } from '/js/core/icons.js';
import { getBarOverflowIds, removeFromBarOverflow } from '/js/core/core-sidebar.js';
import { _annotationsEnabled, toggleAnnotations } from '/js/browse/browse-annotations.js';
import { _browseActiveEl, browseBack, browseForward, browseReload, toggleBrowseTabLayout } from '/js/browse/browse-island.js';
import { _renderSitePermissionsDropdown, openSearchHistoryPage, toggleAdBlock } from '/js/browse-urlbar.js';
import { agentGetAccessibleDOM } from '/js/browse/browse-agent.js';
import { browseNewTab } from '/js/browse/browse-windows.js';
import { browseSaveToReadingList, browseShare } from '/js/browse/browse-features.js';
import { isPostSaved } from '/js/feed.js';
import { toggleBrowseSidebar } from '/js/views.js';

// ── Browse More window.Menu(three dots) ──

export function toggleBrowseMoreMenu() {
  const dd = document.getElementById('browse-more-menu');
  if (!dd) return;
  if (dd.style.display !== 'none') { dd.style.display = 'none'; document.body.classList.remove('island-dropdown-guard'); return; }

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const hasTab = tab && !tab.blank && tab.url;
  const isIsland = Settings.get('browseTabLayout') === 'island';

  const _closeMenu = function() { dd.style.display = 'none'; document.body.classList.remove('island-dropdown-guard'); };

  // Helper for menu buttons
  function _mBtn(svgHtml, label, action, opts) {
    opts = opts || {};
    const btn = new window.View('button');
    const row = window.HStack([window.RawHTML(svgHtml), window.Text(label).flex(1)]).spacing(2).alignment('center');
    if (opts.trailing) row.el.appendChild(opts.trailing.build());
    btn.el.appendChild(row.build());
    btn.cssText('width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:' + (opts.disabled ? 'var(--aether-text-dimmest)' : (opts.color || 'var(--aether-text)')) + ';font-size:0.78rem;cursor:' + (opts.disabled ? 'default' : 'pointer') + ';display:flex;align-items:center;gap:8px;');
    if (opts.disabled) btn.el.disabled = true;
    if (opts.dataOverflowId) btn.el.setAttribute('data-overflow-id', opts.dataOverflowId);
    btn.onHover(function() { btn.el.style.background = 'var(--aether-hover)'; }, function() { btn.el.style.background = 'none'; });
    btn.onTap(function() { if (action) action(); });
    return btn;
  }

  const items = [];

  if (isIsland) {
    items.push(_mBtn(icon('chevronLeft', {size: 16, strokeWidth: '1.5'}), 'Back', function() { browseBack(); _closeMenu(); }, { disabled: !hasTab }));
    items.push(_mBtn(icon('chevronRight', {size: 16, strokeWidth: '1.5'}), 'Forward', function() { browseForward(); _closeMenu(); }, { disabled: !hasTab }));
    items.push(_mBtn(icon('reloadFilled', {size: 16}), 'Reload', function() { browseReload(); _closeMenu(); }, { disabled: !hasTab }));
    const isSaved = hasTab && isPostSaved(tab.url);
    items.push(_mBtn(icon('bookmark', {size: 16, fill: isSaved ? 'var(--nr-accent)' : 'none', stroke: isSaved ? 'var(--nr-accent)' : 'currentColor'}), isSaved ? 'Saved' : 'Save to Reading List', function() { browseSaveToReadingList(); _refreshOverflowBookmark(this); }));
    items.push(_mBtn(icon('share', {size: 16, strokeWidth: '1.5'}), 'Share', function() { browseShare(); _closeMenu(); }, { disabled: !hasTab }));
    const _adOn = Settings.get('adBlockEnabled') === 'true';
    items.push(_mBtn(icon('shield', {size: 16, strokeWidth: '1.5'}), 'Ad Blocker', function() { toggleAdBlock(); _closeMenu(); }, { color: _adOn ? 'var(--nr-accent)' : undefined, trailing: window.Text(_adOn ? 'On' : 'Off').styles({marginLeft:'auto'}).font('caption2').foreground('quaternary') }));
    const _annEnabled = tab && _annotationsEnabled.get(tab.id);
    items.push(_mBtn(icon('annotate', {size: 16}), _annEnabled ? 'Remove Annotations' : 'Annotate Page', function() { toggleAnnotations(); _closeMenu(); }, { disabled: !hasTab, color: _annEnabled ? 'var(--nr-accent)' : undefined }));
    items.push(_mBtn(icon('clock', {size: 16}), 'Search History', function() { openSearchHistoryPage(); _closeMenu(); }));
    items.push(_mBtn(icon('sidebarToggle', {size: 16}), 'Toggle Sidebar', function() { toggleBrowseSidebar(); _closeMenu(); }));
  } else {
    const overflowIds = typeof getBarOverflowIds === 'function' ? getBarOverflowIds() : [];
    overflowIds.forEach(function(id) {
      const el = document.getElementById(id);
      if (!el) return;
      const label = el.title || id;
      const svgEl = el.querySelector('svg');
      let icon = svgEl ? svgEl.outerHTML.replace(/w-5 h-5/g, 'w-4 h-4') : '';

      if (id === 'browse-save-btn') {
        const isSav = tab && !tab.blank && tab.url && isPostSaved(tab.url);
        icon = window.icon('bookmark', {size: 16, fill: isSav ? 'var(--nr-accent)' : 'none', stroke: isSav ? 'var(--nr-accent)' : 'currentColor'});
        items.push(_mBtn(icon, isSav ? 'Saved' : 'Save to Reading List', function() { browseSaveToReadingList(); _refreshOverflowBookmark(this); }, { dataOverflowId: id }));
      } else {
        const btn = _mBtn(icon, label, function() { _closeMenu(); try { el.click(); } catch(e) {} }, { dataOverflowId: id });
        items.push(btn);
      }
    });
  }

  // Fixed items: divider, permissions, print, layout toggle, settings
  items.push(new window.View('div').styles({borderTop:'1px solid var(--aether-border)'}).margin('2px', '0'));

  // Permissions
  const permsBtn = _mBtn(icon('lock', {size: 16, strokeWidth: '1.5'}), 'Site Permissions', function(e) { _togglePermissionsInMenu(e || window.event); }, { disabled: !hasTab });
  // Append arrow icon
  const arrowEl = document.createElement('span');
  arrowEl.innerHTML = icon('chevronRightSmall', {size: 12, style: 'margin-left:auto;color:var(--aether-text-dimmest);transition:transform .15s;'});
  arrowEl.firstChild.id = 'browse-menu-perms-arrow';
  permsBtn.el.appendChild(arrowEl);
  items.push(permsBtn);

  // Permissions panel placeholder
  const permsPanel = new window.View('div').id('browse-menu-perms-panel').styles({display:'none', borderTop:'1px solid var(--aether-border)'});
  items.push(permsPanel);

  // Print
  items.push(_mBtn(icon('print', {size: 16, strokeWidth: '1.5'}), 'Print page', function() { browsePrintPage(); _closeMenu(); }, { disabled: !hasTab }));

  // AI View — show DOM text as the AI would see it
  items.push(_mBtn(icon('eye', {size: 16, strokeWidth: '1.5'}), 'AI View', function() { browseShowAIView(); _closeMenu(); }, { disabled: !hasTab }));

  // Tab layout toggle
  items.push(_mBtn(Settings.get('browseTabLayout') === 'island'
    ? icon('horizontalTabs', {size: 16})
    : icon('islandTabs', {size: 16}),
    Settings.get('browseTabLayout') === 'island' ? 'Horizontal Tabs' : 'Island Mode', function() { toggleBrowseTabLayout(); _closeMenu(); }));

  // Settings
  items.push(_mBtn(icon('settings', {size: 16, strokeWidth: '1.5'}), 'Settings', function() { location.hash = '#settings'; _closeMenu(); }));

  // Position and mount
  const anchorBtn = (isIsland
    ? (document.getElementById('pill-browse-more') || document.getElementById('pill-browse-hamburger'))
    : document.getElementById('browse-more-btn')) || document.getElementById('browse-more-btn');
  const btnRect = anchorBtn.getBoundingClientRect();

  const menuPanel = window.VStack(items)
    .position('fixed')
    .styles({ minWidth: '180px', background: 'var(--aether-dropdown-bg)', border: '1px solid var(--aether-border)', boxShadow: '0 8px 32px var(--aether-shadow)' })
    .cornerRadius('lg')
    .zIndex('overlay')
    .padding('4px', '0');

  if (isIsland) {
    menuPanel.styles({right: Math.round(window.innerWidth - btnRect.right) + 'px'});
  } else {
    menuPanel.styles({left: Math.round(btnRect.left) + 'px'});
  }
  menuPanel.styles({top: Math.round(btnRect.bottom + 4) + 'px'});

  AetherUI.mount(menuPanel, dd);
  dd.style.display = '';
  document.body.classList.add('island-dropdown-guard');

  // Set up long-press drag on overflow items to drag back to bar
  _setupOverflowDrag(dd);

  setTimeout(function() {
    const handler = function(e) {
      if (!dd.contains(e.target) && !e.target.closest('[onclick*="toggleBrowseMoreMenu"]') && !e.target.closest('#pill-browse-more')) {
        dd.style.display = 'none';
        document.body.classList.remove('island-dropdown-guard');
        document.removeEventListener('mousedown', handler, true);
      }
    };
    document.addEventListener('mousedown', handler, true);
  }, 0);
}

export function _togglePermissionsInMenu(e) {
  e.stopPropagation();
  const panel = document.getElementById('browse-menu-perms-panel');
  const arrow = document.getElementById('browse-menu-perms-arrow');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  if (arrow) arrow.style.transform = open ? '' : 'rotate(90deg)';
  if (!open) _renderSitePermissionsDropdown(panel);
}

// Refresh bookmark button appearance in the overflow menu after toggling
export function _refreshOverflowBookmark(btn) {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const isSaved = tab && !tab.blank && tab.url && isPostSaved(tab.url);
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.setAttribute('fill', isSaved ? 'var(--nr-accent)' : 'none');
    svg.setAttribute('stroke', isSaved ? 'var(--nr-accent)' : 'currentColor');
  }
  // Update the label text
  const textNode = Array.from(btn.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
  if (textNode) textNode.textContent = ' ' + (isSaved ? 'Saved' : 'Save to Reading List');
}

// Long-press on overflow menu items to drag them back to the browse bar
export function _setupOverflowDrag(dd) {
  let holdTimer = null;
  let dragGhost = null;
  let dragId = null;
  let dragBtn = null;

  function onPointerDown(e) {
    const btn = e.target.closest('[data-overflow-id]');
    if (!btn) return;
    const id = btn.dataset.overflowId;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      dragId = id;
      dragBtn = btn;
      // Prevent the click from firing
      btn.style.opacity = '0.4';
      // Create floating ghost
      dragGhost = btn.cloneNode(true);
      dragGhost.style.cssText = 'position:fixed;z-index:100000;pointer-events:none;padding:6px 12px;background:var(--nr-bg-overlay);border:1px solid var(--nr-border-default);border-radius:8px;box-shadow:0 4px 16px var(--nr-shadow-popup);font-size:0.78rem;display:flex;align-items:center;gap:8px;opacity:0.9;color:var(--nr-text-primary);white-space:nowrap;';
      dragGhost.style.left = (e.clientX - 40) + 'px';
      dragGhost.style.top = (e.clientY - 14) + 'px';
      document.body.appendChild(dragGhost);
      // Suppress click after drag
      btn.addEventListener('click', suppressClick, { capture: true, once: true });
    }, 400);
  }

  function suppressClick(e) { e.stopPropagation(); e.preventDefault(); }

  function onPointerMove(e) {
    if (holdTimer && (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3)) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (!dragGhost) return;
    dragGhost.style.left = (e.clientX - 40) + 'px';
    dragGhost.style.top = (e.clientY - 14) + 'px';
    // Highlight browse bar when hovering over it
    const bar = document.getElementById('browse-bar');
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        bar.style.outline = '2px solid var(--nr-accent)';
        bar.style.outlineOffset = '-2px';
      } else {
        bar.style.outline = '';
        bar.style.outlineOffset = '';
      }
    }
  }

  function onPointerUp(e) {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; return; }
    if (!dragGhost || !dragId) return;
    const bar = document.getElementById('browse-bar');
    let dropped = false;
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        dropped = true;
      }
      bar.style.outline = '';
      bar.style.outlineOffset = '';
    }
    dragGhost.remove();
    dragGhost = null;
    if (dragBtn) dragBtn.style.opacity = '';
    if (dropped) {
      removeFromBarOverflow(dragId);
      // Close the menu
      dd.style.display = 'none';
    }
    dragId = null;
    dragBtn = null;
  }

  dd.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  // Clean up when menu hides
  const obs = new MutationObserver(() => {
    if (dd.style.display === 'none') {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (dragGhost) { dragGhost.remove(); dragGhost = null; }
      obs.disconnect();
    }
  });
  obs.observe(dd, { attributes: true, attributeFilter: ['style'] });
}

export function browsePrintPage() {
  // Close the menu
  const dd = document.getElementById('browse-more-menu');
  if (dd) dd.style.display = 'none';

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);

  const el = _browseActiveEl();
  if (!el) return;

  if (window._browseIsElectron && el.printToPDF) {
    const title = 'Print — ' + ((tab && tab.title) || 'Page');
    el.printToPDF({ printBackground: true }).then(buf => {
      const blob = new Blob([buf], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      browseNewTab(blobUrl);
    }).catch(() => { el.print(); });
  } else {
    try { el.contentWindow.print(); } catch (e) {
      // Cross-origin iframe — open in new tab so user can print from there
      if (tab && tab.url) window.open(tab.url, '_blank');
    }
  }
}

export function browseShowAIView() {
  const tab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
    ? _browseTabs.find(function(t) { return t.id === _browseActiveTab; }) : null;
  if (!tab || !tab.el) return;

  // Use the same agentGetAccessibleDOM the agent uses
  agentGetAccessibleDOM(tab).then(function(dom) {
    if (!dom || dom.error) return;
    const text = dom.elements || '(empty page)';
    const elCount = dom.elementCount || 0;
    const tokens = Math.round(text.length / 4);
    const tokenLabel = tokens >= 1000 ? Math.round(tokens / 1000) + 'k' : String(tokens);

    // Remove existing overlay
    const existing = document.getElementById('ai-view-overlay');
    if (existing) existing.remove();

    const overlayView = new window.View('div').id('ai-view-overlay');
    overlayView.cssText('position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;background:var(--nr-bg-primary, #111);padding-top:48px;');

    // Header bar
    const titleEl = new window.View('span');
    titleEl.cssText('font-size:0.85rem;font-weight:600;color:var(--nr-text-primary, #fff);');
    titleEl.el.textContent = 'AI View';

    const badgeEl = new window.View('span');
    badgeEl.cssText('font-size:0.7rem;color:var(--nr-text-secondary, #888);margin-left:8px;font-variant-numeric:tabular-nums;');
    badgeEl.el.textContent = elCount + ' elements \u00b7 ' + tokenLabel + ' tokens \u00b7 ' + text.length.toLocaleString() + ' chars';

    const urlBadgeEl = new window.View('span');
    urlBadgeEl.cssText('font-size:0.65rem;color:var(--nr-text-secondary, #666);margin-left:8px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
    urlBadgeEl.el.textContent = dom.title ? dom.title + ' \u2014 ' + dom.url : dom.url;

    const closeBtnEl = new window.View('button');
    closeBtnEl.cssText('background:none;border:none;color:var(--nr-text-secondary, #888);cursor:pointer;font-size:1.2rem;padding:4px 8px;');
    closeBtnEl.el.textContent = '\u00d7';
    closeBtnEl.onTap(function() { overlayView.el.remove(); });

    const leftGroup = new window.View('div');
    leftGroup.cssText('display:flex;align-items:center;');
    leftGroup.el.appendChild(titleEl.el);
    leftGroup.el.appendChild(badgeEl.el);
    leftGroup.el.appendChild(urlBadgeEl.el);

    const headerEl = new window.View('div');
    headerEl.cssText('display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--nr-border-default, #333);flex-shrink:0;');
    headerEl.el.appendChild(leftGroup.el);
    headerEl.el.appendChild(closeBtnEl.el);

    // Content — syntax highlight element IDs and tags
    const contentEl = new window.View('pre');
    contentEl.cssText('flex:1;overflow:auto;padding:16px;margin:0;font-size:0.75rem;line-height:1.6;color:var(--nr-text-primary, #ddd);white-space:pre;font-family:var(--nr-font-mono, monospace);');

    // Wrap in the same delimiters the agent receives
    const fullText = '--- BROWSER TAB DOM (' + (dom.title || '') + ') [' + (dom.url || '') + '] ---\n' + text + '\n--- END DOM ---';

    // Highlight the DOM tree: IDs in cyan, tags in green, attrs in yellow, bbox in dim
    const highlighted = fullText.replace(/^(--- .+ ---)$/gm, '<span style="color:var(--nr-text-secondary,#888)">$1</span>')
      .replace(/^(VIEWPORT:.*)$/m, '<span style="color:var(--nr-text-secondary,#888)">$1</span>')
      .replace(/\[(\d+)\]/g, '<span style="color:#67d4f1">[$1]</span>')
      .replace(/<(\w+)/g, '<span style="color:#8bdb8b">&lt;$1</span>')
      .replace(/>/g, '<span style="color:#8bdb8b">&gt;</span>')
      .replace(/((?:aria-\w+|role|type|name|placeholder|href|value|title|disabled|checked)(?:="[^"]*")?)/g, '<span style="color:#e8c87a">$1</span>')
      .replace(/(@-?\d+,-?\d+,\d+,\d+)/g, '<span style="color:var(--nr-text-secondary,#555)">$1</span>');
    contentEl.el.innerHTML = highlighted;

    overlayView.el.appendChild(headerEl.el);
    overlayView.el.appendChild(contentEl.el);
    document.body.appendChild(overlayView.el);

    // Esc to close
    function onKey(e) { if (e.key === 'Escape') { overlayView.el.remove(); document.removeEventListener('keydown', onKey); } }
    document.addEventListener('keydown', onKey);
  }).catch(function(e) { logger.warn('[AI View] Failed:', e); });
}

// ── Action registry ──
registerActions({
  toggleBrowseMoreMenu: () => toggleBrowseMoreMenu(),
});

