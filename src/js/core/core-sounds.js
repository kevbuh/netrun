// core-sounds.js — Click sounds
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

export {
  toggleClickSound, setClickSoundType, playClickSound, CLICK_SOUND_PRESETS,
};

// ── User accounts & sync ──
