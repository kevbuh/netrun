// ── Neuralook — Eye Tracking View ──

let _nlCalibrating = false;
let _nlTracking = false;
let _nlGazeDot = null;
let _nlWebgazerReady = false;
let _nlCalibrationPoints = 0;
let _nlGazeX = 0;
let _nlGazeY = 0;
let _nlPreviewStream = null; // camera stream for preview (stopped before webgazer starts)
let _nlCurrentPoint = 0;      // which calibration point (0-8) is active
let _nlClicksOnPoint = 0;     // clicks collected on current point
const _NL_CLICKS_PER_POINT = 5;
let _nlAccuracy = null;        // last accuracy test result in px (null = not tested)

// Smoothing — ring buffer of recent predictions
let _nlGazeBuffer = [];
const _NL_BUFFER_SIZE = 8;

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

  let accuracyHtml = '';
  if (_nlAccuracy !== null) {
    const px = Math.round(_nlAccuracy);
    const label = px < 80 ? 'Good' : px < 150 ? 'Fair' : 'Poor';
    const labelColor = px < 80 ? '#4ade80' : px < 150 ? '#fbbf24' : '#f87171';
    accuracyHtml = `<div class="text-[0.78rem] text-muted mt-2">Accuracy: <strong style="color:${labelColor}">${px}px — ${label}</strong></div>`;
  }

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
        ${accuracyHtml}
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
          <li>Click <strong>Start Calibration</strong> — dots appear one at a time in fullscreen</li>
          <li>Look at each dot and click it 5 times — this gives the model strong training data</li>
          <li>After all 9 points, a quick accuracy test measures tracking quality</li>
          <li>Click <strong>Start Tracking</strong> to show the gaze dot across all views</li>
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
  if (!data) return;
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
  _nlCurrentPoint = 0;
  _nlClicksOnPoint = 0;

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
    _nlCurrentPoint = 0;
    _nlClicksOnPoint = 0;
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

function _nlOnWebgazerFailed(err) {
  console.error('Neuralook: webgazer.begin() failed:', err);
  _nlCalibrating = false;
  _nlShowError('Camera error: ' + (err.message || err) + '. Check browser permissions (camera icon in address bar).');
  renderNeuralookView();
}

// 3x3 calibration grid positions (percentages)
const _NL_CAL_POSITIONS = [
  [10, 10], [50, 10], [90, 10],
  [10, 50], [50, 50], [90, 50],
  [10, 90], [50, 90], [90, 90]
];

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

  document.body.appendChild(overlay);

  // Show the first calibration dot
  _nlCurrentPoint = 0;
  _nlClicksOnPoint = 0;
  _nlShowNextCalibrationDot();
}

function _nlShowNextCalibrationDot() {
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) return;

  // Remove previous dot if any
  const prev = document.getElementById('nl-cal-dot');
  if (prev) prev.remove();

  if (_nlCurrentPoint >= _NL_CAL_POSITIONS.length) {
    // All points done — run accuracy test
    _nlRunAccuracyTest();
    return;
  }

  const [xPct, yPct] = _NL_CAL_POSITIONS[_nlCurrentPoint];
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

  // Fade in
  requestAnimationFrame(() => { wrap.style.opacity = '1'; });
}

function _nlUpdateCalInstr() {
  const instr = document.getElementById('nl-cal-instr');
  if (!instr) return;
  instr.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">Calibration</div>` +
    `<div style="color:#aaa;font-size:0.78rem;">Point ${_nlCurrentPoint + 1}/9 — Click ${_nlClicksOnPoint + 1}/${_NL_CLICKS_PER_POINT}</div>`;
}

function _nlCalibrationClick() {
  _nlClicksOnPoint++;
  _nlCalibrationPoints++;

  // Update progress ring
  const progressCircle = document.getElementById('nl-cal-progress');
  if (progressCircle) {
    const circumference = 2 * Math.PI * 20;
    const offset = circumference * (1 - _nlClicksOnPoint / _NL_CLICKS_PER_POINT);
    progressCircle.setAttribute('stroke-dashoffset', offset.toString());
  }

  _nlUpdateCalInstr();

  if (_nlClicksOnPoint >= _NL_CLICKS_PER_POINT) {
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

// Test positions at 30%/70% — not used during calibration
const _NL_TEST_POSITIONS = [
  [30, 30], [70, 30], [30, 70], [70, 70]
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

function _nlAccuracyTestLoop(idx, distances) {
  if (idx >= _NL_TEST_POSITIONS.length) {
    // Compute average
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

  const result = document.createElement('div');
  result.style.cssText = 'text-align:center;color:#fff;';
  result.innerHTML = `
    <div style="font-size:1.1rem;font-weight:600;margin-bottom:8px;">Calibration Complete</div>
    <div style="font-size:2rem;font-weight:700;color:${labelColor};margin-bottom:4px;">~${px}px</div>
    <div style="font-size:0.85rem;color:${labelColor};font-weight:500;">${label}</div>
    <div style="font-size:0.75rem;color:#888;margin-top:12px;">Average accuracy across 4 test points</div>
  `;
  overlay.appendChild(result);

  // Brief pause then finish
  setTimeout(() => _nlFinishCalibration(), 2500);
}

function _nlFinishCalibration() {
  _nlCalibrating = false;
  _nlAccuracyCollecting = false;

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
