// onboarding.js — Onboarding wizard (SPA overlay or standalone page)
// Steps: 0=Welcome, 1=Username, 2=Accent Color, 3=Theme, 4=Tab Layout, 5=Bookmark Import, 6=Feed Selection, 7=Chat Model, 8=Pixel Pet, 9=Cursor, 10=Neuralook, 11=Finale

import Settings from '/js/core/core-settings.js';
import { apiPost, apiGet } from '/js/api.js';
import { escapeHtml, fmtNum } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { FEED_CATALOG } from '/js/core/core-views.js';
import { applyAccentColor, setAccentColor } from '/js/settings/settings-colors.js';
import { setTheme } from '/js/settings/settings-theme.js';
import { logger } from '/js/logger.js';

// Auth guard: standalone page only (SPA handles its own auth)
(function() {
  if (_isStandalonePage() && !localStorage.getItem('authToken')) {
    window.location.href = '/login.html';
  }
})();

function _isStandalonePage() {
  return !document.getElementById('app-bezel');
}

let _wizardStep = 0;
const _wizardTotalSteps = 12;

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
  // If no onboarding-container exists (SPA mode), create a full-viewport overlay
  if (!document.getElementById('onboarding-container')) {
    const containerView = new window.View('div').id('onboarding-container')
      .cssText('display:flex;align-items:center;justify-content:center;width:100%;height:100%;');
    const overlayView = new window.View('div').id('onboarding-overlay')
      .cssText('position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:var(--nr-bg-body, #0a0a0a);')
      .add(containerView);
    AetherUI.append(overlayView, document.body);
  }
  _renderOnboardingWizard();
}

function _renderOnboardingWizard() {
  const container = document.getElementById('onboarding-container');
  if (!container) return;
  AetherUI.mount(new window.View('div').id('onboarding-wizard').className('nr-modal wizard-mode').styles({ position: 'relative' }), container);
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
  modal.style.setProperty('--accent-glow', 'rgba(' + r + ',' + g + ',' + b + ',0.15)');
  modal.classList.add('wizard-glow', 'nr-glow');
}

function _wizardAnimateHeight(wizard, step) {
  const prevHeight = wizard.offsetHeight;
  wizard.style.height = 'auto';
  const newHeight = wizard.scrollHeight;
  if (prevHeight === newHeight) { wizard.style.height = ''; return; }
  wizard.style.height = prevHeight + 'px';
  void wizard.offsetHeight;
  wizard.style.height = newHeight + 'px';
  const onEnd = function(e) {
    if (e.target !== wizard || e.propertyName !== 'height') return;
    wizard.style.height = '';
    wizard.removeEventListener('transitionend', onEnd);
  };
  wizard.addEventListener('transitionend', onEnd);
}

function _wizardBackView(stepIndex) {
  if (stepIndex === 0) return null;
  const prevStep = stepIndex - 1;
  const btn = new window.View('button').className('wizard-back');
  btn.el.title = 'Back';
  btn.add(window.RawHTML(icon('chevronLeft', {strokeWidth: '2'})));
  btn.onTap(function() { _renderWizardStep(prevStep, 'back'); });
  return btn;
}

function _wizardDotsView(stepIndex) {
  const dots = [];
  for (let i = 0; i < _wizardTotalSteps; i++) {
    const cls = i === stepIndex ? 'active' : i < stepIndex ? 'completed' : '';
    dots.push(new window.View('div').className('wizard-dot ' + cls));
  }
  return window.HStack(dots).className('wizard-dots');
}

function _buildWizardStep(wizard, stepIndex) {
  _wizardStep = stepIndex;

  const contentView = window.Switch(stepIndex, {
    0: function() { return _wizardWelcomeView(); },
    1: function() { return _wizardUsernameView(); },
    2: function() { return _wizardAccentView(); },
    3: function() { return _wizardThemeView(); },
    4: function() { return _wizardTabLayoutView(); },
    5: function() { return _wizardBookmarkImportView(); },
    6: function() { return _wizardFeedsView(); },
    7: function() { return _wizardChatModelView(); },
    8: function() { return _wizardPixelPetView(); },
    9: function() { return _wizardCursorView(); },
    10: function() { return _wizardNeuralookView(); },
    11: function() { return _wizardFinaleView(); },
  }).transition('slide');

  const stepView = new window.View('div').className('wizard-step');
  stepView.styles({ position: 'relative' });
  const step = stepView.el;
  const backView = _wizardBackView(stepIndex);
  if (backView) AetherUI.append(backView, step);
  AetherUI.append(_wizardDotsView(stepIndex), step);
  if (contentView) AetherUI.append(contentView, step);
  wizard.append(step);

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      step.classList.add('active');
      _wizardAnimateHeight(wizard, step);
    });
  });

  if (stepIndex === 1) _wizardUsernameInit();
  else if (stepIndex === 2) _wizardAccentInit();
  else if (stepIndex === 3) _wizardThemeInit();
  else if (stepIndex === 5) _wizardBookmarkImportInit();
  else if (stepIndex === 6) _wizardFeedsInit();
  else if (stepIndex === 7) _wizardChatModelInit();
  else if (stepIndex === 8) _wizardPixelPetInit();
  else if (stepIndex === 9) _wizardCursorInit();
}

function _renderWizardStep(stepIndex, direction) {
  const wizard = document.getElementById('onboarding-wizard');
  if (!wizard) return;

  const prev = wizard.querySelector('.wizard-step');
  if (prev) {
    prev.classList.remove('active');
    prev.classList.add('exit-left');
    setTimeout(function() { if (prev.parentNode) prev.remove(); }, 350);
    setTimeout(function() { _buildWizardStep(wizard, stepIndex); }, 350);
  } else {
    _buildWizardStep(wizard, stepIndex);
  }
}

// ── Step 0: Welcome ──

function _wizardWelcomeView() {
  const name = (window._authUserInfo && (window._authUserInfo.name || '')) || _authUser || '';
  const firstName = name.split(' ')[0] || 'there';
  const pic = window._authUserInfo && window._authUserInfo.picture;
  let avatarView;
  if (pic) {
    const img = new window.View('img').className('wizard-welcome-avatar');
    img.el.src = pic;
    img.el.referrerPolicy = 'no-referrer';
    avatarView = img;
  } else {
    avatarView = new window.View('div').className('wizard-welcome-letter');
    avatarView.el.textContent = firstName[0].toUpperCase();
  }
  const continueBtn = new window.View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Get started';
  continueBtn.onTap(function() { _renderWizardStep(1, 'forward'); });
  return window.VStack(
    avatarView,
    window.Text('Welcome, ' + firstName).styles({fontSize:'22px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'6px'}),
    window.Text("Let's get your workspace set up. This only takes a moment.").styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'24px'}),
    continueBtn
  ).textAlign('center');
}

