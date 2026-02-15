// core-auth.js — Auth system, sync
// Extracted from core.js

// ── User accounts & sync ──

let GOOGLE_CLIENT_ID = '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com';
fetch('/api/client-config').then(r => r.json()).then(c => {
  if (c.googleClientId) GOOGLE_CLIENT_ID = c.googleClientId;
}).catch(() => {});
// Hydrate token from secure storage (macOS Keychain) if available
if (!_authToken && window.electronAPI?.getAuthToken) {
  window.electronAPI.getAuthToken().then(t => {
    if (t && !_authToken) { _authToken = t; localStorage.setItem('authToken', t); }
  });
}
let _authUser = localStorage.getItem('authUser') || null;  // email or name
let _syncInterval = null;
let _authReady = false;  // true once login gate has been resolved

// Track dirty sync keys so we only serialize changed ones
const _syncDirtyKeys = new Set();
const _syncKeysSet = new Set();
(function() {
  const origSetItem = localStorage.setItem.bind(localStorage);
  const origRemoveItem = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    if (_syncKeysSet.has(key)) _syncDirtyKeys.add(key);
    return origSetItem(key, value);
  };
  localStorage.removeItem = function(key) {
    if (_syncKeysSet.has(key)) _syncDirtyKeys.add(key);
    return origRemoveItem(key);
  };
})();

// Keys to sync between devices (all user settings)
const SYNC_KEYS = [
  'feedSources', 'customFeeds', 'qualityFilter', 'qualityPrompt',
  'qualityThreshold', 'qualityCache', 'hiddenPosts', 'savedPosts',
  'readPosts', 'qualityTestTitles', 'paperRatings', 'theme',
  'accentColor', 'spinner', 'userName', 'sidebarOrder',
  'clickSound', 'clickSoundType', 'clickAether', 'rainNoiseType', 'rainVolume', 'rainFreq',
  'editorTheme', 'rainSidebarVisible',
  'pixelPet', 'pixelPetType', 'pixelPetMode',
  'feedNotifications', 'seenPostLinks',
  'adBlockEnabled', 'feedNotifSources', 'browseBarOrder',
  'browseHistory', 'webSearchHistory', 'chatThreads',
  'aetherColor',
  'interestProfile',
  'urlBarSections',
  'blockedWords', 'qualityBypass', 'searchHistory', 'userQuotes', 'repostedLinks',
  'fyWeightBase', 'fyWeightAffinity', 'fyWeightRecency', 'maxPerCategoryRun',
  'smartHighlights',
  'chatModel', 'chatTools', 'insightsAllowHeuristics',
  'iconSize', 'hiddenSidebarIcons'
];
SYNC_KEYS.forEach(k => _syncKeysSet.add(k));

// Default ad blocker to enabled
if (localStorage.getItem('adBlockEnabled') === null) {
  localStorage.setItem('adBlockEnabled', 'true');
}


// ── localStorage helpers (reduce try/parse/default boilerplate) ──
function getLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function setLS(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ── Auth fetch helper (reduces fetch+auth+error boilerplate) ──
// ── Login gate ──

function _showLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.style.display = '';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      _renderGoogleButton();
    });
  } else {
    _renderGoogleButton();
  }
}

function _hideLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.style.display = 'none';
}

let _gisRetries = 0;
function _renderGoogleButton() {
  const container = document.getElementById('google-signin-btn');
  if (!container) { logger.warn('auth no google-signin-btn container'); return; }
  // Wait for GIS library to load (up to ~10s)
  if (typeof google === 'undefined' || !google.accounts) {
    _gisRetries++;
    if (_gisRetries % 10 === 1) logger.debug('auth waiting for GIS library... attempt', _gisRetries);
    if (_gisRetries < 50) {
      setTimeout(_renderGoogleButton, 200);
    } else {
      logger.error('auth Google Identity Services failed to load after 50 attempts');
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Google Sign-In failed to load. Check that accounts.google.com is reachable and the current origin is an authorized JavaScript origin in your Google Cloud Console.</p>';
    }
    return;
  }
  logger.debug('auth GIS loaded, rendering button');
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: _handleGoogleCredential,
    });
    // Render real Google button inside a wrapper we style ourselves
    container.innerHTML = '<div id="google-btn-real"></div>';
    google.accounts.id.renderButton(document.getElementById('google-btn-real'), {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      width: 280,
    });
  } catch (e) {
    console.error('[auth] GIS renderButton error:', e);
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Google Sign-In error: ' + e.message + '</p>';
  }
}

