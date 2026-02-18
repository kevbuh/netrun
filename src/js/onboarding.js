// onboarding.js — Onboarding wizard (standalone page)
// Steps: 0=Welcome, 1=Username, 2=Accent Color, 3=Theme, 4=Tab Layout, 5=Feed Selection, 6=Chat Model, 7=Pixel Pet, 8=Neuralook, 9=Finale

// Auth guard: no token → redirect to login
(function() {
  if (!localStorage.getItem('authToken')) {
    window.location.href = '/login.html';
  }
})();

if (window.AetherUI) AetherUI.globals();

let _wizardStep = 0;
const _wizardTotalSteps = 10;

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
  _renderOnboardingWizard();
}

function _renderOnboardingWizard() {
  var container = document.getElementById('onboarding-container');
  if (!container) return;
  container.innerHTML = '<div id="onboarding-wizard" class="nr-modal wizard-mode" style="position:relative;"></div>';
  _wizardStep = 0;
  _renderWizardStep(0, 'forward');
}

function _wizardUpdateAccentGlow() {
  var modal = document.getElementById('onboarding-wizard');
  if (!modal) return;
  var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';
  var hex = accent.replace('#', '');
  var r = parseInt(hex.slice(0,2), 16) || 0;
  var g = parseInt(hex.slice(2,4), 16) || 0;
  var b = parseInt(hex.slice(4,6), 16) || 0;
  modal.style.setProperty('--accent-glow', 'rgba(' + r + ',' + g + ',' + b + ',0.15)');
  modal.classList.add('wizard-glow', 'nr-glow');
}

function _wizardAnimateHeight(wizard, step) {
  var prevHeight = wizard.offsetHeight;
  wizard.style.height = 'auto';
  var newHeight = step.scrollHeight;
  wizard.style.height = prevHeight + 'px';
  void wizard.offsetHeight;
  wizard.style.height = newHeight + 'px';
  var onEnd = function() { wizard.style.height = 'auto'; wizard.removeEventListener('transitionend', onEnd); };
  wizard.addEventListener('transitionend', onEnd);
}

function _wizardBackView(stepIndex) {
  if (stepIndex === 0) return null;
  var prevStep = stepIndex - 1;
  var btn = new View('button').className('wizard-back');
  btn.el.title = 'Back';
  btn.el.appendChild(RawHTML('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>').build());
  btn.onTap(function() { _renderWizardStep(prevStep, 'back'); });
  return btn;
}

function _wizardDotsView(stepIndex) {
  var dots = [];
  for (var i = 0; i < _wizardTotalSteps; i++) {
    var cls = i === stepIndex ? 'active' : i < stepIndex ? 'completed' : '';
    dots.push(new View('div').className('wizard-dot ' + cls));
  }
  return HStack(dots).className('wizard-dots');
}

function _renderWizardStep(stepIndex, direction) {
  var wizard = document.getElementById('onboarding-wizard');
  if (!wizard) return;

  var prev = wizard.querySelector('.wizard-step');
  if (prev) {
    prev.classList.remove('active');
    prev.classList.add('exit-left');
    setTimeout(function() { if (prev.parentNode) prev.remove(); }, 350);
  }

  var delay = prev ? 350 : 0;
  setTimeout(function() {
    _wizardStep = stepIndex;

    var contentView = null;
    if (stepIndex === 0) contentView = _wizardWelcomeView();
    else if (stepIndex === 1) contentView = _wizardUsernameView();
    else if (stepIndex === 2) contentView = _wizardAccentView();
    else if (stepIndex === 3) contentView = _wizardThemeView();
    else if (stepIndex === 4) contentView = _wizardTabLayoutView();
    else if (stepIndex === 5) contentView = _wizardFeedsView();
    else if (stepIndex === 6) contentView = _wizardChatModelView();
    else if (stepIndex === 7) contentView = _wizardPixelPetView();
    else if (stepIndex === 8) contentView = _wizardNeuralookView();
    else if (stepIndex === 9) contentView = _wizardFinaleView();

    var step = document.createElement('div');
    step.className = 'wizard-step';
    step.style.position = 'relative';
    var backView = _wizardBackView(stepIndex);
    if (backView) step.appendChild(backView.build());
    step.appendChild(_wizardDotsView(stepIndex).build());
    if (contentView) step.appendChild(contentView.build());
    wizard.appendChild(step);

    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        step.classList.add('active');
        _wizardAnimateHeight(wizard, step);
      });
    });

    if (stepIndex === 1) _wizardUsernameInit();
    else if (stepIndex === 2) _wizardAccentInit();
    else if (stepIndex === 3) _wizardThemeInit();
    else if (stepIndex === 5) _wizardFeedsInit();
    else if (stepIndex === 6) _wizardChatModelInit();
    else if (stepIndex === 7) _wizardPixelPetInit();
  }, delay);
}

