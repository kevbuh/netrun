// ── Neuralook — Eye Tracking View (MediaPipe Iris) ──

let _nlCalibrating = false;
let _nlTracking = false;
let _nlGazeDot = null;
let _nlReady = false;          // MediaPipe model loaded & calibrated
let _nlGazeX = 0;
let _nlGazeY = 0;
let _nlCurrentPoint = 0;
let _nlAccuracy = null;
let _nlCameraOn = false;

// MediaPipe state
let _nlFaceLandmarker = null;
let _nlVideoEl = null;          // shared <video> element for MediaPipe
let _nlMpCdnLoaded = !!(window.FaceLandmarker && window.FilesetResolver); // CDN script loaded
let _nlMpModelLoading = false;  // FaceLandmarker model currently loading
let _nlMpModelReady = false;    // FaceLandmarker model created and ready
let _nlTrackingRAF = null;      // requestAnimationFrame ID

// Listen for CDN load event
window.addEventListener('mediapipe-ready', () => {
  _nlMpCdnLoaded = true;
  // Re-render if on the neuralook view
  if (document.getElementById('neuralook-content')) renderNeuralookView();
});

// Calibration data: array of { irisX, irisY, screenX, screenY }
let _nlCalibData = [];
// Regression coefficients: screenX = ax*irisX + bx*irisY + cx
//                          screenY = ay*irisX + by*irisY + cy
let _nlCoeffs = null;

// Smoothing — ring buffer of recent predictions
let _nlGazeBuffer = [];
const _NL_BUFFER_SIZE = 8;

// Stats
let _nlPredictionCount = 0;
let _nlPredictionsThisSec = 0;
let _nlPredictionRate = 0;
let _nlStatsInterval = null;
let _nlRateInterval = null;

// Time-series history for graphs (rolling window, pushed every 500ms)
const _NL_GRAPH_LEN = 60;
let _nlHistGazeX = [];
let _nlHistGazeY = [];
let _nlHistJitter = [];
let _nlHistRate = [];

// 3x3 calibration grid (9 points), 1 click each
const _NL_CAL_POSITIONS = [
  [15, 15], [50, 15], [85, 15],
  [15, 50], [50, 50], [85, 50],
  [15, 85], [50, 85], [85, 85]
];

// 4 off-grid accuracy test positions
const _NL_TEST_POSITIONS = [
  [30, 30], [70, 30], [30, 70], [70, 70]
];

// Accuracy test state
let _nlAccuracyCollecting = false;
let _nlAccuracyPredictions = [];

async function openNeuralook() {
  hideAllViews();
  const view = await ensureView('neuralook-view');
  if (view) { view.classList.remove('hidden'); view.style.display = ''; }
  window.location.hash = '#neuralook';
  setSidebarActive('sb-neuralook');
  renderNeuralookView();
}

function renderNeuralookView() {
  const container = document.getElementById('neuralook-content');
  if (!container) return;

  const trackingLabel = _nlTracking ? 'Stop Tracking' : 'Start Tracking';
  const statusColor = _nlTracking ? '#4ade80' : _nlReady ? '#fbbf24' : '#6b7280';
  const statusText = _nlTracking ? 'Tracking active' : _nlReady ? 'Ready — not tracking' : 'Not started';

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
              ${_nlCalibrating ? 'Calibrating...' : _nlReady ? 'Recalibrate' : 'Start Calibration'}
            </button>
            <button onclick="_nlToggleTracking()" class="px-4 py-2 rounded-lg border border-border-input text-[0.82rem] font-medium cursor-pointer transition-colors w-full ${_nlTracking ? 'bg-accent text-white border-accent hover:bg-accent-hover' : 'bg-card text-primary hover:border-accent hover:text-accent'}" ${!_nlReady ? 'disabled style="opacity:0.5"' : ''}>
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

        <!-- How it works -->
        <div class="bg-card border border-border-card rounded-xl p-4">
          <h3 class="text-[0.85rem] font-semibold text-primary mb-2">How it works</h3>
          <ol class="text-[0.78rem] text-muted leading-relaxed list-decimal pl-4 space-y-1">
            <li>Click <strong>Start Calibration</strong> — 9-point grid</li>
            <li>Click each dot once (~15 seconds)</li>
            <li>Accuracy test on 4 off-grid points</li>
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

  if (_nlCameraOn) _nlAttachCameraPreview();
  _nlRefreshStats();
  _nlStartStatsInterval();
}