async function _handleGoogleCredential(response) {
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.textContent = '';
  try {
    const data = await apiPost('/api/auth/google', { credential: response.credential });
    _authToken = data.token;
    _authUser = (data.name || data.email || '').split(' ')[0];
    _authUserInfo = { email: data.email, name: data.name, username: data.username || null, picture: data.picture || null, google_id: data.google_id || null };
    localStorage.setItem('authToken', _authToken);
    window.electronAPI?.saveAuthToken?.(_authToken);
    localStorage.setItem('authUser', _authUser);
    localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
    // Clear any stale user data before pulling new user's data
    for (const key of SYNC_KEYS) localStorage.removeItem(key);
    // Sync: pull from server for returning users
    await syncFromServer();
    if (!data.username) {
      _showOnboardingWizard();
    } else {
      _onLoginSuccess();
    }
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

// ── Username picker ──

function _showUsernamePicker() {
  const container = document.getElementById('google-signin-btn');
  if (!container) return;
  container.innerHTML = `
    <div style="text-align:center;max-width:320px;margin:0 auto;">
      <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">Choose a username</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">This will be your public identity for comments.</div>
      <div style="position:relative;">
        <input id="username-input" type="text" maxlength="20" placeholder="username"
          style="width:100%;box-sizing:border-box;padding:8px 12px;font-size:14px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input,var(--bg-secondary));color:var(--text-primary);outline:none;" />
        <div id="username-hint" style="font-size:11px;color:var(--text-muted);margin-top:4px;text-align:left;">2-20 chars: letters, numbers, hyphens, underscores</div>
      </div>
      <div id="username-error" style="font-size:12px;color:#e74c3c;margin-top:8px;min-height:18px;"></div>
      <button id="username-submit-btn" onclick="_submitUsername()"
        style="margin-top:8px;padding:8px 24px;font-size:14px;font-weight:500;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;opacity:0.5;" disabled>
        Continue
      </button>
    </div>
  `;
  const input = document.getElementById('username-input');
  input.addEventListener('input', () => {
    const val = input.value.replace(/[^a-zA-Z0-9_-]/g, '');
    if (val !== input.value) input.value = val;
    const btn = document.getElementById('username-submit-btn');
    const valid = val.length >= 2 && val.length <= 20;
    btn.disabled = !valid;
    btn.style.opacity = valid ? '1' : '0.5';
    document.getElementById('username-error').textContent = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const btn = document.getElementById('username-submit-btn');
      if (!btn.disabled) _submitUsername();
    }
  });
  input.focus();
}

async function _submitUsername() {
  const input = document.getElementById('username-input');
  const errEl = document.getElementById('username-error');
  const btn = document.getElementById('username-submit-btn');
  if (!input || !errEl) return;
  const username = input.value.trim();
  if (username.length < 2 || username.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    errEl.textContent = 'Invalid username format';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    const data = await apiPost('/api/auth/username', { username });
    _authUserInfo.username = data.username;
    localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
    _onLoginSuccess();
  } catch (e) {
    errEl.textContent = e.message || 'Network error, please try again';
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

// ── Onboarding Wizard ──
// Steps: 0=Welcome, 1=Username, 2=Accent Color, 3=Theme, 4=Neuralook, 5=Finale

let _wizardStep = 0;
const _wizardTotalSteps = 6;

const _wizardAccentColors = [
  { color: '#b4451a', name: 'Orange' },
  { color: '#e53e3e', name: 'Red' },
  { color: '#d69e2e', name: 'Gold' },
  { color: '#38a169', name: 'Green' },
  { color: '#3182ce', name: 'Blue' },
  { color: '#805ad5', name: 'Purple' },
  { color: '#d53f8c', name: 'Pink' },
  { color: '#718096', name: 'Gray' },
];

const _wizardThemes = [
  { id: 'dark',     name: 'Dark',     desc: 'Easy on the eyes',     bg: '#0a0a0a', bar: '#151515', card: '#151515', text: '#e0e0e0' },
  { id: 'light',    name: 'Light',    desc: 'Bright and clean',     bg: '#f5f5f5', bar: '#fff',    card: '#fff',    text: '#333'    },
  { id: 'daylight', name: 'Daylight', desc: 'Warm and natural',     bg: '#f2f2f5', bar: '#eaeaef', card: '#eeeef2', text: '#151528' },
  { id: 'clear',    name: 'Clear',    desc: 'Minimal dark',         bg: '#0a0a0a', bar: '#0a0a0a', card: '#181818', text: '#e0e0e0' },
  { id: 'auto',     name: 'Auto',     desc: 'Matches your system',  bg: '#0a0a0a', bar: '#151515', card: '#151515', text: '#e0e0e0' },
];

function _showOnboardingWizard() {
  const signInBtn = document.getElementById('google-signin-btn');
  const wizard = document.getElementById('onboarding-wizard');
  const modal = document.getElementById('auth-modal');
  const logo = document.getElementById('auth-logo');
  const authErr = document.getElementById('auth-error');
  const nav = document.getElementById('sidebar-nav');
  if (signInBtn) signInBtn.style.display = 'none';
  if (logo) logo.style.display = 'none';
  if (authErr) authErr.style.display = 'none';
  if (wizard) wizard.style.display = '';
  if (modal) modal.classList.add('wizard-mode');
  // Hide top nav bar during onboarding
  if (nav) nav.style.display = 'none';
  _wizardStep = 0;
  _renderWizardStep(0, 'forward');
}

function _wizardUpdateAccentGlow() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';
  const hex = accent.replace('#', '');
  const r = parseInt(hex.slice(0,2), 16) || 0;
  const g = parseInt(hex.slice(2,4), 16) || 0;
  const b = parseInt(hex.slice(4,6), 16) || 0;
  modal.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.15)`);
  modal.classList.add('wizard-glow');
}

function _wizardAnimateHeight(wizard, step) {
  // Measure the new step's natural height and animate to it
  const prevHeight = wizard.offsetHeight;
  wizard.style.height = 'auto';
  const newHeight = step.scrollHeight;
  wizard.style.height = prevHeight + 'px';
  // Force reflow then animate
  void wizard.offsetHeight;
  wizard.style.height = newHeight + 'px';
  // Clear after transition so content can grow naturally
  const onEnd = () => { wizard.style.height = 'auto'; wizard.removeEventListener('transitionend', onEnd); };
  wizard.addEventListener('transitionend', onEnd);
}

function _wizardBackHTML(stepIndex) {
  if (stepIndex === 0) return '';
  // Don't allow going back before username once it's been submitted (step 1 is the earliest backable-to after welcome)
  const prevStep = stepIndex - 1;
  return `<button class="wizard-back" onclick="_renderWizardStep(${prevStep}, 'back')" title="Back">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>
  </button>`;
}

function _renderWizardStep(stepIndex, direction) {
  const wizard = document.getElementById('onboarding-wizard');
  if (!wizard) return;

  const prev = wizard.querySelector('.wizard-step');
  if (prev) {
    prev.classList.remove('active');
    prev.classList.add('exit-left');
    setTimeout(() => { if (prev.parentNode) prev.remove(); }, 350);
  }

  const delay = prev ? 350 : 0;
  setTimeout(() => {
    _wizardStep = stepIndex;
    // Build dots
    let dotsHTML = '<div class="wizard-dots">';
    for (let i = 0; i < _wizardTotalSteps; i++) {
      const cls = i === stepIndex ? 'active' : i < stepIndex ? 'completed' : '';
      dotsHTML += `<div class="wizard-dot ${cls}"></div>`;
    }
    dotsHTML += '</div>';

    let contentHTML = '';
    if (stepIndex === 0) contentHTML = _wizardWelcomeHTML();
    else if (stepIndex === 1) contentHTML = _wizardUsernameHTML();
    else if (stepIndex === 2) contentHTML = _wizardAccentHTML();
    else if (stepIndex === 3) contentHTML = _wizardThemeHTML();
    else if (stepIndex === 4) contentHTML = _wizardNeuralookHTML();
    else if (stepIndex === 5) contentHTML = _wizardFinaleHTML();

    const step = document.createElement('div');
    step.className = 'wizard-step';
    step.style.position = 'relative';
    step.innerHTML = _wizardBackHTML(stepIndex) + dotsHTML + contentHTML;
    wizard.appendChild(step);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        step.classList.add('active');
        _wizardAnimateHeight(wizard, step);
      });
    });

    // Init step-specific behavior
    if (stepIndex === 1) _wizardUsernameInit();
    else if (stepIndex === 2) _wizardAccentInit();
    else if (stepIndex === 3) _wizardThemeInit();
  }, delay);
}

// ── Step 0: Welcome ──

function _wizardWelcomeHTML() {
  const name = (_authUserInfo && (_authUserInfo.name || '')) || _authUser || '';
  const firstName = name.split(' ')[0] || 'there';
  const pic = _authUserInfo && _authUserInfo.picture;
  const avatarHTML = pic
    ? `<img class="wizard-welcome-avatar" src="${pic.replace(/"/g, '&quot;')}" referrerpolicy="no-referrer" />`
    : `<div class="wizard-welcome-letter">${firstName[0].toUpperCase()}</div>`;
  return `
    <div style="text-align:center;">
      ${avatarHTML}
      <div style="font-size:22px;font-weight:600;color:var(--text-primary,#e0e0e0);margin-bottom:6px;">Welcome, ${firstName}</div>
      <div style="font-size:13px;color:var(--text-muted,#999);margin-bottom:24px;">Let's get your workspace set up. This only takes a moment.</div>
      <button class="wizard-btn wizard-btn-primary" onclick="_renderWizardStep(1, 'forward')">Get started</button>
    </div>
  `;
}

