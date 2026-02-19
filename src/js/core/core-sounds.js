// core-sounds.js — Click sounds, rain
// Extracted from core.js

import Settings from '/js/core/core-settings.js';

// ── Button click sound (Web Audio API) ──
let _clickSoundCtx = null;
let _clickSoundOn = Settings.get('clickSound') === 'on';

const CLICK_SOUND_PRESETS = {
  tap: { label: 'Tap', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sine'; o.frequency.setValueAtTime(400, t); o.frequency.exponentialRampToValueAtTime(250, t + 0.04);
    f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08);
  }},
  pop: { label: 'Pop', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(800, t); o.frequency.exponentialRampToValueAtTime(400, t + 0.05);
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.09);
  }},
  click: { label: 'Click', play(ctx, t) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.003));
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 1;
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t);
  }},
  bubble: { label: 'Bubble', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.06);
    g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1);
  }},
  key: { label: 'Key', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.setValueAtTime(1000, t); o.frequency.exponentialRampToValueAtTime(500, t + 0.02);
    f.type = 'lowpass'; f.frequency.value = 800; f.Q.value = 0.3;
    g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.06);
  }},
  thud: { label: 'Thud', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    f.type = 'lowpass'; f.frequency.value = 200; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1);
  }},
};

function toggleClickSound(on) {
  _clickSoundOn = on;
  Settings.set('clickSound', on ? 'on' : 'off');
  if (on) playClickSound();
}

function setClickSoundType(type) {
  Settings.set('clickSoundType', type);
  // Play a preview
  const wasOn = _clickSoundOn;
  _clickSoundOn = true;
  playClickSound();
  _clickSoundOn = wasOn;
}

function playClickSound() {
  if (!_clickSoundOn) return;
  try {
    if (!_clickSoundCtx) _clickSoundCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _clickSoundCtx;
    const t = ctx.currentTime;

    const type = Settings.get('clickSoundType') || 'thud';
    const preset = CLICK_SOUND_PRESETS[type] || CLICK_SOUND_PRESETS.tap;
    preset.play(ctx, t);
  } catch (e) { /* fire-and-forget */ }
}

// Global click listener for interactive elements
document.addEventListener('click', function(e) {
  if (!_clickSoundOn) return;
  const el = e.target.closest('button, a, .sidebar-icon, [onclick], input[type="checkbox"], input[type="radio"], .nr-switch');
  if (el) playClickSound();
}, { passive: true });

// ── Ambient rain sounds (Web Audio API) ──

let _rainCtx = null;
let _rainAudio = null;
let _rainNodes = [];
let _rainOn = false;
let _rainVolume = parseFloat(Settings.get('rainVolume') || '0.3');
let _rainNoiseType = Settings.get('rainNoiseType') || 'rain';
let _rainFreq = parseInt(Settings.get('rainFreq') || '0');

// Noise type presets: each defines layers for _makeNoise
const NOISE_PRESETS = {
  rain:    { label: 'Rain',    layers: [['brown', 0.7], ['pink', 0.3]], thunder: true },
  storm:   { label: 'Storm',   layers: [['brown', 0.8], ['pink', 0.2]], thunder: true, thunderFreq: 0.4 },
  brown:   { label: 'Brown',   layers: [['brown', 1.0]], thunder: false },
  pink:    { label: 'Pink',    layers: [['pink', 1.0]], thunder: false },
  white:   { label: 'White',   layers: [['white', 1.0]], thunder: false },
  ocean:   { label: 'Ocean',   audio: 'audio/ocean.mp3' },
  stream:  { label: 'Stream',  audio: 'audio/stream.mp3' },
  fire:    { label: 'Fire',    audio: 'audio/fire.mp3' },
};

function toggleRain() {
  _rainOn ? stopRain() : startRain();
}

function startRain() {
  if (_rainOn) return;
  _rainOn = true;
  Settings.set('rainOn', '1');
  if (typeof _renderAudioPill === 'function') _renderAudioPill();

  const preset = NOISE_PRESETS[_rainNoiseType] || NOISE_PRESETS.rain;

  if (preset.audio) {
    // Sample-based preset: loop an audio file
    const a = new Audio(preset.audio);
    a.loop = true;
    a.volume = _rainVolume;
    a.addEventListener('canplaythrough', function() { a.play(); }, { once: true });
    a.load();
    _rainAudio = a;
    return;
  }

  _rainCtx = new (window.AudioContext || window.webkitAudioContext)();
  const master = _rainCtx.createGain();
  master.gain.value = _rainVolume;
  master.connect(_rainCtx.destination);
  _rainNodes.push(master);

  preset.layers.forEach(([type, amp]) => _makeNoise(_rainCtx, master, type, amp));
  if (preset.thunder) _rainThunderLoop(_rainCtx, master, preset.thunderFreq || 1);
}

