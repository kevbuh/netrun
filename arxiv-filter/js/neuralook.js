// ── Neuralook — Eye Tracking View ──

let _nlCalibrating = false;
let _nlTracking = false;
let _nlGazeDot = null;
let _nlWebgazerReady = false;
let _nlCalibrationPoints = 0;
let _nlGazeX = 0;
let _nlGazeY = 0;
let _nlPreviewStream = null; // camera stream for preview (stopped before webgazer starts)
const _NL_LERP = 0.3; // smoothing factor for gaze dot

function openNeuralook() {
  hideAllViews();
  const view = document.getElementById('neuralook-view');
  if (view) { view.classList.remove('hidden'); view.style.display = ''; }
  window.location.hash = '#neuralook';
  setSidebarActive('sb-neuralook');
  renderNeuralookView();
}

function renderNeuralookView() {
  const container = document.getElementById('neuralook-content');
  if (!container) return;

  const trackingLabel = _nlTracking ? 'Stop Tracking' : 'Start Tracking';
  const statusColor = _nlTracking ? '#4ade80' : _nlWebgazerReady ? '#fbbf24' : '#6b7280';
  const statusText = _nlTracking ? 'Tracking active' : _nlWebgazerReady ? 'Ready — not tracking' : 'Not started';

  container.innerHTML = `
    <h2 class="text-[1.1rem] font-semibold text-white_ mb-1">Neuralook</h2>
    <p class="text-dim text-[0.82rem] mb-6">Webcam-based eye tracking powered by WebGazer.js</p>

    <div class="grid gap-6" style="max-width:520px">
      <!-- Status -->
      <div class="bg-card border border-border-card rounded-xl p-4">
        <div class="flex items-center gap-2 mb-3">
          <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};display:inline-block"></span>
          <span class="text-[0.82rem] text-primary font-medium">${statusText}</span>
        </div>
        <div id="nl-camera-preview" class="rounded-lg overflow-hidden bg-black mb-3" style="width:240px;height:180px;display:flex;align-items:center;justify-content:center;">
          <span class="text-dimmer text-[0.75rem]" id="nl-camera-placeholder">Camera starts on calibration</span>
        </div>
        <div id="nl-error-msg" class="text-[0.75rem] text-red-400 mb-2" style="display:none"></div>
        <div class="flex gap-2 flex-wrap">
          <button onclick="_nlStartCalibration()" class="px-4 py-2 rounded-lg border border-border-input bg-card text-primary text-[0.82rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors" ${_nlCalibrating ? 'disabled style="opacity:0.5"' : ''}>
            ${_nlCalibrating ? 'Calibrating...' : _nlWebgazerReady ? 'Recalibrate' : 'Start Calibration'}
          </button>
          <button onclick="_nlToggleTracking()" class="px-4 py-2 rounded-lg border border-border-input text-[0.82rem] font-medium cursor-pointer transition-colors ${_nlTracking ? 'bg-accent text-white border-accent hover:bg-accent-hover' : 'bg-card text-primary hover:border-accent hover:text-accent'}" ${!_nlWebgazerReady ? 'disabled style="opacity:0.5"' : ''}>
            ${trackingLabel}
          </button>
        </div>
      </div>

      <!-- Info -->
      <div class="bg-card border border-border-card rounded-xl p-4">
        <h3 class="text-[0.85rem] font-semibold text-primary mb-2">How it works</h3>
        <ol class="text-[0.78rem] text-muted leading-relaxed list-decimal pl-4 space-y-1">
          <li>Click <strong>Start Calibration</strong> to begin the 9-point calibration</li>
          <li>Look at each dot and click it — this teaches the model your gaze</li>
          <li>After calibration, click <strong>Start Tracking</strong> to show the gaze dot</li>
          <li>The gaze dot appears across all views and follows your eyes</li>
          <li>Return here and click <strong>Stop Tracking</strong> to hide the dot</li>
        </ol>
      </div>

      <!-- Gaze dot appearance -->
      <div class="bg-card border border-border-card rounded-xl p-4">
        <h3 class="text-[0.85rem] font-semibold text-primary mb-3">Gaze Dot</h3>
        <div class="flex items-center gap-3">
          <label class="text-[0.78rem] text-muted">Color</label>
          <input type="color" id="nl-dot-color" value="#b4451a" onchange="_nlUpdateDotColor(this.value)" class="w-8 h-8 rounded cursor-pointer border border-border-input bg-transparent p-0">
          <label class="text-[0.78rem] text-muted ml-4">Size</label>
          <input type="range" id="nl-dot-size" min="8" max="40" value="20" oninput="_nlUpdateDotSize(this.value)" class="w-24">
          <span class="text-[0.72rem] text-dimmer tabular-nums" id="nl-dot-size-label">20px</span>
        </div>
      </div>
    </div>
  `;

  // If webgazer is already running, show its video in the preview
  _nlAttachCameraPreview();
}