// ── Step 1: Username ──

function _wizardUsernameHTML() {
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--text-primary,#e0e0e0);margin-bottom:4px;">Choose a username</div>
      <div style="font-size:13px;color:var(--text-muted,#999);margin-bottom:20px;">This will be your public identity.</div>
      <input id="wiz-username" type="text" maxlength="20" placeholder="username"
        style="width:100%;box-sizing:border-box;padding:10px 14px;font-size:15px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text-primary,#e0e0e0);outline:none;text-align:center;" />
      <div id="wiz-username-hint" style="font-size:11px;color:var(--text-muted,#999);margin-top:6px;">2-20 characters: letters, numbers, hyphens, underscores</div>
      <div id="wiz-username-error" style="font-size:12px;color:#e74c3c;margin-top:6px;min-height:18px;"></div>
      <button id="wiz-username-btn" class="wizard-btn wizard-btn-primary" style="margin-top:4px;" disabled onclick="_wizardSubmitUsername()">Continue</button>
    </div>
  `;
}

function _wizardUsernameInit() {
  const input = document.getElementById('wiz-username');
  if (!input) return;
  input.addEventListener('input', () => {
    const val = input.value.replace(/[^a-zA-Z0-9_-]/g, '');
    if (val !== input.value) input.value = val;
    const btn = document.getElementById('wiz-username-btn');
    const valid = val.length >= 2 && val.length <= 20;
    if (btn) { btn.disabled = !valid; }
    const errEl = document.getElementById('wiz-username-error');
    if (errEl) errEl.textContent = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const btn = document.getElementById('wiz-username-btn');
      if (btn && !btn.disabled) _wizardSubmitUsername();
    }
  });
  input.focus();
}

async function _wizardSubmitUsername() {
  const input = document.getElementById('wiz-username');
  const errEl = document.getElementById('wiz-username-error');
  const btn = document.getElementById('wiz-username-btn');
  if (!input || !errEl) return;
  const username = input.value.trim();
  if (username.length < 2 || username.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    errEl.textContent = 'Invalid username format';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    const data = await apiPost('/api/auth/username', { username });
    _authUserInfo.username = data.username;
    localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
    _renderWizardStep(2, 'forward');
  } catch (e) {
    errEl.textContent = e.message || 'Network error, please try again';
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

// ── Step 2: Accent Color ──

function _wizardAccentHTML() {
  const current = localStorage.getItem('accentColor') || '#b4451a';
  const currentName = (_wizardAccentColors.find(c => c.color === current) || { name: 'Orange' }).name;
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--text-primary,#e0e0e0);margin-bottom:4px;">Pick your color</div>
      <div style="font-size:13px;color:var(--text-muted,#999);margin-bottom:20px;">You can change this anytime in settings.</div>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-bottom:14px;">
        ${_wizardAccentColors.map(a => `
          <button class="onboard-swatch${a.color === current ? ' selected' : ''}" style="background:${a.color};" data-color="${a.color}" data-name="${a.name}" onclick="_wizardPickAccent('${a.color}', this)"></button>
        `).join('')}
      </div>
      <div id="wiz-color-name" style="font-size:13px;color:var(--text-muted,#999);margin-bottom:16px;">${currentName}</div>
      <button class="wizard-btn wizard-btn-primary" onclick="_wizardAccentContinue()">Continue</button>
    </div>
  `;
}

