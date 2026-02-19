import Settings from '../core/core-settings.js';

// ─── Appearance Settings ──────────────────────────────────────
if (window.AetherUI) AetherUI.globals();

export function toggleSidebarIcon(id, visible) {
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

export function resetSidebarIcons() {
  Settings.remove('sidebarOrder');
  Settings.remove('hiddenSidebarIcons');
  applySidebarOrder();
  applySidebarVisibility();
  renderSettingsView();
}

// ─── Sidebar Icon Drag (uses setPointerCapture) ─────────────

export let _sbDragEl = null, _sbDragGhost = null, _sbDragStartY = 0, _sbDragStarted = false;

export function _sbDragDown(e) {
  const handle = e.target.closest('.sb-drag-handle');
  if (!handle) return;
  const row = handle.closest('.sb-icon-row');
  if (!row) return;
  _sbDragEl = row;
  _sbDragStartY = e.clientY;
  _sbDragStarted = false;
  row.setPointerCapture(e.pointerId);
  e.preventDefault();
}

export function _sbDragMove(e) {
  if (!_sbDragEl) return;
  if (!_sbDragStarted && Math.abs(e.clientY - _sbDragStartY) < 4) return;
  const list = document.getElementById('sb-icon-list');
  if (!list) return;
  if (!_sbDragStarted) {
    _sbDragStarted = true;
    _sbDragEl.style.opacity = '0.3';
    _sbDragGhost = _sbDragEl.cloneNode(true);
    _sbDragGhost.style.cssText = 'position:fixed;pointer-events:none;z-index:999;opacity:0.9;background:var(--nr-bg-raised);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.4);width:' + _sbDragEl.offsetWidth + 'px;left:' + _sbDragEl.getBoundingClientRect().left + 'px';
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

export function _sbDragEnd() {
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

export function _renderAppearanceSettings() {
  var currentTheme = Settings.get('theme') || 'light';
  var currentAccent = Settings.get('accentColor') || '#b4451a';
  var accentColors = [
    { color: '#b4451a', name: 'Orange' }, { color: '#e53e3e', name: 'Red' },
    { color: '#d69e2e', name: 'Gold' }, { color: '#38a169', name: 'Green' },
    { color: '#3182ce', name: 'Blue' }, { color: '#805ad5', name: 'Purple' },
    { color: '#d53f8c', name: 'Pink' }, { color: '#718096', name: 'Gray' },
    { color: '#111111', name: 'Black' },
  ];

  // Accent color swatches
  var accentSwatches = accentColors.map(function(a) {
    var swatch = new View('button');
    swatch.className('w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110' +
      (currentAccent === a.color ? ' scale-110 ring-2 ring-offset-2' : ''));
    swatch.styles({ background: a.color });
    if (currentAccent === a.color) {
      swatch.el.style.setProperty('--tw-ring-color', a.color);
      swatch.el.style.setProperty('--tw-ring-offset-color', 'var(--nr-bg-body)');
    }
    swatch.el.title = a.name;
    swatch.onTap(function() { setAccentColor(a.color); });
    return swatch;
  });

  var aetherRaw = Settings.get('aetherColor') || 'midnight';
  var aetherCur = aetherRaw.startsWith('#') ? 'midnight' : aetherRaw;

  // Spinner controls
  var prevBtn = new View('button');
  prevBtn.el.innerHTML = '&lsaquo;';
  prevBtn.className('w-6 h-6 rounded flex items-center justify-center bg-transparent border border-border-input text-dimmer cursor-pointer hover:text-primary text-[0.75rem]');
  prevBtn.onTap(function() { cycleSpinner(-1); });
  var nextBtn = new View('button');
  nextBtn.el.innerHTML = '&rsaquo;';
  nextBtn.className('w-6 h-6 rounded flex items-center justify-center bg-transparent border border-border-input text-dimmer cursor-pointer hover:text-primary text-[0.75rem]');
  nextBtn.onTap(function() { cycleSpinner(1); });
  var spinnerCenter = VStack(
    RawHTML('<div class="spinner-preview text-dim font-mono text-[1.2rem] h-6 flex items-center justify-center" id="spinner-preview"></div>'),
    RawHTML('<div class="text-[0.68rem] text-dimmer" id="spinner-name">' + getSelectedSpinner() + '</div>')
  ).className('flex flex-col items-center min-w-[100px]');
  // Pixel pet
  var petOn = Settings.get('pixelPet') === 'on';
  var curPetType = Settings.get('pixelPetType') || 'cat';
  var petOpts = [['cat','cat'],['blackCat','black cat'],['dog','dog'],['poodle','poodle'],['bunny','bunny'],['froog','froog'],['pacman','pacman']];
  var petBtns = petOpts.map(function(pair) {
    var t = pair[0], label = pair[1];
    var sel = petOn && curPetType === t;
    var b = new View('button');
    b.el.textContent = label;
    b.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
      (sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
    b.onTap(function() { togglePixelPet(true); setPixelPetType(t); renderSettingsView(); });
    return b;
  });
  var petNone = new View('button');
  petNone.el.textContent = 'none';
  petNone.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
    (!petOn ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
  petNone.onTap(function() { togglePixelPet(false); renderSettingsView(); });
  petBtns.push(petNone);
  // White noise
  var noiseBtns = Object.entries(NOISE_PRESETS).map(function(pair) {
    var key = pair[0], p = pair[1];
    var sel = _rainNoiseType === key;
    var b = new View('button');
    b.el.textContent = p.label;
    b.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
      (sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
    b.onTap(function() { setRainNoiseType(key); renderSettingsView(); });
    return b;
  });
  var noiseWrap = HStack.apply(null, noiseBtns).className('flex flex-wrap gap-1 mt-2');

  var volSlider = new View('input');
  volSlider.el.type = 'range'; volSlider.el.min = '0'; volSlider.el.max = '100';
  volSlider.el.value = Math.round(_rainVolume * 100);
  volSlider.className('flex-1 h-1 accent-accent');
  var volLabel = Text(Math.round(_rainVolume * 100) + '%').className('text-[0.7rem] text-dimmer font-mono w-10 text-right');
  volLabel.el.id = 'rain-volume-value';
  volSlider.el.addEventListener('input', function() { setRainVolume(this.value / 100); volLabel.el.textContent = this.value + '%'; });
  var volRow = HStack(Text('Volume').className('text-[0.7rem] text-dimmer whitespace-nowrap'), volSlider, volLabel).spacing(2).className('mt-2');

  var freqSlider = new View('input');
  freqSlider.el.type = 'range'; freqSlider.el.min = '20'; freqSlider.el.max = '5000'; freqSlider.el.step = '10';
  freqSlider.el.value = _rainFreq || 1000;
  freqSlider.className('flex-1 h-1 accent-accent');
  freqSlider.el.id = 'rain-freq-slider';
  if (_rainFreq === 0) { freqSlider.el.disabled = true; freqSlider.styles({ opacity: '0.3' }); }
  var freqLabel = Text(_rainFreq > 0 ? _rainFreq + ' Hz' : 'Auto').className('text-[0.7rem] text-dimmer font-mono w-14 text-right');
  freqLabel.el.id = 'rain-freq-label';
  freqSlider.el.addEventListener('input', function() { setRainFreq(this.value); freqLabel.el.textContent = this.value + ' Hz'; });
  var freqAutoBtn = new View('button');
  freqAutoBtn.el.textContent = 'Auto';
  freqAutoBtn.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
    (_rainFreq === 0 ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
  freqAutoBtn.onTap(function() {
    if (_rainFreq === 0) { setRainFreq(1000); freqSlider.el.disabled = false; freqSlider.el.style.opacity = '1'; freqSlider.el.value = 1000; freqLabel.el.textContent = '1000 Hz'; }
    else { setRainFreq(0); freqSlider.el.disabled = true; freqSlider.el.style.opacity = '0.3'; freqLabel.el.textContent = 'Auto'; }
  });
  var freqRow = HStack(Text('Tone').className('text-[0.7rem] text-dimmer whitespace-nowrap'), freqSlider, freqLabel, freqAutoBtn).spacing(2).className('mt-2');

  var noiseSection = VStack(
    Text('White Noise').className('text-primary text-sm'),
    noiseWrap, volRow, freqRow
  ).className('mt-4');

  // Button sounds
  var soundBtns = Object.entries(CLICK_SOUND_PRESETS).map(function(pair) {
    var key = pair[0], p = pair[1];
    var sel = _clickSoundOn && (Settings.get('clickSoundType') || 'thud') === key;
    var b = new View('button');
    b.el.textContent = p.label;
    b.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
      (sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
    b.onTap(function() { toggleClickSound(true); setClickSoundType(key); renderSettingsView(); });
    return b;
  });
  var soundNone = new View('button');
  soundNone.el.textContent = 'none';
  soundNone.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
    (!_clickSoundOn ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
  soundNone.onTap(function() { toggleClickSound(false); renderSettingsView(); });
  soundBtns.push(soundNone);
  // TTS
  var ttsHighlight = _settingToggle('Read Aloud Highlight', 'Highlight text in the page as it\'s being read aloud',
    Settings.get('ttsHighlight') !== 'false', function(on) { Settings.set('ttsHighlight', on); });

  var ttsSpeed = parseFloat(Settings.get('ttsSpeed')) || 1;
  var speedOpts = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  var speedSel = new View('select');
  speedSel.className('px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary outline-none focus:border-accent cursor-pointer');
  speedSel.el.innerHTML = speedOpts.map(function(v) {
    return '<option value="' + v + '"' + (v === ttsSpeed ? ' selected' : '') + '>' + v + 'x</option>';
  }).join('');
  speedSel.el.addEventListener('change', function() {
    var v = parseFloat(this.value);
    Settings.set('ttsSpeed', v);
    if (typeof _ttsAudio !== 'undefined' && _ttsAudio) _ttsAudio.playbackRate = v;
  });
  var ttsSpeedRow = _settingRow('Read Aloud Speed', null, speedSel);

  // Sidebar icons
  var resetBtn = new View('button');
  resetBtn.el.textContent = 'Reset';
  resetBtn.className('text-[0.72rem] text-dimmer hover:text-primary cursor-pointer');
  resetBtn.styles({ background: 'none', border: 'none' });
  resetBtn.onTap(function() { resetSidebarIcons(); });

  var labels = { 'sb-dashboard': 'Home', 'sb-home': 'Feed', 'sb-browse': 'Browse', 'sb-neuralook': 'Neuralook', 'sb-dev': 'Dev Stats', 'sb-settings': 'Settings' };
  var order = getSidebarOrder();
  var hidden = getLS('hiddenSidebarIcons', []);
  var iconRows = order.map(function(id) {
    var label = labels[id] || id;
    var isVisible = !hidden.includes(id);
    var toggle = Toggle(null);
    var input = toggle.el.querySelector('input[type="checkbox"]');
    if (input) input.checked = isVisible;
    toggle.on('change', function(e) { if (e.target.type === 'checkbox') toggleSidebarIcon(id, e.target.checked); });
    var row = HStack(
      RawHTML('<span class="sb-drag-handle text-dimmest cursor-grab" style="touch-action:none">' + icon('dragHandle', { size: 14, class: 'w-3.5 h-3.5' }) + '</span>'),
      Text(label).className('text-primary text-sm'),
      Spacer(),
      toggle
    ).spacing(2).className('sb-icon-row flex items-center justify-between py-2');
    row.attr('data-id', id);
    row.styles({ touchAction: 'none' });
    return row;
  });
  var iconList = VStack.apply(null, iconRows);
  iconList.el.id = 'sb-icon-list';
  iconList.el.addEventListener('pointerdown', function(e) { _sbDragDown(e); });
  iconList.el.addEventListener('pointermove', function(e) { _sbDragMove(e); });
  iconList.el.addEventListener('pointerup', function(e) { _sbDragEnd(e); });
  iconList.el.addEventListener('pointercancel', function(e) { _sbDragEnd(e); });

  var menuSection = VStack(
    HStack(
      Text('Menu Icons').className('text-white_ text-sm font-semibold'),
      Spacer(), resetBtn
    ).className('mb-3'),
    iconList
  ).className('mb-8');

  // Accent color row
  var accentRow = _settingRow('Accent Color', null, HStack.apply(null, accentSwatches).spacing(2));

  // Spinner row in group-row format
  var spinnerGroupRow = _settingRow('Loading Spinner', null, HStack(prevBtn, spinnerCenter, nextBtn).spacing(2));

  // Pet row in group-row format
  var petGroupRow = _settingRow('Pixel Pet', null, HStack.apply(null, petBtns).spacing(0.5));

  // Noise as freeform content
  var noiseContent = _settingGroupContent([noiseSection]);

  // Sound row in group-row format
  var soundGroupRow = _settingRow('Button Sounds', null, HStack.apply(null, soundBtns).spacing(0.5));

  return VStack(
    _settingCard('Visual', [
      _settingBtnGroup('Theme', ['auto','dark','light','daylight','clear'], currentTheme, function(v) { setTheme(v); }),
      _settingBtnGroup('Aether', [{value:'midnight',label:'Midnight'},{value:'aether',label:'Aether'},{value:'match',label:'Match'}], aetherCur, function(v) { setAetherColor(v); }),
      accentRow,
      _settingBtnGroup('Editor Theme', ['auto','monokai','dracula','solarized','github','nord'], Settings.get('editorTheme') || 'auto', function(v) { setEditorTheme(v); }),
      _settingBtnGroup('Icon Size', ['small','medium','large'], Settings.get('iconSize') || 'medium', function(v) { setIconSize(v); }),
      petGroupRow,
    ]),
    _settingCard('Layout', [
      spinnerGroupRow,
      _settingToggle('Custom Cursor', 'Smooth cursor with context-aware styling and inertia.',
        Settings.get('customCursor') !== 'off', function(on) {
          Settings.set('customCursor', on ? 'on' : 'off');
          if (window.AetherCursor) window.AetherCursor[on ? 'enable' : 'disable']();
        }),
    ]),
    _settingCard('Ambient', [
      noiseContent,
      soundGroupRow,
    ]),
    _settingCard('Read Aloud', [
      ttsHighlight,
      ttsSpeedRow,
    ]),
    menuSection
  );
}

window.toggleSidebarIcon = toggleSidebarIcon;
window.resetSidebarIcons = resetSidebarIcons;
window._sbDragEl = _sbDragEl;
window._sbDragGhost = _sbDragGhost;
window._sbDragStartY = _sbDragStartY;
window._sbDragStarted = _sbDragStarted;
window._sbDragDown = _sbDragDown;
window._sbDragMove = _sbDragMove;
window._sbDragEnd = _sbDragEnd;
window._renderAppearanceSettings = _renderAppearanceSettings;