// ── Step 0: Welcome ──

function _wizardWelcomeView() {
  var name = (_authUserInfo && (_authUserInfo.name || '')) || _authUser || '';
  var firstName = name.split(' ')[0] || 'there';
  var pic = _authUserInfo && _authUserInfo.picture;
  var avatarView;
  if (pic) {
    var img = new View('img').className('wizard-welcome-avatar');
    img.el.src = pic;
    img.el.referrerPolicy = 'no-referrer';
    avatarView = img;
  } else {
    avatarView = new View('div').className('wizard-welcome-letter');
    avatarView.el.textContent = firstName[0].toUpperCase();
  }
  var continueBtn = new View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Get started';
  continueBtn.onTap(function() { _renderWizardStep(1, 'forward'); });
  return VStack(
    avatarView,
    Text('Welcome, ' + firstName).style('font-size', '22px').style('font-weight', '600').style('color', 'var(--nr-text-primary,#e0e0e0)').style('margin-bottom', '6px'),
    Text("Let's get your workspace set up. This only takes a moment.").style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '24px'),
    continueBtn
  ).style('text-align', 'center');
}

// ── Step 1: Username ──

function _wizardUsernameView() {
  var input = new View('input').id('wiz-username');
  input.el.type = 'text';
  input.el.maxLength = 20;
  input.el.placeholder = 'username';
  input.el.style.cssText = 'width:100%;box-sizing:border-box;padding:10px 14px;font-size:15px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--nr-text-primary,#e0e0e0);outline:none;text-align:center;';
  var submitBtn = new View('button').id('wiz-username-btn').className('nr-btn nr-btn-primary nr-btn-lg').style('margin-top', '4px');
  submitBtn.el.textContent = 'Continue';
  submitBtn.el.disabled = true;
  submitBtn.onTap(function() { _wizardSubmitUsername(); });
  return VStack(
    Text('Choose a username').style('font-size', '20px').style('font-weight', '600').style('color', 'var(--nr-text-primary,#e0e0e0)').style('margin-bottom', '4px'),
    Text('This will be your public identity.').style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '20px'),
    input,
    Text('2-20 characters: letters, numbers, hyphens, underscores').id('wiz-username-hint').style('font-size', '11px').style('color', 'var(--nr-text-secondary,#999)').style('margin-top', '6px'),
    new View('div').id('wiz-username-error').style('font-size', '12px').style('color', '#e74c3c').style('margin-top', '6px').style('min-height', '18px'),
    submitBtn
  ).style('text-align', 'center');
}

function _wizardUsernameInit() {
  var input = document.getElementById('wiz-username');
  if (!input) return;
  input.addEventListener('input', function() {
    var val = input.value.replace(/[^a-zA-Z0-9_-]/g, '');
    if (val !== input.value) input.value = val;
    var btn = document.getElementById('wiz-username-btn');
    var valid = val.length >= 2 && val.length <= 20;
    if (btn) btn.disabled = !valid;
    var errEl = document.getElementById('wiz-username-error');
    if (errEl) errEl.textContent = '';
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var btn = document.getElementById('wiz-username-btn');
      if (btn && !btn.disabled) _wizardSubmitUsername();
    }
  });
  input.focus();
}

