// nl-state.js — Shared mutable state + constants for Neuralook eye-tracking

import Settings from '/js/core/core-settings.js';
import { showAchievement } from '/js/core/core-ui.js';

// ── Constants ──

export const _NL_BUFFER_SIZE = 6;
export const _NL_GRAPH_LEN = 60;
export const _NL_HEATMAP_COLS = 16;
export const _NL_HEATMAP_ROWS = 10;
export const _NL_FIXATION_RADIUS = 50;
export const _NL_FIXATION_MIN_MS = 150;
export const _NL_EYE_W = 128;
export const _NL_EYE_H = 64;
export const _NL_STARE_MS = 800;
export const _NL_SETTLE_MS = 150;

export const _NL_CAL_POSITIONS = [
  [10,10],[50,10],[90,10],
  [10,50],[50,50],[90,50],
  [10,90],[50,90],[90,90]
];

// ── Shared mutable state ──

export const _nl = {
  // Core tracking state
  calibrating: false,
  tracking: false,
  gazeDot: null,
  ready: false,
  gazeX: 0,
  gazeY: 0,
  currentPoint: 0,
  cameraOn: false,

  // MediaPipe state (used to locate eyes in video frames)
  faceLandmarker: null,
  videoEl: null,
  mpCdnLoaded: !!(window.FaceLandmarker && window.FilesetResolver),
  mpModelLoading: false,
  mpModelReady: false,
  trackingRAF: null,

  // Calibration data: array of { eyeData: [4096], screenX, screenY, headPose: [yaw, pitch, roll], irisFeatures: [6] }
  calibData: [],
  modelTrained: false,
  trainError: null,
  valError: null,
  inferPending: false,
  calibSaved: false,

  // Eye crop canvas (offscreen, reused)
  eyeCropCanvas: null,
  eyeCropRAF: null,

  // Training state (for full-page training view)
  training: false,
  trainPhase: '',        // 'training' | 'evaluating' | 'done' | 'error'
  trainProgress: null,   // latest progress event
  trainResult: null,     // final result from done event
  trainLossHistory: [],  // [{epoch, val_loss}]
  trainLogs: [],         // raw log lines from server
  trainStartTime: 0,
  showTrainView: true,   // toggle between training detail and normal view
  trainAbort: null,      // AbortController for in-flight training request

  // Implicit calibration (click collection)
  implicitBuffer: [],
  lastCapture: null,     // { eyeData, headPose, irisFeatures, ts }
  lastPrediction: null,  // { x, y, ts }
  implicitCount: 0,      // server-side count
  implicitLastFlush: 0,

  // Auto-refine (continuous passive learning)
  autoRefineEnabled: true,
  lastAutoRefineTime: 0,
  autoRefineInProgress: false,
  refinementHistory: [],
  baselineValError: null,
  adaptiveRadius: 500,
  timedFlushInterval: null,
  modelVersion: 0,       // increments on each successful train/refine

  // Model type selection
  modelType: 'cnn',      // 'cnn' | 'mobilenet'
  modelState: {
    cnn: { version: 0, trainError: null, valError: null, trained: false, baselineValError: null },
    mobilenet: { version: 0, trainError: null, valError: null, trained: false, baselineValError: null }
  },

  // Smoothing
  gazeBuffer: [],

  // Stats
  predictionCount: 0,
  predictionsThisSec: 0,
  predictionRate: 0,
  statsInterval: null,
  rateInterval: null,

  // Graph history
  histGazeX: [],
  histGazeY: [],
  histJitter: [],
  histRate: [],

  // Session stats
  sessionStartTime: 0,
  sessionPredictions: 0,
  heatmapGrid: new Array(_NL_HEATMAP_COLS * _NL_HEATMAP_ROWS).fill(0),
  heatmapMax: 0,
  fixationCount: 0,
  fixationDurations: [],
  saccadeCount: 0,
  currentFixation: null
};

// ── Utility functions ──

export function _nlCheckGazeMasterAchievement() {
  if (_nl.modelVersion >= 5 && !Settings.get('ach_gaze_master')) {
    Settings.set('ach_gaze_master', '1');
    if (typeof showAchievement === 'function') showAchievement('Gaze Master', 'Trained your eye-tracking model 5 times');
  }
}

export function _nlModelLabel() {
  return _nl.modelType === 'mobilenet' ? 'MobileNet' : 'CNN';
}

export function _nlSetModelType(type) {
  if (type === _nl.modelType) return;
  // Save current state
  _nl.modelState[_nl.modelType] = {
    version: _nl.modelVersion,
    trainError: _nl.trainError,
    valError: _nl.valError,
    trained: _nl.modelTrained,
    baselineValError: _nl.baselineValError
  };
  // Restore target state
  const s = _nl.modelState[type];
  _nl.modelVersion = s.version;
  _nl.trainError = s.trainError;
  _nl.valError = s.valError;
  _nl.modelTrained = s.trained;
  _nl.baselineValError = s.baselineValError;
  _nl.modelType = type;
  window.renderNeuralookView();
}

export function _nlUpdatePillIndicator() {
  const el = document.getElementById('sb-neuralook');
  if (!el) return;
  el.classList.toggle('nl-active', _nl.tracking || _nl.calibrating || _nl.training || _nl.cameraOn);
}
