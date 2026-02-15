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
            ${icon('camera', { size: 20, class: 'w-5 h-5 text-white' })}
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

function toggleSidebarIcon(id, visible) {
  let hidden = [];
  hidden = getLS('hiddenSidebarIcons', []);
  if (visible) {
    hidden = hidden.filter(h => h !== id);
  } else {
    if (!hidden.includes(id)) hidden.push(id);
  }
  setLS('hiddenSidebarIcons', hidden);
  applySidebarVisibility();
}

function resetSidebarIcons() {
  localStorage.removeItem('sidebarOrder');
  localStorage.removeItem('hiddenSidebarIcons');
  applySidebarOrder();
  applySidebarVisibility();
  renderSettingsView();
}

let _sbDragEl = null, _sbDragGhost = null, _sbDragStartY = 0, _sbDragStarted = false;

function _sbDragDown(e) {
  const handle = e.target.closest('.sb-drag-handle');
  if (!handle) return;
  const row = handle.closest('.sb-icon-row');
  if (!row) return;
  _sbDragEl = row;
  _sbDragStartY = e.clientY;
  _sbDragStarted = false;
  e.preventDefault();
}

function _sbDragMove(e) {
  if (!_sbDragEl) return;
  if (!_sbDragStarted && Math.abs(e.clientY - _sbDragStartY) < 4) return;
  const list = document.getElementById('sb-icon-list');
  if (!list) return;
  if (!_sbDragStarted) {
    _sbDragStarted = true;
    _sbDragEl.style.opacity = '0.3';
    _sbDragGhost = _sbDragEl.cloneNode(true);
    _sbDragGhost.style.cssText = 'position:fixed;pointer-events:none;z-index:999;opacity:0.9;background:var(--bg-hover);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.4);width:' + _sbDragEl.offsetWidth + 'px;left:' + _sbDragEl.getBoundingClientRect().left + 'px';
    document.body.appendChild(_sbDragGhost);
  }
  _sbDragGhost.style.top = (e.clientY - _sbDragGhost.offsetHeight / 2) + 'px';
  const rows = Array.from(list.querySelectorAll('.sb-icon-row'));
  for (const row of rows) {
    if (row === _sbDragEl) continue;
    const r = row.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (e.clientY < mid) {
      list.insertBefore(_sbDragEl, row);
      return;
    }
  }
  list.appendChild(_sbDragEl);
}

function _sbDragEnd() {
  if (!_sbDragEl) return;
  _sbDragEl.style.opacity = '';
  if (_sbDragGhost) { _sbDragGhost.remove(); _sbDragGhost = null; }
  if (_sbDragStarted) {
    const list = document.getElementById('sb-icon-list');
    if (list) {
      const order = Array.from(list.querySelectorAll('.sb-icon-row')).map(r => r.dataset.id);
      setLS('sidebarOrder', order);
      applySidebarOrder();
      applySidebarVisibility();
    }
  }
  _sbDragEl = null;
  _sbDragStarted = false;
}