function _wizardSubmitUsername() {
  var input = document.getElementById('wiz-username');
  var errEl = document.getElementById('wiz-username-error');
  if (!input || !errEl) return;
  var username = input.value.trim();
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
    var data = await apiPost('/api/auth/username', { username: _wizardPendingUsername });
    _authUserInfo.username = data.username;
    localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
  } catch (e) {
    console.warn('[wizard] username commit failed:', e.message);
  }
  _wizardPendingUsername = null;
}

// ── Step 2: Accent Color ──

function _wizardAccentView() {
  var current = Settings.get('accentColor') || '#b4451a';
  var currentName = (_wizardAccentColors.find(function(c) { return c.color === current; }) || { name: 'Orange' }).name;
  var swatches = _wizardAccentColors.map(function(a) {
    var btn = new View('button').className('onboard-swatch' + (a.color === current ? ' selected' : ''));
    btn.el.style.background = a.color;
    btn.el.dataset.color = a.color;
    btn.el.dataset.name = a.name;
    btn.onTap(function() { _wizardPickAccent(a.color, btn.el); });
    return btn;
  });
  var continueBtn = new View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _wizardAccentContinue(); });
  return VStack(
    Text('Pick your color').style('font-size', '20px').style('font-weight', '600').style('color', 'var(--nr-text-primary,#e0e0e0)').style('margin-bottom', '4px'),
    Text('You can change this anytime in settings.').style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '20px'),
    HStack(swatches).className('flex flex-wrap justify-center gap-3 mb-3.5'),
    Text(currentName).id('wiz-color-name').style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '16px'),
    continueBtn
  ).style('text-align', 'center');
}

function _wizardAccentInit() {
  var current = Settings.get('accentColor') || '#b4451a';
  if (typeof applyAccentColor === 'function') applyAccentColor(current);
  _wizardUpdateAccentGlow();
}

function _wizardPickAccent(color, el) {
  if (typeof setAccentColor === 'function') setAccentColor(color);
  _wizardUpdateAccentGlow();
  var wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.onboard-swatch').forEach(function(s) { s.classList.remove('selected'); });
  }
  if (el) el.classList.add('selected');
  var nameEl = document.getElementById('wiz-color-name');
  var match = _wizardAccentColors.find(function(c) { return c.color === color; });
  if (nameEl && match) nameEl.textContent = match.name;
}

function _wizardAccentContinue() {
  _renderWizardStep(3, 'forward');
}

// ── Step 3: Theme ──

function _wizardThemePreviewHTML(t) {
  var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';
  return '<div class="wizard-theme-preview" style="background:' + t.bg + ';border-color:' + (t.id === 'dark' || t.id === 'clear' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)') + ';">' +
    '<div class="wizard-theme-preview-bar" style="background:' + t.bar + ';"></div>' +
    '<div class="wizard-theme-preview-body">' +
      '<div class="wizard-theme-preview-line" style="background:' + t.text + ';opacity:0.5;"></div>' +
      '<div class="wizard-theme-preview-line" style="background:' + accent + ';opacity:0.7;"></div>' +
      '<div class="wizard-theme-preview-line" style="background:' + t.text + ';opacity:0.3;"></div>' +
    '</div></div>';
}