// ── Step 1: Username ──

function _wizardUsernameView() {
  const input = new window.View('input').id('wiz-username');
  input.el.type = 'text';
  input.el.maxLength = 20;
  input.el.placeholder = 'username';
  input.cssText('width:100%;box-sizing:border-box;padding:10px 14px;font-size:15px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--nr-text-primary,#e0e0e0);outline:none;text-align:center;');
  const submitBtn = new window.View('button').id('wiz-username-btn').className('nr-btn nr-btn-primary nr-btn-lg').styles({marginTop:'4px'});
  submitBtn.el.textContent = 'Continue';
  submitBtn.el.disabled = true;
  submitBtn.onTap(function() { _wizardSubmitUsername(); });
  return window.VStack(
    window.Text('Choose a username').styles({fontSize:'20px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'4px'}),
    window.Text('This will be your public identity.').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'20px'}),
    input,
    window.Text('2-20 characters: letters, numbers, hyphens, underscores').id('wiz-username-hint').styles({fontSize:'11px', color:'var(--nr-text-secondary,#999)', marginTop:'6px'}),
    new window.View('div').id('wiz-username-error').styles({fontSize:'12px', color:'#e74c3c', marginTop:'6px', minHeight:'18px'}),
    submitBtn
  ).textAlign('center');
}

function _wizardUsernameInit() {
  const input = document.getElementById('wiz-username');
  if (!input) return;
  input.addEventListener('input', function() {
    const val = input.value.replace(/[^a-zA-Z0-9_-]/g, '');
    if (val !== input.value) input.value = val;
    const btn = document.getElementById('wiz-username-btn');
    const valid = val.length >= 2 && val.length <= 20;
    if (btn) btn.disabled = !valid;
    const errEl = document.getElementById('wiz-username-error');
    if (errEl) errEl.textContent = '';
  });
  input.addEventListener('keydown', function(e) {
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
    window._authUserInfo.username = data.username;
    localStorage.setItem('authUserInfo', JSON.stringify(window._authUserInfo));
  } catch (e) {
    logger.warn('[wizard] username commit failed:', e.message);
  }
  _wizardPendingUsername = null;
}

// ── Step 2: Accent Color ──

function _wizardAccentView() {
  const current = Settings.get('accentColor') || '#b4451a';
  const currentName = (_wizardAccentColors.find(function(c) { return c.color === current; }) || { name: 'Orange' }).name;
  const swatches = _wizardAccentColors.map(function(a) {
    const btn = new window.View('button').className('onboard-swatch' + (a.color === current ? ' selected' : ''));
    btn.styles({ background: a.color });
    btn.el.dataset.color = a.color;
    btn.el.dataset.name = a.name;
    btn.onTap(function() { _wizardPickAccent(a.color, btn.el); });
    return btn;
  });
  const continueBtn = new window.View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _wizardAccentContinue(); });
  return window.VStack(
    window.Text('Pick your color').styles({fontSize:'20px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'4px'}),
    window.Text('You can change this anytime in settings.').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'20px'}),
    window.HStack(swatches).className('flex flex-wrap justify-center gap-3 mb-3.5'),
    window.Text(currentName).id('wiz-color-name').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'16px'}),
    continueBtn
  ).textAlign('center');
}

function _wizardAccentInit() {
  const current = Settings.get('accentColor') || '#b4451a';
  if (typeof applyAccentColor === 'function') applyAccentColor(current);
  _wizardUpdateAccentGlow();
}

function _wizardPickAccent(color, el) {
  if (typeof setAccentColor === 'function') setAccentColor(color);
  _wizardUpdateAccentGlow();
  const wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.onboard-swatch').forEach(function(s) { s.classList.remove('selected'); });
  }
  if (el) el.classList.add('selected');
  const nameEl = document.getElementById('wiz-color-name');
  const match = _wizardAccentColors.find(function(c) { return c.color === color; });
  if (nameEl && match) nameEl.textContent = match.name;
}

function _wizardAccentContinue() {
  _renderWizardStep(3, 'forward');
}

// ── Step 3: Theme ──

function _wizardThemePreviewHTML(t) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';
  return '<div class="wizard-theme-preview" style="background:' + t.bg + ';border-color:' + (t.id === 'dark' || t.id === 'clear' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)') + ';">' +
    '<div class="wizard-theme-preview-bar" style="background:' + t.bar + ';"></div>' +
    '<div class="wizard-theme-preview-body">' +
      '<div class="wizard-theme-preview-line" style="background:' + t.text + ';opacity:0.5;"></div>' +
      '<div class="wizard-theme-preview-line" style="background:' + accent + ';opacity:0.7;"></div>' +
      '<div class="wizard-theme-preview-line" style="background:' + t.text + ';opacity:0.3;"></div>' +
    '</div></div>';
}

function _wizardThemeView() {
  const current = Settings.get('theme') || 'clear';
  const options = _wizardThemes.map(function(t) {
    const btn = new window.View('button').className('wizard-theme-option' + (t.id === current ? ' selected' : ''));
    btn.el.dataset.theme = t.id;
    btn.add(window.RawHTML(_wizardThemePreviewHTML(t)));
    const labelWrap = new window.View('div').flex(1).textAlign('left').styles({marginLeft:'12px'});
    labelWrap.add(window.RawHTML('<span class="wizard-theme-name">' + t.name + '</span><br/><span class="wizard-theme-desc">' + t.desc + '</span>'));
    btn.add(labelWrap);
    btn.onTap(function() { _wizardPickTheme(t.id, btn.el); });
    return btn;
  });
  const continueBtn = new window.View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _wizardThemeContinue(); });
  return window.VStack(
    window.Text('Choose a theme').styles({fontSize:'20px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'4px'}),
    window.Text('Sets the overall look and feel.').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'20px'}),
    window.VStack(options).spacing(2).styles({marginBottom:'20px'}),
    continueBtn
  ).textAlign('center');
}

function _wizardThemeInit() {
  const current = Settings.get('theme') || 'clear';
  if (typeof setTheme === 'function') setTheme(current);
}

