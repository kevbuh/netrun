// ── Neuralook — Eye Tracking View ──

let _nlCalibrating = false;
let _nlTracking = false;
let _nlGazeDot = null;
let _nlWebgazerReady = false;
let _nlCalibrationPoints = 0;
let _nlGazeX = 0;
let _nlGazeY = 0;
let _nlPreviewStream = null; // camera stream for preview (stopped before webgazer starts)
let _nlCurrentPoint = 0;      // which calibration point is active
let _nlClicksOnPoint = 0;     // clicks collected on current point
const _NL_CLICKS_PER_POINT = 8;
let _nlAccuracy = null;        // last accuracy test result in px (null = not tested)
let _nlStareInterval = null;   // interval feeding continuous gaze data while staring at dot
let _nlCalOrder = [];          // shuffled order of calibration points

// Smoothing — ring buffer of recent predictions
let _nlGazeBuffer = [];
const _NL_BUFFER_SIZE = 8;

// Model stats
let _nlClickSamples = 0;       // click training samples fed to WebGazer
let _nlMoveSamples = 0;        // continuous move training samples
let _nlPredictionCount = 0;    // total predictions received
let _nlPredictionsThisSec = 0; // predictions in the current 1-second window
let _nlPredictionRate = 0;     // predictions per second (updated each second)
let _nlStatsInterval = null;   // interval for refreshing the stats card
let _nlRateInterval = null;    // 1-second interval for computing prediction rate
let _nlCameraOn = false;       // whether the camera preview is active

// ── Neural Model (tinygrad GazeNet) state ──
let _nlNeuralWs = null;          // WebSocket to /ws/neuralook
let _nlNeuralReady = false;      // model trained and WS connected
let _nlNeuralTraining = false;   // currently training
let _nlNeuralMode = false;       // true = use neural model, false = WebGazer
let _nlNeuralInfo = null;        // training info from server {params, accuracy, ...}
let _nlNeuralInferInterval = null; // 33ms inference loop
let _nlTrainingSamples = [];     // calibration samples for neural model {left, right, x, y}
let _nlEyeCropCanvas = null;     // offscreen canvas for resizing eye patches