function _wizardAccentInit() {
  const current = localStorage.getItem('accentColor') || '#b4451a';
  if (typeof applyAccentColor === 'function') applyAccentColor(current);
  if (typeof window._updateCircuitColors === 'function') window._updateCircuitColors();
  _wizardUpdateAccentGlow();
}

function _wizardPickAccent(color, el) {
  if (typeof setAccentColor === 'function') setAccentColor(color);
  // Update circuit board background to match
  if (typeof window._updateCircuitColors === 'function') window._updateCircuitColors();
  // Update modal glow
  _wizardUpdateAccentGlow();
  // Update swatch selection visuals
  const wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.onboard-swatch').forEach(s => s.classList.remove('selected'));
  }
  if (el) el.classList.add('selected');
  // Update color name label
  const nameEl = document.getElementById('wiz-color-name');
  const match = _wizardAccentColors.find(c => c.color === color);
  if (nameEl && match) nameEl.textContent = match.name;
}

function _wizardAccentContinue() {
  _renderWizardStep(3, 'forward');
}

// ── Step 3: Theme ──

function _wizardThemePreview(t) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';
  return `<div class="wizard-theme-preview" style="background:${t.bg};border-color:${t.id === 'dark' || t.id === 'clear' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'};">
    <div class="wizard-theme-preview-bar" style="background:${t.bar};"></div>
    <div class="wizard-theme-preview-body">
      <div class="wizard-theme-preview-line" style="background:${t.text};opacity:0.5;"></div>
      <div class="wizard-theme-preview-line" style="background:${accent};opacity:0.7;"></div>
      <div class="wizard-theme-preview-line" style="background:${t.text};opacity:0.3;"></div>
    </div>
  </div>`;
}

