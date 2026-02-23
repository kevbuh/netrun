import Settings from '/js/core/core-settings.js';
import { showAchievement } from '/js/core/core-ui.js';
import { PET_TYPES, getPetType, G, S } from '/js/pixel-pet.js';

// ── Netrunner Game — Chrome-dino-style easter egg ──

// Konami code sequence
const _nrKonami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
let _nrKonamiIdx = 0;
let _nrKonamiListener = null;

// Canvas & rendering
const _nrW = 900, _nrH = 300;
let _nrCanvas = null, _nrCtx = null, _nrOverlayView = null;
let _nrPetCanvas = null, _nrPetCtx = null;

// Game state
let _nrRunning = false, _nrGameOverFlag = false, _nrBooting = false;
let _nrRafId = null, _nrLastTs = 0;
let _nrScore = 0, _nrHighScore = 0;
let _nrSpeed = 5, _nrBaseSpeed = 5;
let _nrDist = 0;

// Player
const _nrPlayerX = 60;
let _nrPlayerY = 0, _nrPlayerVY = 0;
let _nrJumping = false, _nrDucking = false;
const _nrGravity = 1800;
const _nrJumpForce = -580;
const _nrGroundY = 0; // calculated from canvas
let _nrLegFrame = 0, _nrLegTimer = 0;

// Pet sprite size on game canvas
const _nrPetScale = 4;
const _nrPetSize = G * _nrPetScale; // 64px

// Obstacles
let _nrObstacles = [];
let _nrSpawnTimer = 0;
let _nrMinSpawnInterval = 1.2;

// Background data streams
let _nrStreamLines = [];

// Key state
const _nrKeys = {};

// ── Boot animation ──
const _nrBootLines = [
  'NETRUN OS v3.7.1',
  'Initializing ICE breaker...',
  'Loading neural interface...',
  'Jacking in...',
  '',
  '> NETRUNNER READY',
  '',
  'SPACE to start'
];
let _nrBootIdx = 0, _nrBootCharIdx = 0, _nrBootTimer = 0;
let _nrBootText = [];

// ── Colors (resolved at runtime from CSS tokens) ──
function _nrColor(varName, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
}

// ── Init: attach Konami listener ──
export function initNetrunner() {
  if (_nrKonamiListener) return;
  _nrKonamiListener = function(e) {
    if (_nrRunning) return;
    const key = e.key;
    if (key === _nrKonami[_nrKonamiIdx]) {
      _nrKonamiIdx++;
      if (_nrKonamiIdx === _nrKonami.length) {
        _nrKonamiIdx = 0;
        startNetrunner();
      }
    } else {
      _nrKonamiIdx = 0;
    }
  };
  document.addEventListener('keydown', _nrKonamiListener);
}

// ── Start game ──
window.startNetrunner = startNetrunner;
export function startNetrunner() {
  if (_nrRunning) return;
  _nrRunning = true;
  _nrGameOverFlag = false;
  _nrBooting = true;
  _nrHighScore = Settings.getJSON('netrunnerHighScore', 0);

  // Create canvas element imperatively — must call getContext('2d')
  _nrCanvas = document.createElement('canvas');
  _nrCanvas.className = 'nr-netrunner-canvas';
  _nrCanvas.width = _nrW;
  _nrCanvas.height = _nrH;
  _nrCtx = _nrCanvas.getContext('2d');

  // Build overlay with AetherUI and append live canvas via view.el
  _nrOverlayView = ZStack().className('nr-netrunner-overlay');
  AetherUI.append(_nrOverlayView, document.body);
  _nrOverlayView.el.appendChild(_nrCanvas);

  // Pet offscreen canvas
  _nrPetCanvas = document.createElement('canvas');
  _nrPetCanvas.width = G;
  _nrPetCanvas.height = G;
  _nrPetCtx = _nrPetCanvas.getContext('2d');

  // Init boot state
  _nrBootIdx = 0;
  _nrBootCharIdx = 0;
  _nrBootTimer = 0;
  _nrBootText = [];

  // Init background streams
  _nrStreamLines = [];
  for (let i = 0; i < 12; i++) {
    _nrStreamLines.push({
      x: Math.random() * _nrW,
      y: Math.random() * _nrH,
      speed: 0.3 + Math.random() * 0.7,
      chars: _nrRandomDataString(),
      alpha: 0.03 + Math.random() * 0.06
    });
  }

  // Key listeners
  document.addEventListener('keydown', _nrOnKeyDown);
  document.addEventListener('keyup', _nrOnKeyUp);

  // Start loop
  _nrLastTs = performance.now();
  _nrRafId = requestAnimationFrame(_nrGameLoop);
}