// ── MediaPipe Initialization ──

async function _nlInitMediapipe() {
  if (_nlFaceLandmarker) return true;
  if (!window.FaceLandmarker || !window.FilesetResolver) {
    console.warn('Neuralook: MediaPipe not loaded yet');
    return false;
  }
  try {
    const vision = await window.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'
    );
    _nlFaceLandmarker = await window.FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: false,
      outputFaceBlendshapes: false
    });
    _nlMediapipeLoaded = true;
    return true;
  } catch (e) {
    console.error('Neuralook: MediaPipe init error', e);
    return false;
  }
}

// ── Iris Feature Extraction ──

function _nlExtractIrisFeatures(landmarks) {
  // Iris centers: 468 (left eye), 473 (right eye)
  // Eye corners: 33, 133 (left eye inner/outer), 263, 362 (right eye inner/outer)
  // Lids: 159, 145 (left upper/lower), 386, 374 (right upper/lower)
  const lIris = landmarks[468];
  const rIris = landmarks[473];
  const lInner = landmarks[133];
  const lOuter = landmarks[33];
  const rInner = landmarks[362];
  const rOuter = landmarks[263];

  // Horizontal ratio: where iris sits between inner and outer corners (0=outer, 1=inner)
  const lWidth = Math.sqrt((lInner.x - lOuter.x) ** 2 + (lInner.y - lOuter.y) ** 2);
  const rWidth = Math.sqrt((rInner.x - rOuter.x) ** 2 + (rInner.y - rOuter.y) ** 2);

  const lRatioX = lWidth > 0.001 ? (lIris.x - lOuter.x) / (lInner.x - lOuter.x) : 0.5;
  const rRatioX = rWidth > 0.001 ? (rIris.x - rOuter.x) / (rInner.x - rOuter.x) : 0.5;

  // Vertical ratio: where iris sits between upper and lower lids
  const lUpper = landmarks[159];
  const lLower = landmarks[145];
  const rUpper = landmarks[386];
  const rLower = landmarks[374];

  const lHeight = Math.abs(lLower.y - lUpper.y);
  const rHeight = Math.abs(rLower.y - rUpper.y);

  const lRatioY = lHeight > 0.001 ? (lIris.y - lUpper.y) / (lLower.y - lUpper.y) : 0.5;
  const rRatioY = rHeight > 0.001 ? (rIris.y - rUpper.y) / (rLower.y - rUpper.y) : 0.5;

  // Average both eyes
  return {
    x: (lRatioX + rRatioX) / 2,
    y: (lRatioY + rRatioY) / 2
  };
}

// ── Linear Regression Solver ──
// Solves: screenCoord = a*irisX + b*irisY + c via normal equations

