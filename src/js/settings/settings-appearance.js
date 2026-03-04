import Settings from '../core/core-settings.js';
import { getSelectedSpinner } from '/js/core/core-layout.js';
import { CLICK_SOUND_PRESETS, setClickSoundType, toggleClickSound } from '/js/core/core-sounds.js';
import { _settingBtnGroup, _settingCard, _settingGroupContent, _settingRow, _settingToggle } from '/js/settings/settings-helpers.js';
import { cycleSpinner, setAccentColor, setAetherColor, _accentColorState } from '/js/settings/settings-colors.js';
import { renderSettingsView } from '/js/settings/settings-core.js';
import { setTheme } from '/js/settings/settings-theme.js';
import { setPixelPetType, togglePixelPet } from '/js/pixel-pet.js';

// ─── Appearance Settings ──────────────────────────────────────

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
      _settingBtnGroup('Theme', ['auto','dark','light','clear'], currentTheme, function(v) { setTheme(v); }),
      _settingBtnGroup('Aether', [{value:'midnight',label:'Midnight'},{value:'aether',label:'Aether'},{value:'match',label:'Match'}], aetherCur, function(v) { setAetherColor(v); }),
      accentRow,
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
    _settingCard('Captions', [
      _settingToggle('Show overlay on page', 'Display captions as a floating bar at the bottom of the page in addition to the island pill',
        Settings.get('ccDisplay') === 'overlay', function(on) { Settings.set('ccDisplay', on ? 'overlay' : 'pill'); }),
    ]),
  );
}