// ── WebGazer Initialization ──

function _nlInitWebgazer() {
  if (typeof webgazer === 'undefined') {
    console.warn('Neuralook: WebGazer.js not loaded yet');
    return false;
  }
  if (_nlWebgazerReady) return true;

  try {
    webgazer.setGazeListener(_nlGazeListener);
    if (typeof webgazer.setRegression === 'function') webgazer.setRegression('ridge');
    if (typeof webgazer.saveDataAcrossSessions === 'function') webgazer.saveDataAcrossSessions(true);

    // Hide webgazer's built-in UI elements (guard each call)
    if (typeof webgazer.showVideoPreview === 'function') webgazer.showVideoPreview(false);
    if (typeof webgazer.showPredictionPoints === 'function') webgazer.showPredictionPoints(false);
    if (typeof webgazer.showFaceOverlay === 'function') webgazer.showFaceOverlay(false);
    if (typeof webgazer.showFaceFeedbackBox === 'function') webgazer.showFaceFeedbackBox(false);

    _nlWebgazerReady = true;
    return true;
  } catch (e) {
    console.error('Neuralook: init error', e);
    return false;
  }
}

function _nlGazeListener(data, timestamp) {
  if (!data || !_nlTracking) return;
  _nlGazeX += (data.x - _nlGazeX) * _NL_LERP;
  _nlGazeY += (data.y - _nlGazeY) * _NL_LERP;
  _nlMoveDot(_nlGazeX, _nlGazeY);
}

// ── Camera Preview ──

function _nlStopPreviewStream() {
  if (_nlPreviewStream) {
    _nlPreviewStream.getTracks().forEach(t => t.stop());
    _nlPreviewStream = null;
  }
}

function _nlAttachCameraPreview() {
  const previewBox = document.getElementById('nl-camera-preview');
  if (!previewBox) return;
  // Already has a video? Skip
  if (previewBox.querySelector('video')) return;

  // Try multiple ways to find WebGazer's video element
  let vid = null;
  if (typeof webgazer !== 'undefined') {
    try { vid = webgazer.getVideoElement ? webgazer.getVideoElement() : null; } catch (e) {}
    if (!vid) vid = document.getElementById('webgazerVideoFeed');
    if (!vid) vid = document.getElementById('webgazerVideoCanvas');
  }

  // If we found webgazer's video with a stream, clone it into our preview
  if (vid && vid.srcObject) {
    const placeholder = document.getElementById('nl-camera-placeholder');
    if (placeholder) placeholder.remove();
    const clone = document.createElement('video');
    clone.srcObject = vid.srcObject;
    clone.autoplay = true;
    clone.muted = true;
    clone.playsInline = true;
    Object.assign(clone.style, {
      width: '240px', height: '180px', objectFit: 'cover', transform: 'scaleX(-1)'
    });
    previewBox.appendChild(clone);
    return;
  }

  // Fallback: if webgazer is ready, grab camera directly for preview
  if (_nlWebgazerReady && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      // Check if view is still visible
      const box = document.getElementById('nl-camera-preview');
      if (!box || box.querySelector('video')) { stream.getTracks().forEach(t => t.stop()); return; }
      const placeholder = document.getElementById('nl-camera-placeholder');
      if (placeholder) placeholder.remove();
      _nlPreviewStream = stream;
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      Object.assign(video.style, {
        width: '240px', height: '180px', objectFit: 'cover', transform: 'scaleX(-1)'
      });
      box.appendChild(video);
    }).catch(() => {});
  }
}

// ── Calibration ──