// ── Stop game ──
export function stopNetrunner() {
  _nrRunning = false;
  if (_nrRafId) { cancelAnimationFrame(_nrRafId); _nrRafId = null; }
  document.removeEventListener('keydown', _nrOnKeyDown);
  document.removeEventListener('keyup', _nrOnKeyUp);
  if (_nrOverlayView && _nrOverlayView.el && _nrOverlayView.el.parentNode) {
    _nrOverlayView.el.parentNode.removeChild(_nrOverlayView.el);
  }
  _nrOverlayView = null;
  _nrCanvas = null;
  _nrCtx = null;
}

// ── Key handlers ──
function _nrOnKeyDown(e) {
  _nrKeys[e.code] = true;

  if (e.code === 'Escape') {
    e.preventDefault();
    stopNetrunner();
    return;
  }

  if (_nrBooting && (e.code === 'Space')) {
    e.preventDefault();
    // Skip boot or start game
    if (_nrBootIdx < _nrBootLines.length) {
      // Skip boot animation — show all text
      _nrBootText = _nrBootLines.slice();
      _nrBootIdx = _nrBootLines.length;
    } else {
      _nrBooting = false;
      _nrResetGame();
    }
    return;
  }

  if (_nrGameOverFlag && e.code === 'Space') {
    e.preventDefault();
    _nrGameOverFlag = false;
    _nrResetGame();
    return;
  }

  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!_nrJumping && !_nrGameOverFlag && !_nrBooting) {
      _nrJumping = true;
      _nrPlayerVY = _nrJumpForce;
      _nrDucking = false;
    }
  }

  if (e.code === 'ArrowDown') {
    e.preventDefault();
    if (!_nrJumping && !_nrGameOverFlag && !_nrBooting) {
      _nrDucking = true;
    }
  }
}

function _nrOnKeyUp(e) {
  _nrKeys[e.code] = false;
  if (e.code === 'ArrowDown') {
    _nrDucking = false;
  }
}

// ── Reset game state ──
function _nrResetGame() {
  _nrScore = 0;
  _nrSpeed = _nrBaseSpeed;
  _nrDist = 0;
  _nrPlayerY = 0;
  _nrPlayerVY = 0;
  _nrJumping = false;
  _nrDucking = false;
  _nrObstacles = [];
  _nrSpawnTimer = 2;
  _nrLegFrame = 0;
  _nrLegTimer = 0;
}

// ── Main loop ──
function _nrGameLoop(ts) {
  if (!_nrRunning) return;
  const dt = Math.min((ts - _nrLastTs) / 1000, 0.05);
  _nrLastTs = ts;

  if (_nrBooting) {
    _nrUpdateBoot(dt);
    _nrRenderBoot();
  } else if (_nrGameOverFlag) {
    _nrRender();
    _nrRenderGameOver();
  } else {
    _nrUpdate(dt);
    _nrRender();
  }

  _nrRafId = requestAnimationFrame(_nrGameLoop);
}

// ── Boot animation update ──
function _nrUpdateBoot(dt) {
  _nrBootTimer += dt;
  if (_nrBootIdx < _nrBootLines.length) {
    const line = _nrBootLines[_nrBootIdx];
    if (line === '') {
      _nrBootText.push('');
      _nrBootIdx++;
      _nrBootCharIdx = 0;
      _nrBootTimer = 0;
    } else if (_nrBootTimer > 0.02) {
      _nrBootTimer = 0;
      _nrBootCharIdx++;
      if (_nrBootCharIdx >= line.length) {
        _nrBootText.push(line);
        _nrBootIdx++;
        _nrBootCharIdx = 0;
      }
    }
  }
}

