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
      <div class="flex items-center justify-between">
        <span class="text-primary text-sm">Name</span>
        <input type="text" value="${escapeAttr(localStorage.getItem('userName') || '')}" placeholder="Your name" onchange="localStorage.setItem('userName', this.value.trim())" class="w-40 px-2.5 py-1 rounded-md border border-border-input bg-card text-primary text-[0.82rem] focus:outline-none focus:border-accent transition-colors" />
      </div>
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
            ${['cat','dog','bunny','bird','frog'].map(t => {
              const sel = (localStorage.getItem('pixelPetType') || 'cat') === t;
              return `<button onclick="setPixelPetType('${t}')" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">${t}</button>`;
            }).join('')}
          </div>
          <div class="flex gap-1">
            ${['free','sidebar'].map(m => {
              const sel = (localStorage.getItem('pixelPetMode') || 'free') === m;
              return `<button onclick="setPixelPetMode('${m}')" class="px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ${sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'}">${m}</button>`;
            }).join('')}
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${localStorage.getItem('pixelPet') === 'on' ? 'checked' : ''} onchange="togglePixelPet(this.checked)">
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
}

function setTheme(theme) {
  localStorage.setItem('theme', theme);
  fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme })
  }).catch(() => {});
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  ['dark', 'light', 'sepia'].forEach(t => {
    const btn = document.getElementById('theme-btn-' + t);
    if (btn) btn.className = `px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${theme === t ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}`;
  });
}

function setAccentColor(color) {
  localStorage.setItem('accentColor', color);
  applyAccentColor(color);
  fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accentColor: color })
  }).catch(() => {});
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
  const accent = localStorage.getItem('accentColor');
  if (accent) applyAccentColor(accent);
}

applyStoredAppearance();