function _wizardThemeView() {
  var current = Settings.get('theme') || 'clear';
  var options = _wizardThemes.map(function(t) {
    var btn = new View('button').className('wizard-theme-option' + (t.id === current ? ' selected' : ''));
    btn.el.dataset.theme = t.id;
    btn.el.appendChild(RawHTML(_wizardThemePreviewHTML(t)).build());
    var labelWrap = new View('div').style('flex', '1').style('text-align', 'left').style('margin-left', '12px');
    labelWrap.el.appendChild(RawHTML('<span class="wizard-theme-name">' + t.name + '</span><br/><span class="wizard-theme-desc">' + t.desc + '</span>').build());
    btn.el.appendChild(labelWrap.el);
    btn.onTap(function() { _wizardPickTheme(t.id, btn.el); });
    return btn;
  });
  var continueBtn = new View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _wizardThemeContinue(); });
  return VStack(
    Text('Choose a theme').style('font-size', '20px').style('font-weight', '600').style('color', 'var(--nr-text-primary,#e0e0e0)').style('margin-bottom', '4px'),
    Text('Sets the overall look and feel.').style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '20px'),
    VStack(options).spacing(2).style('margin-bottom', '20px'),
    continueBtn
  ).style('text-align', 'center');
}

function _wizardThemeInit() {
  var current = Settings.get('theme') || 'clear';
  if (typeof setTheme === 'function') setTheme(current);
}

function _wizardPickTheme(themeId, el) {
  if (typeof setTheme === 'function') setTheme(themeId);
  var modal = document.getElementById('onboarding-wizard');
  var isLight = themeId === 'light' || themeId === 'daylight';
  if (modal) {
    modal.style.background = isLight ? 'rgba(255, 255, 255, 0.75)' : 'rgba(12, 12, 20, 0.7)';
    modal.style.borderColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    modal.style.color = isLight ? '#333' : '#e0e0e0';
  }
  var wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-theme-option').forEach(function(b) { b.classList.remove('selected'); });
  }
  if (el) el.classList.add('selected');
}

function _wizardThemeContinue() {
  _renderWizardStep(4, 'forward');
}

// ── Step 4: Tab Layout ──

function _wizardTabLayoutView() {
  var current = Settings.get('browseTabLayout') || 'island';
  function _layoutOption(layout, name, desc, previewHTML, selected) {
    var btn = new View('button').className('wizard-tab-layout-option' + (selected ? ' selected' : ''));
    btn.el.dataset.layout = layout;
    btn.el.appendChild(RawHTML('<div class="wizard-tab-layout-preview">' + previewHTML + '</div>').build());
    btn.el.appendChild(RawHTML('<span class="wizard-tab-layout-name">' + name + '</span>').build());
    btn.el.appendChild(RawHTML('<span class="wizard-tab-layout-desc">' + desc + '</span>').build());
    btn.onTap(function() { _wizardPickTabLayout(layout, btn.el); });
    return btn;
  }
  var islandPreview = '<div style="display:flex;gap:4px;align-items:center;justify-content:center;height:100%;">' +
    '<div style="width:10px;height:100%;background:var(--nr-text-secondary,#999);opacity:0.2;border-radius:3px;"></div>' +
    '<div style="flex:1;display:flex;flex-direction:column;gap:3px;padding:4px;">' +
      '<div style="height:4px;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;width:80%;"></div>' +
      '<div style="height:4px;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;width:60%;"></div>' +
      '<div style="height:4px;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;width:70%;"></div>' +
    '</div></div>';
  var horizPreview = '<div style="display:flex;flex-direction:column;height:100%;">' +
    '<div style="display:flex;gap:2px;padding:3px 4px;">' +
      '<div style="height:5px;flex:1;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;"></div>' +
      '<div style="height:5px;flex:1;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;"></div>' +
      '<div style="height:5px;flex:1;background:var(--nr-text-secondary,#999);opacity:0.3;border-radius:2px;"></div>' +
    '</div>' +
    '<div style="height:5px;background:var(--nr-text-secondary,#999);opacity:0.15;margin:0 4px;border-radius:2px;"></div>' +
    '<div style="flex:1;"></div></div>';
  var continueBtn = new View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _renderWizardStep(5, 'forward'); });
  return VStack(
    Text('Browser tab style').style('font-size', '20px').style('font-weight', '600').style('color', 'var(--nr-text-primary,#e0e0e0)').style('margin-bottom', '4px'),
    Text('How should your browser tabs look?').style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '20px'),
    HStack(
      _layoutOption('island', 'Island', 'Sidebar tabs', islandPreview, current === 'island'),
      _layoutOption('horizontal', 'Horizontal', 'Top tab bar', horizPreview, current === 'horizontal')
    ).spacing(3).className('justify-center mb-5'),
    continueBtn
  ).style('text-align', 'center');
}