// ── Boot render ──
function _nrRenderBoot() {
  const ctx = _nrCtx;
  ctx.fillStyle = _nrColor('--nr-bg-body', '#0a0a0f');
  ctx.fillRect(0, 0, _nrW, _nrH);

  // CRT scanlines
  ctx.fillStyle = 'rgba(255,255,255,0.015)';
  for (let y = 0; y < _nrH; y += 3) {
    ctx.fillRect(0, y, _nrW, 1);
  }

  // Boot text
  ctx.font = '14px monospace';
  ctx.textBaseline = 'top';
  const textColor = _nrColor('--nr-accent', '#00ff88');
  ctx.fillStyle = textColor;
  const startY = 30;

  for (let i = 0; i < _nrBootText.length; i++) {
    ctx.fillStyle = i === _nrBootText.length - 1 && _nrBootIdx >= _nrBootLines.length
      ? textColor : textColor;
    ctx.fillText(_nrBootText[i], 30, startY + i * 22);
  }

  // Current typing line
  if (_nrBootIdx < _nrBootLines.length) {
    const partial = _nrBootLines[_nrBootIdx].substring(0, _nrBootCharIdx);
    ctx.fillStyle = textColor;
    ctx.fillText(partial + (Math.floor(Date.now() / 400) % 2 ? '_' : ''), 30, startY + _nrBootText.length * 22);
  }

  // Blinking cursor after all boot text
  if (_nrBootIdx >= _nrBootLines.length) {
    const lastLine = _nrBootText.length - 1;
    if (Math.floor(Date.now() / 500) % 2) {
      ctx.fillText('_', 30 + ctx.measureText(_nrBootText[lastLine] || '').width, startY + lastLine * 22);
    }
  }
}

// ── Game update ──
function _nrUpdate(dt) {
  // Score
  _nrDist += _nrSpeed * dt * 60;
  _nrScore = Math.floor(_nrDist);

  // Speed increases
  _nrSpeed = _nrBaseSpeed + Math.floor(_nrScore / 500) * 0.5;
  if (_nrSpeed > 14) _nrSpeed = 14;

  // Ground Y (bottom of canvas minus ground height minus pet height)
  const groundLevel = _nrH - 40;

  // Player physics
  if (_nrJumping) {
    _nrPlayerVY += _nrGravity * dt;
    _nrPlayerY += _nrPlayerVY * dt;
    if (_nrPlayerY >= 0) {
      _nrPlayerY = 0;
      _nrPlayerVY = 0;
      _nrJumping = false;
    }
  }

  // Leg animation
  _nrLegTimer += dt;
  if (_nrLegTimer > 0.12) {
    _nrLegTimer = 0;
    _nrLegFrame = _nrLegFrame === 0 ? 1 : 0;
  }

  // Spawn obstacles
  _nrSpawnTimer -= dt;
  if (_nrSpawnTimer <= 0) {
    _nrSpawnObstacle();
    _nrSpawnTimer = _nrMinSpawnInterval + Math.random() * (2.5 - Math.min(_nrScore / 1000, 1.2));
  }

  // Move obstacles
  const moveSpeed = _nrSpeed * 60 * dt;
  for (let i = _nrObstacles.length - 1; i >= 0; i--) {
    _nrObstacles[i].x -= moveSpeed;
    if (_nrObstacles[i].x + _nrObstacles[i].w < -20) {
      _nrObstacles.splice(i, 1);
    }
  }

  // Collision
  if (_nrCheckCollision(groundLevel)) {
    _nrGameOver();
  }

  // Background streams
  for (const s of _nrStreamLines) {
    s.x -= s.speed * moveSpeed * 0.3;
    if (s.x < -300) {
      s.x = _nrW + Math.random() * 200;
      s.chars = _nrRandomDataString();
    }
  }
}

