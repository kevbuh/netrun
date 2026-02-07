async function openSettings() {
  setSidebarLoading('sb-settings');
  hideAllViews();
  const view = await ensureView('settings-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'settings';
  setSidebarActive('sb-settings');
  renderSettingsView();
}

function _renderAccountSettings() {
  return `
    <!-- PROFILE -->
    <div class="mb-8">
      <h3 class="text-white_ text-sm font-semibold mb-3">Profile</h3>
      <div class="flex items-center gap-4 mb-4">
        <div class="relative group cursor-pointer" onclick="_uploadProfilePic()" title="Change profile picture" style="flex-shrink:0">
          ${_authUserInfo?.picture
            ? `<img src="${escapeAttr(_authUserInfo.picture)}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;" />`
            : `<div style="width:56px;height:56px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:600;color:#fff;">${escapeHtml((_authUserInfo?.username || '?')[0].toUpperCase())}</div>`
          }
          <div class="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </div>
        </div>
        <div>
          <div class="text-primary font-semibold text-[0.95rem]">${escapeHtml(_authUserInfo?.username || '')}</div>
          <div class="text-dim text-[0.8rem]">${escapeHtml(_authUserInfo?.name || '')}</div>
          <div class="text-dim text-[0.75rem]">${escapeHtml(_authUserInfo?.email || '')}</div>
        </div>
      </div>
      <div class="flex items-center justify-between mt-4 mb-4">
        <div>
          <span class="text-primary text-sm">Private profile</span>
          <p class="text-dimmer text-[0.72rem] mt-0.5">Hide your profile from search and browse. Only teammates can see your full profile.</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" ${_authUserInfo?.profile_private ? 'checked' : ''} onchange="toggleProfilePrivacy(this.checked)">
          <span class="slider"></span>
        </label>
      </div>
      <div class="flex gap-2">
        <button onclick="_doLogout()" class="px-3 py-1 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-red-500 hover:text-red-400 cursor-pointer transition-colors">Sign Out</button>
        <button onclick="_doDeleteAccount()" class="px-3 py-1 rounded-md text-[0.78rem] border border-red-800/50 text-red-400/70 bg-card hover:border-red-500 hover:text-red-400 cursor-pointer transition-colors">Delete Account</button>
      </div>
    </div>
  `;
}

function _renderAppearanceSettings() {
  const currentTheme = localStorage.getItem('theme') || 'light';
  const currentAccent = localStorage.getItem('accentColor') || '#b4451a';
  const accentColors = [
    { color: '#b4451a', name: 'Orange' },
    { color: '#e53e3e', name: 'Red' },
    { color: '#d69e2e', name: 'Gold' },
    { color: '#38a169', name: 'Green' },
    { color: '#3182ce', name: 'Blue' },
    { color: '#805ad5', name: 'Purple' },
    { color: '#d53f8c', name: 'Pink' },
    { color: '#718096', name: 'Gray' },
    { color: '#111111', name: 'Black' },
  ];

  return `
    <!-- APPEARANCE -->
    <div class="mb-8">
      <h3 class="text-white_ text-sm font-semibold mb-3">Appearance</h3>
      <div class="flex items-center justify-between mb-4">
        <span class="text-primary text-sm">Theme</span>
        <div class="flex gap-1.5">
          <button onclick="setTheme('auto')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${currentTheme === 'auto' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}" id="theme-btn-auto">Auto</button>
          <button onclick="setTheme('dark')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${currentTheme === 'dark' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}" id="theme-btn-dark">Dark</button>
          <button onclick="setTheme('light')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${currentTheme === 'light' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}" id="theme-btn-light">Light</button>
          <button onclick="setTheme('sepia')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${currentTheme === 'sepia' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}" id="theme-btn-sepia">Sepia</button>
          <button onclick="setTheme('daylight')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${currentTheme === 'daylight' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}" id="theme-btn-daylight">Daylight</button>
          <button onclick="setTheme('thermal')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${currentTheme === 'thermal' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}" id="theme-btn-thermal">Thermal</button>
        </div>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-primary text-sm">Accent Color</span>
        <div class="flex gap-2">
          ${accentColors.map(a => `
            <button onclick="setAccentColor('${a.color}')" class="w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 ${currentAccent === a.color ? 'scale-110 ring-2 ring-offset-2' : ''}" style="background:${a.color}; ${currentAccent === a.color ? `--tw-ring-color:${a.color}; --tw-ring-offset-color: var(--bg-body)` : ''}" title="${a.name}"></button>
          `).join('')}
        </div>
      </div>
      <div class="flex items-center justify-between mt-4">
        <span class="text-primary text-sm">Editor Theme</span>
        <div class="flex gap-1.5" id="editor-theme-btns">
          ${['auto','monokai','dracula','solarized','github','nord'].map(t => {
            const cur = localStorage.getItem('editorTheme') || 'auto';
            const label = t.charAt(0).toUpperCase() + t.slice(1);
            return '<button onclick="setEditorTheme(\'' + t + '\')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' + (cur === t ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary') + '" id="editor-theme-btn-' + t + '">' + label + '</button>';
          }).join('')}
        </div>
      </div>
      <div class="flex items-center justify-between mt-4">
        <span class="text-primary text-sm">Loading Spinner</span>
        <div class="flex items-center gap-2">
          <button onclick="cycleSpinner(-1)" class="w-6 h-6 rounded flex items-center justify-center bg-transparent border border-border-input text-dimmer cursor-pointer hover:text-primary text-[0.75rem]">&lsaquo;</button>
          <div class="flex flex-col items-center min-w-[100px]">
            <div class="spinner-preview text-dim font-mono text-[1.2rem] h-6 flex items-center justify-center" id="spinner-preview"></div>
            <div class="text-[0.68rem] text-dimmer" id="spinner-name">${getSelectedSpinner()}</div>
          </div>
          <button onclick="cycleSpinner(1)" class="w-6 h-6 rounded flex items-center justify-center bg-transparent border border-border-input text-dimmer cursor-pointer hover:text-primary text-[0.75rem]">&rsaquo;</button>
        </div>
      </div>
      <div class="flex items-center justify-between mt-4">
        <span class="text-primary text-sm">Pixel Pet</span>
        <div class="flex items-center gap-2">
          <div class="flex gap-1">
            ${[['cat','cat'],['blackCat','black cat'],['dog','dog'],['poodle','poodle'],['bunny','bunny'],['froog','froog'],['pacman','pacman']].map(([t,label]) => {
              const petOn = localStorage.getItem('pixelPet') === 'on';
              const sel = petOn && (localStorage.getItem('pixelPetType') || 'cat') === t;
              return `<button onclick="togglePixelPet(true); setPixelPetType('${t}'); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">${label}</button>`;
            }).join('')}
            <button onclick="togglePixelPet(false); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${localStorage.getItem('pixelPet') !== 'on' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">none</button>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between mt-4">
        <span class="text-primary text-sm">White Noise</span>
        <div class="flex items-center gap-2">
          <span id="rain-volume-value" class="text-[0.7rem] text-dimmer font-mono cursor-ns-resize select-none" title="Drag up/down to adjust volume" onmousedown="_rainVolDragStart(event)">${Math.round(_rainVolume * 100)}%</span>
          <div class="flex gap-1">
            ${Object.entries(NOISE_PRESETS).map(([key, p]) => {
              const sel = isRainSidebarVisible() && _rainNoiseType === key;
              return `<button onclick="setRainSidebarVisible(true); setRainNoiseType('${key}'); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">${p.label}</button>`;
            }).join('')}
            <button onclick="setRainSidebarVisible(false); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${!isRainSidebarVisible() ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">none</button>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between mt-4">
        <span class="text-primary text-sm">Button Sounds</span>
        <div class="flex items-center gap-2">
          <div class="flex gap-1">
            ${Object.entries(CLICK_SOUND_PRESETS).map(([key, p]) => {
              const sel = _clickSoundOn && (localStorage.getItem('clickSoundType') || 'thud') === key;
              return `<button onclick="toggleClickSound(true); setClickSoundType('${key}'); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">${p.label}</button>`;
            }).join('')}
            <button onclick="toggleClickSound(false); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${!_clickSoundOn ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">none</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function _renderFeedSourceSettings() {
  return `
    <!-- PAPER INSIGHTS -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">Paper Insights</h3>
      <p class="text-dim text-[0.8rem] mb-3">Extracts key insights when viewing a paper. Uses local LLM (qwen2.5:3b).</p>
      <div class="flex items-center justify-between">
        <div>
          <span class="text-primary text-sm">Allow heuristics</span>
          <p class="text-dimmer text-[0.72rem] mt-0.5">Use regex/keyword matching for repos, hardware, and insight fallback</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="toggle-switch">
            <input type="checkbox" ${localStorage.getItem('insightsAllowHeuristics') !== 'false' ? 'checked' : ''} onchange="localStorage.setItem('insightsAllowHeuristics', this.checked)">
            <span class="slider"></span>
          </span>
        </label>
      </div>
    </div>

    <!-- CHAT TOOLS -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center justify-between mb-1">
        <div>
          <h3 class="text-white_ text-sm font-semibold">Chat Tools</h3>
          <p class="text-dim text-[0.8rem] mt-0.5">Let the chat assistant use tools autonomously. Requires qwen3:8b.</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="toggle-switch">
            <input type="checkbox" ${localStorage.getItem('chatTools') !== 'off' ? 'checked' : ''} onchange="localStorage.setItem('chatTools', this.checked ? 'on' : 'off')">
            <span class="slider"></span>
          </span>
        </label>
      </div>
    </div>

    <!-- CLICK AETHER -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-primary text-sm">Click Aether</span>
          <p class="text-dimmer text-[0.72rem] mt-0.5">Right-click anywhere to open an aether panel with chat and web search</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="toggle-switch">
            <input type="checkbox" ${localStorage.getItem('clickAether') !== 'off' ? 'checked' : ''} onchange="localStorage.setItem('clickAether', this.checked ? 'on' : 'off')">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <div class="flex items-center justify-between mt-4">
        <span class="text-primary text-sm">Panel Side</span>
        <div class="flex gap-1">
          <button onclick="localStorage.setItem('aetherPanelSide','left'); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${(localStorage.getItem('aetherPanelSide') || 'left') === 'left' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">Left</button>
          <button onclick="localStorage.setItem('aetherPanelSide','right'); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${(localStorage.getItem('aetherPanelSide') || 'left') === 'right' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">Right</button>
        </div>
      </div>
    </div>

    <!-- VAULT -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">Vault</h3>
      <p class="text-dim text-[0.8rem] mb-3">Set a custom folder for your notes. Uses ~/Documents/Vault by default.</p>
      <div class="flex items-center gap-2">
        <input type="text" id="vault-path-input" class="flex-1 px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary placeholder:text-dimmer outline-none focus:border-accent" placeholder="Loading...">
        <button onclick="saveVaultPath()" class="px-3 py-1.5 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-accent hover:text-primary cursor-pointer transition-colors">Save</button>
        <button onclick="resetVaultPath()" class="px-3 py-1.5 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-accent hover:text-primary cursor-pointer transition-colors">Reset</button>
      </div>
      <div id="vault-path-status" class="text-[0.75rem] mt-2 text-dimmer"></div>
    </div>

    <!-- AD BLOCKER -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center gap-3 mb-1">
        <h3 class="text-white_ text-sm font-semibold">Ad Blocker</h3>
        <label class="flex items-center gap-2 cursor-pointer ml-auto">
          <span class="text-primary text-sm">Enable</span>
          <span class="toggle-switch">
            <input type="checkbox" id="toggle-adblock" ${localStorage.getItem('adBlockEnabled') === 'true' ? 'checked' : ''} onchange="setAdBlockEnabled(this.checked)">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <p class="text-dim text-[0.8rem] mb-3">Strips ads, tracking scripts, and sponsored content from pages in the browse tab via a server-side proxy.</p>
      <div id="adblock-rules-info" class="text-dimmer text-[0.75rem] mb-3">Loading filter info...</div>
      <button onclick="resetAdBlockRules()" class="text-dim text-[0.78rem] hover:text-primary bg-transparent border border-border-input hover:border-accent rounded-md px-3 py-1 cursor-pointer transition-colors">Update filter lists</button>
    </div>

    <!-- SITE PERMISSIONS -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">Site Permissions</h3>
      <p class="text-dim text-[0.8rem] mb-3">Manage camera, microphone, location, notification, and pop-up permissions per site.</p>
      <div id="settings-site-permissions">${_renderSettingsSitePermissions()}</div>
    </div>
  `;
}

let _expandedPermDomain = null;

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
    html += '<div style="border:1px solid var(--border-input);border-radius:8px;margin-bottom:6px;overflow:hidden;">';
    html += '<div style="display:flex;align-items:center;padding:8px 12px;cursor:pointer;gap:8px;" onclick="_expandedPermDomain=(_expandedPermDomain===\'' + safeDomain + '\'?null:\'' + safeDomain + '\');document.getElementById(\'settings-site-permissions\').innerHTML=_renderSettingsSitePermissions();">';
    html += '<svg style="width:12px;height:12px;color:var(--text-dimmer);transition:transform 0.15s;' + (isExpanded ? 'transform:rotate(90deg);' : '') + '" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>';
    html += '<span style="flex:1;font-size:0.8rem;color:var(--text-primary);font-weight:500;">' + escapeHtml(domain) + '</span>';
    html += '<span style="font-size:0.68rem;color:var(--text-dimmer);">' + count + ' permission' + (count !== 1 ? 's' : '') + '</span>';
    html += '<button onclick="event.stopPropagation(); _clearSitePermissions(\'' + safeDomain + '\'); document.getElementById(\'settings-site-permissions\').innerHTML=_renderSettingsSitePermissions();" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-dim);font-size:0.7rem;cursor:pointer;">Clear</button>';
    html += '</div>';
    if (isExpanded) {
      html += '<div style="padding:0 12px 8px;border-top:1px solid var(--border-subtle);">';
      for (const key of _SITE_PERM_KEYS) {
        const current = perms[key] || 'ask';
        const label = _SITE_PERM_LABELS[key];
        const icon = _SITE_PERM_ICONS[key];
        html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">';
        html += '<span style="color:var(--text-dimmer);flex-shrink:0;">' + icon + '</span>';
        html += '<span style="flex:1;font-size:0.78rem;color:var(--text-primary);">' + label + '</span>';
        html += '<div style="display:flex;border-radius:6px;overflow:hidden;border:1px solid var(--border-input);">';
        for (const val of ['ask', 'allow', 'block']) {
          const active = current === val;
          const bg = active ? (val === 'allow' ? 'color-mix(in srgb, #22c55e 20%, var(--bg-card))' : val === 'block' ? 'color-mix(in srgb, #ef4444 20%, var(--bg-card))' : 'color-mix(in srgb, var(--accent) 20%, var(--bg-card))') : 'var(--bg-card)';
          const fg = active ? (val === 'allow' ? '#22c55e' : val === 'block' ? '#ef4444' : 'var(--accent)') : 'var(--text-dimmer)';
          html += '<button onclick="_setSitePermission(\'' + safeDomain + '\',\'' + key + '\',\'' + val + '\'); document.getElementById(\'settings-site-permissions\').innerHTML=_renderSettingsSitePermissions();" style="padding:2px 8px;font-size:0.68rem;border:none;cursor:pointer;background:' + bg + ';color:' + fg + ';font-weight:' + (active ? '600' : '400') + ';text-transform:capitalize;">' + val + '</button>';
        }
        html += '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  return html;
}

function renderSettingsView() {
  const container = document.getElementById('settings-view-content');

  container.innerHTML = `
    <h2 class="text-[1.3rem] font-semibold text-white_ mb-6">Settings</h2>

    <!-- HELP POINTER -->
    <div class="mb-6 p-3 rounded-lg border border-border-subtle bg-card/50">
      <div class="flex items-center gap-2 text-[0.8rem]">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span class="text-primary">Right-click anywhere and type <kbd class="kbd-key" style="font-size:0.7rem">/help</kbd> to see all commands, instant answers & shortcuts.</span>
      </div>
    </div>

    ${_renderAccountSettings()}
    ${_renderAppearanceSettings()}
    ${_renderFeedSourceSettings()}

    <div id="settings-version" class="mt-6 text-center" style="color:var(--text-dimmer);font-size:0.65rem"></div>
  `;

  // Load version
  fetch('/api/version').then(r => r.json()).then(v => {
    const el = document.getElementById('settings-version');
    if (el && v.version) el.textContent = 'v' + v.version + (v.sha ? ' (' + v.sha + ')' : '');
  }).catch(() => {});

  // Load adblock filter list info
  fetch('/api/adblock-rules').then(r => r.json()).then(stats => {
    const el = document.getElementById('adblock-rules-info');
    if (!el) return;
    if (stats.lists && stats.lists.length > 0) {
      const count = (stats.ruleCount || 0).toLocaleString();
      el.textContent = `${stats.lists.join(' + ')}: ${count} rules loaded.`;
    } else {
      el.textContent = 'No filter lists loaded yet. Click "Update filter lists" to download.';
    }
  }).catch(() => {});
  // Start spinner preview
  updateSpinnerPreview(getSelectedSpinner());
  // Load vault path
  loadVaultPath();
}

async function loadVaultPath() {
  const input = document.getElementById('vault-path-input');
  const status = document.getElementById('vault-path-status');
  if (!input) return;
  try {
    const res = await fetch('/api/vault/path', { headers: _authHeaders() });
    if (res.ok) {
      const data = await res.json();
      input.value = data.path || '';
      input.placeholder = data.default || '';
      if (status) {
        status.textContent = data.isCustom ? 'Using custom path' : 'Using default path';
        status.className = 'text-[0.75rem] mt-2 ' + (data.isCustom ? 'text-accent' : 'text-dimmer');
      }
    }
  } catch (e) {
    if (status) status.textContent = 'Failed to load vault path';
  }
}

async function saveVaultPath() {
  const input = document.getElementById('vault-path-input');
  const status = document.getElementById('vault-path-status');
  if (!input) return;
  const path = input.value.trim();
  try {
    const res = await fetch('/api/vault/path', {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (res.ok) {
      input.value = data.path || '';
      if (status) {
        status.textContent = data.message;
        status.className = 'text-[0.75rem] mt-2 text-green-500';
      }
      // Reload vault if open
      if (window.location.hash === '#vault') {
        loadVaultNotes();
        renderVaultFileTree();
      }
    } else {
      if (status) {
        status.textContent = data.error || 'Failed to save';
        status.className = 'text-[0.75rem] mt-2 text-red-400';
      }
    }
  } catch (e) {
    if (status) {
      status.textContent = 'Failed to save vault path';
      status.className = 'text-[0.75rem] mt-2 text-red-400';
    }
  }
}

async function resetVaultPath() {
  const input = document.getElementById('vault-path-input');
  const status = document.getElementById('vault-path-status');
  try {
    const res = await fetch('/api/vault/path', {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '' })
    });
    const data = await res.json();
    if (res.ok) {
      loadVaultPath();
      if (status) {
        status.textContent = 'Reset to default';
        status.className = 'text-[0.75rem] mt-2 text-green-500';
      }
      // Reload vault if open
      if (window.location.hash === '#vault') {
        loadVaultNotes();
        renderVaultFileTree();
      }
    }
  } catch (e) {
    if (status) {
      status.textContent = 'Failed to reset';
      status.className = 'text-[0.75rem] mt-2 text-red-400';
    }
  }
}

// Map each theme to its underlying color scheme (dark or light)
const THEME_COLOR_SCHEME = {
  dark: 'dark',
  light: 'light',
  sepia: 'light',
  daylight: 'light',
  thermal: 'dark',
};

function _systemColorScheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getThemeColorScheme() {
  const theme = localStorage.getItem('theme') || 'light';
  if (theme === 'auto') return _systemColorScheme();
  return THEME_COLOR_SCHEME[theme] || 'light';
}

// Resolve 'auto' to the actual theme name based on system preference
function _resolveAutoTheme() {
  return _systemColorScheme() === 'dark' ? 'dark' : 'light';
}

// Apply the resolved theme to the DOM (shared by setTheme and the system listener)
function _applyResolvedTheme(resolved) {
  stopDaylightTheme();
  if (resolved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else if (resolved === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', resolved);
  }
  if (resolved === 'daylight') startDaylightTheme();
  if (typeof _browseRefreshScheme === 'function') _browseRefreshScheme();
}


// Listen for system color scheme changes to update 'auto' theme in real time
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('theme') || 'light') === 'auto') {
    _applyResolvedTheme(_resolveAutoTheme());
  }
});

function setTheme(theme) {
  localStorage.setItem('theme', theme);
  const resolved = theme === 'auto' ? _resolveAutoTheme() : theme;
  _applyResolvedTheme(resolved);
  ['auto', 'dark', 'light', 'sepia', 'daylight', 'thermal'].forEach(t => {
    const btn = document.getElementById('theme-btn-' + t);
    if (btn) btn.className = `px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${theme === t ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}`;
  });
}

function setAdBlockEnabled(on) {
  localStorage.setItem('adBlockEnabled', on ? 'true' : 'false');
  if (typeof _browseUpdateAdBlockBtn === 'function') _browseUpdateAdBlockBtn();
}


async function toggleProfilePrivacy(on) {
  try {
    const resp = await fetch('/api/users/me/privacy', {
      method: 'PUT',
      headers: _authHeaders(),
      body: JSON.stringify({ profile_private: on })
    });
    if (resp.ok && _authUserInfo) {
      _authUserInfo.profile_private = on;
    }
  } catch (err) { /* ignore */ }
}

function resetAdBlockRules() {
  const el = document.getElementById('adblock-rules-info');
  if (el) el.textContent = 'Updating filter lists...';
  fetch('/api/adblock-rules/reset', { method: 'POST' })
    .then(r => r.json())
    .then(stats => {
      if (!el) return;
      if (stats.lists && stats.lists.length > 0) {
        const count = (stats.ruleCount || 0).toLocaleString();
        el.textContent = `${stats.lists.join(' + ')}: ${count} rules loaded.`;
      } else {
        el.textContent = 'Failed to download filter lists.';
      }
    }).catch(() => { if (el) el.textContent = 'Error updating filter lists.'; });
}

function setEditorTheme(theme) {
  localStorage.setItem('editorTheme', theme);
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-editor-theme');
  } else {
    document.documentElement.setAttribute('data-editor-theme', theme);
  }
  ['auto','monokai','dracula','solarized','github','nord'].forEach(t => {
    const btn = document.getElementById('editor-theme-btn-' + t);
    if (btn) btn.className = 'px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' + (theme === t ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary');
  });
}

/* ── Daylight Theme Engine ── */
var _daylightInterval = null;
var _daylightSpeedMultiplier = 1; // set to 1440 in console for fast-forward (1 day = 1 min)

// OKLCH→sRGB conversion
function _oklchToHex(L, C, H) {
  const hRad = H * Math.PI / 180;
  const a_ = C * Math.cos(hRad), b_ = C * Math.sin(hRad);
  // OKLab → linear sRGB
  const l_ = L + 0.3963377774 * a_ + 0.2158037573 * b_;
  const m_ = L - 0.1055613458 * a_ - 0.0638541728 * b_;
  const s_ = L - 0.0894841775 * a_ - 1.2914855480 * b_;
  const l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_;
  let r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  let b = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;
  // Linear sRGB → gamma sRGB
  const gamma = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  r = Math.round(Math.max(0, Math.min(1, gamma(r))) * 255);
  g = Math.round(Math.max(0, Math.min(1, gamma(g))) * 255);
  b = Math.round(Math.max(0, Math.min(1, gamma(b))) * 255);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function _lerpOklch(a, b, t) {
  // Lerp L, C linearly; lerp H on shortest arc
  const L = a[0] + (b[0] - a[0]) * t;
  const C = a[1] + (b[1] - a[1]) * t;
  let dH = b[2] - a[2];
  if (dH > 180) dH -= 360; else if (dH < -180) dH += 360;
  const H = (a[2] + dH * t + 360) % 360;
  return [L, C, H];
}

// 6 keyframes: [hour, { cssVar: [L,C,H], ... }]
// Special keys ending in '$a' are rgba alpha values (0-1)
var _daylightKeyframes = [
  [5, { // Dawn — warm rose-gray
    '--bg-body':       [0.30, 0.02, 30],
    '--text-primary':  [0.85, 0.01, 60],
    '--text-white':    [0.92, 0.005, 60],
    '--text-muted':    [0.65, 0.01, 50],
    '--text-dim':      [0.55, 0.01, 40],
    '--text-dimmer':   [0.48, 0.01, 40],
    '--text-dimmest':  [0.40, 0.01, 40],
    '--bg-sidebar':    [0.25, 0.02, 30],
    '--border-sidebar':[0.22, 0.015, 30],
    '--bg-hover':      [0.28, 0.02, 30],
    '--bg-card':       [0.27, 0.02, 30],
    '--bg-input':      [0.24, 0.02, 30],
    '--bg-input-alt':  [0.27, 0.02, 30],
    '--border-card':   [0.32, 0.015, 30],
    '--border-input':  [0.38, 0.015, 35],
    '--border-subtle': [0.30, 0.015, 30],
    '--border-dim':    [0.24, 0.015, 30],
    '--bg-header':     [0.25, 0.02, 30],
    '--bg-canvas':     [0.28, 0.02, 30],
    '--bg-popup':      [0.26, 0.02, 30],
    '--bg-chip-count': [0.24, 0.02, 30],
    '--bg-cat-tag':    [0.24, 0.02, 30],
    '--bg-cat-tag-color':[0.65, 0.01, 50],
    '--bg-cite':       [0.28, 0.03, 50],
    '--bg-sidebar-cat':[0.28, 0.02, 30],
    '--sidebar-cat-border':[0.32, 0.015, 30],
    '--sidebar-cat-color':[0.65, 0.01, 50],
    '--text-link':     [0.65, 0.12, 50],
    '--text-summary':  [0.65, 0.01, 50],
    '--text-authors':  [0.60, 0.01, 50],
    '--text-meta-value':[0.75, 0.01, 55],
    '--text-idea-desc':[0.75, 0.01, 55],
    '--tree-edge':     [0.38, 0.015, 35],
    '--spinner-border':[0.38, 0.015, 35],
    '--tooltip-bg':    [0.26, 0.02, 30],
    '--tooltip-border':[0.32, 0.015, 30],
    '--shadow-card$a':  0.25,
    '--shadow-popup$a': 0.40,
    '--overlay-bg$a':   0.45,
  }],
  [8, { // Morning — warm cream
    '--bg-body':       [0.92, 0.02, 80],
    '--text-primary':  [0.25, 0.02, 50],
    '--text-white':    [0.15, 0.02, 50],
    '--text-muted':    [0.50, 0.02, 55],
    '--text-dim':      [0.60, 0.02, 60],
    '--text-dimmer':   [0.65, 0.015, 60],
    '--text-dimmest':  [0.72, 0.01, 65],
    '--bg-sidebar':    [0.90, 0.02, 78],
    '--border-sidebar':[0.85, 0.02, 75],
    '--bg-hover':      [0.88, 0.02, 78],
    '--bg-card':       [0.90, 0.02, 78],
    '--bg-input':      [0.88, 0.02, 78],
    '--bg-input-alt':  [0.90, 0.02, 78],
    '--border-card':   [0.82, 0.02, 72],
    '--border-input':  [0.75, 0.02, 68],
    '--border-subtle': [0.85, 0.02, 75],
    '--border-dim':    [0.88, 0.015, 78],
    '--bg-header':     [0.90, 0.02, 78],
    '--bg-canvas':     [0.91, 0.02, 79],
    '--bg-popup':      [0.90, 0.02, 78],
    '--bg-chip-count': [0.88, 0.02, 78],
    '--bg-cat-tag':    [0.88, 0.02, 78],
    '--bg-cat-tag-color':[0.50, 0.02, 55],
    '--bg-cite':       [0.92, 0.03, 70],
    '--bg-sidebar-cat':[0.88, 0.02, 78],
    '--sidebar-cat-border':[0.82, 0.02, 72],
    '--sidebar-cat-color':[0.50, 0.02, 55],
    '--text-link':     [0.50, 0.12, 45],
    '--text-summary':  [0.50, 0.02, 55],
    '--text-authors':  [0.55, 0.02, 58],
    '--text-meta-value':[0.40, 0.02, 50],
    '--text-idea-desc':[0.40, 0.02, 50],
    '--tree-edge':     [0.75, 0.02, 68],
    '--spinner-border':[0.75, 0.02, 68],
    '--tooltip-bg':    [0.90, 0.02, 78],
    '--tooltip-border':[0.82, 0.02, 72],
    '--shadow-card$a':  0.06,
    '--shadow-popup$a': 0.12,
    '--overlay-bg$a':   0.22,
  }],
  [12, { // Midday — bright neutral
    '--bg-body':       [0.96, 0.005, 250],
    '--text-primary':  [0.20, 0.01, 260],
    '--text-white':    [0.12, 0.01, 260],
    '--text-muted':    [0.48, 0.01, 255],
    '--text-dim':      [0.58, 0.008, 255],
    '--text-dimmer':   [0.64, 0.006, 255],
    '--text-dimmest':  [0.72, 0.005, 255],
    '--bg-sidebar':    [0.94, 0.005, 250],
    '--border-sidebar':[0.88, 0.005, 250],
    '--bg-hover':      [0.92, 0.005, 250],
    '--bg-card':       [0.94, 0.005, 250],
    '--bg-input':      [0.92, 0.005, 250],
    '--bg-input-alt':  [0.94, 0.005, 250],
    '--border-card':   [0.85, 0.005, 250],
    '--border-input':  [0.78, 0.008, 250],
    '--border-subtle': [0.88, 0.005, 250],
    '--border-dim':    [0.91, 0.004, 250],
    '--bg-header':     [0.94, 0.005, 250],
    '--bg-canvas':     [0.95, 0.005, 250],
    '--bg-popup':      [0.94, 0.005, 250],
    '--bg-chip-count': [0.92, 0.005, 250],
    '--bg-cat-tag':    [0.92, 0.005, 250],
    '--bg-cat-tag-color':[0.48, 0.01, 255],
    '--bg-cite':       [0.95, 0.02, 70],
    '--bg-sidebar-cat':[0.92, 0.005, 250],
    '--sidebar-cat-border':[0.85, 0.005, 250],
    '--sidebar-cat-color':[0.48, 0.01, 255],
    '--text-link':     [0.52, 0.14, 30],
    '--text-summary':  [0.48, 0.01, 255],
    '--text-authors':  [0.52, 0.01, 255],
    '--text-meta-value':[0.38, 0.01, 255],
    '--text-idea-desc':[0.38, 0.01, 255],
    '--tree-edge':     [0.78, 0.008, 250],
    '--spinner-border':[0.78, 0.008, 250],
    '--tooltip-bg':    [0.94, 0.005, 250],
    '--tooltip-border':[0.85, 0.005, 250],
    '--shadow-card$a':  0.05,
    '--shadow-popup$a': 0.10,
    '--overlay-bg$a':   0.20,
  }],
  [17, { // Golden hour — warm honey
    '--bg-body':       [0.90, 0.03, 75],
    '--text-primary':  [0.20, 0.02, 50],
    '--text-white':    [0.12, 0.02, 50],
    '--text-muted':    [0.42, 0.02, 55],
    '--text-dim':      [0.52, 0.02, 60],
    '--text-dimmer':   [0.60, 0.015, 60],
    '--text-dimmest':  [0.68, 0.01, 65],
    '--bg-sidebar':    [0.87, 0.03, 72],
    '--border-sidebar':[0.82, 0.025, 70],
    '--bg-hover':      [0.85, 0.03, 72],
    '--bg-card':       [0.87, 0.03, 72],
    '--bg-input':      [0.85, 0.03, 72],
    '--bg-input-alt':  [0.87, 0.03, 72],
    '--border-card':   [0.78, 0.025, 68],
    '--border-input':  [0.72, 0.025, 65],
    '--border-subtle': [0.82, 0.025, 70],
    '--border-dim':    [0.86, 0.02, 72],
    '--bg-header':     [0.87, 0.03, 72],
    '--bg-canvas':     [0.88, 0.03, 74],
    '--bg-popup':      [0.87, 0.03, 72],
    '--bg-chip-count': [0.85, 0.03, 72],
    '--bg-cat-tag':    [0.85, 0.03, 72],
    '--bg-cat-tag-color':[0.50, 0.02, 55],
    '--bg-cite':       [0.90, 0.04, 65],
    '--bg-sidebar-cat':[0.85, 0.03, 72],
    '--sidebar-cat-border':[0.78, 0.025, 68],
    '--sidebar-cat-color':[0.50, 0.02, 55],
    '--text-link':     [0.48, 0.13, 40],
    '--text-summary':  [0.42, 0.02, 55],
    '--text-authors':  [0.48, 0.02, 58],
    '--text-meta-value':[0.32, 0.02, 50],
    '--text-idea-desc':[0.32, 0.02, 50],
    '--tree-edge':     [0.72, 0.025, 65],
    '--spinner-border':[0.72, 0.025, 65],
    '--tooltip-bg':    [0.87, 0.03, 72],
    '--tooltip-border':[0.78, 0.025, 68],
    '--shadow-card$a':  0.08,
    '--shadow-popup$a': 0.15,
    '--overlay-bg$a':   0.25,
  }],
  [19, { // Dusk — soft peach-gray
    '--bg-body':       [0.50, 0.03, 40],
    '--text-primary':  [0.90, 0.01, 55],
    '--text-white':    [0.95, 0.005, 55],
    '--text-muted':    [0.75, 0.015, 48],
    '--text-dim':      [0.65, 0.015, 45],
    '--text-dimmer':   [0.58, 0.012, 42],
    '--text-dimmest':  [0.50, 0.01, 40],
    '--bg-sidebar':    [0.45, 0.03, 38],
    '--border-sidebar':[0.40, 0.025, 38],
    '--bg-hover':      [0.48, 0.03, 40],
    '--bg-card':       [0.47, 0.03, 38],
    '--bg-input':      [0.44, 0.03, 38],
    '--bg-input-alt':  [0.47, 0.03, 38],
    '--border-card':   [0.52, 0.025, 42],
    '--border-input':  [0.56, 0.02, 44],
    '--border-subtle': [0.48, 0.025, 40],
    '--border-dim':    [0.43, 0.02, 38],
    '--bg-header':     [0.45, 0.03, 38],
    '--bg-canvas':     [0.48, 0.03, 39],
    '--bg-popup':      [0.46, 0.03, 38],
    '--bg-chip-count': [0.44, 0.03, 38],
    '--bg-cat-tag':    [0.44, 0.03, 38],
    '--bg-cat-tag-color':[0.75, 0.015, 48],
    '--bg-cite':       [0.48, 0.04, 50],
    '--bg-sidebar-cat':[0.48, 0.03, 40],
    '--sidebar-cat-border':[0.52, 0.025, 42],
    '--sidebar-cat-color':[0.75, 0.015, 48],
    '--text-link':     [0.72, 0.12, 45],
    '--text-summary':  [0.75, 0.015, 48],
    '--text-authors':  [0.70, 0.015, 46],
    '--text-meta-value':[0.82, 0.01, 52],
    '--text-idea-desc':[0.82, 0.01, 52],
    '--tree-edge':     [0.56, 0.02, 44],
    '--spinner-border':[0.56, 0.02, 44],
    '--tooltip-bg':    [0.46, 0.03, 38],
    '--tooltip-border':[0.52, 0.025, 42],
    '--shadow-card$a':  0.20,
    '--shadow-popup$a': 0.35,
    '--overlay-bg$a':   0.40,
  }],
  [22, { // Night — deep blue-black
    '--bg-body':       [0.18, 0.02, 260],
    '--text-primary':  [0.78, 0.01, 250],
    '--text-white':    [0.88, 0.005, 250],
    '--text-muted':    [0.55, 0.01, 255],
    '--text-dim':      [0.45, 0.01, 255],
    '--text-dimmer':   [0.38, 0.01, 255],
    '--text-dimmest':  [0.32, 0.01, 255],
    '--bg-sidebar':    [0.15, 0.02, 260],
    '--border-sidebar':[0.20, 0.015, 260],
    '--bg-hover':      [0.22, 0.02, 260],
    '--bg-card':       [0.20, 0.02, 260],
    '--bg-input':      [0.17, 0.02, 260],
    '--bg-input-alt':  [0.20, 0.02, 260],
    '--border-card':   [0.25, 0.015, 260],
    '--border-input':  [0.30, 0.015, 258],
    '--border-subtle': [0.22, 0.015, 260],
    '--border-dim':    [0.19, 0.015, 260],
    '--bg-header':     [0.15, 0.02, 260],
    '--bg-canvas':     [0.16, 0.02, 260],
    '--bg-popup':      [0.19, 0.02, 260],
    '--bg-chip-count': [0.17, 0.02, 260],
    '--bg-cat-tag':    [0.17, 0.02, 260],
    '--bg-cat-tag-color':[0.55, 0.01, 255],
    '--bg-cite':       [0.20, 0.03, 40],
    '--bg-sidebar-cat':[0.22, 0.02, 260],
    '--sidebar-cat-border':[0.25, 0.015, 260],
    '--sidebar-cat-color':[0.55, 0.01, 255],
    '--text-link':     [0.62, 0.10, 250],
    '--text-summary':  [0.55, 0.01, 255],
    '--text-authors':  [0.50, 0.01, 255],
    '--text-meta-value':[0.68, 0.01, 252],
    '--text-idea-desc':[0.68, 0.01, 252],
    '--tree-edge':     [0.30, 0.015, 258],
    '--spinner-border':[0.30, 0.015, 258],
    '--tooltip-bg':    [0.19, 0.02, 260],
    '--tooltip-border':[0.25, 0.015, 260],
    '--shadow-card$a':  0.30,
    '--shadow-popup$a': 0.50,
    '--overlay-bg$a':   0.50,
  }],
];

function _getDaylightHour() {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

function _applyDaylightColors() {
  const kf = _daylightKeyframes;
  let h = _getDaylightHour();
  // Allow speed multiplier for testing
  if (_daylightSpeedMultiplier !== 1) {
    if (!window._daylightStartReal) window._daylightStartReal = Date.now();
    const elapsedMs = Date.now() - window._daylightStartReal;
    const elapsedHours = (elapsedMs / 1000 / 3600) * _daylightSpeedMultiplier;
    h = (new Date().getHours() + new Date().getMinutes() / 60 + elapsedHours) % 24;
  }

  // Find surrounding keyframes (wraps around midnight)
  let iA = kf.length - 1, iB = 0;
  for (let i = 0; i < kf.length; i++) {
    if (h < kf[i][0]) { iB = i; iA = (i - 1 + kf.length) % kf.length; break; }
    if (i === kf.length - 1) { iA = i; iB = 0; }
  }

  const hA = kf[iA][0], hB = kf[iB][0];
  let span = hB - hA;
  if (span <= 0) span += 24;
  let progress = h - hA;
  if (progress < 0) progress += 24;
  const t = span === 0 ? 0 : progress / span;

  const vA = kf[iA][1], vB = kf[iB][1];
  const el = document.documentElement;

  // First pass: interpolate all values and collect lightness for bg-body
  const lerped = {};
  let bgL = 0.5;
  for (const key of Object.keys(vA)) {
    if (key.endsWith('$a')) {
      lerped[key] = vA[key] + (vB[key] - vA[key]) * t;
    } else {
      lerped[key] = _lerpOklch(vA[key], vB[key], t);
      if (key === '--bg-body') bgL = lerped[key][0];
    }
  }

  // Second pass: enforce text contrast against bg-body
  // Text variables that must be readable against the background
  const _textKeys = {
    '--text-primary': 0.55, '--text-white': 0.65, '--text-muted': 0.35,
    '--text-dim': 0.25, '--text-dimmer': 0.18, '--text-dimmest': 0.12,
    '--text-link': 0.35, '--text-summary': 0.35, '--text-authors': 0.30,
    '--text-meta-value': 0.40, '--text-idea-desc': 0.40,
    '--bg-cat-tag-color': 0.30, '--sidebar-cat-color': 0.30,
  };
  for (const [key, minGap] of Object.entries(_textKeys)) {
    if (!lerped[key]) continue;
    const tL = lerped[key][0];
    const gap = Math.abs(tL - bgL);
    if (gap < minGap) {
      // Push text to the opposite side of bg
      if (bgL > 0.5) {
        lerped[key] = [bgL - minGap, lerped[key][1], lerped[key][2]];
      } else {
        lerped[key] = [bgL + minGap, lerped[key][1], lerped[key][2]];
      }
    }
  }

  // Apply
  for (const key of Object.keys(vA)) {
    if (key.endsWith('$a')) {
      const alpha = lerped[key];
      const cssVar = key.slice(0, -2);
      if (cssVar === '--shadow-card') el.style.setProperty(cssVar, `rgba(0,0,0,${alpha.toFixed(3)})`);
      else if (cssVar === '--shadow-popup') el.style.setProperty(cssVar, `rgba(0,0,0,${alpha.toFixed(3)})`);
      else if (cssVar === '--overlay-bg') el.style.setProperty(cssVar, `rgba(0,0,0,${alpha.toFixed(3)})`);
    } else {
      el.style.setProperty(key, _oklchToHex(lerped[key][0], lerped[key][1], lerped[key][2]));
    }
  }
}

function startDaylightTheme() {
  stopDaylightTheme();
  document.documentElement.setAttribute('data-theme', 'daylight');
  _applyDaylightColors();
  _daylightInterval = setInterval(_applyDaylightColors, 60000);
}

function stopDaylightTheme() {
  if (_daylightInterval) { clearInterval(_daylightInterval); _daylightInterval = null; }
  window._daylightStartReal = null;
  // Remove all inline style properties set by daylight
  const el = document.documentElement;
  const kf0 = _daylightKeyframes[0][1];
  for (const key of Object.keys(kf0)) {
    const cssVar = key.endsWith('$a') ? key.slice(0, -2) : key;
    el.style.removeProperty(cssVar);
  }
}

function setAccentColor(color) {
  localStorage.setItem('accentColor', color);
  applyAccentColor(color);
  // Update swatch rings
  document.querySelectorAll('[onclick^="setAccentColor"]').forEach(btn => {
    const isActive = btn.getAttribute('onclick') === `setAccentColor('${color}')`;
    btn.className = `w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 ${isActive ? 'scale-110 ring-2 ring-offset-2' : ''}`;
    if (isActive) {
      btn.style.setProperty('--tw-ring-color', color);
      btn.style.setProperty('--tw-ring-offset-color', 'var(--bg-body)');
    } else {
      btn.style.removeProperty('--tw-ring-color');
      btn.style.removeProperty('--tw-ring-offset-color');
    }
  });
}

let _spinnerPreviewInterval = null;

function cycleSpinner(dir) {
  if (!_spinnerData || !_spinnerNames.length) return;
  const current = getSelectedSpinner();
  let idx = _spinnerNames.indexOf(current);
  if (idx === -1) idx = 0;
  idx = (idx + dir + _spinnerNames.length) % _spinnerNames.length;
  const name = _spinnerNames[idx];
  setSelectedSpinner(name);
  updateSpinnerPreview(name);
}

function updateSpinnerPreview(name) {
  const el = document.getElementById('spinner-preview');
  const nameEl = document.getElementById('spinner-name');
  if (!el || !_spinnerData) return;
  if (nameEl) nameEl.textContent = name;
  const spinner = _spinnerData[name];
  if (!spinner) return;
  if (_spinnerPreviewInterval) clearInterval(_spinnerPreviewInterval);
  let i = 0;
  el.textContent = spinner.frames[0];
  _spinnerPreviewInterval = setInterval(() => {
    i = (i + 1) % spinner.frames.length;
    el.textContent = spinner.frames[i];
  }, spinner.interval);
}

function applyAccentColor(color) {
  // Compute a lighter hover variant
  const r = parseInt(color.slice(1,3), 16), g = parseInt(color.slice(3,5), 16), b = parseInt(color.slice(5,7), 16);
  const hover = '#' + [Math.min(255, r + 20), Math.min(255, g + 20), Math.min(255, b + 20)].map(v => v.toString(16).padStart(2, '0')).join('');
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-hover', hover);
}

function applyStoredAppearance() {
  const theme = localStorage.getItem('theme') || 'light';
  const resolved = theme === 'auto' ? _resolveAutoTheme() : theme;
  if (resolved !== 'dark') document.documentElement.setAttribute('data-theme', resolved);
  else document.documentElement.removeAttribute('data-theme');
  if (resolved === 'daylight') startDaylightTheme();
  const accent = localStorage.getItem('accentColor');
  if (accent) applyAccentColor(accent);
  const edTheme = localStorage.getItem('editorTheme');
  if (edTheme && edTheme !== 'auto') document.documentElement.setAttribute('data-editor-theme', edTheme);
}

applyStoredAppearance();