function _nlSolveRegression(data) {
  // data: array of { irisX, irisY, screenX, screenY }
  const n = data.length;
  if (n < 3) return null;

  // Build normal equations for X: [sumXX, sumXY, sumX; sumXY, sumYY, sumY; sumX, sumY, n] * [a,b,c] = [sumX*sx, sumY*sx, sum*sx]
  let sIx = 0, sIy = 0, sIxIx = 0, sIyIy = 0, sIxIy = 0;
  let sIxSx = 0, sIySx = 0, sSx = 0;
  let sIxSy = 0, sIySy = 0, sSy = 0;

  for (const d of data) {
    const ix = d.irisX, iy = d.irisY, sx = d.screenX, sy = d.screenY;
    sIx += ix; sIy += iy;
    sIxIx += ix * ix; sIyIy += iy * iy; sIxIy += ix * iy;
    sIxSx += ix * sx; sIySx += iy * sx; sSx += sx;
    sIxSy += ix * sy; sIySy += iy * sy; sSy += sy;
  }

  // Solve 3x3 system via Cramer's rule
  function solve3x3(a11, a12, a13, a21, a22, a23, a31, a32, a33, b1, b2, b3) {
    const det = a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31);
    if (Math.abs(det) < 1e-12) return null;
    const x = (b1 * (a22 * a33 - a23 * a32) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a32 - a22 * b3)) / det;
    const y = (a11 * (b2 * a33 - a23 * b3) - b1 * (a21 * a33 - a23 * a31) + a13 * (a21 * b3 - b2 * a31)) / det;
    const z = (a11 * (a22 * b3 - b2 * a32) - a12 * (a21 * b3 - b2 * a31) + b1 * (a21 * a32 - a22 * a31)) / det;
    return [x, y, z];
  }

  const cX = solve3x3(sIxIx, sIxIy, sIx, sIxIy, sIyIy, sIy, sIx, sIy, n, sIxSx, sIySx, sSx);
  const cY = solve3x3(sIxIx, sIxIy, sIx, sIxIy, sIyIy, sIy, sIx, sIy, n, sIxSy, sIySy, sSy);

  if (!cX || !cY) return null;
  return { ax: cX[0], bx: cX[1], cx: cX[2], ay: cY[0], by: cY[1], cy: cY[2] };
}

// ── Camera / Video Element ──

function _nlGetVideoElement() {
  if (_nlVideoEl && _nlVideoEl.srcObject) return _nlVideoEl;
  return null;
}

async function _nlEnsureVideo() {
  if (_nlVideoEl && _nlVideoEl.srcObject) return _nlVideoEl;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
  _nlVideoEl = document.createElement('video');
  _nlVideoEl.srcObject = stream;
  _nlVideoEl.autoplay = true;
  _nlVideoEl.muted = true;
  _nlVideoEl.playsInline = true;
  // Wait for video to be ready
  await new Promise(resolve => {
    _nlVideoEl.onloadeddata = resolve;
    // Fallback if already loaded
    if (_nlVideoEl.readyState >= 2) resolve();
  });
  return _nlVideoEl;
}

function _nlStopVideo() {
  if (_nlVideoEl && _nlVideoEl.srcObject) {
    _nlVideoEl.srcObject.getTracks().forEach(t => t.stop());
    _nlVideoEl.srcObject = null;
  }
  _nlVideoEl = null;
}