// ── Spawn obstacle ──
function _nrSpawnObstacle() {
  const groundLevel = _nrH - 40;
  const roll = Math.random();

  if (roll < 0.35) {
    // Small ICE block
    _nrObstacles.push({ type: 'ice-small', x: _nrW + 20, y: groundLevel - 28, w: 24, h: 28 });
  } else if (roll < 0.65) {
    // Tall ICE block
    _nrObstacles.push({ type: 'ice-tall', x: _nrW + 20, y: groundLevel - 48, w: 20, h: 48 });
  } else {
    // Firewall beam (high, must duck under)
    _nrObstacles.push({ type: 'firewall', x: _nrW + 20, y: groundLevel - _nrPetSize + 4, w: 80, h: 16 });
  }
}

// ── Collision check ──
function _nrCheckCollision(groundLevel) {
  const margin = 8; // forgiveness
  const pw = _nrDucking ? _nrPetSize : _nrPetSize - 8;
  const ph = _nrDucking ? _nrPetSize * 0.5 : _nrPetSize - 4;
  const px = _nrPlayerX + margin;
  const py = groundLevel - ph + _nrPlayerY + (_nrDucking ? 0 : 0);

  for (const obs of _nrObstacles) {
    const ox = obs.x + margin;
    const oy = obs.y + margin;
    const ow = obs.w - margin * 2;
    const oh = obs.h - margin * 2;

    if (px < ox + ow && px + pw - margin * 2 > ox && py < oy + oh && py + ph > oy) {
      return true;
    }
  }
  return false;
}

// ── Game over ──
function _nrGameOver() {
  _nrGameOverFlag = true;
  if (_nrScore > _nrHighScore) {
    _nrHighScore = _nrScore;
    Settings.setJSON('netrunnerHighScore', _nrHighScore);
    showAchievement('NEW HIGH SCORE: ' + _nrHighScore, 'trophy');
  }
}

