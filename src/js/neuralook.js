import Settings from '/js/core/core-settings.js';
import { api, apiPost, apiGet } from '/js/api.js';
import { icon } from '/js/core/icons.js';
import { islandUpdate, islandRemove, showAchievement, pillStackAdd, pillStackRemove } from '/js/core/core-ui.js';
import { setSidebarActive } from '/js/core/core-layout.js';
import { ensureView, hideAllViews } from '/js/core/core-views.js';
import { logger } from '/js/logger.js';

// ── Neuralook — Eye Tracking window.View(CNN Gaze Estimation) ──

export let _nlCalibrating = false;
export let _nlTracking = false;
export let _nlGazeDot = null;
export let _nlReady = false;
export let _nlGazeX = 0;
export let _nlGazeY = 0;
export let _nlCurrentPoint = 0;
export let _nlCameraOn = false;

// MediaPipe state (used to locate eyes in video frames)
export let _nlFaceLandmarker = null;
export let _nlVideoEl = null;
export let _nlMpCdnLoaded = !!(window.FaceLandmarker && window.FilesetResolver);
export let _nlMpModelLoading = false;
export let _nlMpModelReady = false;
export let _nlTrackingRAF = null;

window.addEventListener('mediapipe-ready', () => {
  _nlMpCdnLoaded = true;
  if (document.getElementById('neuralook-content')) renderNeuralookView();
});

// Calibration data: array of { eyeData: [4096], screenX, screenY, headPose: [yaw, pitch, roll], irisFeatures: [6] }
export let _nlCalibData = [];
// Model state — server-side, just track if trained
export let _nlModelTrained = false;
export let _nlTrainError = null;
export let _nlValError = null;
export let _nlInferPending = false; // prevent overlapping inference requests

export let _nlCalibSaved = false;

// Eye crop canvas (offscreen, reused)
export let _nlEyeCropCanvas = null;

// Training state (for full-page training view)
export let _nlTraining = false;
export let _nlTrainPhase = ''; // 'training' | 'evaluating' | 'done' | 'error'
export let _nlTrainProgress = null; // latest progress event
export let _nlTrainResult = null; // final result from done event
export let _nlTrainLossHistory = []; // [{epoch, val_loss}]
export let _nlTrainLogs = []; // raw log lines from server
export let _nlTrainStartTime = 0;
export let _nlShowTrainView = true; // toggle between training detail and normal view
export let _nlTrainAbort = null; // AbortController for in-flight training request

// Implicit calibration (click collection)
export const _nlImplicitBuffer = [];
export let _nlLastCapture = null;   // { eyeData, headPose, irisFeatures, ts }
export let _nlLastPrediction = null; // { x, y, ts }
export let _nlImplicitCount = 0;    // server-side count
export let _nlImplicitLastFlush = 0;

// Auto-refine (continuous passive learning)
export const _nlAutoRefineEnabled = true;
export let _nlLastAutoRefineTime = 0;
export let _nlAutoRefineInProgress = false;
export let _nlRefinementHistory = [];
export let _nlBaselineValError = null;
export let _nlAdaptiveRadius = 500;
export let _nlTimedFlushInterval = null;
export let _nlModelVersion = 0; // increments on each successful train/refine

export function _nlCheckGazeMasterAchievement() {
  if (_nlModelVersion >= 5 && !Settings.get('ach_gaze_master')) {
    Settings.set('ach_gaze_master', '1');
    if (typeof showAchievement === 'function') showAchievement('Gaze Master', 'Trained your eye-tracking model 5 times');
  }
}

// Model type selection
export let _nlModelType = 'cnn'; // 'cnn' | 'mobilenet'
export const _nlModelState = {
  cnn: { version: 0, trainError: null, valError: null, trained: false, baselineValError: null },
  mobilenet: { version: 0, trainError: null, valError: null, trained: false, baselineValError: null }
};

export function _nlModelLabel() {
  return _nlModelType === 'mobilenet' ? 'MobileNet' : 'CNN';
}

export function _nlSetModelType(type) {
  if (type === _nlModelType) return;
  // Save current state
  _nlModelState[_nlModelType] = {
    version: _nlModelVersion,
    trainError: _nlTrainError,
    valError: _nlValError,
    trained: _nlModelTrained,
    baselineValError: _nlBaselineValError
  };
  // Restore target state
  const s = _nlModelState[type];
  _nlModelVersion = s.version;
  _nlTrainError = s.trainError;
  _nlValError = s.valError;
  _nlModelTrained = s.trained;
  _nlBaselineValError = s.baselineValError;
  _nlModelType = type;
  renderNeuralookView();
}

// Smoothing
export let _nlGazeBuffer = [];
export const _NL_BUFFER_SIZE = 6;

// Stats
export let _nlPredictionCount = 0;
export let _nlPredictionsThisSec = 0;
export let _nlPredictionRate = 0;
export let _nlStatsInterval = null;
export let _nlRateInterval = null;

export const _NL_GRAPH_LEN = 60;
export let _nlHistGazeX = [];
export let _nlHistGazeY = [];
export let _nlHistJitter = [];
export let _nlHistRate = [];

// Session stats
export let _nlSessionStartTime = 0;
export let _nlSessionPredictions = 0;
export const _NL_HEATMAP_COLS = 16;
export const _NL_HEATMAP_ROWS = 10;
export let _nlHeatmapGrid = new Array(_NL_HEATMAP_COLS * _NL_HEATMAP_ROWS).fill(0);
export let _nlHeatmapMax = 0;
export const _NL_FIXATION_RADIUS = 50;
export const _NL_FIXATION_MIN_MS = 150;
export let _nlFixationCount = 0;
export let _nlFixationDurations = [];
export let _nlSaccadeCount = 0;
export let _nlCurrentFixation = null;

// 5x5 calibration grid (25 points)
export const _NL_CAL_POSITIONS = [
  [10,10],[50,10],[90,10],
  [10,50],[50,50],[90,50],
  [10,90],[50,90],[90,90]
];

export const _NL_STARE_MS = 800;
export const _NL_SETTLE_MS = 150;

// Eye crop dimensions
export const _NL_EYE_W = 128;
export const _NL_EYE_H = 64;