function _wizardThemeHTML() {
  const current = localStorage.getItem('theme') || 'dark';
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--text-primary,#e0e0e0);margin-bottom:4px;">Choose a theme</div>
      <div style="font-size:13px;color:var(--text-muted,#999);margin-bottom:20px;">Sets the overall look and feel.</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
        ${_wizardThemes.map(t => `
          <button class="wizard-theme-option${t.id === current ? ' selected' : ''}" data-theme="${t.id}" onclick="_wizardPickTheme('${t.id}', this)">
            ${_wizardThemePreview(t)}
            <div style="flex:1;text-align:left;margin-left:12px;">
              <span class="wizard-theme-name">${t.name}</span><br/>
              <span class="wizard-theme-desc">${t.desc}</span>
            </div>
          </button>
        `).join('')}
      </div>
      <button class="wizard-btn wizard-btn-primary" onclick="_wizardThemeContinue()">Continue</button>
    </div>
  `;
}

function _wizardThemeInit() {
  const current = localStorage.getItem('theme') || 'dark';
  if (typeof setTheme === 'function') setTheme(current);
}

function _wizardPickTheme(themeId, el) {
  if (typeof setTheme === 'function') setTheme(themeId);
  // Update login-gate and auth-modal backgrounds to match theme
  const gate = document.getElementById('login-gate');
  const modal = document.getElementById('auth-modal');
  const isLight = themeId === 'light' || themeId === 'daylight';
  if (gate) gate.style.background = isLight ? '#f0f0f4' : '#080810';
  if (modal) {
    modal.style.background = isLight ? 'rgba(255, 255, 255, 0.7)' : 'rgba(12, 12, 20, 0.7)';
    modal.style.borderColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    modal.style.color = isLight ? '#333' : '#e0e0e0';
  }
  const wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-theme-option').forEach(b => b.classList.remove('selected'));
  }
  if (el) el.classList.add('selected');
}

function _wizardThemeContinue() {
  _renderWizardStep(4, 'forward');
}

// ── Step 4: Neuralook (optional) ──

function _wizardNeuralookHTML() {
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--text-primary,#e0e0e0);margin-bottom:4px;">Eye tracking</div>
      <div style="font-size:13px;color:var(--text-muted,#999);margin-bottom:20px;">Neuralook uses your camera for gaze-based navigation. A quick calibration is needed.</div>
      <div style="margin-bottom:24px;">
        <svg style="width:48px;height:48px;display:inline-block;" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </div>
      <button class="wizard-btn wizard-btn-primary" onclick="_wizardStartNeuralook()">Calibrate now</button>
      <button class="wizard-btn wizard-btn-secondary" onclick="_renderWizardStep(5, 'forward')">Set up later</button>
    </div>
  `;
}