// ── Main render ──
function _nrRender() {
  const ctx = _nrCtx;
  const groundLevel = _nrH - 40;

  // Background
  ctx.fillStyle = _nrColor('--nr-bg-body', '#0a0a0f');
  ctx.fillRect(0, 0, _nrW, _nrH);

  // CRT scanlines
  ctx.fillStyle = 'rgba(255,255,255,0.012)';
  for (let y = 0; y < _nrH; y += 3) {
    ctx.fillRect(0, y, _nrW, 1);
  }

  // Background data streams (parallax)
  ctx.font = '10px monospace';
  for (const s of _nrStreamLines) {
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = _nrColor('--nr-accent', '#00ff88');
    ctx.fillText(s.chars, s.x, s.y);
  }
  ctx.globalAlpha = 1;

  // Ground line
  ctx.strokeStyle = _nrColor('--nr-accent', '#00ff88');
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, groundLevel);
  ctx.lineTo(_nrW, groundLevel);
  ctx.stroke();

  // Ground scanline pattern
  ctx.globalAlpha = 0.06;
  for (let y = groundLevel + 2; y < _nrH; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(_nrW, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Draw obstacles
  for (const obs of _nrObstacles) {
    _nrDrawObstacle(ctx, obs, groundLevel);
  }

  // Draw player
  _nrDrawPlayer(ctx, groundLevel);

  // Score
  ctx.font = '16px monospace';
  ctx.fillStyle = _nrColor('--nr-text-primary', '#eee');
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('SCORE ' + String(_nrScore).padStart(6, '0'), _nrW - 20, 16);
  if (_nrHighScore > 0) {
    ctx.globalAlpha = 0.5;
    ctx.fillText('HI ' + String(_nrHighScore).padStart(6, '0'), _nrW - 20, 36);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
}

// ── Draw player ──
function _nrDrawPlayer(ctx, groundLevel) {
  const petType = getPetType();
  const pet = PET_TYPES[petType] || PET_TYPES.cat;

  // Render pet to offscreen canvas
  _nrPetCtx.clearRect(0, 0, G, G);
  const px = (x, y, c) => { _nrPetCtx.fillStyle = c; _nrPetCtx.fillRect(x, y, 1, 1); };

  pet.draw(px, {
    blink: false,
    tired: false,
    sleeping: false,
    sitting: _nrDucking,
    legFrame: _nrLegFrame,
    eyeDir: 'right'
  });

  // Blit to game canvas scaled up
  const drawH = _nrDucking ? _nrPetSize * 0.7 : _nrPetSize;
  const drawY = groundLevel - drawH + _nrPlayerY;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(_nrPetCanvas, _nrPlayerX, drawY, _nrPetSize, drawH);
  ctx.imageSmoothingEnabled = true;
}

// ── Draw obstacle ──
function _nrDrawObstacle(ctx, obs, groundLevel) {
  const accent = _nrColor('--nr-accent', '#00ff88');

  if (obs.type === 'ice-small' || obs.type === 'ice-tall') {
    // ICE blocks — pixel-art style
    const glow = obs.type === 'ice-tall' ? 'rgba(0,180,255,0.3)' : 'rgba(0,180,255,0.2)';
    ctx.fillStyle = glow;
    ctx.fillRect(obs.x - 2, obs.y - 2, obs.w + 4, obs.h + 4);

    ctx.fillStyle = '#0af';
    ctx.fillRect(obs.x, obs.y, obs.w, obs.h);

    // Inner detail
    ctx.fillStyle = '#08c';
    ctx.fillRect(obs.x + 4, obs.y + 4, obs.w - 8, obs.h - 8);

    // ICE label
    ctx.fillStyle = '#fff';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ICE', obs.x + obs.w / 2, obs.y + obs.h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Pixel corners
    ctx.fillStyle = '#0cf';
    ctx.fillRect(obs.x, obs.y, 4, 4);
    ctx.fillRect(obs.x + obs.w - 4, obs.y, 4, 4);
    ctx.fillRect(obs.x, obs.y + obs.h - 4, 4, 4);
    ctx.fillRect(obs.x + obs.w - 4, obs.y + obs.h - 4, 4, 4);
  } else if (obs.type === 'firewall') {
    // Firewall beam — horizontal scanline
    const t = Date.now() / 200;
    ctx.globalAlpha = 0.6 + Math.sin(t) * 0.2;

    // Glow
    ctx.fillStyle = 'rgba(255,50,50,0.15)';
    ctx.fillRect(obs.x - 4, obs.y - 6, obs.w + 8, obs.h + 12);

    // Main beam
    ctx.fillStyle = '#f33';
    ctx.fillRect(obs.x, obs.y, obs.w, obs.h);

    // Inner
    ctx.fillStyle = '#f66';
    ctx.fillRect(obs.x, obs.y + 4, obs.w, obs.h - 8);

    // Dashes
    ctx.fillStyle = '#f99';
    for (let dx = 0; dx < obs.w; dx += 12) {
      ctx.fillRect(obs.x + dx, obs.y + obs.h / 2 - 1, 6, 2);
    }

    // Label
    ctx.fillStyle = '#fcc';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FIREWALL', obs.x + obs.w / 2, obs.y + obs.h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    ctx.globalAlpha = 1;
  }
}

// ── Game over render ──
function _nrRenderGameOver() {
  const ctx = _nrCtx;

  // Darken
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, _nrW, _nrH);

  // Box
  const bx = _nrW / 2 - 160, by = _nrH / 2 - 60, bw = 320, bh = 120;
  ctx.fillStyle = 'rgba(10,10,20,0.9)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = _nrColor('--nr-accent', '#00ff88');
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);

  const accent = _nrColor('--nr-accent', '#00ff88');
  ctx.textAlign = 'center';

  ctx.font = '18px monospace';
  ctx.fillStyle = '#f44';
  ctx.fillText('CONNECTION SEVERED', _nrW / 2, by + 28);

  ctx.font = '14px monospace';
  ctx.fillStyle = _nrColor('--nr-text-primary', '#eee');
  ctx.fillText('SCORE: ' + _nrScore + '    HI: ' + _nrHighScore, _nrW / 2, by + 56);

  ctx.font = '12px monospace';
  ctx.fillStyle = accent;
  if (Math.floor(Date.now() / 600) % 2) {
    ctx.fillText('SPACE to retry  |  ESC to exit', _nrW / 2, by + 86);
  }

  ctx.textAlign = 'left';
}

// ── Helpers ──
function _nrRandomDataString() {
  const chars = '01アイウエオカキクケコ>>=::[]{}/*#$';
  let s = '';
  const len = 20 + Math.floor(Math.random() * 30);
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
