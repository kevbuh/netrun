// ── Neuralook — Eye Tracking View (CNN Gaze Estimation) ──

let _nlCalibrating = false;
let _nlTracking = false;
let _nlGazeDot = null;
let _nlReady = false;
let _nlGazeX = 0;
let _nlGazeY = 0;
let _nlCurrentPoint = 0;
let _nlCameraOn = false;

// MediaPipe state (used to locate eyes in video frames)
let _nlFaceLandmarker = null;
let _nlVideoEl = null;
let _nlMpCdnLoaded = !!(window.FaceLandmarker && window.FilesetResolver);
let _nlMpModelLoading = false;
let _nlMpModelReady = false;
let _nlTrackingRAF = null;

window.addEventListener('mediapipe-ready', () => {
  _nlMpCdnLoaded = true;
  if (document.getElementById('neuralook-content')) renderNeuralookView();
});

// Calibration data: array of { eyeData: [4096], screenX, screenY, headPose: [yaw, pitch, roll] }
let _nlCalibData = [];
// Model state — server-side, just track if trained
let _nlModelTrained = false;
let _nlTrainError = null;
let _nlValError = null;
let _nlInferPending = false; // prevent overlapping inference requests

let _nlCalibSaved = false;

// Eye crop canvas (offscreen, reused)
let _nlEyeCropCanvas = null;

// Training state (for full-page training view)
let _nlTraining = false;
let _nlTrainPhase = ''; // 'training' | 'evaluating' | 'done' | 'error'
let _nlTrainProgress = null; // latest progress event
let _nlTrainResult = null; // final result from done event
let _nlTrainLossHistory = []; // [{epoch, val_loss}]
let _nlTrainLogs = []; // raw log lines from server
let _nlTrainStartTime = 0;
let _nlShowTrainView = true; // toggle between training detail and normal view
let _nlTrainAbort = null; // AbortController for in-flight training request

// Smoothing
let _nlGazeBuffer = [];
const _NL_BUFFER_SIZE = 6;

// Stats
let _nlPredictionCount = 0;
let _nlPredictionsThisSec = 0;
let _nlPredictionRate = 0;
let _nlStatsInterval = null;
let _nlRateInterval = null;

const _NL_GRAPH_LEN = 60;
let _nlHistGazeX = [];
let _nlHistGazeY = [];
let _nlHistJitter = [];
let _nlHistRate = [];

// 5x5 calibration grid (25 points)
const _NL_CAL_POSITIONS = [
  [8, 8],   [29, 8],  [50, 8],  [71, 8],  [92, 8],
  [8, 29],  [29, 29], [50, 29], [71, 29], [92, 29],
  [8, 50],  [29, 50], [50, 50], [71, 50], [92, 50],
  [8, 71],  [29, 71], [50, 71], [71, 71], [92, 71],
  [8, 92],  [29, 92], [50, 92], [71, 92], [92, 92]
];

const _NL_STARE_MS = 1200;
const _NL_SETTLE_MS = 400;