function _nlAttachCameraPreview() {
  const previewBox = document.getElementById('nl-camera-preview');
  if (!previewBox) return;
  if (previewBox.querySelector('video')) return;

  const vid = _nlGetVideoElement();
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

  // Fallback: grab camera directly for preview
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      const box = document.getElementById('nl-camera-preview');
      if (!box || box.querySelector('video')) { stream.getTracks().forEach(t => t.stop()); return; }
      const placeholder = document.getElementById('nl-camera-placeholder');
      if (placeholder) placeholder.remove();
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
    _nlCameraOn = false;
    // Only stop video if not tracking
    if (!_nlTracking && !_nlCalibrating) _nlStopVideo();
    const box = document.getElementById('nl-camera-preview');
    if (box) {
      const vid = box.querySelector('video');
      if (vid) vid.remove();
      if (!document.getElementById('nl-camera-placeholder')) {
        const ph = document.createElement('span');
        ph.id = 'nl-camera-placeholder';
        ph.className = 'text-dimmer text-[0.75rem]';
        ph.textContent = 'Camera off';
        box.appendChild(ph);
      }
    }
  } else {
    _nlCameraOn = true;
    _nlAttachCameraPreview();
    // If no shared video yet, grab camera directly
    if (!_nlGetVideoElement()) {
      const box = document.getElementById('nl-camera-preview');
      if (box && !box.querySelector('video')) {
        navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
          const b = document.getElementById('nl-camera-preview');
          if (!b || b.querySelector('video')) { stream.getTracks().forEach(t => t.stop()); return; }
          const placeholder = document.getElementById('nl-camera-placeholder');
          if (placeholder) placeholder.remove();
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
  const btn = document.getElementById('nl-camera-toggle');
  if (btn) btn.textContent = _nlCameraOn ? 'Turn Camera Off' : 'Turn Camera On';
}

// ── Calibration ──

function _nlShowError(msg) {
  const el = document.getElementById('nl-error-msg');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

async function _nlStartCalibration() {
  if (_nlCalibrating) return;

  // Check MediaPipe availability
  if (!window.FaceLandmarker || !window.FilesetResolver) {
    _nlShowError('MediaPipe not loaded yet. Wait a moment and try again.');
    return;
  }

  _nlCalibrating = true;
  _nlCalibData = [];
  _nlCoeffs = null;
  _nlReady = false;
  _nlCurrentPoint = 0;
  _nlAccuracy = null;
  _nlPredictionCount = 0;
  _nlGazeBuffer = [];
  renderNeuralookView();

  // Initialize MediaPipe
  const mpOk = await _nlInitMediapipe();
  if (!mpOk) {
    _nlCalibrating = false;
    _nlShowError('Failed to initialize MediaPipe FaceLandmarker.');
    renderNeuralookView();
    return;
  }

  // Ensure camera
  try {
    await _nlEnsureVideo();
    _nlCameraOn = true;
  } catch (e) {
    _nlCalibrating = false;
    _nlShowError('Camera error: ' + (e.message || e) + '. Check browser permissions.');
    renderNeuralookView();
    return;
  }

  // Enter fullscreen
  const el = document.documentElement;
  const reqFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
  if (reqFs) {
    try {
      await reqFs.call(el);
    } catch (e) {
      _nlCalibrating = false;
      _nlShowError('Fullscreen is required for calibration. Please allow fullscreen access.');
      renderNeuralookView();
      return;
    }
    document.addEventListener('fullscreenchange', _nlFullscreenChange);
    document.addEventListener('webkitfullscreenchange', _nlFullscreenChange);
  }

  _nlShowCalibrationOverlay();
  renderNeuralookView();
}

function _nlFullscreenChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFs && _nlCalibrating) {
    _nlCalibrating = false;
    _nlCurrentPoint = 0;
    _nlAccuracyCollecting = false;
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

  const instr = document.createElement('div');
  instr.id = 'nl-cal-instr';
  instr.style.cssText = 'position:absolute;top:30px;left:50%;transform:translateX(-50%);color:#fff;font-size:0.9rem;text-align:center;z-index:100000;pointer-events:none;';
  overlay.appendChild(instr);

  const style = document.createElement('style');
  style.id = 'nl-cal-style';
  style.textContent = `@keyframes nl-pulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.3); } }`;
  document.head.appendChild(style);

  // Progress bar
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

  _nlCurrentPoint = 0;
  _nlShowNextCalibrationDot();
}

function _nlGetIrisFeaturesNow() {
  if (!_nlFaceLandmarker || !_nlVideoEl) return null;
  const result = _nlFaceLandmarker.detectForVideo(_nlVideoEl, performance.now());
  if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) return null;
  return _nlExtractIrisFeatures(result.faceLandmarks[0]);
}

function _nlShowNextCalibrationDot() {
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) return;

  const prev = document.getElementById('nl-cal-dot');
  if (prev) prev.remove();

  if (_nlCurrentPoint >= _NL_CAL_POSITIONS.length) {
    _nlOnCalibrationComplete();
    return;
  }

  const [xPct, yPct] = _NL_CAL_POSITIONS[_nlCurrentPoint];

  // Update instruction
  const instr = document.getElementById('nl-cal-instr');
  if (instr) {
    instr.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">Calibration</div>` +
      `<div style="color:#aaa;font-size:0.78rem;">Point ${_nlCurrentPoint + 1}/${_NL_CAL_POSITIONS.length} — click the dot</div>`;
  }

  // Update progress bar
  const progFill = document.getElementById('nl-cal-progfill');
  if (progFill) {
    progFill.style.width = Math.round((_nlCurrentPoint / _NL_CAL_POSITIONS.length) * 100) + '%';
  }

  // Create dot
  const dot = document.createElement('div');
  dot.id = 'nl-cal-dot';
  Object.assign(dot.style, {
    position: 'absolute',
    left: xPct + '%', top: yPct + '%',
    width: '24px', height: '24px',
    borderRadius: '50%',
    background: 'var(--accent, #b4451a)',
    transform: 'translate(-50%, -50%)',
    cursor: 'pointer',
    zIndex: '100001',
    opacity: '0',
    transition: 'opacity 0.3s',
    animation: 'nl-pulse 1.5s ease-in-out infinite'
  });

  dot.addEventListener('click', () => {
    // Capture iris features at click time
    const iris = _nlGetIrisFeaturesNow();
    if (!iris) {
      // Face not detected — flash the dot red briefly
      dot.style.background = '#f87171';
      setTimeout(() => { dot.style.background = 'var(--accent, #b4451a)'; }, 300);
      return;
    }

    const screenX = window.innerWidth * xPct / 100;
    const screenY = window.innerHeight * yPct / 100;
    _nlCalibData.push({ irisX: iris.x, irisY: iris.y, screenX, screenY });

    // Fade out and next
    dot.style.opacity = '0';
    dot.style.pointerEvents = 'none';
    _nlCurrentPoint++;
    setTimeout(_nlShowNextCalibrationDot, 300);
  });

  overlay.appendChild(dot);
  // Small delay before showing dot (let user's eyes settle)
  setTimeout(() => { dot.style.opacity = '1'; }, 200);
}

