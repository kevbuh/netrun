// neuralook.js — Orchestrator for Neuralook eye-tracking system
// Delegates to sub-modules: nl-state, nl-capture, nl-training, nl-tracking

import { _nl, _NL_EYE_W, _NL_EYE_H, _NL_BUFFER_SIZE, _NL_GRAPH_LEN, _NL_HEATMAP_COLS, _NL_HEATMAP_ROWS, _NL_FIXATION_RADIUS, _NL_FIXATION_MIN_MS, _NL_CAL_POSITIONS, _nlModelLabel, _nlSetModelType, _nlCheckGazeMasterAchievement, _nlUpdatePillIndicator } from '/js/neuralook/nl-state.js';
import { _nlInitMediapipe, _nlCaptureEyeCrops, _nlGetEyeCropCanvas, _nlEnsureVideo, _nlStopVideo, _nlAttachCameraPreview, _nlToggleCamera, _nlStartEyeCropPreview, _nlDrawEyeCrops } from '/js/neuralook/nl-capture.js';
import { _nlRenderTrainDetailView, _nlAppendTrainLog, _nlRefreshTrainView, _nlRefreshTrainDetails, _nlDrawTrainLossGraph, _nlTrainOnServerSSE, _nlShowTrainPill, _nlTrainETA, _nlStopTraining, _nlUpdateTrainPill, _nlFinishTrainPill, _nlErrorTrainPill, _nlDismissTrainPill, _nlPredictOnServer, _nlRefineModel } from '/js/neuralook/nl-training.js';
import { _nlStartCalibration, _nlShowCalibrationOverlay, _nlShowNextCalibrationDot, _nlOnCalibrationComplete, _nlFinishCalibration, _nlFullscreenChange, _nlShowError, _nlApplyGazePrediction, _nlTrackingLoop, _nlToggleTracking, _nlStartTracking, _nlStopTracking, _nlHandleImplicitClick, _nlHandleIframeClick, _nlFlushImplicitSamples, _nlFetchImplicitCount, _nlShowClickFeedback, _nlShowModelUpdatedPill, _nlCheckAutoRefine, _nlStartAutoRefine, _nlUpdateAdaptiveRadius, _nlSaveRefinementHistory, _nlLoadRefinementHistory, _nlCreateDot, _nlRemoveDot, _nlMoveDot, _nlResetSessionStats } from '/js/neuralook/nl-tracking.js';

import { icon } from '/js/core/icons.js';
import { setSidebarActive } from '/js/core/core-layout.js';
import { ensureView, hideAllViews } from '/js/core/core-views.js';

// ── Main View ──

export async function openNeuralook() {
  _nlDismissTrainPill();
  hideAllViews();
  const view = await ensureView('neuralook-view');
  if (view) { view.classList.remove('hidden'); view.style.display = ''; }
  window.location.hash = '#neuralook';
  setSidebarActive('sb-neuralook');
  renderNeuralookView();
}

