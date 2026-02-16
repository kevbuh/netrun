// browse-menu.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
if (window.AetherUI) AetherUI.globals();

// ── Browse More Menu (three dots) ──

function toggleBrowseMoreMenu() {
  const dd = document.getElementById('browse-more-menu');
  if (!dd) return;
  if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const hasTab = tab && !tab.blank && tab.url;
  const isIsland = _browseTabLayout === 'island';

  var _closeMenu = function() { dd.style.display = 'none'; };

  // Helper for menu buttons
  function _mBtn(svgHtml, label, action, opts) {
    opts = opts || {};
    var btn = new View('button');
    var row = HStack([RawHTML(svgHtml), Text(label).style('flex', '1')]).spacing(2).alignment('center');
    if (opts.trailing) row.el.appendChild(opts.trailing.build());
    btn.el.appendChild(row.build());
    btn.el.style.cssText = 'width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:' + (opts.disabled ? 'var(--aether-text-dimmest)' : (opts.color || 'var(--aether-text)')) + ';font-size:0.78rem;cursor:' + (opts.disabled ? 'default' : 'pointer') + ';display:flex;align-items:center;gap:8px;';
    if (opts.disabled) btn.el.disabled = true;
    if (opts.dataOverflowId) btn.el.setAttribute('data-overflow-id', opts.dataOverflowId);
    btn.onHover(function() { btn.el.style.background = 'var(--aether-hover)'; }, function() { btn.el.style.background = 'none'; });
    btn.onTap(function() { if (action) action(); });
    return btn;
  }

  var items = [];

  if (isIsland) {
    items.push(_mBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>', 'Back', function() { browseBack(); _closeMenu(); }, { disabled: !hasTab }));
    items.push(_mBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>', 'Forward', function() { browseForward(); _closeMenu(); }, { disabled: !hasTab }));
    items.push(_mBtn('<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>', 'Reload', function() { browseReload(); _closeMenu(); }, { disabled: !hasTab }));
    var isSaved = hasTab && isPostSaved(tab.url);
    items.push(_mBtn('<svg class="w-4 h-4" viewBox="0 0 24 24" fill="' + (isSaved ? 'var(--nr-accent)' : 'none') + '" stroke="' + (isSaved ? 'var(--nr-accent)' : 'currentColor') + '" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>', isSaved ? 'Saved' : 'Save to Reading List', function() { browseSaveToReadingList(); _refreshOverflowBookmark(this); }));
    items.push(_mBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15"/></svg>', 'Share', function() { browseShare(); _closeMenu(); }, { disabled: !hasTab }));
    var _adOn = localStorage.getItem('adBlockEnabled') === 'true';
    items.push(_mBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"/></svg>', 'Ad Blocker', function() { toggleAdBlock(); _closeMenu(); }, { color: _adOn ? 'var(--nr-accent)' : undefined, trailing: Text(_adOn ? 'On' : 'Off').style('marginLeft', 'auto').style('fontSize', '0.7rem').style('color', 'var(--aether-text-dimmest)') }));
    var _annEnabled = tab && _annotationsEnabled.get(tab.id);
    items.push(_mBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 9h8M8 13h6" stroke-linecap="round"/></svg>', _annEnabled ? 'Remove Annotations' : 'Annotate Page', function() { toggleAnnotations(); _closeMenu(); }, { disabled: !hasTab, color: _annEnabled ? 'var(--nr-accent)' : undefined }));
    items.push(_mBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>', 'Search History', function() { openSearchHistoryPage(); _closeMenu(); }));
    items.push(_mBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3V3z" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 3v18" stroke-linecap="round" stroke-linejoin="round"/></svg>', 'Toggle Sidebar', function() { toggleBrowseSidebar(); _closeMenu(); }));
  } else {
    var overflowIds = typeof getBarOverflowIds === 'function' ? getBarOverflowIds() : [];
    overflowIds.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var label = el.title || id;
      var svgEl = el.querySelector('svg');
      var icon = svgEl ? svgEl.outerHTML.replace(/w-5 h-5/g, 'w-4 h-4') : '';

      if (id === 'browse-save-btn') {
        var isSav = tab && !tab.blank && tab.url && isPostSaved(tab.url);
        icon = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="' + (isSav ? 'var(--nr-accent)' : 'none') + '" stroke="' + (isSav ? 'var(--nr-accent)' : 'currentColor') + '" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
        items.push(_mBtn(icon, isSav ? 'Saved' : 'Save to Reading List', function() { browseSaveToReadingList(); _refreshOverflowBookmark(this); }, { dataOverflowId: id }));
      } else {
        var onclick = el.getAttribute('onclick') || '';
        var btn = _mBtn(icon, label, function() { _closeMenu(); try { new Function(onclick)(); } catch(e) {} }, { dataOverflowId: id });
        items.push(btn);
      }
    });
  }

  // Fixed items: divider, permissions, print, layout toggle, settings
  items.push(new View('div').style('borderTop', '1px solid var(--aether-border)').style('margin', '2px 0'));

  // Permissions
  var permsBtn = _mBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"/></svg>', 'Site Permissions', function(e) { _togglePermissionsInMenu(e || window.event); }, { disabled: !hasTab });
  // Append arrow icon
  var arrowEl = document.createElement('span');
  arrowEl.innerHTML = '<svg id="browse-menu-perms-arrow" class="w-3 h-3" style="margin-left:auto;color:var(--aether-text-dimmest);transition:transform .15s;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m9 5 7 7-7 7"/></svg>';
  permsBtn.el.appendChild(arrowEl);
  items.push(permsBtn);

  // Permissions panel placeholder
  var permsPanel = new View('div').id('browse-menu-perms-panel').style('display', 'none').style('borderTop', '1px solid var(--aether-border)');
  items.push(permsPanel);

  // Print
  items.push(_mBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m0 0a48.159 48.159 0 0 1 10.5 0m-10.5 0V6.007c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 10.186 0c1.1.128 1.907 1.077 1.907 2.185V7.034"/></svg>', 'Print page', function() { browsePrintPage(); _closeMenu(); }, { disabled: !hasTab }));

  // Tab layout toggle
  items.push(_mBtn(_browseTabLayout === 'island'
    ? '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 3h16v5H4V3zM4 3h16v18H4V3z"/></svg>'
    : '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3v18M4 3h16v18H4V3z"/></svg>',
    _browseTabLayout === 'island' ? 'Horizontal Tabs' : 'Island Mode', function() { toggleBrowseTabLayout(); _closeMenu(); }));

  // Settings
  items.push(_mBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>', 'Settings', function() { location.hash = '#settings'; _closeMenu(); }));

  // Position and mount
  var anchorBtn = (isIsland
    ? (document.getElementById('pill-browse-more') || document.getElementById('pill-browse-hamburger'))
    : document.getElementById('browse-more-btn')) || document.getElementById('browse-more-btn');
  var btnRect = anchorBtn.getBoundingClientRect();

  var menuPanel = VStack(items)
    .style('position', 'fixed')
    .style('minWidth', '180px')
    .style('background', 'var(--aether-dropdown-bg)')
    .style('border', '1px solid var(--aether-border)')
    .cornerRadius('lg')
    .style('boxShadow', '0 8px 32px var(--aether-shadow)')
    .zIndex('overlay')
    .style('padding', '4px 0');

  if (isIsland) {
    menuPanel.style('right', Math.round(window.innerWidth - btnRect.right) + 'px');
  } else {
    menuPanel.style('left', Math.round(btnRect.left) + 'px');
  }
  menuPanel.style('top', Math.round(btnRect.bottom + 4) + 'px');

  AetherUI.mount(menuPanel, dd);
  dd.style.display = '';

  // Set up long-press drag on overflow items to drag back to bar
  _setupOverflowDrag(dd);

  setTimeout(function() {
    var handler = function(e) {
      if (!dd.contains(e.target) && !e.target.closest('[onclick*="toggleBrowseMoreMenu"]') && !e.target.closest('#pill-browse-more')) {
        dd.style.display = 'none';
        document.removeEventListener('mousedown', handler, true);
      }
    };
    document.addEventListener('mousedown', handler, true);
  }, 0);
}

function _togglePermissionsInMenu(e) {
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
function _refreshOverflowBookmark(btn) {
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
function _setupOverflowDrag(dd) {
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

function browsePrintPage() {
  // Close the menu
  const dd = document.getElementById('browse-more-menu');
  if (dd) dd.style.display = 'none';

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);

  const el = _browseActiveEl();
  if (!el) return;

  if (_browseIsElectron && el.printToPDF) {
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