function _wizardPickTheme(themeId, el) {
  if (typeof setTheme === 'function') setTheme(themeId);
  const modal = document.getElementById('onboarding-wizard');
  const isLight = themeId === 'light' || themeId === 'daylight';
  if (modal) {
    modal.style.background = isLight ? 'rgba(255, 255, 255, 0.75)' : 'rgba(12, 12, 20, 0.7)';
    modal.style.borderColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    modal.style.color = isLight ? '#333' : '#e0e0e0';
  }
  const wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-theme-option').forEach(function(b) { b.classList.remove('selected'); });
  }
  if (el) el.classList.add('selected');
}

function _wizardThemeContinue() {
  _renderWizardStep(5, 'forward');
}

// ── Step 4: (removed — was tab layout choice) ──
// Skip directly to step 5 to avoid renumbering all subsequent steps
function _wizardTabLayoutView() {
  setTimeout(function() { _renderWizardStep(5, 'forward'); }, 0);
  return new window.View('div');
}

// ── Step 5: Bookmark Import ──

let _wizBmParsed = {};    // browserId → bookmarks array
let _wizBmSelected = {};  // browserId → Set of selected URLs
let _wizBmExpandedId = null;
let _wizBmBrowsers = [];

function _wizardBookmarkImportView() {
  const continueBtn = new window.View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _renderWizardStep(6, 'forward'); });
  const skipBtn = new window.View('button').className('nr-btn nr-btn-ghost');
  skipBtn.el.textContent = 'Skip';
  skipBtn.onTap(function() { _renderWizardStep(6, 'forward'); });
  return window.VStack(
    window.Text('Import bookmarks').styles({fontSize:'20px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'4px'}),
    window.Text('Bring your bookmarks from other browsers into your reading list.').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'20px'}),
    new window.View('div').id('wiz-bookmark-browsers').styles({marginBottom:'20px', textAlign:'left'}),
    continueBtn,
    skipBtn
  ).textAlign('center');
}

function _wizardBookmarkImportInit() {
  var container = document.getElementById('wiz-bookmark-browsers');
  if (!container) return;
  if (!window.electronAPI || !window.electronAPI.dbQuery) {
    AetherUI.mount(window.Text('Bookmark import requires the desktop app.').styles({ fontSize: '12px', color: 'var(--nr-text-secondary,#999)', padding: '16px 0', textAlign: 'center' }), container);
    return;
  }
  if (window.Skeleton) {
    AetherUI.mount(window.Skeleton().lines(2).padding(2), container);
  } else {
    AetherUI.mount(window.Text('Detecting browsers...').styles({ fontSize: '12px', color: 'var(--nr-text-secondary,#999)', padding: '16px 0', textAlign: 'center' }), container);
  }
  window.electronAPI.dbQuery('bookmark-detect').then(function(result) {
    if (!result || !result.browsers || !result.browsers.length) {
      AetherUI.mount(window.Text('No other browsers detected.').styles({ fontSize: '12px', color: 'var(--nr-text-secondary,#999)', padding: '16px 0', textAlign: 'center' }), container);
      return;
    }
    _wizBmBrowsers = result.browsers;
    _wizBmRenderList(container);
  }).catch(function() {
    AetherUI.mount(window.Text('Could not detect browsers.').styles({ fontSize: '12px', color: 'var(--nr-text-secondary,#999)', padding: '16px 0', textAlign: 'center' }), container);
  });
}

function _wizBmRenderList(container) {
  var cards = _wizBmBrowsers.map(function(b) {
    var isExpanded = _wizBmExpandedId === b.id;
    var chevron = window.RawHTML(icon('chevronRightSmall', { size: 12, stroke: 'var(--nr-text-quaternary)', style: 'transition:transform 0.15s;' + (isExpanded ? 'transform:rotate(90deg);' : '') }));
    var nameView = window.Text(b.name).styles({fontSize:'0.85rem', fontWeight:'500', color:'var(--nr-text-primary,#e0e0e0)', flex:'1'});
    var countView = new window.View('span').id('wiz-bm-count-' + b.id).styles({fontSize:'0.68rem', color:'var(--nr-text-quaternary)'});
    if (_wizBmParsed[b.id]) countView.el.textContent = _wizBmParsed[b.id].length + ' bookmarks';

    var header = window.HStack(
      window.RawHTML('<div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;">' + icon('globe', {size: 18, stroke: 'var(--nr-text-secondary,#999)'}) + '</div>'),
      nameView, countView, chevron
    ).spacing(2).styles({padding:'8px 12px', cursor:'pointer'});
    header.onTap(function() { _wizBmToggle(b.id, container); });

    var items = [header];
    if (isExpanded) {
      var detail = new window.View('div').id('wiz-bm-detail-' + b.id).styles({padding:'0 12px 10px', borderTop:'1px solid rgba(255,255,255,0.06)'});
      if (_wizBmParsed[b.id]) {
        _wizBmRenderBookmarks(detail.el, b.id);
      } else {
        if (window.Skeleton) {
          AetherUI.mount(window.Skeleton().lines(2), detail.el);
        } else {
          AetherUI.mount(window.Text('Loading bookmarks...').styles({ fontSize: '0.72rem', color: 'var(--nr-text-quaternary)', padding: '10px 0' }), detail.el);
        }
      }
      items.push(detail);
    }

    return VStack(items).styles({
      border:'1px solid rgba(255,255,255,0.08)', borderRadius:'10px', marginBottom:'6px', overflow:'hidden',
      background:'rgba(255,255,255,0.02)'
    });
  });
  AetherUI.mount(window.VStack(cards), container);
}

function _wizBmToggle(browserId, container) {
  if (_wizBmExpandedId === browserId) {
    _wizBmExpandedId = null;
    _wizBmRenderList(container);
    return;
  }
  _wizBmExpandedId = browserId;
  _wizBmRenderList(container);

  if (!_wizBmParsed[browserId]) {
    window.electronAPI.dbQuery('bookmark-parse', browserId).then(function(result) {
      var bookmarks = (result && result.bookmarks) || [];
      _wizBmParsed[browserId] = bookmarks;
      _wizBmSelected[browserId] = new Set(bookmarks.map(function(bm) { return bm.url; }));
      var countEl = document.getElementById('wiz-bm-count-' + browserId);
      if (countEl) countEl.textContent = bookmarks.length + ' bookmarks';
      var detail = document.getElementById('wiz-bm-detail-' + browserId);
      if (detail) _wizBmRenderBookmarks(detail, browserId);
    }).catch(function() {
      var detail = document.getElementById('wiz-bm-detail-' + browserId);
      if (detail) AetherUI.mount(window.Text('Failed to load bookmarks.').styles({ fontSize: '0.72rem', color: 'var(--nr-text-quaternary)', padding: '10px 0' }), detail);
    });
  }
}