// Time-series history for graphs (rolling window, pushed every 500ms)
const _NL_GRAPH_LEN = 60;
let _nlHistGazeX = [];
let _nlHistGazeY = [];
let _nlHistJitter = [];
let _nlHistRate = [];

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
    <div style="display:grid;grid-template-columns:200px 1fr;gap:16px;height:calc(100vh - 60px);box-sizing:border-box;">
      <!-- Left panel — Controls -->
      <div class="flex flex-col gap-3">
        <!-- Status -->
        <div class="bg-card border border-border-card rounded-xl p-4">
          <div class="flex items-center gap-2 mb-3">
            <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};display:inline-block"></span>
            <span class="text-[0.82rem] text-primary font-medium">${statusText}</span>
          </div>
          <div id="nl-error-msg" class="text-[0.75rem] text-red-400 mb-2" style="display:none"></div>
          <div class="flex flex-col gap-2">
            <button onclick="_nlStartCalibration()" class="px-4 py-2 rounded-lg border border-border-input bg-card text-primary text-[0.82rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors w-full" ${_nlCalibrating ? 'disabled style="opacity:0.5"' : ''}>
              ${_nlCalibrating ? 'Calibrating...' : _nlWebgazerReady ? 'Recalibrate' : 'Start Calibration'}
            </button>
            <button onclick="_nlToggleTracking()" class="px-4 py-2 rounded-lg border border-border-input text-[0.82rem] font-medium cursor-pointer transition-colors w-full ${_nlTracking ? 'bg-accent text-white border-accent hover:bg-accent-hover' : 'bg-card text-primary hover:border-accent hover:text-accent'}" ${!_nlWebgazerReady ? 'disabled style="opacity:0.5"' : ''}>
              ${trackingLabel}
            </button>
          </div>
        </div>

        <!-- Gaze dot appearance -->
        <div class="bg-card border border-border-card rounded-xl p-4">
          <h3 class="text-[0.85rem] font-semibold text-primary mb-3">Gaze Dot</h3>
          <div class="flex items-center gap-3">
            <label class="text-[0.78rem] text-muted">Color</label>
            <input type="color" id="nl-dot-color" value="#ef4444" onchange="_nlUpdateDotColor(this.value)" class="w-8 h-8 rounded cursor-pointer border border-border-input bg-transparent p-0">
          </div>
          <div class="flex items-center gap-3 mt-2">
            <label class="text-[0.78rem] text-muted">Size</label>
            <input type="range" id="nl-dot-size" min="8" max="40" value="20" oninput="_nlUpdateDotSize(this.value)" class="flex-1">
            <span class="text-[0.72rem] text-dimmer tabular-nums" id="nl-dot-size-label">20px</span>
          </div>
        </div>

        <!-- Model Selection -->
        <div class="bg-card border border-border-card rounded-xl p-4">
          <h3 class="text-[0.85rem] font-semibold text-primary mb-3">Model</h3>
          <div class="flex flex-col gap-2">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="nl-model" value="webgazer" ${!_nlNeuralMode ? 'checked' : ''} onchange="_nlSetModelMode(false)" class="accent-[var(--accent)]">
              <span class="text-[0.78rem] text-primary">WebGazer (Ridge)</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="nl-model" value="neural" ${_nlNeuralMode ? 'checked' : ''} onchange="_nlSetModelMode(true)" class="accent-[var(--accent)]" ${!_nlNeuralReady ? 'disabled' : ''}>
              <span class="text-[0.78rem] ${_nlNeuralReady ? 'text-primary' : 'text-dimmer'}">Neural (GazeNet)</span>
            </label>
          </div>
          <div id="nl-neural-status" class="text-[0.72rem] mt-2 ${_nlNeuralTraining ? 'text-yellow-400' : _nlNeuralReady ? 'text-green-400' : 'text-dimmer'}">
            ${_nlNeuralTraining ? 'Training neural model...' : _nlNeuralReady ? 'Neural model ready' : 'Not trained — calibrate to train'}
          </div>
        </div>

        <!-- How it works -->
        <div class="bg-card border border-border-card rounded-xl p-4">
          <h3 class="text-[0.85rem] font-semibold text-primary mb-2">How it works</h3>
          <ol class="text-[0.78rem] text-muted leading-relaxed list-decimal pl-4 space-y-1">
            <li>Click <strong>Start Calibration</strong> — 33-point grid with warm-up</li>
            <li>Stare at each dot and click it 8 times</li>
            <li>Accuracy test + auto-refinement of weak areas</li>
            <li><strong>Start Tracking</strong> to show the gaze dot</li>
          </ol>
        </div>
      </div>

      <!-- Center panel — Camera + Graphs row, then Model Info -->
      <div style="display:flex;flex-direction:column;gap:12px;min-height:0;">
        <!-- Top row: Camera + Graphs side by side -->
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:12px;min-height:0;">
          <!-- Camera -->
          <div class="bg-card border border-border-card rounded-xl p-3" style="display:flex;flex-direction:column;min-height:0;">
            <div id="nl-camera-preview" class="rounded-lg overflow-hidden bg-black" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;">
              <span class="text-dimmer text-[0.75rem]" id="nl-camera-placeholder">${_nlCameraOn ? 'Starting...' : 'Camera off'}</span>
            </div>
            <div class="flex justify-center mt-2">
              <button id="nl-camera-toggle" onclick="_nlToggleCamera()" class="px-4 py-1.5 rounded-lg border border-border-input bg-card text-primary text-[0.78rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors">
                ${_nlCameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
              </button>
            </div>
          </div>

          <!-- Graphs -->
          <div class="bg-card border border-border-card rounded-xl p-3" style="display:flex;flex-direction:column;gap:6px;min-height:0;overflow:hidden;">
            <h3 class="text-[0.78rem] font-semibold text-primary" style="flex-shrink:0;">Live Graphs</h3>
            <div style="flex:1;display:flex;flex-direction:column;gap:4px;min-height:0;">
              <div style="flex:1;min-height:0;">
                <div class="text-[0.68rem] text-dimmer mb-0.5">Gaze X <span class="text-muted" style="float:right" id="nl-graph-gaze-x-val"></span></div>
                <canvas id="nl-graph-gaze-x" style="width:100%;height:calc(100% - 16px);display:block;"></canvas>
              </div>
              <div style="flex:1;min-height:0;">
                <div class="text-[0.68rem] text-dimmer mb-0.5">Gaze Y <span class="text-muted" style="float:right" id="nl-graph-gaze-y-val"></span></div>
                <canvas id="nl-graph-gaze-y" style="width:100%;height:calc(100% - 16px);display:block;"></canvas>
              </div>
              <div style="flex:1;min-height:0;">
                <div class="text-[0.68rem] text-dimmer mb-0.5">Jitter <span class="text-muted" style="float:right" id="nl-graph-jitter-val"></span></div>
                <canvas id="nl-graph-jitter" style="width:100%;height:calc(100% - 16px);display:block;"></canvas>
              </div>
              <div style="flex:1;min-height:0;">
                <div class="text-[0.68rem] text-dimmer mb-0.5">Prediction Rate <span class="text-muted" style="float:right" id="nl-graph-rate-val"></span></div>
                <canvas id="nl-graph-rate" style="width:100%;height:calc(100% - 16px);display:block;"></canvas>
              </div>
            </div>
          </div>
        </div>

        <!-- Model Info -->
        <div class="bg-card border border-border-card rounded-xl p-4" style="flex-shrink:0;">
          <h3 class="text-[0.85rem] font-semibold text-primary mb-3">Model Info</h3>
          <div id="nl-model-stats" class="grid grid-cols-2 gap-x-6 gap-y-2 text-[0.78rem]"></div>
        </div>
      </div>
    </div>
  `;

  // If camera is on, attach the preview
  if (_nlCameraOn) _nlAttachCameraPreview();
  _nlRefreshStats();
  _nlStartStatsInterval();
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
  if (!data) return;
  _nlPredictionCount++;
  _nlPredictionsThisSec++;
  // During accuracy test, collect predictions but don't move the dot
  if (_nlAccuracyCollecting) {
    _nlAccuracyPredictions.push({ x: data.x, y: data.y });
    return;
  }
  if (!_nlTracking) return;
  // Ring buffer smoothing
  _nlGazeBuffer.push({ x: data.x, y: data.y });
  if (_nlGazeBuffer.length > _NL_BUFFER_SIZE) _nlGazeBuffer.shift();
  let sx = 0, sy = 0;
  for (const p of _nlGazeBuffer) { sx += p.x; sy += p.y; }
  _nlGazeX = sx / _nlGazeBuffer.length;
  _nlGazeY = sy / _nlGazeBuffer.length;
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
      width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)'
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
        width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)'
      });
      box.appendChild(video);
    }).catch(() => {});
  }
}

function _nlToggleCamera() {
  if (_nlCameraOn) {
    // Turn off — remove video, stop stream
    _nlCameraOn = false;
    _nlStopPreviewStream();
    const box = document.getElementById('nl-camera-preview');
    if (box) {
      const vid = box.querySelector('video');
      if (vid) vid.remove();
      // Re-add placeholder
      if (!document.getElementById('nl-camera-placeholder')) {
        const ph = document.createElement('span');
        ph.id = 'nl-camera-placeholder';
        ph.className = 'text-dimmer text-[0.75rem]';
        ph.textContent = 'Camera off';
        box.appendChild(ph);
      }
    }
  } else {
    // Turn on
    _nlCameraOn = true;
    _nlAttachCameraPreview();
    // If webgazer isn't running yet, grab camera directly
    if (!_nlWebgazerReady && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const box = document.getElementById('nl-camera-preview');
      if (box && !box.querySelector('video')) {
        navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
          const b = document.getElementById('nl-camera-preview');
          if (!b || b.querySelector('video')) { stream.getTracks().forEach(t => t.stop()); return; }
          const placeholder = document.getElementById('nl-camera-placeholder');
          if (placeholder) placeholder.remove();
          _nlPreviewStream = stream;
          const video = document.createElement('video');
          video.srcObject = stream;
          video.autoplay = true;
          video.muted = true;
          video.playsInline = true;
          Object.assign(video.style, {
            width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)'
          });
          b.appendChild(video);
        }).catch(() => {});
      }
    }
  }
  // Update button text
  const btn = document.getElementById('nl-camera-toggle');
  if (btn) btn.textContent = _nlCameraOn ? 'Turn Camera Off' : 'Turn Camera On';
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
  _nlCurrentPoint = 0;
  _nlClicksOnPoint = 0;
  _nlClickSamples = 0;
  _nlMoveSamples = 0;
  _nlPredictionCount = 0;
  _nlRefinementDone = false;
  _nlTestDistances = [];
  _nlTrainingSamples = [];  // reset neural training samples
  _nlNeuralReady = false;
  _nlNeuralInfo = null;
  // Trim any refinement points from previous calibrations
  _NL_CAL_POSITIONS.length = _NL_CAL_BASE_COUNT;

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
  _nlCameraOn = true;
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
    _nlCurrentPoint = 0;
    _nlClicksOnPoint = 0;
    _nlAccuracyCollecting = false;
    if (_nlStareInterval) { clearInterval(_nlStareInterval); _nlStareInterval = null; }
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

// 5x5 grid (25 points) + 8 extreme edge points = 33 calibration points
const _NL_CAL_BASE_COUNT = 33; // original length before refinement points are appended
const _NL_CAL_POSITIONS = [
  // 5x5 grid
  [10, 10], [30, 10], [50, 10], [70, 10], [90, 10],
  [10, 30], [30, 30], [50, 30], [70, 30], [90, 30],
  [10, 50], [30, 50], [50, 50], [70, 50], [90, 50],
  [10, 70], [30, 70], [50, 70], [70, 70], [90, 70],
  [10, 90], [30, 90], [50, 90], [70, 90], [90, 90],
  // Extreme edges
  [50, 3],  [50, 97], [3, 50],  [97, 50],
  [3, 3],   [97, 3],  [3, 97],  [97, 97]
];

function _nlShuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
  instr.id = 'nl-cal-instr';
  instr.style.cssText = 'position:absolute;top:30px;left:50%;transform:translateX(-50%);color:#fff;font-size:0.9rem;text-align:center;z-index:100000;pointer-events:none;';
  overlay.appendChild(instr);

  // Add pulse animation
  const style = document.createElement('style');
  style.id = 'nl-cal-style';
  style.textContent = `@keyframes nl-pulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.3); } }`;
  document.head.appendChild(style);

  // Overall progress bar at bottom
  const progBar = document.createElement('div');
  progBar.id = 'nl-cal-progbar';
  Object.assign(progBar.style, {
    position: 'absolute', bottom: '24px', left: '10%', width: '80%', height: '4px',
    background: 'rgba(255,255,255,0.1)', borderRadius: '2px', zIndex: '100000'
  });
  const progFill = document.createElement('div');
  progFill.id = 'nl-cal-progfill';
  Object.assign(progFill.style, {
    width: '0%', height: '100%', background: 'var(--accent, #b4451a)',
    borderRadius: '2px', transition: 'width 0.3s'
  });
  progBar.appendChild(progFill);
  overlay.appendChild(progBar);

  document.body.appendChild(overlay);

  // Shuffle calibration order to prevent sequential bias
  _nlCalOrder = _nlShuffleArray([...Array(_NL_CAL_POSITIONS.length).keys()]);
  _nlCurrentPoint = 0;
  _nlClicksOnPoint = 0;

  // Warm-up phase — stare at center for 3 seconds
  _nlRunWarmup();
}

function _nlRunWarmup() {
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) return;

  const instr = document.getElementById('nl-cal-instr');
  if (instr) {
    instr.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Warm Up</div>' +
      '<div style="color:#aaa;font-size:0.78rem;">Look at the center dot — stabilizing face tracking...</div>';
  }

  // Show a center dot
  const dot = document.createElement('div');
  dot.id = 'nl-warmup-dot';
  Object.assign(dot.style, {
    position: 'absolute', left: '50%', top: '50%',
    width: '24px', height: '24px', borderRadius: '50%',
    background: '#60a5fa', transform: 'translate(-50%, -50%)',
    zIndex: '100001', opacity: '0', transition: 'opacity 0.3s'
  });
  overlay.appendChild(dot);
  requestAnimationFrame(() => { dot.style.opacity = '1'; });

  // Feed center position continuously during warm-up
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const warmupInterval = setInterval(() => {
    if (typeof webgazer !== 'undefined' && typeof webgazer.recordScreenPosition === 'function') {
      webgazer.recordScreenPosition(cx, cy, 'move');
      _nlMoveSamples++;
    }
  }, 60);

  // Countdown 3..2..1
  let countdown = 3;
  const countInterval = setInterval(() => {
    countdown--;
    if (instr && countdown > 0) {
      instr.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Warm Up</div>' +
        `<div style="color:#aaa;font-size:0.78rem;">Starting in ${countdown}...</div>`;
    }
  }, 1000);

  setTimeout(() => {
    clearInterval(warmupInterval);
    clearInterval(countInterval);
    dot.style.opacity = '0';
    setTimeout(() => {
      dot.remove();
      _nlShowNextCalibrationDot();
    }, 300);
  }, 3000);
}

function _nlShowNextCalibrationDot() {
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) return;

  // Remove previous dot if any
  const prev = document.getElementById('nl-cal-dot');
  if (prev) prev.remove();

  // Stop any continuous recording from previous dot
  if (_nlStareInterval) { clearInterval(_nlStareInterval); _nlStareInterval = null; }

  if (_nlCurrentPoint >= _nlCalOrder.length) {
    // All points done — run accuracy test
    _nlRunAccuracyTest();
    return;
  }

  const posIdx = _nlCalOrder[_nlCurrentPoint];
  const [xPct, yPct] = _NL_CAL_POSITIONS[posIdx];
  _nlClicksOnPoint = 0;
  _nlUpdateCalInstr();

  // Container for dot + SVG ring
  const wrap = document.createElement('div');
  wrap.id = 'nl-cal-dot';
  Object.assign(wrap.style, {
    position: 'absolute',
    left: xPct + '%', top: yPct + '%',
    width: '48px', height: '48px',
    transform: 'translate(-50%, -50%)',
    cursor: 'pointer',
    zIndex: '100001',
    opacity: '0',
    transition: 'opacity 0.3s'
  });

  // SVG progress ring
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '48');
  svg.setAttribute('height', '48');
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';

  // Background ring (dim)
  const bgCircle = document.createElementNS(svgNS, 'circle');
  bgCircle.setAttribute('cx', '24');
  bgCircle.setAttribute('cy', '24');
  bgCircle.setAttribute('r', '20');
  bgCircle.setAttribute('fill', 'none');
  bgCircle.setAttribute('stroke', 'rgba(255,255,255,0.15)');
  bgCircle.setAttribute('stroke-width', '3');
  svg.appendChild(bgCircle);

  // Progress ring
  const progressCircle = document.createElementNS(svgNS, 'circle');
  progressCircle.id = 'nl-cal-progress';
  progressCircle.setAttribute('cx', '24');
  progressCircle.setAttribute('cy', '24');
  progressCircle.setAttribute('r', '20');
  progressCircle.setAttribute('fill', 'none');
  progressCircle.setAttribute('stroke', 'var(--accent, #b4451a)');
  progressCircle.setAttribute('stroke-width', '3');
  progressCircle.setAttribute('stroke-linecap', 'round');
  const circumference = 2 * Math.PI * 20;
  progressCircle.setAttribute('stroke-dasharray', circumference.toString());
  progressCircle.setAttribute('stroke-dashoffset', circumference.toString());
  progressCircle.style.transition = 'stroke-dashoffset 0.2s';
  progressCircle.style.transform = 'rotate(-90deg)';
  progressCircle.style.transformOrigin = '50% 50%';
  svg.appendChild(progressCircle);

  wrap.appendChild(svg);

  // Inner dot
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    position: 'absolute',
    left: '50%', top: '50%',
    width: '20px', height: '20px',
    borderRadius: '50%',
    background: 'var(--accent, #b4451a)',
    transform: 'translate(-50%, -50%)',
    animation: 'nl-pulse 1.5s ease-in-out infinite'
  });
  wrap.appendChild(dot);

  wrap.addEventListener('click', _nlCalibrationClick);
  overlay.appendChild(wrap);

  // Fade in, wait for gaze to settle, then start continuous recording + accept clicks
  wrap.style.pointerEvents = 'none';
  requestAnimationFrame(() => { wrap.style.opacity = '1'; });
  const stareX = window.innerWidth * xPct / 100;
  const stareY = window.innerHeight * yPct / 100;
  setTimeout(() => {
    wrap.style.pointerEvents = '';
    // Continuously feed gaze samples every 60ms while staring at this dot
    _nlStareInterval = setInterval(() => {
      if (typeof webgazer !== 'undefined' && typeof webgazer.recordScreenPosition === 'function') {
        webgazer.recordScreenPosition(stareX, stareY, 'move');
        _nlMoveSamples++;
      }
      // Also collect eye crops for neural model (every other tick = ~120ms)
      if (_nlMoveSamples % 2 === 0) {
        _nlCollectEyeSample(stareX, stareY);
      }
    }, 60);
  }, 800);
}

function _nlUpdateCalInstr() {
  const instr = document.getElementById('nl-cal-instr');
  if (!instr) return;
  const total = _nlCalOrder.length;
  instr.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">Calibration</div>` +
    `<div style="color:#aaa;font-size:0.78rem;">Point ${_nlCurrentPoint + 1}/${total} — Click ${Math.min(_nlClicksOnPoint + 1, _NL_CLICKS_PER_POINT)}/${_NL_CLICKS_PER_POINT}</div>`;
  // Update overall progress bar
  const progFill = document.getElementById('nl-cal-progfill');
  if (progFill) {
    const totalClicks = total * _NL_CLICKS_PER_POINT;
    const done = _nlCurrentPoint * _NL_CLICKS_PER_POINT + _nlClicksOnPoint;
    progFill.style.width = Math.round((done / totalClicks) * 100) + '%';
  }
}

