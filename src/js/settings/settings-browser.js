// ─── Browser Settings ──────────────────────────────────────

function _renderDoomScrollSites() {
  const sites = typeof _getDoomScrollSites === 'function' ? _getDoomScrollSites() : [];
  let html = '';
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const pillColor = s.mode === 'block' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400';
    const pillLabel = s.mode === 'block' ? 'Block' : s.minutes + ' min';
    html += `<div class="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-hover group" style="margin-bottom:2px">
      <span class="text-primary text-[0.8rem] flex-1">${escapeHtml(s.domain)}</span>
      <span class="text-[0.7rem] font-medium px-2 py-0.5 rounded-full ${pillColor}">${pillLabel}</span>
      <button onclick="_removeDoomScrollSite(${i})" class="text-dimmer hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" style="background:none;border:none;cursor:pointer;padding:2px">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }
  html += `<div class="flex items-center gap-2 mt-2 pt-2 border-t border-border-subtle">
    <input type="text" id="doom-scroll-new-domain" placeholder="domain.com" class="flex-1 text-[0.8rem] px-2 py-1.5 rounded-md bg-transparent border border-border-input text-primary placeholder:text-dimmer focus:outline-none focus:border-accent" style="min-width:0" onkeydown="if(event.key==='Enter')_addDoomScrollSite()">
    <select id="doom-scroll-new-mode" class="text-[0.78rem] px-2 py-1.5 rounded-md bg-card border border-border-input text-primary focus:outline-none focus:border-accent" style="color:var(--nr-text-primary);background:var(--nr-bg-surface)" onchange="document.getElementById('doom-scroll-new-minutes').style.display=this.value==='block'?'none':''">
      <option value="nudge">Nudge</option>
      <option value="block">Block</option>
    </select>
    <input type="number" id="doom-scroll-new-minutes" value="5" min="1" max="120" class="text-[0.8rem] px-2 py-1.5 rounded-md bg-transparent border border-border-input text-primary focus:outline-none focus:border-accent" style="width:52px">
    <button onclick="_addDoomScrollSite()" class="text-[0.78rem] px-3 py-1.5 rounded-md border border-border-input bg-card text-primary hover:border-accent hover:text-accent transition-colors cursor-pointer" style="background:var(--nr-bg-surface)">Add</button>
  </div>`;
  html += `<div class="mt-2"><a href="#" onclick="event.preventDefault();_resetDoomScrollSites()" class="text-dimmer text-[0.72rem] hover:text-dim transition-colors">Reset to defaults</a></div>`;
  return html;
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
  AetherUI.mount(RawHTML(_renderDoomScrollSites()), '#doom-scroll-sites-list');
}

function _removeDoomScrollSite(index) {
  const sites = _getDoomScrollSites();
  sites.splice(index, 1);
  _saveDoomScrollSites(sites);
  AetherUI.mount(RawHTML(_renderDoomScrollSites()), '#doom-scroll-sites-list');
}

function _resetDoomScrollSites() {
  Settings.remove('doomScrollSites');
  AetherUI.mount(RawHTML(_renderDoomScrollSites()), '#doom-scroll-sites-list');
}

const _expandedPermDomain = null;

function _renderSettingsSitePermissions() {
  if (typeof _getAllSitePermissions !== 'function') return '<div class="text-dimmer text-[0.75rem]">No site permissions set.</div>';
  const all = _getAllSitePermissions();
  const domains = Object.keys(all);
  if (!domains.length) return '<div class="text-dimmer text-[0.75rem]">No site permissions set.</div>';

  let html = '';
  for (const domain of domains.sort()) {
    const perms = all[domain];
    const count = Object.keys(perms).length;
    const isExpanded = _expandedPermDomain === domain;
    const safeDomain = escapeHtml(domain).replace(/'/g, "\\'");
    html += '<div style="border:1px solid var(--nr-border-strong);border-radius:8px;margin-bottom:6px;overflow:hidden;">';
    html += '<div style="display:flex;align-items:center;padding:8px 12px;cursor:pointer;gap:8px;" onclick="_expandedPermDomain=(_expandedPermDomain===\'' + safeDomain + '\'?null:\'' + safeDomain + '\');_remountSitePermissions();">';
    html += icon('chevronRightSmall', { size: 12, stroke: 'var(--nr-text-quaternary)', style: 'transition:transform 0.15s;' + (isExpanded ? 'transform:rotate(90deg);' : '') });
    html += '<span style="flex:1;font-size:0.8rem;color:var(--nr-text-primary);font-weight:500;">' + escapeHtml(domain) + '</span>';
    html += '<span style="font-size:0.68rem;color:var(--nr-text-quaternary);">' + count + ' permission' + (count !== 1 ? 's' : '') + '</span>';
    html += '<button onclick="event.stopPropagation(); _clearSitePermissions(\'' + safeDomain + '\'); _remountSitePermissions();" style="padding:2px 8px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-secondary);font-size:0.7rem;cursor:pointer;">Clear</button>';
    html += '</div>';
    if (isExpanded) {
      html += '<div style="padding:0 12px 8px;border-top:1px solid var(--nr-border-subtle);">';
      for (const key of _SITE_PERM_KEYS) {
        const current = perms[key] || 'ask';
        const label = _SITE_PERM_LABELS[key];
        const icon = _SITE_PERM_ICONS[key];
        html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">';
        html += '<span style="color:var(--nr-text-quaternary);flex-shrink:0;">' + icon + '</span>';
        html += '<span style="flex:1;font-size:0.78rem;color:var(--nr-text-primary);">' + label + '</span>';
        html += '<div style="display:flex;border-radius:6px;overflow:hidden;border:1px solid var(--nr-border-strong);">';
        for (const val of ['ask', 'allow', 'block']) {
          const active = current === val;
          const bg = active ? (val === 'allow' ? 'color-mix(in srgb, #22c55e 20%, var(--nr-bg-surface))' : val === 'block' ? 'color-mix(in srgb, #ef4444 20%, var(--nr-bg-surface))' : 'color-mix(in srgb, var(--nr-accent) 20%, var(--nr-bg-surface))') : 'var(--nr-bg-surface)';
          const fg = active ? (val === 'allow' ? '#22c55e' : val === 'block' ? '#ef4444' : 'var(--nr-accent)') : 'var(--nr-text-quaternary)';
          html += '<button onclick="_setSitePermission(\'' + safeDomain + '\',\'' + key + '\',\'' + val + '\'); _remountSitePermissions();" style="padding:2px 8px;font-size:0.68rem;border:none;cursor:pointer;background:' + bg + ';color:' + fg + ';font-weight:' + (active ? '600' : '400') + ';text-transform:capitalize;">' + val + '</button>';
        }
        html += '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  return html;
}

function _remountSitePermissions() {
  AetherUI.mount(RawHTML(_renderSettingsSitePermissions()), '#settings-site-permissions');
}

function _renderUrlBarSectionsSettings() {
  if (typeof _getUrlBarSections !== 'function') return '<div class="text-dimmer text-[0.75rem]">URL bar sections not available.</div>';
  const sections = _getUrlBarSections();
  let html = '<div id="urlbar-section-list">';
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const safeKey = escapeHtml(s.key);
    html += '<div class="urlbar-sec-row" data-seckey="' + safeKey + '" style="display:flex;align-items:center;gap:10px;padding:7px 10px;border:1px solid var(--nr-border-strong);border-radius:8px;margin-bottom:4px;background:var(--nr-bg-surface);cursor:grab;user-select:none;">';
    html += '<span style="color:var(--nr-text-quaternary);font-size:0.9rem;cursor:grab;flex-shrink:0;" title="Drag to reorder">\u2847</span>';
    html += '<span style="flex:1;font-size:0.8rem;color:var(--nr-text-primary);">' + escapeHtml(s.label) + '</span>';
    html += '<label class="nr-switch" style="flex-shrink:0;">';
    html += '<input type="checkbox" ' + (s.enabled !== false ? 'checked' : '') + ' onchange="_toggleUrlBarSection(\'' + safeKey + '\', this.checked)">';
    html += '<span class="slider"></span>';
    html += '</label>';
    html += '</div>';
  }
  html += '</div>';
  return html;
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
    AetherUI.mount(RawHTML('<div class="text-dimmer text-[0.75rem]">No saved passwords.</div>'), container);
    return;
  }
  const grouped = {};
  for (const e of entries) {
    if (!grouped[e.origin]) grouped[e.origin] = [];
    grouped[e.origin].push(e);
  }
  let html = '';
  for (const origin of Object.keys(grouped).sort()) {
    const items = grouped[origin];
    const isExpanded = _expandedPwDomain === origin;
    const safeOrigin = escapeHtml(origin).replace(/'/g, "\\'");
    html += '<div style="border:1px solid var(--nr-border-strong);border-radius:8px;margin-bottom:6px;overflow:hidden;">';
    html += '<div style="display:flex;align-items:center;padding:8px 12px;cursor:pointer;gap:8px;" onclick="_expandedPwDomain=(_expandedPwDomain===\'' + safeOrigin + '\'?null:\'' + safeOrigin + '\');_loadSettingsPasswords();">';
    html += icon('chevronRightSmall', { size: 12, stroke: 'var(--nr-text-quaternary)', style: 'transition:transform 0.15s;' + (isExpanded ? 'transform:rotate(90deg);' : '') });
    html += '<span style="flex:1;font-size:0.8rem;color:var(--nr-text-primary);font-weight:500;">' + escapeHtml(origin) + '</span>';
    html += '<span style="font-size:0.68rem;color:var(--nr-text-quaternary);">' + items.length + ' account' + (items.length !== 1 ? 's' : '') + '</span>';
    html += '</div>';
    if (isExpanded) {
      html += '<div style="padding:0 12px 8px;border-top:1px solid var(--nr-border-subtle);">';
      for (const entry of items) {
        html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">';
        html += icon('users', { size: 14, stroke: 'var(--nr-text-quaternary)', style: 'flex-shrink:0;' });
        html += '<span style="flex:1;font-size:0.78rem;color:var(--nr-text-primary);">' + escapeHtml(entry.username || '(no username)') + '</span>';
        if (entry.createdAt) {
          html += '<span style="font-size:0.65rem;color:var(--nr-text-quaternary);">' + new Date(entry.createdAt).toLocaleDateString() + '</span>';
        }
        html += '<button onclick="_pwDeleteEntry(\'' + entry.id + '\')" style="padding:2px 8px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-secondary);font-size:0.7rem;cursor:pointer;">Delete</button>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  AetherUI.mount(RawHTML(html), container);
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
  var focusSites = RawHTML('<div id="doom-scroll-sites-list" class="mt-3">' + _renderDoomScrollSites() + '</div>');

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
  var urlBarSections = RawHTML('<div id="settings-urlbar-sections">' + _renderUrlBarSectionsSettings() + '</div>');

  // Site permissions
  var sitePermContent = RawHTML('<div id="settings-site-permissions">' + _renderSettingsSitePermissions() + '</div>');

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
