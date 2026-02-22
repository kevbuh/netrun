// toolbar-menu.js — Hamburger menu, more menu, privacy, PDF convert
// Replaces browse-menu.js + browse-pill.js menu portions
import Settings from '/js/core/core-settings.js';
import { icon } from '/js/core/icons.js';
import { moreMenuOpen } from '/js/toolbar/toolbar-state.js';

// ── Browse More Menu (three dots) ──

export function toggleBrowseMoreMenu() {
  var dd = document.getElementById('browse-more-menu');
  // If #browse-more-menu is inside a hidden parent (e.g. browse-view not active),
  // use a fallback container on body
  if (!dd || (dd.offsetParent === null && dd.parentElement && dd.parentElement.style.display === 'none')) {
    dd = document.getElementById('pill-more-menu-dropdown');
    if (!dd) {
      dd = document.createElement('div');
      dd.id = 'pill-more-menu-dropdown';
      Object.assign(dd.style, { display: 'none', position: 'fixed', zIndex: '10000' });
      document.body.appendChild(dd);
    }
  }
  if (dd.style.display !== 'none') { dd.style.display = 'none'; document.body.classList.remove('island-dropdown-guard'); return; }

  var tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  var hasTab = tab && !tab.blank && tab.url;
  var isIsland = Settings.get('browseTabLayout') === 'island';

  var _closeMenu = function() { dd.style.display = 'none'; document.body.classList.remove('island-dropdown-guard'); };

  function _mBtn(svgHtml, label, action, opts) {
    opts = opts || {};
    var btn = new window.View('button');
    var row = window.HStack([window.RawHTML(svgHtml), window.Text(label).flex(1)]).spacing(2).alignment('center');
    if (opts.trailing) row.add(opts.trailing);
    btn.add(row);
    btn.padding('6px', '12px')
      .foreground(opts.disabled ? 'quaternary' : 'primary')
      .styles({ width: '100%', textAlign: 'left', border: 'none', background: 'none', fontSize: '0.78rem', cursor: opts.disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' });
    if (opts.color && !opts.disabled) btn.styles({ color: opts.color });
    if (opts.disabled) btn.el.disabled = true;
    if (opts.dataOverflowId) btn.el.setAttribute('data-overflow-id', opts.dataOverflowId);
    btn.onHover(function() { btn.el.style.background = 'var(--nr-bg-hover)'; }, function() { btn.el.style.background = 'none'; });
    btn.onTap(function() { if (action) action(); });
    return btn;
  }

  var items = [];

  if (isIsland) {
    items.push(_mBtn(icon('chevronLeft', {size: 16, strokeWidth: '1.5'}), 'Back', function() { if (typeof window.browseBack === 'function') window.browseBack(); _closeMenu(); }, { disabled: !hasTab }));
    items.push(_mBtn(icon('chevronRight', {size: 16, strokeWidth: '1.5'}), 'Forward', function() { if (typeof window.browseForward === 'function') window.browseForward(); _closeMenu(); }, { disabled: !hasTab }));
    items.push(_mBtn(icon('reloadFilled', {size: 16}), 'Reload', function() { if (typeof window.browseReload === 'function') window.browseReload(); _closeMenu(); }, { disabled: !hasTab }));
    var isSaved = hasTab && typeof window.isPostSaved === 'function' && window.isPostSaved(tab.url);
    items.push(_mBtn(icon('bookmark', {size: 16, fill: isSaved ? 'var(--nr-accent)' : 'none', stroke: isSaved ? 'var(--nr-accent)' : 'currentColor'}), isSaved ? 'Saved' : 'Save to Reading List', function() { if (typeof window.browseSaveToReadingList === 'function') window.browseSaveToReadingList(); _refreshOverflowBookmark(this); }));
    items.push(_mBtn(icon('share', {size: 16, strokeWidth: '1.5'}), 'Share', function() { if (typeof window.browseShare === 'function') window.browseShare(); _closeMenu(); }, { disabled: !hasTab }));

    // Privacy Section
    items.push(new window.View('div').styles({borderTop:'1px solid var(--nr-border-default, var(--aether-border))'}).margin('2px', '0'));

    var _privFeatures = [
      { key: 'adBlockEnabled',          label: 'Ad Blocker',       ic: 'shield',  fn: function() { if (typeof window.toggleAdBlock === 'function') window.toggleAdBlock(); toggleBrowseMoreMenu(); toggleBrowseMoreMenu(); }, checkOn: function(v) { return v === 'true'; } },
      { key: 'dohEnabled',              label: 'Encrypted DNS',    ic: 'lock',    fn: function() { if (typeof window.toggleDoH === 'function') window.toggleDoH(); toggleBrowseMoreMenu(); toggleBrowseMoreMenu(); }, checkOn: function(v) { return v !== 'false'; } },
      { key: 'httpsOnlyEnabled',        label: 'HTTPS Only',       ic: 'globe',   fn: function() { if (typeof window.toggleHttpsOnly === 'function') window.toggleHttpsOnly(); toggleBrowseMoreMenu(); toggleBrowseMoreMenu(); }, checkOn: function(v) { return v !== 'false'; } },
      { key: 'trackingStripEnabled',    label: 'Tracking Strip',   ic: 'eye',     fn: function() { if (typeof window.toggleTrackingStrip === 'function') window.toggleTrackingStrip(); toggleBrowseMoreMenu(); toggleBrowseMoreMenu(); }, checkOn: function(v) { return v !== 'false'; } },
      { key: 'thirdPartyCookiesBlocked',label: 'Cookie Blocking',  ic: 'close',   fn: function() { if (typeof window.toggleCookieBlock === 'function') window.toggleCookieBlock(); toggleBrowseMoreMenu(); toggleBrowseMoreMenu(); }, checkOn: function(v) { return v !== 'false'; } },
    ];
    var _privActive = _privFeatures.filter(function(f) { return f.checkOn(Settings.get(f.key)); }).length;
    items.push(new window.View('div').add(
      window.HStack([
        window.Text('PRIVACY').font('caption2').foreground('quaternary').styles({letterSpacing:'0.05em'}),
        window.Text(_privActive + '/' + _privFeatures.length + ' active').font('caption2').foreground('quaternary').styles({marginLeft:'auto'})
      ])
    ).styles({padding:'4px 12px 2px'}));

    for (var pi = 0; pi < _privFeatures.length; pi++) {
      (function(pf) {
        var on = pf.checkOn(Settings.get(pf.key));
        items.push(_mBtn(icon(pf.ic, {size: 16, strokeWidth: '1.5'}), pf.label, pf.fn, { color: on ? 'var(--nr-accent)' : undefined, trailing: window.Text(on ? 'On' : 'Off').styles({marginLeft:'auto'}).font('caption2').foreground('quaternary') }));
      })(_privFeatures[pi]);
    }

    // Privacy stats
    var _privStatsDiv = new window.View('div').styles({
      padding:'6px 12px', margin:'2px 8px', borderRadius:'6px',
      background:'color-mix(in srgb, var(--nr-accent) 8%, transparent)',
      minHeight:'22px'
    });
    items.push(_privStatsDiv);
    if (window.electronAPI && tab && tab.el && typeof tab.el.getWebContentsId === 'function') {
      try {
        var _wc = tab.el.getWebContentsId();
        var detailsP = window.electronAPI.privacyDetails ? window.electronAPI.privacyDetails(_wc) : Promise.resolve({});
        Promise.all([
          window.electronAPI.adblockGetCount(_wc),
          window.electronAPI.trackingStripGetCount ? window.electronAPI.trackingStripGetCount(_wc) : Promise.resolve(0),
          window.electronAPI.httpsOnlyGetCount ? window.electronAPI.httpsOnlyGetCount(_wc) : Promise.resolve(0),
          window.electronAPI.cookieBlockGetCount ? window.electronAPI.cookieBlockGetCount(_wc) : Promise.resolve(0),
          detailsP,
        ]).then(function(c) {
          var details = c[4] || {};
          var rows = [];
          var parts = [];
          if (c[0] > 0) parts.push(c[0] + ' ad' + (c[0] !== 1 ? 's' : '') + ' blocked');
          if (c[1] > 0) parts.push(c[1] + ' tracker' + (c[1] !== 1 ? 's' : '') + ' stripped');
          if (c[2] > 0) parts.push(c[2] + ' HTTPS upgrade' + (c[2] !== 1 ? 's' : ''));
          if (c[3] > 0) parts.push(c[3] + ' cookie' + (c[3] !== 1 ? 's' : '') + ' blocked');
          var summaryText = parts.length > 0 ? parts.join(' \u00b7 ') : 'No threats detected on this page';
          rows.push(window.Text(summaryText).font('caption2').styles({color:'var(--nr-accent)', fontWeight:'500', lineHeight: '1.4'}));

          function _domainRows(map, label) {
            var entries = Object.entries(map || {}).sort(function(a, b) { return b[1] - a[1]; });
            if (!entries.length) return;
            rows.push(window.Text(label).font('caption2').foreground('quaternary').styles({marginTop:'4px', fontWeight:'600', textTransform:'uppercase', letterSpacing:'0.04em'}));
            var shown = entries.slice(0, 5);
            for (var i = 0; i < shown.length; i++) {
              rows.push(window.HStack([
                window.Text(shown[i][0]).font('caption2').foreground('secondary').flex(1).truncate(),
                window.Text(String(shown[i][1])).font('caption2').foreground('quaternary')
              ]).spacing(2));
            }
            if (entries.length > 5) {
              rows.push(window.Text('+ ' + (entries.length - 5) + ' more').font('caption2').foreground('quaternary'));
            }
          }

          _domainRows(details.ads, 'Blocked domains');
          _domainRows(details.trackers, 'Stripped params');
          _domainRows(details.cookies, 'Cookies blocked from');

          AetherUI.mount(window.VStack(rows).spacing(1), _privStatsDiv.el);
        }).catch(function() {});
      } catch(e) {}
    }

    items.push(new window.View('div').styles({borderTop:'1px solid var(--nr-border-default, var(--aether-border))'}).margin('2px', '0'));

    var _cssOff = Settings.get('autoRemoveCSS') === 'true';
    items.push(_mBtn(icon('code', {size: 16, strokeWidth: '1.5'}), 'Auto Remove CSS', function() { if (typeof window.toggleAutoRemoveCSS === 'function') window.toggleAutoRemoveCSS(); _closeMenu(); }, { disabled: !hasTab, color: _cssOff ? 'var(--nr-accent)' : undefined, trailing: window.Text(_cssOff ? 'On' : 'Off').styles({marginLeft:'auto'}).font('caption2').foreground('quaternary') }));
    var _annEnabled = tab && typeof window._annotationsEnabled !== 'undefined' && window._annotationsEnabled.get(tab.id);
    items.push(_mBtn(icon('annotate', {size: 16}), _annEnabled ? 'Remove Annotations' : 'Annotate Page', function() { if (typeof window.toggleAnnotations === 'function') window.toggleAnnotations(); _closeMenu(); }, { disabled: !hasTab, color: _annEnabled ? 'var(--nr-accent)' : undefined }));
    var _nerdOn = tab && typeof window._nerdModeEnabled !== 'undefined' && window._nerdModeEnabled.get(tab.id);
    var isPdfForNerd = hasTab && (tab.pdfUrl || tab.localPath || (tab.url && tab.url.toLowerCase().endsWith('.pdf')) || (tab.url && tab.url.includes('/pdf/') && tab.url.includes('arxiv.org')));
    items.push(_mBtn(icon('research', {size: 16}), 'Nerd Mode', function() { if (typeof window.toggleNerdMode === 'function') window.toggleNerdMode(tab); _closeMenu(); }, { disabled: !isPdfForNerd, color: _nerdOn ? 'var(--nr-accent)' : undefined, trailing: _nerdOn ? window.Text('On').styles({marginLeft:'auto'}).font('caption2').foreground('quaternary') : undefined }));
    items.push(_mBtn(icon('clock', {size: 16}), 'Search History', function() { if (typeof window.openSearchHistoryPage === 'function') window.openSearchHistoryPage(); _closeMenu(); }));
    items.push(_mBtn(icon('sidebarToggle', {size: 16}), 'Toggle Sidebar', function() { if (typeof window.toggleBrowseSidebar === 'function') window.toggleBrowseSidebar(); _closeMenu(); }));
  } else {
    var overflowIds = typeof window.getBarOverflowIds === 'function' ? window.getBarOverflowIds() : [];
    overflowIds.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var label = el.title || id;
      var svgEl = el.querySelector('svg');
      var iconHtml = svgEl ? svgEl.outerHTML.replace(/w-5 h-5/g, 'w-4 h-4') : '';

      if (id === 'browse-save-btn') {
        var isSav = tab && !tab.blank && tab.url && typeof window.isPostSaved === 'function' && window.isPostSaved(tab.url);
        iconHtml = window.icon('bookmark', {size: 16, fill: isSav ? 'var(--nr-accent)' : 'none', stroke: isSav ? 'var(--nr-accent)' : 'currentColor'});
        items.push(_mBtn(iconHtml, isSav ? 'Saved' : 'Save to Reading List', function() { if (typeof window.browseSaveToReadingList === 'function') window.browseSaveToReadingList(); _refreshOverflowBookmark(this); }, { dataOverflowId: id }));
      } else {
        var btn = _mBtn(iconHtml, label, function() { _closeMenu(); try { el.click(); } catch(e) {} }, { dataOverflowId: id });
        items.push(btn);
      }
    });
  }

  // Fixed items
  items.push(new window.View('div').styles({borderTop:'1px solid var(--nr-border-default, var(--aether-border))'}).margin('2px', '0'));

  // Permissions
  var permsBtn = _mBtn(icon('lock', {size: 16, strokeWidth: '1.5'}), 'Site Permissions', function(e) { _togglePermissionsInMenu(e || window.event); }, { disabled: !hasTab });
  var arrowEl = document.createElement('span');
  arrowEl.innerHTML = icon('chevronRightSmall', {size: 12, style: 'margin-left:auto;color:var(--nr-text-quaternary, var(--aether-text-dimmest));transition:transform .15s;'});
  arrowEl.firstChild.id = 'browse-menu-perms-arrow';
  permsBtn.el.appendChild(arrowEl);
  items.push(permsBtn);

  var permsPanel = new window.View('div').id('browse-menu-perms-panel').styles({display:'none', borderTop:'1px solid var(--aether-border)'});
  items.push(permsPanel);

  // Print
  items.push(_mBtn(icon('print', {size: 16, strokeWidth: '1.5'}), 'Print page', function() { browsePrintPage(); _closeMenu(); }, { disabled: !hasTab }));

  // Convert submenu (PDF only)
  var isPdf = hasTab && (tab.pdfUrl || tab.localPath || (tab.url && tab.url.toLowerCase().endsWith('.pdf')) || (tab.url && tab.url.includes('/pdf/') && tab.url.includes('arxiv.org')));
  if (isPdf) {
    var convertBtn = _mBtn(icon('convert', {size: 16, strokeWidth: '1.5'}), 'Convert', function(e) { _toggleConvertInMenu(e || window.event); });
    var convertArrow = document.createElement('span');
    convertArrow.innerHTML = icon('chevronRightSmall', {size: 12, style: 'margin-left:auto;color:var(--nr-text-quaternary, var(--aether-text-dimmest));transition:transform .15s;'});
    convertArrow.firstChild.id = 'browse-menu-convert-arrow';
    convertBtn.el.appendChild(convertArrow);
    items.push(convertBtn);

    var convertPanel = new window.View('div').id('browse-menu-convert-panel').styles({display:'none', borderTop:'1px solid var(--aether-border)'});
    items.push(convertPanel);
  }

  // AI View
  items.push(_mBtn(icon('eye', {size: 16, strokeWidth: '1.5'}), 'AI View', function() { browseShowAIView(); _closeMenu(); }, { disabled: !hasTab }));

  // Tab layout toggle
  items.push(_mBtn(Settings.get('browseTabLayout') === 'island'
    ? icon('horizontalTabs', {size: 16})
    : icon('islandTabs', {size: 16}),
    Settings.get('browseTabLayout') === 'island' ? 'Horizontal Tabs' : 'Island Mode', function() { if (typeof window.toggleBrowseTabLayout === 'function') window.toggleBrowseTabLayout(); _closeMenu(); }));

  // Settings
  items.push(_mBtn(icon('settings', {size: 16, strokeWidth: '1.5'}), 'Settings', function() { location.hash = '#settings'; _closeMenu(); }));

  // Position and mount
  var anchorBtn = (isIsland
    ? (document.getElementById('pill-browse-hamburger') || document.getElementById('pill-browse-more'))
    : (document.getElementById('pill-browse-more') || document.getElementById('browse-more-btn'))) || document.getElementById('browse-more-btn');
  var btnRect = anchorBtn.getBoundingClientRect();

  var menuPanel = window.VStack(items)
    .position('fixed')
    .background('overlay')
    .border('border-default')
    .shadow('popup')
    .cornerRadius('lg')
    .zIndex('overlay')
    .padding('4px', '0')
    .frame({ minWidth: 180 });

  if (isIsland) {
    menuPanel.styles({right: Math.round(window.innerWidth - btnRect.right) + 'px'});
  } else {
    menuPanel.styles({left: Math.round(btnRect.left) + 'px'});
  }
  menuPanel.styles({top: Math.round(btnRect.bottom + 4) + 'px'});

  AetherUI.mount(menuPanel, dd);
  dd.style.display = '';
  document.body.classList.add('island-dropdown-guard');

  _setupOverflowDrag(dd);

  setTimeout(function() {
    var handler = function(e) {
      if (!dd.contains(e.target) && !e.target.closest('[onclick*="toggleBrowseMoreMenu"]') && !e.target.closest('#pill-browse-more') && !e.target.closest('#pill-browse-hamburger')) {
        dd.style.display = 'none';
        document.body.classList.remove('island-dropdown-guard');
        document.removeEventListener('mousedown', handler, true);
      }
    };
    document.addEventListener('mousedown', handler, true);
  }, 0);
}

