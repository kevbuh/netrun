// browse-menu.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
import { logger } from '/js/logger.js';
import Settings from '/js/core/core-settings.js';
import { icon } from '/js/core/icons.js';
import { getBarOverflowIds, removeFromBarOverflow } from '/js/core/core-sidebar.js';
import { _annotationsEnabled, toggleAnnotations } from '/js/browse/browse-annotations.js';
import { _browseActiveEl, browseBack, browseForward, browseReload, toggleBrowseTabLayout } from '/js/browse/browse-island.js';
import { _renderSitePermissionsDropdown, openSearchHistoryPage, toggleAdBlock, toggleDoH, toggleTrackingStrip, toggleHttpsOnly, toggleCookieBlock } from '/js/browse-urlbar.js';
import { toggleAutoRemoveCSS } from '/js/browse/browse-downloads.js';
import { agentGetAccessibleDOM } from '/js/browse/browse-agent.js';
import { browseNewTab } from '/js/browse/browse-windows.js';
import { _nerdModeEnabled, toggleNerdMode } from '/js/browse/browse-nerd-mode.js';
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
    if (opts.trailing) row.add(opts.trailing);
    btn.add(row);
    btn.cssText('width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:' + (opts.disabled ? 'var(--nr-text-quaternary, var(--aether-text-dimmest))' : (opts.color || 'var(--nr-text-primary, var(--aether-text))')) + ';font-size:0.78rem;cursor:' + (opts.disabled ? 'default' : 'pointer') + ';display:flex;align-items:center;gap:8px;');
    if (opts.disabled) btn.el.disabled = true;
    if (opts.dataOverflowId) btn.el.setAttribute('data-overflow-id', opts.dataOverflowId);
    btn.onHover(function() { btn.el.style.background = 'var(--nr-bg-hover, var(--aether-hover))'; }, function() { btn.el.style.background = 'none'; });
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
    // ── Privacy Section ──
    items.push(new window.View('div').styles({borderTop:'1px solid var(--nr-border-default, var(--aether-border))'}).margin('2px', '0'));

    const _privFeatures = [
      { key: 'adBlockEnabled',          label: 'Ad Blocker',       ic: 'shield',  fn: function() { toggleAdBlock(); toggleBrowseMoreMenu(); toggleBrowseMoreMenu(); }, checkOn: function(v) { return v === 'true'; } },
      { key: 'dohEnabled',              label: 'Encrypted DNS',    ic: 'lock',    fn: function() { toggleDoH(); toggleBrowseMoreMenu(); toggleBrowseMoreMenu(); }, checkOn: function(v) { return v !== 'false'; } },
      { key: 'httpsOnlyEnabled',        label: 'HTTPS Only',       ic: 'globe',   fn: function() { toggleHttpsOnly(); toggleBrowseMoreMenu(); toggleBrowseMoreMenu(); }, checkOn: function(v) { return v !== 'false'; } },
      { key: 'trackingStripEnabled',    label: 'Tracking Strip',   ic: 'eye',     fn: function() { toggleTrackingStrip(); toggleBrowseMoreMenu(); toggleBrowseMoreMenu(); }, checkOn: function(v) { return v !== 'false'; } },
      { key: 'thirdPartyCookiesBlocked',label: 'Cookie Blocking',  ic: 'close',   fn: function() { toggleCookieBlock(); toggleBrowseMoreMenu(); toggleBrowseMoreMenu(); }, checkOn: function(v) { return v !== 'false'; } },
    ];
    const _privActive = _privFeatures.filter(function(f) { return f.checkOn(Settings.get(f.key)); }).length;
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

    // Privacy stats + details (async)
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

          // Summary line
          var parts = [];
          if (c[0] > 0) parts.push(c[0] + ' ad' + (c[0] !== 1 ? 's' : '') + ' blocked');
          if (c[1] > 0) parts.push(c[1] + ' tracker' + (c[1] !== 1 ? 's' : '') + ' stripped');
          if (c[2] > 0) parts.push(c[2] + ' HTTPS upgrade' + (c[2] !== 1 ? 's' : ''));
          if (c[3] > 0) parts.push(c[3] + ' cookie' + (c[3] !== 1 ? 's' : '') + ' blocked');
          var summaryText = parts.length > 0 ? parts.join(' \u00b7 ') : 'No threats detected on this page';
          rows.push(window.Text(summaryText).font('caption2').styles({color:'var(--nr-accent)', fontWeight:'500'}));

          // Domain breakdown helper
          function _domainRows(map, label) {
            var entries = Object.entries(map || {}).sort(function(a, b) { return b[1] - a[1]; });
            if (!entries.length) return;
            rows.push(window.Text(label).font('caption2').foreground('quaternary').styles({marginTop:'4px', fontWeight:'600', textTransform:'uppercase', letterSpacing:'0.04em'}));
            var shown = entries.slice(0, 5);
            for (var i = 0; i < shown.length; i++) {
              rows.push(window.HStack([
                window.Text(shown[i][0]).font('caption2').foreground('secondary').flex(1).styles({overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}),
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
      } catch {}
    }

    items.push(new window.View('div').styles({borderTop:'1px solid var(--nr-border-default, var(--aether-border))'}).margin('2px', '0'));

    const _cssOff = Settings.get('autoRemoveCSS') === 'true';
    items.push(_mBtn(icon('code', {size: 16, strokeWidth: '1.5'}), 'Auto Remove CSS', function() { toggleAutoRemoveCSS(); _closeMenu(); }, { disabled: !hasTab, color: _cssOff ? 'var(--nr-accent)' : undefined, trailing: window.Text(_cssOff ? 'On' : 'Off').styles({marginLeft:'auto'}).font('caption2').foreground('quaternary') }));
    const _annEnabled = tab && _annotationsEnabled.get(tab.id);
    items.push(_mBtn(icon('annotate', {size: 16}), _annEnabled ? 'Remove Annotations' : 'Annotate Page', function() { toggleAnnotations(); _closeMenu(); }, { disabled: !hasTab, color: _annEnabled ? 'var(--nr-accent)' : undefined }));
    const _nerdOn = tab && _nerdModeEnabled.get(tab.id);
    var isPdfForNerd = hasTab && (tab.pdfUrl || tab.localPath || (tab.url && tab.url.toLowerCase().endsWith('.pdf')) || (tab.url && tab.url.includes('/pdf/') && tab.url.includes('arxiv.org')));
    items.push(_mBtn(icon('research', {size: 16}), 'Nerd Mode', function() { toggleNerdMode(tab); _closeMenu(); }, { disabled: !isPdfForNerd, color: _nerdOn ? 'var(--nr-accent)' : undefined, trailing: _nerdOn ? window.Text('On').styles({marginLeft:'auto'}).font('caption2').foreground('quaternary') : undefined }));
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
  items.push(new window.View('div').styles({borderTop:'1px solid var(--nr-border-default, var(--aether-border))'}).margin('2px', '0'));

  // Permissions
  const permsBtn = _mBtn(icon('lock', {size: 16, strokeWidth: '1.5'}), 'Site Permissions', function(e) { _togglePermissionsInMenu(e || window.event); }, { disabled: !hasTab });
  // Append arrow icon
  const arrowEl = document.createElement('span');
  arrowEl.innerHTML = icon('chevronRightSmall', {size: 12, style: 'margin-left:auto;color:var(--nr-text-quaternary, var(--aether-text-dimmest));transition:transform .15s;'});
  arrowEl.firstChild.id = 'browse-menu-perms-arrow';
  permsBtn.el.appendChild(arrowEl);
  items.push(permsBtn);

  // Permissions panel placeholder
  const permsPanel = new window.View('div').id('browse-menu-perms-panel').styles({display:'none', borderTop:'1px solid var(--aether-border)'});
  items.push(permsPanel);

  // Print
  items.push(_mBtn(icon('print', {size: 16, strokeWidth: '1.5'}), 'Print page', function() { browsePrintPage(); _closeMenu(); }, { disabled: !hasTab }));

  // Convert submenu (PDF only)
  var isPdf = hasTab && (tab.pdfUrl || tab.localPath || (tab.url && tab.url.toLowerCase().endsWith('.pdf')));
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
    .styles({ minWidth: '180px', background: 'var(--nr-bg-overlay, var(--aether-dropdown-bg))', border: '1px solid var(--nr-border-default, var(--aether-border))', boxShadow: '0 8px 32px var(--nr-shadow-popup, var(--aether-shadow))' })
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

// ── Convert submenu toggle ──

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
    btn.cssText('width:100%;text-align:left;padding:5px 16px;border:none;background:none;color:var(--nr-text-primary, var(--aether-text));font-size:0.75rem;cursor:pointer;display:flex;align-items:center;gap:8px;');
    btn.onHover(function() { btn.el.style.background = 'var(--nr-bg-hover, var(--aether-hover))'; }, function() { btn.el.style.background = 'none'; });
    btn.onTap(function() { action(); });
    return btn;
  }

  var _closeAll = function() {
    var dd = document.getElementById('browse-more-menu');
    if (dd) { dd.style.display = 'none'; document.body.classList.remove('island-dropdown-guard'); }
  };

  // Parse PDF
  panel.appendChild(_cBtn(icon('fileText', {size: 14, strokeWidth: '1.5'}), 'Parse PDF', function() { _closeAll(); _pdfParseAction(tab); }).el);
  // Extract PDF
  panel.appendChild(_cBtn(icon('documentSearch', {size: 14, strokeWidth: '1.5'}), 'Extract PDF', function() { _closeAll(); _pdfExtractAction(tab); }).el);
  // Split PDF
  panel.appendChild(_cBtn(icon('scissors', {size: 14, strokeWidth: '1.5'}), 'Split PDF', function() { _closeAll(); _pdfSplitAction(tab); }).el);
  // Merge PDFs
  panel.appendChild(_cBtn(icon('fileMerge', {size: 14, strokeWidth: '1.5'}), 'Merge PDFs', function() { _closeAll(); _pdfMergeAction(tab); }).el);
  // Compress PDF
  panel.appendChild(_cBtn(icon('compress', {size: 14, strokeWidth: '1.5'}), 'Compress PDF', function() { _closeAll(); _pdfCompressAction(tab); }).el);

  // Divider
  var div1 = document.createElement('div');
  div1.style.cssText = 'border-top:1px solid var(--nr-border-default, var(--aether-border));margin:2px 12px;';
  panel.appendChild(div1);

  // PDF to PNG
  panel.appendChild(_cBtn(icon('imagePlus', {size: 14, strokeWidth: '1.5'}), 'PDF to PNG', function() { _closeAll(); _pdfToPngAction(tab); }).el);
  // PDF to JPEG
  panel.appendChild(_cBtn(icon('imagePlus', {size: 14, strokeWidth: '1.5'}), 'PDF to JPEG', function() { _closeAll(); _pdfToJpegAction(tab); }).el);
  // Images to PDF
  panel.appendChild(_cBtn(icon('filePlus', {size: 14, strokeWidth: '1.5'}), 'Images to PDF', function() { _closeAll(); _pdfFromImagesAction(); }).el);

  // Divider
  var div2 = document.createElement('div');
  div2.style.cssText = 'border-top:1px solid var(--nr-border-default, var(--aether-border));margin:2px 12px;';
  panel.appendChild(div2);

  // PDF to Markdown
  panel.appendChild(_cBtn(icon('markdown', {size: 14, strokeWidth: '1.5'}), 'PDF to Markdown', function() { _closeAll(); _pdfToMdAction(tab); }).el);
  // Markdown to PDF
  panel.appendChild(_cBtn(icon('markdown', {size: 14, strokeWidth: '1.5'}), 'Markdown to PDF', function() { _closeAll(); _pdfMdToPdfAction(); }).el);
}

// ── PDF conversion action handlers ──

function _getPdfPath(tab) {
  // Get a local file path for the PDF
  if (tab.localPath) return tab.localPath;
  // For pdfUrl like /api/local-file?path=..., extract the path
  if (tab.pdfUrl) {
    try {
      var m = tab.pdfUrl.match(/[?&]path=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
    } catch(e) {}
  }
  return null;
}

function _toast(msg) {
  if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast(msg);
}

function _pdfParseAction(tab) {
  var pdfPath = _getPdfPath(tab);
  if (!pdfPath) { _toast('Cannot access PDF file path'); return; }
  electronAPI.pdfParse(pdfPath).then(function(result) {
    if (result.error) { _toast('Parse failed: ' + result.error); return; }
    _showTextOverlay('Parse PDF', result.text, result.pageCount + ' pages', tab);
  }).catch(function(e) { _toast('Parse failed: ' + e.message); });
}

function _pdfExtractAction(tab) {
  var pdfPath = _getPdfPath(tab);
  if (!pdfPath) { _toast('Cannot access PDF file path'); return; }
  electronAPI.pdfExtract(pdfPath).then(function(result) {
    if (result.error) { _toast('Extract failed: ' + result.error); return; }
    var extra = result.pageCount + ' pages';
    if (result.images && result.images.length) extra += ' \u00b7 ' + result.images.length + ' images extracted';
    _showTextOverlay('Extract PDF', result.text, extra, tab);
  }).catch(function(e) { _toast('Extract failed: ' + e.message); });
}

function _pdfSplitAction(tab) {
  var pdfPath = _getPdfPath(tab);
  if (!pdfPath) { _toast('Cannot access PDF file path'); return; }
  // Prompt for page range
  var input = prompt('Enter page numbers to extract (e.g. 1,2,5-8):');
  if (!input) return;
  var pages = _parsePageRange(input);
  if (!pages.length) { _toast('Invalid page range'); return; }

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
}

function _pdfMergeAction() {
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

function _pdfCompressAction(tab) {
  var pdfPath = _getPdfPath(tab);
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
}

function _pdfToPngAction(tab) {
  var pdfPath = _getPdfPath(tab);
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
}

function _pdfToJpegAction(tab) {
  var pdfPath = _getPdfPath(tab);
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
}

function _pdfFromImagesAction() {
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

function _pdfToMdAction(tab) {
  var pdfPath = _getPdfPath(tab);
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
}

function _pdfMdToPdfAction() {
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

// ── Helpers ──

function _parsePageRange(str) {
  // Parse "1,2,5-8" into [0,1,4,5,6,7] (0-based)
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

function _showTextOverlay(title, text, subtitle, tab) {
  // Full-screen overlay to display extracted text, similar to AI View
  var existing = document.getElementById('pdf-text-overlay');
  if (existing) existing.remove();

  var tokens = Math.round(text.length / 4);
  var tokenLabel = tokens >= 1000 ? Math.round(tokens / 1000) + 'k' : String(tokens);

  var overlayView = new window.View('div').id('pdf-text-overlay');
  overlayView.cssText('position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;background:var(--nr-bg-primary, #111);padding-top:48px;');

  // Header bar
  var titleEl = new window.View('span');
  titleEl.cssText('font-size:0.85rem;font-weight:600;color:var(--nr-text-primary, #fff);');
  titleEl.el.textContent = title;

  var badgeEl = new window.View('span');
  badgeEl.cssText('font-size:0.7rem;color:var(--nr-text-secondary, #888);margin-left:8px;font-variant-numeric:tabular-nums;');
  badgeEl.el.textContent = subtitle + ' \u00b7 ' + tokenLabel + ' tokens \u00b7 ' + text.length.toLocaleString() + ' chars';

  var copyBtn = new window.View('button');
  copyBtn.cssText('background:none;border:1px solid var(--nr-border-default, #444);color:var(--nr-text-secondary, #888);cursor:pointer;font-size:0.7rem;padding:3px 10px;border-radius:6px;margin-right:8px;');
  copyBtn.el.textContent = 'Copy';
  copyBtn.onTap(function() {
    navigator.clipboard.writeText(text).then(function() {
      copyBtn.el.textContent = 'Copied!';
      setTimeout(function() { copyBtn.el.textContent = 'Copy'; }, 1500);
    });
  });

  var closeBtn = new window.View('button');
  closeBtn.cssText('background:none;border:none;color:var(--nr-text-secondary, #888);cursor:pointer;font-size:1.2rem;padding:4px 8px;');
  closeBtn.el.textContent = '\u00d7';
  closeBtn.onTap(function() { overlayView.el.remove(); });

  var leftGroup = new window.View('div');
  leftGroup.cssText('display:flex;align-items:center;');
  leftGroup.el.appendChild(titleEl.el);
  leftGroup.el.appendChild(badgeEl.el);

  var rightGroup = new window.View('div');
  rightGroup.cssText('display:flex;align-items:center;');
  rightGroup.el.appendChild(copyBtn.el);
  rightGroup.el.appendChild(closeBtn.el);

  var headerEl = new window.View('div');
  headerEl.cssText('display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--nr-border-default, #333);flex-shrink:0;');
  headerEl.el.appendChild(leftGroup.el);
  headerEl.el.appendChild(rightGroup.el);

  // Content
  var contentEl = new window.View('pre');
  contentEl.cssText('flex:1;overflow:auto;padding:16px;margin:0;font-size:0.75rem;line-height:1.6;color:var(--nr-text-primary, #ddd);white-space:pre-wrap;font-family:var(--nr-font-mono, monospace);');
  contentEl.el.textContent = text;

  overlayView.el.appendChild(headerEl.el);
  overlayView.el.appendChild(contentEl.el);
  document.body.appendChild(overlayView.el);

  // Esc to close
  function onKey(e) { if (e.key === 'Escape') { overlayView.el.remove(); document.removeEventListener('keydown', onKey); } }
  document.addEventListener('keydown', onKey);
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

