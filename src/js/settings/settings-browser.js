// ─── Browser Settings ──────────────────────────────────────

function _renderDoomScrollSites() {
  var sites = typeof _getDoomScrollSites === 'function' ? _getDoomScrollSites() : [];
  var siteRows = sites.map(function(s, i) {
    var pillColor = s.mode === 'block' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400';
    var pillLabel = s.mode === 'block' ? 'Block' : s.minutes + ' min';
    var removeBtn = Button('').className('text-dimmer hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity')
      .styles({ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' });
    removeBtn.el.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    removeBtn.onTap(function() { _removeDoomScrollSite(i); });
    return HStack(
      Text(s.domain).className('text-primary text-[0.8rem] flex-1'),
      Text(pillLabel).className('text-[0.7rem] font-medium px-2 py-0.5 rounded-full ' + pillColor),
      removeBtn
    ).spacing(2).className('flex items-center py-1.5 px-2 rounded-md hover:bg-hover group').styles({ marginBottom: '2px' });
  });

  var domainInput = new View('input');
  domainInput.el.type = 'text';
  domainInput.el.id = 'doom-scroll-new-domain';
  domainInput.el.placeholder = 'domain.com';
  domainInput.className('flex-1 text-[0.8rem] px-2 py-1.5 rounded-md bg-transparent border border-border-input text-primary placeholder:text-dimmer focus:outline-none focus:border-accent');
  domainInput.styles({ minWidth: '0' });
  domainInput.el.addEventListener('keydown', function(e) { if (e.key === 'Enter') _addDoomScrollSite(); });

  var modeSelect = new View('select');
  modeSelect.el.id = 'doom-scroll-new-mode';
  modeSelect.className('text-[0.78rem] px-2 py-1.5 rounded-md bg-card border border-border-input text-primary focus:outline-none focus:border-accent');
  modeSelect.styles({ color: 'var(--nr-text-primary)', background: 'var(--nr-bg-surface)' });
  modeSelect.el.innerHTML = '<option value="nudge">Nudge</option><option value="block">Block</option>';
  modeSelect.el.addEventListener('change', function() {
    var minEl = document.getElementById('doom-scroll-new-minutes');
    if (minEl) minEl.style.display = this.value === 'block' ? 'none' : '';
  });

  var minutesInput = new View('input');
  minutesInput.el.type = 'number';
  minutesInput.el.id = 'doom-scroll-new-minutes';
  minutesInput.el.value = '5';
  minutesInput.el.min = '1';
  minutesInput.el.max = '120';
  minutesInput.className('text-[0.8rem] px-2 py-1.5 rounded-md bg-transparent border border-border-input text-primary focus:outline-none focus:border-accent');
  minutesInput.styles({ width: '52px' });

  var addBtn = Button('Add').className('text-[0.78rem] px-3 py-1.5 rounded-md border border-border-input bg-card text-primary hover:border-accent hover:text-accent transition-colors cursor-pointer');
  addBtn.styles({ background: 'var(--nr-bg-surface)' });
  addBtn.onTap(function() { _addDoomScrollSite(); });

  var inputRow = HStack(domainInput, modeSelect, minutesInput, addBtn)
    .spacing(2).className('flex items-center mt-2 pt-2 border-t border-border-subtle');

  var resetLink = Button('Reset to defaults').className('text-dimmer text-[0.72rem] hover:text-dim transition-colors')
    .styles({ background: 'none', border: 'none', cursor: 'pointer', padding: '0' });
  resetLink.onTap(function() { _resetDoomScrollSites(); });
  var resetRow = new View('div');
  resetRow.className('mt-2');
  resetRow.el.appendChild(resetLink.el);

  var all = siteRows.concat([inputRow, resetRow]);
  return VStack.apply(null, all);
}

function _addDoomScrollSite() {
  const domainInput = document.getElementById('doom-scroll-new-domain');
  const modeSelect = document.getElementById('doom-scroll-new-mode');
  const minutesInput = document.getElementById('doom-scroll-new-minutes');
  if (!domainInput) return;
  const domain = domainInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain) return;
  const mode = modeSelect ? modeSelect.value : 'nudge';
  const minutes = minutesInput ? parseInt(minutesInput.value) || 5 : 5;
  const sites = _getDoomScrollSites();
  if (sites.some(s => s.domain === domain)) return;
  sites.push({ domain, mode, minutes });
  _saveDoomScrollSites(sites);
  AetherUI.mount(_renderDoomScrollSites(), '#doom-scroll-sites-list');
}

function _removeDoomScrollSite(index) {
  const sites = _getDoomScrollSites();
  sites.splice(index, 1);
  _saveDoomScrollSites(sites);
  AetherUI.mount(_renderDoomScrollSites(), '#doom-scroll-sites-list');
}

function _resetDoomScrollSites() {
  Settings.remove('doomScrollSites');
  AetherUI.mount(_renderDoomScrollSites(), '#doom-scroll-sites-list');
}

const _expandedPermDomain = null;

function _renderSettingsSitePermissions() {
  if (typeof _getAllSitePermissions !== 'function') return Text('No site permissions set.').className('text-dimmer text-[0.75rem]');
  var all = _getAllSitePermissions();
  var domains = Object.keys(all);
  if (!domains.length) return Text('No site permissions set.').className('text-dimmer text-[0.75rem]');

  var domainCards = domains.sort().map(function(domain) {
    var perms = all[domain];
    var count = Object.keys(perms).length;
    var isExpanded = _expandedPermDomain === domain;

    var clearBtn = Button('Clear').className('').styles({
      padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--nr-border-strong)',
      background: 'var(--nr-bg-surface)', color: 'var(--nr-text-secondary)', fontSize: '0.7rem', cursor: 'pointer'
    });
    clearBtn.onTap(function(e) { e.stopPropagation(); _clearSitePermissions(domain); _remountSitePermissions(); });

    var chevron = RawHTML(icon('chevronRightSmall', { size: 12, stroke: 'var(--nr-text-quaternary)', style: 'transition:transform 0.15s;' + (isExpanded ? 'transform:rotate(90deg);' : '') }));

    var header = HStack(chevron, Text(domain).styles({ flex: '1', fontSize: '0.8rem', color: 'var(--nr-text-primary)', fontWeight: '500' }),
      Text(count + ' permission' + (count !== 1 ? 's' : '')).styles({ fontSize: '0.68rem', color: 'var(--nr-text-quaternary)' }), clearBtn)
      .spacing(2).styles({ padding: '8px 12px', cursor: 'pointer' });
    header.onTap(function() { _expandedPermDomain = (_expandedPermDomain === domain ? null : domain); _remountSitePermissions(); });

    var items = [header];
    if (isExpanded) {
      var permRows = _SITE_PERM_KEYS.map(function(key) {
        var current = perms[key] || 'ask';
        var label = _SITE_PERM_LABELS[key];
        var permIcon = _SITE_PERM_ICONS[key];
        var valBtns = ['ask', 'allow', 'block'].map(function(val) {
          var active = current === val;
          var bg = active ? (val === 'allow' ? 'color-mix(in srgb, #22c55e 20%, var(--nr-bg-surface))' : val === 'block' ? 'color-mix(in srgb, #ef4444 20%, var(--nr-bg-surface))' : 'color-mix(in srgb, var(--nr-accent) 20%, var(--nr-bg-surface))') : 'var(--nr-bg-surface)';
          var fg = active ? (val === 'allow' ? '#22c55e' : val === 'block' ? '#ef4444' : 'var(--nr-accent)') : 'var(--nr-text-quaternary)';
          var b = Button(val).styles({ padding: '2px 8px', fontSize: '0.68rem', border: 'none', cursor: 'pointer', background: bg, color: fg, fontWeight: active ? '600' : '400', textTransform: 'capitalize' });
          b.onTap(function() { _setSitePermission(domain, key, val); _remountSitePermissions(); });
          return b;
        });
        var btnGroup = HStack.apply(null, valBtns).styles({ borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--nr-border-strong)' });
        return HStack(RawHTML('<span style="color:var(--nr-text-quaternary);flex-shrink:0;">' + permIcon + '</span>'),
          Text(label).styles({ flex: '1', fontSize: '0.78rem', color: 'var(--nr-text-primary)' }), btnGroup)
          .spacing(2).styles({ padding: '5px 0' });
      });
      var detail = VStack.apply(null, permRows).styles({ padding: '0 12px 8px', borderTop: '1px solid var(--nr-border-subtle)' });
      items.push(detail);
    }

    return VStack.apply(null, items).styles({ border: '1px solid var(--nr-border-strong)', borderRadius: '8px', marginBottom: '6px', overflow: 'hidden' });
  });
  return VStack.apply(null, domainCards);
}

function _remountSitePermissions() {
  AetherUI.mount(_renderSettingsSitePermissions(), '#settings-site-permissions');
}

function _renderUrlBarSectionsSettings() {
  if (typeof _getUrlBarSections !== 'function') return Text('URL bar sections not available.').className('text-dimmer text-[0.75rem]');
  var sections = _getUrlBarSections();
  var rows = sections.map(function(s) {
    var toggle = Toggle(null);
    var input = toggle.el.querySelector('input[type="checkbox"]');
    if (input) input.checked = s.enabled !== false;
    toggle.on('change', function(e) { if (e.target.type === 'checkbox') _toggleUrlBarSection(s.key, e.target.checked); });
    var row = HStack(
      Text('\u2847').styles({ color: 'var(--nr-text-quaternary)', fontSize: '0.9rem', cursor: 'grab', flexShrink: '0' }).attr('title', 'Drag to reorder'),
      Text(s.label).styles({ flex: '1', fontSize: '0.8rem', color: 'var(--nr-text-primary)' }),
      toggle
    ).spacing(2).className('urlbar-sec-row').styles({
      padding: '7px 10px', border: '1px solid var(--nr-border-strong)', borderRadius: '8px',
      marginBottom: '4px', background: 'var(--nr-bg-surface)', cursor: 'grab', userSelect: 'none'
    });
    row.attr('data-seckey', s.key);
    return row;
  });
  var list = VStack.apply(null, rows);
  list.el.id = 'urlbar-section-list';
  return list;
}

function _toggleUrlBarSection(key, enabled) {
  const sections = _getUrlBarSections();
  const sec = sections.find(s => s.key === key);
  if (sec) sec.enabled = enabled;
  _saveUrlBarSections(sections);
}

function _urlBarSectionDragSetup() {
  const list = document.getElementById('urlbar-section-list');
  if (!list) return;
  let dragEl = null;
  let dragGhost = null;
  let startY = 0;
  let dragStarted = false;

  list.addEventListener('pointerdown', e => {
    const row = e.target.closest('.urlbar-sec-row');
    if (!row) return;
    if (e.target.closest('.nr-switch')) return;
    dragEl = row;
    startY = e.clientY;
    dragStarted = false;
    dragEl.setPointerCapture(e.pointerId);
  });

  list.addEventListener('pointermove', e => {
    if (!dragEl) return;
    if (!dragStarted && Math.abs(e.clientY - startY) < 5) return;
    if (!dragStarted) {
      dragStarted = true;
      dragEl.style.opacity = '0.3';
      dragGhost = dragEl.cloneNode(true);
      dragGhost.style.cssText = 'position:fixed;left:' + dragEl.getBoundingClientRect().left + 'px;width:' + dragEl.offsetWidth + 'px;pointer-events:none;z-index:999;opacity:0.85;box-shadow:0 4px 16px rgba(0,0,0,0.3);border-radius:8px;';
      document.body.appendChild(dragGhost);
    }
    dragGhost.style.top = (e.clientY - 18) + 'px';
    const rows = Array.from(list.querySelectorAll('.urlbar-sec-row'));
    for (const r of rows) {
      if (r === dragEl) continue;
      const rect = r.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        list.insertBefore(dragEl, r);
        return;
      }
    }
    list.appendChild(dragEl);
  });

  function endDrag() {
    if (!dragEl) return;
    dragEl.style.opacity = '';
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    if (dragStarted) {
      const rows = Array.from(list.querySelectorAll('.urlbar-sec-row'));
      const currentSections = _getUrlBarSections();
      const newSections = rows.map(r => {
        const key = r.dataset.seckey;
        const existing = currentSections.find(s => s.key === key);
        return { key, label: existing ? existing.label : key, enabled: existing ? existing.enabled : true };
      });
      _saveUrlBarSections(newSections);
      const suppress = ev => { ev.stopPropagation(); ev.preventDefault(); };
      dragEl.addEventListener('click', suppress, { capture: true, once: true });
    }
    dragEl = null;
    dragStarted = false;
  }

  list.addEventListener('pointerup', endDrag);
  list.addEventListener('pointercancel', endDrag);
}