function _wizardPickTabLayout(layout, el) {
  Settings.set('browseTabLayout', layout);
  var wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-tab-layout-option').forEach(function(b) { b.classList.remove('selected'); });
  }
  if (el) el.classList.add('selected');
}

// ── Step 5: Feed Selection ──

const _wizardFeedSelected = new Set();
let _wizardFeedCategory = null;

function _wizardFeedsView() {
  var continueBtn = new View('button').id('wiz-feed-continue').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _renderWizardStep(6, 'forward'); });
  return VStack(
    Text('Choose your feeds').style('font-size', '20px').style('font-weight', '600').style('color', 'var(--nr-text-primary,#e0e0e0)').style('margin-bottom', '4px'),
    Text('Pick RSS feeds to follow. You can change these later.').style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '16px'),
    new View('div').id('wiz-feed-tabs').className('flex flex-wrap gap-1.5 justify-center mb-3'),
    new View('div').id('wiz-feed-grid').style('max-height', '280px').style('overflow-y', 'auto').style('text-align', 'left').style('margin-bottom', '16px'),
    continueBtn
  ).style('text-align', 'center');
}

function _wizardFeedsInit() {
  if (_wizardFeedSelected.size === 0) {
    FEED_CATALOG.forEach(function(f) { _wizardFeedSelected.add(f.key); });
  }
  _wizardFeedRenderTabs();
  _wizardFeedRenderGrid();
}

function _wizardFeedRenderTabs() {
  var tabsContainer = document.getElementById('wiz-feed-tabs');
  if (!tabsContainer) return;
  var cats = [];
  FEED_CATALOG.forEach(function(f) { if (cats.indexOf(f.cat) === -1) cats.push(f.cat); });
  var tabs = [];
  var allTab = new View('button').className('wizard-feed-tab' + (_wizardFeedCategory === null ? ' active' : ''));
  allTab.el.textContent = 'All';
  allTab.onTap(function() { _wizardFeedSelectCategory(null); });
  tabs.push(allTab);
  cats.forEach(function(cat) {
    var tab = new View('button').className('wizard-feed-tab' + (_wizardFeedCategory === cat ? ' active' : ''));
    tab.el.textContent = cat;
    tab.onTap(function() { _wizardFeedSelectCategory(cat); });
    tabs.push(tab);
  });
  AetherUI.mount(HStack(tabs).className('flex flex-wrap gap-1.5 justify-center'), tabsContainer);
}

function _wizardFeedSelectCategory(cat) {
  _wizardFeedCategory = cat;
  _wizardFeedRenderTabs();
  _wizardFeedRenderGrid();
}