function _wizBmRenderBookmarks(container, browserId) {
  var bookmarks = _wizBmParsed[browserId] || [];
  var selected = _wizBmSelected[browserId] || new Set();
  var selectedCount = selected.size;

  if (!bookmarks.length) {
    AetherUI.mount(window.Text('No bookmarks found.').styles({fontSize:'0.72rem', color:'var(--nr-text-quaternary)', padding:'10px 0'}), container);
    return;
  }

  // Select all / deselect all
  var allSelected = selectedCount === bookmarks.length;
  var toggleAllBtn = new window.View('button').styles({fontSize:'0.7rem', color:'var(--accent,#b4451a)', background:'none', border:'none', cursor:'pointer', padding:'0'});
  toggleAllBtn.el.textContent = allSelected ? 'Deselect all' : 'Select all';
  toggleAllBtn.onTap(function() {
    if (allSelected) _wizBmSelected[browserId] = new Set();
    else _wizBmSelected[browserId] = new Set(bookmarks.map(function(bm) { return bm.url; }));
    _wizBmRenderBookmarks(container, browserId);
  });

  var headerRow = window.HStack(
    window.Text(selectedCount + ' of ' + bookmarks.length + ' selected').styles({flex:'1', fontSize:'0.7rem', color:'var(--nr-text-quaternary)'}),
    toggleAllBtn
  ).styles({padding:'8px 0 6px'});

  var rows = bookmarks.map(function(bm) {
    var isSel = selected.has(bm.url);
    var hostname = '';
    try { hostname = new URL(bm.url).hostname; } catch(e) {}
    var favicon = hostname ? 'https://www.google.com/s2/favicons?domain=' + hostname + '&sz=32' : '';

    var checkSvg = isSel ? icon('check', {size: 10, stroke: '#fff', strokeWidth: '3'}) : '';
    var checkCircle = new window.View('div').styles({
      width:'16px', height:'16px', borderRadius:'4px', flexShrink:'0',
      border:'1.5px solid ' + (isSel ? 'var(--accent,#b4451a)' : 'rgba(255,255,255,0.15)'),
      background: isSel ? 'var(--accent,#b4451a)' : 'transparent',
      display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s'
    });
    if (checkSvg) checkCircle.add(window.RawHTML(checkSvg));

    var faviconView = favicon
      ? window.RawHTML('<img src="' + favicon + '" style="width:14px;height:14px;border-radius:2px;flex-shrink:0;" onerror="this.style.display=\'none\'">')
      : window.RawHTML('<span style="width:14px;"></span>');

    var titleView = window.Text(bm.title || bm.url).styles({fontSize:'0.78rem', color:'var(--nr-text-primary,#e0e0e0)', flex:'1', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'});
    var hostView = window.Text(hostname).styles({fontSize:'0.62rem', color:'var(--nr-text-quaternary)', flexShrink:'0'});

    var row = window.HStack(checkCircle, faviconView, titleView, hostView)
      .spacing(2).styles({padding:'4px 2px', cursor:'pointer', borderRadius:'4px', transition:'background 0.1s'});
    row.el.addEventListener('mouseenter', function() { this.style.background = 'rgba(255,255,255,0.04)'; });
    row.el.addEventListener('mouseleave', function() { this.style.background = 'transparent'; });
    (function(url) {
      row.el.addEventListener('click', function() {
        if (selected.has(url)) selected.delete(url);
        else selected.add(url);
        _wizBmRenderBookmarks(container, browserId);
      });
    })(bm.url);
    return row;
  });

  var listWrap = VStack(rows);
  listWrap.styles({maxHeight:'200px', overflowY:'auto'});

  // Import button
  var statusView = new window.View('span').id('wiz-bm-import-status-' + browserId).styles({fontSize:'0.72rem', color:'var(--nr-text-quaternary)'});
  var importBtn = window.Button('Import ' + selectedCount + ' bookmarks').id('wiz-bm-import-btn-' + browserId).styles({
    padding:'6px 16px', borderRadius:'6px', border:'none', flex:'1',
    background: selectedCount > 0 ? 'var(--accent,#b4451a)' : 'rgba(255,255,255,0.05)',
    color: selectedCount > 0 ? '#fff' : 'var(--nr-text-quaternary,#666)',
    fontSize:'0.78rem', fontWeight:'500', cursor: selectedCount > 0 ? 'pointer' : 'default',
    opacity: selectedCount > 0 ? '1' : '0.5'
  });
  importBtn.el.disabled = selectedCount === 0;
  importBtn.onTap(function() { _wizBmDoImport(browserId, container); });

  var footer = window.HStack(importBtn, statusView).spacing(2).styles({paddingTop:'8px', borderTop:'1px solid rgba(255,255,255,0.06)', marginTop:'4px'});

  AetherUI.mount(window.VStack(headerRow, listWrap, footer), container);
}

function _wizBmDoImport(browserId, container) {
  var btn = document.getElementById('wiz-bm-import-btn-' + browserId);
  var status = document.getElementById('wiz-bm-import-status-' + browserId);
  if (btn) { btn.textContent = 'Importing...'; btn.disabled = true; }

  var googleId = window._authUserInfo && window._authUserInfo.google_id;
  if (!googleId) {
    if (status) status.textContent = 'Sign in first';
    if (btn) { btn.textContent = 'Import'; btn.disabled = false; }
    return;
  }

  var selected = _wizBmSelected[browserId];
  var selectedUrls = selected ? Array.from(selected) : [];

  window.electronAPI.dbQuery('bookmark-import', browserId, googleId, selectedUrls).then(function(result) {
    if (result && result.ok) {
      if (status) status.textContent = result.imported + ' imported' + (result.skipped ? ', ' + result.skipped + ' skipped' : '');
      if (btn) { btn.textContent = 'Done'; btn.disabled = true; btn.style.background = 'rgba(255,255,255,0.05)'; btn.style.color = 'var(--nr-text-secondary,#999)'; }
      window.electronAPI.dbQuery('user-data-get', googleId, 'savedPosts').then(function(data) {
        if (data && data.value) {
          var val = typeof data.value === 'string' ? data.value : JSON.stringify(data.value);
          localStorage.setItem('savedPosts', val);
        }
      }).catch(function() {});
    } else {
      if (status) status.textContent = result && result.error ? result.error : 'Import failed';
      if (btn) { btn.textContent = 'Retry'; btn.disabled = false; }
    }
  }).catch(function() {
    if (status) status.textContent = 'Error';
    if (btn) { btn.textContent = 'Retry'; btn.disabled = false; }
  });
}

// ── Step 6: Feed Selection ──

const _wizardFeedSelected = new Set();
let _wizardFeedCategory = null;

function _wizardFeedsView() {
  const continueBtn = new window.View('button').id('wiz-feed-continue').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _renderWizardStep(7, 'forward'); });
  return window.VStack(
    window.Text('Choose your feeds').styles({fontSize:'20px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'4px'}),
    window.Text('Pick RSS feeds to follow. You can change these later.').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'16px'}),
    new window.View('div').id('wiz-feed-tabs').className('flex flex-wrap gap-1.5 justify-center mb-3'),
    new window.View('div').id('wiz-feed-grid').styles({maxHeight:'280px', overflowY:'auto', textAlign:'left', marginBottom:'16px'}),
    continueBtn
  ).textAlign('center');
}