export function _nlUpdatePillIndicator() {
  const el = document.getElementById('sb-neuralook');
  if (!el) return;
  el.classList.toggle('nl-active', _nlTracking || _nlCalibrating || _nlTraining || _nlCameraOn);
}

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
  if ((_nlTraining || _nlTrainPhase === 'done' || _nlTrainPhase === 'error') && _nlShowTrainView) {
    _nlRenderTrainDetailView(container);
    return;
  }

  const trackingLabel = _nlTracking ? 'Stop Tracking' : 'Start Tracking';
  const statusColor = _nlTracking ? '#4ade80' : _nlReady ? '#fbbf24' : '#6b7280';
  const statusText = _nlTracking ? 'Tracking active' : _nlReady ? 'Ready — not tracking' : 'Not started';

  // Training active/done banner
  const showTrainBanner = _nlTraining || _nlTrainPhase === 'done' || _nlTrainPhase === 'error';
  let bannerHTML = '';
  if (showTrainBanner) {
    if (_nlTraining) {
      const prog = _nlTrainProgress || {};
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
          <button onclick="_nlStopTraining()" class="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-border-input text-[0.72rem] text-red-400 font-medium cursor-pointer hover:border-red-400 transition-colors"><svg width="8" height="8" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/></svg>Stop</button>
          <span onclick="_nlShowTrainView=true;renderNeuralookView();" class="text-[0.72rem] text-dimmer cursor-pointer hover:text-accent transition-colors">View log →</span>
        </div>`;
    } else {
      bannerHTML = `
        <div onclick="_nlShowTrainView=true;if(!_nlTrainPhase)_nlTrainPhase='done';renderNeuralookView();" style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:10px;background:var(--nr-bg-surface,#23232a);border:1px solid var(--border,#333);cursor:pointer;margin-bottom:8px;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--nr-accent,#b4451a)'" onmouseout="this.style.borderColor='var(--border,#333)'">
          ${_nlTrainPhase === 'done' ? '<svg width="14" height="14" viewBox="0 0 18 18" class="flex-shrink-0"><circle cx="9" cy="9" r="8" fill="#4ade80"/><path d="M5.5 9.5l2 2 5-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 18 18" class="flex-shrink-0"><circle cx="9" cy="9" r="8" fill="#f87171"/><path d="M6 6l6 6M12 6l-6 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>'}
          <span class="text-[0.8rem] text-primary font-medium">${_nlTrainPhase === 'done' ? 'Training complete' : 'Training failed'}</span>
          <span class="text-[0.72rem] text-dimmer ml-auto">View log →</span>
        </div>`;
    }
  }

  const mpStatusHTML = _nlMpModelReady
    ? icon('check', { size: 14, class: 'text-green-400 flex-shrink-0', strokeWidth: '2.5' }) + '<span class="text-[0.75rem] text-green-400">MediaPipe ready</span>'
    : _nlMpModelLoading
      ? '<svg class="w-3.5 h-3.5 flex-shrink-0 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span class="text-[0.75rem] text-accent">Loading face model...</span>'
      : _nlMpCdnLoaded
        ? icon('check', { size: 14, class: 'text-green-400 flex-shrink-0', strokeWidth: '2.5' }) + '<span class="text-[0.75rem] text-muted">MediaPipe loaded</span>'
        : '<svg class="w-3.5 h-3.5 flex-shrink-0 animate-spin text-muted" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span class="text-[0.75rem] text-dimmer">Loading MediaPipe...</span>';

  const rightColHTML = _nlTracking ? _nlRenderDashboardColumn() : `<div style="display:flex;flex-direction:column;gap:12px;min-height:0;">
        <div class="bg-card border border-border-card rounded-xl p-3" style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;">
          <div id="nl-camera-preview" class="rounded-lg overflow-hidden bg-black" style="flex:1;min-height:0;max-height:100%;display:flex;align-items:center;justify-content:center;position:relative;">
            <span class="text-dimmer text-[0.75rem]" id="nl-camera-placeholder">${_nlCameraOn ? 'Starting...' : 'Camera off'}</span>
          </div>
          <div class="flex justify-center mt-2">
            <button id="nl-camera-toggle" onclick="_nlToggleCamera()" class="px-4 py-1.5 rounded-lg border border-border-input bg-card text-primary text-[0.78rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors">
              ${_nlCameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
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
            <button onclick="_nlSetModelType('cnn')" class="flex-1 text-[0.72rem] font-medium cursor-pointer transition-colors ${_nlModelType === 'cnn' ? 'bg-accent text-white' : 'bg-card text-muted hover:text-primary'}">CNN</button>
            <button onclick="_nlSetModelType('mobilenet')" class="flex-1 text-[0.72rem] font-medium cursor-pointer transition-colors ${_nlModelType === 'mobilenet' ? 'bg-accent text-white' : 'bg-card text-muted hover:text-primary'}" style="border-left:1px solid var(--nr-border-strong)">MobileNet</button>
          </div>
          <div class="flex flex-col gap-2">
            <button onclick="_nlStartCalibration()" class="px-4 py-2 rounded-lg border border-border-input bg-card text-primary text-[0.82rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors w-full" ${_nlCalibrating ? 'disabled style="opacity:0.5"' : ''}>
              ${_nlCalibrating ? 'Calibrating...' : _nlReady ? 'Recalibrate' : 'Start Calibration'}
            </button>
            <button onclick="_nlToggleTracking()" class="px-4 py-2 rounded-lg border border-border-input text-[0.82rem] font-medium cursor-pointer transition-colors w-full ${_nlTracking ? 'bg-accent text-white border-accent hover:bg-accent-hover' : 'bg-card text-primary hover:border-accent hover:text-accent'}" ${!_nlReady ? 'disabled style="opacity:0.5"' : ''}>
              ${trackingLabel}
            </button>
            <label class="flex items-center gap-2 text-[0.75rem] text-muted cursor-pointer select-none mt-1" ${!_nlReady ? 'style="opacity:0.5;pointer-events:none"' : ''}>
              <input type="checkbox" ${_nlAutoRefineEnabled ? 'checked' : ''} onchange="_nlAutoRefineEnabled=this.checked" style="accent-color:var(--nr-accent,#b4451a)">
              Auto-refine
            </label>
          </div>
        </div>
      </div>

      ${rightColHTML}
    </div>
  `;
  AetherUI.mount(RawHTML(mainHTML), container);

  if (_nlTracking) {
    requestAnimationFrame(() => _nlRefreshDashboard());
    _nlAttachCameraPreview();
  } else {
    if (_nlCameraOn) _nlAttachCameraPreview();
  }
  _nlFetchImplicitCount();
  _nlLoadRefinementHistory();
  if (!_nlTracking) _nlRefreshStats();
  _nlStartStatsInterval();
}

// ── Training Detail View ──

export function _nlRenderTrainDetailView(container) {
  const isDone = _nlTrainPhase === 'done';
  const isError = _nlTrainPhase === 'error';
  const prog = _nlTrainProgress || {};
  const epoch = prog.epoch || 0;
  const maxEpochs = prog.max_epochs || 100;
  const pct = Math.round((epoch / maxEpochs) * 100);
  const elapsed = Math.round((Date.now() - _nlTrainStartTime) / 1000);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const latestLoss = _nlTrainLossHistory.length > 0 ? _nlTrainLossHistory[_nlTrainLossHistory.length - 1].val_loss : null;

  let phaseLabel, phaseColor;
  if (isError) { phaseLabel = 'Error'; phaseColor = '#f87171'; }
  else if (isDone) { phaseLabel = 'Complete'; phaseColor = '#4ade80'; }
  else if (_nlTrainPhase === 'evaluating') { phaseLabel = 'Evaluating'; phaseColor = '#60a5fa'; }
  else { phaseLabel = 'Training'; phaseColor = 'var(--nr-accent, #b4451a)'; }

  const statsOrResultHTML = isDone && _nlTrainResult ? `
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;margin-bottom:8px;">
                  <div><div class="text-[1.2rem] font-bold" style="color:${_nlTrainResult.val_error_px < 80 ? '#4ade80' : _nlTrainResult.val_error_px < 150 ? '#fbbf24' : '#f87171'}">${_nlTrainResult.val_error_px}px</div><div class="text-[0.65rem] text-dimmer">Val Error</div></div>
                  <div><div class="text-[1.2rem] font-bold text-primary">${_nlTrainResult.train_error_px}px</div><div class="text-[0.65rem] text-dimmer">Train Error</div></div>
                  <div><div class="text-[1.2rem] font-bold text-primary">${_nlTrainResult.stopped_epoch}</div><div class="text-[0.65rem] text-dimmer">Epoch</div></div>
                </div>
                <div class="flex justify-center"><button onclick="_nlTrainPhase='';renderNeuralookView();" class="px-4 py-1.5 rounded-lg bg-accent text-white text-[0.75rem] font-medium cursor-pointer hover:opacity-90 transition-opacity">Continue to Tracking</button></div>
              ` : isError && _nlTrainResult ? `
                <div class="text-[0.78rem] text-red-400 mb-2">${_nlTrainResult.error}</div>
                <div class="flex justify-center"><button onclick="_nlTrainPhase='';renderNeuralookView();" class="px-4 py-1.5 rounded-lg border border-border-input bg-card text-primary text-[0.75rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors">Back</button></div>
              ` : `
                <div id="nl-train-details" class="grid grid-cols-2 gap-x-6 gap-y-1 text-[0.72rem]"></div>
              `;

  const trainDetailHTML = `
    <div style="display:flex;height:calc(100% - 60px);box-sizing:border-box;gap:0;">
      <!-- Training details -->
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;padding:12px 16px;gap:10px;overflow:hidden;">
        <!-- Header -->
        <div class="flex items-center gap-2" style="flex-shrink:0;">
          <button onclick="_nlShowTrainView=false;renderNeuralookView();" class="p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer" title="Back to controls">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M11 4L6 9l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div style="width:8px;height:8px;border-radius:50%;background:${phaseColor};${_nlTraining ? 'animation:nl-pill-spin 1s linear infinite;' : ''}"></div>
          <h2 class="text-[0.95rem] font-semibold text-primary">${isDone && !_nlTraining ? 'Training Log' : isError ? 'Training Error' : _nlTraining ? 'Training ' + _nlModelLabel() : 'Training Complete'}</h2>
          <span class="text-[0.72rem] text-muted tabular-nums">${isDone ? epoch : epoch} / ${maxEpochs}</span>
          <div style="flex:1;height:4px;border-radius:2px;background:var(--bg-secondary,#1a1a1f);overflow:hidden;max-width:120px;">
            <div id="nl-train-progbar" style="height:100%;border-radius:2px;background:${phaseColor};width:${isDone ? 100 : pct}%;transition:width 0.3s;"></div>
          </div>
          <span class="text-[0.72rem] text-dimmer tabular-nums" id="nl-train-loss-label">${latestLoss != null ? `loss ${latestLoss.toFixed(5)}` : ''}</span>
          <span class="ml-auto"></span>
          <span class="text-[0.72rem] text-muted">${elapsedStr}</span>
          ${_nlTraining ? `<button onclick="_nlStopTraining()" class="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-border-input text-[0.72rem] text-red-400 font-medium cursor-pointer hover:border-red-400 transition-colors" title="Stop training">
            <svg width="8" height="8" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/></svg>Stop
          </button>` : ''}
        </div>

        <!-- Two-column body -->
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:10px;min-height:0;">
          <!-- Left col: eye crops + loss graph + stats -->
          <div style="display:flex;flex-direction:column;gap:10px;min-height:0;">
            <!-- Eye crop preview -->
            <div class="bg-card border border-border-card rounded-xl p-2.5" style="flex-shrink:0;">
              <div class="flex items-center gap-3">
                <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                  <canvas id="nl-train-eye-left" width="${_NL_EYE_W}" height="${_NL_EYE_H}" style="width:${_NL_EYE_W}px;height:${_NL_EYE_H}px;border-radius:6px;background:#000;image-rendering:pixelated;transform:scaleY(-1);"></canvas>
                  <span class="text-[0.6rem] text-dimmer">Left</span>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                  <canvas id="nl-train-eye-right" width="${_NL_EYE_W}" height="${_NL_EYE_H}" style="width:${_NL_EYE_W}px;height:${_NL_EYE_H}px;border-radius:6px;background:#000;image-rendering:pixelated;transform:scaleX(-1);"></canvas>
                  <span class="text-[0.6rem] text-dimmer">Right</span>
                </div>
                <div class="flex flex-col gap-0.5 text-[0.62rem] text-muted ml-auto" id="nl-train-eye-info">
                  <span>${_NL_EYE_W}×${_NL_EYE_H} grayscale</span>
                  <span>2 channels</span>
                </div>
              </div>
            </div>
            <!-- Loss graph -->
            <div class="bg-card border border-border-card rounded-xl p-3" style="flex:1;display:flex;flex-direction:column;min-height:0;">
              <div class="flex items-center justify-between mb-1" style="flex-shrink:0;">
                <h3 class="text-[0.78rem] font-semibold text-primary">Loss</h3>
                <div class="flex items-center gap-3 text-[0.68rem] tabular-nums">
                  <span class="flex items-center gap-1"><span style="width:6px;height:2px;border-radius:1px;background:#f97316;display:inline-block;"></span><span class="text-dimmer">Train</span><span class="text-muted" id="nl-train-tloss-val">${_nlTrainLossHistory.length > 0 ? _nlTrainLossHistory[_nlTrainLossHistory.length - 1].train_loss?.toFixed(6) || '—' : '—'}</span></span>
                  <span class="flex items-center gap-1"><span style="width:6px;height:2px;border-radius:1px;background:#60a5fa;display:inline-block;"></span><span class="text-dimmer">Val</span><span class="text-muted" id="nl-train-loss-val">${latestLoss != null ? latestLoss.toFixed(6) : '—'}</span></span>
                </div>
              </div>
              <div style="flex:1;min-height:0;position:relative;">
                <canvas id="nl-train-loss-graph" style="width:100%;height:100%;display:block;"></canvas>
              </div>
            </div>
            <!-- Stats + result -->
            <div class="bg-card border border-border-card rounded-xl p-3" style="flex-shrink:0;">
              ${statsOrResultHTML}
            </div>
          </div>

          <!-- Right col: training log -->
          <div class="bg-card border border-border-card rounded-xl" style="display:flex;flex-direction:column;min-height:0;">
            <div class="flex items-center justify-between px-3 pt-3 pb-1" style="flex-shrink:0;">
              <h3 class="text-[0.78rem] font-semibold text-primary">Training Log</h3>
              <span class="text-[0.65rem] text-dimmer tabular-nums" id="nl-log-count">${_nlTrainLogs.length} lines</span>
            </div>
            <div id="nl-train-log" style="flex:1;min-height:0;overflow-y:auto;padding:0 12px 10px;font-family:'SF Mono',Monaco,Consolas,'Liberation Mono',monospace;font-size:0.75rem;line-height:1.65;color:var(--nr-text-primary,#e5e5e5);white-space:pre;tab-size:2;"></div>
          </div>
        </div>
      </div>

    </div>
  `;
  AetherUI.mount(RawHTML(trainDetailHTML), container);

  // Populate log from history
  const logEl = document.getElementById('nl-train-log');
  if (logEl && _nlTrainLogs.length > 0) {
    logEl.textContent = _nlTrainLogs.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }

  _nlRefreshTrainDetails();
  _nlDrawTrainLossGraph();
  _nlStartEyeCropPreview();
}

export let _nlEyeCropRAF = null;

export function _nlStartEyeCropPreview() {
  if (_nlEyeCropRAF) cancelAnimationFrame(_nlEyeCropRAF);
  function loop() {
    if (!document.getElementById('nl-train-eye-left')) { _nlEyeCropRAF = null; return; }
    _nlDrawEyeCrops();
    _nlEyeCropRAF = requestAnimationFrame(loop);
  }
  _nlEyeCropRAF = requestAnimationFrame(loop);
}

export function _nlDrawEyeCrops() {
  const leftCanvas = document.getElementById('nl-train-eye-left');
  const rightCanvas = document.getElementById('nl-train-eye-right');
  if (!leftCanvas || !rightCanvas) return;

  // Try live capture if video is available
  let data = _nlLastCapture;
  if (_nlFaceLandmarker && _nlVideoEl && _nlVideoEl.srcObject) {
    const live = _nlCaptureEyeCrops();
    if (live) data = live;
  }
  if (!data || !data.eyeData) return;

  const eyeSize = _NL_EYE_W * _NL_EYE_H;
  const raw = data.eyeData;

  // Channel 0 (landmarks 33/133) = user's right eye in raw video → display as left (mirrored)
  // Channel 1 (landmarks 263/362) = user's left eye in raw video → display as right (mirrored)
  // Swap channels so labels match the user's perspective (mirrored camera)
  const lCtx = leftCanvas.getContext('2d');
  const lImg = lCtx.createImageData(_NL_EYE_W, _NL_EYE_H);
  for (let i = 0; i < eyeSize; i++) {
    const v = raw[eyeSize + i];
    lImg.data[i * 4] = v; lImg.data[i * 4 + 1] = v; lImg.data[i * 4 + 2] = v; lImg.data[i * 4 + 3] = 255;
  }
  lCtx.putImageData(lImg, 0, 0);

  const rCtx = rightCanvas.getContext('2d');
  const rImg = rCtx.createImageData(_NL_EYE_W, _NL_EYE_H);
  for (let i = 0; i < eyeSize; i++) {
    const v = raw[i];
    rImg.data[i * 4] = v; rImg.data[i * 4 + 1] = v; rImg.data[i * 4 + 2] = v; rImg.data[i * 4 + 3] = 255;
  }
  rCtx.putImageData(rImg, 0, 0);

  // Update info with head pose
  const infoEl = document.getElementById('nl-train-eye-info');
  if (infoEl && data.headPose) {
    const [yaw, pitch, roll] = data.headPose;
    AetherUI.mount(RawHTML(`<span>${_NL_EYE_W}×${_NL_EYE_H} grayscale</span><span>yaw ${yaw.toFixed(2)} pitch ${pitch.toFixed(2)}</span>`), infoEl);
  }
}

export function _nlAppendTrainLog(line) {
  const logEl = document.getElementById('nl-train-log');
  if (!logEl) return;
  const wasAtBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
  logEl.textContent += (logEl.textContent ? '\n' : '') + line;
  if (wasAtBottom) logEl.scrollTop = logEl.scrollHeight;
  const countEl = document.getElementById('nl-log-count');
  if (countEl) countEl.textContent = _nlTrainLogs.length + ' lines';
}

export function _nlRefreshTrainView() {
  // Called on each SSE progress event — update in-place if the training view is visible
  if (!document.getElementById('nl-train-progbar')) return;

  const prog = _nlTrainProgress || {};
  const epoch = prog.epoch || 0;
  const maxEpochs = prog.max_epochs || 100;
  const pct = Math.round((epoch / maxEpochs) * 100);
  const latestLoss = _nlTrainLossHistory.length > 0 ? _nlTrainLossHistory[_nlTrainLossHistory.length - 1].val_loss : null;

  const bar = document.getElementById('nl-train-progbar');
  if (bar) bar.style.width = pct + '%';

  const lossLabel = document.getElementById('nl-train-loss-label');
  if (lossLabel) lossLabel.textContent = latestLoss != null ? `Val loss: ${latestLoss.toFixed(6)}` : '';

  const lossVal = document.getElementById('nl-train-loss-val');
  if (lossVal) lossVal.textContent = latestLoss != null ? latestLoss.toFixed(6) : '—';

  _nlRefreshTrainDetails();
  _nlDrawTrainLossGraph();
}

export function _nlRefreshTrainDetails() {
  const el = document.getElementById('nl-train-details');
  if (!el) return;
  const prog = _nlTrainProgress || {};
  const elapsed = Math.round((Date.now() - _nlTrainStartTime) / 1000);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const epoch = prog.epoch || 0;
  const maxEpochs = prog.max_epochs || 100;
  const rate = elapsed > 0 ? (epoch / elapsed).toFixed(1) : '—';
  const eta = elapsed > 0 && epoch > 0 && _nlTraining ? Math.round((maxEpochs - epoch) * elapsed / epoch) : null;
  const etaStr = eta != null ? (eta < 60 ? `~${eta}s` : `~${Math.floor(eta / 60)}m ${eta % 60}s`) : '—';
  const bestLoss = _nlTrainLossHistory.length > 0 ? Math.min(..._nlTrainLossHistory.map(h => h.val_loss)) : null;

  const row = (label, value) =>
    `<div class="text-muted">${label}</div><div class="text-primary font-medium tabular-nums">${value}</div>`;

  const detailsHTML =
    row('Architecture', _nlModelType === 'mobilenet' ? 'MobileNet + temporal LSTM (2ch 64x128 + hp+iris → proj 64 → LSTM 32 → 16 → 2)' : 'CNN + temporal LSTM (2ch 64x128 + hp+iris → proj 128 → LSTM 64 → 32 → 2)') +
    row('Input', `Eye crops ${_NL_EYE_W}x${_NL_EYE_H} x2 channels`) +
    row('Calibration Frames', `${_nlCalibData.length}`) +
    row('Calibration', `${_NL_CAL_POSITIONS.length} fixed grid points`) +
    row('Elapsed', elapsedStr) +
    row('Epoch', `${epoch} / ${maxEpochs}`) +
    row('Speed', `${rate} epochs/s`) +
    row('ETA', etaStr) +
    row('Best Val Loss', bestLoss != null ? bestLoss.toFixed(6) : '—') +
    row('Loss History', `${_nlTrainLossHistory.length} points`);
  AetherUI.mount(RawHTML(detailsHTML), el);
}

export function _nlDrawTrainLossGraph() {
  const canvas = document.getElementById('nl-train-loss-graph');
  if (!canvas || _nlTrainLossHistory.length < 2) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (w <= 0 || h <= 0) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const data = _nlTrainLossHistory;
  const valLosses = data.map(d => d.val_loss);
  const trainLosses = data.map(d => d.train_loss).filter(v => v != null);
  const allLosses = valLosses.concat(trainLosses);
  const maxEpoch = data[data.length - 1].epoch || 1;
  const min = Math.min(...allLosses);
  let max = Math.max(...allLosses);
  if (max === min) max = min + 0.001;
  // Clamp top to avoid early huge losses crushing the rest
  const p90 = allLosses.slice().sort((a, b) => a - b)[Math.floor(allLosses.length * 0.95)];
  if (p90 != null && max > p90 * 2) max = p90 * 2;

  // Axis margins
  const mLeft = 52 * dpr;   // space for y-axis labels
  const mBottom = 22 * dpr; // space for x-axis labels
  const mTop = 12 * dpr;
  const mRight = 12 * dpr;
  const plotW = w - mLeft - mRight;
  const plotH = h - mTop - mBottom;

  function toY(v) { return mTop + plotH * (1 - Math.max(0, Math.min(1, (v - min) / (max - min)))); }
  function toX(epoch) { return mLeft + (epoch / maxEpoch) * plotW; }

  // Grid lines
  const nTicksY = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = dpr;
  for (let i = 0; i <= nTicksY; i++) {
    const gy = mTop + plotH * (i / nTicksY);
    ctx.beginPath(); ctx.moveTo(mLeft, gy); ctx.lineTo(w - mRight, gy); ctx.stroke();
  }

  // Y-axis line + labels + ticks
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.moveTo(mLeft, mTop); ctx.lineTo(mLeft, mTop + plotH); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `${9 * dpr}px monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= nTicksY; i++) {
    const gy = mTop + plotH * (i / nTicksY);
    const val = max - (max - min) * (i / nTicksY);
    ctx.fillText(val.toFixed(4), mLeft - 5 * dpr, gy);
    // Tick mark
    ctx.beginPath(); ctx.moveTo(mLeft - 3 * dpr, gy); ctx.lineTo(mLeft, gy); ctx.stroke();
  }

  // X-axis line + labels + ticks
  ctx.beginPath(); ctx.moveTo(mLeft, mTop + plotH); ctx.lineTo(w - mRight, mTop + plotH); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const nTicksX = Math.min(5, maxEpoch);
  const xStep = Math.ceil(maxEpoch / nTicksX);
  for (let ep = 0; ep <= maxEpoch; ep += xStep) {
    const gx = toX(ep);
    ctx.fillText(String(ep), gx, mTop + plotH + 4 * dpr);
    ctx.beginPath(); ctx.moveTo(gx, mTop + plotH); ctx.lineTo(gx, mTop + plotH + 3 * dpr); ctx.stroke();
  }
  // Always label the last epoch
  if (maxEpoch % xStep !== 0) {
    const gx = toX(maxEpoch);
    ctx.fillText(String(maxEpoch), gx, mTop + plotH + 4 * dpr);
    ctx.beginPath(); ctx.moveTo(gx, mTop + plotH); ctx.lineTo(gx, mTop + plotH + 3 * dpr); ctx.stroke();
  }

  // Clip to plot area for curves
  ctx.save();
  ctx.beginPath();
  ctx.rect(mLeft, mTop, plotW, plotH);
  ctx.clip();

  // Draw a filled curve helper
  function drawCurve(values, color, fillAlpha) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let firstX = 0;
    for (let i = 0; i < data.length; i++) {
      const v = values[i];
      if (v == null) continue;
      const x = toX(data[i].epoch);
      const y = toY(v);
      if (i === 0 || values[i - 1] == null) { ctx.moveTo(x, y); firstX = x; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Fill
    const lastValid = data.length - 1;
    const lx = toX(data[lastValid].epoch);
    const bottom = mTop + plotH;
    ctx.lineTo(lx, bottom); ctx.lineTo(firstX, bottom); ctx.closePath();
    const grad = ctx.createLinearGradient(0, mTop, 0, bottom);
    grad.addColorStop(0, color + fillAlpha);
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Train loss (orange, lighter fill)
  if (trainLosses.length > 0) {
    drawCurve(data.map(d => d.train_loss), '#f97316', '12');
  }

  // Val loss (blue, slightly stronger fill)
  drawCurve(valLosses, '#60a5fa', '18');

  ctx.restore(); // remove clip

  // Best val loss marker
  const bestVal = Math.min(...valLosses);
  const bestIdx = valLosses.indexOf(bestVal);
  if (bestIdx >= 0) {
    const bx = toX(data[bestIdx].epoch);
    const by = toY(data[bestIdx].val_loss);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(bx, by, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    // Label
    ctx.fillStyle = 'rgba(74,222,128,0.7)';
    ctx.font = `${9 * dpr}px monospace`;
    ctx.textAlign = bx > w / 2 ? 'right' : 'left';
    ctx.fillText(bestVal.toFixed(5), bx + (bx > w / 2 ? -6 : 6) * dpr, by - 6 * dpr);
  }

  // Update legend values
  const tlv = document.getElementById('nl-train-tloss-val');
  const vlv = document.getElementById('nl-train-loss-val');
  if (tlv && data.length > 0) tlv.textContent = data[data.length - 1].train_loss?.toFixed(6) || '—';
  if (vlv && data.length > 0) vlv.textContent = data[data.length - 1].val_loss.toFixed(6);
}

// ── MediaPipe Initialization ──

export async function _nlInitMediapipe() {
  if (_nlFaceLandmarker) return true;
  if (!window.FaceLandmarker || !window.FilesetResolver) {
    await new Promise((resolve) => {
      if (window.FaceLandmarker && window.FilesetResolver) { resolve(); return; }
      const onReady = () => { window.removeEventListener('mediapipe-ready', onReady); resolve(); };
      window.addEventListener('mediapipe-ready', onReady);
      setTimeout(onReady, 15000);
    });
    if (!window.FaceLandmarker || !window.FilesetResolver) {
      _nlMpModelLoading = false;
      return false;
    }
  }
  _nlMpModelLoading = true;
  if (document.getElementById('neuralook-content')) renderNeuralookView();
  try {
    const vision = await window.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
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
    _nlMpModelLoading = false;
    _nlMpModelReady = true;
    return true;
  } catch (e) {
    logger.error('Neuralook: MediaPipe init error', e);
    _nlMpModelLoading = false;
    return false;
  }
}

// ── Eye Crop Capture ──

export function _nlGetEyeCropCanvas() {
  if (!_nlEyeCropCanvas) {
    _nlEyeCropCanvas = document.createElement('canvas');
    _nlEyeCropCanvas.width = _NL_EYE_W;
    _nlEyeCropCanvas.height = _NL_EYE_H;
  }
  return _nlEyeCropCanvas;
}

export function _nlCaptureEyeCrops() {
  // Detect face, crop both eyes from video, return as flat grayscale array [4096]
  if (!_nlFaceLandmarker || !_nlVideoEl) return null;
  const result = _nlFaceLandmarker.detectForVideo(_nlVideoEl, performance.now());
  if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) return null;
  const lm = result.faceLandmarks[0];

  const vw = _nlVideoEl.videoWidth;
  const vh = _nlVideoEl.videoHeight;
  if (!vw || !vh) return null;

  const canvas = _nlGetEyeCropCanvas();
  const ctx = canvas.getContext('2d');

  // Eye bounding boxes from landmarks (normalized 0-1 coords)
  // Left eye: outer=33, inner=133, top=159, bottom=145
  // Right eye: outer=263, inner=362, top=386, bottom=374
  function cropEye(outer, inner, top, bottom) {
    const cx = (lm[outer].x + lm[inner].x) / 2;
    const cy = (lm[top].y + lm[bottom].y) / 2;
    const ew = Math.abs(lm[inner].x - lm[outer].x) * 1.8; // 80% padding
    const eh = ew * 0.5; // 2:1 aspect ratio

    // Eye roll angle from outer→inner corner
    const angle = Math.atan2(
      (lm[inner].y - lm[outer].y) * vh,
      (lm[inner].x - lm[outer].x) * vw
    );

    canvas.width = _NL_EYE_W;
    canvas.height = _NL_EYE_H;

    // Counter-rotate to align eye horizontally
    ctx.save();
    ctx.translate(_NL_EYE_W / 2, _NL_EYE_H / 2);
    ctx.rotate(-angle);
    ctx.scale(_NL_EYE_W / (ew * vw), _NL_EYE_H / (eh * vh));
    ctx.drawImage(_nlVideoEl, -cx * vw, -cy * vh);
    ctx.restore();

    const imgData = ctx.getImageData(0, 0, _NL_EYE_W, _NL_EYE_H);
    const gray = new Uint8Array(_NL_EYE_W * _NL_EYE_H);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = Math.round(0.299 * imgData.data[i * 4] + 0.587 * imgData.data[i * 4 + 1] + 0.114 * imgData.data[i * 4 + 2]);
    }
    return gray;
  }

  const leftGray = cropEye(33, 133, 159, 145);
  const rightGray = cropEye(263, 362, 386, 374);
  if (!leftGray || !rightGray) return null;

  // Concatenate: [left eyeSize + right eyeSize]
  const eyeSize = _NL_EYE_W * _NL_EYE_H;
  const combined = new Uint8Array(eyeSize * 2);
  combined.set(leftGray, 0);
  combined.set(rightGray, eyeSize);

  // Head pose from landmarks (yaw, pitch, roll)
  const leftEyeX = lm[33].x, leftEyeY = lm[33].y;
  const rightEyeX = lm[263].x, rightEyeY = lm[263].y;
  const noseX = lm[1].x, noseY = lm[1].y;
  const foreheadY = lm[10].y, chinY = lm[152].y;
  const eyeSpan = rightEyeX - leftEyeX;
  const yaw = eyeSpan > 0.001 ? ((noseX - leftEyeX) / eyeSpan - 0.5) * 2 : 0;
  const faceH = chinY - foreheadY;
  const pitch = faceH > 0.001 ? ((noseY - foreheadY) / faceH - 0.5) * 2 : 0;
  const roll = Math.atan2((rightEyeY - leftEyeY) * vh, (rightEyeX - leftEyeX) * vw);

  // Iris features (6 values): left iris X/Y, right iris X/Y, left/right eye openness
  let irisFeatures = [0.5, 0.5, 0.5, 0.5, 0.3, 0.3]; // defaults
  if (lm.length > 477 && lm[468] && lm[473]) {
    // Left iris center = lm[468], eye corners: outer=33, inner=133, top=159, bottom=145
    const lIris = lm[468];
    const lOuter = lm[33], lInner = lm[133], lTop = lm[159], lBot = lm[145];
    const lEyeW = Math.abs(lInner.x - lOuter.x) || 0.001;
    const lEyeH = Math.abs(lBot.y - lTop.y) || 0.001;
    const lIrisX = (lIris.x - lOuter.x) / lEyeW;
    const lIrisY = (lIris.y - lTop.y) / lEyeH;

    // Right iris center = lm[473], eye corners: outer=263, inner=362, top=386, bottom=374
    const rIris = lm[473];
    const rOuter = lm[263], rInner = lm[362], rTop = lm[386], rBot = lm[374];
    const rEyeW = Math.abs(rInner.x - rOuter.x) || 0.001;
    const rEyeH = Math.abs(rBot.y - rTop.y) || 0.001;
    const rIrisX = (rIris.x - rOuter.x) / rEyeW;
    const rIrisY = (rIris.y - rTop.y) / rEyeH;

    // Eye openness (aspect ratio: vertical / horizontal)
    const lOpen = lEyeH / lEyeW;
    const rOpen = rEyeH / rEyeW;

    irisFeatures = [
      Math.max(0, Math.min(1, lIrisX)),
      Math.max(0, Math.min(1, lIrisY)),
      Math.max(0, Math.min(1, rIrisX)),
      Math.max(0, Math.min(1, rIrisY)),
      Math.max(0, Math.min(1, lOpen)),
      Math.max(0, Math.min(1, rOpen))
    ];
  }

  return { eyeData: combined, headPose: [yaw, pitch, roll], irisFeatures };
}

// ── Server Communication ──

export function _nlTrainOnServerSSE(onProgress, onLog, refine) {
  return new Promise((resolve, reject) => {
    const useSaved = _nlCalibSaved && _nlCalibData.length > 0;
    const samples = useSaved ? [] : _nlCalibData.map(s => ({
      eyeData: Array.from(s.eyeData),
      headPose: s.headPose,
      irisFeatures: s.irisFeatures,
      screenX: s.screenX,
      screenY: s.screenY
    }));

    const reqBody = {
      method: _nlModelType,
      samples,
      screenW: window.innerWidth,
      screenH: window.innerHeight,
      eyeW: _NL_EYE_W,
      eyeH: _NL_EYE_H
    };
    if (refine) reqBody.refine = true;

    _nlTrainAbort = new AbortController();
    const _nlModelLabel = (_nlModelType || 'cnn').toUpperCase();
    islandUpdate('ai-train', { type: 'ai', label: _nlModelLabel, detail: 'Training \u00B7 ' + _nlModelLabel });
    api('/api/neuralook/train', {
      method: 'POST',
      signal: _nlTrainAbort.signal,
      body: JSON.stringify(reqBody)
    }).then(resp => {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      function read() {
        reader.read().then(({ done, value }) => {
          if (done) { reject(new Error('Stream ended without result')); return; }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
            else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (currentEvent === 'log' && onLog) onLog(data.text);
                else if (currentEvent === 'progress' && onProgress) onProgress(data);
                else if (currentEvent === 'model_updated') {
                  _nlTrainError = data.train_error_px;
                  _nlValError = data.val_error_px;
                  _nlModelTrained = true;
                  _nlReady = true;
                  _nlModelVersion++;
                  _nlCheckGazeMasterAchievement();
                  _nlBaselineValError = data.val_error_px;
                  _nlShowModelUpdatedPill(_nlModelVersion, data.val_error_px);
                  if (onLog) onLog(`► Model updated to v${_nlModelVersion} — val ${data.val_error_px}px (epoch ${data.epoch})`);
                  _nlRefreshStats();
                } else if (currentEvent === 'done') {
                  _nlTrainError = data.train_error_px;
                  _nlValError = data.val_error_px || null;
                  _nlModelTrained = true;
                  islandRemove('ai-train');
                  resolve(data);
                  return;
                } else if (currentEvent === 'error') {
                  islandRemove('ai-train');
                  reject(new Error(data.error));
                  return;
                }
              } catch (_) {}
            }
          }
          read();
        }).catch(reject);
      }
      read();
    }).catch(reject);
  });
}