export function renderNeuralookView() {
  const container = document.getElementById('neuralook-content');
  if (!container) return;

  // If training is active or just completed, show training detail view (unless toggled)
  if ((_nl.training || _nl.trainPhase === 'done' || _nl.trainPhase === 'error') && _nl.showTrainView) {
    _nlRenderTrainDetailView(container);
    return;
  }

  const trackingLabel = _nl.tracking ? 'Stop Tracking' : 'Start Tracking';
  const statusColor = _nl.tracking ? '#4ade80' : _nl.ready ? '#fbbf24' : '#6b7280';
  const statusText = _nl.tracking ? 'Tracking active' : _nl.ready ? 'Ready — not tracking' : 'Not started';

  // Training active/done banner
  const showTrainBanner = _nl.training || _nl.trainPhase === 'done' || _nl.trainPhase === 'error';
  let bannerHTML = '';
  if (showTrainBanner) {
    if (_nl.training) {
      const prog = _nl.trainProgress || {};
      const epoch = prog.epoch || 0;
      const maxEpochs = prog.max_epochs || 300;
      const pct = Math.round((epoch / maxEpochs) * 100);
      const loss = prog.val_loss != null ? ` · loss ${prog.val_loss.toFixed(4)}` : '';
      const eta = _nlTrainETA(epoch, maxEpochs);
      bannerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:10px;background:var(--nr-bg-surface,#23232a);border:1px solid var(--border,#333);margin-bottom:8px;">
          <svg width="14" height="14" viewBox="0 0 18 18" style="animation:nl-pill-spin 1s linear infinite;flex-shrink:0;"><circle cx="9" cy="9" r="7" fill="none" stroke="var(--nr-accent,#b4451a)" stroke-width="2" stroke-dasharray="30 14" stroke-linecap="round"/></svg>
          <span class="text-[0.8rem] text-primary font-medium">Training</span>
          <span id="nl-banner-detail" class="text-[0.72rem] text-muted tabular-nums">Epoch ${epoch}/${maxEpochs} (${pct}%)${loss}${eta}</span>
          <span class="ml-auto"></span>
          <button onclick="window._nlStopTraining()" class="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-border-input text-[0.72rem] text-red-400 font-medium cursor-pointer hover:border-red-400 transition-colors"><svg width="8" height="8" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/></svg>Stop</button>
          <span onclick="window._nl.showTrainView=true;window.renderNeuralookView();" class="text-[0.72rem] text-dimmer cursor-pointer hover:text-accent transition-colors">View log →</span>
        </div>`;
    } else {
      bannerHTML = `
        <div onclick="window._nl.showTrainView=true;if(!window._nl.trainPhase)window._nl.trainPhase='done';window.renderNeuralookView();" style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:10px;background:var(--nr-bg-surface,#23232a);border:1px solid var(--border,#333);cursor:pointer;margin-bottom:8px;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--nr-accent,#b4451a)'" onmouseout="this.style.borderColor='var(--border,#333)'">
          ${_nl.trainPhase === 'done' ? '<svg width="14" height="14" viewBox="0 0 18 18" class="flex-shrink-0"><circle cx="9" cy="9" r="8" fill="#4ade80"/><path d="M5.5 9.5l2 2 5-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 18 18" class="flex-shrink-0"><circle cx="9" cy="9" r="8" fill="#f87171"/><path d="M6 6l6 6M12 6l-6 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>'}
          <span class="text-[0.8rem] text-primary font-medium">${_nl.trainPhase === 'done' ? 'Training complete' : 'Training failed'}</span>
          <span class="text-[0.72rem] text-dimmer ml-auto">View log →</span>
        </div>`;
    }
  }

  const mpStatusHTML = _nl.mpModelReady
    ? icon('check', { size: 14, class: 'text-green-400 flex-shrink-0', strokeWidth: '2.5' }) + '<span class="text-[0.75rem] text-green-400">MediaPipe ready</span>'
    : _nl.mpModelLoading
      ? '<svg class="w-3.5 h-3.5 flex-shrink-0 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span class="text-[0.75rem] text-accent">Loading face model...</span>'
      : _nl.mpCdnLoaded
        ? icon('check', { size: 14, class: 'text-green-400 flex-shrink-0', strokeWidth: '2.5' }) + '<span class="text-[0.75rem] text-muted">MediaPipe loaded</span>'
        : '<svg class="w-3.5 h-3.5 flex-shrink-0 animate-spin text-muted" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span class="text-[0.75rem] text-dimmer">Loading MediaPipe...</span>';

  const rightColHTML = _nl.tracking ? _nlRenderDashboardColumn() : `<div style="display:flex;flex-direction:column;gap:12px;min-height:0;">
        <div class="bg-card border border-border-card rounded-xl p-3" style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;">
          <div id="nl-camera-preview" class="rounded-lg overflow-hidden bg-black" style="flex:1;min-height:0;max-height:100%;display:flex;align-items:center;justify-content:center;position:relative;">
            <span class="text-dimmer text-[0.75rem]" id="nl-camera-placeholder">${_nl.cameraOn ? 'Starting...' : 'Camera off'}</span>
          </div>
          <div class="flex justify-center mt-2">
            <button id="nl-camera-toggle" onclick="window._nlToggleCamera()" class="px-4 py-1.5 rounded-lg border border-border-input bg-card text-primary text-[0.78rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors">
              ${_nl.cameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
            </button>
          </div>
        </div>

        <div class="bg-card border border-border-card rounded-xl p-4" style="flex-shrink:0;">
          <h3 class="text-[0.85rem] font-semibold text-primary mb-3">Model Info</h3>
          <div id="nl-model-stats" class="grid grid-cols-2 gap-x-6 gap-y-2 text-[0.78rem]"></div>
        </div>
      </div>`;

  const mainHTML = `
    ${bannerHTML}
    <div style="display:grid;grid-template-columns:200px 1fr;gap:16px;height:${showTrainBanner ? 'calc(100% - 60px - 52px)' : 'calc(100% - 60px)'};box-sizing:border-box;">
      <div class="flex flex-col gap-3">
        <div class="bg-card border border-border-card rounded-xl p-4">
          <div class="flex items-center gap-2 mb-3">
            <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};display:inline-block"></span>
            <span class="text-[0.82rem] text-primary font-medium">${statusText}</span>
          </div>
          <div id="nl-mp-status" class="flex items-center gap-2 mb-2">
            ${mpStatusHTML}
          </div>
          <div id="nl-error-msg" class="text-[0.75rem] text-red-400 mb-2" style="display:none"></div>
          <div class="flex rounded-lg border border-border-input overflow-hidden mb-2" style="height:30px;">
            <button onclick="window._nlSetModelType('cnn')" class="flex-1 text-[0.72rem] font-medium cursor-pointer transition-colors ${_nl.modelType === 'cnn' ? 'bg-accent text-white' : 'bg-card text-muted hover:text-primary'}">CNN</button>
            <button onclick="window._nlSetModelType('mobilenet')" class="flex-1 text-[0.72rem] font-medium cursor-pointer transition-colors ${_nl.modelType === 'mobilenet' ? 'bg-accent text-white' : 'bg-card text-muted hover:text-primary'}" style="border-left:1px solid var(--nr-border-strong)">MobileNet</button>
          </div>
          <div class="flex flex-col gap-2">
            <button onclick="window._nlStartCalibration()" class="px-4 py-2 rounded-lg border border-border-input bg-card text-primary text-[0.82rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors w-full" ${_nl.calibrating ? 'disabled style="opacity:0.5"' : ''}>
              ${_nl.calibrating ? 'Calibrating...' : _nl.ready ? 'Recalibrate' : 'Start Calibration'}
            </button>
            <button onclick="window._nlToggleTracking()" class="px-4 py-2 rounded-lg border border-border-input text-[0.82rem] font-medium cursor-pointer transition-colors w-full ${_nl.tracking ? 'bg-accent text-white border-accent hover:bg-accent-hover' : 'bg-card text-primary hover:border-accent hover:text-accent'}" ${!_nl.ready ? 'disabled style="opacity:0.5"' : ''}>
              ${trackingLabel}
            </button>
            <label class="flex items-center gap-2 text-[0.75rem] text-muted cursor-pointer select-none mt-1" ${!_nl.ready ? 'style="opacity:0.5;pointer-events:none"' : ''}>
              <input type="checkbox" ${_nl.autoRefineEnabled ? 'checked' : ''} onchange="window._nl.autoRefineEnabled=this.checked" style="accent-color:var(--nr-accent,#b4451a)">
              Auto-refine
            </label>
          </div>
        </div>
      </div>

      ${rightColHTML}
    </div>
  `;
  AetherUI.mount(RawHTML(mainHTML), container);

  if (_nl.tracking) {
    requestAnimationFrame(() => _nlRefreshDashboard());
    _nlAttachCameraPreview();
  } else {
    if (_nl.cameraOn) _nlAttachCameraPreview();
  }
  _nlFetchImplicitCount();
  _nlLoadRefinementHistory();
  if (!_nl.tracking) _nlRefreshStats();
  _nlStartStatsInterval();
}

// ── Stats & Graphs ──

export function _nlStartStatsInterval() {
  _nlStopStatsInterval();
  _nl.statsInterval = setInterval(() => {
    if (_nl.tracking) {
      if (!document.getElementById('nl-dash-rate')) { _nlStopStatsInterval(); return; }
      _nlRefreshDashboard();
    } else {
      if (!document.getElementById('nl-model-stats')) { _nlStopStatsInterval(); return; }
      _nlRefreshStats();
    }
  }, 500);
  _nl.rateInterval = setInterval(() => { _nl.predictionRate = _nl.predictionsThisSec; _nl.predictionsThisSec = 0; }, 1000);
}

export function _nlStopStatsInterval() {
  if (_nl.statsInterval) { clearInterval(_nl.statsInterval); _nl.statsInterval = null; }
  if (_nl.rateInterval) { clearInterval(_nl.rateInterval); _nl.rateInterval = null; }
}

export function _nlComputeJitter() {
  if (_nl.gazeBuffer.length < 2) return 0;
  let sx = 0, sy = 0;
  for (const p of _nl.gazeBuffer) { sx += p.x; sy += p.y; }
  const mx = sx / _nl.gazeBuffer.length, my = sy / _nl.gazeBuffer.length;
  let v = 0;
  for (const p of _nl.gazeBuffer) v += (p.x - mx) ** 2 + (p.y - my) ** 2;
  return Math.sqrt(v / _nl.gazeBuffer.length);
}

export function _nlRefreshBanner() {
  const el = document.getElementById('nl-banner-detail');
  if (!el || !_nl.training) return;
  const prog = _nl.trainProgress || {};
  const epoch = prog.epoch || 0;
  const maxEpochs = prog.max_epochs || 300;
  const pct = Math.round((epoch / maxEpochs) * 100);
  const loss = prog.val_loss != null ? ` · loss ${prog.val_loss.toFixed(4)}` : '';
  const eta = _nlTrainETA(epoch, maxEpochs);
  el.textContent = `Epoch ${epoch}/${maxEpochs} (${pct}%)${loss}${eta}`;
}

export function _nlRefreshStats() {
  const el = document.getElementById('nl-model-stats');
  if (!el) return;

  const jitter = _nl.tracking ? Math.round(_nlComputeJitter()) : null;
  const jitterColor = jitter !== null ? (jitter < 30 ? '#4ade80' : jitter < 70 ? '#fbbf24' : '#f87171') : '#6b7280';

  const row = (label, value, color) =>
    `<div class="text-muted">${label}</div><div class="text-primary font-medium tabular-nums" ${color ? `style="color:${color}"` : ''}>${value}</div>`;

  const implicitInfo = _nl.implicitCount > 0 ? `${_nl.implicitCount} clicks` + (_nl.implicitBuffer.length > 0 ? ` (+${_nl.implicitBuffer.length} pending)` : '') : _nl.implicitBuffer.length > 0 ? `${_nl.implicitBuffer.length} pending` : '<span class="text-dimmer">None</span>';

  const refineCount = _nl.refinementHistory.filter(h => h.improved).length;
  const bestError = _nl.baselineValError !== null ? `${_nl.baselineValError}px` : '<span class="text-dimmer">\u2014</span>';
  const autoRefineStatus = _nl.autoRefineInProgress ? '<span style="color:var(--nr-accent)">Refining...</span>'
    : _nl.autoRefineEnabled ? '<span style="color:#4ade80">Active</span>'
    : '<span class="text-dimmer">Off</span>';

  const statsHTML =
    row('Model', `${_nlModelLabel()} v${_nl.modelVersion} + temporal LSTM`) +
    row('Input', `Eye crops ${_NL_EYE_W}x${_NL_EYE_H} x2 + aux(9)`) +
    row('Calibration', `${_nl.calibData.length} frames (${_NL_CAL_POSITIONS.length} points)`) +
    row('Status', _nl.modelTrained ? '<span style="color:#4ade80">Trained</span>' : '<span class="text-dimmer">Not trained</span>') +
    (_nl.trainError !== null ? row('Train error', `${_nl.trainError}px`) : '') +
    (_nl.valError !== null ? row('Val error', `${_nl.valError}px`) : '') +
    row('Prediction rate', _nl.tracking ? `${_nl.predictionRate} Hz` : '<span class="text-dimmer">Inactive</span>') +
    row('Gaze', _nl.tracking ? `${Math.round(_nl.gazeX)}, ${Math.round(_nl.gazeY)}` : '<span class="text-dimmer">Inactive</span>') +
    row('Jitter', jitter !== null ? `${jitter}px` : '<span class="text-dimmer">Inactive</span>', jitter !== null ? jitterColor : null) +
    row('Predictions', `${_nl.predictionCount.toLocaleString()}`) +
    row('Implicit clicks', implicitInfo) +
    row('Auto-refine', autoRefineStatus) +
    row('Refinements', refineCount > 0 ? `${refineCount}` : '<span class="text-dimmer">0</span>') +
    row('Best val error', bestError) +
    row('Confidence radius', `${_nl.adaptiveRadius}px`) +
    (_nl.implicitCount > 0 && !_nl.training && _nl.modelTrained ? `<div class="col-span-2 mt-1"><button onclick="window._nlRefineModel()" class="px-3 py-1 rounded-lg border border-border-input bg-card text-primary text-[0.75rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors w-full">Refine Model (${_nl.implicitCount} clicks)</button></div>` : '');
  AetherUI.mount(RawHTML(statsHTML), el);

  // Update banner detail if training is in progress
  _nlRefreshBanner();
}

// ── Graph Drawing ──

export function _nlDrawGraph(canvasId, data, color, fixedMin, fixedMax) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (w <= 0 || h <= 0) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const valid = data.filter(v => v !== null);
  if (valid.length < 2) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); return;
  }
  const min = fixedMin != null ? fixedMin : Math.min(...valid);
  let max = fixedMax != null ? fixedMax : Math.max(...valid);
  if (max === min) max = min + 1;
  const pad = h * 0.08;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = dpr;
  for (let i = 1; i < 4; i++) { const gy = pad + (h - 2 * pad) * (i / 4); ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dpr; ctx.lineJoin = 'round'; ctx.beginPath();
  let started = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]; if (v === null) { started = false; continue; }
    const x = (i / (_NL_GRAPH_LEN - 1)) * w;
    const y = pad + (h - 2 * pad) * (1 - (v - min) / (max - min));
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (started) {
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '18'); grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad; ctx.fill();
  }
}

// ── Heatmap & Fixation Detection ──

export function _nlUpdateHeatmap(x, y) {
  const col = Math.floor((x / window.innerWidth) * _NL_HEATMAP_COLS);
  const row = Math.floor((y / window.innerHeight) * _NL_HEATMAP_ROWS);
  if (col < 0 || col >= _NL_HEATMAP_COLS || row < 0 || row >= _NL_HEATMAP_ROWS) return;
  const idx = row * _NL_HEATMAP_COLS + col;
  _nl.heatmapGrid[idx]++;
  if (_nl.heatmapGrid[idx] > _nl.heatmapMax) _nl.heatmapMax = _nl.heatmapGrid[idx];
}

export function _nlHeatColor(t) {
  // 5-stop gradient: dark blue -> blue -> cyan -> yellow -> red
  if (t <= 0) return 'rgba(10,20,60,0.15)';
  const a = Math.min(0.25 + t * 0.75, 1);
  let r, g, b;
  if (t < 0.25) { const s = t / 0.25; r = 10; g = 20 + s * 40; b = 60 + s * 140; }
  else if (t < 0.5) { const s = (t - 0.25) / 0.25; r = 10 + s * 20; g = 60 + s * 195; b = 200 - s * 20; }
  else if (t < 0.75) { const s = (t - 0.5) / 0.25; r = 30 + s * 225; g = 255 - s * 30; b = 180 - s * 160; }
  else { const s = (t - 0.75) / 0.25; r = 255; g = 225 - s * 185; b = 20 - s * 20; }
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a.toFixed(2)})`;
}

export function _nlDrawHeatmap() {
  const canvas = document.getElementById('nl-heatmap-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (w <= 0 || h <= 0) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const cellW = w / _NL_HEATMAP_COLS, cellH = h / _NL_HEATMAP_ROWS;
  const mx = _nl.heatmapMax || 1;
  for (let r = 0; r < _NL_HEATMAP_ROWS; r++) {
    for (let c = 0; c < _NL_HEATMAP_COLS; c++) {
      const v = _nl.heatmapGrid[r * _NL_HEATMAP_COLS + c];
      ctx.fillStyle = _nlHeatColor(v / mx);
      ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
    }
  }
  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = dpr * 0.5;
  for (let c = 1; c < _NL_HEATMAP_COLS; c++) { ctx.beginPath(); ctx.moveTo(c * cellW, 0); ctx.lineTo(c * cellW, h); ctx.stroke(); }
  for (let r = 1; r < _NL_HEATMAP_ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * cellH); ctx.lineTo(w, r * cellH); ctx.stroke(); }
}

export function _nlDetectFixation(x, y, ts) {
  if (!_nl.currentFixation) {
    _nl.currentFixation = { cx: x, cy: y, startTs: ts, points: [{ x, y }] };
    return;
  }
  const f = _nl.currentFixation;
  const dx = x - f.cx, dy = y - f.cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= _NL_FIXATION_RADIUS) {
    f.points.push({ x, y });
    // Update centroid
    let sx = 0, sy = 0;
    for (const p of f.points) { sx += p.x; sy += p.y; }
    f.cx = sx / f.points.length;
    f.cy = sy / f.points.length;
  } else {
    // End current fixation if long enough
    const dur = ts - f.startTs;
    if (dur >= _NL_FIXATION_MIN_MS) {
      _nl.fixationCount++;
      _nl.fixationDurations.push(dur);
      _nl.saccadeCount++;
    }
    _nl.currentFixation = { cx: x, cy: y, startTs: ts, points: [{ x, y }] };
  }
}

// ── Session Stats Dashboard ──

export function _nlPushHistorySample() {
  _nl.histRate.push(_nl.predictionRate);
  _nl.histJitter.push(_nl.tracking ? Math.round(_nlComputeJitter()) : null);
  _nl.histGazeX.push(_nl.tracking ? Math.round(_nl.gazeX) : null);
  _nl.histGazeY.push(_nl.tracking ? Math.round(_nl.gazeY) : null);
  if (_nl.histRate.length > _NL_GRAPH_LEN) _nl.histRate.shift();
  if (_nl.histJitter.length > _NL_GRAPH_LEN) _nl.histJitter.shift();
  if (_nl.histGazeX.length > _NL_GRAPH_LEN) _nl.histGazeX.shift();
  if (_nl.histGazeY.length > _NL_GRAPH_LEN) _nl.histGazeY.shift();
}

export function _nlRenderDashboardColumn() {
  return `
    <div style="display:flex;flex-direction:column;gap:12px;min-height:0;">
      <!-- Sparklines -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;flex-shrink:0;">
        <div class="bg-card border border-border-card rounded-xl p-2.5">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[0.68rem] text-muted">Rate</span>
            <span class="text-[0.78rem] text-primary font-medium tabular-nums" id="nl-dash-rate">0 Hz</span>
          </div>
          <canvas id="nl-spark-rate" style="width:100%;height:36px;display:block;"></canvas>
        </div>
        <div class="bg-card border border-border-card rounded-xl p-2.5">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[0.68rem] text-muted">Jitter</span>
            <span class="text-[0.78rem] text-primary font-medium tabular-nums" id="nl-dash-jitter">0px</span>
          </div>
          <canvas id="nl-spark-jitter" style="width:100%;height:36px;display:block;"></canvas>
        </div>
        <div class="bg-card border border-border-card rounded-xl p-2.5">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[0.68rem] text-muted">Gaze X</span>
            <span class="text-[0.78rem] text-primary font-medium tabular-nums" id="nl-dash-gazex">0</span>
          </div>
          <canvas id="nl-spark-gazex" style="width:100%;height:36px;display:block;"></canvas>
        </div>
        <div class="bg-card border border-border-card rounded-xl p-2.5">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[0.68rem] text-muted">Gaze Y</span>
            <span class="text-[0.78rem] text-primary font-medium tabular-nums" id="nl-dash-gazey">0</span>
          </div>
          <canvas id="nl-spark-gazey" style="width:100%;height:36px;display:block;"></canvas>
        </div>
      </div>
      <!-- Heatmap + Camera + Stats -->
      <div style="display:flex;gap:10px;flex:1;min-height:0;">
        <div style="flex:1;display:flex;flex-direction:column;gap:10px;min-height:0;">
          <div class="bg-card border border-border-card rounded-xl p-3" style="flex:1;display:flex;flex-direction:column;min-height:0;">
            <span class="text-[0.72rem] text-muted mb-1.5">Screen Heatmap</span>
            <div style="flex:1;min-height:0;position:relative;border-radius:8px;overflow:hidden;background:rgba(10,20,60,0.15);">
              <canvas id="nl-heatmap-canvas" style="width:100%;height:100%;display:block;"></canvas>
            </div>
          </div>
          <div class="bg-card border border-border-card rounded-xl p-2" style="height:120px;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">
            <div id="nl-camera-preview" class="rounded-lg overflow-hidden bg-black" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;position:relative;">
              <span class="text-dimmer text-[0.68rem]" id="nl-camera-placeholder">Camera</span>
            </div>
          </div>
        </div>
        <div style="width:200px;display:flex;flex-direction:column;gap:10px;flex-shrink:0;">
          <div class="bg-card border border-border-card rounded-xl p-3" style="flex:1;">
            <span class="text-[0.72rem] text-muted font-medium">Session</span>
            <div class="mt-2 flex flex-col gap-1.5 text-[0.72rem]">
              <div class="flex justify-between"><span class="text-muted">Duration</span><span class="text-primary tabular-nums" id="nl-dash-duration">0s</span></div>
              <div class="flex justify-between"><span class="text-muted">Fixations</span><span class="text-primary tabular-nums" id="nl-dash-fixations">0</span></div>
              <div class="flex justify-between"><span class="text-muted">Avg Dur</span><span class="text-primary tabular-nums" id="nl-dash-avgdur">\u2014</span></div>
              <div class="flex justify-between"><span class="text-muted">Saccades</span><span class="text-primary tabular-nums" id="nl-dash-saccades">0</span></div>
              <div class="flex justify-between"><span class="text-muted">Predictions</span><span class="text-primary tabular-nums" id="nl-dash-predictions">0</span></div>
            </div>
          </div>
          <div class="bg-card border border-border-card rounded-xl p-3" style="flex-shrink:0;">
            <span class="text-[0.72rem] text-muted font-medium">Model</span>
            <div class="mt-2 flex flex-col gap-1 text-[0.68rem]" id="nl-dash-modelinfo">
              <span class="text-primary">CNN v0</span>
              <span class="text-dimmer">Loading...</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

export function _nlRefreshDashboard() {
  if (!_nl.tracking || !document.getElementById('nl-dash-rate')) return;

  _nlPushHistorySample();

  // Sparklines
  _nlDrawGraph('nl-spark-rate', _nl.histRate, '#4ade80', 0, null);
  _nlDrawGraph('nl-spark-jitter', _nl.histJitter, '#fbbf24', 0, null);
  _nlDrawGraph('nl-spark-gazex', _nl.histGazeX, '#60a5fa', 0, window.innerWidth);
  _nlDrawGraph('nl-spark-gazey', _nl.histGazeY, '#a78bfa', 0, window.innerHeight);

  // Sparkline values
  const rateEl = document.getElementById('nl-dash-rate');
  if (rateEl) rateEl.textContent = _nl.predictionRate + ' Hz';
  const jitterEl = document.getElementById('nl-dash-jitter');
  if (jitterEl) jitterEl.textContent = Math.round(_nlComputeJitter()) + 'px';
  const gxEl = document.getElementById('nl-dash-gazex');
  if (gxEl) gxEl.textContent = Math.round(_nl.gazeX);
  const gyEl = document.getElementById('nl-dash-gazey');
  if (gyEl) gyEl.textContent = Math.round(_nl.gazeY);

  // Heatmap
  _nlDrawHeatmap();

  // Session stats
  const elapsed = Math.round((Date.now() - _nl.sessionStartTime) / 1000);
  const durEl = document.getElementById('nl-dash-duration');
  if (durEl) durEl.textContent = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const fixEl = document.getElementById('nl-dash-fixations');
  if (fixEl) fixEl.textContent = _nl.fixationCount.toLocaleString();
  const avgEl = document.getElementById('nl-dash-avgdur');
  if (avgEl) avgEl.textContent = _nl.fixationDurations.length > 0 ? Math.round(_nl.fixationDurations.reduce((a, b) => a + b, 0) / _nl.fixationDurations.length) + 'ms' : '\u2014';
  const sacEl = document.getElementById('nl-dash-saccades');
  if (sacEl) sacEl.textContent = _nl.saccadeCount.toLocaleString();
  const predEl = document.getElementById('nl-dash-predictions');
  if (predEl) predEl.textContent = _nl.sessionPredictions.toLocaleString();

  // Compact model info
  const miEl = document.getElementById('nl-dash-modelinfo');
  if (miEl) {
    const valStr = _nl.valError !== null ? `${_nl.valError}px val` : 'no val';
    const calStr = `${_nl.calibData.length} cal`;
    const autoStr = _nl.autoRefineEnabled ? 'Auto \u2713' : 'Auto off';
    AetherUI.mount(RawHTML(`<span class="text-primary">${_nlModelLabel()} v${_nl.modelVersion} \u00b7 ${valStr}</span><span class="text-dimmer">${calStr} \u00b7 ${autoStr}</span>`), miEl);
  }

  _nlRefreshBanner();
}

// ── Window assignments ──

// Orchestrator functions
window.openNeuralook = openNeuralook;
window.renderNeuralookView = renderNeuralookView;
window._nlStartStatsInterval = _nlStartStatsInterval;
window._nlStopStatsInterval = _nlStopStatsInterval;
window._nlRefreshStats = _nlRefreshStats;
window._nlRefreshBanner = _nlRefreshBanner;
window._nlComputeJitter = _nlComputeJitter;
window._nlDrawGraph = _nlDrawGraph;
window._nlUpdateHeatmap = _nlUpdateHeatmap;
window._nlHeatColor = _nlHeatColor;
window._nlDrawHeatmap = _nlDrawHeatmap;
window._nlDetectFixation = _nlDetectFixation;
window._nlPushHistorySample = _nlPushHistorySample;
window._nlRenderDashboardColumn = _nlRenderDashboardColumn;
window._nlRefreshDashboard = _nlRefreshDashboard;

// State (for onclick access)
window._nl = _nl;

// State module
window._nlSetModelType = _nlSetModelType;
window._nlUpdatePillIndicator = _nlUpdatePillIndicator;
window._nlModelLabel = _nlModelLabel;

// Capture module
window._nlToggleCamera = _nlToggleCamera;
window._nlAttachCameraPreview = _nlAttachCameraPreview;

// Training module
window._nlStopTraining = _nlStopTraining;
window._nlDismissTrainPill = _nlDismissTrainPill;
window._nlRefreshTrainView = _nlRefreshTrainView;
window._nlTrainETA = _nlTrainETA;
window._nlRefineModel = _nlRefineModel;

// Tracking module
window._nlStartCalibration = _nlStartCalibration;
window._nlToggleTracking = _nlToggleTracking;
window._nlStopTracking = _nlStopTracking;
window._nlHandleIframeClick = _nlHandleIframeClick;
window._nlUpdateAdaptiveRadius = _nlUpdateAdaptiveRadius;
window._nlResetSessionStats = _nlResetSessionStats;
window._nlFetchImplicitCount = _nlFetchImplicitCount;
window._nlLoadRefinementHistory = _nlLoadRefinementHistory;
