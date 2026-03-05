// nl-training.js — Server SSE training, training pills, training detail view, loss graph, manual refine

import { _nl, _NL_EYE_W, _NL_EYE_H, _NL_GRAPH_LEN, _NL_CAL_POSITIONS, _nlModelLabel, _nlCheckGazeMasterAchievement, _nlUpdatePillIndicator } from '/js/neuralook/nl-state.js';
import { _nlStartEyeCropPreview, _nlDrawEyeCrops } from '/js/neuralook/nl-capture.js';
import { api, apiPost } from '/js/api.js';
import { icon } from '/js/core/icons.js';
import { islandUpdate, islandRemove, pillStackAdd, pillStackRemove } from '/js/core/core-ui.js';

// ── Training Detail View ──

export function _nlRenderTrainDetailView(container) {
  const isDone = _nl.trainPhase === 'done';
  const isError = _nl.trainPhase === 'error';
  const prog = _nl.trainProgress || {};
  const epoch = prog.epoch || 0;
  const maxEpochs = prog.max_epochs || 100;
  const pct = Math.round((epoch / maxEpochs) * 100);
  const elapsed = Math.round((Date.now() - _nl.trainStartTime) / 1000);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const latestLoss = _nl.trainLossHistory.length > 0 ? _nl.trainLossHistory[_nl.trainLossHistory.length - 1].val_loss : null;

  let phaseLabel, phaseColor;
  if (isError) { phaseLabel = 'Error'; phaseColor = '#f87171'; }
  else if (isDone) { phaseLabel = 'Complete'; phaseColor = '#4ade80'; }
  else if (_nl.trainPhase === 'evaluating') { phaseLabel = 'Evaluating'; phaseColor = '#60a5fa'; }
  else { phaseLabel = 'Training'; phaseColor = 'var(--nr-accent, #b4451a)'; }

  const statsOrResultHTML = isDone && _nl.trainResult ? `
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;margin-bottom:8px;">
                  <div><div class="text-[1.2rem] font-bold" style="color:${_nl.trainResult.val_error_px < 80 ? '#4ade80' : _nl.trainResult.val_error_px < 150 ? '#fbbf24' : '#f87171'}">${_nl.trainResult.val_error_px}px</div><div class="text-[0.65rem] text-dimmer">Val Error</div></div>
                  <div><div class="text-[1.2rem] font-bold text-primary">${_nl.trainResult.train_error_px}px</div><div class="text-[0.65rem] text-dimmer">Train Error</div></div>
                  <div><div class="text-[1.2rem] font-bold text-primary">${_nl.trainResult.stopped_epoch}</div><div class="text-[0.65rem] text-dimmer">Epoch</div></div>
                </div>
                <div class="flex justify-center"><button onclick="window._nl.trainPhase='';window.renderNeuralookView();" class="px-4 py-1.5 rounded-lg bg-accent text-white text-[0.75rem] font-medium cursor-pointer hover:opacity-90 transition-opacity">Continue to Tracking</button></div>
              ` : isError && _nl.trainResult ? `
                <div class="text-[0.78rem] text-red-400 mb-2">${_nl.trainResult.error}</div>
                <div class="flex justify-center"><button onclick="window._nl.trainPhase='';window.renderNeuralookView();" class="px-4 py-1.5 rounded-lg border border-border-input bg-card text-primary text-[0.75rem] font-medium cursor-pointer hover:border-accent hover:text-accent transition-colors">Back</button></div>
              ` : `
                <div id="nl-train-details" class="grid grid-cols-2 gap-x-6 gap-y-1 text-[0.72rem]"></div>
              `;

  const trainDetailHTML = `
    <div style="display:flex;height:calc(100% - 60px);box-sizing:border-box;gap:0;">
      <!-- Training details -->
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;padding:12px 16px;gap:10px;overflow:hidden;">
        <!-- Header -->
        <div class="flex items-center gap-2" style="flex-shrink:0;">
          <button onclick="window._nl.showTrainView=false;window.renderNeuralookView();" class="p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer" title="Back to controls">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M11 4L6 9l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div style="width:8px;height:8px;border-radius:50%;background:${phaseColor};${_nl.training ? 'animation:nl-pill-spin 1s linear infinite;' : ''}"></div>
          <h2 class="text-[0.95rem] font-semibold text-primary">${isDone && !_nl.training ? 'Training Log' : isError ? 'Training Error' : _nl.training ? 'Training ' + _nlModelLabel() : 'Training Complete'}</h2>
          <span class="text-[0.72rem] text-muted tabular-nums">${isDone ? epoch : epoch} / ${maxEpochs}</span>
          <div style="flex:1;height:4px;border-radius:2px;background:var(--bg-secondary,#1a1a1f);overflow:hidden;max-width:120px;">
            <div id="nl-train-progbar" style="height:100%;border-radius:2px;background:${phaseColor};width:${isDone ? 100 : pct}%;transition:width 0.3s;"></div>
          </div>
          <span class="text-[0.72rem] text-dimmer tabular-nums" id="nl-train-loss-label">${latestLoss != null ? `loss ${latestLoss.toFixed(5)}` : ''}</span>
          <span class="ml-auto"></span>
          <span class="text-[0.72rem] text-muted">${elapsedStr}</span>
          ${_nl.training ? `<button onclick="window._nlStopTraining()" class="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-border-input text-[0.72rem] text-red-400 font-medium cursor-pointer hover:border-red-400 transition-colors" title="Stop training">
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
                  <span>${_NL_EYE_W}x${_NL_EYE_H} grayscale</span>
                  <span>2 channels</span>
                </div>
              </div>
            </div>
            <!-- Loss graph -->
            <div class="bg-card border border-border-card rounded-xl p-3" style="flex:1;display:flex;flex-direction:column;min-height:0;">
              <div class="flex items-center justify-between mb-1" style="flex-shrink:0;">
                <h3 class="text-[0.78rem] font-semibold text-primary">Loss</h3>
                <div class="flex items-center gap-3 text-[0.68rem] tabular-nums">
                  <span class="flex items-center gap-1"><span style="width:6px;height:2px;border-radius:1px;background:#f97316;display:inline-block;"></span><span class="text-dimmer">Train</span><span class="text-muted" id="nl-train-tloss-val">${_nl.trainLossHistory.length > 0 ? _nl.trainLossHistory[_nl.trainLossHistory.length - 1].train_loss?.toFixed(6) || '\u2014' : '\u2014'}</span></span>
                  <span class="flex items-center gap-1"><span style="width:6px;height:2px;border-radius:1px;background:#60a5fa;display:inline-block;"></span><span class="text-dimmer">Val</span><span class="text-muted" id="nl-train-loss-val">${latestLoss != null ? latestLoss.toFixed(6) : '\u2014'}</span></span>
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
              <span class="text-[0.65rem] text-dimmer tabular-nums" id="nl-log-count">${_nl.trainLogs.length} lines</span>
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
  if (logEl && _nl.trainLogs.length > 0) {
    logEl.textContent = _nl.trainLogs.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }

  _nlRefreshTrainDetails();
  _nlDrawTrainLossGraph();
  _nlStartEyeCropPreview();
}