document.addEventListener('pointermove', _sbDragMove);
document.addEventListener('pointerup', _sbDragEnd);
document.addEventListener('pointercancel', _sbDragEnd);

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
          <button onclick="setTheme('clear')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${currentTheme === 'clear' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}" id="theme-btn-clear">Clear</button>
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
        <div class="flex gap-1.5">
          ${['midnight','aether','match'].map(t => {
            const raw = localStorage.getItem('aetherColor') || 'midnight';
            const cur = raw.startsWith('#') ? 'midnight' : raw;
            const label = t.charAt(0).toUpperCase() + t.slice(1);
            return '<button onclick="setAetherColor(\'' + t + '\')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' + (cur === t ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary') + '">' + label + '</button>';
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
        <span class="text-primary text-sm">Browse Tabs</span>
        <div class="flex gap-1.5">
          ${['island','horizontal'].map(t => {
            const cur = localStorage.getItem('browseTabLayout') || 'island';
            const label = t === 'island' ? 'Island' : 'Horizontal';
            return '<button onclick="setBrowseTabLayout(\'' + t + '\')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' + (cur === t ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary') + '">' + label + '</button>';
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
      <div class="mt-4">
        <div class="flex items-center justify-between">
          <span class="text-primary text-sm">White Noise</span>
        </div>
        <div class="flex flex-wrap gap-1 mt-2">
          ${Object.entries(NOISE_PRESETS).map(([key, p]) => {
            const sel = isRainSidebarVisible() && _rainNoiseType === key;
            return `<button onclick="setRainSidebarVisible(true); setRainNoiseType('${key}'); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">${p.label}</button>`;
          }).join('')}
          <button onclick="setRainSidebarVisible(false); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${!isRainSidebarVisible() ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">none</button>
        </div>
        <div class="flex items-center gap-2 mt-2">
          <span class="text-[0.7rem] text-dimmer whitespace-nowrap">Volume</span>
          <input type="range" min="0" max="100" value="${Math.round(_rainVolume * 100)}" oninput="setRainVolume(this.value / 100)" class="flex-1 h-1 accent-accent">
          <span id="rain-volume-value" class="text-[0.7rem] text-dimmer font-mono w-10 text-right">${Math.round(_rainVolume * 100)}%</span>
        </div>
        <div class="flex items-center gap-2 mt-2">
          <span class="text-[0.7rem] text-dimmer whitespace-nowrap">Tone</span>
          <input type="range" min="20" max="5000" step="10" value="${_rainFreq || 1000}" ${_rainFreq === 0 ? 'disabled' : ''} oninput="setRainFreq(this.value)" class="flex-1 h-1 accent-accent" style="opacity:${_rainFreq === 0 ? '0.3' : '1'}" id="rain-freq-slider">
          <span id="rain-freq-label" class="text-[0.7rem] text-dimmer font-mono w-14 text-right">${_rainFreq > 0 ? _rainFreq + ' Hz' : 'Auto'}</span>
          <button onclick="_rainFreq === 0 ? (setRainFreq(1000), document.getElementById('rain-freq-slider').disabled=false, document.getElementById('rain-freq-slider').style.opacity='1', document.getElementById('rain-freq-slider').value=1000) : (setRainFreq(0), document.getElementById('rain-freq-slider').disabled=true, document.getElementById('rain-freq-slider').style.opacity='0.3')" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${_rainFreq === 0 ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">Auto</button>
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
      <div class="flex items-center justify-between mt-4">
        <div>
          <span class="text-primary text-sm">Read Aloud Highlight</span>
          <p class="text-dimmer text-[0.72rem] mt-0.5">Highlight text in the page as it's being read aloud</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="toggle-switch">
            <input type="checkbox" ${localStorage.getItem('ttsHighlight') !== 'false' ? 'checked' : ''} onchange="localStorage.setItem('ttsHighlight', this.checked)">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <div class="flex items-center justify-between mt-4">
        <div>
          <span class="text-primary text-sm">Read Aloud Speed</span>
          <p class="text-dimmer text-[0.72rem] mt-0.5">Playback speed for TTS audio (<span id="tts-speed-val">${parseFloat(localStorage.getItem('ttsSpeed')) || 1}x</span>)</p>
        </div>
        <input type="range" min="0.5" max="3" step="0.25" value="${parseFloat(localStorage.getItem('ttsSpeed')) || 1}" class="w-28 accent-accent" oninput="localStorage.setItem('ttsSpeed', this.value); document.getElementById('tts-speed-val').textContent = this.value + 'x'; if (typeof _ttsAudio !== 'undefined' && _ttsAudio) _ttsAudio.playbackRate = parseFloat(this.value);">
      </div>
    </div>

    <!-- MENU ICONS -->
    <div class="mb-8">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-white_ text-sm font-semibold">Menu Icons</h3>
        <button onclick="resetSidebarIcons()" class="text-[0.72rem] text-dimmer hover:text-primary cursor-pointer">Reset</button>
      </div>
      <div id="sb-icon-list" onpointerdown="_sbDragDown(event)">
      ${(function() {
        const labels = { 'sb-dashboard': 'Home', 'sb-home': 'Feed', 'sb-vault': 'Vault', 'sb-browse': 'Browse', 'sb-neuralook': 'Neuralook', 'sb-dev': 'Dev Stats', 'sb-rain': 'White Noise', 'sb-settings': 'Settings' };
        const order = getSidebarOrder();
        let hidden = [];
        hidden = getLS('hiddenSidebarIcons', []);
        return order.map(id => {
          const label = labels[id] || id;
          const isVisible = !hidden.includes(id);
          return '<div class="sb-icon-row flex items-center justify-between py-2" data-id="' + id + '" style="touch-action:none">' +
            '<div class="flex items-center gap-2">' +
              '<span class="sb-drag-handle text-dimmest cursor-grab" style="touch-action:none">' + icon('dragHandle', { size: 14, class: 'w-3.5 h-3.5' }) + '</span>' +
              '<span class="text-primary text-sm">' + label + '</span>' +
            '</div>' +
            '<label class="flex items-center cursor-pointer"><span class="toggle-switch"><input type="checkbox" ' + (isVisible ? 'checked' : '') + ' onchange="toggleSidebarIcon(\'' + id + '\', this.checked)"><span class="slider"></span></span></label>' +
          '</div>';
        }).join('');
      })()}
      </div>
    </div>
  `;
}

function _feedTabBtn(key, label) {
  const active = _settingsFeedTab === key;
  return '<button onclick="_setSettingsFeedTab(\'' + key + '\')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' + (active ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary') + '">' + label + '</button>';
}

function _renderFeedSettings() {
  const tabs = '<div class="flex gap-1.5 mb-6">' + _feedTabBtn('insights', 'Insights') + _feedTabBtn('quality', 'Quality Filter') + _feedTabBtn('algorithm', 'Algorithm') + '</div>';

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
        <span id="blocked-posts-chevron" class="transition-transform" style="transform:rotate(-90deg)">${icon('chevronDown', { size: 14, class: 'w-3.5 h-3.5' })}</span>
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
        <span class="text-[0.75rem] font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">Always On</span>
      </div>
      <p class="text-dim text-[0.8rem] mb-3">Blocks ads and trackers ${window.electronAPI ? 'natively at the network level via Electron' : 'via a server-side proxy'}.</p>
      <div id="adblock-rules-info" class="text-dimmer text-[0.75rem] mb-3">${window.electronAPI ? 'Loading filter info...' : 'Filter list management requires Electron.'}</div>
      ${window.electronAPI ? '<button onclick="resetAdBlockRules()" class="text-dim text-[0.78rem] hover:text-primary bg-transparent border border-border-input hover:border-accent rounded-md px-3 py-1 cursor-pointer transition-colors">Update filter lists</button>' : ''}
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center justify-between mb-1">
        <div>
          <h3 class="text-white_ text-sm font-semibold">Hide YouTube Shorts</h3>
          <p class="text-dim text-[0.8rem]">Hides Shorts from the homepage, sidebar, search, and channel pages.</p>
        </div>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" id="hide-yt-shorts-toggle" class="sr-only peer" ${localStorage.getItem('hideYTShorts') === 'true' ? 'checked' : ''} onchange="localStorage.setItem('hideYTShorts', this.checked ? 'true' : 'false')">
          <div class="w-9 h-5 bg-gray-600 peer-checked:bg-accent rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
        </label>
      </div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">Site Permissions</h3>
      <p class="text-dim text-[0.8rem] mb-3">Manage camera, microphone, location, notification, and pop-up permissions per site.</p>
      <div id="settings-site-permissions">${_renderSettingsSitePermissions()}</div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center gap-3 mb-1">
        <h3 class="text-white_ text-sm font-semibold">Simplify URLs</h3>
        <label class="flex items-center gap-2 cursor-pointer ml-auto">
          <span class="text-primary text-sm">Enable</span>
          <span class="toggle-switch">
            <input type="checkbox" id="toggle-url-shorten" ${localStorage.getItem('urlShorten') !== 'false' ? 'checked' : ''} onchange="localStorage.setItem('urlShorten', this.checked); const inp = document.getElementById('browse-url-input'); if(inp && !this.checked && inp.dataset.fullUrl) inp.value = inp.dataset.fullUrl; else if(inp && this.checked) _browseUrlOnBlur(inp);">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <p class="text-dim text-[0.8rem] mb-3">Show only the domain name in the URL bar when not focused. Hover or click to see the full URL.</p>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">URL Bar Sections</h3>
      <p class="text-dim text-[0.8rem] mb-3">Reorder and toggle sections in the URL bar dropdown. Drag to reorder.</p>
      <div id="settings-urlbar-sections">${_renderUrlBarSectionsSettings()}</div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-1">Saved Passwords</h3>
      <p class="text-dim text-[0.8rem] mb-3">Passwords are encrypted via your system keychain.</p>
      <div id="settings-passwords"><div class="text-dimmer text-[0.75rem]">Loading...</div></div>
    </div>
  `;
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
    html += '<div style="border:1px solid var(--border-input);border-radius:8px;margin-bottom:6px;overflow:hidden;">';
    html += '<div style="display:flex;align-items:center;padding:8px 12px;cursor:pointer;gap:8px;" onclick="_expandedPermDomain=(_expandedPermDomain===\'' + safeDomain + '\'?null:\'' + safeDomain + '\');document.getElementById(\'settings-site-permissions\').innerHTML=_renderSettingsSitePermissions();">';
    html += icon('chevronRightSmall', { size: 12, stroke: 'var(--text-dimmer)', style: 'transition:transform 0.15s;' + (isExpanded ? 'transform:rotate(90deg);' : '') });
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

const _expandedPwDomain = null;

function _loadSettingsPasswords() {
  const container = document.getElementById('settings-passwords');
  if (!container) return;
  if (!window.electronAPI || !window.electronAPI.pwList) {
    container.innerHTML = '<div class="text-dimmer text-[0.75rem]">Password storage requires the desktop app.</div>';
    return;
  }
  window.electronAPI.pwList().then(entries => {
    _renderPasswordsList(container, entries || []);
  }).catch(() => {
    container.innerHTML = '<div class="text-dimmer text-[0.75rem]">Failed to load passwords.</div>';
  });
}

function _renderPasswordsList(container, entries) {
  if (!entries.length) {
    container.innerHTML = '<div class="text-dimmer text-[0.75rem]">No saved passwords.</div>';
    return;
  }
  // Group by origin
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
    html += '<div style="border:1px solid var(--border-input);border-radius:8px;margin-bottom:6px;overflow:hidden;">';
    html += '<div style="display:flex;align-items:center;padding:8px 12px;cursor:pointer;gap:8px;" onclick="_expandedPwDomain=(_expandedPwDomain===\'' + safeOrigin + '\'?null:\'' + safeOrigin + '\');_loadSettingsPasswords();">';
    html += icon('chevronRightSmall', { size: 12, stroke: 'var(--text-dimmer)', style: 'transition:transform 0.15s;' + (isExpanded ? 'transform:rotate(90deg);' : '') });
    html += '<span style="flex:1;font-size:0.8rem;color:var(--text-primary);font-weight:500;">' + escapeHtml(origin) + '</span>';
    html += '<span style="font-size:0.68rem;color:var(--text-dimmer);">' + items.length + ' account' + (items.length !== 1 ? 's' : '') + '</span>';
    html += '</div>';
    if (isExpanded) {
      html += '<div style="padding:0 12px 8px;border-top:1px solid var(--border-subtle);">';
      for (const entry of items) {
        html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">';
        html += icon('users', { size: 14, stroke: 'var(--text-dimmer)', style: 'flex-shrink:0;' });
        html += '<span style="flex:1;font-size:0.78rem;color:var(--text-primary);">' + escapeHtml(entry.username || '(no username)') + '</span>';
        if (entry.createdAt) {
          html += '<span style="font-size:0.65rem;color:var(--text-dimmer);">' + new Date(entry.createdAt).toLocaleDateString() + '</span>';
        }
        html += '<button onclick="_pwDeleteEntry(\'' + entry.id + '\')" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-dim);font-size:0.7rem;cursor:pointer;">Delete</button>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

function _pwDeleteEntry(id) {
  if (!window.electronAPI || !window.electronAPI.pwDelete) return;
  window.electronAPI.pwDelete(id).then(() => {
    _loadSettingsPasswords();
  }).catch((e) => { console.warn('pwDelete:', e); });
}

function _loadSettingsModels() {
  apiGet('/api/models').then(data => {
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
  const annotateModel = localStorage.getItem('annotateModel') || 'qwen2.5:3b';
  const tabComplete = localStorage.getItem('panelTabComplete') !== 'off';
  const semSearch = localStorage.getItem('panelSemanticSearch') !== 'off';
  const semMin = parseInt(localStorage.getItem('panelSemanticMin') || '80', 10);
  const vaultMin = parseInt(localStorage.getItem('vaultChatMinSimilarity') || '70', 10);
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
      <h3 class="text-white_ text-sm font-semibold mb-1">Annotation Model</h3>
      <p class="text-dim text-[0.8rem] mb-3">The model used to analyze pages and highlight key findings.</p>
      <select data-key="annotateModel" data-fallback="qwen2.5:3b" onchange="localStorage.setItem('annotateModel', this.value)" class="settings-model-select w-full max-w-[320px] px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary outline-none focus:border-accent cursor-pointer">
        <option value="${escapeAttr(annotateModel)}" selected>${escapeHtml(annotateModel)}</option>
      </select>
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

function _renderAgentSettings() {
  const toolsOn = localStorage.getItem('chatTools') !== 'off';
  return `
    <div class="mb-8">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-white_ text-sm font-semibold">Chat Tools</h3>
          <p class="text-dim text-[0.8rem] mt-0.5">Allow the AI to take actions on your behalf during chat. When enabled, the model upgrades to one that supports function calling.</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="toggle-switch">
            <input type="checkbox" ${toolsOn ? 'checked' : ''} onchange="localStorage.setItem('chatTools', this.checked ? 'on' : 'off')">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <p class="text-dimmer text-[0.68rem]">Toggle in-panel via the wrench icon in the top bar. Default model with tools: <code class="text-muted">qwen3:8b</code>. Without tools: <code class="text-muted">qwen2.5:3b</code>.</p>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-white_ text-sm font-semibold">Thinking</h3>
          <p class="text-dim text-[0.8rem] mt-0.5">Let the model reason through problems step-by-step before responding. Uses more tokens but can improve answer quality.</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="toggle-switch">
            <input type="checkbox" ${localStorage.getItem('chatThinking') === 'on' ? 'checked' : ''} onchange="localStorage.setItem('chatThinking', this.checked ? 'on' : 'off')">
            <span class="slider"></span>
          </span>
        </label>
      </div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-white_ text-sm font-semibold">Voice Auto-Send</h3>
          <p class="text-dim text-[0.8rem] mt-0.5">Automatically send the message after voice transcription completes, without waiting for Enter.</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="toggle-switch">
            <input type="checkbox" ${localStorage.getItem('voiceAutoSend') === 'on' ? 'checked' : ''} onchange="localStorage.setItem('voiceAutoSend', this.checked ? 'on' : 'off')">
            <span class="slider"></span>
          </span>
        </label>
      </div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-white_ text-sm font-semibold">Auto Annotate</h3>
          <p class="text-dim text-[0.8rem] mt-0.5">Automatically annotate pages when you navigate in the browser. Highlights key findings, contradictions, claims to verify, statistics, definitions, bias, and methodology.</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="toggle-switch">
            <input type="checkbox" ${localStorage.getItem('autoAnnotate') === 'on' ? 'checked' : ''} onchange="localStorage.setItem('autoAnnotate', this.checked ? 'on' : 'off')">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <p class="text-dimmer text-[0.68rem]">When enabled, every page you visit in Browse will be annotated after a short delay. Cached annotations are reused for 5 minutes.</p>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">Available Tools</h3>
      <p class="text-dim text-[0.8rem] mb-3">When chat tools are enabled, the AI can call these functions automatically based on your message.</p>
      <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">
        <code class="text-muted">web_search</code><span class="text-dim">Search the web via DuckDuckGo</span>
        <code class="text-muted">search_papers</code><span class="text-dim">Search arXiv for academic papers</span>
        <code class="text-muted">fetch_page</code><span class="text-dim">Fetch and extract text from a URL</span>
        <code class="text-muted">save_to_reading_list</code><span class="text-dim">Bookmark a post to your reading list</span>
        <code class="text-muted">navigate</code><span class="text-dim">Navigate to a specific app view</span>
        <code class="text-muted">create_experiment</code><span class="text-dim">Create a new project in the vault</span>
        <code class="text-muted">create_calendar_event</code><span class="text-dim">Add an event to your calendar</span>
      </div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">System Prompts</h3>
      <p class="text-dim text-[0.8rem] mb-3">The AI receives different system instructions depending on context. Dynamic values shown in <code class="text-accent">orange</code>.</p>
      <div class="space-y-3">
        <div class="p-3 rounded-lg border border-border-subtle bg-card/50">
          <div class="text-[0.75rem] font-medium text-muted mb-2">With document + tools</div>
          <pre class="text-dim text-[0.72rem] whitespace-pre-wrap leading-relaxed font-mono">You are a helpful research assistant. The user is reading a document. Answer their questions based on the document text below when relevant. You also have tools available to search the web, find papers, fetch pages, bookmark posts, navigate the app, and create experiments.\n\nToday is <span class="text-accent">Wednesday, 2026-02-09</span>. The current time is <span class="text-accent">3:45 PM</span>. The user is currently viewing: "<span class="text-accent">Page Title</span>" (<span class="text-accent">https://...</span>). Use this when they refer to "this page", "this paper", etc.\n\n--- DOCUMENT TEXT ---\n<span class="text-accent">[extracted text, up to 12k chars]</span>\n--- END ---</pre>
        </div>
        <div class="p-3 rounded-lg border border-border-subtle bg-card/50">
          <div class="text-[0.75rem] font-medium text-muted mb-2">With document, no tools</div>
          <pre class="text-dim text-[0.72rem] whitespace-pre-wrap leading-relaxed font-mono">You are a helpful research assistant. The user is reading a document. Answer their questions based ONLY on the document text below. Do not make up information that is not in the document.\n\n--- DOCUMENT TEXT ---\n<span class="text-accent">[extracted text, up to 12k chars]</span>\n--- END ---</pre>
        </div>
        <div class="p-3 rounded-lg border border-border-subtle bg-card/50">
          <div class="text-[0.75rem] font-medium text-muted mb-2">No document + tools</div>
          <pre class="text-dim text-[0.72rem] whitespace-pre-wrap leading-relaxed font-mono">You are a helpful assistant with tools to search the web, find papers, fetch page content, bookmark posts, navigate the app, and create experiments. Use tools when they would help answer the user's question.\n\nToday is <span class="text-accent">Wednesday, 2026-02-09</span>. The current time is <span class="text-accent">3:45 PM</span>.</pre>
        </div>
        <div class="p-3 rounded-lg border border-border-subtle bg-card/50">
          <div class="text-[0.75rem] font-medium text-muted mb-2">No document, no tools</div>
          <pre class="text-dim text-[0.72rem] whitespace-pre-wrap leading-relaxed font-mono">You are a helpful assistant.</pre>
        </div>
        <div class="p-3 rounded-lg border border-border-subtle bg-card/50">
          <div class="text-[0.75rem] font-medium text-muted mb-2">Vision mode (screenshot)</div>
          <pre class="text-dim text-[0.72rem] whitespace-pre-wrap leading-relaxed font-mono">You are a helpful visual analysis assistant. The user has taken a screenshot and wants to ask about it. Describe what you see and answer their questions based on the visual content provided.</pre>
        </div>
      </div>
    </div>
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">How It Works</h3>
      <div class="space-y-2 text-[0.8rem] text-dim">
        <p>When tools are enabled, the AI can decide to call one or more tools in a single response. You'll see a thinking indicator (e.g. "Searching web\u2026", "Adding to calendar\u2026") while the tool runs.</p>
        <p>Tool results are fed back to the model so it can incorporate them into its reply. Some tools also trigger UI actions \u2014 for example, <code class="text-muted">navigate</code> switches your view and <code class="text-muted">create_calendar_event</code> opens the calendar.</p>
        <p>The model automatically upgrades to <code class="text-muted">qwen3:8b</code> when tools are on, since smaller models don't reliably handle function calling. You can override this in Lookup Panel settings.</p>
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

let _memoryListLoaded = [];
let _memoryTotal = 0;

function _renderMemorySettings() {
  return '<div id="memory-stats-banner" class="mb-4 p-3 rounded-lg border border-border-subtle bg-card/50">' +
    '<div class="text-dimmer text-[0.75rem]">Loading memory stats...</div></div>' +
    '<div class="flex items-center justify-between mb-3">' +
    '<span class="text-muted text-[0.75rem]" id="memory-count-label"></span>' +
    '<button onclick="_clearAllMemories()" class="text-[0.7rem] text-red-400 hover:text-red-300 transition-colors">Clear All</button></div>' +
    '<div id="memory-list" class="flex flex-col gap-2" style="max-height:60vh;overflow-y:auto;"></div>' +
    '<div id="memory-load-more" class="mt-3 text-center" style="display:none;">' +
    '<button onclick="_loadMemoryList(' + 0 + ')" class="text-[0.7rem] text-accent hover:underline">Load more</button></div>' +
    '<div id="memory-empty" class="text-center py-8" style="display:none;">' +
    '<div class="text-dimmer text-[0.8rem]">No memories yet. Chat with Aether and memories will be saved automatically.</div></div>';
}

function _renderMemoryCard(mem) {
  const summary = mem.summary.length > 150 ? mem.summary.slice(0, 150) + '...' : mem.summary;
  const topics = (mem.topics || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean);
  const topicChips = topics.map(function(t) {
    return '<span class="inline-block px-1.5 py-0.5 text-[0.6rem] rounded-full bg-accent/10 text-accent">' + escapeHtml(t) + '</span>';
  }).join(' ');
  const ago = typeof timeAgo === 'function' ? timeAgo(mem.created_at * 1000) : new Date(mem.created_at * 1000).toLocaleDateString();
  const pageInfo = mem.page_title ? '<span class="text-dimmer text-[0.6rem]">' + escapeHtml(mem.page_title) + '</span>' : '';
  return '<div class="p-3 rounded-lg border border-border-subtle bg-card/50 group" id="mem-card-' + mem.id + '">' +
    '<div class="flex items-start justify-between gap-2">' +
    '<div class="flex-1 min-w-0">' +
    '<div class="text-[0.78rem] text-primary leading-snug mb-1">' + escapeHtml(summary) + '</div>' +
    (topicChips ? '<div class="flex flex-wrap gap-1 mb-1">' + topicChips + '</div>' : '') +
    '<div class="flex items-center gap-2">' +
    '<span class="text-dimmer text-[0.6rem]">' + ago + '</span>' +
    (mem.message_count ? '<span class="text-dimmer text-[0.6rem]">' + mem.message_count + ' msgs</span>' : '') +
    pageInfo +
    '</div></div>' +
    '<button onclick="_deleteMemory(' + mem.id + ')" class="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all p-1" title="Delete memory">' +
    icon('close', { size: 12 }) + '</button>' +
    '</div></div>';
}

function _loadMemoryList(offset) {
  apiGet('/api/chat-memories/list?limit=30&offset=' + offset)
    .then(function(data) {
      const list = document.getElementById('memory-list');
      const empty = document.getElementById('memory-empty');
      const countLabel = document.getElementById('memory-count-label');
      const loadMore = document.getElementById('memory-load-more');
      if (!list) return;
      _memoryTotal = data.total || 0;
      if (offset === 0) {
        _memoryListLoaded = data.memories || [];
        list.innerHTML = '';
      } else {
        _memoryListLoaded = _memoryListLoaded.concat(data.memories || []);
      }
      if (_memoryListLoaded.length === 0) {
        if (empty) empty.style.display = '';
        if (countLabel) countLabel.textContent = '';
        return;
      }
      if (empty) empty.style.display = 'none';
      if (countLabel) countLabel.textContent = _memoryTotal + ' memories';
      let html = '';
      for (let i = (offset === 0 ? 0 : _memoryListLoaded.length - (data.memories || []).length); i < _memoryListLoaded.length; i++) {
        html += _renderMemoryCard(_memoryListLoaded[i]);
      }
      if (offset === 0) list.innerHTML = html;
      else list.insertAdjacentHTML('beforeend', html);
      if (loadMore) {
        if (_memoryListLoaded.length < _memoryTotal) {
          loadMore.style.display = '';
          loadMore.innerHTML = '<button onclick="_loadMemoryList(' + _memoryListLoaded.length + ')" class="text-[0.7rem] text-accent hover:underline">Load more</button>';
        } else {
          loadMore.style.display = 'none';
        }
      }
    }).catch(function(e) { console.warn('loadMemoryList:', e); });

  // Also load stats
  if (offset === 0) {
    apiGet('/api/chat-memories/stats')
      .then(function(stats) {
        const banner = document.getElementById('memory-stats-banner');
        if (!banner) return;
        if (!stats.total_count) {
          banner.innerHTML = '<div class="text-dimmer text-[0.75rem]">No memories stored yet.</div>';
          return;
        }
        const oldest = stats.oldest_ts ? new Date(stats.oldest_ts * 1000).toLocaleDateString() : '?';
        const newest = stats.newest_ts ? new Date(stats.newest_ts * 1000).toLocaleDateString() : '?';
        const topicChips = (stats.top_topics || []).map(function(t) {
          return '<span class="inline-block px-1.5 py-0.5 text-[0.6rem] rounded-full bg-accent/10 text-accent">' + escapeHtml(t.topic) + ' <span class="text-dimmer">(' + t.count + ')</span></span>';
        }).join(' ');
        banner.innerHTML = '<div class="flex items-center gap-3 mb-2">' +
          '<span class="text-primary text-[0.85rem] font-medium">' + stats.total_count + ' memories</span>' +
          '<span class="text-dimmer text-[0.7rem]">' + oldest + ' — ' + newest + '</span></div>' +
          (topicChips ? '<div class="flex flex-wrap gap-1">' + topicChips + '</div>' : '');
      }).catch(function(e) { console.warn('loadMemoryStats:', e); });
  }
}

function _deleteMemory(id) {
  apiDelete('/api/chat-memories/' + id)
    .then(function() {
      const card = document.getElementById('mem-card-' + id);
      if (card) card.remove();
      _memoryTotal--;
      _memoryListLoaded = _memoryListLoaded.filter(function(m) { return m.id !== id; });
      const countLabel = document.getElementById('memory-count-label');
      if (countLabel) countLabel.textContent = _memoryTotal + ' memories';
      if (_memoryListLoaded.length === 0) {
        const empty = document.getElementById('memory-empty');
        if (empty) empty.style.display = '';
      }
    }).catch(function(e) { console.warn('deleteMemory:', e); });
}

function _clearAllMemories() {
  if (!confirm('Delete all memories? This cannot be undone.')) return;
  const promises = _memoryListLoaded.map(function(m) {
    return apiDelete('/api/chat-memories/' + m.id);
  });
  Promise.all(promises).then(function() {
    _memoryListLoaded = [];
    _memoryTotal = 0;
    const list = document.getElementById('memory-list');
    if (list) list.innerHTML = '';
    const empty = document.getElementById('memory-empty');
    if (empty) empty.style.display = '';
    const countLabel = document.getElementById('memory-count-label');
    if (countLabel) countLabel.textContent = '';
    const banner = document.getElementById('memory-stats-banner');
    if (banner) banner.innerHTML = '<div class="text-dimmer text-[0.75rem]">No memories stored yet.</div>';
  }).catch(function(e) { console.warn('clearAllMemories:', e); });
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
    const titles = { profile: 'Profile', appearance: 'Appearance', feed: 'Feed & Reading', tools: 'Tools', browser: 'Browser', panel: 'Lookup Panel', agent: 'Agent', prompts: 'Prompts', memory: 'Memory', help: 'Help' };
    let content = '<h2 class="text-[1.2rem] font-semibold text-primary mb-5">' + (titles[_settingsSection] || 'Settings') + '</h2>';

    if (_settingsSection === 'profile') {
      content += _renderAccountSettings();
      content += '<div class="mt-6 p-3 rounded-lg border border-border-subtle bg-card/50"><div class="flex items-center gap-2 text-[0.8rem]">' + icon('helpCircle', { size: 15, stroke: 'var(--accent)' }) + '<span class="text-primary">Right-click anywhere and type <kbd class="kbd-key" style="font-size:0.7rem">/help</kbd> to see all commands, instant answers & shortcuts.</span></div></div>';
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
    } else if (_settingsSection === 'agent') {
      content += _renderAgentSettings();
    } else if (_settingsSection === 'prompts') {
      content += _renderPromptsSettings();
    } else if (_settingsSection === 'memory') {
      content += _renderMemorySettings();
    } else if (_settingsSection === 'help') {
      content += _renderHelpSettings();
    }

    pane.innerHTML = content;
  }

  // Load version
  apiGet('/api/version').then(v => {
    const el = document.getElementById('settings-version');
    if (el && v.version) el.textContent = 'v' + v.version + (v.sha ? ' (' + v.sha + ')' : '');
  }).catch((e) => { /* fire-and-forget */ });

  // Section-specific post-render hooks
  if (_settingsSection === 'appearance') {
    updateSpinnerPreview(getSelectedSpinner());
  } else if (_settingsSection === 'feed') {
    if (_settingsFeedTab === 'quality') {
      if (typeof renderBlockedWordsList === 'function') renderBlockedWordsList();
      apiGet('/api/quality-prompt').then(function(data) {
        if (data.prompt) {
          localStorage.setItem('qualityPrompt', data.prompt);
          const el = document.getElementById('quality-prompt-input');
          if (el) el.value = data.prompt;
        }
        const scoringEl = document.getElementById('scoring-prompt-display');
        if (scoringEl && data.scoringPrompt) scoringEl.textContent = data.scoringPrompt;
      }).catch(function(e){ console.warn('loadQualityPrompt:', e); });
    } else if (_settingsFeedTab === 'algorithm') {
      if (typeof _renderPersonalizationPanel === 'function') _renderPersonalizationPanel();
    }
  } else if (_settingsSection === 'tools') {
    loadVaultPath();
  } else if (_settingsSection === 'browser') {
    _urlBarSectionDragSetup();
    _loadSettingsPasswords();
    if (window.electronAPI && window.electronAPI.adblockStats) {
      window.electronAPI.adblockStats().then(stats => {
        const el = document.getElementById('adblock-rules-info');
        if (!el) return;
        if (stats.lists && stats.lists.length > 0) {
          const count = (stats.ruleCount || 0).toLocaleString();
          el.textContent = `${stats.lists.join(' + ')}: ${count} rules loaded.`;
        } else {
          el.textContent = 'No filter lists loaded yet. Click "Update filter lists" to download.';
        }
      }).catch((e) => { /* fire-and-forget */ });
    }
  } else if (_settingsSection === 'prompts') {
    _loadPromptsData();
  } else if (_settingsSection === 'memory') {
    _loadMemoryList(0);
  }
}

async function loadVaultPath() {
  const input = document.getElementById('vault-path-input');
  const status = document.getElementById('vault-path-status');
  if (!input) return;
  try {
    const data = await apiGet('/api/vault/path');
    input.value = data.path || '';
    input.placeholder = data.default || '';
    if (status) {
      status.textContent = data.isCustom ? 'Using custom path' : 'Using default path';
      status.className = 'text-[0.75rem] mt-2 ' + (data.isCustom ? 'text-accent' : 'text-dimmer');
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
    const data = await apiPut('/api/vault/path', { path });
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
  } catch (e) {
    if (status) {
      status.textContent = e.error || 'Failed to save vault path';
      status.className = 'text-[0.75rem] mt-2 text-red-400';
    }
  }
}

async function resetVaultPath() {
  const input = document.getElementById('vault-path-input');
  const status = document.getElementById('vault-path-status');
  try {
    await apiPut('/api/vault/path', { path: '' });
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
  } catch (e) {
    if (status) {
      status.textContent = 'Failed to reset';
      status.className = 'text-[0.75rem] mt-2 text-red-400';
    }
  }
}
