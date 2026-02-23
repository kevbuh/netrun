import Settings from '../core/core-settings.js';
import { icon } from '/js/core/icons.js';
import { applySidebarVisibility, getSidebarOrder, applySidebarOrder } from '/js/core/core-sidebar.js';
import { getLS, setLS } from '/js/core/core-auth.js';
import { getSelectedSpinner } from '/js/core/core-layout.js';
import { CLICK_SOUND_PRESETS, setClickSoundType, toggleClickSound } from '/js/core/core-sounds.js';
import { _settingBtnGroup, _settingCard, _settingGroupContent, _settingRow, _settingToggle } from '/js/settings/settings-helpers.js';
import { cycleSpinner, setAccentColor, setAetherColor, _accentColorState } from '/js/settings/settings-colors.js';
import { renderSettingsView } from '/js/settings/settings-core.js';
import { setEditorTheme, setIconSize, setTheme } from '/js/settings/settings-theme.js';
import { setPixelPetType, togglePixelPet } from '/js/pixel-pet.js';

// ─── Appearance Settings ──────────────────────────────────────

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
  const currentTheme = Settings.get('theme') || 'light';
  const accentColors = [
    { color: '#b4451a', name: 'Orange' }, { color: '#e53e3e', name: 'Red' },
    { color: '#d69e2e', name: 'Gold' }, { color: '#38a169', name: 'Green' },
    { color: '#3182ce', name: 'Blue' }, { color: '#805ad5', name: 'Purple' },
    { color: '#d53f8c', name: 'Pink' }, { color: '#718096', name: 'Gray' },
    { color: '#111111', name: 'Black' },
  ];

  // Accent color swatches — ring state is driven reactively by _accentColorState
  const accentSwatches = accentColors.map(function(a) {
    const swatch = new window.View('button');
    swatch.styles({ background: a.color });
    swatch.el.title = a.name;
    swatch.onTap(function() { setAccentColor(a.color); });
    Effect(function() {
      const active = _accentColorState.value === a.color;
      swatch.el.className = 'w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110' +
        (active ? ' scale-110 ring-2 ring-offset-2' : '');
      if (active) {
        swatch.el.style.setProperty('--tw-ring-color', a.color);
        swatch.el.style.setProperty('--tw-ring-offset-color', 'var(--nr-bg-body)');
      } else {
        swatch.el.style.removeProperty('--tw-ring-color');
        swatch.el.style.removeProperty('--tw-ring-offset-color');
      }
    });
    return swatch;
  });

  const aetherRaw = Settings.get('aetherColor') || 'midnight';
  const aetherCur = aetherRaw.startsWith('#') ? 'midnight' : aetherRaw;

  // Spinner controls
  const prevBtn = new window.View('button')
    .add(window.RawHTML('&lsaquo;'))
    .className('w-6 h-6 rounded flex items-center justify-center bg-transparent border border-border-input text-dimmer cursor-pointer hover:text-primary text-[0.75rem]')
    .onTap(function() { cycleSpinner(-1); });
  const nextBtn = new window.View('button')
    .add(window.RawHTML('&rsaquo;'))
    .className('w-6 h-6 rounded flex items-center justify-center bg-transparent border border-border-input text-dimmer cursor-pointer hover:text-primary text-[0.75rem]')
    .onTap(function() { cycleSpinner(1); });
  const spinnerCenter = window.VStack(
    window.RawHTML('<div class="spinner-preview text-dim font-mono text-[1.2rem] h-6 flex items-center justify-center" id="spinner-preview"></div>'),
    window.RawHTML('<div class="text-[0.68rem] text-dimmer" id="spinner-name">' + getSelectedSpinner() + '</div>')
  ).className('flex flex-col items-center min-w-[100px]');
  // Pixel pet
  const petOn = Settings.get('pixelPet') === 'on';
  const curPetType = Settings.get('pixelPetType') || 'cat';
  const petOpts = [['cat','cat'],['blackCat','black cat'],['dog','dog'],['poodle','poodle'],['bunny','bunny'],['froog','froog'],['pacman','pacman']];
  const petBtns = petOpts.map(function(pair) {
    const t = pair[0], label = pair[1];
    const sel = petOn && curPetType === t;
    const b = new window.View('button');
    b.text(label);
    b.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
      (sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
    b.onTap(function() { togglePixelPet(true); setPixelPetType(t); renderSettingsView(); });
    return b;
  });
  const petNone = new window.View('button');
  petNone.text('none');
  petNone.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
    (!petOn ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
  petNone.onTap(function() { togglePixelPet(false); renderSettingsView(); });
  petBtns.push(petNone);
  // Button sounds
  const soundBtns = Object.entries(CLICK_SOUND_PRESETS).map(function(pair) {
    const key = pair[0], p = pair[1];
    const sel = (Settings.get('clickSound') === 'on') && (Settings.get('clickSoundType') || 'thud') === key;
    const b = new window.View('button');
    b.text(p.label);
    b.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
      (sel ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
    b.onTap(function() { toggleClickSound(true); setClickSoundType(key); renderSettingsView(); });
    return b;
  });
  const soundNone = new window.View('button');
  soundNone.text('none');
  soundNone.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
    (!(Settings.get('clickSound') === 'on') ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
  soundNone.onTap(function() { toggleClickSound(false); renderSettingsView(); });
  soundBtns.push(soundNone);
  // TTS
  const ttsHighlight = _settingToggle('Read Aloud Highlight', 'Highlight text in the page as it\'s being read aloud',
    Settings.get('ttsHighlight') !== 'false', function(on) { Settings.set('ttsHighlight', on); });

  const ttsSpeed = parseFloat(Settings.get('ttsSpeed')) || 1;
  const speedOpts = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const speedSel = new window.View('select');
  speedSel.className('px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary outline-none focus:border-accent cursor-pointer');
  speedSel.el.innerHTML = speedOpts.map(function(v) {
    return '<option value="' + v + '"' + (v === ttsSpeed ? ' selected' : '') + '>' + v + 'x</option>';
  }).join('');
  speedSel.el.addEventListener('change', function() {
    const v = parseFloat(this.value);
    Settings.set('ttsSpeed', v);
    if (typeof window._ttsAudio !== 'undefined' && window._ttsAudio) window._ttsAudio.playbackRate = v;
  });
  const ttsSpeedRow = _settingRow('Read Aloud Speed', null, speedSel);

  // Sidebar icons
  const resetBtn = new window.View('button');
  resetBtn.text('Reset');
  resetBtn.className('text-[0.72rem] text-dimmer hover:text-primary cursor-pointer');
  resetBtn.styles({ background: 'none', border: 'none' });
  resetBtn.onTap(function() { resetSidebarIcons(); });

  const labels = { 'sb-dashboard': 'Home', 'sb-home': 'Feed', 'sb-browse': 'Browse', 'sb-neuralook': 'Neuralook', 'sb-dev': 'Dev Stats', 'sb-settings': 'Settings' };
  const order = getSidebarOrder();
  const hidden = getLS('hiddenSidebarIcons', []);
  const iconRows = order.map(function(id) {
    const label = labels[id] || id;
    const isVisible = !hidden.includes(id);
    const toggle = window.Toggle(null);
    const input = toggle.el.querySelector('input[type="checkbox"]');
    if (input) input.checked = isVisible;
    toggle.on('change', function(e) { if (e.target.type === 'checkbox') toggleSidebarIcon(id, e.target.checked); });
    const row = window.HStack(
      window.RawHTML('<span class="sb-drag-handle text-dimmest cursor-grab" style="touch-action:none">' + icon('dragHandle', { size: 14, class: 'w-3.5 h-3.5' }) + '</span>'),
      window.Text(label).className('text-primary text-sm'),
      window.Spacer(),
      toggle
    ).spacing(2).className('sb-icon-row flex items-center justify-between py-2');
    row.attr('data-id', id);
    row.styles({ touchAction: 'none' });
    return row;
  });
  const iconList = VStack(iconRows);
  iconList.el.id = 'sb-icon-list';
  iconList.el.addEventListener('pointerdown', function(e) { _sbDragDown(e); });
  iconList.el.addEventListener('pointermove', function(e) { _sbDragMove(e); });
  iconList.el.addEventListener('pointerup', function(e) { _sbDragEnd(e); });
  iconList.el.addEventListener('pointercancel', function(e) { _sbDragEnd(e); });

  const menuSection = window.VStack(
    window.HStack(
      window.Text('Menu Icons').className('text-white_ text-sm font-semibold'),
      window.Spacer(), resetBtn
    ).className('mb-3'),
    iconList
  ).className('mb-8');

  // Accent color row
  const accentRow = _settingRow('Accent Color', null, HStack(accentSwatches).spacing(2));

  // Spinner row in group-row format
  const spinnerGroupRow = _settingRow('Loading Spinner', null, window.HStack(prevBtn, spinnerCenter, nextBtn).spacing(2));

  // Pet row in group-row format
  const petGroupRow = _settingRow('Pixel Pet', null, HStack(petBtns).spacing(0.5));

  // Sound row in group-row format
  const soundGroupRow = _settingRow('Button Sounds', null, HStack(soundBtns).spacing(0.5));

  return window.VStack(
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
      soundGroupRow,
    ]),
    _settingCard('Read Aloud', [
      ttsHighlight,
      ttsSpeedRow,
    ]),
    menuSection
  );
}