function _wizardFeedsInit() {
  if (_wizardFeedSelected.size === 0) {
    FEED_CATALOG.forEach(function(f) { _wizardFeedSelected.add(f.key); });
  }
  _wizardFeedRenderTabs();
  _wizardFeedRenderGrid();
}

function _wizardFeedRenderTabs() {
  const tabsContainer = document.getElementById('wiz-feed-tabs');
  if (!tabsContainer) return;
  const cats = [];
  FEED_CATALOG.forEach(function(f) { if (cats.indexOf(f.cat) === -1) cats.push(f.cat); });
  const tabs = [];
  const allTab = new window.View('button').className('wizard-feed-tab' + (_wizardFeedCategory === null ? ' active' : ''));
  allTab.el.textContent = 'All';
  allTab.onTap(function() { _wizardFeedSelectCategory(null); });
  tabs.push(allTab);
  cats.forEach(function(cat) {
    const tab = new window.View('button').className('wizard-feed-tab' + (_wizardFeedCategory === cat ? ' active' : ''));
    tab.el.textContent = cat;
    tab.onTap(function() { _wizardFeedSelectCategory(cat); });
    tabs.push(tab);
  });
  AetherUI.mount(window.HStack(tabs).className('flex flex-wrap gap-1.5 justify-center'), tabsContainer);
}

function _wizardFeedSelectCategory(cat) {
  _wizardFeedCategory = cat;
  _wizardFeedRenderTabs();
  _wizardFeedRenderGrid();
}

function _wizardFeedRenderGrid() {
  const grid = document.getElementById('wiz-feed-grid');
  if (!grid) return;

  const entries = _wizardFeedCategory
    ? FEED_CATALOG.filter(function(f) { return f.cat === _wizardFeedCategory; })
    : FEED_CATALOG;

  const byCategory = {};
  entries.forEach(function(f) {
    if (!byCategory[f.cat]) byCategory[f.cat] = [];
    byCategory[f.cat].push(f);
  });

  const sections = [];
  for (const cat of Object.keys(byCategory)) {
    const items = byCategory[cat];
    const allOn = items.every(function(f) { return _wizardFeedSelected.has(f.key); });

    // Category header
    const catLabel = window.Text(cat).styles({fontSize:'0.72rem', color:'var(--nr-text-secondary,#999)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:'500'});
    const sep = new window.View('span').flex(1).styles({height:'1px', background:'rgba(255,255,255,0.06)'});
    var toggleAllBtn = new window.View('button').styles({fontSize:'0.68rem', color:'var(--nr-text-secondary,#777)', background:'none', border:'none'}).cursor();
    toggleAllBtn.el.textContent = allOn ? 'Deselect all' : 'Select all';
    (function(c) { toggleAllBtn.onTap(function() { _wizardFeedToggleCategory(c); }); })(cat);
    const header = window.HStack(catLabel, sep, toggleAllBtn).spacing(2).className('items-center').styles({padding:'0 4px', marginBottom:'4px'});

    // Feed items
    const feedRows = items.map(function(f) {
      const sel = _wizardFeedSelected.has(f.key);
      let faviconView;
      if (f.favicon) {
        faviconView = window.RawHTML('<img src="https://www.google.com/s2/favicons?domain=' + f.favicon + '&sz=32" style="width:20px;height:20px;border-radius:4px;" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span style="display:none;width:20px;height:20px;border-radius:4px;align-items:center;justify-content:center;font-size:0.6rem;font-weight:bold;background:' + (f.bg || '#333') + ';color:' + (f.fg || '#fff') + '">' + (f.letter || f.name[0]) + '</span>');
      } else {
        faviconView = window.RawHTML('<span style="display:flex;width:20px;height:20px;border-radius:4px;align-items:center;justify-content:center;font-size:0.6rem;font-weight:bold;background:' + (f.bg || '#333') + ';color:' + (f.fg || '#fff') + '">' + (f.letter || f.name[0]) + '</span>');
      }
      const nameView = window.Text(f.name).styles({fontSize:'0.82rem', fontWeight:'500', color: sel ? 'var(--nr-text-primary,#e0e0e0)' : 'var(--nr-text-secondary,#999)'}).truncate();
      const descView = window.Text(f.desc).styles({fontSize:'0.7rem', color:'var(--nr-text-secondary,#777)'}).truncate();
      const textCol = window.VStack(nameView, descView).flex(1).styles({minWidth:'0'});
      const checkSvg = sel ? icon('check', {size: 12, stroke: '#fff', strokeWidth: '3'}) : '';
      const checkCircle = new window.View('div').styles({width:'20px', height:'20px', borderRadius:'50%', border:'2px solid ' + (sel ? 'var(--accent,#b4451a)' : 'rgba(255,255,255,0.15)'), background: sel ? 'var(--accent,#b4451a)' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:'0', transition:'all 0.15s'});
      if (checkSvg) checkCircle.add(window.RawHTML(checkSvg));
      const row = window.HStack(faviconView, textCol, checkCircle).spacing(2.5).styles({padding:'6px 10px', borderRadius:'8px', transition:'background 0.15s', background: sel ? 'rgba(255,255,255,0.04)' : 'transparent'}).cursor();
      (function(key, isSel) {
        row.el.addEventListener('click', function() { _wizardFeedToggle(key); });
        row.el.addEventListener('mouseenter', function() { this.style.background = 'rgba(255,255,255,0.06)'; });
        row.el.addEventListener('mouseleave', function() { this.style.background = isSel ? 'rgba(255,255,255,0.04)' : 'transparent'; });
      })(f.key, sel);
      return row;
    });

    sections.push(window.VStack([header].concat(feedRows)).styles({marginBottom:'12px'}));
  }
  AetherUI.mount(window.VStack(sections), grid);

  const btn = document.getElementById('wiz-feed-continue');
  if (btn) btn.disabled = _wizardFeedSelected.size === 0;
}

function _wizardFeedToggle(key) {
  if (_wizardFeedSelected.has(key)) _wizardFeedSelected.delete(key);
  else _wizardFeedSelected.add(key);
  _wizardFeedRenderGrid();
}

function _wizardFeedToggleCategory(cat) {
  const items = FEED_CATALOG.filter(function(f) { return f.cat === cat; });
  const allOn = items.every(function(f) { return _wizardFeedSelected.has(f.key); });
  items.forEach(function(f) {
    if (allOn) _wizardFeedSelected.delete(f.key);
    else _wizardFeedSelected.add(f.key);
  });
  _wizardFeedRenderGrid();
}

// ── Step 7: Chat Model ──

function _wizardChatModelView() {
  const continueBtn = new window.View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _renderWizardStep(8, 'forward'); });
  return window.VStack(
    window.Text('Choose a model').styles({fontSize:'20px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'4px'}),
    window.Text('Pick the default Ollama model for chat and tools.').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'20px'}),
    new window.View('div').id('wiz-model-list').className('flex flex-col gap-1.5 mb-5').styles({maxHeight:'200px', overflowY:'auto'}),
    continueBtn
  ).textAlign('center');
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
    AetherUI.mount(window.Text('No models found. Make sure Ollama is running.').styles({fontSize:'12px', color:'var(--nr-text-secondary,#999)', padding:'16px 0'}), container);
    return;
  }

  const current = Settings.get('chatModel') || 'qwen2.5:3b';
  const btns = _wizardModelList.map(function(m) {
    const btn = new window.View('button').className('wizard-model-option' + (m === current ? ' selected' : ''));
    btn.el.textContent = m;
    (function(model) {
      btn.onTap(function() { _wizardPickModel(model, btn.el); });
    })(m);
    return btn;
  });
  AetherUI.mount(window.VStack(btns).spacing(1.5), container);
}