// ── Training Log ──

export function _nlAppendTrainLog(line) {
  const logEl = document.getElementById('nl-train-log');
  if (!logEl) return;
  const wasAtBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
  logEl.textContent += (logEl.textContent ? '\n' : '') + line;
  if (wasAtBottom) logEl.scrollTop = logEl.scrollHeight;
  const countEl = document.getElementById('nl-log-count');
  if (countEl) countEl.textContent = _nl.trainLogs.length + ' lines';
}

// ── In-place Training View Refresh ──

export function _nlRefreshTrainView() {
  // Called on each SSE progress event — update in-place if the training view is visible
  if (!document.getElementById('nl-train-progbar')) return;

  const prog = _nl.trainProgress || {};
  const epoch = prog.epoch || 0;
  const maxEpochs = prog.max_epochs || 100;
  const pct = Math.round((epoch / maxEpochs) * 100);
  const latestLoss = _nl.trainLossHistory.length > 0 ? _nl.trainLossHistory[_nl.trainLossHistory.length - 1].val_loss : null;

  const bar = document.getElementById('nl-train-progbar');
  if (bar) bar.style.width = pct + '%';

  const lossLabel = document.getElementById('nl-train-loss-label');
  if (lossLabel) lossLabel.textContent = latestLoss != null ? `Val loss: ${latestLoss.toFixed(6)}` : '';

  const lossVal = document.getElementById('nl-train-loss-val');
  if (lossVal) lossVal.textContent = latestLoss != null ? latestLoss.toFixed(6) : '\u2014';

  _nlRefreshTrainDetails();
  _nlDrawTrainLossGraph();
}

