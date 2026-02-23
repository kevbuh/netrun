// nl-tracking.js — Calibration flow, gaze tracking loop, implicit click collection, auto-refine, gaze dot

import { _nl, _NL_BUFFER_SIZE, _NL_CAL_POSITIONS, _NL_STARE_MS, _NL_SETTLE_MS, _NL_EYE_W, _NL_EYE_H, _NL_HEATMAP_COLS, _NL_HEATMAP_ROWS, _nlUpdatePillIndicator, _nlModelLabel, _nlCheckGazeMasterAchievement } from '/js/neuralook/nl-state.js';
import { _nlInitMediapipe, _nlCaptureEyeCrops, _nlEnsureVideo, _nlStopVideo, _nlAttachCameraPreview } from '/js/neuralook/nl-capture.js';
import { _nlTrainOnServerSSE, _nlPredictOnServer, _nlShowTrainPill, _nlUpdateTrainPill, _nlFinishTrainPill, _nlErrorTrainPill, _nlDismissTrainPill, _nlAppendTrainLog } from '/js/neuralook/nl-training.js';
import Settings from '/js/core/core-settings.js';
import { apiPost, apiGet } from '/js/api.js';
import { icon } from '/js/core/icons.js';
import { islandUpdate, islandRemove, pillStackAdd, pillStackRemove } from '/js/core/core-ui.js';
import { logger } from '/js/logger.js';

// ── Calibration ──

export function _nlShowError(msg) {
  const el = document.getElementById('nl-error-msg');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

export async function _nlStartCalibration() {
  if (_nl.calibrating) return;

  _nl.calibrating = true;
  _nlUpdatePillIndicator();
  _nl.calibData = [];
  _nl.modelTrained = false;
  _nl.ready = false;
  _nl.currentPoint = 0;
  _nl.predictionCount = 0;
  _nl.trainError = null;
  _nl.valError = null;
  _nl.gazeBuffer = [];
  window.renderNeuralookView();

  const mpOk = await _nlInitMediapipe();
  if (!mpOk) {
    _nl.calibrating = false;
    _nlUpdatePillIndicator();
    _nlShowError(_nl.mpCdnLoaded ? 'Failed to initialize face model.' : 'MediaPipe CDN failed to load.');
    window.renderNeuralookView();
    return;
  }

  try {
    await _nlEnsureVideo();
    _nl.cameraOn = true;
    _nlUpdatePillIndicator();
  } catch (e) {
    _nl.calibrating = false;
    _nlUpdatePillIndicator();
    _nlShowError('Camera error: ' + (e.message || e));
    window.renderNeuralookView();
    return;
  }

  // Enter fullscreen
  const el = document.documentElement;
  const reqFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
  if (reqFs) {
    try { await reqFs.call(el); } catch (e) {
      _nl.calibrating = false;
      _nlUpdatePillIndicator();
      _nlShowError('Fullscreen required for calibration.');
      window.renderNeuralookView();
      return;
    }
    document.addEventListener('fullscreenchange', _nlFullscreenChange);
    document.addEventListener('webkitfullscreenchange', _nlFullscreenChange);
  }

  _nlShowCalibrationOverlay();
  window.renderNeuralookView();
}

export function _nlFullscreenChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFs && _nl.calibrating) {
    _nl.calibrating = false;
    _nlUpdatePillIndicator();
    _nl.currentPoint = 0;
    const overlay = document.getElementById('nl-calibration-overlay');
    if (overlay) overlay.remove();
    window.renderNeuralookView();
  }
  if (!isFs) {
    document.removeEventListener('fullscreenchange', _nlFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', _nlFullscreenChange);
  }
}