function _wizardPickModel(model, el) {
  Settings.set('chatModel', model);
  const wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-model-option').forEach(function(b) { b.classList.remove('selected'); });
  }
  if (el) el.classList.add('selected');
}

// ── Step 8: Pixel Pet ──

function _wizardPixelPetView() {
  const petOn = Settings.get('pixelPet') === 'on';
  const currentType = Settings.get('pixelPetType') || 'cat';
  const petBtns = _wizardPetTypes.map(function(p) {
    const sel = petOn && currentType === p.id;
    const btn = new window.View('button').className('wizard-pet-option' + (sel ? ' selected' : '')).styles({display:'flex', flexDirection:'column', alignItems:'center', gap:'6px', padding:'10px 12px'});
    btn.el.dataset.pet = p.id;
    btn.add(window.RawHTML('<canvas class="wiz-pet-sprite" data-pet-id="' + p.id + '" width="48" height="48" style="image-rendering:pixelated;width:48px;height:48px;"></canvas>'));
    btn.add(window.Text(p.name).styles({fontSize:'11px'}));
    (function(petId) {
      btn.onTap(function() { _wizardPickPet(petId, btn.el); });
    })(p.id);
    return btn;
  });
  // "None" option
  const noneBtn = new window.View('button').className('wizard-pet-option' + (!petOn ? ' selected' : '')).styles({display:'flex', flexDirection:'column', alignItems:'center', gap:'6px', padding:'10px 12px'});
  noneBtn.el.dataset.pet = 'none';
  noneBtn.add(window.RawHTML('<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;">' + icon('close', {size: 24, stroke: 'var(--nr-text-secondary,#999)'}) + '</div>'));
  noneBtn.add(window.Text('None').styles({fontSize:'11px'}));
  noneBtn.onTap(function() { _wizardPickPet('none', noneBtn.el); });
  petBtns.push(noneBtn);

  const continueBtn = new window.View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _renderWizardStep(9, 'forward'); });  // → Cursor step
  return window.VStack(
    window.Text('Pick a companion').styles({fontSize:'20px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'4px'}),
    window.Text('A pixel pet that lives on your screen. Or go solo.').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'20px'}),
    window.HStack(petBtns).className('flex flex-wrap justify-center gap-2.5 mb-5'),
    continueBtn
  ).textAlign('center');
}

function _wizardPixelPetInit() {
  const sprites = _wizardPetSprites();
  const G = 16, S = 48 / G;
  document.querySelectorAll('.wiz-pet-sprite').forEach(function(canvas) {
    const id = canvas.dataset.petId;
    const draw = sprites[id];
    if (!draw) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 48, 48);
    function px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(x * S, y * S, S, S); }
    draw(px, { sitting: true, blink: false, legFrame: 0 });
  });
}

function _wizardPickPet(petId, el) {
  const wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-pet-option').forEach(function(b) { b.classList.remove('selected'); });
  }
  if (el) el.classList.add('selected');

  if (petId === 'none') {
    Settings.set('pixelPet', 'off');
  } else {
    Settings.set('pixelPet', 'on');
    Settings.set('pixelPetType', petId);
  }
}