// ── Training Stats Details ──

export function _nlRefreshTrainDetails() {
  const el = document.getElementById('nl-train-details');
  if (!el) return;
  const prog = _nl.trainProgress || {};
  const elapsed = Math.round((Date.now() - _nl.trainStartTime) / 1000);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const epoch = prog.epoch || 0;
  const maxEpochs = prog.max_epochs || 100;
  const rate = elapsed > 0 ? (epoch / elapsed).toFixed(1) : '\u2014';
  const eta = elapsed > 0 && epoch > 0 && _nl.training ? Math.round((maxEpochs - epoch) * elapsed / epoch) : null;
  const etaStr = eta != null ? (eta < 60 ? `~${eta}s` : `~${Math.floor(eta / 60)}m ${eta % 60}s`) : '\u2014';
  const bestLoss = _nl.trainLossHistory.length > 0 ? Math.min(..._nl.trainLossHistory.map(h => h.val_loss)) : null;

  const row = (label, value) =>
    `<div class="text-muted">${label}</div><div class="text-primary font-medium tabular-nums">${value}</div>`;

  const detailsHTML =
    row('Architecture', _nl.modelType === 'mobilenet' ? 'MobileNet + temporal LSTM (2ch 64x128 + hp+iris \u2192 proj 64 \u2192 LSTM 32 \u2192 16 \u2192 2)' : 'CNN + temporal LSTM (2ch 64x128 + hp+iris \u2192 proj 128 \u2192 LSTM 64 \u2192 32 \u2192 2)') +
    row('Input', `Eye crops ${_NL_EYE_W}x${_NL_EYE_H} x2 channels`) +
    row('Calibration Frames', `${_nl.calibData.length}`) +
    row('Calibration', `${_NL_CAL_POSITIONS.length} fixed grid points`) +
    row('Elapsed', elapsedStr) +
    row('Epoch', `${epoch} / ${maxEpochs}`) +
    row('Speed', `${rate} epochs/s`) +
    row('ETA', etaStr) +
    row('Best Val Loss', bestLoss != null ? bestLoss.toFixed(6) : '\u2014') +
    row('Loss History', `${_nl.trainLossHistory.length} points`);
  AetherUI.mount(RawHTML(detailsHTML), el);
}

// ── Loss Graph ──

export function _nlDrawTrainLossGraph() {
  const canvas = document.getElementById('nl-train-loss-graph');
  if (!canvas || _nl.trainLossHistory.length < 2) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (w <= 0 || h <= 0) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const data = _nl.trainLossHistory;
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
  if (tlv && data.length > 0) tlv.textContent = data[data.length - 1].train_loss?.toFixed(6) || '\u2014';
  if (vlv && data.length > 0) vlv.textContent = data[data.length - 1].val_loss.toFixed(6);
}

// ── Server Communication ──

