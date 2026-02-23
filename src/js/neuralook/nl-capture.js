// nl-capture.js — MediaPipe init, eye crop capture, camera/video management

import { _nl, _NL_EYE_W, _NL_EYE_H, _nlUpdatePillIndicator } from '/js/neuralook/nl-state.js';
import { logger } from '/js/logger.js';

// ── MediaPipe CDN ready listener ──

window.addEventListener('mediapipe-ready', () => {
  _nl.mpCdnLoaded = true;
  if (document.getElementById('neuralook-content')) window.renderNeuralookView();
});

// ── Eye Crop Preview ──

export function _nlStartEyeCropPreview() {
  if (_nl.eyeCropRAF) cancelAnimationFrame(_nl.eyeCropRAF);
  function loop() {
    if (!document.getElementById('nl-train-eye-left')) { _nl.eyeCropRAF = null; return; }
    _nlDrawEyeCrops();
    _nl.eyeCropRAF = requestAnimationFrame(loop);
  }
  _nl.eyeCropRAF = requestAnimationFrame(loop);
}

export function _nlDrawEyeCrops() {
  const leftCanvas = document.getElementById('nl-train-eye-left');
  const rightCanvas = document.getElementById('nl-train-eye-right');
  if (!leftCanvas || !rightCanvas) return;

  // Try live capture if video is available
  let data = _nl.lastCapture;
  if (_nl.faceLandmarker && _nl.videoEl && _nl.videoEl.srcObject) {
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

// ── MediaPipe Initialization ──

export async function _nlInitMediapipe() {
  if (_nl.faceLandmarker) return true;
  if (!window.FaceLandmarker || !window.FilesetResolver) {
    await new Promise((resolve) => {
      if (window.FaceLandmarker && window.FilesetResolver) { resolve(); return; }
      const onReady = () => { window.removeEventListener('mediapipe-ready', onReady); resolve(); };
      window.addEventListener('mediapipe-ready', onReady);
      setTimeout(onReady, 15000);
    });
    if (!window.FaceLandmarker || !window.FilesetResolver) {
      _nl.mpModelLoading = false;
      return false;
    }
  }
  _nl.mpModelLoading = true;
  if (document.getElementById('neuralook-content')) window.renderNeuralookView();
  try {
    const vision = await window.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
    );
    _nl.faceLandmarker = await window.FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: false,
      outputFaceBlendshapes: false
    });
    _nl.mpModelLoading = false;
    _nl.mpModelReady = true;
    return true;
  } catch (e) {
    logger.error('Neuralook: MediaPipe init error', e);
    _nl.mpModelLoading = false;
    return false;
  }
}

// ── Eye Crop Capture ──

export function _nlGetEyeCropCanvas() {
  if (!_nl.eyeCropCanvas) {
    _nl.eyeCropCanvas = document.createElement('canvas');
    _nl.eyeCropCanvas.width = _NL_EYE_W;
    _nl.eyeCropCanvas.height = _NL_EYE_H;
  }
  return _nl.eyeCropCanvas;
}

export function _nlCaptureEyeCrops() {
  // Detect face, crop both eyes from video, return as flat grayscale array [4096]
  if (!_nl.faceLandmarker || !_nl.videoEl) return null;
  const result = _nl.faceLandmarker.detectForVideo(_nl.videoEl, performance.now());
  if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) return null;
  const lm = result.faceLandmarks[0];

  const vw = _nl.videoEl.videoWidth;
  const vh = _nl.videoEl.videoHeight;
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
    ctx.drawImage(_nl.videoEl, -cx * vw, -cy * vh);
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

// ── Camera / Video Management ──

export async function _nlEnsureVideo() {
  if (_nl.videoEl && _nl.videoEl.srcObject) return _nl.videoEl;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 720 } });
  const vidView = new View('video').attr('autoplay', '').attr('muted', '').attr('playsinline', '');
  _nl.videoEl = vidView.el;
  _nl.videoEl.srcObject = stream;
  _nl.videoEl.autoplay = true;
  _nl.videoEl.muted = true;
  _nl.videoEl.playsInline = true;
  await new Promise(resolve => {
    _nl.videoEl.onloadeddata = resolve;
    if (_nl.videoEl.readyState >= 2) resolve();
  });
  return _nl.videoEl;
}

export function _nlStopVideo() {
  if (_nl.videoEl && _nl.videoEl.srcObject) {
    _nl.videoEl.srcObject.getTracks().forEach(t => t.stop());
    _nl.videoEl.srcObject = null;
  }
  _nl.videoEl = null;
}

export function _nlAttachCameraPreview() {
  const previewBox = document.getElementById('nl-camera-preview');
  if (!previewBox || previewBox.querySelector('video')) return;
  const vid = _nl.videoEl;
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
  if (_nl.cameraOn) {
    _nl.cameraOn = false;
    _nlUpdatePillIndicator();
    if (_nl.tracking) window._nlStopTracking();
    if (!_nl.calibrating) _nlStopVideo();
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
    _nl.cameraOn = true;
    _nlUpdatePillIndicator();
    _nlAttachCameraPreview();
    if (!(_nl.videoEl && _nl.videoEl.srcObject)) {
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
  if (btn) btn.textContent = _nl.cameraOn ? 'Turn Camera Off' : 'Turn Camera On';
  window.renderNeuralookView();
}