function _wizardPetSprites() {
  return {
    cat(px, o) {
      const B='#e8a87c',D='#c4855c',I='#d4846a',O='#2a2a2a',E='#2a2a2a';
      px(4,3,O);px(5,2,O);px(6,3,O);px(5,3,I);px(9,3,O);px(10,2,O);px(11,3,O);px(10,3,I);
      for(let x=4;x<=11;x++)px(x,4,O);
      px(3,5,O);px(12,5,O);px(3,6,O);px(12,6,O);px(3,7,O);px(12,7,O);
      for(let x=4;x<=11;x++)px(x,8,O);
      for(let y=5;y<=7;y++)for(let x=4;x<=11;x++)px(x,y,B);
      px(6,6,E);px(10,6,E);px(8,7,I);
      px(4,9,O);px(11,9,O);for(let x=5;x<=10;x++)px(x,9,B);
      for(let x=4;x<=11;x++)px(x,10,O);
      px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);
      px(12,9,D);px(13,9,D);px(13,8,D);
    },
    blackCat(px, o) {
      const B='#1a1a1a',I='#333',O='#111',E='#7cfc00',N='#444';
      px(4,2,O);px(5,1,O);px(6,2,O);px(5,2,I);px(9,2,O);px(10,1,O);px(11,2,O);px(10,2,I);
      for(let x=4;x<=11;x++)px(x,3,O);
      px(3,4,O);px(12,4,O);px(3,5,O);px(12,5,O);px(3,6,O);px(12,6,O);
      for(let x=4;x<=11;x++)px(x,7,O);
      for(let y=4;y<=6;y++)for(let x=4;x<=11;x++)px(x,y,B);
      px(6,5,E);px(10,5,E);px(8,6,N);
      px(4,8,O);px(11,8,O);for(let x=5;x<=10;x++)px(x,8,B);
      for(let x=4;x<=11;x++)px(x,9,O);
      px(4,10,O);px(5,10,O);px(10,10,O);px(11,10,O);
      px(12,8,I);px(13,8,I);px(14,7,I);px(14,6,I);
    },
    dog(px, o) {
      const B='#c49a6c',D='#a07848',I='#dbb88c',O='#3a2a1a',E='#2a2a2a';
      px(3,4,O);px(4,3,O);px(5,3,O);px(3,5,O);px(3,6,D);px(4,4,D);
      px(12,4,O);px(11,3,O);px(10,3,O);px(12,5,O);px(12,6,D);px(11,4,D);
      for(let x=5;x<=10;x++)px(x,3,O);
      px(4,4,O);px(11,4,O);px(4,5,O);px(11,5,O);px(4,6,O);px(11,6,O);
      for(let x=5;x<=10;x++)px(x,7,O);
      for(let y=4;y<=6;y++)for(let x=5;x<=10;x++)px(x,y,B);
      px(6,5,E);px(9,5,E);px(7,6,O);px(8,6,O);
      px(4,8,O);px(11,8,O);for(let x=5;x<=10;x++)px(x,8,B);
      for(let x=4;x<=11;x++)px(x,9,O);
      px(4,10,O);px(5,10,O);px(10,10,O);px(11,10,O);
      px(12,8,D);px(13,7,D);px(14,7,D);
    },
    poodle(px, o) {
      const B='#E87830',D='#CC6020',O='#994400',E='#2a2a2a',N='#222',P='#F09048';
      px(5,1,P);px(6,1,P);px(9,1,P);px(10,1,P);
      px(4,2,P);px(5,2,P);px(6,2,P);px(7,2,P);px(8,2,P);px(9,2,P);px(10,2,P);px(11,2,P);
      px(3,3,P);px(4,3,P);px(11,3,P);px(12,3,P);
      for(let x=4;x<=11;x++)px(x,4,O);px(3,4,O);px(12,4,O);
      px(3,5,O);px(12,5,O);px(3,6,O);px(12,6,O);px(3,7,O);px(12,7,O);
      for(let x=4;x<=11;x++)px(x,8,O);
      for(let y=5;y<=7;y++)for(let x=4;x<=11;x++)px(x,y,B);
      px(2,5,P);px(2,6,P);px(3,5,P);px(3,6,P);px(12,5,P);px(12,6,P);px(13,5,P);px(13,6,P);
      px(6,6,E);px(10,6,E);px(8,7,N);
      px(4,9,O);px(11,9,O);for(let x=5;x<=10;x++)px(x,9,B);
      for(let x=4;x<=11;x++)px(x,10,O);
      px(3,10,P);px(4,11,P);px(5,11,P);px(10,11,P);px(11,11,P);px(12,10,P);
      px(12,9,P);px(13,8,P);px(13,9,P);px(14,8,P);
    },
    bunny(px, o) {
      const B='#eee',D='#ccc',I='#f5b0b0',O='#4a4a4a',E='#2a2a2a';
      px(5,0,O);px(5,1,O);px(5,2,O);px(6,0,O);px(6,1,I);px(6,2,I);px(6,3,O);
      px(9,0,O);px(9,1,O);px(9,2,O);px(10,0,O);px(10,1,I);px(10,2,I);px(10,3,O);
      for(let x=4;x<=11;x++)px(x,4,O);
      px(3,5,O);px(12,5,O);px(3,6,O);px(12,6,O);px(3,7,O);px(12,7,O);
      for(let x=4;x<=11;x++)px(x,8,O);
      for(let y=5;y<=7;y++)for(let x=4;x<=11;x++)px(x,y,B);
      px(6,6,E);px(10,6,E);px(8,7,I);
      px(4,9,O);px(11,9,O);for(let x=5;x<=10;x++)px(x,9,B);
      for(let x=4;x<=11;x++)px(x,10,O);
      px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);
      px(12,9,B);px(13,9,B);
    },
    froog(px, o) {
      const B='#ef4444',D='#dc2626',F='#c084fc',O='#7a1a1a',W='#fff',hi='#f87171';
      for(let x=5;x<=10;x++)px(x,1,B);px(4,1,O);px(11,1,O);
      for(let x=3;x<=12;x++)px(x,2,B);px(2,2,O);px(13,2,O);
      for(let x=2;x<=13;x++)px(x,3,B);px(1,3,O);px(14,3,O);
      for(let y=4;y<=10;y++){px(0,y,O);px(15,y,O);for(let x=1;x<=14;x++)px(x,y,B);}
      for(let x=1;x<=14;x++)px(x,11,B);px(0,11,O);px(15,11,O);
      for(let x=2;x<=13;x++)px(x,12,B);px(1,12,O);px(14,12,O);
      for(let x=3;x<=12;x++)px(x,13,O);
      px(10,2,hi);px(11,2,hi);px(12,2,hi);px(11,3,hi);px(12,3,hi);px(13,3,hi);px(12,4,hi);px(13,4,hi);
      for(let x=4;x<=11;x++)px(x,3,F);
      for(let x=3;x<=12;x++)px(x,4,F);
      for(let x=2;x<=12;x++){px(x,5,F);px(x,6,F);px(x,7,F);px(x,8,F);}
      for(let x=3;x<=11;x++)px(x,9,F);
      for(let x=4;x<=10;x++)px(x,10,F);
      for(let x=5;x<=9;x++)px(x,11,F);
      [[4,5],[9,5]].forEach(([ex,ey])=>{px(ex,ey,W);px(ex+1,ey,W);px(ex,ey+1,W);px(ex+1,ey+1,W);px(ex,ey,'#000');px(ex+1,ey,'#000');});
      px(4,8,O);px(5,9,O);px(6,9,O);px(7,9,O);px(8,9,O);px(9,9,O);px(10,9,O);px(11,8,O);
      px(2,13,D);px(3,13,D);px(4,13,D);px(11,13,D);px(12,13,D);px(13,13,D);
      px(2,14,O);px(3,14,O);px(12,14,O);px(13,14,O);
    },
    pacman(px, o) {
      const B='#ffd700',D='#e6c200',O='#b8860b',E='#2a2a2a';
      for(let x=6;x<=9;x++)px(x,2,O);
      px(4,3,O);px(5,3,O);px(10,3,O);px(11,3,O);for(let x=5;x<=10;x++)px(x,3,B);
      px(3,4,O);px(12,4,O);for(let x=4;x<=11;x++)px(x,4,B);
      for(let y=5;y<=9;y++){px(2,y,O);px(13,y,O);for(let x=3;x<=12;x++)px(x,y,B);}
      px(3,10,O);px(12,10,O);for(let x=4;x<=11;x++)px(x,10,B);
      px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);for(let x=5;x<=10;x++)px(x,11,B);
      for(let x=6;x<=9;x++)px(x,12,O);
      px(9,4,E);px(10,4,E);
    }
  };
}