function stopRain() {
  if (!_rainOn) return;
  _rainOn = false;
  Settings.remove('rainOn');
  if (_rainAudio) {
    _rainAudio.pause();
    _rainAudio = null;
  }
  if (_rainCtx) {
    _rainCtx.close();
    _rainCtx = null;
  }
  _rainNodes = [];
  if (typeof _renderAudioPill === 'function') _renderAudioPill();
}

function setRainNoiseType(type) {
  _rainNoiseType = type;
  Settings.set('rainNoiseType', type);
  if (_rainOn) { stopRain(); startRain(); }
  else if (typeof _renderAudioPill === 'function') _renderAudioPill();
}

function setRainFreq(hz) {
  _rainFreq = Math.max(0, Math.min(5000, parseInt(hz) || 0));
  Settings.set('rainFreq', _rainFreq.toString());
  const label = document.getElementById('rain-freq-label');
  if (label) label.textContent = _rainFreq > 0 ? _rainFreq + ' Hz' : 'Auto';
  if (_rainOn) { stopRain(); startRain(); }
}

function setRainVolume(v) {
  _rainVolume = Math.max(0, Math.min(1, v));
  Settings.set('rainVolume', _rainVolume.toString());
  if (_rainAudio) {
    _rainAudio.volume = _rainVolume;
  }
  if (_rainNodes.length && _rainNodes[0]) {
    _rainNodes[0].gain.value = _rainVolume;
  }
  // Update settings percentage if visible
  const sliderVal = document.getElementById('rain-volume-value');
  if (sliderVal) sliderVal.textContent = Math.round(_rainVolume * 100) + '%';
}

function _makeNoise(ctx, dest, type, amp) {
  const bufSize = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(2, bufSize, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufSize; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'brown') {
        b0 = (b0 + (0.02 * white)) / 1.02;
        data[i] = b0 * 3.5 * amp;
      } else if (type === 'white') {
        data[i] = white * 0.3 * amp;
      } else {
        // pink noise (Paul Kellet's algorithm)
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11 * amp;
        b6 = white * 0.115926;
      }
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  // Default filter frequencies per type
  const defaultLp = type === 'brown' ? 400 : type === 'white' ? 4000 : 2500;
  const defaultHp = type === 'brown' ? 40 : type === 'white' ? 100 : 200;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = _rainFreq > 0 ? _rainFreq : defaultLp;
  lp.Q.value = 0.5;

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = defaultHp;
  hp.Q.value = 0.5;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(dest);
  src.start();
  _rainNodes.push(src);
}

function _rainThunderLoop(ctx, dest, freqMul) {
  if (!_rainOn) return;
  const baseDelay = freqMul > 1 ? 5000 : 15000;
  const randDelay = freqMul > 1 ? 15000 : 45000;
  const delay = baseDelay + Math.random() * randDelay;
  setTimeout(function() {
    if (!_rainOn || !_rainCtx) return;
    // Low rumble
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 40 + Math.random() * 30;
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.08 * _rainVolume, ctx.currentTime + 0.5);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2 + Math.random() * 2);
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    osc.stop(ctx.currentTime + 4);
    _rainThunderLoop(ctx, dest, freqMul);
  }, delay);
}

// Restore rain on page load
if (Settings.get('rainOn') === '1') {
  document.addEventListener('click', function _resumeRain() {
    document.removeEventListener('click', _resumeRain);
    startRain();
  }, { once: true });
}

// Backward compat window assignments
window.toggleClickSound = toggleClickSound;
window.setClickSoundType = setClickSoundType;
window.playClickSound = playClickSound;
window.CLICK_SOUND_PRESETS = CLICK_SOUND_PRESETS;
window.toggleRain = toggleRain;
window.startRain = startRain;
window.stopRain = stopRain;
window.setRainNoiseType = setRainNoiseType;
window.setRainFreq = setRainFreq;
window.setRainVolume = setRainVolume;
window.NOISE_PRESETS = NOISE_PRESETS;

export {
  toggleClickSound, setClickSoundType, playClickSound, CLICK_SOUND_PRESETS,
  toggleRain, startRain, stopRain, setRainNoiseType, setRainFreq, setRainVolume, NOISE_PRESETS
};

// ── User accounts & sync ──