function _wizardStartNeuralook() {
  _wizardRestoreUI();
  _onLoginSuccess();
  if (typeof _nlStartCalibration === 'function') {
    _nlStartCalibration();
  }
}

// ── Step 5: Finale ──

function _wizardFinaleHTML() {
  const username = (_authUserInfo && _authUserInfo.username) || 'you';
  return `
    <div style="text-align:center;">
      <div class="wizard-finale-check">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div style="font-size:22px;font-weight:600;color:var(--text-primary,#e0e0e0);margin-bottom:6px;">You're all set, @${username}</div>
      <div style="font-size:13px;color:var(--text-muted,#999);margin-bottom:24px;">Neural link established. Jack in.</div>
      <button class="wizard-btn wizard-btn-primary" onclick="_wizardFinish()">Enter the Net</button>
    </div>
  `;
}

function _wizardRestoreUI() {
  const nav = document.getElementById('sidebar-nav');
  if (nav) nav.style.display = '';
}

function _wizardFinish() {
  _wizardRestoreUI();
  _onLoginSuccess();
}

// ── Auth actions ──

function _onLoginSuccess() {
  _authReady = true;
  _hideLoginGate();
  _updateAccountUI();
  _startSyncInterval();
  // Apply any synced appearance settings
  if (typeof applyStoredAppearance === 'function') applyStoredAppearance();
  // Refresh inbox badge
  if (typeof refreshInboxBadge === 'function') {
    refreshInboxBadge();
    setInterval(refreshInboxBadge, 60000);
  }
  // Load custom annotation categories
  _loadCustomAnnotationCategories();
  // Calendar event notifications
  if (typeof startCalendarNotifications === 'function') startCalendarNotifications();
  // Route to the correct view now that auth is resolved
  routeFromHash();
  _updateNowPlayingContext();
}

async function authLogout() {
  if (_authToken) {
    // Push latest settings before logging out
    await syncToServer(true).catch((e) => { /* fire-and-forget */ });
    apiPost('/api/auth/logout', {}).catch((e) => { /* fire-and-forget */ });
  }
  _authToken = null;
  _authUser = null;
  _authUserInfo = null;
  _authReady = false;
  // Clear all user-specific data from localStorage
  for (const key of SYNC_KEYS) localStorage.removeItem(key);
  localStorage.removeItem('authToken');
  window.electronAPI?.deleteAuthToken?.();
  localStorage.removeItem('authUser');
  localStorage.removeItem('authUserInfo');
  _updateAccountUI();
  _stopSyncInterval();
  _showLoginGate();
}