// ── Step 9: Cursor Type ──

function _wizardCursorView() {
  const cursorOn = Settings.get('customCursor') !== 'off';
  function _cursorOption(id, name, desc, selected) {
    const btn = new window.View('button').className('wizard-cursor-option' + (selected ? ' selected' : ''));
    btn.el.dataset.cursor = id;
    btn.add(window.RawHTML('<div class="wizard-cursor-preview wizard-cursor-preview-' + id + '"></div>'));
    btn.add(window.RawHTML('<span class="wizard-theme-name">' + name + '</span>'));
    btn.add(window.RawHTML('<span class="wizard-theme-desc">' + desc + '</span>'));
    btn.onTap(function() { _wizardPickCursor(id, btn.el); });
    return btn;
  }
  const continueBtn = new window.View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _renderWizardStep(10, 'forward'); });
  return window.VStack(
    window.Text('Cursor style').styles({fontSize:'20px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'4px'}),
    window.Text('Choose how your cursor looks and feels.').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'20px'}),
    window.HStack(
      _cursorOption('on', 'Aether', 'Smooth dot + ring with inertia', cursorOn),
      _cursorOption('off', 'System', 'Default system cursor', !cursorOn)
    ).spacing(3).className('justify-center mb-5'),
    continueBtn
  ).textAlign('center');
}

function _wizardCursorInit() {
  // Apply current cursor state so user sees live preview
  var isOn = Settings.get('customCursor') !== 'off';
  if (window.AetherCursor) window.AetherCursor[isOn ? 'enable' : 'disable']();
}

function _wizardPickCursor(id, el) {
  var on = id === 'on';
  Settings.set('customCursor', on ? 'on' : 'off');
  if (window.AetherCursor) window.AetherCursor[on ? 'enable' : 'disable']();
  var wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-cursor-option').forEach(function(b) { b.classList.remove('selected'); });
  }
  if (el) el.classList.add('selected');
}

// ── Step 10: Neuralook (optional) ──

function _wizardNeuralookView() {
  const calibrateBtn = new window.View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  calibrateBtn.el.textContent = 'Calibrate now';
  calibrateBtn.onTap(function() { _wizardStartNeuralook(); });
  const skipBtn = new window.View('button').className('nr-btn nr-btn-ghost');
  skipBtn.el.textContent = 'Set up later';
  skipBtn.onTap(function() { _renderWizardStep(11, 'forward'); });
  return window.VStack(
    window.Text('Eye tracking').styles({fontSize:'20px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'4px'}),
    window.Text('Neuralook uses your camera for gaze-based navigation. A quick calibration is needed.').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'20px'}),
    window.RawHTML('<div style="margin-bottom:24px;">' + icon('eye', {size: 48, stroke: 'var(--nr-accent)', strokeWidth: '1.5'}) + '</div>'),
    calibrateBtn,
    skipBtn
  ).textAlign('center');
}

async function _wizardStartNeuralook() {
  await _wizardCommitAccount();
  if (_wizardFeedSelected.size > 0) {
    const sources = {};
    const notifSources = {};
    FEED_CATALOG.forEach(function(f) {
      sources[f.key] = _wizardFeedSelected.has(f.key);
      notifSources[f.key] = false;
    });
    Settings.setJSON('feedSources', sources);
    Settings.setJSON('feedNotifSources', notifSources);
  }
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) {
    overlay.remove();
    if (typeof window._onOnboardingComplete === 'function') {
      window._onOnboardingComplete();
      window._onOnboardingComplete = null;
    }
    setTimeout(function() { window.location.hash = '#neuralook'; }, 100);
  } else {
    window.location.href = '/#neuralook';
  }
}

// ── Step 10: Finale ──

function _wizardFinaleView() {
  const username = _wizardPendingUsername || (window._authUserInfo && window._authUserInfo.username) || 'you';
  const enterBtn = new window.View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  enterBtn.el.textContent = 'Enter the Net';
  enterBtn.onTap(function() { _wizardFinish(); });
  return window.VStack(
    window.RawHTML('<div class="wizard-finale-check">' + icon('check', {size: 28, stroke: '#fff', strokeWidth: '2.5'}) + '</div>'),
    window.Text("You're all set, @" + username).styles({fontSize:'22px', fontWeight:'600', color:'var(--nr-text-primary,#e0e0e0)', marginBottom:'6px'}),
    window.Text('Neural link established. Jack in.').styles({fontSize:'13px', color:'var(--nr-text-secondary,#999)', marginBottom:'24px'}),
    enterBtn
  ).textAlign('center');
}

async function _wizardFinish() {
  await _wizardCommitAccount();
  if (_wizardFeedSelected.size > 0) {
    const sources = {};
    const notifSources = {};
    FEED_CATALOG.forEach(function(f) {
      sources[f.key] = _wizardFeedSelected.has(f.key);
      notifSources[f.key] = false;
    });
    Settings.setJSON('feedSources', sources);
    Settings.setJSON('feedNotifSources', notifSources);
  }
  _wizardComplete();
}

function _wizardComplete() {
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) {
    // SPA mode — remove overlay and trigger auth success callback
    overlay.remove();
    if (typeof window._onOnboardingComplete === 'function') {
      window._onOnboardingComplete();
      window._onOnboardingComplete = null;
    }
  } else {
    // Standalone page — redirect
    window.location.href = '/';
  }
}

// Expose for SPA usage
window.openOnboarding = openOnboarding;

// Auto-start wizard on standalone page only
if (_isStandalonePage()) {
  document.addEventListener('DOMContentLoaded', function() {
    openOnboarding();
  });
}