function _wizardFeedRenderGrid() {
  var grid = document.getElementById('wiz-feed-grid');
  if (!grid) return;

  var entries = _wizardFeedCategory
    ? FEED_CATALOG.filter(function(f) { return f.cat === _wizardFeedCategory; })
    : FEED_CATALOG;

  var byCategory = {};
  entries.forEach(function(f) {
    if (!byCategory[f.cat]) byCategory[f.cat] = [];
    byCategory[f.cat].push(f);
  });

  var sections = [];
  for (var cat of Object.keys(byCategory)) {
    var items = byCategory[cat];
    var allOn = items.every(function(f) { return _wizardFeedSelected.has(f.key); });

    // Category header
    var catLabel = Text(cat).style('font-size', '0.72rem').style('color', 'var(--nr-text-secondary,#999)').style('text-transform', 'uppercase').style('letter-spacing', '0.05em').style('font-weight', '500');
    var sep = new View('span').style('flex', '1').style('height', '1px').style('background', 'rgba(255,255,255,0.06)');
    var toggleAllBtn = new View('button').style('font-size', '0.68rem').style('color', 'var(--nr-text-secondary,#777)').style('background', 'none').style('border', 'none').style('cursor', 'pointer');
    toggleAllBtn.el.textContent = allOn ? 'Deselect all' : 'Select all';
    (function(c) { toggleAllBtn.onTap(function() { _wizardFeedToggleCategory(c); }); })(cat);
    var header = HStack(catLabel, sep, toggleAllBtn).spacing(2).className('items-center').style('padding', '0 4px').style('margin-bottom', '4px');

    // Feed items
    var feedRows = items.map(function(f) {
      var sel = _wizardFeedSelected.has(f.key);
      var faviconView;
      if (f.favicon) {
        faviconView = RawHTML('<img src="https://www.google.com/s2/favicons?domain=' + f.favicon + '&sz=32" style="width:20px;height:20px;border-radius:4px;" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span style="display:none;width:20px;height:20px;border-radius:4px;align-items:center;justify-content:center;font-size:0.6rem;font-weight:bold;background:' + (f.bg || '#333') + ';color:' + (f.fg || '#fff') + '">' + (f.letter || f.name[0]) + '</span>');
      } else {
        faviconView = RawHTML('<span style="display:flex;width:20px;height:20px;border-radius:4px;align-items:center;justify-content:center;font-size:0.6rem;font-weight:bold;background:' + (f.bg || '#333') + ';color:' + (f.fg || '#fff') + '">' + (f.letter || f.name[0]) + '</span>');
      }
      var nameView = Text(f.name).style('font-size', '0.82rem').style('font-weight', '500').style('color', sel ? 'var(--nr-text-primary,#e0e0e0)' : 'var(--nr-text-secondary,#999)').style('overflow', 'hidden').style('text-overflow', 'ellipsis').style('white-space', 'nowrap');
      var descView = Text(f.desc).style('font-size', '0.7rem').style('color', 'var(--nr-text-secondary,#777)').style('overflow', 'hidden').style('text-overflow', 'ellipsis').style('white-space', 'nowrap');
      var textCol = VStack(nameView, descView).style('flex', '1').style('min-width', '0');
      var checkSvg = sel ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '';
      var checkCircle = new View('div').style('width', '20px').style('height', '20px').style('border-radius', '50%').style('border', '2px solid ' + (sel ? 'var(--accent,#b4451a)' : 'rgba(255,255,255,0.15)')).style('background', sel ? 'var(--accent,#b4451a)' : 'transparent').style('display', 'flex').style('align-items', 'center').style('justify-content', 'center').style('flex-shrink', '0').style('transition', 'all 0.15s');
      if (checkSvg) checkCircle.el.appendChild(RawHTML(checkSvg).build());
      var row = HStack(faviconView, textCol, checkCircle).spacing(2.5).style('padding', '6px 10px').style('border-radius', '8px').style('cursor', 'pointer').style('transition', 'background 0.15s').style('background', sel ? 'rgba(255,255,255,0.04)' : 'transparent');
      (function(key, isSel) {
        row.el.addEventListener('click', function() { _wizardFeedToggle(key); });
        row.el.addEventListener('mouseenter', function() { this.style.background = 'rgba(255,255,255,0.06)'; });
        row.el.addEventListener('mouseleave', function() { this.style.background = isSel ? 'rgba(255,255,255,0.04)' : 'transparent'; });
      })(f.key, sel);
      return row;
    });

    sections.push(VStack([header].concat(feedRows)).style('margin-bottom', '12px'));
  }
  AetherUI.mount(VStack(sections), grid);

  var btn = document.getElementById('wiz-feed-continue');
  if (btn) btn.disabled = _wizardFeedSelected.size === 0;
}

function _wizardFeedToggle(key) {
  if (_wizardFeedSelected.has(key)) _wizardFeedSelected.delete(key);
  else _wizardFeedSelected.add(key);
  _wizardFeedRenderGrid();
}