// ── Training Notification Pill ──

export let _nlTrainPill = null;

export function _nlShowTrainPill() {
  if (window.location.hash === '#neuralook') return;
  _nlDismissTrainPill();
  const pillView = new window.View('div').attr('id', 'nl-train-pill');
  pillView.styles({
    position: 'fixed', right: '20px', zIndex: '99999',
    background: 'var(--nr-bg-surface, #23232a)', border: '1px solid var(--nr-border-default, #2a2a2f)',
    borderRadius: '14px', padding: '10px 16px', minWidth: '220px', maxWidth: '360px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
    fontFamily: 'inherit', fontSize: '0.78rem', color: 'var(--nr-text-primary, #e5e5e5)',
    opacity: '0',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
  });
  const pill = pillView.el;
  if (window.Aether && Aether.materials) Aether.materials.apply(pill, 'regular');
  else { pill.style.backdropFilter = 'blur(12px)'; pill.style.WebkitBackdropFilter = 'blur(12px)'; }

  const spinnerSvg = '<svg width="18" height="18" viewBox="0 0 18 18" style="animation:nl-pill-spin 1s linear infinite"><circle cx="9" cy="9" r="7" fill="none" stroke="var(--nr-accent,#b4451a)" stroke-width="2" stroke-dasharray="30 14" stroke-linecap="round"/></svg>';
  const iconDiv = new window.View('div').attr('id', 'nl-pill-icon').cssText('width:18px;height:18px;flex-shrink:0;');
  iconDiv.add(window.RawHTML(spinnerSvg));

  const textDiv = window.VStack(
    window.Text('Training ' + _nlModelLabel()).attr('id', 'nl-pill-title').cssText('font-weight:600;font-size:0.8rem;'),
    window.Text('Starting... \u00b7 v' + (_nlModelVersion + 1)).attr('id', 'nl-pill-detail').cssText('font-size:0.7rem;color:var(--text-secondary,#888);')
  ).attr('id', 'nl-pill-text').cssText('flex:1;line-height:1.4;');

  const stopSvg = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="#f87171"/></svg>';
  const stopBtn = new window.View('div').attr('id', 'nl-pill-stop');
  stopBtn.cssText('width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;border:1px solid var(--border,#333);transition:border-color 0.2s;');
  stopBtn.add(window.RawHTML(stopSvg));
  stopBtn.on('click', function(ev) { ev.stopPropagation(); _nlStopTraining(); });
  stopBtn.on('mouseover', function() { stopBtn.el.style.borderColor = '#f87171'; });
  stopBtn.on('mouseout', function() { stopBtn.el.style.borderColor = 'var(--border,#333)'; });

  pillView.add(iconDiv, textDiv, stopBtn);
  pillView.onTap(function() { if (typeof openNeuralook === 'function') openNeuralook(); });
  document.body.append(pill);
  pillStackAdd('nl-train-pill');
  _nlTrainPill = pill;
  Motion.fadeIn(pill, { y: 10 });

  // Add spinner keyframes if not already present
  if (!document.getElementById('nl-pill-spin-style')) {
    const st = document.createElement('style');
    st.id = 'nl-pill-spin-style';
    st.textContent = '@keyframes nl-pill-spin { to { transform: rotate(360deg); } }';
    document.head.append(st);
  }
}