function _nlCalibrationClick() {
  _nlClicksOnPoint++;
  _nlCalibrationPoints++;

  // Feed the training sample to WebGazer — tell it the user is looking at this screen position
  const posIdx = _nlCalOrder[_nlCurrentPoint];
  const [xPct, yPct] = _NL_CAL_POSITIONS[posIdx];
  const screenX = window.innerWidth * xPct / 100;
  const screenY = window.innerHeight * yPct / 100;
  if (typeof webgazer !== 'undefined' && typeof webgazer.recordScreenPosition === 'function') {
    webgazer.recordScreenPosition(screenX, screenY, 'click');
    _nlClickSamples++;
  }

  // Collect eye crop for neural model training
  _nlCollectEyeSample(screenX, screenY);

  // Update progress ring
  const progressCircle = document.getElementById('nl-cal-progress');
  if (progressCircle) {
    const circumference = 2 * Math.PI * 20;
    const offset = circumference * (1 - _nlClicksOnPoint / _NL_CLICKS_PER_POINT);
    progressCircle.setAttribute('stroke-dashoffset', offset.toString());
  }

  _nlUpdateCalInstr();

  if (_nlClicksOnPoint >= _NL_CLICKS_PER_POINT) {
    // Stop continuous recording for this point
    if (_nlStareInterval) { clearInterval(_nlStareInterval); _nlStareInterval = null; }
    // Done with this point — fade out and move to next
    const wrap = document.getElementById('nl-cal-dot');
    if (wrap) {
      wrap.style.opacity = '0';
      wrap.style.pointerEvents = 'none';
    }
    _nlCurrentPoint++;
    setTimeout(_nlShowNextCalibrationDot, 350);
  }
}