function _wizardFeedToggleCategory(cat) {
  var items = FEED_CATALOG.filter(function(f) { return f.cat === cat; });
  var allOn = items.every(function(f) { return _wizardFeedSelected.has(f.key); });
  items.forEach(function(f) {
    if (allOn) _wizardFeedSelected.delete(f.key);
    else _wizardFeedSelected.add(f.key);
  });
  _wizardFeedRenderGrid();
}

// ── Step 6: Chat Model ──

function _wizardChatModelView() {
  var continueBtn = new View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _renderWizardStep(7, 'forward'); });
  return VStack(
    Text('Choose a model').style('font-size', '20px').style('font-weight', '600').style('color', 'var(--nr-text-primary,#e0e0e0)').style('margin-bottom', '4px'),
    Text('Pick the default Ollama model for chat and tools.').style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '20px'),
    new View('div').id('wiz-model-list').className('flex flex-col gap-1.5 mb-5').style('max-height', '200px').style('overflow-y', 'auto'),
    continueBtn
  ).style('text-align', 'center');
}

async function _wizardChatModelInit() {
  try {
    var data = await apiGet('/api/models');
    _wizardModelList = data.models || [];
  } catch (e) {
    _wizardModelList = [];
  }

  var container = document.getElementById('wiz-model-list');
  if (!container) return;

  if (!_wizardModelList.length) {
    AetherUI.mount(Text('No models found. Make sure Ollama is running.').style('font-size', '12px').style('color', 'var(--nr-text-secondary,#999)').style('padding', '16px 0'), container);
    return;
  }

  var current = Settings.get('chatModel') || 'qwen2.5:3b';
  var btns = _wizardModelList.map(function(m) {
    var btn = new View('button').className('wizard-model-option' + (m === current ? ' selected' : ''));
    btn.el.textContent = m;
    (function(model) {
      btn.onTap(function() { _wizardPickModel(model, btn.el); });
    })(m);
    return btn;
  });
  AetherUI.mount(VStack(btns).spacing(1.5), container);
}

function _wizardPickModel(model, el) {
  Settings.set('chatModel', model);
  var wizard = document.getElementById('onboarding-wizard');
  if (wizard) {
    wizard.querySelectorAll('.wizard-model-option').forEach(function(b) { b.classList.remove('selected'); });
  }
  if (el) el.classList.add('selected');
}

// ── Step 7: Pixel Pet ──

function _wizardPixelPetView() {
  var petOn = Settings.get('pixelPet') === 'on';
  var currentType = Settings.get('pixelPetType') || 'cat';
  var petBtns = _wizardPetTypes.map(function(p) {
    var sel = petOn && currentType === p.id;
    var btn = new View('button').className('wizard-pet-option' + (sel ? ' selected' : '')).style('display', 'flex').style('flex-direction', 'column').style('align-items', 'center').style('gap', '6px').style('padding', '10px 12px');
    btn.el.dataset.pet = p.id;
    btn.el.appendChild(RawHTML('<canvas class="wiz-pet-sprite" data-pet-id="' + p.id + '" width="48" height="48" style="image-rendering:pixelated;width:48px;height:48px;"></canvas>').build());
    btn.el.appendChild(Text(p.name).style('font-size', '11px').build());
    (function(petId) {
      btn.onTap(function() { _wizardPickPet(petId, btn.el); });
    })(p.id);
    return btn;
  });
  // "None" option
  var noneBtn = new View('button').className('wizard-pet-option' + (!petOn ? ' selected' : '')).style('display', 'flex').style('flex-direction', 'column').style('align-items', 'center').style('gap', '6px').style('padding', '10px 12px');
  noneBtn.el.dataset.pet = 'none';
  noneBtn.el.appendChild(RawHTML('<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--nr-text-secondary,#999)" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>').build());
  noneBtn.el.appendChild(Text('None').style('font-size', '11px').build());
  noneBtn.onTap(function() { _wizardPickPet('none', noneBtn.el); });
  petBtns.push(noneBtn);

  var continueBtn = new View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  continueBtn.el.textContent = 'Continue';
  continueBtn.onTap(function() { _renderWizardStep(8, 'forward'); });
  return VStack(
    Text('Pick a companion').style('font-size', '20px').style('font-weight', '600').style('color', 'var(--nr-text-primary,#e0e0e0)').style('margin-bottom', '4px'),
    Text('A pixel pet that lives on your screen. Or go solo.').style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '20px'),
    HStack(petBtns).className('flex flex-wrap justify-center gap-2.5 mb-5'),
    continueBtn
  ).style('text-align', 'center');
}