// ── Permissions submenu ──

export function _togglePermissionsInMenu(e) {
  e.stopPropagation();
  var panel = document.getElementById('browse-menu-perms-panel');
  var arrow = document.getElementById('browse-menu-perms-arrow');
  if (!panel) return;
  var open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  if (arrow) arrow.style.transform = open ? '' : 'rotate(90deg)';
  if (!open && typeof window._renderSitePermissionsDropdown === 'function') window._renderSitePermissionsDropdown(panel);
}

// ── Convert submenu ──

export function _toggleConvertInMenu(e) {
  e.stopPropagation();
  var panel = document.getElementById('browse-menu-convert-panel');
  var arrow = document.getElementById('browse-menu-convert-arrow');
  if (!panel) return;
  var open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  if (arrow) arrow.style.transform = open ? '' : 'rotate(90deg)';
  if (!open) _renderConvertPanel(panel);
}

function _renderConvertPanel(panel) {
  panel.innerHTML = '';
  var tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  if (!tab) return;

  function _cBtn(svgHtml, label, action) {
    var btn = new window.View('button');
    var row = window.HStack([window.RawHTML(svgHtml), window.Text(label).flex(1)]).spacing(2).alignment('center');
    btn.add(row);
    btn.padding('5px', '16px')
      .foreground('primary')
      .styles({ width: '100%', textAlign: 'left', border: 'none', background: 'none', fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' });
    btn.onHover(function() { btn.el.style.background = 'var(--nr-bg-hover)'; }, function() { btn.el.style.background = 'none'; });
    btn.onTap(function() { action(); });
    return btn;
  }

  var _closeAll = function() {
    var dd = document.getElementById('browse-more-menu');
    if (dd) { dd.style.display = 'none'; document.body.classList.remove('island-dropdown-guard'); }
  };

  panel.appendChild(_cBtn(icon('fileText', {size: 14, strokeWidth: '1.5'}), 'Parse PDF', function() { _closeAll(); _pdfParseAction(tab); }).el);
  panel.appendChild(_cBtn(icon('documentSearch', {size: 14, strokeWidth: '1.5'}), 'Extract PDF', function() { _closeAll(); _pdfExtractAction(tab); }).el);
  panel.appendChild(_cBtn(icon('scissors', {size: 14, strokeWidth: '1.5'}), 'Split PDF', function() { _closeAll(); _pdfSplitAction(tab); }).el);
  panel.appendChild(_cBtn(icon('fileMerge', {size: 14, strokeWidth: '1.5'}), 'Merge PDFs', function() { _closeAll(); _pdfMergeAction(tab); }).el);
  panel.appendChild(_cBtn(icon('compress', {size: 14, strokeWidth: '1.5'}), 'Compress PDF', function() { _closeAll(); _pdfCompressAction(tab); }).el);

  var div1 = new window.View('div').styles({ borderTop: '1px solid var(--nr-border-default)', margin: '2px 12px' });
  panel.appendChild(div1.el);

  panel.appendChild(_cBtn(icon('imagePlus', {size: 14, strokeWidth: '1.5'}), 'PDF to PNG', function() { _closeAll(); _pdfToPngAction(tab); }).el);
  panel.appendChild(_cBtn(icon('imagePlus', {size: 14, strokeWidth: '1.5'}), 'PDF to JPEG', function() { _closeAll(); _pdfToJpegAction(tab); }).el);
  panel.appendChild(_cBtn(icon('filePlus', {size: 14, strokeWidth: '1.5'}), 'Images to PDF', function() { _closeAll(); _pdfFromImagesAction(); }).el);

  var div2 = new window.View('div').styles({ borderTop: '1px solid var(--nr-border-default)', margin: '2px 12px' });
  panel.appendChild(div2.el);

  panel.appendChild(_cBtn(icon('markdown', {size: 14, strokeWidth: '1.5'}), 'PDF to Markdown', function() { _closeAll(); _pdfToMdAction(tab); }).el);
  panel.appendChild(_cBtn(icon('markdown', {size: 14, strokeWidth: '1.5'}), 'Markdown to PDF', function() { _closeAll(); _pdfMdToPdfAction(); }).el);
}

// ── PDF conversion actions ──

export function _getPdfPath(tab) {
  if (tab.localPath) return Promise.resolve(tab.localPath);
  if (tab.pdfUrl) {
    try {
      var m = tab.pdfUrl.match(/[?&]path=([^&]+)/);
      if (m) return Promise.resolve(decodeURIComponent(m[1]));
    } catch(e) {}
  }
  var url = tab.url;
  if (url && (url.toLowerCase().endsWith('.pdf') || (url.includes('/pdf/') && url.includes('arxiv.org')))) {
    return electronAPI.pdfDownloadTemp(url).then(function(result) {
      if (result && result.ok && result.path) return result.path;
      return null;
    });
  }
  return Promise.resolve(null);
}

function _toast(msg) {
  if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast(msg);
}

export function _pdfParseAction(tab) {
  _toast('Parsing PDF\u2026');
  _getPdfPath(tab).then(function(pdfPath) {
    if (!pdfPath) { _toast('Cannot access PDF file path'); return; }
    electronAPI.pdfParse(pdfPath).then(function(result) {
      if (result.error) { _toast('Parse failed: ' + result.error); return; }
      _showTextOverlay('Parse PDF', result.text, result.pageCount + ' pages', tab);
    }).catch(function(e) { _toast('Parse failed: ' + e.message); });
  });
}

export function _pdfExtractAction(tab) {
  _toast('Extracting PDF\u2026');
  _getPdfPath(tab).then(function(pdfPath) {
    if (!pdfPath) { _toast('Cannot access PDF file path'); return; }
    electronAPI.pdfExtract(pdfPath).then(function(result) {
      if (result.error) { _toast('Extract failed: ' + result.error); return; }
      var extra = result.pageCount + ' pages';
      if (result.images && result.images.length) extra += ' \u00b7 ' + result.images.length + ' images extracted';
      _showTextOverlay('Extract PDF', result.text, extra, tab);
    }).catch(function(e) { _toast('Extract failed: ' + e.message); });
  });
}

export function _pdfSplitAction(tab) {
  var input = prompt('Enter page numbers to extract (e.g. 1,2,5-8):');
  if (!input) return;
  var pages = _parsePageRange(input);
  if (!pages.length) { _toast('Invalid page range'); return; }
  _getPdfPath(tab).then(function(pdfPath) {
    if (!pdfPath) { _toast('Cannot access PDF file path'); return; }
    electronAPI.showSaveDialog({
      title: 'Save Split PDF',
      defaultPath: (tab.title || 'split') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }).then(function(outPath) {
      if (!outPath) return;
      electronAPI.pdfSplit(pdfPath, pages, outPath).then(function(result) {
        if (result.error) { _toast('Split failed: ' + result.error); return; }
        _toast('Split PDF saved (' + result.pageCount + ' pages)');
      }).catch(function(e) { _toast('Split failed: ' + e.message); });
    });
  });
}

export function _pdfMergeAction() {
  electronAPI.showOpenDialogMulti({
    title: 'Select PDFs to Merge',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  }).then(function(paths) {
    if (!paths || !paths.length) return;
    electronAPI.showSaveDialog({
      title: 'Save Merged PDF',
      defaultPath: 'merged.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }).then(function(outPath) {
      if (!outPath) return;
      electronAPI.pdfMerge(paths, outPath).then(function(result) {
        if (result.error) { _toast('Merge failed: ' + result.error); return; }
        _toast('Merged ' + paths.length + ' PDFs (' + result.pageCount + ' pages)');
      }).catch(function(e) { _toast('Merge failed: ' + e.message); });
    });
  });
}

export function _pdfCompressAction(tab) {
  _getPdfPath(tab).then(function(pdfPath) {
    if (!pdfPath) { _toast('Cannot access PDF file path'); return; }
    electronAPI.showSaveDialog({
      title: 'Save Compressed PDF',
      defaultPath: (tab.title || 'compressed') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }).then(function(outPath) {
      if (!outPath) return;
      electronAPI.pdfCompress(pdfPath, outPath).then(function(result) {
        if (result.error) { _toast('Compress failed: ' + result.error); return; }
        var saved = Math.round((1 - result.newSize / result.originalSize) * 100);
        _toast('Compressed: ' + _formatBytes(result.originalSize) + ' \u2192 ' + _formatBytes(result.newSize) + ' (' + saved + '% smaller)');
      }).catch(function(e) { _toast('Compress failed: ' + e.message); });
    });
  });
}

export function _pdfToPngAction(tab) {
  _getPdfPath(tab).then(function(pdfPath) {
    if (!pdfPath) { _toast('Cannot access PDF file path'); return; }
    electronAPI.showSaveDialog({
      title: 'Save PNGs to Folder',
      defaultPath: (tab.title || 'pages') + '_png',
      properties: ['createDirectory']
    }).then(function(outDir) {
      if (!outDir) return;
      electronAPI.pdfToPng(pdfPath, outDir).then(function(result) {
        if (result.error) { _toast('Conversion failed: ' + result.error); return; }
        _toast('Saved ' + result.pageCount + ' PNG files');
        if (electronAPI.showItemInFolder) electronAPI.showItemInFolder(result.files[0]);
      }).catch(function(e) { _toast('Conversion failed: ' + e.message); });
    });
  });
}

export function _pdfToJpegAction(tab) {
  _getPdfPath(tab).then(function(pdfPath) {
    if (!pdfPath) { _toast('Cannot access PDF file path'); return; }
    electronAPI.showSaveDialog({
      title: 'Save JPEGs to Folder',
      defaultPath: (tab.title || 'pages') + '_jpeg',
      properties: ['createDirectory']
    }).then(function(outDir) {
      if (!outDir) return;
      electronAPI.pdfToJpeg(pdfPath, outDir).then(function(result) {
        if (result.error) { _toast('Conversion failed: ' + result.error); return; }
        _toast('Saved ' + result.pageCount + ' JPEG files');
        if (electronAPI.showItemInFolder) electronAPI.showItemInFolder(result.files[0]);
      }).catch(function(e) { _toast('Conversion failed: ' + e.message); });
    });
  });
}

export function _pdfFromImagesAction() {
  electronAPI.showOpenDialogMulti({
    title: 'Select Images',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif'] }]
  }).then(function(paths) {
    if (!paths || !paths.length) return;
    electronAPI.showSaveDialog({
      title: 'Save PDF',
      defaultPath: 'images.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }).then(function(outPath) {
      if (!outPath) return;
      electronAPI.pdfFromImages(paths, outPath).then(function(result) {
        if (result.error) { _toast('Conversion failed: ' + result.error); return; }
        _toast('Created PDF from ' + paths.length + ' images');
      }).catch(function(e) { _toast('Conversion failed: ' + e.message); });
    });
  });
}

export function _pdfToMdAction(tab) {
  _getPdfPath(tab).then(function(pdfPath) {
    if (!pdfPath) { _toast('Cannot access PDF file path'); return; }
    electronAPI.showSaveDialog({
      title: 'Save Markdown',
      defaultPath: (tab.title || 'document') + '.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }).then(function(outPath) {
      if (!outPath) return;
      electronAPI.pdfToMd(pdfPath, outPath).then(function(result) {
        if (result.error) { _toast('Conversion failed: ' + result.error); return; }
        _toast('Saved Markdown (' + result.pageCount + ' pages)');
      }).catch(function(e) { _toast('Conversion failed: ' + e.message); });
    });
  });
}

export function _pdfMdToPdfAction() {
  electronAPI.showOpenDialogMulti({
    title: 'Select Markdown File',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
  }).then(function(paths) {
    if (!paths || !paths.length) return;
    var mdPath = paths[0];
    electronAPI.showSaveDialog({
      title: 'Save PDF',
      defaultPath: mdPath.replace(/\.[^.]+$/, '') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }).then(function(outPath) {
      if (!outPath) return;
      electronAPI.pdfMdToPdf(mdPath, outPath).then(function(result) {
        if (result.error) { _toast('Conversion failed: ' + result.error); return; }
        _toast('Created PDF from Markdown');
      }).catch(function(e) { _toast('Conversion failed: ' + e.message); });
    });
  });
}

// ── Print ──

export function browsePrintPage() {
  var dd = document.getElementById('browse-more-menu');
  if (dd) dd.style.display = 'none';

  var tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  var el = tab ? tab.el : null;
  if (!el) return;

  if (window._browseIsElectron && el.printToPDF) {
    el.printToPDF({ printBackground: true }).then(function(buf) {
      var blob = new Blob([buf], { type: 'application/pdf' });
      var blobUrl = URL.createObjectURL(blob);
      if (typeof window.browseNewTab === 'function') window.browseNewTab(blobUrl);
    }).catch(function() { el.print(); });
  } else {
    try { el.contentWindow.print(); } catch(e) {
      if (tab && tab.url) window.open(tab.url, '_blank');
    }
  }
}

// ── AI View ──

export function browseShowAIView() {
  var tab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
    ? _browseTabs.find(function(t) { return t.id === _browseActiveTab; }) : null;
  if (!tab || !tab.el) return;

  if (typeof window.agentGetAccessibleDOM !== 'function') return;
  window.agentGetAccessibleDOM(tab).then(function(dom) {
    if (!dom || dom.error) return;
    var text = dom.elements || '(empty page)';
    var elCount = dom.elementCount || 0;
    var tokens = Math.round(text.length / 4);
    var tokenLabel = tokens >= 1000 ? Math.round(tokens / 1000) + 'k' : String(tokens);

    var existing = document.getElementById('ai-view-overlay');
    if (existing) existing.remove();

    var titleEl = window.Text('AI View').foreground('primary').styles({ fontSize: '0.85rem', fontWeight: '600' });
    var badgeEl = window.Text(elCount + ' elements \u00b7 ' + tokenLabel + ' tokens \u00b7 ' + text.length.toLocaleString() + ' chars')
      .font('caption2').foreground('secondary').styles({ marginLeft: '8px', fontVariantNumeric: 'tabular-nums' });
    var urlBadgeEl = window.Text(dom.title ? dom.title + ' \u2014 ' + dom.url : dom.url)
      .font('caption2').foreground('tertiary').truncate().styles({ marginLeft: '8px', maxWidth: '300px' });

    var closeBtnEl = window.Text('\u00d7').foreground('secondary').padding('4px', '8px')
      .styles({ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' })
      .onTap(function() { overlayView.el.remove(); document.removeEventListener('keydown', onKey); });

    var leftGroup = window.HStack([titleEl, badgeEl, urlBadgeEl]).alignment('center');
    var headerEl = window.HStack([leftGroup, closeBtnEl]).alignment('center')
      .padding('12px', '16px')
      .styles({ justifyContent: 'space-between', flexShrink: '0', borderBottom: '1px solid var(--nr-border-default)' });

    var contentEl = new window.View('pre').flex(1).overflow('auto').padding(4).foreground('primary')
      .styles({ margin: '0', fontSize: '0.75rem', lineHeight: '1.6', whiteSpace: 'pre', fontFamily: 'var(--nr-font-mono, monospace)' });

    var fullText = '--- BROWSER TAB DOM (' + (dom.title || '') + ') [' + (dom.url || '') + '] ---\n' + text + '\n--- END DOM ---';
    var highlighted = fullText.replace(/^(--- .+ ---)$/gm, '<span style="color:var(--nr-text-secondary)">$1</span>')
      .replace(/^(VIEWPORT:.*)$/m, '<span style="color:var(--nr-text-secondary)">$1</span>')
      .replace(/\[(\d+)\]/g, '<span style="color:#67d4f1">[$1]</span>')
      .replace(/<(\w+)/g, '<span style="color:#8bdb8b">&lt;$1</span>')
      .replace(/>/g, '<span style="color:#8bdb8b">&gt;</span>')
      .replace(/((?:aria-\w+|role|type|name|placeholder|href|value|title|disabled|checked)(?:="[^"]*")?)/g, '<span style="color:#e8c87a">$1</span>')
      .replace(/(@-?\d+,-?\d+,\d+,\d+)/g, '<span style="color:var(--nr-text-secondary)">$1</span>');
    contentEl.el.innerHTML = highlighted;

    var overlayView = window.VStack([headerEl, contentEl]).id('ai-view-overlay')
      .position('fixed').zIndex('modal').background('primary')
      .styles({ inset: '0', paddingTop: '48px' });

    document.body.appendChild(overlayView.el);

    function onKey(e) { if (e.key === 'Escape') { overlayView.el.remove(); document.removeEventListener('keydown', onKey); } }
    document.addEventListener('keydown', onKey);
  }).catch(function(e) { console.warn('[AI View] Failed:', e); });
}

// ── Text overlay ──

export function _showTextOverlay(title, text, subtitle, tab) {
  var existing = document.getElementById('pdf-text-overlay');
  if (existing) existing.remove();

  var tokens = Math.round(text.length / 4);
  var tokenLabel = tokens >= 1000 ? Math.round(tokens / 1000) + 'k' : String(tokens);

  var titleEl = window.Text(title).foreground('primary').styles({ fontSize: '0.85rem', fontWeight: '600' });
  var badgeEl = window.Text(subtitle + ' \u00b7 ' + tokenLabel + ' tokens \u00b7 ' + text.length.toLocaleString() + ' chars')
    .font('caption2').foreground('secondary').styles({ marginLeft: '8px', fontVariantNumeric: 'tabular-nums' });

  var copyBtn = window.Button('Copy').foreground('secondary').font('caption2').cornerRadius('sm')
    .padding('3px', '10px')
    .styles({ background: 'none', border: '1px solid var(--nr-border-default)', cursor: 'pointer', marginRight: '8px' });
  copyBtn.onTap(function() {
    navigator.clipboard.writeText(text).then(function() {
      copyBtn.el.textContent = 'Copied!';
      setTimeout(function() { copyBtn.el.textContent = 'Copy'; }, 1500);
      if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6');
    });
  });

  var closeBtn = window.Text('\u00d7').foreground('secondary').padding('4px', '8px')
    .styles({ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' })
    .onTap(function() { overlayView.el.remove(); document.removeEventListener('keydown', onKey); });

  var leftGroup = window.HStack([titleEl, badgeEl]).alignment('center');
  var rightGroup = window.HStack([copyBtn, closeBtn]).alignment('center');
  var headerEl = window.HStack([leftGroup, rightGroup]).alignment('center')
    .padding('12px', '16px')
    .styles({ justifyContent: 'space-between', flexShrink: '0', borderBottom: '1px solid var(--nr-border-default)' });

  var contentEl = new window.View('pre').flex(1).overflow('auto').padding(4).foreground('primary')
    .styles({ margin: '0', fontSize: '0.75rem', lineHeight: '1.6', whiteSpace: 'pre-wrap', fontFamily: 'var(--nr-font-mono, monospace)' });
  contentEl.el.textContent = text;

  var overlayView = window.VStack([headerEl, contentEl]).id('pdf-text-overlay')
    .position('fixed').zIndex('modal').background('primary')
    .styles({ inset: '0', paddingTop: '48px' });

  document.body.appendChild(overlayView.el);

  function onKey(e) { if (e.key === 'Escape') { overlayView.el.remove(); document.removeEventListener('keydown', onKey); } }
  document.addEventListener('keydown', onKey);
}

// ── Helpers ──

function _parsePageRange(str) {
  var pages = [];
  var parts = str.split(',');
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (!p) continue;
    var dash = p.indexOf('-');
    if (dash !== -1) {
      var start = parseInt(p.slice(0, dash), 10);
      var end = parseInt(p.slice(dash + 1), 10);
      if (isNaN(start) || isNaN(end)) continue;
      for (var j = start; j <= end; j++) pages.push(j - 1);
    } else {
      var n = parseInt(p, 10);
      if (!isNaN(n)) pages.push(n - 1);
    }
  }
  return pages;
}

function _formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export function _refreshOverflowBookmark(btn) {
  var tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  var isSaved = tab && !tab.blank && tab.url && typeof window.isPostSaved === 'function' && window.isPostSaved(tab.url);
  var svg = btn.querySelector('svg');
  if (svg) {
    svg.setAttribute('fill', isSaved ? 'var(--nr-accent)' : 'none');
    svg.setAttribute('stroke', isSaved ? 'var(--nr-accent)' : 'currentColor');
  }
  var textNode = Array.from(btn.childNodes).find(function(n) { return n.nodeType === 3 && n.textContent.trim(); });
  if (textNode) textNode.textContent = ' ' + (isSaved ? 'Saved' : 'Save to Reading List');
}

// ── Overflow drag ──

export function _setupOverflowDrag(dd) {
  var holdTimer = null;
  var dragGhost = null;
  var dragId = null;
  var dragBtn = null;

  function onPointerDown(e) {
    var btn = e.target.closest('[data-overflow-id]');
    if (!btn) return;
    var id = btn.dataset.overflowId;
    holdTimer = setTimeout(function() {
      holdTimer = null;
      dragId = id;
      dragBtn = btn;
      btn.style.opacity = '0.4';
      dragGhost = btn.cloneNode(true);
      Object.assign(dragGhost.style, { position: 'fixed', zIndex: '100000', pointerEvents: 'none', padding: '6px 12px', background: 'var(--nr-bg-overlay)', border: '1px solid var(--nr-border-default)', borderRadius: '8px', boxShadow: '0 4px 16px var(--nr-shadow-popup)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '8px', opacity: '0.9', color: 'var(--nr-text-primary)', whiteSpace: 'nowrap' });
      dragGhost.style.left = (e.clientX - 40) + 'px';
      dragGhost.style.top = (e.clientY - 14) + 'px';
      document.body.appendChild(dragGhost);
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
    var bar = document.getElementById('browse-bar');
    if (bar) {
      var r = bar.getBoundingClientRect();
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
    var bar = document.getElementById('browse-bar');
    var dropped = false;
    if (bar) {
      var r = bar.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        dropped = true;
      }
      bar.style.outline = '';
      bar.style.outlineOffset = '';
    }
    dragGhost.remove();
    dragGhost = null;
    if (dragBtn) dragBtn.style.opacity = '';
    if (dropped && typeof window.removeFromBarOverflow === 'function') {
      window.removeFromBarOverflow(dragId);
      dd.style.display = 'none';
    }
    dragId = null;
    dragBtn = null;
  }

  dd.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  var obs = new MutationObserver(function() {
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

// ── Action registry ──
registerActions({
  toggleBrowseMoreMenu: function() { toggleBrowseMoreMenu(); },
});