// Eye crop dimensions
const _NL_EYE_W = 64;
const _NL_EYE_H = 32;

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
  const bannerHTML = showTrainBanner ? `
    <div onclick="_nlShowTrainView=true;renderNeuralookView();" style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:10px;background:var(--bg-card,#23232a);border:1px solid var(--border,#333);cursor:pointer;margin-bottom:8px;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent,#b4451a)'" onmouseout="this.style.borderColor='var(--border,#333)'">
      ${_nlTraining ? '<svg width="14" height="14" viewBox="0 0 18 18" style="animation:nl-pill-spin 1s linear infinite;flex-shrink:0;"><circle cx="9" cy="9" r="7" fill="none" stroke="var(--accent,#b4451a)" stroke-width="2" stroke-dasharray="30 14" stroke-linecap="round"/></svg>'
        : _nlTrainPhase === 'done' ? '<svg width="14" height="14" viewBox="0 0 18 18" class="flex-shrink-0"><circle cx="9" cy="9" r="8" fill="#4ade80"/><path d="M5.5 9.5l2 2 5-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 18 18" class="flex-shrink-0"><circle cx="9" cy="9" r="8" fill="#f87171"/><path d="M6 6l6 6M12 6l-6 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>'}
      <span class="text-[0.8rem] text-primary font-medium">${_nlTraining ? 'Training in progress...' : _nlTrainPhase === 'done' ? 'Training complete' : 'Training failed'}</span>
      <span class="text-[0.72rem] text-dimmer ml-auto">View details →</span>
    </div>` : '';

  container.innerHTML = `
    ${bannerHTML}
    <div style="display:grid;grid-template-columns:200px 1fr;gap:16px;height:${showTrainBanner ? 'calc(100% - 60px - 52px)' : 'calc(100% - 60px)'};box-sizing:border-box;">
      <div class="flex flex-col gap-3">
        <div class="bg-card border border-border-card rounded-xl p-4">
          <div class="flex items-center gap-2 mb-3">
            <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};display:inline-block"></span>
            <span class="text-[0.82rem] text-primary font-medium">${statusText}</span>
          </div>
          <div id="nl-mp-status" class="flex items-center gap-2 mb-2">
            ${_nlMpModelReady
              ? '<svg class="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg><span class="text-[0.75rem] text-green-400">MediaPipe ready</span>'
              : _nlMpModelLoading
                ? '<svg class="w-3.5 h-3.5 flex-shrink-0 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span class="text-[0.75rem] text-accent">Loading face model...</span>'
                : _nlMpCdnLoaded
                  ? '<svg class="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg><span class="text-[0.75rem] text-muted">MediaPipe loaded</span>'
                  : '<svg class="w-3.5 h-3.5 flex-shrink-0 animate-spin text-muted" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span class="text-[0.75rem] text-dimmer">Loading MediaPipe...</span>'
            }
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

        ${_nlTrainLogs.length > 0 ? `
        <button onclick="_nlShowTrainView=true;if(!_nlTrainPhase)_nlTrainPhase='done';renderNeuralookView();" class="w-full px-4 py-2.5 rounded-xl border border-border-card bg-card text-primary text-[0.82rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="flex-shrink-0"><rect x="1" y="3" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M4 6.5h8M4 9h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          Training Log
          <span class="text-[0.7rem] text-dimmer ml-auto">${_nlTrainLogs.length} lines</span>
        </button>` : ''}
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;min-height:0;">
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:12px;min-height:0;">
          <div class="bg-card border border-border-card rounded-xl p-3" style="display:flex;flex-direction:column;min-height:0;overflow:hidden;">
            <div id="nl-camera-preview" class="rounded-lg overflow-hidden bg-black" style="flex:1;min-height:0;max-height:100%;display:flex;align-items:center;justify-content:center;position:relative;">
              <span class="text-dimmer text-[0.75rem]" id="nl-camera-placeholder">${_nlCameraOn ? 'Starting...' : 'Camera off'}</span>
            </div>
            <div class="flex justify-center mt-2">
              <button id="nl-camera-toggle" onclick="_nlToggleCamera()" class="px-4 py-1.5 rounded-lg border border-border-input bg-card text-primary text-[0.78rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors">
                ${_nlCameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
              </button>
            </div>
          </div>

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

// ── Training Detail View ──

function _nlRenderTrainDetailView(container) {
  const isDone = _nlTrainPhase === 'done';
  const isError = _nlTrainPhase === 'error';
  const prog = _nlTrainProgress || {};
  const epoch = prog.epoch || 0;
  const maxEpochs = prog.max_epochs || 3000;
  const pct = Math.round((epoch / maxEpochs) * 100);
  const elapsed = Math.round((Date.now() - _nlTrainStartTime) / 1000);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const latestLoss = _nlTrainLossHistory.length > 0 ? _nlTrainLossHistory[_nlTrainLossHistory.length - 1].val_loss : null;

  let phaseLabel, phaseColor;
  if (isError) { phaseLabel = 'Error'; phaseColor = '#f87171'; }
  else if (isDone) { phaseLabel = 'Complete'; phaseColor = '#4ade80'; }
  else if (_nlTrainPhase === 'evaluating') { phaseLabel = 'Evaluating'; phaseColor = '#60a5fa'; }
  else { phaseLabel = 'Training'; phaseColor = 'var(--accent, #b4451a)'; }

  container.innerHTML = `
    <div style="display:flex;height:calc(100% - 60px);box-sizing:border-box;gap:0;">
      <!-- Training details -->
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;padding:12px 16px;gap:10px;overflow:hidden;">
        <!-- Header -->
        <div class="flex items-center gap-2" style="flex-shrink:0;">
          <button onclick="_nlShowTrainView=false;renderNeuralookView();" class="p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer" title="Back to controls">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M11 4L6 9l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div style="width:8px;height:8px;border-radius:50%;background:${phaseColor};${_nlTraining ? 'animation:nl-pill-spin 1s linear infinite;' : ''}"></div>
          <h2 class="text-[0.95rem] font-semibold text-primary">${isDone && !_nlTraining ? 'Training Log' : isError ? 'Training Error' : _nlTraining ? 'Training CNN' : 'Training Complete'}</h2>
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
          <!-- Left col: loss graph + stats -->
          <div style="display:flex;flex-direction:column;gap:10px;min-height:0;">
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
              ${isDone && _nlTrainResult ? `
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
              `}
            </div>
          </div>

          <!-- Right col: training log -->
          <div class="bg-card border border-border-card rounded-xl" style="display:flex;flex-direction:column;min-height:0;">
            <div class="flex items-center justify-between px-3 pt-3 pb-1" style="flex-shrink:0;">
              <h3 class="text-[0.78rem] font-semibold text-primary">Training Log</h3>
              <span class="text-[0.65rem] text-dimmer tabular-nums" id="nl-log-count">${_nlTrainLogs.length} lines</span>
            </div>
            <div id="nl-train-log" style="flex:1;min-height:0;overflow-y:auto;padding:0 12px 10px;font-family:'SF Mono',Monaco,Consolas,'Liberation Mono',monospace;font-size:0.75rem;line-height:1.65;color:var(--text-primary,#e5e5e5);white-space:pre;tab-size:2;"></div>
          </div>
        </div>
      </div>

    </div>
  `;

  // Populate log from history
  const logEl = document.getElementById('nl-train-log');
  if (logEl && _nlTrainLogs.length > 0) {
    logEl.textContent = _nlTrainLogs.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }

  _nlRefreshTrainDetails();
  _nlDrawTrainLossGraph();
}

function _nlAppendTrainLog(line) {
  const logEl = document.getElementById('nl-train-log');
  if (!logEl) return;
  const wasAtBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
  logEl.textContent += (logEl.textContent ? '\n' : '') + line;
  if (wasAtBottom) logEl.scrollTop = logEl.scrollHeight;
  const countEl = document.getElementById('nl-log-count');
  if (countEl) countEl.textContent = _nlTrainLogs.length + ' lines';
}

function _nlRefreshTrainView() {
  // Called on each SSE progress event — update in-place if the training view is visible
  if (!document.getElementById('nl-train-progbar')) return;

  const prog = _nlTrainProgress || {};
  const epoch = prog.epoch || 0;
  const maxEpochs = prog.max_epochs || 3000;
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

function _nlRefreshTrainDetails() {
  const el = document.getElementById('nl-train-details');
  if (!el) return;
  const prog = _nlTrainProgress || {};
  const elapsed = Math.round((Date.now() - _nlTrainStartTime) / 1000);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const epoch = prog.epoch || 0;
  const maxEpochs = prog.max_epochs || 3000;
  const rate = elapsed > 0 ? (epoch / elapsed).toFixed(1) : '—';
  const eta = elapsed > 0 && epoch > 0 && _nlTraining ? Math.round((maxEpochs - epoch) * elapsed / epoch) : null;
  const etaStr = eta != null ? (eta < 60 ? `~${eta}s` : `~${Math.floor(eta / 60)}m ${eta % 60}s`) : '—';
  const bestLoss = _nlTrainLossHistory.length > 0 ? Math.min(..._nlTrainLossHistory.map(h => h.val_loss)) : null;

  const row = (label, value) =>
    `<div class="text-muted">${label}</div><div class="text-primary font-medium tabular-nums">${value}</div>`;

  el.innerHTML =
    row('Architecture', 'CNN (2ch 32x64 → 128 feat → 256 → 64 → 2)') +
    row('Input', `Eye crops ${_NL_EYE_W}x${_NL_EYE_H} x2 channels`) +
    row('Calibration Frames', `${_nlCalibData.length}`) +
    row('Calibration', `${_NL_CAL_POSITIONS.length} fixed grid points`) +
    row('Elapsed', elapsedStr) +
    row('Epoch', `${epoch} / ${maxEpochs}`) +
    row('Speed', `${rate} epochs/s`) +
    row('ETA', etaStr) +
    row('Best Val Loss', bestLoss != null ? bestLoss.toFixed(6) : '—') +
    row('Loss History', `${_nlTrainLossHistory.length} points`);
}

function _nlDrawTrainLossGraph() {
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
  let min = Math.min(...allLosses);
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

async function _nlInitMediapipe() {
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
    console.error('Neuralook: MediaPipe init error', e);
    _nlMpModelLoading = false;
    return false;
  }
}

// ── Eye Crop Capture ──

function _nlGetEyeCropCanvas() {
  if (!_nlEyeCropCanvas) {
    _nlEyeCropCanvas = document.createElement('canvas');
    _nlEyeCropCanvas.width = _NL_EYE_W;
    _nlEyeCropCanvas.height = _NL_EYE_H;
  }
  return _nlEyeCropCanvas;
}

function _nlCaptureEyeCrops() {
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

    const sx = Math.max(0, (cx - ew / 2) * vw);
    const sy = Math.max(0, (cy - eh / 2) * vh);
    const sw = Math.min(ew * vw, vw - sx);
    const sh = Math.min(eh * vh, vh - sy);

    canvas.width = _NL_EYE_W;
    canvas.height = _NL_EYE_H;
    ctx.drawImage(_nlVideoEl, sx, sy, sw, sh, 0, 0, _NL_EYE_W, _NL_EYE_H);
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

  // Concatenate: [left 2048 + right 2048] = 4096 bytes
  const combined = new Uint8Array(4096);
  combined.set(leftGray, 0);
  combined.set(rightGray, 2048);
  return combined;
}

// ── Server Communication ──

function _nlTrainOnServerSSE(onProgress, onLog) {
  return new Promise((resolve, reject) => {
    const useSaved = _nlCalibSaved && _nlCalibData.length > 0;
    const samples = useSaved ? [] : _nlCalibData.map(s => ({
      eyeData: Array.from(s.eyeData),
      screenX: s.screenX,
      screenY: s.screenY
    }));

    const reqBody = {
      method: 'cnn',
      samples,
      screenW: window.innerWidth,
      screenH: window.innerHeight,
      eyeW: _NL_EYE_W,
      eyeH: _NL_EYE_H
    };

    _nlTrainAbort = new AbortController();
    fetch('/api/neuralook/train', {
      method: 'POST',
      headers: _authHeaders(),
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
                else if (currentEvent === 'done') {
                  _nlTrainError = data.train_error_px;
                  _nlValError = data.val_error_px || null;
                  _nlModelTrained = true;
                  resolve(data);
                  return;
                } else if (currentEvent === 'error') {
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

let _nlTrainPill = null;

function _nlShowTrainPill() {
  _nlDismissTrainPill();
  const pill = document.createElement('div');
  pill.id = 'nl-train-pill';
  Object.assign(pill.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: '99999',
    background: 'var(--bg-card, #23232a)', border: '1px solid var(--border, #333)',
    borderRadius: '12px', padding: '12px 18px', minWidth: '220px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)', fontFamily: 'inherit',
    fontSize: '0.8rem', color: 'var(--text-primary, #e5e5e5)',
    transition: 'opacity 0.3s, transform 0.3s', opacity: '0', transform: 'translateY(10px)',
    cursor: 'default', display: 'flex', alignItems: 'center', gap: '10px'
  });
  pill.innerHTML = `
    <div style="width:18px;height:18px;flex-shrink:0;" id="nl-pill-icon">
      <svg width="18" height="18" viewBox="0 0 18 18" style="animation:nl-pill-spin 1s linear infinite">
        <circle cx="9" cy="9" r="7" fill="none" stroke="var(--accent,#b4451a)" stroke-width="2" stroke-dasharray="30 14" stroke-linecap="round"/>
      </svg>
    </div>
    <div id="nl-pill-text" style="flex:1;line-height:1.4;">
      <div id="nl-pill-title" style="font-weight:600;font-size:0.8rem;">Training CNN</div>
      <div id="nl-pill-detail" style="font-size:0.7rem;color:var(--text-secondary,#888);">Starting...</div>
    </div>
    <div id="nl-pill-stop" onclick="event.stopPropagation();_nlStopTraining();" style="width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;border:1px solid var(--border,#333);transition:border-color 0.2s;" onmouseover="this.style.borderColor='#f87171'" onmouseout="this.style.borderColor='var(--border,#333)'">
      <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="#f87171"/></svg>
    </div>
  `;
  pill.onclick = () => { if (typeof openNeuralook === 'function') openNeuralook(); };
  document.body.appendChild(pill);
  _nlTrainPill = pill;
  requestAnimationFrame(() => { pill.style.opacity = '1'; pill.style.transform = 'translateY(0)'; });

  // Add spinner keyframes if not already present
  if (!document.getElementById('nl-pill-spin-style')) {
    const st = document.createElement('style');
    st.id = 'nl-pill-spin-style';
    st.textContent = '@keyframes nl-pill-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(st);
  }
}

function _nlTrainETA(epoch, maxEpochs) {
  if (!_nlTrainStartTime || epoch <= 0) return '';
  const elapsed = (Date.now() - _nlTrainStartTime) / 1000;
  const remaining = Math.round((maxEpochs - epoch) * elapsed / epoch);
  if (remaining <= 0) return '';
  return remaining < 60 ? ` · ~${remaining}s` : ` · ~${Math.floor(remaining / 60)}m${remaining % 60 ? ' ' + (remaining % 60) + 's' : ''}`;
}

function _nlStopTraining() {
  if (_nlTrainAbort) { _nlTrainAbort.abort(); _nlTrainAbort = null; }
  _nlTraining = false;
  _nlTrainPhase = 'error';
  _nlTrainResult = { error: 'Stopped by user' };
  _nlErrorTrainPill('Stopped');
  _nlRefreshTrainView();
  renderNeuralookView();
}

function _nlUpdateTrainPill(title, detail) {
  const t = document.getElementById('nl-pill-title');
  const d = document.getElementById('nl-pill-detail');
  if (t) t.textContent = title;
  if (d) d.textContent = detail;
}

function _nlFinishTrainPill(title, detail, color) {
  const c = color || '#4ade80';
  const icon = document.getElementById('nl-pill-icon');
  if (icon) icon.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="${c}"/><path d="M5.5 9.5l2 2 5-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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

function _nlErrorTrainPill(msg) {
  const icon = document.getElementById('nl-pill-icon');
  if (icon) icon.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#f87171"/><path d="M6 6l6 6M12 6l-6 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const stopBtn = document.getElementById('nl-pill-stop');
  if (stopBtn) stopBtn.style.display = 'none';
  _nlUpdateTrainPill('Training Failed', msg);
  if (_nlTrainPill) _nlTrainPill.style.cursor = 'pointer';
  if (_nlTrainPill) _nlTrainPill.onclick = () => { openNeuralook(); _nlDismissTrainPill(); };
  setTimeout(() => _nlDismissTrainPill(), 8000);
}

function _nlDismissTrainPill() {
  if (!_nlTrainPill) return;
  _nlTrainPill.style.opacity = '0';
  _nlTrainPill.style.transform = 'translateY(10px)';
  const p = _nlTrainPill;
  _nlTrainPill = null;
  setTimeout(() => p.remove(), 300);
}

async function _nlPredictOnServer(eyeData) {
  const body = { eyeData: Array.from(eyeData), method: 'cnn' };
  const resp = await fetch('/api/neuralook/predict', {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify(body)
  });
  const result = await resp.json();
  if (result.error) return null;
  return { x: result.x, y: result.y };
}

// ── Camera / Video ──

async function _nlEnsureVideo() {
  if (_nlVideoEl && _nlVideoEl.srcObject) return _nlVideoEl;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
  _nlVideoEl = document.createElement('video');
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

function _nlStopVideo() {
  if (_nlVideoEl && _nlVideoEl.srcObject) {
    _nlVideoEl.srcObject.getTracks().forEach(t => t.stop());
    _nlVideoEl.srcObject = null;
  }
  _nlVideoEl = null;
}

function _nlAttachCameraPreview() {
  const previewBox = document.getElementById('nl-camera-preview');
  if (!previewBox || previewBox.querySelector('video')) return;
  const vid = _nlVideoEl;
  if (vid && vid.srcObject) {
    const placeholder = document.getElementById('nl-camera-placeholder');
    if (placeholder) placeholder.remove();
    const clone = document.createElement('video');
    clone.srcObject = vid.srcObject;
    clone.autoplay = true;
    clone.muted = true;
    clone.playsInline = true;
    Object.assign(clone.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' });
    previewBox.appendChild(clone);
    return;
  }
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      const box = document.getElementById('nl-camera-preview');
      if (!box || box.querySelector('video')) { stream.getTracks().forEach(t => t.stop()); return; }
      const ph = document.getElementById('nl-camera-placeholder');
      if (ph) ph.remove();
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true; video.muted = true; video.playsInline = true;
      Object.assign(video.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' });
      box.appendChild(video);
    }).catch(() => {});
  }
}

function _nlToggleCamera() {
  if (_nlCameraOn) {
    _nlCameraOn = false;
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
    if (!(_nlVideoEl && _nlVideoEl.srcObject)) {
      const box = document.getElementById('nl-camera-preview');
      if (box && !box.querySelector('video')) {
        navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
          const b = document.getElementById('nl-camera-preview');
          if (!b || b.querySelector('video')) { stream.getTracks().forEach(t => t.stop()); return; }
          const ph = document.getElementById('nl-camera-placeholder');
          if (ph) ph.remove();
          const video = document.createElement('video');
          video.srcObject = stream;
          video.autoplay = true; video.muted = true; video.playsInline = true;
          Object.assign(video.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' });
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

  _nlCalibrating = true;
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
    _nlShowError(_nlMpCdnLoaded ? 'Failed to initialize face model.' : 'MediaPipe CDN failed to load.');
    renderNeuralookView();
    return;
  }

  try {
    await _nlEnsureVideo();
    _nlCameraOn = true;
  } catch (e) {
    _nlCalibrating = false;
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

function _nlFullscreenChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFs && _nlCalibrating) {
    _nlCalibrating = false;
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

function _nlShowCalibrationOverlay() {
  const existing = document.getElementById('nl-calibration-overlay');
  if (existing) existing.remove();

  // Blank background so calibration dots are clearly visible
  const overlay = document.createElement('div');
  overlay.id = 'nl-calibration-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    background: 'var(--bg-body, #0a0a0a)', zIndex: '99999',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
  });

  const instr = document.createElement('div');
  instr.id = 'nl-cal-instr';
  instr.style.cssText = 'position:absolute;top:30px;left:50%;transform:translateX(-50%);font-size:0.9rem;text-align:center;z-index:100000;pointer-events:none;background:rgba(0,0,0,0.7);color:#fff;padding:8px 16px;border-radius:8px;';
  overlay.appendChild(instr);

  // Camera preview in bottom-right corner
  if (_nlVideoEl && _nlVideoEl.srcObject) {
    const camBox = document.createElement('div');
    Object.assign(camBox.style, {
      position: 'absolute', bottom: '50px', right: '24px', width: '180px', height: '135px',
      borderRadius: '10px', overflow: 'hidden', zIndex: '100000',
      border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 4px 16px rgba(0,0,0,0.5)'
    });
    const camVid = document.createElement('video');
    camVid.srcObject = _nlVideoEl.srcObject;
    camVid.autoplay = true;
    camVid.muted = true;
    camVid.playsInline = true;
    Object.assign(camVid.style, { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' });
    camBox.appendChild(camVid);
    overlay.appendChild(camBox);
  }

  // Progress bar
  const progBar = document.createElement('div');
  progBar.id = 'nl-cal-progbar';
  Object.assign(progBar.style, {
    position: 'absolute', bottom: '24px', left: '10%', width: '80%', height: '4px',
    background: 'rgba(255,255,255,0.2)', borderRadius: '2px', zIndex: '100000'
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

function _nlShowNextCalibrationDot() {
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
    instr.innerHTML = `<strong>Calibration</strong> &mdash; Point ${_nlCurrentPoint + 1}/${_NL_CAL_POSITIONS.length}, look at the dot`;
  }

  const progFill = document.getElementById('nl-cal-progfill');
  if (progFill) progFill.style.width = Math.round((_nlCurrentPoint / _NL_CAL_POSITIONS.length) * 100) + '%';

  // Dot with outline for visibility on any background
  const dot = document.createElement('div');
  dot.id = 'nl-cal-dot';
  Object.assign(dot.style, {
    position: 'absolute', left: xPct + '%', top: yPct + '%',
    width: '20px', height: '20px', borderRadius: '50%',
    background: 'var(--accent, #b4451a)',
    border: '2px solid #fff',
    boxShadow: '0 0 8px rgba(0,0,0,0.5)',
    transform: 'translate(-50%, -50%)',
    zIndex: '100001', opacity: '0', transition: 'opacity 0.3s'
  });

  // Shrinking ring
  const ring = document.createElement('div');
  ring.id = 'nl-cal-ring';
  Object.assign(ring.style, {
    position: 'absolute', left: xPct + '%', top: yPct + '%',
    width: '44px', height: '44px', borderRadius: '50%',
    border: '2px solid var(--accent, #b4451a)',
    transform: 'translate(-50%, -50%) scale(1)',
    zIndex: '100001', opacity: '0',
    transition: `opacity 0.3s, transform ${_NL_STARE_MS}ms linear`
  });

  overlay.appendChild(ring);
  overlay.appendChild(dot);

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
        setTimeout(() => { dot.remove(); ring.remove(); _nlShowNextCalibrationDot(); }, 200);
        return;
      }

      const eyeData = _nlCaptureEyeCrops();
      if (eyeData) {
        _nlCalibData.push({ eyeData, screenX, screenY });
      }
      requestAnimationFrame(collect);
    }
    requestAnimationFrame(collect);
  }, _NL_SETTLE_MS);
}

async function _nlOnCalibrationComplete() {
  _nlFinishCalibration();

  // Save calibration data to server
  try {
    const calibPayload = {
      samples: _nlCalibData.map(s => ({
        eyeData: Array.from(s.eyeData),
        screenX: s.screenX, screenY: s.screenY
      })),
      screenW: window.innerWidth, screenH: window.innerHeight,
      eyeW: _NL_EYE_W, eyeH: _NL_EYE_H
    };
    await fetch('/api/neuralook/save-calibration', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify(calibPayload)
    });
    _nlCalibSaved = true;
  } catch (e) { console.warn('Neuralook: failed to save calibration', e); }

  _nlTraining = true;
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
      if (prog.phase === 'evaluating') {
        _nlUpdateTrainPill('Training CNN', 'Evaluating...');
      } else {
        const pct = Math.round((prog.epoch / prog.max_epochs) * 100);
        const loss = prog.val_loss != null ? ` · loss ${prog.val_loss.toFixed(4)}` : '';
        const eta = _nlTrainETA(prog.epoch, prog.max_epochs);
        _nlUpdateTrainPill('Training CNN', `Epoch ${prog.epoch}/${prog.max_epochs} (${pct}%)${loss}${eta}`);
      }
      _nlRefreshTrainView();
    }, (logLine) => {
      _nlTrainLogs.push(logLine);
      _nlAppendTrainLog(logLine);
    });

    _nlTrainResult = result;
    _nlTrainPhase = 'done';
    _nlTraining = false;
    _nlReady = true;

    const valPx = result.val_error_px;
    const label = valPx < 80 ? 'Good' : valPx < 150 ? 'Fair' : 'Poor';
    const color = valPx < 80 ? '#4ade80' : valPx < 150 ? '#fbbf24' : '#f87171';
    _nlFinishTrainPill('Training Done', `Val ${valPx}px — ${label}`, color);
    _nlRefreshTrainView();
    renderNeuralookView();
  } catch (e) {
    _nlTrainPhase = 'error';
    _nlTraining = false;
    _nlTrainResult = { error: e.message || String(e) };
    _nlErrorTrainPill(e.message || String(e));
    _nlRefreshTrainView();
    renderNeuralookView();
  }
}

function _nlFinishCalibration() {
  _nlCalibrating = false;
  const overlay = document.getElementById('nl-calibration-overlay');
  if (overlay) overlay.remove();

  const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
  if (exitFs && (document.fullscreenElement || document.webkitFullscreenElement)) exitFs.call(document);
  renderNeuralookView();
}

// ── Shared prediction → gaze smoothing ──

function _nlApplyGazePrediction(pred) {
  _nlGazeBuffer.push(pred);
  if (_nlGazeBuffer.length > _NL_BUFFER_SIZE) _nlGazeBuffer.shift();
  let sx = 0, sy = 0;
  for (const p of _nlGazeBuffer) { sx += p.x; sy += p.y; }
  _nlGazeX = sx / _nlGazeBuffer.length;
  _nlGazeY = sy / _nlGazeBuffer.length;
  _nlMoveDot(_nlGazeX, _nlGazeY);
}

// ── Tracking Loop ──

function _nlTrackingLoop() {
  if (!_nlTracking || !_nlFaceLandmarker || !_nlVideoEl) {
    _nlTrackingRAF = null;
    return;
  }

  if (!_nlInferPending) {
    const eyeData = _nlCaptureEyeCrops();
    if (eyeData) {
      _nlInferPending = true;
      _nlPredictOnServer(eyeData).then(pred => {
        _nlInferPending = false;
        if (!pred || !_nlTracking) return;
        _nlPredictionCount++;
        _nlPredictionsThisSec++;
        _nlApplyGazePrediction(pred);
      }).catch(() => { _nlInferPending = false; });
    }
  }

  _nlTrackingRAF = requestAnimationFrame(_nlTrackingLoop);
}

function _nlToggleTracking() {
  if (_nlTracking) _nlStopTracking();
  else _nlStartTracking();
}

async function _nlStartTracking() {
  if (!_nlReady || !_nlModelTrained) return;
  try { await _nlEnsureVideo(); } catch (e) {
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
    position: 'fixed', width: sz + 'px', height: sz + 'px', borderRadius: '50%',
    background: savedColor, opacity: '0.7', pointerEvents: 'none', zIndex: '99998',
    transform: 'translate(-50%, -50%)', transition: 'left 0.05s linear, top 0.05s linear',
    boxShadow: '0 0 8px ' + savedColor + '80', left: '-100px', top: '-100px'
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
  if (_nlGazeDot) { _nlGazeDot.style.background = color; _nlGazeDot.style.boxShadow = '0 0 8px ' + color + '80'; }
}

function _nlUpdateDotSize(size) {
  const label = document.getElementById('nl-dot-size-label');
  if (label) label.textContent = size + 'px';
  if (_nlGazeDot) { _nlGazeDot.style.width = size + 'px'; _nlGazeDot.style.height = size + 'px'; }
}

// ── Stats & Graphs ──

function _nlStartStatsInterval() {
  _nlStopStatsInterval();
  _nlStatsInterval = setInterval(() => {
    if (!document.getElementById('nl-model-stats')) { _nlStopStatsInterval(); return; }
    _nlRefreshStats();
  }, 500);
  _nlRateInterval = setInterval(() => { _nlPredictionRate = _nlPredictionsThisSec; _nlPredictionsThisSec = 0; }, 1000);
}

function _nlStopStatsInterval() {
  if (_nlStatsInterval) { clearInterval(_nlStatsInterval); _nlStatsInterval = null; }
  if (_nlRateInterval) { clearInterval(_nlRateInterval); _nlRateInterval = null; }
}

function _nlComputeJitter() {
  if (_nlGazeBuffer.length < 2) return 0;
  let sx = 0, sy = 0;
  for (const p of _nlGazeBuffer) { sx += p.x; sy += p.y; }
  const mx = sx / _nlGazeBuffer.length, my = sy / _nlGazeBuffer.length;
  let v = 0;
  for (const p of _nlGazeBuffer) v += (p.x - mx) ** 2 + (p.y - my) ** 2;
  return Math.sqrt(v / _nlGazeBuffer.length);
}

function _nlRefreshStats() {
  const el = document.getElementById('nl-model-stats');
  if (!el) return;

  const jitter = _nlTracking ? Math.round(_nlComputeJitter()) : null;
  const jitterColor = jitter !== null ? (jitter < 30 ? '#4ade80' : jitter < 70 ? '#fbbf24' : '#f87171') : '#6b7280';

  const row = (label, value, color) =>
    `<div class="text-muted">${label}</div><div class="text-primary font-medium tabular-nums" ${color ? `style="color:${color}"` : ''}>${value}</div>`;

  el.innerHTML =
    row('Model', 'CNN (2ch 32x64)') +
    row('Input', `Eye crops ${_NL_EYE_W}x${_NL_EYE_H} x2`) +
    row('Calibration', `${_nlCalibData.length} frames (${_NL_CAL_POSITIONS.length} points)`) +
    row('Status', _nlModelTrained ? '<span style="color:#4ade80">Trained</span>' : '<span class="text-dimmer">Not trained</span>') +
    (_nlTrainError !== null ? row('Train error', `${_nlTrainError}px`) : '') +
    (_nlValError !== null ? row('Val error', `${_nlValError}px`) : '') +
    row('Prediction rate', _nlTracking ? `${_nlPredictionRate} Hz` : '<span class="text-dimmer">Inactive</span>') +
    row('Jitter', jitter !== null ? `${jitter}px` : '<span class="text-dimmer">Inactive</span>', jitter !== null ? jitterColor : null) +
    row('Gaze', _nlTracking ? `${Math.round(_nlGazeX)}, ${Math.round(_nlGazeY)}` : '<span class="text-dimmer">Inactive</span>') +
    row('Buffer', `${_NL_BUFFER_SIZE} samples`) +
    row('Predictions', `${_nlPredictionCount.toLocaleString()}`);

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
  let min = fixedMin != null ? fixedMin : Math.min(...valid);
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