function _wizardPixelPetInit() {
  var sprites = _wizardPetSprites();
  var G = 16, S = 48 / G;
  document.querySelectorAll('.wiz-pet-sprite').forEach(function(canvas) {
    var id = canvas.dataset.petId;
    var draw = sprites[id];
    if (!draw) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 48, 48);
    function px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(x * S, y * S, S, S); }
    draw(px, { sitting: true, blink: false, legFrame: 0 });
  });
}

function _wizardPickPet(petId, el) {
  var wizard = document.getElementById('onboarding-wizard');
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

// ── Step 8: Neuralook (optional) ──

function _wizardNeuralookView() {
  var calibrateBtn = new View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  calibrateBtn.el.textContent = 'Calibrate now';
  calibrateBtn.onTap(function() { _wizardStartNeuralook(); });
  var skipBtn = new View('button').className('nr-btn nr-btn-ghost');
  skipBtn.el.textContent = 'Set up later';
  skipBtn.onTap(function() { _renderWizardStep(9, 'forward'); });
  return VStack(
    Text('Eye tracking').style('font-size', '20px').style('font-weight', '600').style('color', 'var(--nr-text-primary,#e0e0e0)').style('margin-bottom', '4px'),
    Text('Neuralook uses your camera for gaze-based navigation. A quick calibration is needed.').style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '20px'),
    RawHTML('<div style="margin-bottom:24px;"><svg style="width:48px;height:48px;display:inline-block;" viewBox="0 0 24 24" fill="none" stroke="var(--nr-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>'),
    calibrateBtn,
    skipBtn
  ).style('text-align', 'center');
}

async function _wizardStartNeuralook() {
  await _wizardCommitAccount();
  if (_wizardFeedSelected.size > 0) {
    var sources = {};
    var notifSources = {};
    FEED_CATALOG.forEach(function(f) {
      sources[f.key] = _wizardFeedSelected.has(f.key);
      notifSources[f.key] = false;
    });
    Settings.setJSON('feedSources', sources);
    Settings.setJSON('feedNotifSources', notifSources);
  }
  window.location.href = '/#neuralook';
}

// ── Step 9: Finale ──

function _wizardFinaleView() {
  var username = _wizardPendingUsername || (_authUserInfo && _authUserInfo.username) || 'you';
  var enterBtn = new View('button').className('nr-btn nr-btn-primary nr-btn-lg');
  enterBtn.el.textContent = 'Enter the Net';
  enterBtn.onTap(function() { _wizardFinish(); });
  return VStack(
    RawHTML('<div class="wizard-finale-check"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>'),
    Text("You're all set, @" + username).style('font-size', '22px').style('font-weight', '600').style('color', 'var(--nr-text-primary,#e0e0e0)').style('margin-bottom', '6px'),
    Text('Neural link established. Jack in.').style('font-size', '13px').style('color', 'var(--nr-text-secondary,#999)').style('margin-bottom', '24px'),
    enterBtn
  ).style('text-align', 'center');
}

async function _wizardFinish() {
  await _wizardCommitAccount();
  if (_wizardFeedSelected.size > 0) {
    var sources = {};
    var notifSources = {};
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
  window.location.href = '/';
}

// Auto-start wizard on page load
document.addEventListener('DOMContentLoaded', function() {
  openOnboarding();
});
