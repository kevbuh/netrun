// onboarding.js — Onboarding wizard (standalone page)
// Steps: 0=Welcome, 1=Username, 2=Accent Color, 3=Theme, 4=Tab Layout, 5=Chat Model, 6=Pixel Pet, 7=Neuralook, 8=Finale

// Auth guard: no token → redirect to login
(function() {
  if (!localStorage.getItem('authToken')) {
    window.location.href = '/login.html';
  }
})();

let _wizardStep = 0;
const _wizardTotalSteps = 9;

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
  { id: 'dark',     name: 'Dark',     desc: 'Easy on the eyes',     bg: '#0a0a0a', bar: '#151515', text: '#e0e0e0' },
  { id: 'light',    name: 'Light',    desc: 'Bright and clean',     bg: '#f5f5f5', bar: '#fff',    text: '#333'    },
  { id: 'daylight', name: 'Daylight', desc: 'Warm and natural',     bg: '#f2f2f5', bar: '#eaeaef', text: '#151528' },
  { id: 'clear',    name: 'Clear',    desc: 'Minimal dark',         bg: '#0a0a0a', bar: '#0a0a0a', text: '#e0e0e0' },
  { id: 'auto',     name: 'Auto',     desc: 'Matches your system',  bg: '#0a0a0a', bar: '#151515', text: '#e0e0e0' },
];

const _wizardPetTypes = [
  { id: 'cat',      name: 'Cat',       emoji: '' },
  { id: 'blackCat', name: 'Black Cat', emoji: '' },
  { id: 'dog',      name: 'Dog',       emoji: '' },
  { id: 'poodle',   name: 'Poodle',    emoji: '' },
  { id: 'bunny',    name: 'Bunny',     emoji: '' },
  { id: 'froog',    name: 'Froog',     emoji: '' },
  { id: 'pacman',   name: 'Pac-Man',   emoji: '' },
];

let _wizardPendingUsername = null;
let _wizardModelList = [];

function openOnboarding() {
  // Render directly into #onboarding-container (standalone page)
  _renderOnboardingWizard();
}

function _renderOnboardingWizard() {
  const container = document.getElementById('onboarding-container');
  if (!container) return;
  // Build the wizard shell — a floating card
  container.innerHTML = `<div id="onboarding-wizard" class="nr-modal wizard-mode" style="position:relative;"></div>`;
  _wizardStep = 0;
  _renderWizardStep(0, 'forward');
}

function _wizardUpdateAccentGlow() {
  const modal = document.getElementById('onboarding-wizard');
  if (!modal) return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';
  const hex = accent.replace('#', '');
  const r = parseInt(hex.slice(0,2), 16) || 0;
  const g = parseInt(hex.slice(2,4), 16) || 0;
  const b = parseInt(hex.slice(4,6), 16) || 0;
  modal.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.15)`);
  modal.classList.add('wizard-glow', 'nr-glow');
}

function _wizardAnimateHeight(wizard, step) {
  const prevHeight = wizard.offsetHeight;
  wizard.style.height = 'auto';
  const newHeight = step.scrollHeight;
  wizard.style.height = prevHeight + 'px';
  void wizard.offsetHeight;
  wizard.style.height = newHeight + 'px';
  const onEnd = () => { wizard.style.height = 'auto'; wizard.removeEventListener('transitionend', onEnd); };
  wizard.addEventListener('transitionend', onEnd);
}

function _wizardBackHTML(stepIndex) {
  if (stepIndex === 0) return '';
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
    else if (stepIndex === 4) contentHTML = _wizardTabLayoutHTML();
    else if (stepIndex === 5) contentHTML = _wizardChatModelHTML();
    else if (stepIndex === 6) contentHTML = _wizardPixelPetHTML();
    else if (stepIndex === 7) contentHTML = _wizardNeuralookHTML();
    else if (stepIndex === 8) contentHTML = _wizardFinaleHTML();

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

    if (stepIndex === 1) _wizardUsernameInit();
    else if (stepIndex === 2) _wizardAccentInit();
    else if (stepIndex === 3) _wizardThemeInit();
    else if (stepIndex === 5) _wizardChatModelInit();
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
      <div style="font-size:22px;font-weight:600;color:var(--nr-text-primary,#e0e0e0);margin-bottom:6px;">Welcome, ${firstName}</div>
      <div style="font-size:13px;color:var(--nr-text-secondary,#999);margin-bottom:24px;">Let's get your workspace set up. This only takes a moment.</div>
      <button class="nr-btn nr-btn nr-btn-primary nr-btn-lg" onclick="_renderWizardStep(1, 'forward')">Get started</button>
    </div>
  `;
}