function _nlShowError(msg) {
  const el = document.getElementById('nl-error-msg');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

function _nlStartCalibration() {
  if (_nlCalibrating) return;

  if (typeof webgazer === 'undefined') {
    _nlShowError('WebGazer.js failed to load from CDN. Check your network connection.');
    return;
  }

  // Initialize webgazer config
  if (!_nlInitWebgazer()) {
    _nlShowError('Failed to initialize WebGazer.');
    return;
  }

  _nlCalibrating = true;
  _nlCalibrationPoints = 0;

  // Stop any standalone preview stream so webgazer can grab the camera
  _nlStopPreviewStream();

  // Start webgazer (requests camera permission)
  const beginResult = webgazer.begin();

  // webgazer.begin() may or may not return a promise depending on version
  if (beginResult && typeof beginResult.then === 'function') {
    beginResult.then(() => {
      _nlOnWebgazerStarted();
    }).catch(err => {
      _nlOnWebgazerFailed(err);
    });
  } else {
    // Non-promise version — give it a moment to init, then proceed
    setTimeout(() => {
      if (webgazer.isReady && webgazer.isReady()) {
        _nlOnWebgazerStarted();
      } else {
        // Try again after longer delay
        setTimeout(() => {
          _nlOnWebgazerStarted();
        }, 2000);
      }
    }, 500);
  }
}

function _nlOnWebgazerStarted() {
  // Enter fullscreen before showing calibration
  const el = document.documentElement;
  const reqFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
  if (reqFs) {
    reqFs.call(el).then(() => {
      _nlShowCalibrationOverlay();
      renderNeuralookView();
    }).catch(() => {
      // Fullscreen denied — abort calibration
      _nlCalibrating = false;
      _nlShowError('Fullscreen is required for calibration. Please allow fullscreen access.');
      renderNeuralookView();
    });
    // Cancel calibration if user exits fullscreen mid-calibration (Escape key)
    document.addEventListener('fullscreenchange', _nlFullscreenChange);
    document.addEventListener('webkitfullscreenchange', _nlFullscreenChange);
  } else {
    // Fullscreen API not available — proceed anyway
    _nlShowCalibrationOverlay();
    renderNeuralookView();
  }
}

function _nlFullscreenChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFs && _nlCalibrating) {
    // User exited fullscreen during calibration — cancel
    _nlCalibrating = false;
    _nlCalibrationPoints = 0;
    const overlay = document.getElementById('nl-calibration-overlay');
    if (overlay) overlay.remove();
    const style = document.getElementById('nl-cal-style');
    if (style) style.remove();
    renderNeuralookView();
  }
  if (!isFs) {
    document.removeEventListener('fullscreenchange', _nlFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', _nlFullscreenChange);
  }
}

function _nlOnWebgazerFailed(err) {
  console.error('Neuralook: webgazer.begin() failed:', err);
  _nlCalibrating = false;
  _nlShowError('Camera error: ' + (err.message || err) + '. Check browser permissions (camera icon in address bar).');
  renderNeuralookView();
}

function _nlShowCalibrationOverlay() {
  const existing = document.getElementById('nl-calibration-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'nl-calibration-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    background: 'rgba(0,0,0,0.85)', zIndex: '99999',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
  });

  // Instruction text
  const instr = document.createElement('div');
  instr.style.cssText = 'position:absolute;top:30px;left:50%;transform:translateX(-50%);color:#fff;font-size:0.9rem;text-align:center;z-index:100000;pointer-events:none;';
  instr.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Calibration</div><div style="color:#aaa;font-size:0.78rem;">Look at each dot and click it. <span id="nl-cal-counter">0/9</span></div>';
  overlay.appendChild(instr);

  // 3x3 grid of calibration points
  const positions = [
    [10, 10], [50, 10], [90, 10],
    [10, 50], [50, 50], [90, 50],
    [10, 90], [50, 90], [90, 90]
  ];

  positions.forEach(([xPct, yPct], i) => {
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'absolute',
      left: xPct + '%', top: yPct + '%',
      width: '28px', height: '28px',
      borderRadius: '50%',
      background: 'var(--accent, #b4451a)',
      transform: 'translate(-50%, -50%)',
      cursor: 'pointer',
      transition: 'transform 0.2s, opacity 0.2s',
      animation: 'nl-pulse 1.5s ease-in-out infinite',
      opacity: '1',
      zIndex: '100001'
    });
    dot.dataset.index = i;
    dot.addEventListener('click', () => _nlCalibrationClick(dot));
    overlay.appendChild(dot);
  });

  // Add pulse animation
  const style = document.createElement('style');
  style.id = 'nl-cal-style';
  style.textContent = `@keyframes nl-pulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.3); } }`;
  document.head.appendChild(style);

  document.body.appendChild(overlay);
}