function _nlOnCalibrationComplete() {
  // Solve regression
  _nlCoeffs = _nlSolveRegression(_nlCalibData);
  if (!_nlCoeffs) {
    _nlFinishCalibration();
    _nlShowError('Regression failed — not enough valid data. Try again.');
    return;
  }

  // Run accuracy test
  _nlRunAccuracyTest();
}

// ── Post-calibration accuracy test ──

function _nlRunAccuracyTest() {
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) { _nlFinishCalibration(); return; }

  const dot = document.getElementById('nl-cal-dot');
  if (dot) dot.remove();

  const instr = document.getElementById('nl-cal-instr');
  if (instr) {
    instr.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Accuracy Test</div>' +
      '<div style="color:#aaa;font-size:0.78rem;">Look at each dot — measuring accuracy...</div>';
  }

  _nlAccuracyTestLoop(0, []);
}

function _nlAccuracyTestLoop(idx, distances) {
  if (idx >= _NL_TEST_POSITIONS.length) {
    const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
    _nlAccuracy = avg;
    _nlShowAccuracyResult(avg);
    return;
  }

  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) { _nlFinishCalibration(); return; }

  const [xPct, yPct] = _NL_TEST_POSITIONS[idx];
  const targetX = window.innerWidth * xPct / 100;
  const targetY = window.innerHeight * yPct / 100;

  // Show test dot
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

  const instr = document.getElementById('nl-cal-instr');
  if (instr) {
    instr.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Accuracy Test</div>' +
      `<div style="color:#aaa;font-size:0.78rem;">Point ${idx + 1}/${_NL_TEST_POSITIONS.length} — look at the dot</div>`;
  }

  // Collect predictions for 1.5 seconds
  const predictions = [];
  let collectRAF = null;
  const startTime = performance.now();

  function collect() {
    if (performance.now() - startTime > 1500) {
      // Done collecting
      testDot.style.opacity = '0';

      let dist = Infinity;
      if (predictions.length > 0) {
        let sx = 0, sy = 0;
        for (const p of predictions) { sx += p.x; sy += p.y; }
        const avgX = sx / predictions.length;
        const avgY = sy / predictions.length;
        dist = Math.sqrt((avgX - targetX) ** 2 + (avgY - targetY) ** 2);
      }
      distances.push(dist);

      setTimeout(() => {
        testDot.remove();
        _nlAccuracyTestLoop(idx + 1, distances);
      }, 300);
      return;
    }

    // Get current iris prediction
    const iris = _nlGetIrisFeaturesNow();
    if (iris && _nlCoeffs) {
      const px = _nlCoeffs.ax * iris.x + _nlCoeffs.bx * iris.y + _nlCoeffs.cx;
      const py = _nlCoeffs.ay * iris.x + _nlCoeffs.by * iris.y + _nlCoeffs.cy;
      predictions.push({ x: px, y: py });
    }

    collectRAF = requestAnimationFrame(collect);
  }

  // Wait a moment for eyes to settle, then start collecting
  setTimeout(() => { collectRAF = requestAnimationFrame(collect); }, 500);
}

