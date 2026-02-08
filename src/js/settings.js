let _settingsSection = sessionStorage.getItem('settingsSection') || 'profile';

const _SETTINGS_SECTIONS = [
  { key: 'profile', label: 'Profile', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"/></svg>' },
  { key: 'appearance', label: 'Appearance', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z"/></svg>' },
  { key: 'feed', label: 'Feed & Reading', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z"/></svg>' },
  { key: 'tools', label: 'Tools', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17l-5.1 5.1a2.121 2.121 0 01-3-3l5.1-5.1m0 0L4.16 7.91a2.13 2.13 0 010-3.01l.7-.7a2.13 2.13 0 013.01 0l4.26 4.26m-1.71 6.71l6.71-6.71m0 0l4.26 4.26a2.13 2.13 0 010 3.01l-.7.7a2.13 2.13 0 01-3.01 0l-4.26-4.26m1.71-6.71L16.42 3a2.121 2.121 0 013 3l-5.17 5.17"/></svg>' },
  { key: 'browser', label: 'Browser', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"/></svg>' },
  { key: 'panel', label: 'Lookup Panel', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"/></svg>' },
  { key: 'help', label: 'Help', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"/></svg>' },
];

let _settingsFeedTab = 'insights';

function _setSettingsSection(section) {
  _settingsSection = section;
  sessionStorage.setItem('settingsSection', section);
  renderSettingsView();
}

function _setSettingsFeedTab(tab) {
  _settingsFeedTab = tab;
  renderSettingsView();
}

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
        <span class="text-primary text-sm">Aether</span>
        <div class="flex gap-2">
          ${[
            { color: '#000000', name: 'Black' },
            { color: '#0a0a0a', name: 'Charcoal' },
            { color: '#111111', name: 'Dark Gray' },
            { color: '#1a1a2e', name: 'Midnight' },
            { color: '#0d1117', name: 'GitHub Dark' },
            { color: '#1e1e2e', name: 'Catppuccin' },
            { color: '#2d1b00', name: 'Espresso' },
            { color: '#0b1215', name: 'Deep Ocean' },
            { color: '#1a0a2e', name: 'Grape' },
          ].map(a => {
            const cur = localStorage.getItem('aetherColor') || '#000';
            const sel = cur === a.color || (a.color === '#000000' && (cur === '#000' || !localStorage.getItem('aetherColor')));
            return '<button onclick="setAetherColor(\'' + a.color + '\')" class="w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 ' + (sel ? 'scale-110 ring-2 ring-offset-2' : '') + '" style="background:' + a.color + '; border: 1px solid rgba(255,255,255,0.15);' + (sel ? '--tw-ring-color:var(--accent); --tw-ring-offset-color: var(--bg-body)' : '') + '" title="' + a.name + '"></button>';
          }).join('')}
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
        <span class="text-primary text-sm">Icon Size</span>
        <div class="flex gap-1.5">
          ${['small','medium','large'].map(s => {
            const cur = localStorage.getItem('iconSize') || 'medium';
            const label = s.charAt(0).toUpperCase() + s.slice(1);
            return '<button onclick="setIconSize(\'' + s + '\')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' + (cur === s ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary') + '">' + label + '</button>';
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

function _feedTabBtn(key, label) {
  var active = _settingsFeedTab === key;
  return '<button onclick="_setSettingsFeedTab(\'' + key + '\')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' + (active ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary') + '">' + label + '</button>';
}

function _renderFeedSettings() {
  var tabs = '<div class="flex gap-1.5 mb-6">' + _feedTabBtn('insights', 'Insights') + _feedTabBtn('quality', 'Quality Filter') + _feedTabBtn('algorithm', 'Algorithm') + '</div>';

  if (_settingsFeedTab === 'quality') return tabs + _renderFeedQualityTab();
  if (_settingsFeedTab === 'algorithm') return tabs + _renderFeedAlgorithmTab();
  return tabs + _renderFeedInsightsTab();
}

function _renderFeedInsightsTab() {
  return `
    <div class="mb-8">
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
  `;
}

function _renderFeedQualityTab() {
  const cache = typeof getQualityCache === 'function' ? getQualityCache() : {};
  const cacheEntries = Object.entries(cache);
  const keptCount = cacheEntries.filter(([, v]) => (v?.v || v) === 'keep').length;
  const skippedCount = cacheEntries.filter(([, v]) => (v?.v || v) === 'skip').length;

  return `
    <div class="flex items-center gap-3 mb-1">
      <h3 class="text-white_ text-sm font-semibold">Quality Filter</h3>
      <span class="text-dimmer text-[0.62rem]">qwen3:8b</span>
      <label class="flex items-center gap-2 cursor-pointer ml-auto">
        <span class="text-primary text-sm">Enable</span>
        <span class="toggle-switch">
          <input type="checkbox" id="toggle-quality-filter" ${typeof isQualityFilterOn === 'function' && isQualityFilterOn() ? 'checked' : ''} onchange="setQualityFilter(this.checked)">
          <span class="slider"></span>
        </span>
      </label>
    </div>
    <p class="text-dim text-[0.78rem] mb-5">Uses a local LLM (Ollama) to hide low-quality posts. Two phases: verdict (KEEP/SKIP), then scoring.</p>

    <div class="mb-5">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-muted text-[0.78rem] font-medium">Verdict Prompt</span>
        ${typeof getQualityPrompt === 'function' && typeof DEFAULT_QUALITY_PROMPT !== 'undefined' && getQualityPrompt() !== DEFAULT_QUALITY_PROMPT ? '<span class="text-[0.65rem] text-accent bg-accent/10 border border-accent/30 rounded px-1.5 py-0.5">Edited</span>' : ''}
      </div>
      <p class="text-dimmer text-[0.72rem] mb-2">Classifies each post title as KEEP or SKIP.</p>
      <div id="verdict-prompt-readonly" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-dim text-[0.78rem] font-mono leading-relaxed whitespace-pre-wrap mb-2 max-h-[200px] overflow-y-auto">${typeof getQualityPrompt === 'function' ? escapeHtml(getQualityPrompt()) : ''}</div>
      <textarea id="quality-prompt-input" rows="6" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-primary text-[0.78rem] font-mono leading-relaxed outline-none focus:border-accent resize-y" spellcheck="false" style="display:none">${typeof getQualityPrompt === 'function' ? escapeHtml(getQualityPrompt()) : ''}</textarea>
      <div id="verdict-prompt-actions" class="flex items-center gap-2 justify-end">
        <button onclick="_editVerdictPrompt()" class="text-dim text-[0.78rem] hover:text-primary bg-transparent border border-border-input hover:border-accent rounded-md px-3 py-1 cursor-pointer transition-colors">Edit</button>
        ${typeof getQualityPrompt === 'function' && typeof DEFAULT_QUALITY_PROMPT !== 'undefined' && getQualityPrompt() !== DEFAULT_QUALITY_PROMPT ? '<button onclick="resetQualityPrompt(); renderSettingsView()" class="text-dim text-[0.78rem] hover:text-red-400 bg-transparent border border-border-input hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors">Reset</button>' : ''}
      </div>
      <div id="verdict-prompt-edit-actions" class="flex items-center gap-2 justify-end" style="display:none">
        <button onclick="_cancelEditVerdictPrompt()" class="text-dim text-[0.78rem] hover:text-primary bg-transparent border border-border-input rounded-md px-3 py-1 cursor-pointer transition-colors">Cancel</button>
        <button onclick="saveQualityPrompt().then(function(){ renderSettingsView(); })" class="bg-accent text-white text-[0.78rem] px-3 py-1 rounded-md border-none cursor-pointer hover:bg-accent-hover">Save</button>
      </div>
    </div>

    <div class="mb-5 pt-4 border-t border-border-subtle">
      <span class="text-muted text-[0.78rem] font-medium mb-2 block">Scoring Threshold</span>
      <p class="text-dimmer text-[0.72rem] mb-2">Posts passing the verdict are scored 0\u2013100%. Below threshold = hidden.</p>
      <div id="scoring-prompt-display" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-dim text-[0.78rem] font-mono leading-relaxed whitespace-pre-wrap mb-3">Loading\u2026</div>
      <div class="flex items-center gap-3">
        <input type="range" id="quality-threshold-slider" min="0" max="100" value="${typeof getQualityThreshold === 'function' ? getQualityThreshold() : 30}" oninput="document.getElementById('quality-threshold-value').textContent=this.value+'%'" onchange="setQualityThreshold(parseInt(this.value))" class="flex-1 accent-[var(--accent)]" />
        <span id="quality-threshold-value" class="text-primary text-sm font-mono w-10 text-right">${typeof getQualityThreshold === 'function' ? getQualityThreshold() : 30}%</span>
      </div>
      <p class="text-dimmer text-[0.68rem] mt-1">Minimum score to display (0% = show all kept, 100% = strictest)</p>
    </div>

    <div class="mb-5 pt-4 border-t border-border-subtle">
      <span class="text-muted text-[0.78rem] font-medium mb-2 block">Blocked Words</span>
      <p class="text-dimmer text-[0.72rem] mb-3">Posts with titles containing any of these words will be automatically hidden.</p>
      <div class="flex gap-2 mb-3">
        <input type="text" id="blocked-word-input" placeholder="e.g. politics, lawsuit, review" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();addBlockedWord()}">
        <button onclick="addBlockedWord()" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover">Add</button>
      </div>
      <div id="blocked-words-list" class="flex flex-wrap gap-1.5"></div>
    </div>

    <div class="mb-5 pt-4 border-t border-border-subtle">
      <button onclick="_toggleBlockedPostsList()" class="flex items-center gap-2 text-muted text-[0.78rem] font-medium bg-transparent border-none cursor-pointer p-0 hover:text-primary transition-colors">
        <svg id="blocked-posts-chevron" class="w-3.5 h-3.5 transition-transform" style="transform:rotate(-90deg)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
        Blocked Posts
      </button>
      <div id="quality-blocked-list" class="text-[0.78rem] text-muted max-h-[300px] overflow-y-auto mt-2" style="display:none"></div>
    </div>

    <div class="flex items-center justify-between pt-4 border-t border-border-subtle">
      <div class="text-dim text-[0.75rem]">
        Cached: ${cacheEntries.length} &middot; Kept: ${keptCount} &middot; Skipped: ${skippedCount}
      </div>
      <button onclick="resetEverything()" class="text-red-400/80 text-[0.75rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors">Reset all &amp; clear cache</button>
    </div>
  `;
}

function _renderFeedAlgorithmTab() {
  const profile = typeof getInterestProfile === 'function' ? getInterestProfile() : null;
  const readCount = typeof getReadPosts === 'function' ? getReadPosts().length : 0;
  const savedCount = typeof getSavedPosts === 'function' ? Object.keys(getSavedPosts()).length : 0;
  const hiddenCount = typeof getHiddenPosts === 'function' ? getHiddenPosts().length : 0;
  const topTopics = profile?.topTopics || [];
  const topCats = profile?.topCategories || [];

  const wBase = parseFloat(localStorage.getItem('fyWeightBase') || '0.7');
  const wAff = parseFloat(localStorage.getItem('fyWeightAffinity') || '0.3');
  const wRec = parseFloat(localStorage.getItem('fyWeightRecency') || '1.0');
  const maxRun = parseInt(localStorage.getItem('maxPerCategoryRun') || '3', 10);

  const exampleLlm = 72, exampleAffVal = 0.8, exampleAge = 3;
  const exampleRecency = Math.max(0, 10 - exampleAge * 0.5) * wRec;
  const exampleScore = (exampleLlm * (wBase + exampleAffVal * wAff) + exampleRecency).toFixed(1);

  return `
    <h3 class="text-white_ text-sm font-semibold mb-1">How the Algorithm Works</h3>
    <p class="text-dim text-[0.78rem] mb-5">Your feed is ranked using a personalized composite score that combines LLM relevance scoring, source affinity from your reading habits, and recency.</p>

    <div class="mb-5">
      <span class="text-muted text-[0.78rem] font-medium mb-2 block">1. LLM Relevance Score</span>
      <p class="text-dim text-[0.75rem] leading-relaxed mb-1">Every post that passes the verdict filter is scored 0\u2013100 by a local LLM. When you have an interest profile, your top topics and categories are appended to the scoring prompt.</p>
    </div>

    <div class="mb-5 pt-4 border-t border-border-subtle">
      <span class="text-muted text-[0.78rem] font-medium mb-2 block">2. Interest Profile</span>
      <p class="text-dim text-[0.75rem] leading-relaxed mb-3">Built automatically from your reading behavior. Recomputed every 5 minutes.</p>
      <div class="bg-input border border-border-input rounded-lg p-3 text-[0.75rem] space-y-2 mb-3">
        <div class="flex justify-between"><span class="text-dim">Posts read</span><span class="text-primary font-mono">${readCount}</span></div>
        <div class="flex justify-between"><span class="text-dim">Posts saved</span><span class="text-primary font-mono">${savedCount}</span></div>
        <div class="flex justify-between"><span class="text-dim">Posts hidden</span><span class="text-primary font-mono">${hiddenCount}</span></div>
      </div>
      <div class="space-y-2 text-[0.75rem]">
        <div>
          <span class="text-dimmer text-[0.68rem]">Signal weights:</span>
          <div class="text-dim mt-1">Read = <span class="text-primary">1x</span> &middot; Saved = <span class="text-primary">3x</span> &middot; Rated = <span class="text-primary">rating value</span> &middot; Hidden = negative</div>
        </div>
        <div>
          <span class="text-dimmer text-[0.68rem]">Top topics:</span>
          <div class="flex flex-wrap gap-1 mt-1">${topTopics.length ? topTopics.map(function(t){ return '<span class="bg-hover text-dim text-[0.68rem] px-1.5 py-0.5 rounded">' + escapeHtml(t) + '</span>'; }).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>'}</div>
        </div>
        <div>
          <span class="text-dimmer text-[0.68rem]">Top categories:</span>
          <div class="flex flex-wrap gap-1 mt-1">${topCats.length ? topCats.map(function(c){ return '<span class="bg-accent/10 text-accent text-[0.68rem] px-1.5 py-0.5 rounded border border-accent/20">' + escapeHtml(c) + '</span>'; }).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>'}</div>
        </div>
      </div>
    </div>

    <div class="mb-5 pt-4 border-t border-border-subtle">
      <span class="text-muted text-[0.78rem] font-medium mb-2 block">3. Source Affinity</span>
      <p class="text-dim text-[0.75rem] leading-relaxed mb-3">Each feed source gets an affinity score (0.1\u20131.0) based on engagement. Sources you read/save/rate highly get boosted; frequently hidden ones get penalized.</p>
      <div class="bg-input border border-border-input rounded-lg p-3 text-[0.72rem] font-mono mb-3">
        <div class="text-dim mb-1">engagement = (read + saved\u00d72 + rated\u00d73) / total</div>
        <div class="text-dim mb-1">penalty = (hidden / total) \u00d7 0.5</div>
        <div class="text-primary">affinity = clamp(engagement \u2212 penalty, 0.1, 1.0)</div>
        <div class="text-dimmer text-[0.65rem] mt-1">Sources with &lt;3 posts default to 0.5</div>
      </div>
    </div>

    <div class="mb-5 pt-4 border-t border-border-subtle">
      <span class="text-muted text-[0.78rem] font-medium mb-2 block">4. Composite Score</span>
      <p class="text-dim text-[0.75rem] leading-relaxed mb-3">When you use "For You" sort, each post is ranked by a composite score:</p>
      <div class="bg-input border border-border-input rounded-lg p-3 text-[0.78rem] font-mono mb-3">
        <div class="text-accent">score = LLM \u00d7 (base + affinity \u00d7 aff_weight) + recency_boost \u00d7 rec_weight</div>
      </div>
      <div class="space-y-1.5 text-[0.72rem] text-dim mb-4">
        <div><span class="text-dimmer">LLM:</span> Quality score from local model (0\u2013100)</div>
        <div><span class="text-dimmer">base:</span> Baseline multiplier</div>
        <div><span class="text-dimmer">affinity \u00d7 aff_weight:</span> Bonus for sources you engage with</div>
        <div><span class="text-dimmer">recency_boost:</span> max(0, 10 \u2212 age_hours \u00d7 0.5)</div>
      </div>
      <div class="bg-input border border-border-input rounded-lg p-3 mb-4">
        <div class="text-dimmer text-[0.68rem] mb-2">Example: LLM=${exampleLlm}, affinity=${exampleAffVal}, age=${exampleAge}h</div>
        <div class="text-[0.75rem] font-mono text-dim">${exampleLlm} \u00d7 (${wBase.toFixed(2)} + ${exampleAffVal} \u00d7 ${wAff.toFixed(2)}) + ${exampleRecency.toFixed(1)} = <span class="text-accent font-semibold">${exampleScore}</span></div>
      </div>
      <div class="text-dimmer text-[0.68rem] mb-2">Current weights</div>
      <div class="space-y-2">
        <div class="flex items-center gap-3">
          <span class="text-dim text-[0.72rem] w-16 shrink-0">Base</span>
          <input type="range" min="0" max="100" value="${Math.round(wBase * 100)}" oninput="document.getElementById('algo-base-val').textContent=(this.value/100).toFixed(2)" onchange="localStorage.setItem('fyWeightBase',(this.value/100).toFixed(2));if(typeof renderPapers==='function')renderPapers();renderSettingsView()" class="flex-1 accent-[var(--accent)]" />
          <span id="algo-base-val" class="text-dim text-[0.68rem] tabular-nums w-8 text-right">${wBase.toFixed(2)}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-dim text-[0.72rem] w-16 shrink-0">Affinity</span>
          <input type="range" min="0" max="100" value="${Math.round(wAff * 100)}" oninput="document.getElementById('algo-aff-val').textContent=(this.value/100).toFixed(2)" onchange="localStorage.setItem('fyWeightAffinity',(this.value/100).toFixed(2));if(typeof renderPapers==='function')renderPapers();renderSettingsView()" class="flex-1 accent-[var(--accent)]" />
          <span id="algo-aff-val" class="text-dim text-[0.68rem] tabular-nums w-8 text-right">${wAff.toFixed(2)}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-dim text-[0.72rem] w-16 shrink-0">Recency</span>
          <input type="range" min="0" max="200" value="${Math.round(wRec * 100)}" oninput="document.getElementById('algo-rec-val').textContent=(this.value/100).toFixed(2)" onchange="localStorage.setItem('fyWeightRecency',(this.value/100).toFixed(2));if(typeof renderPapers==='function')renderPapers();renderSettingsView()" class="flex-1 accent-[var(--accent)]" />
          <span id="algo-rec-val" class="text-dim text-[0.68rem] tabular-nums w-8 text-right">${wRec.toFixed(2)}</span>
        </div>
      </div>
    </div>

    <div class="mb-5 pt-4 border-t border-border-subtle">
      <span class="text-muted text-[0.78rem] font-medium mb-2 block">5. Category Diversity</span>
      <p class="text-dim text-[0.75rem] leading-relaxed mb-3">After scoring, posts are reordered to prevent any single category from dominating. If more than <span class="text-primary">${maxRun}</span> consecutive posts come from the same category, a post from a different category is pulled forward.</p>
      <div class="flex items-center gap-3">
        <span class="text-dim text-[0.72rem] shrink-0">Max same-category run</span>
        <input type="range" min="1" max="10" value="${maxRun}" oninput="document.getElementById('algo-div-val').textContent=this.value" onchange="localStorage.setItem('maxPerCategoryRun',this.value);if(typeof renderPapers==='function')renderPapers()" class="flex-1 accent-[var(--accent)]" />
        <span id="algo-div-val" class="text-dim text-[0.68rem] tabular-nums w-4 text-right">${maxRun}</span>
      </div>
    </div>

    <div id="personalization-panel-container" class="mb-5 pt-4 border-t border-border-subtle"></div>

    <div class="pt-4 border-t border-border-subtle flex items-center gap-3">
      <button onclick="resetPersonalization();renderSettingsView()" class="text-red-400/80 text-[0.75rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors">Reset all personalization</button>
      <span class="text-dimmer text-[0.68rem]">Clears your interest profile, resets all weights to defaults</span>
    </div>
  `;
}

function _renderToolsSettings() {
  return `
    <div class="mb-8">
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
  `;
}

function _renderBrowserSettings() {
  return `
    <div class="mb-8">
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
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">Site Permissions</h3>
      <p class="text-dim text-[0.8rem] mb-3">Manage camera, microphone, location, notification, and pop-up permissions per site.</p>
      <div id="settings-site-permissions">${_renderSettingsSitePermissions()}</div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">URL Bar Sections</h3>
      <p class="text-dim text-[0.8rem] mb-3">Reorder and toggle sections in the URL bar dropdown. Drag to reorder.</p>
      <div id="settings-urlbar-sections">${_renderUrlBarSectionsSettings()}</div>
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

function _renderUrlBarSectionsSettings() {
  if (typeof _getUrlBarSections !== 'function') return '<div class="text-dimmer text-[0.75rem]">URL bar sections not available.</div>';
  const sections = _getUrlBarSections();
  let html = '<div id="urlbar-section-list">';
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const safeKey = escapeHtml(s.key);
    html += '<div class="urlbar-sec-row" data-seckey="' + safeKey + '" style="display:flex;align-items:center;gap:10px;padding:7px 10px;border:1px solid var(--border-input);border-radius:8px;margin-bottom:4px;background:var(--bg-card);cursor:grab;user-select:none;">';
    html += '<span style="color:var(--text-dimmer);font-size:0.9rem;cursor:grab;flex-shrink:0;" title="Drag to reorder">\u2847</span>';
    html += '<span style="flex:1;font-size:0.8rem;color:var(--text-primary);">' + escapeHtml(s.label) + '</span>';
    html += '<label class="toggle-switch" style="flex-shrink:0;">';
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
    // Don't interfere with toggle clicks
    if (e.target.closest('.toggle-switch')) return;
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
    // Find drop target
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
      // Save new order
      const rows = Array.from(list.querySelectorAll('.urlbar-sec-row'));
      const currentSections = _getUrlBarSections();
      const newSections = rows.map(r => {
        const key = r.dataset.seckey;
        const existing = currentSections.find(s => s.key === key);
        return { key, label: existing ? existing.label : key, enabled: existing ? existing.enabled : true };
      });
      _saveUrlBarSections(newSections);
      // Suppress click
      const suppress = ev => { ev.stopPropagation(); ev.preventDefault(); };
      dragEl.addEventListener('click', suppress, { capture: true, once: true });
    }
    dragEl = null;
    dragStarted = false;
  }

  list.addEventListener('pointerup', endDrag);
  list.addEventListener('pointercancel', endDrag);
}

function _loadSettingsModels() {
  fetch('/api/models').then(r => r.json()).then(data => {
    const models = data.models || [];
    document.querySelectorAll('.settings-model-select').forEach(sel => {
      const key = sel.dataset.key;
      const fallback = sel.dataset.fallback;
      const current = localStorage.getItem(key) || fallback;
      sel.innerHTML = models.map(m =>
        `<option value="${escapeAttr(m)}" ${m === current ? 'selected' : ''}>${escapeHtml(m)}</option>`
      ).join('');
      if (current && !models.includes(current)) {
        sel.insertAdjacentHTML('afterbegin',
          `<option value="${escapeAttr(current)}" selected>${escapeHtml(current)}</option>`);
      }
    });
  }).catch(() => {
    document.querySelectorAll('.settings-model-select').forEach(sel => {
      const key = sel.dataset.key;
      const fallback = sel.dataset.fallback;
      const current = localStorage.getItem(key) || fallback;
      sel.innerHTML = `<option value="${escapeAttr(current)}" selected>${escapeHtml(current)}</option>`;
    });
  });
}

function _renderPanelSettings() {
  const chatModel = localStorage.getItem('chatModel') || 'qwen2.5:3b';
  const visionModel = localStorage.getItem('visionModel') || 'qwen3-vl:8b';
  const summaryModel = localStorage.getItem('summaryModel') || 'qwen3:0.6b';
  const tabComplete = localStorage.getItem('panelTabComplete') !== 'off';
  const semSearch = localStorage.getItem('panelSemanticSearch') !== 'off';
  const semMin = parseInt(localStorage.getItem('panelSemanticMin') || '80', 10);
  const vaultMin = parseInt(localStorage.getItem('vaultChatMinSimilarity') || '30', 10);
  setTimeout(_loadSettingsModels, 0);
  return `
    <div class="mb-8">
      <h3 class="text-white_ text-sm font-semibold mb-1">Default Chat Model</h3>
      <p class="text-dim text-[0.8rem] mb-3">The model used for aether panel chat and document Q&A.</p>
      <select data-key="chatModel" data-fallback="qwen2.5:3b" onchange="localStorage.setItem('chatModel', this.value)" class="settings-model-select w-full max-w-[320px] px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary outline-none focus:border-accent cursor-pointer">
        <option value="${escapeAttr(chatModel)}" selected>${escapeHtml(chatModel)}</option>
      </select>
      <p class="text-dimmer text-[0.68rem] mt-1">You can also change this inline via <code class="text-muted">/model</code> in the panel.</p>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">Default Vision Model</h3>
      <p class="text-dim text-[0.8rem] mb-3">The model used when chatting with screenshots (drag-to-capture).</p>
      <select data-key="visionModel" data-fallback="qwen3-vl:8b" onchange="localStorage.setItem('visionModel', this.value)" class="settings-model-select w-full max-w-[320px] px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary outline-none focus:border-accent cursor-pointer">
        <option value="${escapeAttr(visionModel)}" selected>${escapeHtml(visionModel)}</option>
      </select>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">Daily Summary Model</h3>
      <p class="text-dim text-[0.8rem] mb-3">The model used to generate the daily overview summary on the home page.</p>
      <select data-key="summaryModel" data-fallback="qwen3:0.6b" onchange="localStorage.setItem('summaryModel', this.value)" class="settings-model-select w-full max-w-[320px] px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary outline-none focus:border-accent cursor-pointer">
        <option value="${escapeAttr(summaryModel)}" selected>${escapeHtml(summaryModel)}</option>
      </select>
      <p class="text-dimmer text-[0.68rem] mt-1">A smaller model is recommended for fast summaries. Set to <code class="text-muted">off</code> to disable.</p>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-white_ text-sm font-semibold">Tab Completion</h3>
          <p class="text-dim text-[0.8rem] mt-0.5">Suggest a question when you open the panel or select text. Press Tab to accept. Uses qwen3:0.6b.</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="toggle-switch">
            <input type="checkbox" ${tabComplete ? 'checked' : ''} onchange="localStorage.setItem('panelTabComplete', this.checked ? 'on' : 'off')">
            <span class="slider"></span>
          </span>
        </label>
      </div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-white_ text-sm font-semibold">Semantic Search in Lookup</h3>
          <p class="text-dim text-[0.8rem] mt-0.5">Show related posts when you highlight text. Uses nomic-embed-text.</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="toggle-switch">
            <input type="checkbox" ${semSearch ? 'checked' : ''} onchange="localStorage.setItem('panelSemanticSearch', this.checked ? 'on' : 'off')">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <div class="flex items-center gap-3 ${semSearch ? '' : 'opacity-40 pointer-events-none'}">
        <span class="text-primary text-[0.8rem] shrink-0">Min similarity</span>
        <input type="range" min="10" max="80" value="${semMin}" oninput="document.getElementById('sem-min-val').textContent=this.value+'%'" onchange="localStorage.setItem('panelSemanticMin', this.value)" class="flex-1 accent-[var(--accent)]" />
        <span id="sem-min-val" class="text-muted text-[0.78rem] w-10 text-right">${semMin}%</span>
      </div>
      <p class="text-dimmer text-[0.68rem] mt-1">Only results above this score appear in the highlight popup. Lower = more results, higher = stricter.</p>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">Notes RAG Threshold</h3>
      <p class="text-dim text-[0.8rem] mb-3">Minimum similarity for vault notes to be included as context when chatting without a document.</p>
      <div class="flex items-center gap-3">
        <span class="text-primary text-[0.8rem] shrink-0">Min similarity</span>
        <input type="range" min="10" max="80" value="${vaultMin}" oninput="document.getElementById('vault-min-val').textContent=this.value+'%'" onchange="localStorage.setItem('vaultChatMinSimilarity', this.value)" class="flex-1 accent-[var(--accent)]" />
        <span id="vault-min-val" class="text-muted text-[0.78rem] w-10 text-right">${vaultMin}%</span>
      </div>
    </div>
  `;
}

function _renderHelpSettings() {
  return `
    <div class="mb-8">
      <h3 class="text-white_ text-sm font-semibold mb-3">Search</h3>
      <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">
        <code class="text-muted">"exact phrase"</code><span class="text-dim">Match exact phrase in feed + arXiv</span>
        <code class="text-muted">title:word</code><span class="text-dim">Search in title only</span>
        <code class="text-muted">by:author name</code><span class="text-dim">Search by author</span>
        <code class="text-muted">source:arxiv</code><span class="text-dim">Filter by source</span>
        <code class="text-muted">user:username</code><span class="text-dim">Search for a user</span>
        <code class="text-muted">~neural networks</code><span class="text-dim">Semantic search over read/bookmarked posts</span>
      </div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">Semantic Search</h3>
      <p class="text-dim text-[0.8rem] mb-3">Posts you read or bookmark are automatically embedded using a local AI model. You can then search by meaning instead of keywords.</p>
      <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">
        <span class="text-muted font-medium">Setup</span><span class="text-dim">Run <code class="text-muted">ollama pull nomic-embed-text</code> once (~274MB)</span>
        <span class="text-muted font-medium">Search</span><span class="text-dim">Type <code class="text-muted">~query</code> in Research > Papers search</span>
        <span class="text-muted font-medium">Find similar</span><span class="text-dim">Click the three-dot menu on any card > "Find similar"</span>
        <span class="text-muted font-medium">Notes</span><span class="text-dim">Vault notes are embedded when saved, searchable via <code class="text-muted">~</code></span>
        <span class="text-muted font-medium">Offline</span><span class="text-dim">Fully local — no data leaves your machine</span>
      </div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">Keyboard Shortcuts</h3>
      <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">
        <kbd class="kbd-key text-[0.7rem]">Cmd+T</kbd><span class="text-dim">Toggle tiling window manager</span>
        <kbd class="kbd-key text-[0.7rem]">Right-click</kbd><span class="text-dim">Open aether panel (chat, search, actions)</span>
        <kbd class="kbd-key text-[0.7rem]">Enter</kbd><span class="text-dim">Send chat message in aether panel</span>
        <kbd class="kbd-key text-[0.7rem]">Shift+Enter</kbd><span class="text-dim">Web search in aether panel</span>
      </div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">Aether Panel</h3>
      <p class="text-dim text-[0.8rem] mb-2">Right-click anywhere to open an inline chat panel. Type <code class="text-muted">/help</code> in the panel for available commands.</p>
      <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">
        <span class="text-muted font-medium">Chat</span><span class="text-dim">Ask questions about the current page or anything</span>
        <span class="text-muted font-medium">Screenshot</span><span class="text-dim">Drag to capture a region and chat about it (Electron only)</span>
        <span class="text-muted font-medium">Web search</span><span class="text-dim">Shift+Enter to search the web inline</span>
        <span class="text-muted font-medium">Context</span><span class="text-dim">Right-click on links/images for contextual actions</span>
      </div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">AI Models (Ollama)</h3>
      <p class="text-dim text-[0.8rem] mb-3">The app uses local Ollama models. All are optional — features degrade gracefully without them.</p>
      <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">
        <code class="text-muted">qwen2.5:1.5b</code><span class="text-dim">Quality filter (KEEP/SKIP + scoring)</span>
        <code class="text-muted">qwen2.5:3b</code><span class="text-dim">Document chat, paper insights</span>
        <code class="text-muted">nomic-embed-text</code><span class="text-dim">Semantic search embeddings (768-dim)</span>
        <code class="text-muted">qwen3:8b</code><span class="text-dim">Chat with tools (autonomous agent mode)</span>
        <code class="text-muted">qwen3-vl:8b</code><span class="text-dim">Vision chat (screenshot analysis)</span>
      </div>
    </div>
  `;
}

function renderSettingsView() {
  // Render sidebar
  const sidebar = document.getElementById('settings-sidebar');
  if (sidebar) {
    let sbHtml = '<div style="padding:0 12px 12px;"><span class="text-[1.1rem] font-semibold text-primary">Settings</span></div>';
    for (const s of _SETTINGS_SECTIONS) {
      const active = _settingsSection === s.key;
      sbHtml += '<button onclick="_setSettingsSection(\'' + s.key + '\')" class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[0.8rem] rounded-md transition-colors ' + (active ? 'bg-accent/10 text-accent' : 'text-muted hover:text-primary hover:bg-hover') + '" style="width:calc(100% - 16px);margin:0 8px;">' + s.icon + ' ' + s.label + '</button>';
    }
    sbHtml += '<div style="margin-top:auto;padding:12px 16px;"><div id="settings-version" style="color:var(--text-dimmer);font-size:0.65rem;"></div></div>';
    sidebar.innerHTML = sbHtml;
  }

  // Render content pane
  const pane = document.getElementById('settings-content-pane');
  if (pane) {
    const titles = { profile: 'Profile', appearance: 'Appearance', feed: 'Feed & Reading', tools: 'Tools', browser: 'Browser', panel: 'Lookup Panel', help: 'Help' };
    let content = '<h2 class="text-[1.2rem] font-semibold text-primary mb-5">' + (titles[_settingsSection] || 'Settings') + '</h2>';

    if (_settingsSection === 'profile') {
      content += _renderAccountSettings();
      content += '<div class="mt-6 p-3 rounded-lg border border-border-subtle bg-card/50"><div class="flex items-center gap-2 text-[0.8rem]"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span class="text-primary">Right-click anywhere and type <kbd class="kbd-key" style="font-size:0.7rem">/help</kbd> to see all commands, instant answers & shortcuts.</span></div></div>';
    } else if (_settingsSection === 'appearance') {
      content += _renderAppearanceSettings();
    } else if (_settingsSection === 'feed') {
      content += _renderFeedSettings();
    } else if (_settingsSection === 'tools') {
      content += _renderToolsSettings();
    } else if (_settingsSection === 'browser') {
      content += _renderBrowserSettings();
    } else if (_settingsSection === 'panel') {
      content += _renderPanelSettings();
    } else if (_settingsSection === 'help') {
      content += _renderHelpSettings();
    }

    pane.innerHTML = content;
  }

  // Load version
  fetch('/api/version').then(r => r.json()).then(v => {
    const el = document.getElementById('settings-version');
    if (el && v.version) el.textContent = 'v' + v.version + (v.sha ? ' (' + v.sha + ')' : '');
  }).catch(() => {});

  // Section-specific post-render hooks
  if (_settingsSection === 'appearance') {
    updateSpinnerPreview(getSelectedSpinner());
  } else if (_settingsSection === 'feed') {
    if (_settingsFeedTab === 'quality') {
      if (typeof renderBlockedWordsList === 'function') renderBlockedWordsList();
      fetch('/api/quality-prompt').then(function(r){ return r.json(); }).then(function(data) {
        if (data.prompt) {
          localStorage.setItem('qualityPrompt', data.prompt);
          var el = document.getElementById('quality-prompt-input');
          if (el) el.value = data.prompt;
        }
        var scoringEl = document.getElementById('scoring-prompt-display');
        if (scoringEl && data.scoringPrompt) scoringEl.textContent = data.scoringPrompt;
      }).catch(function(){});
    } else if (_settingsFeedTab === 'algorithm') {
      if (typeof _renderPersonalizationPanel === 'function') _renderPersonalizationPanel();
    }
  } else if (_settingsSection === 'tools') {
    loadVaultPath();
  } else if (_settingsSection === 'browser') {
    _urlBarSectionDragSetup();
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
  }
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

function setIconSize(size) {
  localStorage.setItem('iconSize', size);
  document.documentElement.setAttribute('data-icon-size', size);
  renderSettingsView();
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

function setAetherColor(color) {
  localStorage.setItem('aetherColor', color);
  document.documentElement.style.setProperty('--aether-bg', color);
  renderSettingsView();
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
  const aether = localStorage.getItem('aetherColor');
  if (aether) document.documentElement.style.setProperty('--aether-bg', aether);
  const iconSize = localStorage.getItem('iconSize') || 'medium';
  document.documentElement.setAttribute('data-icon-size', iconSize);
}

applyStoredAppearance();