// ── Post-calibration accuracy test ──

let _nlAccuracyCollecting = false;
let _nlAccuracyPredictions = [];

// 8 test positions — positions not in the main calibration grid
const _NL_TEST_POSITIONS = [
  [20, 20], [80, 20], [20, 80], [80, 80],
  [50, 15], [50, 85], [15, 50], [85, 50]
];

function _nlRunAccuracyTest() {
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) { _nlFinishCalibration(); return; }

  // Remove calibration dot
  const dot = document.getElementById('nl-cal-dot');
  if (dot) dot.remove();

  // Update instruction
  const instr = document.getElementById('nl-cal-instr');
  if (instr) {
    instr.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Accuracy Test</div>' +
      '<div style="color:#aaa;font-size:0.78rem;">Look at each dot — measuring accuracy...</div>';
  }

  _nlAccuracyTestLoop(0, []);
}

let _nlTestDistances = [];  // per-point distances from accuracy test
let _nlRefinementDone = false;

function _nlAccuracyTestLoop(idx, distances) {
  if (idx >= _NL_TEST_POSITIONS.length) {
    // Compute average
    const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
    _nlAccuracy = avg;
    _nlTestDistances = distances.slice();
    _nlShowAccuracyResult(avg);
    return;
  }

  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) { _nlFinishCalibration(); return; }

  const [xPct, yPct] = _NL_TEST_POSITIONS[idx];
  const targetX = window.innerWidth * xPct / 100;
  const targetY = window.innerHeight * yPct / 100;

  // Show test dot (no click needed)
  const testDot = document.createElement('div');
  testDot.id = 'nl-test-dot';
  Object.assign(testDot.style, {
    position: 'absolute',
    left: xPct + '%', top: yPct + '%',
    width: '20px', height: '20px',
    borderRadius: '50%',
    background: '#60a5fa',
    transform: 'translate(-50%, -50%)',
    zIndex: '100001',
    opacity: '0',
    transition: 'opacity 0.25s'
  });
  overlay.appendChild(testDot);
  requestAnimationFrame(() => { testDot.style.opacity = '1'; });

  // Update counter
  const instr = document.getElementById('nl-cal-instr');
  if (instr) {
    instr.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Accuracy Test</div>' +
      `<div style="color:#aaa;font-size:0.78rem;">Point ${idx + 1}/${_NL_TEST_POSITIONS.length} — look at the dot</div>`;
  }

  // Start collecting predictions
  _nlAccuracyPredictions = [];
  _nlAccuracyCollecting = true;

  setTimeout(() => {
    _nlAccuracyCollecting = false;
    testDot.style.opacity = '0';

    // Compute average distance for this dot
    let dist = Infinity;
    if (_nlAccuracyPredictions.length > 0) {
      let sx = 0, sy = 0;
      for (const p of _nlAccuracyPredictions) { sx += p.x; sy += p.y; }
      const avgX = sx / _nlAccuracyPredictions.length;
      const avgY = sy / _nlAccuracyPredictions.length;
      dist = Math.sqrt((avgX - targetX) ** 2 + (avgY - targetY) ** 2);
    }
    distances.push(dist);

    setTimeout(() => {
      testDot.remove();
      _nlAccuracyTestLoop(idx + 1, distances);
    }, 300);
  }, 2000);
}