export function _nlTrainETA(epoch, maxEpochs) {
  if (!_nlTrainStartTime || epoch <= 0) return '';
  const elapsed = (Date.now() - _nlTrainStartTime) / 1000;
  const remaining = Math.round((maxEpochs - epoch) * elapsed / epoch);
  if (remaining <= 0) return '';
  return remaining < 60 ? ` · ~${remaining}s` : ` · ~${Math.floor(remaining / 60)}m${remaining % 60 ? ' ' + (remaining % 60) + 's' : ''}`;
}

export function _nlStopTraining() {
  if (_nlTrainAbort) { _nlTrainAbort.abort(); _nlTrainAbort = null; }
  _nlTraining = false;
  _nlAutoRefineInProgress = false;
  _nlUpdatePillIndicator();
  _nlTrainPhase = 'error';
  _nlTrainResult = { error: 'Stopped by user' };
  _nlErrorTrainPill('Stopped');
  _nlRefreshTrainView();
  renderNeuralookView();
}

export function _nlUpdateTrainPill(title, detail) {
  // Auto-show pill when navigating away from neuralook during training
  if (!_nlTrainPill && _nlTraining && window.location.hash !== '#neuralook') {
    _nlShowTrainPill();
  }
  // Auto-dismiss when on neuralook page
  if (_nlTrainPill && window.location.hash === '#neuralook') {
    _nlDismissTrainPill();
    return;
  }
  const t = document.getElementById('nl-pill-title');
  const d = document.getElementById('nl-pill-detail');
  if (t) t.textContent = title;
  if (d) d.textContent = detail;
}