function _nlCalibrationClick(dot) {
  _nlCalibrationPoints++;

  // Shrink and fade the clicked dot
  dot.style.animation = 'none';
  dot.style.transform = 'translate(-50%, -50%) scale(0)';
  dot.style.opacity = '0';
  dot.style.pointerEvents = 'none';

  // Update counter
  const counter = document.getElementById('nl-cal-counter');
  if (counter) counter.textContent = _nlCalibrationPoints + '/9';

  if (_nlCalibrationPoints >= 9) {
    setTimeout(() => _nlFinishCalibration(), 400);
  }
}

function _nlFinishCalibration() {
  _nlCalibrating = false;

  const overlay = document.getElementById('nl-calibration-overlay');
  if (overlay) overlay.remove();
  const style = document.getElementById('nl-cal-style');
  if (style) style.remove();

  // Exit fullscreen
  const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
  if (exitFs && (document.fullscreenElement || document.webkitFullscreenElement)) {
    exitFs.call(document);
  }

  renderNeuralookView();
}

// ── Tracking Toggle ──

function _nlToggleTracking() {
  if (_nlTracking) {
    _nlStopTracking();
  } else {
    _nlStartTracking();
  }
}

function _nlStartTracking() {
  if (!_nlWebgazerReady) return;

  if (typeof webgazer !== 'undefined' && webgazer.isReady && !webgazer.isReady()) {
    const beginResult = webgazer.begin();
    const onReady = () => {
      _nlTracking = true;
      _nlCreateDot();
      renderNeuralookView();
    };
    if (beginResult && typeof beginResult.then === 'function') {
      beginResult.then(onReady).catch(err => {
        console.error('Neuralook: failed to begin webgazer', err);
        _nlShowError('Camera error: ' + (err.message || err));
      });
    } else {
      setTimeout(onReady, 1000);
    }
    return;
  }

  _nlTracking = true;
  _nlCreateDot();
  if (typeof webgazer !== 'undefined' && typeof webgazer.resume === 'function') webgazer.resume();
  renderNeuralookView();
}

function _nlStopTracking() {
  _nlTracking = false;
  _nlRemoveDot();
  if (typeof webgazer !== 'undefined' && typeof webgazer.pause === 'function') webgazer.pause();
  renderNeuralookView();
}

// ── Gaze Dot ──

function _nlCreateDot() {
  _nlRemoveDot();
  const dot = document.createElement('div');
  dot.id = 'nl-gaze-dot';
  const savedColor = document.getElementById('nl-dot-color')?.value || '#b4451a';
  const savedSize = document.getElementById('nl-dot-size')?.value || '20';
  const sz = parseInt(savedSize, 10);
  Object.assign(dot.style, {
    position: 'fixed',
    width: sz + 'px',
    height: sz + 'px',
    borderRadius: '50%',
    background: savedColor,
    opacity: '0.7',
    pointerEvents: 'none',
    zIndex: '99998',
    transform: 'translate(-50%, -50%)',
    transition: 'left 0.05s linear, top 0.05s linear',
    boxShadow: '0 0 8px ' + savedColor + '80',
    left: '-100px',
    top: '-100px'
  });
  document.body.appendChild(dot);
  _nlGazeDot = dot;
}

function _nlRemoveDot() {
  if (_nlGazeDot) { _nlGazeDot.remove(); _nlGazeDot = null; }
  const existing = document.getElementById('nl-gaze-dot');
  if (existing) existing.remove();
}

function _nlMoveDot(x, y) {
  if (!_nlGazeDot) return;
  _nlGazeDot.style.left = x + 'px';
  _nlGazeDot.style.top = y + 'px';
}

function _nlUpdateDotColor(color) {
  if (_nlGazeDot) {
    _nlGazeDot.style.background = color;
    _nlGazeDot.style.boxShadow = '0 0 8px ' + color + '80';
  }
}

function _nlUpdateDotSize(size) {
  const label = document.getElementById('nl-dot-size-label');
  if (label) label.textContent = size + 'px';
  if (_nlGazeDot) {
    _nlGazeDot.style.width = size + 'px';
    _nlGazeDot.style.height = size + 'px';
  }
}