// ── Step 1: Username ──

function _wizardUsernameHTML() {
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--nr-text-primary,#e0e0e0);margin-bottom:4px;">Choose a username</div>
      <div style="font-size:13px;color:var(--nr-text-secondary,#999);margin-bottom:20px;">This will be your public identity.</div>
      <input id="wiz-username" type="text" maxlength="20" placeholder="username"
        style="width:100%;box-sizing:border-box;padding:10px 14px;font-size:15px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--nr-text-primary,#e0e0e0);outline:none;text-align:center;" />
      <div id="wiz-username-hint" style="font-size:11px;color:var(--nr-text-secondary,#999);margin-top:6px;">2-20 characters: letters, numbers, hyphens, underscores</div>
      <div id="wiz-username-error" style="font-size:12px;color:#e74c3c;margin-top:6px;min-height:18px;"></div>
      <button id="wiz-username-btn" class="nr-btn nr-btn nr-btn-primary nr-btn-lg" style="margin-top:4px;" disabled onclick="_wizardSubmitUsername()">Continue</button>
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

function _wizardSubmitUsername() {
  const input = document.getElementById('wiz-username');
  const errEl = document.getElementById('wiz-username-error');
  if (!input || !errEl) return;
  const username = input.value.trim();
  if (username.length < 2 || username.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    errEl.textContent = 'Invalid username format';
    return;
  }
  _wizardPendingUsername = username;
  _renderWizardStep(2, 'forward');
}

async function _wizardCommitAccount() {
  if (!_wizardPendingUsername) return;
  try {
    const data = await apiPost('/api/auth/username', { username: _wizardPendingUsername });
    _authUserInfo.username = data.username;
    localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
  } catch (e) {
    console.warn('[wizard] username commit failed:', e.message);
  }
  _wizardPendingUsername = null;
}

// ── Step 2: Accent Color ──

function _wizardAccentHTML() {
  const current = localStorage.getItem('accentColor') || '#b4451a';
  const currentName = (_wizardAccentColors.find(c => c.color === current) || { name: 'Orange' }).name;
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--nr-text-primary,#e0e0e0);margin-bottom:4px;">Pick your color</div>
      <div style="font-size:13px;color:var(--nr-text-secondary,#999);margin-bottom:20px;">You can change this anytime in settings.</div>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-bottom:14px;">
        ${_wizardAccentColors.map(a => `
          <button class="onboard-swatch${a.color === current ? ' selected' : ''}" style="background:${a.color};" data-color="${a.color}" data-name="${a.name}" onclick="_wizardPickAccent('${a.color}', this)"></button>
        `).join('')}
      </div>
      <div id="wiz-color-name" style="font-size:13px;color:var(--nr-text-secondary,#999);margin-bottom:16px;">${currentName}</div>
      <button class="nr-btn nr-btn nr-btn-primary nr-btn-lg" onclick="_wizardAccentContinue()">Continue</button>
    </div>
  `;
}

function _wizardAccentInit() {
  const current = localStorage.getItem('accentColor') || '#b4451a';
  if (typeof applyAccentColor === 'function') applyAccentColor(current);
  _wizardUpdateAccentGlow();
}

function _wizardPickAccent(color, el) {
  if (typeof setAccentColor === 'function') setAccentColor(color);
  _wizardUpdateAccentGlow();
  const wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.onboard-swatch').forEach(s => s.classList.remove('selected'));
  }
  if (el) el.classList.add('selected');
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
  const current = localStorage.getItem('theme') || 'clear';
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--nr-text-primary,#e0e0e0);margin-bottom:4px;">Choose a theme</div>
      <div style="font-size:13px;color:var(--nr-text-secondary,#999);margin-bottom:20px;">Sets the overall look and feel.</div>
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
      <button class="nr-btn nr-btn nr-btn-primary nr-btn-lg" onclick="_wizardThemeContinue()">Continue</button>
    </div>
  `;
}

function _wizardThemeInit() {
  const current = localStorage.getItem('theme') || 'clear';
  if (typeof setTheme === 'function') setTheme(current);
}

function _wizardPickTheme(themeId, el) {
  if (typeof setTheme === 'function') setTheme(themeId);
  // Update wizard card to match theme
  const modal = document.getElementById('onboarding-wizard');
  const isLight = themeId === 'light' || themeId === 'daylight';
  if (modal) {
    modal.style.background = isLight ? 'rgba(255, 255, 255, 0.75)' : 'rgba(12, 12, 20, 0.7)';
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

// ── Step 4: Tab Layout ──

function _wizardTabLayoutHTML() {
  const current = localStorage.getItem('browseTabLayout') || 'island';
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--nr-text-primary,#e0e0e0);margin-bottom:4px;">Browser tab style</div>
      <div style="font-size:13px;color:var(--nr-text-secondary,#999);margin-bottom:20px;">How should your browser tabs look?</div>
      <div style="display:flex;gap:12px;justify-content:center;margin-bottom:20px;">
        <button class="wizard-tab-layout-option${current === 'island' ? ' selected' : ''}" data-layout="island" onclick="_wizardPickTabLayout('island', this)">
          <div class="wizard-tab-layout-preview">
            <div style="display:flex;gap:4px;align-items:center;justify-content:center;height:100%;">
              <div style="width:10px;height:100%;background:var(--nr-text-secondary,#999);opacity:0.2;border-radius:3px;"></div>
              <div style="flex:1;display:flex;flex-direction:column;gap:3px;padding:4px;">
                <div style="height:4px;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;width:80%;"></div>
                <div style="height:4px;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;width:60%;"></div>
                <div style="height:4px;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;width:70%;"></div>
              </div>
            </div>
          </div>
          <span class="wizard-tab-layout-name">Island</span>
          <span class="wizard-tab-layout-desc">Sidebar tabs</span>
        </button>
        <button class="wizard-tab-layout-option${current === 'horizontal' ? ' selected' : ''}" data-layout="horizontal" onclick="_wizardPickTabLayout('horizontal', this)">
          <div class="wizard-tab-layout-preview">
            <div style="display:flex;flex-direction:column;height:100%;">
              <div style="display:flex;gap:2px;padding:3px 4px;">
                <div style="height:5px;flex:1;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;"></div>
                <div style="height:5px;flex:1;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;"></div>
                <div style="height:5px;flex:1;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;"></div>
              </div>
              <div style="height:5px;background:var(--nr-text-secondary,#999);opacity:0.15;margin:0 4px;border-radius:2px;"></div>
              <div style="flex:1;"></div>
            </div>
          </div>
          <span class="wizard-tab-layout-name">Horizontal</span>
          <span class="wizard-tab-layout-desc">Top tab bar</span>
        </button>
      </div>
      <button class="nr-btn nr-btn nr-btn-primary nr-btn-lg" onclick="_renderWizardStep(5, 'forward')">Continue</button>
    </div>
  `;
}

function _wizardPickTabLayout(layout, el) {
  localStorage.setItem('browseTabLayout', layout);
  const wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-tab-layout-option').forEach(b => b.classList.remove('selected'));
  }
  if (el) el.classList.add('selected');
}

// ── Step 5: Chat Model ──

function _wizardChatModelHTML() {
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--nr-text-primary,#e0e0e0);margin-bottom:4px;">Choose a model</div>
      <div style="font-size:13px;color:var(--nr-text-secondary,#999);margin-bottom:20px;">Pick the default Ollama model for chat and tools.</div>
      <div id="wiz-model-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:20px;max-height:200px;overflow-y:auto;">
        <div style="font-size:12px;color:var(--nr-text-secondary,#999);padding:16px 0;">Loading models...</div>
      </div>
      <button class="nr-btn nr-btn nr-btn-primary nr-btn-lg" onclick="_renderWizardStep(6, 'forward')">Continue</button>
    </div>
  `;
}

async function _wizardChatModelInit() {
  try {
    const data = await apiGet('/api/models');
    _wizardModelList = data.models || [];
  } catch (e) {
    _wizardModelList = [];
  }

  const container = document.getElementById('wiz-model-list');
  if (!container) return;

  if (!_wizardModelList.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--nr-text-secondary,#999);padding:16px 0;">No models found. Make sure Ollama is running.</div>';
    return;
  }

  const current = localStorage.getItem('chatModel') || 'qwen2.5:3b';
  container.innerHTML = _wizardModelList.map(m => {
    const sel = m === current;
    return `<button class="wizard-model-option${sel ? ' selected' : ''}" onclick="_wizardPickModel('${m.replace(/'/g, "\\'")}', this)">${m}</button>`;
  }).join('');
}

function _wizardPickModel(model, el) {
  localStorage.setItem('chatModel', model);
  const wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-model-option').forEach(b => b.classList.remove('selected'));
  }
  if (el) el.classList.add('selected');
}

// ── Step 6: Pixel Pet ──

function _wizardPixelPetHTML() {
  const petOn = localStorage.getItem('pixelPet') === 'on';
  const currentType = localStorage.getItem('pixelPetType') || 'cat';
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--nr-text-primary,#e0e0e0);margin-bottom:4px;">Pick a companion</div>
      <div style="font-size:13px;color:var(--nr-text-secondary,#999);margin-bottom:20px;">A pixel pet that lives on your screen. Or go solo.</div>
      <div id="wiz-pet-preview" style="height:48px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;">
        <canvas id="wiz-pet-canvas" width="48" height="48" style="image-rendering:pixelated;width:48px;height:48px;"></canvas>
      </div>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-bottom:20px;">
        ${_wizardPetTypes.map(p => {
          const sel = petOn && currentType === p.id;
          return `<button class="wizard-pet-option${sel ? ' selected' : ''}" data-pet="${p.id}" onclick="_wizardPickPet('${p.id}', this)">${p.name}</button>`;
        }).join('')}
        <button class="wizard-pet-option${!petOn ? ' selected' : ''}" data-pet="none" onclick="_wizardPickPet('none', this)">None</button>
      </div>
      <button class="nr-btn nr-btn nr-btn-primary nr-btn-lg" onclick="_renderWizardStep(7, 'forward')">Continue</button>
    </div>
  `;
}

function _wizardPickPet(petId, el) {
  const wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-pet-option').forEach(b => b.classList.remove('selected'));
  }
  if (el) el.classList.add('selected');

  if (petId === 'none') {
    localStorage.setItem('pixelPet', 'off');
    const canvas = document.getElementById('wiz-pet-canvas');
    if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 48, 48); }
  } else {
    localStorage.setItem('pixelPet', 'on');
    localStorage.setItem('pixelPetType', petId);
    _wizardDrawPetPreview(petId);
  }
}

function _wizardDrawPetPreview(petId) {
  const canvas = document.getElementById('wiz-pet-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 48, 48);
  // Draw a simple colored square placeholder with the pet's initial
  // The actual pet sprite system uses PET_TYPES which is scoped inside pixel-pet.js IIFE
  const colors = {
    cat: '#e8a87c', blackCat: '#1a1a1a', dog: '#c49a6c',
    poodle: '#E87830', bunny: '#eee', froog: '#ef4444', pacman: '#ffd700'
  };
  const color = colors[petId] || '#999';
  // Draw a chunky pixel-art style circle
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(24, 24, 16, 0, Math.PI * 2);
  ctx.fill();
  // Eyes
  ctx.fillStyle = petId === 'blackCat' ? '#7cfc00' : '#2a2a2a';
  ctx.fillRect(18, 20, 4, 4);
  ctx.fillRect(28, 20, 4, 4);
}

// ── Step 7: Neuralook (optional) ──

function _wizardNeuralookHTML() {
  return `
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:600;color:var(--nr-text-primary,#e0e0e0);margin-bottom:4px;">Eye tracking</div>
      <div style="font-size:13px;color:var(--nr-text-secondary,#999);margin-bottom:20px;">Neuralook uses your camera for gaze-based navigation. A quick calibration is needed.</div>
      <div style="margin-bottom:24px;">
        <svg style="width:48px;height:48px;display:inline-block;" viewBox="0 0 24 24" fill="none" stroke="var(--nr-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </div>
      <button class="nr-btn nr-btn nr-btn-primary nr-btn-lg" onclick="_wizardStartNeuralook()">Calibrate now</button>
      <button class="nr-btn nr-btn nr-btn-ghost" onclick="_renderWizardStep(8, 'forward')">Set up later</button>
    </div>
  `;
}

async function _wizardStartNeuralook() {
  await _wizardCommitAccount();
  // Redirect to main app with neuralook hash for calibration
  window.location.href = '/#neuralook';
}

// ── Step 8: Finale ──

function _wizardFinaleHTML() {
  const username = _wizardPendingUsername || (_authUserInfo && _authUserInfo.username) || 'you';
  return `
    <div style="text-align:center;">
      <div class="wizard-finale-check">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div style="font-size:22px;font-weight:600;color:var(--nr-text-primary,#e0e0e0);margin-bottom:6px;">You're all set, @${username}</div>
      <div style="font-size:13px;color:var(--nr-text-secondary,#999);margin-bottom:24px;">Neural link established. Jack in.</div>
      <button class="nr-btn nr-btn nr-btn-primary nr-btn-lg" onclick="_wizardFinish()">Enter the Net</button>
    </div>
  `;
}

async function _wizardFinish() {
  await _wizardCommitAccount();
  _wizardComplete();
}

function _wizardComplete() {
  // Navigate to main app
  window.location.href = '/';
}

// Auto-start wizard on page load
document.addEventListener('DOMContentLoaded', function() {
  openOnboarding();
});