export function _nlFinishTrainPill(title, detail, color) {
  const c = color || '#4ade80';
  const icon = document.getElementById('nl-pill-icon');
  if (icon) AetherUI.mount(RawHTML(`<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="${c}"/><path d="M5.5 9.5l2 2 5-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`), icon);
  const stopBtn = document.getElementById('nl-pill-stop');
  if (stopBtn) stopBtn.style.display = 'none';
  _nlUpdateTrainPill(title, detail);
  if (_nlTrainPill) {
    _nlTrainPill.style.cursor = 'pointer';
    _nlTrainPill.onclick = () => { _nlShowTrainView = true; openNeuralook(); _nlDismissTrainPill(); };
    // Animate: pulse glow
    _nlTrainPill.style.boxShadow = `0 0 0 0 ${c}66`;
    _nlTrainPill.style.borderColor = c;
    _nlTrainPill.animate([
      { boxShadow: `0 0 0 0 ${c}66`, transform: 'translateY(0) scale(1)' },
      { boxShadow: `0 0 20px 8px ${c}44`, transform: 'translateY(-2px) scale(1.03)' },
      { boxShadow: `0 0 0 0 ${c}00`, transform: 'translateY(0) scale(1)' }
    ], { duration: 600, iterations: 2, easing: 'ease-in-out' });
  }
  setTimeout(() => _nlDismissTrainPill(), 8000);
}

export function _nlErrorTrainPill(msg) {
  const icon = document.getElementById('nl-pill-icon');
  if (icon) AetherUI.mount(RawHTML(`<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#f87171"/><path d="M6 6l6 6M12 6l-6 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`), icon);
  const stopBtn = document.getElementById('nl-pill-stop');
  if (stopBtn) stopBtn.style.display = 'none';
  _nlUpdateTrainPill('Training Failed', msg);
  if (_nlTrainPill) _nlTrainPill.style.cursor = 'pointer';
  if (_nlTrainPill) _nlTrainPill.onclick = () => { openNeuralook(); _nlDismissTrainPill(); };
  setTimeout(() => _nlDismissTrainPill(), 8000);
}

export function _nlDismissTrainPill() {
  if (!_nlTrainPill) return;
  pillStackRemove('nl-train-pill');
  const p = _nlTrainPill;
  _nlTrainPill = null;
  Motion.fadeOut(p, { y: 10, remove: true });
}

export async function _nlPredictOnServer(eyeData, headPose, irisFeatures) {
  const body = {
    eyeData: Array.from(eyeData), headPose,
    irisFeatures: irisFeatures || [0.5, 0.5, 0.5, 0.5, 0.3, 0.3],
    method: _nlModelType,
    screenW: window.innerWidth, screenH: window.innerHeight
  };
  const resp = await api('/api/neuralook/predict', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const result = await resp.json();
  if (result.error) return null;
  return { x: result.x, y: result.y };
}

// ── Camera / Video ──

export async function _nlEnsureVideo() {
  if (_nlVideoEl && _nlVideoEl.srcObject) return _nlVideoEl;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 720 } });
  const vidView = new View('video').attr('autoplay', '').attr('muted', '').attr('playsinline', '');
  _nlVideoEl = vidView.el;
  _nlVideoEl.srcObject = stream;
  _nlVideoEl.autoplay = true;
  _nlVideoEl.muted = true;
  _nlVideoEl.playsInline = true;
  await new Promise(resolve => {
    _nlVideoEl.onloadeddata = resolve;
    if (_nlVideoEl.readyState >= 2) resolve();
  });
  return _nlVideoEl;
}

export function _nlStopVideo() {
  if (_nlVideoEl && _nlVideoEl.srcObject) {
    _nlVideoEl.srcObject.getTracks().forEach(t => t.stop());
    _nlVideoEl.srcObject = null;
  }
  _nlVideoEl = null;
}