function _nlShowAccuracyResult(avgPx) {
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) { _nlFinishCalibration(); return; }

  const px = Math.round(avgPx);
  const label = px < 80 ? 'Good' : px < 150 ? 'Fair' : 'Poor';
  const labelColor = px < 80 ? '#4ade80' : px < 150 ? '#fbbf24' : '#f87171';

  const instr = document.getElementById('nl-cal-instr');
  if (instr) instr.remove();
  const testDot = document.getElementById('nl-test-dot');
  if (testDot) testDot.remove();

  const result = document.createElement('div');
  result.id = 'nl-accuracy-result';
  result.style.cssText = 'text-align:center;color:#fff;';
  result.innerHTML = `
    <div style="font-size:1.1rem;font-weight:600;margin-bottom:8px;">Calibration Complete</div>
    <div style="font-size:2rem;font-weight:700;color:${labelColor};margin-bottom:4px;">~${px}px</div>
    <div style="font-size:0.85rem;color:${labelColor};font-weight:500;">${label}</div>
    <div style="font-size:0.75rem;color:#888;margin-top:12px;">Average accuracy across ${_NL_TEST_POSITIONS.length} test points</div>
  `;
  overlay.appendChild(result);

  _nlReady = true;
  setTimeout(() => _nlFinishCalibration(), 2500);
}

function _nlFinishCalibration() {
  _nlCalibrating = false;
  _nlAccuracyCollecting = false;

  const overlay = document.getElementById('nl-calibration-overlay');
  if (overlay) overlay.remove();
  const style = document.getElementById('nl-cal-style');
  if (style) style.remove();

  const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
  if (exitFs && (document.fullscreenElement || document.webkitFullscreenElement)) {
    exitFs.call(document);
  }

  renderNeuralookView();
}

// ── Tracking Loop ──

function _nlTrackingLoop() {
  if (!_nlTracking || !_nlFaceLandmarker || !_nlVideoEl) {
    _nlTrackingRAF = null;
    return;
  }

  const iris = _nlGetIrisFeaturesNow();
  if (iris && _nlCoeffs) {
    const px = _nlCoeffs.ax * iris.x + _nlCoeffs.bx * iris.y + _nlCoeffs.cx;
    const py = _nlCoeffs.ay * iris.x + _nlCoeffs.by * iris.y + _nlCoeffs.cy;

    _nlPredictionCount++;
    _nlPredictionsThisSec++;

    // Ring buffer smoothing
    _nlGazeBuffer.push({ x: px, y: py });
    if (_nlGazeBuffer.length > _NL_BUFFER_SIZE) _nlGazeBuffer.shift();
    let sx = 0, sy = 0;
    for (const p of _nlGazeBuffer) { sx += p.x; sy += p.y; }
    _nlGazeX = sx / _nlGazeBuffer.length;
    _nlGazeY = sy / _nlGazeBuffer.length;
    _nlMoveDot(_nlGazeX, _nlGazeY);
  }

  _nlTrackingRAF = requestAnimationFrame(_nlTrackingLoop);
}