function _nlShowAccuracyResult(avgPx) {
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) { _nlFinishCalibration(); return; }

  const px = Math.round(avgPx);
  const label = px < 80 ? 'Good' : px < 150 ? 'Fair' : 'Poor';
  const labelColor = px < 80 ? '#4ade80' : px < 150 ? '#fbbf24' : '#f87171';

  // Clear overlay content and show result
  const instr = document.getElementById('nl-cal-instr');
  if (instr) instr.remove();
  const testDot = document.getElementById('nl-test-dot');
  if (testDot) testDot.remove();

  const needsRefinement = !_nlRefinementDone && px >= 80;

  const result = document.createElement('div');
  result.id = 'nl-accuracy-result';
  result.style.cssText = 'text-align:center;color:#fff;';
  result.innerHTML = `
    <div style="font-size:1.1rem;font-weight:600;margin-bottom:8px;">${_nlRefinementDone ? 'Refinement Complete' : 'Calibration Complete'}</div>
    <div style="font-size:2rem;font-weight:700;color:${labelColor};margin-bottom:4px;">~${px}px</div>
    <div style="font-size:0.85rem;color:${labelColor};font-weight:500;">${label}</div>
    <div style="font-size:0.75rem;color:#888;margin-top:12px;">Average accuracy across ${_NL_TEST_POSITIONS.length} test points</div>
    ${needsRefinement ? '<div style="font-size:0.78rem;color:#aaa;margin-top:16px;">Refining weak areas...</div>' : ''}
  `;
  overlay.appendChild(result);

  if (needsRefinement) {
    // Auto-refine: recalibrate the weakest test positions
    setTimeout(() => {
      result.remove();
      _nlRunRefinement();
    }, 1500);
  } else {
    // Done — train neural model in background before finishing
    if (_nlTrainingSamples.length >= 4) {
      _nlTrainNeuralModel();
    }
    setTimeout(() => _nlFinishCalibration(), 2500);
  }
}

function _nlRunRefinement() {
  _nlRefinementDone = true;
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) { _nlFinishCalibration(); return; }

  // Find the worst test points (above 80px error) and recalibrate them
  const weakPoints = [];
  for (let i = 0; i < _nlTestDistances.length; i++) {
    if (_nlTestDistances[i] > 60) {
      weakPoints.push(_NL_TEST_POSITIONS[i]);
    }
  }
  // If somehow none qualify, take the worst 3
  if (weakPoints.length === 0) {
    const sorted = _nlTestDistances.map((d, i) => ({ d, i })).sort((a, b) => b.d - a.d);
    for (let k = 0; k < Math.min(3, sorted.length); k++) {
      weakPoints.push(_NL_TEST_POSITIONS[sorted[k].i]);
    }
  }

  // Re-add instr
  let instrEl = document.getElementById('nl-cal-instr');
  if (!instrEl) {
    instrEl = document.createElement('div');
    instrEl.id = 'nl-cal-instr';
    instrEl.style.cssText = 'position:absolute;top:30px;left:50%;transform:translateX(-50%);color:#fff;font-size:0.9rem;text-align:center;z-index:100000;pointer-events:none;';
    overlay.appendChild(instrEl);
  }

  // Use these weak points as extra calibration targets
  // Build a temporary cal order from these positions (appended to _NL_CAL_POSITIONS temporarily)
  const startIdx = _NL_CAL_POSITIONS.length;
  const tempIndices = [];
  for (const pos of weakPoints) {
    _NL_CAL_POSITIONS.push(pos);
    tempIndices.push(_NL_CAL_POSITIONS.length - 1);
  }
  _nlCalOrder = _nlShuffleArray(tempIndices);
  _nlCurrentPoint = 0;
  _nlClicksOnPoint = 0;

  // Update progress bar
  const progFill = document.getElementById('nl-cal-progfill');
  if (progFill) progFill.style.width = '0%';

  instrEl.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Refinement Pass</div>' +
    `<div style="color:#aaa;font-size:0.78rem;">Recalibrating ${weakPoints.length} weak areas...</div>`;

  setTimeout(() => _nlShowNextCalibrationDot(), 500);
}