const _expandedPwDomain = null;

function _loadSettingsPasswords() {
  const container = document.getElementById('settings-passwords');
  if (!container) return;
  if (!window.electronAPI || !window.electronAPI.pwList) {
    AetherUI.mount(RawHTML('<div class="text-dimmer text-[0.75rem]">Password storage requires the desktop app.</div>'), container);
    return;
  }
  window.electronAPI.pwList().then(entries => {
    _renderPasswordsList(container, entries || []);
  }).catch(() => {
    AetherUI.mount(RawHTML('<div class="text-dimmer text-[0.75rem]">Failed to load passwords.</div>'), container);
  });
}

function _renderPasswordsList(container, entries) {
  if (!entries.length) {
    AetherUI.mount(Text('No saved passwords.').className('text-dimmer text-[0.75rem]'), container);
    return;
  }
  var grouped = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!grouped[e.origin]) grouped[e.origin] = [];
    grouped[e.origin].push(e);
  }
  var cards = Object.keys(grouped).sort().map(function(origin) {
    var items = grouped[origin];
    var isExpanded = _expandedPwDomain === origin;
    var chevron = RawHTML(icon('chevronRightSmall', { size: 12, stroke: 'var(--nr-text-quaternary)', style: 'transition:transform 0.15s;' + (isExpanded ? 'transform:rotate(90deg);' : '') }));
    var header = HStack(chevron,
      Text(origin).styles({ flex: '1', fontSize: '0.8rem', color: 'var(--nr-text-primary)', fontWeight: '500' }),
      Text(items.length + ' account' + (items.length !== 1 ? 's' : '')).styles({ fontSize: '0.68rem', color: 'var(--nr-text-quaternary)' })
    ).spacing(2).styles({ padding: '8px 12px', cursor: 'pointer' });
    header.onTap(function() { _expandedPwDomain = (_expandedPwDomain === origin ? null : origin); _loadSettingsPasswords(); });

    var cardItems = [header];
    if (isExpanded) {
      var entryRows = items.map(function(entry) {
        var delBtn = Button('Delete').styles({
          padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--nr-border-strong)',
          background: 'var(--nr-bg-surface)', color: 'var(--nr-text-secondary)', fontSize: '0.7rem', cursor: 'pointer'
        });
        delBtn.onTap(function() { _pwDeleteEntry(entry.id); });
        var rowItems = [
          RawHTML(icon('users', { size: 14, stroke: 'var(--nr-text-quaternary)', style: 'flex-shrink:0;' })),
          Text(entry.username || '(no username)').styles({ flex: '1', fontSize: '0.78rem', color: 'var(--nr-text-primary)' })
        ];
        if (entry.createdAt) rowItems.push(Text(new Date(entry.createdAt).toLocaleDateString()).styles({ fontSize: '0.65rem', color: 'var(--nr-text-quaternary)' }));
        rowItems.push(delBtn);
        return HStack.apply(null, rowItems).spacing(2).styles({ padding: '5px 0' });
      });
      var detail = VStack.apply(null, entryRows).styles({ padding: '0 12px 8px', borderTop: '1px solid var(--nr-border-subtle)' });
      cardItems.push(detail);
    }
    return VStack.apply(null, cardItems).styles({ border: '1px solid var(--nr-border-strong)', borderRadius: '8px', marginBottom: '6px', overflow: 'hidden' });
  });
  AetherUI.mount(VStack.apply(null, cards), container);
}