function _updateAccountUI() {
  const avatarSpan = document.getElementById('sb-dashboard-avatar');
  const avatarIcon = document.getElementById('sb-dashboard-icon');
  if (!avatarSpan) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _updateAccountUI, { once: true });
    }
    return;
  }
  if (_authUserInfo && (_authUserInfo.username || _authUserInfo.name)) {
    if (_authUserInfo.picture) {
      avatarSpan.innerHTML = `<img src="${_authUserInfo.picture.replace(/"/g, '&quot;')}" style="width:22px;height:22px;object-fit:cover;border-radius:50%;display:block;" referrerpolicy="no-referrer" />`;
    } else {
      const letter = (_authUserInfo.username || _authUserInfo.name || '?')[0].toUpperCase();
      avatarSpan.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#fff;">${letter}</span>`;
    }
    avatarSpan.style.display = '';
    if (avatarIcon) avatarIcon.style.display = 'none';
  } else {
    avatarSpan.style.display = 'none';
    if (avatarIcon) avatarIcon.style.display = '';
  }
}


// ── Sync ──

function _buildSyncPayload(keysToSync) {
  const data = {};
  const now = Date.now() / 1000;
  for (const key of keysToSync) {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      let value;
      try { value = JSON.parse(raw); } catch { value = raw; }
      data[key] = { value, updated: now };
    }
  }
  return data;
}

function _applySyncData(serverData) {
  for (const [key, entry] of Object.entries(serverData)) {
    if (!_syncKeysSet.has(key)) continue;
    const value = entry.value;
    if (value === null || value === undefined) continue;
    // Temporarily remove from dirty set — this write is from server, not user
    _syncDirtyKeys.delete(key);
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    _syncDirtyKeys.delete(key);
  }
}

async function syncToServer(force) {
  if (!_authToken) return;
  const keysToSync = force ? SYNC_KEYS : [..._syncDirtyKeys];
  if (!keysToSync.length) return; // nothing changed
  _syncDirtyKeys.clear();
  try {
    const result = await apiPost('/api/sync', { data: _buildSyncPayload(keysToSync) });
    if (result.data) _applySyncData(result.data);
  } catch (e) {
    console.warn('[sync] push failed:', e);
    // Re-mark as dirty so they retry next cycle
    for (const k of keysToSync) _syncDirtyKeys.add(k);
  }
}

async function syncFromServer() {
  if (!_authToken) return;
  try {
    // Pull only — send empty payload so server data always wins
    const result = await apiPost('/api/sync', { data: {} });
    if (result.data) _applySyncData(result.data);
  } catch (e) {
    console.warn('[sync] pull failed:', e);
  }
}

function _startSyncInterval() {
  _stopSyncInterval();
  _syncInterval = setInterval(syncToServer, 60000);
}

function _stopSyncInterval() {
  if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; }
}

// ── UI action handlers ──

function _doLogout() {
  authLogout();
}

async function _doDeleteAccount() {
  if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
  if (!confirm('All your data will be permanently deleted. Continue?')) return;
  try {
    await apiPost('/api/auth/delete-account', {});
  } catch (e) { /* proceed with local cleanup regardless */ }
  _authToken = null;
  _authUser = null;
  _authUserInfo = null;
  _authReady = false;
  localStorage.clear();
  window.electronAPI?.deleteAuthToken?.();
  _updateAccountUI();
  _stopSyncInterval();
  _showLoginGate();
}

// ── Initialize: check session, show login gate if needed ──
(function _initAuth() {
  _updateAccountUI();
  if (_authToken) {
    // Hide login gate immediately to prevent flash while verifying session
    _hideLoginGate();
    // Verify session is still valid
    apiGet('/api/auth/me')
      .then(data => {
        _authUser = (data.name || data.email || _authUser || '').split(' ')[0];
        _authUserInfo = { email: data.email, name: data.name, google_id: data.google_id, username: data.username || null, picture: data.picture || null };
        localStorage.setItem('authUser', _authUser);
        localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
        if (!data.username) {
          _showLoginGate();
          _showOnboardingWizard();
        } else {
          _onLoginSuccess();
        }
        syncFromServer();
      })
      .catch(() => {
        _authToken = null;
        _authUser = null;
        _authUserInfo = null;
        localStorage.removeItem('authToken');
        window.electronAPI?.deleteAuthToken?.();
        localStorage.removeItem('authUser');
        localStorage.removeItem('authUserInfo');
        _updateAccountUI();
        _showLoginGate();
      });
  } else {
    // No token — show login gate
    _showLoginGate();
  }
})();