export function _nlShowCalibrationOverlay() {
  const existing = document.getElementById('nl-calibration-overlay');
  if (existing) existing.remove();

  // Blank background so calibration dots are clearly visible
  const overlayView = new window.View('div').attr('id', 'nl-calibration-overlay');
  overlayView.styles({
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    background: 'var(--nr-bg-body, #0a0a0a)', zIndex: '99999',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
  });
  const overlay = overlayView.el;

  const instrView = new window.View('div').attr('id', 'nl-cal-instr');
  instrView.cssText('position:absolute;top:30px;left:50%;transform:translateX(-50%);font-size:0.9rem;text-align:center;z-index:100000;pointer-events:none;background:rgba(0,0,0,0.7);color:#fff;padding:8px 16px;border-radius:8px;');
  overlay.append(instrView.el);

  // Camera preview in bottom-right corner
  if (_nl.videoEl && _nl.videoEl.srcObject) {
    const camBoxView = new window.View('div');
    camBoxView.styles({
      position: 'absolute', bottom: '50px', right: '24px', width: '180px', height: '135px',
      borderRadius: '10px', overflow: 'hidden', zIndex: '100000',
      border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 4px 16px rgba(0,0,0,0.5)'
    });
    const camBox = camBoxView.el;
    const camVidView = new View('video').styles({ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' });
    const camVid = camVidView.el;
    camVid.srcObject = _nl.videoEl.srcObject;
    camVid.autoplay = true;
    camVid.muted = true;
    camVid.playsInline = true;
    camBox.append(camVid);
    overlay.append(camBox);
  }

  // Progress bar
  const progBarView = new window.View('div').attr('id', 'nl-cal-progbar');
  progBarView.styles({
    position: 'absolute', bottom: '24px', left: '10%', width: '80%', height: '4px',
    background: 'rgba(255,255,255,0.2)', borderRadius: '2px', zIndex: '100000'
  });
  const progFillView = new window.View('div').attr('id', 'nl-cal-progfill');
  progFillView.styles({
    width: '0%', height: '100%', background: 'var(--nr-accent, #b4451a)',
    borderRadius: '2px', transition: 'width 0.3s'
  });
  progBarView.add(progFillView);
  overlay.append(progBarView.el);

  document.body.append(overlay);
  _nl.currentPoint = 0;
  _nlShowNextCalibrationDot();
}

export function _nlShowNextCalibrationDot() {
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) return;

  const prev = document.getElementById('nl-cal-dot');
  if (prev) prev.remove();
  const prevRing = document.getElementById('nl-cal-ring');
  if (prevRing) prevRing.remove();

  if (_nl.currentPoint >= _NL_CAL_POSITIONS.length) {
    _nlOnCalibrationComplete();
    return;
  }

  const [xPct, yPct] = _NL_CAL_POSITIONS[_nl.currentPoint];

  const instr = document.getElementById('nl-cal-instr');
  if (instr) {
    AetherUI.mount(RawHTML(`<strong>Calibration</strong> &mdash; Point ${_nl.currentPoint + 1}/${_NL_CAL_POSITIONS.length}, look at the dot`), instr);
  }

  const progFill = document.getElementById('nl-cal-progfill');
  if (progFill) progFill.style.width = Math.round((_nl.currentPoint / _NL_CAL_POSITIONS.length) * 100) + '%';

  // Dot with outline for visibility on any background
  const dotView = new window.View('div').attr('id', 'nl-cal-dot');
  dotView.styles({
    position: 'absolute', left: xPct + '%', top: yPct + '%',
    width: '20px', height: '20px', borderRadius: '50%',
    background: 'var(--nr-accent, #b4451a)',
    border: '2px solid #fff',
    boxShadow: '0 0 8px rgba(0,0,0,0.5)',
    transform: 'translate(-50%, -50%)',
    zIndex: '100001', opacity: '0', transition: 'opacity 0.3s'
  });
  const dot = dotView.el;

  // Shrinking ring
  const ringView = new window.View('div').attr('id', 'nl-cal-ring').styles({
    position: 'absolute', left: xPct + '%', top: yPct + '%',
    width: '44px', height: '44px', borderRadius: '50%',
    border: '2px solid var(--nr-accent, #b4451a)',
    transform: 'translate(-50%, -50%) scale(1)',
    zIndex: '100001', opacity: '0',
    transition: `opacity 0.3s, transform ${_NL_STARE_MS}ms linear`
  });

  const ring = ringView.el;
  overlay.append(ring);
  overlay.append(dot);

  const screenX = window.innerWidth * xPct / 100;
  const screenY = window.innerHeight * yPct / 100;

  requestAnimationFrame(() => { dot.style.opacity = '1'; ring.style.opacity = '0.6'; });

  setTimeout(() => {
    ring.style.transform = 'translate(-50%, -50%) scale(0)';

    const startTime = performance.now();
    function collect() {
      const elapsed = performance.now() - startTime;
      if (elapsed > _NL_STARE_MS) {
        dot.style.opacity = '0';
        ring.style.opacity = '0';
        _nl.currentPoint++;
        setTimeout(() => { dot.remove(); ring.remove(); _nlShowNextCalibrationDot(); }, 80);
        return;
      }

      const capture = _nlCaptureEyeCrops();
      if (capture) {
        _nl.calibData.push({ eyeData: capture.eyeData, headPose: capture.headPose, irisFeatures: capture.irisFeatures, screenX, screenY });
      }
      requestAnimationFrame(collect);
    }
    requestAnimationFrame(collect);
  }, _NL_SETTLE_MS);
}

export async function _nlOnCalibrationComplete() {
  _nlFinishCalibration();

  // Save calibration data to server
  try {
    const calibPayload = {
      samples: _nl.calibData.map(s => ({
        eyeData: Array.from(s.eyeData),
        headPose: s.headPose,
        irisFeatures: s.irisFeatures,
        screenX: s.screenX, screenY: s.screenY
      })),
      screenW: window.innerWidth, screenH: window.innerHeight,
      eyeW: _NL_EYE_W, eyeH: _NL_EYE_H
    };
    await apiPost('/api/neuralook/save-calibration', calibPayload);
    _nl.calibSaved = true;
  } catch (e) { logger.warn('Neuralook: failed to save calibration', e); }

  _nl.training = true;
  _nlUpdatePillIndicator();
  _nl.trainPhase = 'training';
  _nl.trainProgress = null;
  _nl.trainResult = null;
  _nl.trainLossHistory = [];
  _nl.trainLogs = [];
  _nl.trainStartTime = Date.now();
  _nl.showTrainView = true;
  _nlShowTrainPill();
  window.renderNeuralookView();

  try {
    const result = await _nlTrainOnServerSSE((prog) => {
      _nl.trainProgress = prog;
      _nl.trainPhase = prog.phase || 'training';
      if (prog.val_loss != null) _nl.trainLossHistory.push({ epoch: prog.epoch, val_loss: prog.val_loss, train_loss: prog.train_loss });
      if (prog.model_ready && !_nl.modelTrained) {
        _nl.modelTrained = true;
        _nl.ready = true;
        _nl.trainLogs.push('\u2713 Model ready \u2014 tracking available');
        _nlAppendTrainLog('\u2713 Model ready \u2014 tracking available');
      }
      if (prog.phase === 'evaluating') {
        _nlUpdateTrainPill('Training ' + _nlModelLabel() + ' v' + (_nl.modelVersion + 1), 'Evaluating...');
      } else {
        const pct = Math.round((prog.epoch / prog.max_epochs) * 100);
        const loss = prog.val_loss != null ? ` \u00b7 loss ${prog.val_loss.toFixed(4)}` : '';
        const eta = window._nlTrainETA(prog.epoch, prog.max_epochs);
        _nlUpdateTrainPill('Training ' + _nlModelLabel() + ' v' + (_nl.modelVersion + 1), `Epoch ${prog.epoch}/${prog.max_epochs} (${pct}%)${loss}${eta}`);
      }
      window._nlRefreshTrainView();
      window._nlRefreshBanner();
    }, (logLine) => {
      _nl.trainLogs.push(logLine);
      _nlAppendTrainLog(logLine);
    });

    _nl.trainResult = result;
    _nl.trainPhase = 'done';
    _nl.training = false;
    _nlUpdatePillIndicator();
    _nl.ready = true;
    _nl.modelVersion++;
    _nlCheckGazeMasterAchievement();

    const valPx = result.val_error_px;
    _nl.baselineValError = valPx;
    _nlUpdateAdaptiveRadius(valPx);
    const label = valPx < 80 ? 'Good' : valPx < 150 ? 'Fair' : 'Poor';
    const color = valPx < 80 ? '#4ade80' : valPx < 150 ? '#fbbf24' : '#f87171';
    _nlFinishTrainPill('Training Done \u2014 v' + _nl.modelVersion, `Val ${valPx}px \u2014 ${label}`, color);
    _nlShowModelUpdatedPill(_nl.modelVersion, valPx);
    window._nlRefreshTrainView();
    window.renderNeuralookView();
  } catch (e) {
    _nl.trainPhase = 'error';
    _nl.training = false;
    _nlUpdatePillIndicator();
    _nl.trainResult = { error: e.message || String(e) };
    _nlErrorTrainPill(e.message || String(e));
    window._nlRefreshTrainView();
    window.renderNeuralookView();
  }
}

export function _nlFinishCalibration() {
  _nl.calibrating = false;
  _nlUpdatePillIndicator();
  const overlay = document.getElementById('nl-calibration-overlay');
  if (overlay) overlay.remove();

  const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
  if (exitFs && (document.fullscreenElement || document.webkitFullscreenElement)) exitFs.call(document);
  window.renderNeuralookView();
}

// ── Shared prediction → gaze smoothing ──

export function _nlApplyGazePrediction(pred) {
  _nl.gazeBuffer.push(pred);
  if (_nl.gazeBuffer.length > _NL_BUFFER_SIZE) _nl.gazeBuffer.shift();
  let sx = 0, sy = 0;
  for (const p of _nl.gazeBuffer) { sx += p.x; sy += p.y; }
  _nl.gazeX = sx / _nl.gazeBuffer.length;
  _nl.gazeY = sy / _nl.gazeBuffer.length;
  _nlMoveDot(_nl.gazeX, _nl.gazeY);
  _nl.sessionPredictions++;
  window._nlUpdateHeatmap(_nl.gazeX, _nl.gazeY);
  window._nlDetectFixation(_nl.gazeX, _nl.gazeY, Date.now());
}

// ── Tracking Loop ──

export function _nlTrackingLoop() {
  if (!_nl.tracking || !_nl.faceLandmarker || !_nl.videoEl) {
    _nl.trackingRAF = null;
    return;
  }

  if (!_nl.inferPending) {
    const capture = _nlCaptureEyeCrops();
    if (capture) {
      _nl.lastCapture = { ...capture, ts: performance.now() };
      _nl.inferPending = true;
      _nlPredictOnServer(capture.eyeData, capture.headPose, capture.irisFeatures).then(pred => {
        _nl.inferPending = false;
        if (!pred || !_nl.tracking) return;
        _nl.lastPrediction = { ...pred, ts: performance.now() };
        _nl.predictionCount++;
        _nl.predictionsThisSec++;
        _nlApplyGazePrediction(pred);
      }).catch(() => { _nl.inferPending = false; });
    }
  }

  _nl.trackingRAF = requestAnimationFrame(_nlTrackingLoop);
}

export function _nlToggleTracking() {
  if (_nl.tracking) _nlStopTracking();
  else _nlStartTracking();
}

export async function _nlStartTracking() {
  if (!_nl.ready || !_nl.modelTrained) return;
  try { await _nlEnsureVideo(); } catch (e) {
    _nlShowError('Camera error: ' + (e.message || e));
    return;
  }
  // Reset LSTM hidden state for fresh tracking session
  apiPost('/api/neuralook/reset-hidden', { method: _nl.modelType }).catch(e => logger.warn('[neuralook] Reset hidden state failed:', e));
  _nl.tracking = true;
  _nlResetSessionStats();
  _nlUpdatePillIndicator();
  _nl.gazeBuffer = [];
  _nlCreateDot();
  _nl.trackingRAF = requestAnimationFrame(_nlTrackingLoop);
  // Start collecting implicit click samples (each click triggers flush + refine)
  document.addEventListener('click', _nlHandleImplicitClick, true);
  // Safety-net timed buffer flush (30s) in case clicks don't trigger flush
  _nl.timedFlushInterval = setInterval(() => {
    if (_nl.implicitBuffer.length > 0) _nlFlushImplicitSamples();
  }, 30000);
  _nlFetchImplicitCount();
  _nlLoadRefinementHistory();
  window.renderNeuralookView();
}

export function _nlStopTracking() {
  _nl.tracking = false;
  _nlUpdatePillIndicator();
  if (_nl.trackingRAF) { cancelAnimationFrame(_nl.trackingRAF); _nl.trackingRAF = null; }
  document.removeEventListener('click', _nlHandleImplicitClick, true);
  // Clear timed flush interval
  if (_nl.timedFlushInterval) { clearInterval(_nl.timedFlushInterval); _nl.timedFlushInterval = null; }
  // Flush remaining implicit samples
  if (_nl.implicitBuffer.length > 0) _nlFlushImplicitSamples();
  _nlRemoveDot();
  // Also turn off camera
  if (_nl.cameraOn) { _nl.cameraOn = false; _nlStopVideo(); }
  window.renderNeuralookView();
}

export function _nlHandleImplicitClick(e) {
  if (!_nl.tracking || !_nl.lastCapture || !_nl.lastPrediction) return;
  // Freshness: prediction must be < 500ms old
  const now = performance.now();
  const age = Math.round(now - _nl.lastPrediction.ts);
  if (age > 500) {
    logger.debug(`neuralook click rejected: prediction too old (${age}ms)`);
    _nlShowClickFeedback(e.clientX, e.clientY, false, `stale ${age}ms`);
    return;
  }
  const dx = _nl.lastPrediction.x - e.clientX;
  const dy = _nl.lastPrediction.y - e.clientY;
  const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
  logger.debug(`neuralook implicit click collected \u2014 dist=${dist}px, age=${age}ms, buffer=${_nl.implicitBuffer.length + 1}`);
  _nlShowClickFeedback(e.clientX, e.clientY, true, `${dist}px`);
  _nl.implicitBuffer.push({
    eyeData: Array.from(_nl.lastCapture.eyeData),
    headPose: _nl.lastCapture.headPose,
    irisFeatures: _nl.lastCapture.irisFeatures,
    screenX: e.clientX,
    screenY: e.clientY
  });
  // Flush and trigger refine immediately on every click
  _nlFlushImplicitSamples().then(() => _nlCheckAutoRefine());
}

export function _nlHandleIframeClick(x, y) {
  if (!_nl.tracking || !_nl.lastCapture || !_nl.lastPrediction) return;
  const now = performance.now();
  const age = Math.round(now - _nl.lastPrediction.ts);
  if (age > 500) {
    logger.debug(`neuralook iframe click rejected: prediction too old (${age}ms)`);
    _nlShowClickFeedback(x, y, false, `stale ${age}ms`);
    return;
  }
  const dx = _nl.lastPrediction.x - x;
  const dy = _nl.lastPrediction.y - y;
  const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
  logger.debug(`neuralook iframe implicit click collected \u2014 dist=${dist}px, age=${age}ms, buffer=${_nl.implicitBuffer.length + 1}`);
  _nlShowClickFeedback(x, y, true, `${dist}px`);
  _nl.implicitBuffer.push({
    eyeData: Array.from(_nl.lastCapture.eyeData),
    headPose: _nl.lastCapture.headPose,
    irisFeatures: _nl.lastCapture.irisFeatures,
    screenX: x,
    screenY: y
  });
  _nlFlushImplicitSamples().then(() => _nlCheckAutoRefine());
}

export function _nlFlushImplicitSamples() {
  if (_nl.implicitBuffer.length === 0) return Promise.resolve();
  const samples = _nl.implicitBuffer.splice(0);
  _nl.implicitLastFlush = Date.now();
  return apiPost('/api/neuralook/implicit-samples', { samples }).then(data => {
    if (data.count != null) _nl.implicitCount = data.count;
  }).catch(e => logger.warn('[neuralook] Flush implicit samples failed:', e));
}

export function _nlFetchImplicitCount() {
  apiGet('/api/neuralook/implicit-samples')
    .then(data => { if (data.count != null) _nl.implicitCount = data.count; })
    .catch(e => logger.warn('[neuralook] Fetch implicit count failed:', e));
}

// ── Click Feedback Indicators ──

export function _nlShowClickFeedback(x, y, accepted, detail) {
  const color = accepted ? '#4ade80' : '#f87171';
  const elView = new window.View('div');
  elView.styles({
    position: 'fixed', left: (x + 12) + 'px', top: (y - 8) + 'px', zIndex: '99999',
    pointerEvents: 'none', fontSize: '0.65rem', fontFamily: 'inherit', fontWeight: '600',
    color: color, whiteSpace: 'nowrap', lineHeight: '1',
    opacity: '0'
  });
  const el = elView.el;
  el.textContent = accepted ? '+' + detail : detail;
  document.body.append(el);
  Motion.fadeOut(el, { y: -16, duration: 800, spring: 'gentle', remove: true });
}

export function _nlShowModelUpdatedPill(version, valErrorPx) {
  const existing = document.getElementById('nl-model-updated-pill');
  if (existing) { pillStackRemove('nl-model-updated-pill'); existing.remove(); }
  const pillView = new window.View('div').attr('id', 'nl-model-updated-pill');
  pillView.styles({
    position: 'fixed', right: '20px', zIndex: '99999',
    background: 'var(--nr-bg-surface, #23232a)', border: '1px solid #60a5fa',
    borderRadius: '14px', padding: '10px 16px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(96,165,250,0.15)',
    fontFamily: 'inherit', fontSize: '0.78rem', color: 'var(--nr-text-primary, #e5e5e5)',
    opacity: '0',
    display: 'flex', alignItems: 'center', gap: '10px',
    cursor: 'pointer'
  });
  const pill = pillView.el;
  if (window.Aether && Aether.materials) Aether.materials.apply(pill, 'regular');
  else { pill.style.backdropFilter = 'blur(12px)'; pill.style.WebkitBackdropFilter = 'blur(12px)'; }

  const updatedSvg = '<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#60a5fa"/><path d="M9 5v4l3 2" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const svgView = RawHTML(updatedSvg);
  const textDiv = window.VStack(
    window.Text('Tracking model updated to v' + version).cssText('font-weight:600;font-size:0.8rem;'),
    window.Text('Val error: ' + valErrorPx + 'px').cssText('font-size:0.7rem;color:var(--text-secondary,#888);')
  ).cssText('line-height:1.4;');
  pillView.add(svgView, textDiv);
  pillView.onTap(function() { if (typeof openNeuralook === 'function') openNeuralook(); pillStackRemove('nl-model-updated-pill'); pill.remove(); });
  document.body.append(pill);
  pillStackAdd('nl-model-updated-pill');
  Motion.fadeIn(pill, { y: 10 });
  pill.animate([
    { boxShadow: '0 0 0 0 rgba(96,165,250,0.4)', transform: 'translateY(0) scale(1)' },
    { boxShadow: '0 0 20px 8px rgba(96,165,250,0.25)', transform: 'translateY(-2px) scale(1.03)' },
    { boxShadow: '0 0 0 0 rgba(96,165,250,0)', transform: 'translateY(0) scale(1)' }
  ], { duration: 600, iterations: 2, easing: 'ease-in-out' });
  setTimeout(() => {
    Motion.fadeOut(pill, { y: 10, onFinish: function() { pillStackRemove('nl-model-updated-pill'); pill.remove(); } });
  }, 5000);
}

// ── Auto-Refine (Continuous Passive Learning) ──

export function _nlCheckAutoRefine() {
  if (!_nl.tracking || !_nl.modelTrained || _nl.training || _nl.autoRefineInProgress || !_nl.autoRefineEnabled) return;
  _nlStartAutoRefine();
}

export async function _nlStartAutoRefine() {
  _nl.autoRefineInProgress = true;
  window._nlRefreshStats();
  // Flush pending buffer first
  if (_nl.implicitBuffer.length > 0) {
    const samples = _nl.implicitBuffer.splice(0);
    _nl.implicitLastFlush = Date.now();
    try {
      const data = await apiPost('/api/neuralook/implicit-samples', { samples });
      if (data.count != null) _nl.implicitCount = data.count;
    } catch (_) {}
  }
  // Use the full SSE training flow with refine=true (shows training detail view)
  _nl.training = true;
  _nlUpdatePillIndicator();
  _nl.trainPhase = 'training';
  _nl.trainProgress = null;
  _nl.trainResult = null;
  _nl.trainLossHistory = [];
  _nl.trainLogs = [];
  _nl.trainStartTime = Date.now();
  _nl.showTrainView = true;
  _nlShowTrainPill();
  if (window.location.hash === '#neuralook') window.renderNeuralookView();

  try {
    const result = await _nlTrainOnServerSSE((prog) => {
      _nl.trainProgress = prog;
      _nl.trainPhase = prog.phase || 'training';
      if (prog.val_loss != null) _nl.trainLossHistory.push({ epoch: prog.epoch, val_loss: prog.val_loss, train_loss: prog.train_loss });
      if (prog.phase === 'evaluating') {
        _nlUpdateTrainPill('Refining ' + _nlModelLabel() + ' v' + (_nl.modelVersion + 1), 'Evaluating...');
      } else {
        const pct = Math.round((prog.epoch / prog.max_epochs) * 100);
        const loss = prog.val_loss != null ? ` \u00b7 loss ${prog.val_loss.toFixed(4)}` : '';
        const eta = window._nlTrainETA(prog.epoch, prog.max_epochs);
        _nlUpdateTrainPill('Refining ' + _nlModelLabel() + ' v' + (_nl.modelVersion + 1), `Epoch ${prog.epoch}/${prog.max_epochs} (${pct}%)${loss}${eta}`);
      }
      window._nlRefreshTrainView();
      window._nlRefreshBanner();
    }, (logLine) => {
      _nl.trainLogs.push(logLine);
      _nlAppendTrainLog(logLine);
    }, true);

    _nl.trainResult = result;
    _nl.trainPhase = 'done';
    _nl.training = false;
    _nlUpdatePillIndicator();
    _nl.ready = true;
    _nl.modelVersion++;
    _nlCheckGazeMasterAchievement();
    _nl.lastAutoRefineTime = Date.now();

    const valPx = result.val_error_px;
    _nl.baselineValError = valPx;
    _nl.valError = valPx;
    _nl.trainError = result.train_error_px;
    _nl.implicitCount = 0;
    _nlUpdateAdaptiveRadius(valPx);
    _nl.refinementHistory.push({
      timestamp: Date.now(), val_error_px: valPx,
      train_error_px: result.train_error_px, samples: result.samples, improved: true
    });
    _nlSaveRefinementHistory();

    const label = valPx < 80 ? 'Good' : valPx < 150 ? 'Fair' : 'Poor';
    const color = valPx < 80 ? '#4ade80' : valPx < 150 ? '#fbbf24' : '#f87171';
    _nlFinishTrainPill('Refine Done \u2014 v' + _nl.modelVersion, `Val ${valPx}px \u2014 ${label}`, color);
    _nlShowModelUpdatedPill(_nl.modelVersion, valPx);
    window._nlRefreshTrainView();
    if (window.location.hash === '#neuralook') window.renderNeuralookView();
    logger.debug(`neuralook auto-refine improved: v${_nl.modelVersion}, val=${valPx}px, radius=${_nl.adaptiveRadius}px`);
  } catch (e) {
    _nl.trainPhase = 'error';
    _nl.training = false;
    _nlUpdatePillIndicator();
    _nl.trainResult = { error: e.message || String(e) };
    _nlErrorTrainPill(e.message || String(e));
    _nl.lastAutoRefineTime = Date.now();
    _nl.refinementHistory.push({
      timestamp: Date.now(), val_error_px: null,
      train_error_px: null, samples: 0, improved: false
    });
    _nlSaveRefinementHistory();
    window._nlRefreshTrainView();
    if (window.location.hash === '#neuralook') window.renderNeuralookView();
    logger.warn('[neuralook] auto-refine error:', e);
  } finally {
    _nl.autoRefineInProgress = false;
    window._nlRefreshStats();
  }
}

export function _nlUpdateAdaptiveRadius(valErrorPx) {
  _nl.adaptiveRadius = Math.max(350, Math.min(600, Math.round(valErrorPx * 4)));
}

export function _nlSaveRefinementHistory() {
  try {
    if (_nl.refinementHistory.length > 100) _nl.refinementHistory = _nl.refinementHistory.slice(-100);
    Settings.setJSON('nlRefinementHistory', _nl.refinementHistory);
  } catch (_) {}
}

export function _nlLoadRefinementHistory() {
  try {
    const loaded = Settings.getJSON('nlRefinementHistory', null);
    if (loaded) {
      _nl.refinementHistory = loaded;
      // Restore baseline from last accepted refine
      for (let i = _nl.refinementHistory.length - 1; i >= 0; i--) {
        if (_nl.refinementHistory[i].improved) {
          _nl.baselineValError = _nl.refinementHistory[i].val_error_px;
          _nlUpdateAdaptiveRadius(_nl.baselineValError);
          break;
        }
      }
    }
  } catch (_) {}
}

// ── Session Stats Reset ──

export function _nlResetSessionStats() {
  _nl.sessionStartTime = Date.now();
  _nl.sessionPredictions = 0;
  _nl.heatmapGrid = new Array(_NL_HEATMAP_COLS * _NL_HEATMAP_ROWS).fill(0);
  _nl.heatmapMax = 0;
  _nl.fixationCount = 0;
  _nl.fixationDurations = [];
  _nl.saccadeCount = 0;
  _nl.currentFixation = null;
  _nl.histGazeX = [];
  _nl.histGazeY = [];
  _nl.histJitter = [];
  _nl.histRate = [];
}

// ── Gaze Dot ──

export function _nlCreateDot() {
  _nlRemoveDot();
  const savedColor = document.getElementById('nl-dot-color')?.value || '#ef4444';
  const savedSize = document.getElementById('nl-dot-size')?.value || '20';
  const sz = parseInt(savedSize, 10);
  const dotView = new window.View('div').attr('id', 'nl-gaze-dot');
  dotView.styles({
    position: 'fixed', width: sz + 'px', height: sz + 'px', borderRadius: '50%',
    background: savedColor, opacity: '0.7', pointerEvents: 'none', zIndex: '99998',
    transform: 'translate(-50%, -50%)', transition: 'left 0.05s linear, top 0.05s linear',
    boxShadow: '0 0 8px ' + savedColor + '80', left: '-100px', top: '-100px'
  });
  document.body.append(dotView.el);
  _nl.gazeDot = dotView.el;
}

export function _nlRemoveDot() {
  if (_nl.gazeDot) { _nl.gazeDot.remove(); _nl.gazeDot = null; }
  const existing = document.getElementById('nl-gaze-dot');
  if (existing) existing.remove();
}

export function _nlMoveDot(x, y) {
  if (!_nl.gazeDot) return;
  _nl.gazeDot.style.left = x + 'px';
  _nl.gazeDot.style.top = y + 'px';
}