function _pwDeleteEntry(id) {
  if (!window.electronAPI || !window.electronAPI.pwDelete) return;
  window.electronAPI.pwDelete(id).then(() => {
    _loadSettingsPasswords();
  }).catch((e) => { console.warn('pwDelete:', e); });
}

function _renderBrowserSettings() {
  // Ad blocker
  var adBlockChildren = [
    RawHTML('<div id="adblock-rules-info" class="text-dimmer text-[0.75rem] mb-3">' + (window.electronAPI ? 'Loading filter info...' : 'Filter list management requires Electron.') + '</div>')
  ];
  if (window.electronAPI) {
    var updateBtn = new View('button');
    updateBtn.el.textContent = 'Update filter lists';
    updateBtn.className('text-dim text-[0.78rem] hover:text-primary bg-transparent border border-border-input hover:border-accent rounded-md px-3 py-1 cursor-pointer transition-colors');
    updateBtn.onTap(function() { resetAdBlockRules(); });
    adBlockChildren.push(updateBtn);
  }
  var adBlockHeader = HStack(
    Text('Ad Blocker').className('text-white_ text-sm font-semibold'),
    Text('Always On').className('text-[0.75rem] font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400')
  ).spacing(2).className('mb-1');
  var adBlockSection = VStack(
    adBlockHeader,
    Text('Blocks ads and trackers ' + (window.electronAPI ? 'natively at the network level via Electron' : 'via a server-side proxy') + '.').className('text-dim text-[0.8rem] mb-3'),
    VStack.apply(null, adBlockChildren)
  );

  // YT Shorts
  var ytSection = _settingToggle('Hide YouTube Shorts', 'Hides Shorts from the homepage, sidebar, search, and channel pages.',
    Settings.get('hideYTShorts') === 'true', function(on) { Settings.set('hideYTShorts', on ? 'true' : 'false'); });

  // Focus mode
  var focusToggle = _settingToggle('Focus Mode', 'Block or limit time on distracting sites to prevent doom scrolling.',
    Settings.get('doomScrollEnabled') !== 'false', function(on) { Settings.set('doomScrollEnabled', on ? 'true' : 'false'); });
  var focusSitesWrap = new View('div');
  focusSitesWrap.el.id = 'doom-scroll-sites-list';
  focusSitesWrap.className('mt-3');
  AetherUI.mount(_renderDoomScrollSites(), focusSitesWrap.el);
  var focusSites = focusSitesWrap;

  // Simplify URLs
  var urlShortenToggle = Toggle(null);
  var urlShortenInput = urlShortenToggle.el.querySelector('input[type="checkbox"]');
  if (urlShortenInput) urlShortenInput.checked = Settings.get('urlShorten') !== 'false';
  urlShortenToggle.on('change', function(e) {
    if (e.target.type !== 'checkbox') return;
    Settings.set('urlShorten', e.target.checked);
    var inp = document.getElementById('browse-url-input');
    if (inp && !e.target.checked && inp.dataset.fullUrl) inp.value = inp.dataset.fullUrl;
    else if (inp && e.target.checked) _browseUrlOnBlur(inp);
  });
  var simplifyRow = _settingRow('Simplify URLs', 'Show only the domain name in the URL bar when not focused.', urlShortenToggle);

  // Adaptive URL Colors
  var adaptiveToggle = Toggle(null);
  var adaptiveInput = adaptiveToggle.el.querySelector('input[type="checkbox"]');
  if (adaptiveInput) adaptiveInput.checked = Settings.get('adaptiveUrlBar') !== 'off';
  adaptiveToggle.on('change', function(e) {
    if (e.target.type !== 'checkbox') return;
    Settings.set('adaptiveUrlBar', e.target.checked ? 'on' : 'off');
    if (!e.target.checked && typeof _browseResetAdaptiveColor === 'function') _browseResetAdaptiveColor();
    else if (e.target.checked && typeof _browseApplyAdaptiveColor === 'function') {
      var tab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
        ? _browseTabs.find(function(t) { return t.id === _browseActiveTab; }) : null;
      if (tab) _browseApplyAdaptiveColor(tab);
    }
  });
  var adaptiveRow = _settingRow('Adaptive Background', 'Match the browser background to the current website\'s color.', adaptiveToggle);

  // URL bar sections
  var urlBarSectionsWrap = new View('div');
  urlBarSectionsWrap.el.id = 'settings-urlbar-sections';
  AetherUI.mount(_renderUrlBarSectionsSettings(), urlBarSectionsWrap.el);
  var urlBarSections = urlBarSectionsWrap;

  // Site permissions
  var sitePermWrap = new View('div');
  sitePermWrap.el.id = 'settings-site-permissions';
  AetherUI.mount(_renderSettingsSitePermissions(), sitePermWrap.el);
  var sitePermContent = sitePermWrap;

  // Passwords
  var pwContent = RawHTML('<div id="settings-passwords"><div class="text-dimmer text-[0.75rem]">Loading...</div></div>');

  return VStack(
    _settingCard('Layout', [
      _settingBtnGroup('Tab Style', [{value:'island',label:'Island'},{value:'horizontal',label:'Horizontal'}], Settings.get('browseTabLayout') || 'island', function(v) { setBrowseTabLayout(v); }),
      simplifyRow,
      adaptiveRow,
      _settingGroupContent([
        Text('URL Bar Sections').className('text-[0.8rem] text-primary font-medium mb-1'),
        Text('Reorder and toggle sections in the URL bar dropdown. Drag to reorder.').className('text-[0.72rem] text-dimmer mb-3'),
        urlBarSections,
      ]),
    ]),
    _settingCard('Privacy', [
      _settingGroupContent([adBlockSection]),
      ytSection,
      focusToggle,
      _settingGroupContent([focusSites]),
    ]),
    _settingCard('Site Permissions', [
      _settingGroupContent([
        Text('Manage camera, microphone, location, notification, and pop-up permissions per site.').className('text-dim text-[0.8rem] mb-3'),
        sitePermContent,
      ]),
    ]),
    _settingCard('Saved Passwords', [
      _settingGroupContent([
        Text('Passwords are encrypted via your system keychain.').className('text-dim text-[0.8rem] mb-3'),
        pwContent,
      ]),
    ])
  );
}