function _nlFinishCalibration() {
  _nlCalibrating = false;
  _nlAccuracyCollecting = false;
  if (_nlStareInterval) { clearInterval(_nlStareInterval); _nlStareInterval = null; }

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
  if (_nlNeuralMode && _nlNeuralReady) {
    // Use neural model — pause WebGazer, start neural inference
    if (typeof webgazer !== 'undefined' && typeof webgazer.pause === 'function') webgazer.pause();
    _nlConnectNeuralWs();
    setTimeout(() => _nlStartNeuralInference(), 500);
  } else {
    if (typeof webgazer !== 'undefined' && typeof webgazer.resume === 'function') webgazer.resume();
  }
  renderNeuralookView();
}

function _nlStopTracking() {
  _nlTracking = false;
  _nlRemoveDot();
  _nlStopNeuralInference();
  if (typeof webgazer !== 'undefined' && typeof webgazer.pause === 'function') webgazer.pause();
  renderNeuralookView();
}

// ── Gaze Dot ──

function _nlCreateDot() {
  _nlRemoveDot();
  const dot = document.createElement('div');
  dot.id = 'nl-gaze-dot';
  const savedColor = document.getElementById('nl-dot-color')?.value || '#ef4444';
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

// ── Model Stats ──

function _nlStartStatsInterval() {
  _nlStopStatsInterval();
  // Refresh stats card every 500ms while on the neuralook view
  _nlStatsInterval = setInterval(() => {
    const el = document.getElementById('nl-model-stats');
    if (!el) { _nlStopStatsInterval(); return; }
    _nlRefreshStats();
  }, 500);
  // Prediction rate: count predictions each second
  _nlRateInterval = setInterval(() => {
    _nlPredictionRate = _nlPredictionsThisSec;
    _nlPredictionsThisSec = 0;
  }, 1000);
}

function _nlStopStatsInterval() {
  if (_nlStatsInterval) { clearInterval(_nlStatsInterval); _nlStatsInterval = null; }
  if (_nlRateInterval) { clearInterval(_nlRateInterval); _nlRateInterval = null; }
}

function _nlComputeJitter() {
  if (_nlGazeBuffer.length < 2) return 0;
  let sx = 0, sy = 0;
  for (const p of _nlGazeBuffer) { sx += p.x; sy += p.y; }
  const mx = sx / _nlGazeBuffer.length;
  const my = sy / _nlGazeBuffer.length;
  let variance = 0;
  for (const p of _nlGazeBuffer) {
    variance += (p.x - mx) ** 2 + (p.y - my) ** 2;
  }
  return Math.sqrt(variance / _nlGazeBuffer.length);
}

function _nlRefreshStats() {
  const el = document.getElementById('nl-model-stats');
  if (!el) return;

  const totalSamples = _nlClickSamples + _nlMoveSamples;
  const accPx = _nlAccuracy !== null ? Math.round(_nlAccuracy) : null;
  const accLabel = accPx !== null ? (accPx < 80 ? 'Good' : accPx < 150 ? 'Fair' : 'Poor') : null;
  const accColor = accPx !== null ? (accPx < 80 ? '#4ade80' : accPx < 150 ? '#fbbf24' : '#f87171') : '#6b7280';
  const jitter = _nlTracking ? Math.round(_nlComputeJitter()) : null;
  const jitterColor = jitter !== null ? (jitter < 30 ? '#4ade80' : jitter < 70 ? '#fbbf24' : '#f87171') : '#6b7280';

  const row = (label, value, color) =>
    `<div class="text-muted">${label}</div><div class="text-primary font-medium tabular-nums" ${color ? `style="color:${color}"` : ''}>${value}</div>`;

  const activeModel = _nlNeuralMode ? 'GazeNet (Neural)' : 'Ridge (WebGazer)';
  const neuralStatus = _nlNeuralTraining ? '<span style="color:#fbbf24">Training...</span>'
    : _nlNeuralReady ? '<span style="color:#4ade80">Ready</span>'
    : '<span class="text-dimmer">Not trained</span>';

  el.innerHTML =
    row('Active model', activeModel) +
    row('Neural model', neuralStatus) +
    (_nlNeuralInfo ? row('Neural params', `${(_nlNeuralInfo.params || 0).toLocaleString()}`) : '') +
    (_nlNeuralInfo ? row('Neural train loss', `${_nlNeuralInfo.final_loss}`) : '') +
    (_nlNeuralInfo ? row('Neural avg error', `${_nlNeuralInfo.avg_error_norm} (norm)`) : '') +
    (_nlNeuralInfo ? row('Neural train time', `${_nlNeuralInfo.train_time_s}s`) : '') +
    row('Training samples', `${totalSamples}` + (totalSamples > 0 ? ` <span class="text-dimmer font-normal">(${_nlClickSamples} click + ${_nlMoveSamples} gaze)</span>` : '')) +
    (_nlTrainingSamples.length > 0 ? row('Neural samples', `${_nlTrainingSamples.length} eye crops`) : '') +
    row('Calibration points', `${_NL_CAL_POSITIONS.length}`) +
    row('Accuracy', accPx !== null ? `${accPx}px — ${accLabel}` : 'Not tested', accColor) +
    row('Prediction rate', _nlTracking ? `${_nlPredictionRate} Hz` : '<span class="text-dimmer">Inactive</span>') +
    row('Jitter (stddev)', jitter !== null ? `${jitter}px` : '<span class="text-dimmer">Inactive</span>', jitter !== null ? jitterColor : null) +
    row('Gaze position', _nlTracking ? `${Math.round(_nlGazeX)}, ${Math.round(_nlGazeY)}` : '<span class="text-dimmer">Inactive</span>') +
    row('Buffer size', `${_NL_BUFFER_SIZE} samples`) +
    row('Total predictions', `${_nlPredictionCount.toLocaleString()}`);

  // Push history for graphs
  _nlHistGazeX.push(_nlTracking ? _nlGazeX : null);
  _nlHistGazeY.push(_nlTracking ? _nlGazeY : null);
  _nlHistJitter.push(_nlTracking ? _nlComputeJitter() : null);
  _nlHistRate.push(_nlPredictionRate);
  if (_nlHistGazeX.length > _NL_GRAPH_LEN) _nlHistGazeX.shift();
  if (_nlHistGazeY.length > _NL_GRAPH_LEN) _nlHistGazeY.shift();
  if (_nlHistJitter.length > _NL_GRAPH_LEN) _nlHistJitter.shift();
  if (_nlHistRate.length > _NL_GRAPH_LEN) _nlHistRate.shift();

  // Update live values next to labels
  const gxv = document.getElementById('nl-graph-gaze-x-val');
  const gyv = document.getElementById('nl-graph-gaze-y-val');
  const jv = document.getElementById('nl-graph-jitter-val');
  const rv = document.getElementById('nl-graph-rate-val');
  if (gxv) gxv.textContent = _nlTracking ? Math.round(_nlGazeX) + 'px' : '—';
  if (gyv) gyv.textContent = _nlTracking ? Math.round(_nlGazeY) + 'px' : '—';
  if (jv) jv.textContent = jitter !== null ? jitter + 'px' : '—';
  if (rv) rv.textContent = _nlPredictionRate + ' Hz';

  // Draw graphs
  _nlDrawGraph('nl-graph-gaze-x', _nlHistGazeX, '#60a5fa', 0, window.innerWidth);
  _nlDrawGraph('nl-graph-gaze-y', _nlHistGazeY, '#a78bfa', 0, window.innerHeight);
  _nlDrawGraph('nl-graph-jitter', _nlHistJitter, '#fbbf24', 0, 150);
  _nlDrawGraph('nl-graph-rate', _nlHistRate, '#4ade80', 0, null);
}

function _nlDrawGraph(canvasId, data, color, fixedMin, fixedMax) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Size canvas to its CSS pixel dimensions
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (w <= 0 || h <= 0) return;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // Filter non-null values for range
  const valid = data.filter(v => v !== null);
  if (valid.length < 2) {
    // Draw flat line placeholder
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    return;
  }

  let min = fixedMin != null ? fixedMin : Math.min(...valid);
  let max = fixedMax != null ? fixedMax : Math.max(...valid);
  if (max === min) { max = min + 1; }
  const pad = h * 0.08;

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = dpr;
  for (let i = 1; i < 4; i++) {
    const gy = pad + (h - 2 * pad) * (i / 4);
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  // Data line
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === null) { started = false; continue; }
    const x = (i / (_NL_GRAPH_LEN - 1)) * w;
    const y = pad + (h - 2 * pad) * (1 - (v - min) / (max - min));
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Glow fill
  if (started) {
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '18');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.fill();
  }
}