export function _nlTrainOnServerSSE(onProgress, onLog, refine) {
  return new Promise((resolve, reject) => {
    const useSaved = _nl.calibSaved && _nl.calibData.length > 0;
    const samples = useSaved ? [] : _nl.calibData.map(s => ({
      eyeData: Array.from(s.eyeData),
      headPose: s.headPose,
      irisFeatures: s.irisFeatures,
      screenX: s.screenX,
      screenY: s.screenY
    }));

    const reqBody = {
      method: _nl.modelType,
      samples,
      screenW: window.innerWidth,
      screenH: window.innerHeight,
      eyeW: _NL_EYE_W,
      eyeH: _NL_EYE_H
    };
    if (refine) reqBody.refine = true;

    _nl.trainAbort = new AbortController();
    const modelLabel = (_nl.modelType || 'cnn').toUpperCase();
    islandUpdate('ai-train', { type: 'ai', label: 'Training', detail: modelLabel });
    api('/api/neuralook/train', {
      method: 'POST',
      signal: _nl.trainAbort.signal,
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
                  _nl.trainError = data.train_error_px;
                  _nl.valError = data.val_error_px;
                  _nl.modelTrained = true;
                  _nl.ready = true;
                  _nl.modelVersion++;
                  _nlCheckGazeMasterAchievement();
                  _nl.baselineValError = data.val_error_px;
                  _nlShowModelUpdatedPill(_nl.modelVersion, data.val_error_px);
                  if (onLog) onLog(`\u25BA Model updated to v${_nl.modelVersion} \u2014 val ${data.val_error_px}px (epoch ${data.epoch})`);
                  window._nlRefreshStats();
                } else if (currentEvent === 'done') {
                  _nl.trainError = data.train_error_px;
                  _nl.valError = data.val_error_px || null;
                  _nl.modelTrained = true;
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
    window.Text('Starting... \u00b7 v' + (_nl.modelVersion + 1)).attr('id', 'nl-pill-detail').cssText('font-size:0.7rem;color:var(--text-secondary,#888);')
  ).attr('id', 'nl-pill-text').cssText('flex:1;line-height:1.4;');

  const stopSvg = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="#f87171"/></svg>';
  const stopBtn = new window.View('div').attr('id', 'nl-pill-stop');
  stopBtn.cssText('width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;border:1px solid var(--border,#333);transition:border-color 0.2s;');
  stopBtn.add(window.RawHTML(stopSvg));
  stopBtn.on('click', function(ev) { ev.stopPropagation(); _nlStopTraining(); });
  stopBtn.on('mouseover', function() { stopBtn.el.style.borderColor = '#f87171'; });
  stopBtn.on('mouseout', function() { stopBtn.el.style.borderColor = 'var(--border,#333)'; });

  pillView.add(iconDiv, textDiv, stopBtn);
  pillView.onTap(function() { if (typeof window.openNeuralook === 'function') window.openNeuralook(); });
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
  if (!_nl.trainStartTime || epoch <= 0) return '';
  const elapsed = (Date.now() - _nl.trainStartTime) / 1000;
  const remaining = Math.round((maxEpochs - epoch) * elapsed / epoch);
  if (remaining <= 0) return '';
  return remaining < 60 ? ` \u00b7 ~${remaining}s` : ` \u00b7 ~${Math.floor(remaining / 60)}m${remaining % 60 ? ' ' + (remaining % 60) + 's' : ''}`;
}

export function _nlStopTraining() {
  if (_nl.trainAbort) { _nl.trainAbort.abort(); _nl.trainAbort = null; }
  _nl.training = false;
  _nl.autoRefineInProgress = false;
  _nlUpdatePillIndicator();
  _nl.trainPhase = 'error';
  _nl.trainResult = { error: 'Stopped by user' };
  _nlErrorTrainPill('Stopped');
  _nlRefreshTrainView();
  window.renderNeuralookView();
}

export function _nlUpdateTrainPill(title, detail) {
  // Auto-show pill when navigating away from neuralook during training
  if (!_nlTrainPill && _nl.training && window.location.hash !== '#neuralook') {
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
  const iconEl = document.getElementById('nl-pill-icon');
  if (iconEl) AetherUI.mount(RawHTML(`<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="${c}"/><path d="M5.5 9.5l2 2 5-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`), iconEl);
  const stopBtn = document.getElementById('nl-pill-stop');
  if (stopBtn) stopBtn.style.display = 'none';
  _nlUpdateTrainPill(title, detail);
  if (_nlTrainPill) {
    _nlTrainPill.style.cursor = 'pointer';
    _nlTrainPill.onclick = () => { _nl.showTrainView = true; window.openNeuralook(); _nlDismissTrainPill(); };
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
  const iconEl = document.getElementById('nl-pill-icon');
  if (iconEl) AetherUI.mount(RawHTML(`<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#f87171"/><path d="M6 6l6 6M12 6l-6 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`), iconEl);
  const stopBtn = document.getElementById('nl-pill-stop');
  if (stopBtn) stopBtn.style.display = 'none';
  _nlUpdateTrainPill('Training Failed', msg);
  if (_nlTrainPill) _nlTrainPill.style.cursor = 'pointer';
  if (_nlTrainPill) _nlTrainPill.onclick = () => { window.openNeuralook(); _nlDismissTrainPill(); };
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
    method: _nl.modelType,
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

// ── Model Updated Pill (shown during SSE mid-train updates) ──

function _nlShowModelUpdatedPill(version, valErrorPx) {
  const label = valErrorPx < 80 ? 'Good' : valErrorPx < 150 ? 'Fair' : 'Poor';
  const color = valErrorPx < 80 ? '#4ade80' : valErrorPx < 150 ? '#fbbf24' : '#f87171';
  _nlFinishTrainPill(`Model Updated \u2014 v${version}`, `Val ${valErrorPx}px \u2014 ${label}`, color);
}

// ── Manual Refinement ──

export function _nlRefineModel() {
  if (_nl.training) return;
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

  _nlTrainOnServerSSE((prog) => {
    _nl.trainProgress = prog;
    _nl.trainPhase = prog.phase || 'training';
    if (prog.val_loss != null) _nl.trainLossHistory.push({ epoch: prog.epoch, val_loss: prog.val_loss, train_loss: prog.train_loss });
    if (prog.phase === 'evaluating') {
      _nlUpdateTrainPill('Refining ' + _nlModelLabel() + ' \u2192 v' + (_nl.modelVersion + 1), 'Evaluating...');
    } else {
      const pct = Math.round((prog.epoch / prog.max_epochs) * 100);
      const loss = prog.val_loss != null ? ` \u00b7 loss ${prog.val_loss.toFixed(4)}` : '';
      const eta = _nlTrainETA(prog.epoch, prog.max_epochs);
      _nlUpdateTrainPill('Refining ' + _nlModelLabel() + ' \u2192 v' + (_nl.modelVersion + 1), `Epoch ${prog.epoch}/${prog.max_epochs} (${pct}%)${loss}${eta}`);
    }
    _nlRefreshTrainView();
    window._nlRefreshBanner();
  }, (logLine) => {
    _nl.trainLogs.push(logLine);
    _nlAppendTrainLog(logLine);
  }, true /* refine */).then(result => {
    _nl.trainResult = result;
    _nl.trainPhase = 'done';
    _nl.training = false;
    _nlUpdatePillIndicator();
    _nl.ready = true;
    _nl.modelVersion++;
    _nlCheckGazeMasterAchievement();
    _nl.implicitCount = 0; // cleared on server
    const valPx = result.val_error_px;
    _nl.baselineValError = valPx;
    window._nlUpdateAdaptiveRadius(valPx);
    const label = valPx < 80 ? 'Good' : valPx < 150 ? 'Fair' : 'Poor';
    const color = valPx < 80 ? '#4ade80' : valPx < 150 ? '#fbbf24' : '#f87171';
    _nlFinishTrainPill('Refinement Done \u2014 v' + _nl.modelVersion, `Val ${valPx}px \u2014 ${label}`, color);
    _nlShowModelUpdatedPill(_nl.modelVersion, valPx);
    _nlRefreshTrainView();
    window.renderNeuralookView();
  }).catch(e => {
    _nl.trainPhase = 'error';
    _nl.training = false;
    _nlUpdatePillIndicator();
    _nl.trainResult = { error: e.message || String(e) };
    _nlErrorTrainPill(e.message || String(e));
    _nlRefreshTrainView();
    window.renderNeuralookView();
  });
}
