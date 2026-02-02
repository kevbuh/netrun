function openSettings() {
  hideAllViews();
  const view = document.getElementById('settings-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'settings';
  setSidebarActive('sb-settings');
  renderSettingsView();
}

function renderSettingsView() {
  const container = document.getElementById('settings-view-content');
  const sources = getFeedSources();
  const bypassMap = getQualityBypass();
  const cache = getQualityCache();
  const cacheEntries = Object.entries(cache);
  const keptCount = cacheEntries.filter(([, v]) => (v?.v || v) === 'keep').length;
  const skippedCount = cacheEntries.filter(([, v]) => (v?.v || v) === 'skip').length;
  const testTitles = getTestTitles();
  const blockedWords = getBlockedWords();

  const cats = []; const catMap = {};
  FEED_CATALOG.forEach(f => {
    if (!catMap[f.cat]) { catMap[f.cat] = []; cats.push(f.cat); }
    catMap[f.cat].push(f);
  });

  const currentTheme = localStorage.getItem('theme') || 'dark';
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

  container.innerHTML = `
    <h2 class="text-[1.3rem] font-semibold text-white_ mb-6">Settings</h2>

    <!-- PROFILE -->
    <div class="mb-8">
      <h3 class="text-white_ text-sm font-semibold mb-3">Profile</h3>
      <div class="flex items-center gap-4 mb-4">
        ${_authUserInfo?.picture
          ? `<img src="${escapeAttr(_authUserInfo.picture)}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`
          : `<div style="width:56px;height:56px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:600;color:#fff;flex-shrink:0;">${escapeHtml((_authUserInfo?.username || '?')[0].toUpperCase())}</div>`
        }
        <div>
          <div class="text-primary font-semibold text-[0.95rem]">${escapeHtml(_authUserInfo?.username || '')}</div>
          <div class="text-dim text-[0.8rem]">${escapeHtml(_authUserInfo?.name || '')}</div>
          <div class="text-dim text-[0.75rem]">${escapeHtml(_authUserInfo?.email || '')}</div>
        </div>
      </div>
      <div class="flex gap-2">
        <button onclick="_doLogout()" class="px-3 py-1 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-red-500 hover:text-red-400 cursor-pointer transition-colors">Sign Out</button>
        <button onclick="_doDeleteAccount()" class="px-3 py-1 rounded-md text-[0.78rem] border border-red-800/50 text-red-400/70 bg-card hover:border-red-500 hover:text-red-400 cursor-pointer transition-colors">Delete Account</button>
      </div>
    </div>

    <!-- TEAMS -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">Teams</h3>
      <div id="teams-section-content"></div>
      <div id="create-team-form"></div>
    </div>

    <!-- APPEARANCE -->
    <div class="mb-8">
      <h3 class="text-white_ text-sm font-semibold mb-3">Appearance</h3>
      <div class="flex items-center justify-between mb-4">
        <span class="text-primary text-sm">Theme</span>
        <div class="flex gap-1.5">
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
            ${['cat','dog','bunny','froog','pacman'].map(t => {
              const sel = (localStorage.getItem('pixelPetType') || 'cat') === t;
              return `<button onclick="setPixelPetType('${t}')" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">${t}</button>`;
            }).join('')}
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${localStorage.getItem('pixelPet') === 'on' ? 'checked' : ''} onchange="togglePixelPet(this.checked)">
            <span class="slider"></span>
          </label>
        </div>
      </div>
      <div class="flex items-center justify-between mt-4">
        <span class="text-primary text-sm">Ambient Sound</span>
        <div class="flex items-center gap-2">
          <span id="rain-volume-value" class="text-[0.7rem] text-dimmer font-mono cursor-ns-resize select-none" title="Drag up/down to adjust volume" onmousedown="_rainVolDragStart(event)">${Math.round(_rainVolume * 100)}%</span>
          <div class="flex gap-1">
            ${Object.entries(NOISE_PRESETS).map(([key, p]) => {
              const sel = _rainNoiseType === key;
              return `<button onclick="setRainNoiseType('${key}'); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">${p.label}</button>`;
            }).join('')}
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${isRainSidebarVisible() ? 'checked' : ''} onchange="setRainSidebarVisible(this.checked)" title="Show in sidebar">
            <span class="slider"></span>
          </label>
        </div>
      </div>
      <div class="flex items-center justify-between mt-4">
        <span class="text-primary text-sm">Button Sounds</span>
        <div class="flex items-center gap-2">
          <div class="flex gap-1">
            ${Object.entries(CLICK_SOUND_PRESETS).map(([key, p]) => {
              const sel = (localStorage.getItem('clickSoundType') || 'thud') === key;
              return `<button onclick="setClickSoundType('${key}'); renderSettingsView()" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">${p.label}</button>`;
            }).join('')}
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${_clickSoundOn ? 'checked' : ''} onchange="toggleClickSound(this.checked)">
            <span class="slider"></span>
          </label>
        </div>
      </div>
    </div>

    <!-- FEED SOURCES -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">Feed Sources</h3>
      <div class="flex flex-wrap gap-2.5">
        ${FEED_CATALOG.map(f => {
          const on = sources[f.key];
          const logo = f.favicon
            ? `<img src="https://www.google.com/s2/favicons?domain=${f.favicon}&sz=64" class="h-6 w-6 rounded" alt="${f.name}">`
            : f.img
              ? `<img src="${f.img}" class="h-5 w-auto" alt="${f.name}">`
              : (() => {
                  const stroke = f.stroke ? ` stroke="${f.stroke}"` : '';
                  const font = f.font || 'Georgia,serif';
                  const fs = (f.letter || '').length > 1 ? 140 : 170;
                  return `<svg class="h-6 w-auto" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="${f.bg}"${stroke} width="256" height="256" rx="24"/><text x="128" y="185" text-anchor="middle" fill="${f.fg}" font-size="${fs}" font-weight="bold" font-family="${font}">${f.letter}</text></svg>`;
                })();
          return `<button onclick="toggleFeedSource('${f.key}', ${!on}); renderSettingsView()" class="flex flex-col items-center justify-center w-[72px] h-[80px] rounded-xl border cursor-pointer transition-all duration-150 ${on ? 'border-accent bg-accent/10 shadow-sm' : 'border-border-card bg-card opacity-40 hover:opacity-70'}" title="${f.name}">
            <div class="mb-1.5">${logo}</div>
            <div class="text-[0.65rem] ${on ? 'text-primary' : 'text-dimmer'} leading-tight text-center px-1 truncate w-full">${f.name}</div>
          </button>`;
        }).join('')}
      </div>
    </div>

    <!-- CUSTOM RSS FEEDS -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">Custom RSS Feeds</h3>
      <div id="custom-feeds-list" class="flex flex-col gap-2 mb-3"></div>
      <div class="flex gap-2">
        <input type="text" id="custom-feed-url" placeholder="https://example.com/feed.xml" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();addCustomFeed()}">
        <button onclick="addCustomFeed()" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover">Add</button>
      </div>
    </div>

    <!-- BLOCKED WORDS -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-2">Blocked Words</h3>
      <p class="text-dimmer text-[0.75rem] mb-3">Posts with titles containing any of these words will be automatically hidden.</p>
      <div class="flex gap-2 mb-3">
        <input type="text" id="blocked-word-input" placeholder="e.g. politics, lawsuit, review" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();addBlockedWord()}">
        <button onclick="addBlockedWord()" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover">Add</button>
      </div>
      <div id="blocked-words-list" class="flex flex-wrap gap-1.5"></div>
    </div>

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

    <!-- AI QUALITY FILTER -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center gap-3 mb-1">
        <h3 class="text-white_ text-sm font-semibold">AI Quality Filter</h3>
        <span class="text-dimmer text-[0.68rem]">qwen2.5:7b</span>
        <label class="flex items-center gap-2 cursor-pointer ml-auto">
          <span class="text-primary text-sm">Enable</span>
          <span class="toggle-switch">
            <input type="checkbox" id="toggle-quality-filter" ${isQualityFilterOn() ? 'checked' : ''} onchange="setQualityFilter(this.checked)">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <p class="text-dim text-[0.8rem] mb-4">Uses a local LLM (Ollama) to hide low-quality posts. Two phases: verdict (KEEP/SKIP), then scoring.</p>

      <div class="mb-5">
        <h4 class="text-muted text-[0.8rem] font-medium mb-2">Verdict Prompt</h4>
        <p class="text-dimmer text-[0.72rem] mb-2">Classifies each post title as KEEP or SKIP.</p>
        <textarea id="quality-prompt-input" rows="6" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-primary text-[0.78rem] font-mono leading-relaxed outline-none focus:border-accent resize-y" spellcheck="false">${escapeHtml(getQualityPrompt())}</textarea>
        <div class="flex items-center justify-end mt-2">
          <button onclick="saveQualityPrompt()" class="bg-accent text-white text-[0.78rem] px-3 py-1 rounded-md border-none cursor-pointer hover:bg-accent-hover">Save prompt</button>
        </div>
      </div>

      <div class="mb-5">
        <h4 class="text-muted text-[0.8rem] font-medium mb-2">Scoring Prompt & Threshold</h4>
        <p class="text-dimmer text-[0.72rem] mb-2">Posts passing the verdict are scored 0–100%. Below threshold = hidden.</p>
        <div id="scoring-prompt-display" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-dim text-[0.78rem] font-mono leading-relaxed whitespace-pre-wrap mb-3">Loading…</div>
        <div class="flex items-center gap-3">
          <input type="range" id="quality-threshold-slider" min="0" max="100" value="${getQualityThreshold()}" oninput="document.getElementById('quality-threshold-value').textContent=this.value+'%'" onchange="setQualityThreshold(parseInt(this.value))" class="flex-1 accent-[var(--accent)]" />
          <span id="quality-threshold-value" class="text-primary text-sm font-mono w-10 text-right">${getQualityThreshold()}%</span>
        </div>
        <p class="text-dimmer text-[0.68rem] mt-1">Minimum score to display (0% = show all kept, 100% = strictest)</p>
      </div>

      <div class="mb-5">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-muted text-[0.8rem] font-medium">Prompt Test Suite <span class="text-dim font-normal">(<span id="test-title-count">${testTitles.length}</span> titles)</span></h4>
          <button onclick="clearTestTitles()" class="text-dim text-[0.72rem] hover:text-red-400 bg-transparent border-none cursor-pointer">Clear tests</button>
        </div>
        <p class="text-dimmer text-[0.72rem] mb-2">Titles hidden with ✕ are collected here. All should be classified as SKIP.</p>
        <button onclick="runPromptTest()" class="bg-input border border-border-input text-primary text-[0.78rem] px-3 py-1.5 rounded-md cursor-pointer hover:border-accent mb-2">Run test</button>
        <div id="prompt-test-results"></div>
      </div>

      <div class="mb-5">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-muted text-[0.8rem] font-medium">Blocked Posts</h4>
          <button onclick="clearAllBlockedPosts()" class="text-dim text-[0.72rem] hover:text-red-400 bg-transparent border-none cursor-pointer">Clear manual blocks</button>
        </div>
        <div id="quality-blocked-list" class="text-[0.78rem] text-muted max-h-[300px] overflow-y-auto"></div>
      </div>

      <div class="flex items-center justify-between">
        <div class="text-dim text-[0.78rem]">
          Cached: ${cacheEntries.length} &middot; Kept: ${keptCount} &middot; Skipped: ${skippedCount}
        </div>
        <button onclick="resetEverything()" class="text-red-400/80 text-[0.78rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors">Reset all &amp; clear cache</button>
      </div>
    </div>
  `;

  renderCustomFeedsList();
  renderBlockedWordsList();
  renderBlockedList();
  fetchTestTitlesFromServer().then(() => updateTestTitleCount());
  fetch('/api/quality-prompt').then(r => r.json()).then(data => {
    if (data.prompt) {
      localStorage.setItem('qualityPrompt', data.prompt);
      const el = document.getElementById('quality-prompt-input');
      if (el) el.value = data.prompt;
    }
    const scoringEl = document.getElementById('scoring-prompt-display');
    if (scoringEl && data.scoringPrompt) scoringEl.textContent = data.scoringPrompt;
  }).catch(() => {});
  // Start spinner preview
  updateSpinnerPreview(getSelectedSpinner());
  // Load teams section
  if (typeof fetchTeams === 'function') {
    fetchTeams().then(() => renderTeamsSection());
  }
}

function setTheme(theme) {
  localStorage.setItem('theme', theme);
  stopDaylightTheme();
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  if (theme === 'daylight') startDaylightTheme();
  ['dark', 'light', 'sepia', 'daylight', 'thermal'].forEach(t => {
    const btn = document.getElementById('theme-btn-' + t);
    if (btn) btn.className = `px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${theme === t ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}`;
  });
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
  const theme = localStorage.getItem('theme') || 'dark';
  if (theme !== 'dark') document.documentElement.setAttribute('data-theme', theme);
  if (theme === 'daylight') startDaylightTheme();
  const accent = localStorage.getItem('accentColor');
  if (accent) applyAccentColor(accent);
  const edTheme = localStorage.getItem('editorTheme');
  if (edTheme && edTheme !== 'auto') document.documentElement.setAttribute('data-editor-theme', edTheme);
}

applyStoredAppearance();