export function _nlAttachCameraPreview() {
  const previewBox = document.getElementById('nl-camera-preview');
  if (!previewBox || previewBox.querySelector('video')) return;
  const vid = _nlVideoEl;
  if (vid && vid.srcObject) {
    const placeholder = document.getElementById('nl-camera-placeholder');
    if (placeholder) placeholder.remove();
    const cloneView = new View('video').styles({ position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' });
    const clone = cloneView.el;
    clone.srcObject = vid.srcObject;
    clone.autoplay = true;
    clone.muted = true;
    clone.playsInline = true;
    previewBox.append(clone);
    return;
  }
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      const box = document.getElementById('nl-camera-preview');
      if (!box || box.querySelector('video')) { stream.getTracks().forEach(t => t.stop()); return; }
      const ph = document.getElementById('nl-camera-placeholder');
      if (ph) ph.remove();
      const videoView = new View('video').styles({ position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' });
      const video = videoView.el;
      video.srcObject = stream;
      video.autoplay = true; video.muted = true; video.playsInline = true;
      box.append(video);
    }).catch(() => {});
  }
}

export function _nlToggleCamera() {
  if (_nlCameraOn) {
    _nlCameraOn = false;
    _nlUpdatePillIndicator();
    if (_nlTracking) _nlStopTracking();
    if (!_nlCalibrating) _nlStopVideo();
    const box = document.getElementById('nl-camera-preview');
    if (box) {
      const vid = box.querySelector('video');
      if (vid) vid.remove();
      if (!document.getElementById('nl-camera-placeholder')) {
        const ph = window.Text('Camera off').className('text-dimmer text-[0.75rem]').attr('id', 'nl-camera-placeholder');
        box.append(ph.el);
      }
    }
  } else {
    _nlCameraOn = true;
    _nlUpdatePillIndicator();
    _nlAttachCameraPreview();
    if (!(_nlVideoEl && _nlVideoEl.srcObject)) {
      const box = document.getElementById('nl-camera-preview');
      if (box && !box.querySelector('video')) {
        navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
          const b = document.getElementById('nl-camera-preview');
          if (!b || b.querySelector('video')) { stream.getTracks().forEach(t => t.stop()); return; }
          const ph = document.getElementById('nl-camera-placeholder');
          if (ph) ph.remove();
          const videoView = new View('video').styles({ position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' });
          const video = videoView.el;
          video.srcObject = stream;
          video.autoplay = true; video.muted = true; video.playsInline = true;
          b.append(video);
        }).catch(() => {});
      }
    }
  }
  const btn = document.getElementById('nl-camera-toggle');
  if (btn) btn.textContent = _nlCameraOn ? 'Turn Camera Off' : 'Turn Camera On';
}

// ── Calibration ──

export function _nlShowError(msg) {
  const el = document.getElementById('nl-error-msg');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

export async function _nlStartCalibration() {
  if (_nlCalibrating) return;

  _nlCalibrating = true;
  _nlUpdatePillIndicator();
  _nlCalibData = [];
  _nlModelTrained = false;
  _nlReady = false;
  _nlCurrentPoint = 0;
  _nlPredictionCount = 0;
  _nlTrainError = null;
  _nlValError = null;
  _nlGazeBuffer = [];
  renderNeuralookView();

  const mpOk = await _nlInitMediapipe();
  if (!mpOk) {
    _nlCalibrating = false;
    _nlUpdatePillIndicator();
    _nlShowError(_nlMpCdnLoaded ? 'Failed to initialize face model.' : 'MediaPipe CDN failed to load.');
    renderNeuralookView();
    return;
  }

  try {
    await _nlEnsureVideo();
    _nlCameraOn = true;
    _nlUpdatePillIndicator();
  } catch (e) {
    _nlCalibrating = false;
    _nlUpdatePillIndicator();
    _nlShowError('Camera error: ' + (e.message || e));
    renderNeuralookView();
    return;
  }

  // Enter fullscreen
  const el = document.documentElement;
  const reqFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
  if (reqFs) {
    try { await reqFs.call(el); } catch (e) {
      _nlCalibrating = false;
      _nlUpdatePillIndicator();
      _nlShowError('Fullscreen required for calibration.');
      renderNeuralookView();
      return;
    }
    document.addEventListener('fullscreenchange', _nlFullscreenChange);
    document.addEventListener('webkitfullscreenchange', _nlFullscreenChange);
  }

  _nlShowCalibrationOverlay();
  renderNeuralookView();
}

export function _nlFullscreenChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFs && _nlCalibrating) {
    _nlCalibrating = false;
    _nlUpdatePillIndicator();
    _nlCurrentPoint = 0;
    const overlay = document.getElementById('nl-calibration-overlay');
    if (overlay) overlay.remove();
    renderNeuralookView();
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
  if (_nlVideoEl && _nlVideoEl.srcObject) {
    const camBoxView = new window.View('div');
    camBoxView.styles({
      position: 'absolute', bottom: '50px', right: '24px', width: '180px', height: '135px',
      borderRadius: '10px', overflow: 'hidden', zIndex: '100000',
      border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 4px 16px rgba(0,0,0,0.5)'
    });
    const camBox = camBoxView.el;
    const camVidView = new View('video').styles({ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' });
    const camVid = camVidView.el;
    camVid.srcObject = _nlVideoEl.srcObject;
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
  _nlCurrentPoint = 0;
  _nlShowNextCalibrationDot();
}

export function _nlShowNextCalibrationDot() {
  const overlay = document.getElementById('nl-calibration-overlay');
  if (!overlay) return;

  const prev = document.getElementById('nl-cal-dot');
  if (prev) prev.remove();
  const prevRing = document.getElementById('nl-cal-ring');
  if (prevRing) prevRing.remove();

  if (_nlCurrentPoint >= _NL_CAL_POSITIONS.length) {
    _nlOnCalibrationComplete();
    return;
  }

  const [xPct, yPct] = _NL_CAL_POSITIONS[_nlCurrentPoint];

  const instr = document.getElementById('nl-cal-instr');
  if (instr) {
    AetherUI.mount(RawHTML(`<strong>Calibration</strong> &mdash; Point ${_nlCurrentPoint + 1}/${_NL_CAL_POSITIONS.length}, look at the dot`), instr);
  }

  const progFill = document.getElementById('nl-cal-progfill');
  if (progFill) progFill.style.width = Math.round((_nlCurrentPoint / _NL_CAL_POSITIONS.length) * 100) + '%';

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
        _nlCurrentPoint++;
        setTimeout(() => { dot.remove(); ring.remove(); _nlShowNextCalibrationDot(); }, 80);
        return;
      }

      const capture = _nlCaptureEyeCrops();
      if (capture) {
        _nlCalibData.push({ eyeData: capture.eyeData, headPose: capture.headPose, irisFeatures: capture.irisFeatures, screenX, screenY });
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
      samples: _nlCalibData.map(s => ({
        eyeData: Array.from(s.eyeData),
        headPose: s.headPose,
        irisFeatures: s.irisFeatures,
        screenX: s.screenX, screenY: s.screenY
      })),
      screenW: window.innerWidth, screenH: window.innerHeight,
      eyeW: _NL_EYE_W, eyeH: _NL_EYE_H
    };
    await apiPost('/api/neuralook/save-calibration', calibPayload);
    _nlCalibSaved = true;
  } catch (e) { logger.warn('Neuralook: failed to save calibration', e); }

  _nlTraining = true;
  _nlUpdatePillIndicator();
  _nlTrainPhase = 'training';
  _nlTrainProgress = null;
  _nlTrainResult = null;
  _nlTrainLossHistory = [];
  _nlTrainLogs = [];
  _nlTrainStartTime = Date.now();
  _nlShowTrainView = true;
  _nlShowTrainPill();
  renderNeuralookView();

  try {
    const result = await _nlTrainOnServerSSE((prog) => {
      _nlTrainProgress = prog;
      _nlTrainPhase = prog.phase || 'training';
      if (prog.val_loss != null) _nlTrainLossHistory.push({ epoch: prog.epoch, val_loss: prog.val_loss, train_loss: prog.train_loss });
      if (prog.model_ready && !_nlModelTrained) {
        _nlModelTrained = true;
        _nlReady = true;
        _nlTrainLogs.push('✓ Model ready — tracking available');
        _nlAppendTrainLog('✓ Model ready — tracking available');
      }
      if (prog.phase === 'evaluating') {
        _nlUpdateTrainPill('Training ' + _nlModelLabel() + ' v' + (_nlModelVersion + 1), 'Evaluating...');
      } else {
        const pct = Math.round((prog.epoch / prog.max_epochs) * 100);
        const loss = prog.val_loss != null ? ` · loss ${prog.val_loss.toFixed(4)}` : '';
        const eta = _nlTrainETA(prog.epoch, prog.max_epochs);
        _nlUpdateTrainPill('Training ' + _nlModelLabel() + ' v' + (_nlModelVersion + 1), `Epoch ${prog.epoch}/${prog.max_epochs} (${pct}%)${loss}${eta}`);
      }
      _nlRefreshTrainView();
      _nlRefreshBanner();
    }, (logLine) => {
      _nlTrainLogs.push(logLine);
      _nlAppendTrainLog(logLine);
    });

    _nlTrainResult = result;
    _nlTrainPhase = 'done';
    _nlTraining = false;
    _nlUpdatePillIndicator();
    _nlReady = true;
    _nlModelVersion++;
    _nlCheckGazeMasterAchievement();

    const valPx = result.val_error_px;
    _nlBaselineValError = valPx;
    _nlUpdateAdaptiveRadius(valPx);
    const label = valPx < 80 ? 'Good' : valPx < 150 ? 'Fair' : 'Poor';
    const color = valPx < 80 ? '#4ade80' : valPx < 150 ? '#fbbf24' : '#f87171';
    _nlFinishTrainPill('Training Done — v' + _nlModelVersion, `Val ${valPx}px — ${label}`, color);
    _nlShowModelUpdatedPill(_nlModelVersion, valPx);
    _nlRefreshTrainView();
    renderNeuralookView();
  } catch (e) {
    _nlTrainPhase = 'error';
    _nlTraining = false;
    _nlUpdatePillIndicator();
    _nlTrainResult = { error: e.message || String(e) };
    _nlErrorTrainPill(e.message || String(e));
    _nlRefreshTrainView();
    renderNeuralookView();
  }
}

export function _nlFinishCalibration() {
  _nlCalibrating = false;
  _nlUpdatePillIndicator();
  const overlay = document.getElementById('nl-calibration-overlay');
  if (overlay) overlay.remove();

  const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
  if (exitFs && (document.fullscreenElement || document.webkitFullscreenElement)) exitFs.call(document);
  renderNeuralookView();
}

// ── Shared prediction → gaze smoothing ──

export function _nlApplyGazePrediction(pred) {
  _nlGazeBuffer.push(pred);
  if (_nlGazeBuffer.length > _NL_BUFFER_SIZE) _nlGazeBuffer.shift();
  let sx = 0, sy = 0;
  for (const p of _nlGazeBuffer) { sx += p.x; sy += p.y; }
  _nlGazeX = sx / _nlGazeBuffer.length;
  _nlGazeY = sy / _nlGazeBuffer.length;
  _nlMoveDot(_nlGazeX, _nlGazeY);
  _nlSessionPredictions++;
  _nlUpdateHeatmap(_nlGazeX, _nlGazeY);
  _nlDetectFixation(_nlGazeX, _nlGazeY, Date.now());
}

// ── Tracking Loop ──

export function _nlTrackingLoop() {
  if (!_nlTracking || !_nlFaceLandmarker || !_nlVideoEl) {
    _nlTrackingRAF = null;
    return;
  }

  if (!_nlInferPending) {
    const capture = _nlCaptureEyeCrops();
    if (capture) {
      _nlLastCapture = { ...capture, ts: performance.now() };
      _nlInferPending = true;
      _nlPredictOnServer(capture.eyeData, capture.headPose, capture.irisFeatures).then(pred => {
        _nlInferPending = false;
        if (!pred || !_nlTracking) return;
        _nlLastPrediction = { ...pred, ts: performance.now() };
        _nlPredictionCount++;
        _nlPredictionsThisSec++;
        _nlApplyGazePrediction(pred);
      }).catch(() => { _nlInferPending = false; });
    }
  }

  _nlTrackingRAF = requestAnimationFrame(_nlTrackingLoop);
}

export function _nlToggleTracking() {
  if (_nlTracking) _nlStopTracking();
  else _nlStartTracking();
}

export async function _nlStartTracking() {
  if (!_nlReady || !_nlModelTrained) return;
  try { await _nlEnsureVideo(); } catch (e) {
    _nlShowError('Camera error: ' + (e.message || e));
    return;
  }
  // Reset LSTM hidden state for fresh tracking session
  apiPost('/api/neuralook/reset-hidden', { method: _nlModelType }).catch(e => logger.warn('[neuralook] Reset hidden state failed:', e));
  _nlTracking = true;
  _nlResetSessionStats();
  _nlUpdatePillIndicator();
  _nlGazeBuffer = [];
  _nlCreateDot();
  _nlTrackingRAF = requestAnimationFrame(_nlTrackingLoop);
  // Start collecting implicit click samples (each click triggers flush + refine)
  document.addEventListener('click', _nlHandleImplicitClick, true);
  // Safety-net timed buffer flush (30s) in case clicks don't trigger flush
  _nlTimedFlushInterval = setInterval(() => {
    if (_nlImplicitBuffer.length > 0) _nlFlushImplicitSamples();
  }, 30000);
  _nlFetchImplicitCount();
  _nlLoadRefinementHistory();
  renderNeuralookView();
}

export function _nlStopTracking() {
  _nlTracking = false;
  _nlUpdatePillIndicator();
  if (_nlTrackingRAF) { cancelAnimationFrame(_nlTrackingRAF); _nlTrackingRAF = null; }
  document.removeEventListener('click', _nlHandleImplicitClick, true);
  // Clear timed flush interval
  if (_nlTimedFlushInterval) { clearInterval(_nlTimedFlushInterval); _nlTimedFlushInterval = null; }
  // Flush remaining implicit samples
  if (_nlImplicitBuffer.length > 0) _nlFlushImplicitSamples();
  _nlRemoveDot();
  // Also turn off camera
  if (_nlCameraOn) { _nlCameraOn = false; _nlStopVideo(); }
  renderNeuralookView();
}

export function _nlHandleImplicitClick(e) {
  if (!_nlTracking || !_nlLastCapture || !_nlLastPrediction) return;
  // Freshness: prediction must be < 500ms old
  const now = performance.now();
  const age = Math.round(now - _nlLastPrediction.ts);
  if (age > 500) {
    logger.debug(`neuralook click rejected: prediction too old (${age}ms)`);
    _nlShowClickFeedback(e.clientX, e.clientY, false, `stale ${age}ms`);
    return;
  }
  const dx = _nlLastPrediction.x - e.clientX;
  const dy = _nlLastPrediction.y - e.clientY;
  const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
  logger.debug(`neuralook implicit click collected — dist=${dist}px, age=${age}ms, buffer=${_nlImplicitBuffer.length + 1}`);
  _nlShowClickFeedback(e.clientX, e.clientY, true, `${dist}px`);
  _nlImplicitBuffer.push({
    eyeData: Array.from(_nlLastCapture.eyeData),
    headPose: _nlLastCapture.headPose,
    irisFeatures: _nlLastCapture.irisFeatures,
    screenX: e.clientX,
    screenY: e.clientY
  });
  // Flush and trigger refine immediately on every click
  _nlFlushImplicitSamples().then(() => _nlCheckAutoRefine());
}

export function _nlFlushImplicitSamples() {
  if (_nlImplicitBuffer.length === 0) return Promise.resolve();
  const samples = _nlImplicitBuffer.splice(0);
  _nlImplicitLastFlush = Date.now();
  return apiPost('/api/neuralook/implicit-samples', { samples }).then(data => {
    if (data.count != null) _nlImplicitCount = data.count;
  }).catch(e => logger.warn('[neuralook] Flush implicit samples failed:', e));
}

export function _nlFetchImplicitCount() {
  apiGet('/api/neuralook/implicit-samples')
    .then(data => { if (data.count != null) _nlImplicitCount = data.count; })
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
  if (!_nlTracking || !_nlModelTrained || _nlTraining || _nlAutoRefineInProgress || !_nlAutoRefineEnabled) return;
  _nlStartAutoRefine();
}

export async function _nlStartAutoRefine() {
  _nlAutoRefineInProgress = true;
  _nlRefreshStats();
  // Flush pending buffer first
  if (_nlImplicitBuffer.length > 0) {
    const samples = _nlImplicitBuffer.splice(0);
    _nlImplicitLastFlush = Date.now();
    try {
      const data = await apiPost('/api/neuralook/implicit-samples', { samples });
      if (data.count != null) _nlImplicitCount = data.count;
    } catch (_) {}
  }
  // Use the full SSE training flow with refine=true (shows training detail view)
  _nlTraining = true;
  _nlUpdatePillIndicator();
  _nlTrainPhase = 'training';
  _nlTrainProgress = null;
  _nlTrainResult = null;
  _nlTrainLossHistory = [];
  _nlTrainLogs = [];
  _nlTrainStartTime = Date.now();
  _nlShowTrainView = true;
  _nlShowTrainPill();
  if (window.location.hash === '#neuralook') renderNeuralookView();

  try {
    const result = await _nlTrainOnServerSSE((prog) => {
      _nlTrainProgress = prog;
      _nlTrainPhase = prog.phase || 'training';
      if (prog.val_loss != null) _nlTrainLossHistory.push({ epoch: prog.epoch, val_loss: prog.val_loss, train_loss: prog.train_loss });
      if (prog.phase === 'evaluating') {
        _nlUpdateTrainPill('Refining ' + _nlModelLabel() + ' v' + (_nlModelVersion + 1), 'Evaluating...');
      } else {
        const pct = Math.round((prog.epoch / prog.max_epochs) * 100);
        const loss = prog.val_loss != null ? ` · loss ${prog.val_loss.toFixed(4)}` : '';
        const eta = _nlTrainETA(prog.epoch, prog.max_epochs);
        _nlUpdateTrainPill('Refining ' + _nlModelLabel() + ' v' + (_nlModelVersion + 1), `Epoch ${prog.epoch}/${prog.max_epochs} (${pct}%)${loss}${eta}`);
      }
      _nlRefreshTrainView();
      _nlRefreshBanner();
    }, (logLine) => {
      _nlTrainLogs.push(logLine);
      _nlAppendTrainLog(logLine);
    }, true);

    _nlTrainResult = result;
    _nlTrainPhase = 'done';
    _nlTraining = false;
    _nlUpdatePillIndicator();
    _nlReady = true;
    _nlModelVersion++;
    _nlCheckGazeMasterAchievement();
    _nlLastAutoRefineTime = Date.now();

    const valPx = result.val_error_px;
    _nlBaselineValError = valPx;
    _nlValError = valPx;
    _nlTrainError = result.train_error_px;
    _nlImplicitCount = 0;
    _nlUpdateAdaptiveRadius(valPx);
    _nlRefinementHistory.push({
      timestamp: Date.now(), val_error_px: valPx,
      train_error_px: result.train_error_px, samples: result.samples, improved: true
    });
    _nlSaveRefinementHistory();

    const label = valPx < 80 ? 'Good' : valPx < 150 ? 'Fair' : 'Poor';
    const color = valPx < 80 ? '#4ade80' : valPx < 150 ? '#fbbf24' : '#f87171';
    _nlFinishTrainPill('Refine Done — v' + _nlModelVersion, `Val ${valPx}px — ${label}`, color);
    _nlShowModelUpdatedPill(_nlModelVersion, valPx);
    _nlRefreshTrainView();
    if (window.location.hash === '#neuralook') renderNeuralookView();
    logger.debug(`neuralook auto-refine improved: v${_nlModelVersion}, val=${valPx}px, radius=${_nlAdaptiveRadius}px`);
  } catch (e) {
    _nlTrainPhase = 'error';
    _nlTraining = false;
    _nlUpdatePillIndicator();
    _nlTrainResult = { error: e.message || String(e) };
    _nlErrorTrainPill(e.message || String(e));
    _nlLastAutoRefineTime = Date.now();
    _nlRefinementHistory.push({
      timestamp: Date.now(), val_error_px: null,
      train_error_px: null, samples: 0, improved: false
    });
    _nlSaveRefinementHistory();
    _nlRefreshTrainView();
    if (window.location.hash === '#neuralook') renderNeuralookView();
    logger.warn('[neuralook] auto-refine error:', e);
  } finally {
    _nlAutoRefineInProgress = false;
    _nlRefreshStats();
  }
}

export function _nlUpdateAdaptiveRadius(valErrorPx) {
  _nlAdaptiveRadius = Math.max(350, Math.min(600, Math.round(valErrorPx * 4)));
}

export function _nlSaveRefinementHistory() {
  try {
    if (_nlRefinementHistory.length > 100) _nlRefinementHistory = _nlRefinementHistory.slice(-100);
    Settings.setJSON('nlRefinementHistory', _nlRefinementHistory);
  } catch (_) {}
}

export function _nlLoadRefinementHistory() {
  try {
    const loaded = Settings.getJSON('nlRefinementHistory', null);
    if (loaded) {
      _nlRefinementHistory = loaded;
      // Restore baseline from last accepted refine
      for (let i = _nlRefinementHistory.length - 1; i >= 0; i--) {
        if (_nlRefinementHistory[i].improved) {
          _nlBaselineValError = _nlRefinementHistory[i].val_error_px;
          _nlUpdateAdaptiveRadius(_nlBaselineValError);
          break;
        }
      }
    }
  } catch (_) {}
}

export function _nlRefineModel() {
  if (_nlTraining) return;
  _nlTraining = true;
  _nlUpdatePillIndicator();
  _nlTrainPhase = 'training';
  _nlTrainProgress = null;
  _nlTrainResult = null;
  _nlTrainLossHistory = [];
  _nlTrainLogs = [];
  _nlTrainStartTime = Date.now();
  _nlShowTrainView = true;
  _nlShowTrainPill();
  renderNeuralookView();

  _nlTrainOnServerSSE((prog) => {
    _nlTrainProgress = prog;
    _nlTrainPhase = prog.phase || 'training';
    if (prog.val_loss != null) _nlTrainLossHistory.push({ epoch: prog.epoch, val_loss: prog.val_loss, train_loss: prog.train_loss });
    if (prog.phase === 'evaluating') {
      _nlUpdateTrainPill('Refining ' + _nlModelLabel() + ' → v' + (_nlModelVersion + 1), 'Evaluating...');
    } else {
      const pct = Math.round((prog.epoch / prog.max_epochs) * 100);
      const loss = prog.val_loss != null ? ` · loss ${prog.val_loss.toFixed(4)}` : '';
      const eta = _nlTrainETA(prog.epoch, prog.max_epochs);
      _nlUpdateTrainPill('Refining ' + _nlModelLabel() + ' → v' + (_nlModelVersion + 1), `Epoch ${prog.epoch}/${prog.max_epochs} (${pct}%)${loss}${eta}`);
    }
    _nlRefreshTrainView();
    _nlRefreshBanner();
  }, (logLine) => {
    _nlTrainLogs.push(logLine);
    _nlAppendTrainLog(logLine);
  }, true /* refine */).then(result => {
    _nlTrainResult = result;
    _nlTrainPhase = 'done';
    _nlTraining = false;
    _nlUpdatePillIndicator();
    _nlReady = true;
    _nlModelVersion++;
    _nlCheckGazeMasterAchievement();
    _nlImplicitCount = 0; // cleared on server
    const valPx = result.val_error_px;
    _nlBaselineValError = valPx;
    _nlUpdateAdaptiveRadius(valPx);
    const label = valPx < 80 ? 'Good' : valPx < 150 ? 'Fair' : 'Poor';
    const color = valPx < 80 ? '#4ade80' : valPx < 150 ? '#fbbf24' : '#f87171';
    _nlFinishTrainPill('Refinement Done — v' + _nlModelVersion, `Val ${valPx}px — ${label}`, color);
    _nlShowModelUpdatedPill(_nlModelVersion, valPx);
    _nlRefreshTrainView();
    renderNeuralookView();
  }).catch(e => {
    _nlTrainPhase = 'error';
    _nlTraining = false;
    _nlUpdatePillIndicator();
    _nlTrainResult = { error: e.message || String(e) };
    _nlErrorTrainPill(e.message || String(e));
    _nlRefreshTrainView();
    renderNeuralookView();
  });
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
  _nlGazeDot = dotView.el;
}

export function _nlRemoveDot() {
  if (_nlGazeDot) { _nlGazeDot.remove(); _nlGazeDot = null; }
  const existing = document.getElementById('nl-gaze-dot');
  if (existing) existing.remove();
}

export function _nlMoveDot(x, y) {
  if (!_nlGazeDot) return;
  _nlGazeDot.style.left = x + 'px';
  _nlGazeDot.style.top = y + 'px';
}

// ── Stats & Graphs ──

export function _nlStartStatsInterval() {
  _nlStopStatsInterval();
  _nlStatsInterval = setInterval(() => {
    if (_nlTracking) {
      if (!document.getElementById('nl-dash-rate')) { _nlStopStatsInterval(); return; }
      _nlRefreshDashboard();
    } else {
      if (!document.getElementById('nl-model-stats')) { _nlStopStatsInterval(); return; }
      _nlRefreshStats();
    }
  }, 500);
  _nlRateInterval = setInterval(() => { _nlPredictionRate = _nlPredictionsThisSec; _nlPredictionsThisSec = 0; }, 1000);
}

export function _nlStopStatsInterval() {
  if (_nlStatsInterval) { clearInterval(_nlStatsInterval); _nlStatsInterval = null; }
  if (_nlRateInterval) { clearInterval(_nlRateInterval); _nlRateInterval = null; }
}

export function _nlComputeJitter() {
  if (_nlGazeBuffer.length < 2) return 0;
  let sx = 0, sy = 0;
  for (const p of _nlGazeBuffer) { sx += p.x; sy += p.y; }
  const mx = sx / _nlGazeBuffer.length, my = sy / _nlGazeBuffer.length;
  let v = 0;
  for (const p of _nlGazeBuffer) v += (p.x - mx) ** 2 + (p.y - my) ** 2;
  return Math.sqrt(v / _nlGazeBuffer.length);
}

export function _nlRefreshBanner() {
  const el = document.getElementById('nl-banner-detail');
  if (!el || !_nlTraining) return;
  const prog = _nlTrainProgress || {};
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

  const jitter = _nlTracking ? Math.round(_nlComputeJitter()) : null;
  const jitterColor = jitter !== null ? (jitter < 30 ? '#4ade80' : jitter < 70 ? '#fbbf24' : '#f87171') : '#6b7280';

  const row = (label, value, color) =>
    `<div class="text-muted">${label}</div><div class="text-primary font-medium tabular-nums" ${color ? `style="color:${color}"` : ''}>${value}</div>`;

  const implicitInfo = _nlImplicitCount > 0 ? `${_nlImplicitCount} clicks` + (_nlImplicitBuffer.length > 0 ? ` (+${_nlImplicitBuffer.length} pending)` : '') : _nlImplicitBuffer.length > 0 ? `${_nlImplicitBuffer.length} pending` : '<span class="text-dimmer">None</span>';

  const refineCount = _nlRefinementHistory.filter(h => h.improved).length;
  const bestError = _nlBaselineValError !== null ? `${_nlBaselineValError}px` : '<span class="text-dimmer">—</span>';
  const autoRefineStatus = _nlAutoRefineInProgress ? '<span style="color:var(--nr-accent)">Refining...</span>'
    : _nlAutoRefineEnabled ? '<span style="color:#4ade80">Active</span>'
    : '<span class="text-dimmer">Off</span>';

  const statsHTML =
    row('Model', `${_nlModelLabel()} v${_nlModelVersion} + temporal LSTM`) +
    row('Input', `Eye crops ${_NL_EYE_W}x${_NL_EYE_H} x2 + aux(9)`) +
    row('Calibration', `${_nlCalibData.length} frames (${_NL_CAL_POSITIONS.length} points)`) +
    row('Status', _nlModelTrained ? '<span style="color:#4ade80">Trained</span>' : '<span class="text-dimmer">Not trained</span>') +
    (_nlTrainError !== null ? row('Train error', `${_nlTrainError}px`) : '') +
    (_nlValError !== null ? row('Val error', `${_nlValError}px`) : '') +
    row('Prediction rate', _nlTracking ? `${_nlPredictionRate} Hz` : '<span class="text-dimmer">Inactive</span>') +
    row('Gaze', _nlTracking ? `${Math.round(_nlGazeX)}, ${Math.round(_nlGazeY)}` : '<span class="text-dimmer">Inactive</span>') +
    row('Jitter', jitter !== null ? `${jitter}px` : '<span class="text-dimmer">Inactive</span>', jitter !== null ? jitterColor : null) +
    row('Predictions', `${_nlPredictionCount.toLocaleString()}`) +
    row('Implicit clicks', implicitInfo) +
    row('Auto-refine', autoRefineStatus) +
    row('Refinements', refineCount > 0 ? `${refineCount}` : '<span class="text-dimmer">0</span>') +
    row('Best val error', bestError) +
    row('Confidence radius', `${_nlAdaptiveRadius}px`) +
    (_nlImplicitCount > 0 && !_nlTraining && _nlModelTrained ? `<div class="col-span-2 mt-1"><button onclick="_nlRefineModel()" class="px-3 py-1 rounded-lg border border-border-input bg-card text-primary text-[0.75rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors w-full">Refine Model (${_nlImplicitCount} clicks)</button></div>` : '');
  AetherUI.mount(RawHTML(statsHTML), el);

  // Update banner detail if training is in progress
  _nlRefreshBanner();
}

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

// ── Session Stats Dashboard ──

export function _nlResetSessionStats() {
  _nlSessionStartTime = Date.now();
  _nlSessionPredictions = 0;
  _nlHeatmapGrid = new Array(_NL_HEATMAP_COLS * _NL_HEATMAP_ROWS).fill(0);
  _nlHeatmapMax = 0;
  _nlFixationCount = 0;
  _nlFixationDurations = [];
  _nlSaccadeCount = 0;
  _nlCurrentFixation = null;
  _nlHistGazeX = [];
  _nlHistGazeY = [];
  _nlHistJitter = [];
  _nlHistRate = [];
}

export function _nlPushHistorySample() {
  _nlHistRate.push(_nlPredictionRate);
  _nlHistJitter.push(_nlTracking ? Math.round(_nlComputeJitter()) : null);
  _nlHistGazeX.push(_nlTracking ? Math.round(_nlGazeX) : null);
  _nlHistGazeY.push(_nlTracking ? Math.round(_nlGazeY) : null);
  if (_nlHistRate.length > _NL_GRAPH_LEN) _nlHistRate.shift();
  if (_nlHistJitter.length > _NL_GRAPH_LEN) _nlHistJitter.shift();
  if (_nlHistGazeX.length > _NL_GRAPH_LEN) _nlHistGazeX.shift();
  if (_nlHistGazeY.length > _NL_GRAPH_LEN) _nlHistGazeY.shift();
}

export function _nlUpdateHeatmap(x, y) {
  const col = Math.floor((x / window.innerWidth) * _NL_HEATMAP_COLS);
  const row = Math.floor((y / window.innerHeight) * _NL_HEATMAP_ROWS);
  if (col < 0 || col >= _NL_HEATMAP_COLS || row < 0 || row >= _NL_HEATMAP_ROWS) return;
  const idx = row * _NL_HEATMAP_COLS + col;
  _nlHeatmapGrid[idx]++;
  if (_nlHeatmapGrid[idx] > _nlHeatmapMax) _nlHeatmapMax = _nlHeatmapGrid[idx];
}

export function _nlHeatColor(t) {
  // 5-stop gradient: dark blue → blue → cyan → yellow → red
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
  const mx = _nlHeatmapMax || 1;
  for (let r = 0; r < _NL_HEATMAP_ROWS; r++) {
    for (let c = 0; c < _NL_HEATMAP_COLS; c++) {
      const v = _nlHeatmapGrid[r * _NL_HEATMAP_COLS + c];
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
  if (!_nlCurrentFixation) {
    _nlCurrentFixation = { cx: x, cy: y, startTs: ts, points: [{ x, y }] };
    return;
  }
  const f = _nlCurrentFixation;
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
      _nlFixationCount++;
      _nlFixationDurations.push(dur);
      _nlSaccadeCount++;
    }
    _nlCurrentFixation = { cx: x, cy: y, startTs: ts, points: [{ x, y }] };
  }
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
              <div class="flex justify-between"><span class="text-muted">Avg Dur</span><span class="text-primary tabular-nums" id="nl-dash-avgdur">—</span></div>
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
  if (!_nlTracking || !document.getElementById('nl-dash-rate')) return;

  _nlPushHistorySample();

  // Sparklines
  _nlDrawGraph('nl-spark-rate', _nlHistRate, '#4ade80', 0, null);
  _nlDrawGraph('nl-spark-jitter', _nlHistJitter, '#fbbf24', 0, null);
  _nlDrawGraph('nl-spark-gazex', _nlHistGazeX, '#60a5fa', 0, window.innerWidth);
  _nlDrawGraph('nl-spark-gazey', _nlHistGazeY, '#a78bfa', 0, window.innerHeight);

  // Sparkline values
  const rateEl = document.getElementById('nl-dash-rate');
  if (rateEl) rateEl.textContent = _nlPredictionRate + ' Hz';
  const jitterEl = document.getElementById('nl-dash-jitter');
  if (jitterEl) jitterEl.textContent = Math.round(_nlComputeJitter()) + 'px';
  const gxEl = document.getElementById('nl-dash-gazex');
  if (gxEl) gxEl.textContent = Math.round(_nlGazeX);
  const gyEl = document.getElementById('nl-dash-gazey');
  if (gyEl) gyEl.textContent = Math.round(_nlGazeY);

  // Heatmap
  _nlDrawHeatmap();

  // Session stats
  const elapsed = Math.round((Date.now() - _nlSessionStartTime) / 1000);
  const durEl = document.getElementById('nl-dash-duration');
  if (durEl) durEl.textContent = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const fixEl = document.getElementById('nl-dash-fixations');
  if (fixEl) fixEl.textContent = _nlFixationCount.toLocaleString();
  const avgEl = document.getElementById('nl-dash-avgdur');
  if (avgEl) avgEl.textContent = _nlFixationDurations.length > 0 ? Math.round(_nlFixationDurations.reduce((a, b) => a + b, 0) / _nlFixationDurations.length) + 'ms' : '—';
  const sacEl = document.getElementById('nl-dash-saccades');
  if (sacEl) sacEl.textContent = _nlSaccadeCount.toLocaleString();
  const predEl = document.getElementById('nl-dash-predictions');
  if (predEl) predEl.textContent = _nlSessionPredictions.toLocaleString();

  // Compact model info
  const miEl = document.getElementById('nl-dash-modelinfo');
  if (miEl) {
    const valStr = _nlValError !== null ? `${_nlValError}px val` : 'no val';
    const calStr = `${_nlCalibData.length} cal`;
    const autoStr = _nlAutoRefineEnabled ? 'Auto \u2713' : 'Auto off';
    AetherUI.mount(RawHTML(`<span class="text-primary">${_nlModelLabel()} v${_nlModelVersion} \u00b7 ${valStr}</span><span class="text-dimmer">${calStr} \u00b7 ${autoStr}</span>`), miEl);
  }

  _nlRefreshBanner();
}