// ── Neural Model — Eye Crop Capture ──

function _nlGetEyeCropCanvas() {
  if (!_nlEyeCropCanvas) {
    _nlEyeCropCanvas = document.createElement('canvas');
    _nlEyeCropCanvas.width = 32;
    _nlEyeCropCanvas.height = 32;
  }
  return _nlEyeCropCanvas;
}

function _nlResizePatchToGrayscale(imageData, srcW, srcH) {
  // Resize arbitrary eye patch ImageData to 32x32 grayscale Uint8Array(1024)
  const canvas = _nlGetEyeCropCanvas();
  const ctx = canvas.getContext('2d');
  // Draw source to a temp canvas at original size, then draw scaled
  const tmp = document.createElement('canvas');
  tmp.width = srcW;
  tmp.height = srcH;
  const tmpCtx = tmp.getContext('2d');
  tmpCtx.putImageData(imageData, 0, 0);

  ctx.clearRect(0, 0, 32, 32);
  ctx.drawImage(tmp, 0, 0, srcW, srcH, 0, 0, 32, 32);

  const scaled = ctx.getImageData(0, 0, 32, 32);
  const gray = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) {
    const r = scaled.data[i * 4];
    const g = scaled.data[i * 4 + 1];
    const b = scaled.data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

function _nlCaptureEyePatches() {
  // Use WebGazer's tracker to get eye patches from the current video frame
  if (typeof webgazer === 'undefined') return null;

  try {
    const tracker = webgazer.getTracker();
    if (!tracker) return null;

    // Find WebGazer's video element
    let vid = null;
    try { vid = webgazer.getVideoElement ? webgazer.getVideoElement() : null; } catch (e) {}
    if (!vid) vid = document.getElementById('webgazerVideoFeed');
    if (!vid || !vid.videoWidth) return null;

    // Draw current video frame to a canvas
    const vw = vid.videoWidth;
    const vh = vid.videoHeight;
    let capCanvas = document.getElementById('_nl-cap-canvas');
    if (!capCanvas) {
      capCanvas = document.createElement('canvas');
      capCanvas.id = '_nl-cap-canvas';
      capCanvas.style.display = 'none';
      document.body.appendChild(capCanvas);
    }
    capCanvas.width = vw;
    capCanvas.height = vh;
    const capCtx = capCanvas.getContext('2d');
    capCtx.drawImage(vid, 0, 0, vw, vh);

    // Get eye patches via WebGazer's internal API
    const patches = tracker.getEyePatches(vid, capCanvas, vw, vh);
    if (!patches || !patches.left || !patches.right) return null;

    // patches.left.patch and patches.right.patch are ImageData objects
    const leftPatch = patches.left.patch;
    const rightPatch = patches.right.patch;
    if (!leftPatch || !rightPatch) return null;

    const left = _nlResizePatchToGrayscale(leftPatch, leftPatch.width, leftPatch.height);
    const right = _nlResizePatchToGrayscale(rightPatch, rightPatch.width, rightPatch.height);

    return { left, right };
  } catch (e) {
    // Eye patch extraction can fail if face not detected
    return null;
  }
}

// ── Neural Model — WebSocket Connection ──

function _nlConnectNeuralWs() {
  if (_nlNeuralWs && _nlNeuralWs.readyState <= 1) return; // already open/connecting

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/neuralook`;
  _nlNeuralWs = new WebSocket(url);
  _nlNeuralWs.binaryType = 'arraybuffer';

  _nlNeuralWs.onopen = () => {
    console.log('Neuralook: neural WS connected');
    // Check status
    _nlNeuralWs.send(JSON.stringify({ type: 'status' }));
  };

  _nlNeuralWs.onmessage = (evt) => {
    if (typeof evt.data === 'string') {
      // Text frame — JSON response
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'trained') {
          _nlNeuralTraining = false;
          _nlNeuralReady = true;
          _nlNeuralInfo = msg;
          console.log('Neuralook: neural model trained', msg);
          // Update UI
          const statusEl = document.getElementById('nl-neural-status');
          if (statusEl) {
            statusEl.textContent = 'Neural model ready';
            statusEl.className = 'text-[0.72rem] mt-2 text-green-400';
          }
          // Enable the radio button
          const radios = document.querySelectorAll('input[name="nl-model"][value="neural"]');
          radios.forEach(r => r.disabled = false);
          _nlRefreshStats();
        } else if (msg.type === 'status') {
          if (msg.model_loaded) {
            _nlNeuralReady = true;
            _nlNeuralInfo = _nlNeuralInfo || { params: msg.params };
          }
        } else if (msg.type === 'error') {
          console.error('Neuralook: neural error:', msg.msg);
          _nlNeuralTraining = false;
          const statusEl = document.getElementById('nl-neural-status');
          if (statusEl) {
            statusEl.textContent = 'Error: ' + msg.msg;
            statusEl.className = 'text-[0.72rem] mt-2 text-red-400';
          }
        }
      } catch (e) {}
    } else if (evt.data instanceof ArrayBuffer && evt.data.byteLength === 8) {
      // Binary frame — inference result (2x float32)
      const view = new Float32Array(evt.data);
      const nx = view[0] * window.innerWidth;
      const ny = view[1] * window.innerHeight;

      _nlPredictionCount++;
      _nlPredictionsThisSec++;

      if (_nlAccuracyCollecting) {
        _nlAccuracyPredictions.push({ x: nx, y: ny });
        return;
      }
      if (!_nlTracking || !_nlNeuralMode) return;

      // Ring buffer smoothing (same as WebGazer)
      _nlGazeBuffer.push({ x: nx, y: ny });
      if (_nlGazeBuffer.length > _NL_BUFFER_SIZE) _nlGazeBuffer.shift();
      let sx = 0, sy = 0;
      for (const p of _nlGazeBuffer) { sx += p.x; sy += p.y; }
      _nlGazeX = sx / _nlGazeBuffer.length;
      _nlGazeY = sy / _nlGazeBuffer.length;
      _nlMoveDot(_nlGazeX, _nlGazeY);
    }
  };

  _nlNeuralWs.onclose = () => {
    console.log('Neuralook: neural WS closed');
    _nlNeuralWs = null;
  };

  _nlNeuralWs.onerror = (e) => {
    console.warn('Neuralook: neural WS error', e);
  };
}

function _nlCloseNeuralWs() {
  if (_nlNeuralWs) {
    _nlNeuralWs.close();
    _nlNeuralWs = null;
  }
}

// ── Neural Model — Training ──

function _nlCollectEyeSample(screenX, screenY) {
  // Capture eye patches and store as training sample for neural model
  const patches = _nlCaptureEyePatches();
  if (!patches) return;
  _nlTrainingSamples.push({
    left: Array.from(patches.left),
    right: Array.from(patches.right),
    x: screenX / window.innerWidth,   // normalized 0-1
    y: screenY / window.innerHeight
  });
}

function _nlTrainNeuralModel() {
  if (_nlTrainingSamples.length < 4) {
    console.warn('Neuralook: not enough training samples for neural model');
    return;
  }

  _nlConnectNeuralWs();

  const doSend = () => {
    if (!_nlNeuralWs || _nlNeuralWs.readyState !== 1) {
      // Wait for connection
      setTimeout(doSend, 200);
      return;
    }
    _nlNeuralTraining = true;
    const statusEl = document.getElementById('nl-neural-status');
    if (statusEl) {
      statusEl.textContent = 'Training neural model...';
      statusEl.className = 'text-[0.72rem] mt-2 text-yellow-400';
    }
    console.log(`Neuralook: sending ${_nlTrainingSamples.length} samples for training`);
    _nlNeuralWs.send(JSON.stringify({
      type: 'train',
      samples: _nlTrainingSamples
    }));
  };

  // Small delay to ensure WS is ready
  setTimeout(doSend, 300);
}

// ── Neural Model — Inference Loop ──

function _nlStartNeuralInference() {
  _nlStopNeuralInference();
  if (!_nlNeuralReady || !_nlNeuralWs || _nlNeuralWs.readyState !== 1) return;

  _nlNeuralInferInterval = setInterval(() => {
    if (!_nlTracking || !_nlNeuralMode) return;
    if (!_nlNeuralWs || _nlNeuralWs.readyState !== 1) return;

    const patches = _nlCaptureEyePatches();
    if (!patches) return;

    // Pack as 2048-byte binary: left(1024) + right(1024)
    const buf = new Uint8Array(2048);
    buf.set(patches.left, 0);
    buf.set(patches.right, 1024);
    _nlNeuralWs.send(buf.buffer);
  }, 33); // ~30fps
}

function _nlStopNeuralInference() {
  if (_nlNeuralInferInterval) {
    clearInterval(_nlNeuralInferInterval);
    _nlNeuralInferInterval = null;
  }
}

// ── Neural Model — Mode Toggle ──

function _nlSetModelMode(useNeural) {
  _nlNeuralMode = useNeural;
  _nlGazeBuffer = []; // clear smoothing buffer on switch

  if (useNeural) {
    // Pause WebGazer's gaze listener predictions
    if (typeof webgazer !== 'undefined' && typeof webgazer.pause === 'function') {
      webgazer.pause();
    }
    // Start neural inference
    _nlConnectNeuralWs();
    setTimeout(() => _nlStartNeuralInference(), 500);
  } else {
    // Stop neural inference, resume WebGazer
    _nlStopNeuralInference();
    if (_nlTracking && typeof webgazer !== 'undefined' && typeof webgazer.resume === 'function') {
      webgazer.resume();
    }
  }

  _nlRefreshStats();
}