// ── Tracking Toggle ──

function _nlToggleTracking() {
  if (_nlTracking) {
    _nlStopTracking();
  } else {
    _nlStartTracking();
  }
}

async function _nlStartTracking() {
  if (!_nlReady || !_nlCoeffs) return;

  // Ensure video and mediapipe
  try {
    await _nlEnsureVideo();
  } catch (e) {
    _nlShowError('Camera error: ' + (e.message || e));
    return;
  }

  _nlTracking = true;
  _nlGazeBuffer = [];
  _nlCreateDot();
  _nlTrackingRAF = requestAnimationFrame(_nlTrackingLoop);
  renderNeuralookView();
}

function _nlStopTracking() {
  _nlTracking = false;
  if (_nlTrackingRAF) { cancelAnimationFrame(_nlTrackingRAF); _nlTrackingRAF = null; }
  _nlRemoveDot();
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
  _nlStatsInterval = setInterval(() => {
    const el = document.getElementById('nl-model-stats');
    if (!el) { _nlStopStatsInterval(); return; }
    _nlRefreshStats();
  }, 500);
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

  const accPx = _nlAccuracy !== null ? Math.round(_nlAccuracy) : null;
  const accLabel = accPx !== null ? (accPx < 80 ? 'Good' : accPx < 150 ? 'Fair' : 'Poor') : null;
  const accColor = accPx !== null ? (accPx < 80 ? '#4ade80' : accPx < 150 ? '#fbbf24' : '#f87171') : '#6b7280';
  const jitter = _nlTracking ? Math.round(_nlComputeJitter()) : null;
  const jitterColor = jitter !== null ? (jitter < 30 ? '#4ade80' : jitter < 70 ? '#fbbf24' : '#f87171') : '#6b7280';

  const row = (label, value, color) =>
    `<div class="text-muted">${label}</div><div class="text-primary font-medium tabular-nums" ${color ? `style="color:${color}"` : ''}>${value}</div>`;

  el.innerHTML =
    row('Model', 'MediaPipe Iris') +
    row('Calibration points', `${_nlCalibData.length} / ${_NL_CAL_POSITIONS.length}`) +
    row('Regression', _nlCoeffs ? '<span style="color:#4ade80">Fitted</span>' : '<span class="text-dimmer">Not fitted</span>') +
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

  const gxv = document.getElementById('nl-graph-gaze-x-val');
  const gyv = document.getElementById('nl-graph-gaze-y-val');
  const jv = document.getElementById('nl-graph-jitter-val');
  const rv = document.getElementById('nl-graph-rate-val');
  if (gxv) gxv.textContent = _nlTracking ? Math.round(_nlGazeX) + 'px' : '—';
  if (gyv) gyv.textContent = _nlTracking ? Math.round(_nlGazeY) + 'px' : '—';
  if (jv) jv.textContent = jitter !== null ? jitter + 'px' : '—';
  if (rv) rv.textContent = _nlPredictionRate + ' Hz';

  _nlDrawGraph('nl-graph-gaze-x', _nlHistGazeX, '#60a5fa', 0, window.innerWidth);
  _nlDrawGraph('nl-graph-gaze-y', _nlHistGazeY, '#a78bfa', 0, window.innerHeight);
  _nlDrawGraph('nl-graph-jitter', _nlHistJitter, '#fbbf24', 0, 150);
  _nlDrawGraph('nl-graph-rate', _nlHistRate, '#4ade80', 0, null);
}

function _nlDrawGraph(canvasId, data, color, fixedMin, fixedMax) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

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

  const valid = data.filter(v => v !== null);
  if (valid.length < 2) {
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

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = dpr;
  for (let i = 1; i < 4; i++) {
    const gy = pad + (h - 2 * pad) * (i / 4);
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

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
