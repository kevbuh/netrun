/* ── Slides Editor (.slides) — Multi-slide Fabric.js presentation editor ── */

var _slidesCanvas = null;
var _slidesData = null;
var _slidesCurrentIdx = 0;
var _slidesUndoStacks = {};  // per-slide: { slideId: [states] }
var _slidesRedoStacks = {};  // per-slide: { slideId: [states] }
var _slidesSaving = false;
var _slidesCurrentTool = 'select';
var _slidesFname = '';
var _slidesKeyHandler = null;
var _slidesPasteHandler = null;
var _slidesResizeHandler = null;
var _slidesIsDrawingShape = false;
var _slidesShapeOrigin = null;
var _slidesTempShape = null;
var _slidesSaveTimer = null;
var _slidesPresentOverlay = null;
var _slidesPresentCanvas = null;
var _slidesPresentIdx = 0;

// ── Presentation Themes ──
var _slidesThemes = [
  { id: 'midnight',  name: 'Midnight',   bg: '#1a1a2e', fill: '#e0e0e0', stroke: '#e0e0e0', accent: '#b4451a', preview: ['#1a1a2e','#e0e0e0'] },
  { id: 'dark',      name: 'Dark',       bg: '#111111', fill: '#ffffff', stroke: '#ffffff', accent: '#3b82f6', preview: ['#111111','#ffffff'] },
  { id: 'light',     name: 'Light',      bg: '#ffffff', fill: '#1a1a1a', stroke: '#1a1a1a', accent: '#b4451a', preview: ['#ffffff','#1a1a1a'] },
  { id: 'paper',     name: 'Paper',      bg: '#f5f0e8', fill: '#2c2416', stroke: '#2c2416', accent: '#8b6914', preview: ['#f5f0e8','#2c2416'] },
  { id: 'ocean',     name: 'Ocean',      bg: '#0f2027', fill: '#a8d8ea', stroke: '#a8d8ea', accent: '#38b2ac', preview: ['#0f2027','#a8d8ea'] },
  { id: 'forest',    name: 'Forest',     bg: '#1a2e1a', fill: '#c8e6c9', stroke: '#c8e6c9', accent: '#4caf50', preview: ['#1a2e1a','#c8e6c9'] },
  { id: 'sunset',    name: 'Sunset',     bg: '#2d1b30', fill: '#f8d7da', stroke: '#f8d7da', accent: '#e76f51', preview: ['#2d1b30','#f8d7da'] },
  { id: 'nord',      name: 'Nord',       bg: '#2e3440', fill: '#d8dee9', stroke: '#d8dee9', accent: '#88c0d0', preview: ['#2e3440','#d8dee9'] },
  { id: 'lavender',  name: 'Lavender',   bg: '#1e1b2e', fill: '#d4c5f9', stroke: '#d4c5f9', accent: '#9b59b6', preview: ['#1e1b2e','#d4c5f9'] },
  { id: 'chalk',     name: 'Chalk',      bg: '#2d4a3e', fill: '#e8e0d0', stroke: '#e8e0d0', accent: '#f0c040', preview: ['#2d4a3e','#e8e0d0'] },
  { id: 'mono',      name: 'Mono',       bg: '#fafafa', fill: '#222222', stroke: '#222222', accent: '#222222', preview: ['#fafafa','#222222'] },
  { id: 'neon',      name: 'Neon',       bg: '#0a0a0a', fill: '#39ff14', stroke: '#39ff14', accent: '#ff00ff', preview: ['#0a0a0a','#39ff14'] },
];
var _slidesPresentKeyHandler = null;

function _cleanupSlidesEditor() {
  if (_slidesCanvas) {
    _slidesCanvas.dispose();
    _slidesCanvas = null;
  }
  if (_slidesKeyHandler) {
    document.removeEventListener('keydown', _slidesKeyHandler);
    _slidesKeyHandler = null;
  }
  if (_slidesPasteHandler) {
    document.removeEventListener('paste', _slidesPasteHandler);
    _slidesPasteHandler = null;
  }
  if (_slidesResizeHandler) {
    window.removeEventListener('resize', _slidesResizeHandler);
    _slidesResizeHandler = null;
  }
  if (_slidesSaveTimer) { clearTimeout(_slidesSaveTimer); _slidesSaveTimer = null; }
  _slidesExitPresent();
  _slidesData = null;
  _slidesUndoStacks = {};
  _slidesRedoStacks = {};
  _slidesIsDrawingShape = false;
  _slidesShapeOrigin = null;
  _slidesTempShape = null;
}

function renderSlidesEditor(fname, content) {
  _cleanupSlidesEditor();
  _slidesFname = fname;

  try { _slidesData = JSON.parse(content || '{}'); } catch { _slidesData = null; }
  if (!_slidesData || !_slidesData.slides || !_slidesData.slides.length) {
    _slidesData = { version: 1, slides: [{ id: 'slide-1', objects: [], background: null }] };
  }
  _slidesCurrentIdx = 0;

  const editor = document.getElementById('exp-file-editor');
  editor.innerHTML = '';
  editor.style.display = 'flex';
  editor.style.flexDirection = 'column';
  editor.style.height = '100%';

  // Top bar
  const topBar = document.createElement('div');
  topBar.className = 'flex items-center justify-between px-4 py-2 border-b border-border-dim bg-card/50';
  topBar.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-[0.7rem] px-1.5 py-0.5 rounded font-medium bg-pink-500/20 text-pink-400">sld</span>
      <span class="text-[0.85rem] text-primary font-medium cursor-pointer hover:text-accent transition-colors" onclick="startRenameFileInViewer('${escapeHtml(fname)}')" title="Click to rename">${escapeHtml(fname)}</span>
    </div>
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <label class="text-[0.75rem] text-dimmer">Fill</label>
        <input type="color" id="slides-fill" value="#b4451a" class="w-6 h-6 border border-border-input rounded cursor-pointer bg-transparent p-0">
        <label class="text-[0.75rem] text-dimmer">Stroke</label>
        <input type="color" id="slides-stroke" value="#e0e0e0" class="w-6 h-6 border border-border-input rounded cursor-pointer bg-transparent p-0">
        <label class="text-[0.75rem] text-dimmer">Width</label>
        <input type="range" id="slides-stroke-width" min="1" max="20" value="2" class="w-16" style="accent-color:var(--accent)">
      </div>
      <button class="draw-tool" onclick="_slidesPresentMode()" title="Present (F5)">
        <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <button class="draw-tool" onclick="_toggleSlidesShareMenu(this)" title="Share & Export">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>`;
  editor.appendChild(topBar);

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'draw-toolbar';
  toolbar.innerHTML = `
    <button class="draw-tool active" data-tool="select" onclick="_setSlidesTool('select')" title="Select (V)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>
    </button>
    <button class="draw-tool" data-tool="rect" onclick="_setSlidesTool('rect')" title="Rectangle (R)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
    </button>
    <button class="draw-tool" data-tool="circle" onclick="_setSlidesTool('circle')" title="Ellipse (C)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="10" ry="10"/></svg>
    </button>
    <button class="draw-tool" data-tool="line" onclick="_setSlidesTool('line')" title="Line (L)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/></svg>
    </button>
    <button class="draw-tool" data-tool="arrow" onclick="_setSlidesTool('arrow')" title="Arrow (A)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="10 5 19 5 19 14"/></svg>
    </button>
    <button class="draw-tool" data-tool="pen" onclick="_setSlidesTool('pen')" title="Pen (P)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>
    </button>
    <button class="draw-tool" data-tool="text" onclick="_setSlidesTool('text')" title="Text (T)">
      <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>
    </button>
    <button class="draw-tool" data-tool="image" onclick="_slidesPickImage()" title="Image (I)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
    </button>
    <button class="draw-tool" data-tool="latex" onclick="_setSlidesTool('latex')" title="LaTeX (M)">
      <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M9 4l-2 8h4l-2 8 7-10h-4l3-6z"/></svg>
    </button>
    <button class="draw-tool" onclick="_slidesShowThemePicker(this)" title="Themes">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.8-.1 2.6-.4a1 1 0 00.6-1.2l-.5-1.8a1 1 0 01.6-1.2A6 6 0 0018 12c0-3.3-2.7-6-6-6" stroke-linecap="round"/><circle cx="7.5" cy="11" r="1.5" fill="currentColor"/><circle cx="12" cy="7.5" r="1.5" fill="currentColor"/><circle cx="16.5" cy="11" r="1.5" fill="currentColor"/></svg>
    </button>
    <span class="draw-sep"></span>
    <button class="draw-tool" onclick="_slidesDeleteSelected()" title="Delete (Del)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
    </button>
    <button class="draw-tool" onclick="_slidesUndo()" title="Undo (Ctrl+Z)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 10h10a5 5 0 015 5v0a5 5 0 01-5 5H3"/><polyline points="8 15 3 10 8 5"/></svg>
    </button>
    <button class="draw-tool" onclick="_slidesRedo()" title="Redo (Ctrl+Shift+Z)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 10H11a5 5 0 00-5 5v0a5 5 0 005 5h10"/><polyline points="16 15 21 10 16 5"/></svg>
    </button>
    <span class="draw-sep"></span>
    <button class="draw-tool" onclick="_slidesBringToFront()" title="Bring to Front">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="8" y="2" width="14" height="14" rx="1"/><rect x="2" y="8" width="14" height="14" rx="1" opacity="0.4"/></svg>
    </button>
    <button class="draw-tool" onclick="_slidesSendToBack()" title="Send to Back">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="14" height="14" rx="1"/><rect x="8" y="2" width="14" height="14" rx="1" opacity="0.4"/></svg>
    </button>`;
  editor.appendChild(toolbar);

  // Main area: thumbnail panel + canvas
  const main = document.createElement('div');
  main.style.cssText = 'flex:1;display:flex;overflow:hidden;min-height:0';

  // Thumbnail panel
  const thumbPanel = document.createElement('div');
  thumbPanel.id = 'slides-thumb-panel';
  thumbPanel.className = 'slides-thumb-panel';
  main.appendChild(thumbPanel);

  // Canvas container
  const canvasWrap = document.createElement('div');
  canvasWrap.id = 'slides-canvas-wrap';
  canvasWrap.style.cssText = 'flex:1;overflow:hidden;position:relative;background:var(--bg-canvas);display:flex;align-items:center;justify-content:center';
  canvasWrap.innerHTML = '<canvas id="slides-canvas"></canvas>';
  main.appendChild(canvasWrap);

  editor.appendChild(main);

  requestAnimationFrame(() => _initSlidesCanvas());
}

function _initSlidesCanvas(_retries) {
  const wrap = document.getElementById('slides-canvas-wrap');
  if (!wrap) return;

  // Retry if layout hasn't computed yet (height is 0)
  if (wrap.clientHeight < 10 && (_retries || 0) < 10) {
    setTimeout(() => _initSlidesCanvas((_retries || 0) + 1), 50);
    return;
  }

  // Calculate 16:9 dimensions that fit the container
  const containerW = wrap.clientWidth - 32;
  const containerH = wrap.clientHeight - 32;
  let cw, ch;
  if (containerW / containerH > 16 / 9) {
    ch = containerH;
    cw = Math.floor(ch * 16 / 9);
  } else {
    cw = containerW;
    ch = Math.floor(cw * 9 / 16);
  }
  cw = Math.max(cw, 320);
  ch = Math.max(ch, 180);

  _slidesCanvas = new fabric.Canvas('slides-canvas', {
    width: cw,
    height: ch,
    backgroundColor: '#1a1a2e',
    selection: true,
    preserveObjectStacking: true,
  });

  // Style the canvas container
  const canvasEl = _slidesCanvas.wrapperEl;
  canvasEl.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4)';
  canvasEl.style.borderRadius = '4px';

  // Load current slide
  _slidesLoadSlide(_slidesCurrentIdx);

  // Color input listeners
  document.getElementById('slides-fill').addEventListener('input', _slidesApplyColorsToSelection);
  document.getElementById('slides-stroke').addEventListener('input', _slidesApplyColorsToSelection);
  document.getElementById('slides-stroke-width').addEventListener('input', _slidesApplyColorsToSelection);

  _slidesCanvas.on('selection:created', _slidesSyncColorInputs);
  _slidesCanvas.on('selection:updated', _slidesSyncColorInputs);

  _slidesCanvas.on('object:modified', _slidesOnChange);
  _slidesCanvas.on('object:added', _slidesOnChange);
  _slidesCanvas.on('object:removed', _slidesOnChange);

  _slidesCanvas.on('mouse:down', _slidesMouseDown);
  _slidesCanvas.on('mouse:move', _slidesMouseMove);
  _slidesCanvas.on('mouse:up', _slidesMouseUp);
  _slidesCanvas.on('mouse:dblclick', _slidesMouseDblClick);

  // Auto-convert text to LaTeX when it contains LaTeX commands
  _slidesCanvas.on('text:editing:exited', function(opt) {
    const obj = opt.target;
    if (!obj || obj._latexSrc) return;
    const txt = (obj.text || '').trim();
    if (!txt || !/\\[a-zA-Z]/.test(txt)) return;
    const x = obj.left, y = obj.top;
    _slidesCanvas.remove(obj);
    _slidesInsertLatex(txt, x, y, null);
  });

  // Keyboard shortcuts
  _slidesKeyHandler = function(e) {
    // Present mode keys
    if (_slidesPresentOverlay) return;

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (_slidesCanvas && _slidesCanvas.getActiveObject() && _slidesCanvas.getActiveObject().isEditing) return;

    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); _slidesUndo(); }
      else if (key === 'z' && e.shiftKey) { e.preventDefault(); _slidesRedo(); }
      return;
    }
    if (key === 'f5') { e.preventDefault(); _slidesPresentMode(); return; }
    if (key === 'escape') return;
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); _slidesDeleteSelected(); }
    else if (key === 'v') _setSlidesTool('select');
    else if (key === 'r') _setSlidesTool('rect');
    else if (key === 'c') _setSlidesTool('circle');
    else if (key === 'l') _setSlidesTool('line');
    else if (key === 'a') _setSlidesTool('arrow');
    else if (key === 'p') _setSlidesTool('pen');
    else if (key === 't') _setSlidesTool('text');
    else if (key === 'i') _slidesPickImage();
    else if (key === 'm') _setSlidesTool('latex');
    else if (key === 'pagedown') { e.preventDefault(); if (_slidesCurrentIdx < _slidesData.slides.length - 1) _slidesSwitchTo(_slidesCurrentIdx + 1); }
    else if (key === 'pageup') { e.preventDefault(); if (_slidesCurrentIdx > 0) _slidesSwitchTo(_slidesCurrentIdx - 1); }
    else if (key === 'arrowleft') {
      if (_slidesCanvas.getActiveObjects().length) { e.preventDefault(); _slidesNudge(-1 * (e.shiftKey ? 10 : 1), 0); }
    }
    else if (key === 'arrowright') {
      if (_slidesCanvas.getActiveObjects().length) { e.preventDefault(); _slidesNudge(1 * (e.shiftKey ? 10 : 1), 0); }
    }
    else if (key === 'arrowup') {
      if (_slidesCanvas.getActiveObjects().length) { e.preventDefault(); _slidesNudge(0, -1 * (e.shiftKey ? 10 : 1)); }
    }
    else if (key === 'arrowdown') {
      if (_slidesCanvas.getActiveObjects().length) { e.preventDefault(); _slidesNudge(0, 1 * (e.shiftKey ? 10 : 1)); }
    }
  };
  document.addEventListener('keydown', _slidesKeyHandler);

  // Paste handler
  _slidesPasteHandler = function(e) {
    if (!_slidesCanvas || _slidesPresentOverlay) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        const reader = new FileReader();
        reader.onload = function(ev) {
          fabric.Image.fromURL(ev.target.result, function(img) {
            const maxDim = Math.min(_slidesCanvas.width, _slidesCanvas.height) * 0.6;
            if (img.width > maxDim || img.height > maxDim) {
              const scale = maxDim / Math.max(img.width, img.height);
              img.scale(scale);
            }
            img.set({ left: 50, top: 50 });
            _slidesCanvas.add(img);
            _slidesCanvas.setActiveObject(img);
            _slidesCanvas.renderAll();
          });
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  };
  document.addEventListener('paste', _slidesPasteHandler);

  // Resize handler
  _slidesResizeHandler = function() {
    if (!_slidesCanvas) return;
    const wrap = document.getElementById('slides-canvas-wrap');
    if (!wrap) return;
    const containerW = wrap.clientWidth - 32;
    const containerH = wrap.clientHeight - 32;
    let cw, ch;
    if (containerW / containerH > 16 / 9) {
      ch = containerH;
      cw = Math.floor(ch * 16 / 9);
    } else {
      cw = containerW;
      ch = Math.floor(cw * 9 / 16);
    }
    cw = Math.max(cw, 320);
    ch = Math.max(ch, 180);
    _slidesCanvas.setWidth(cw);
    _slidesCanvas.setHeight(ch);
    _slidesCanvas.renderAll();
  };
  window.addEventListener('resize', _slidesResizeHandler);

  _renderSlidesThumbnails();
}

// ── Slide Data Helpers ──

function _slidesCurrentSlide() {
  return _slidesData.slides[_slidesCurrentIdx];
}

function _slidesSaveCurrentCanvas() {
  if (!_slidesCanvas || !_slidesData) return;
  const slide = _slidesCurrentSlide();
  if (!slide) return;
  const json = _slidesCanvas.toJSON(['_latexSrc']);
  slide.objects = json.objects || [];
  slide.background = json.background || null;
}

function _slidesLoadSlide(idx) {
  if (!_slidesCanvas || !_slidesData) return;
  const slide = _slidesData.slides[idx];
  if (!slide) return;

  // Temporarily remove change listeners
  _slidesCanvas.off('object:modified', _slidesOnChange);
  _slidesCanvas.off('object:added', _slidesOnChange);
  _slidesCanvas.off('object:removed', _slidesOnChange);

  const loadData = {
    objects: slide.objects || [],
    background: slide.background || '#1a1a2e',
  };

  _slidesCanvas.loadFromJSON(loadData, () => {
    _slidesCanvas.renderAll();
    _slidesCanvas.on('object:modified', _slidesOnChange);
    _slidesCanvas.on('object:added', _slidesOnChange);
    _slidesCanvas.on('object:removed', _slidesOnChange);

    // Init undo stack for this slide if needed
    if (!_slidesUndoStacks[slide.id]) {
      _slidesUndoStacks[slide.id] = [JSON.stringify(_slidesCanvas.toJSON(['_latexSrc']))];
      _slidesRedoStacks[slide.id] = [];
    }
  });
}

function _slidesSwitchTo(idx) {
  if (!_slidesData || idx < 0 || idx >= _slidesData.slides.length) return;
  _slidesSaveCurrentCanvas();
  _slidesCurrentIdx = idx;
  _slidesLoadSlide(idx);
  _renderSlidesThumbnails();
}

// ── Slide Management ──

function _slidesAddSlide() {
  if (!_slidesData) return;
  _slidesSaveCurrentCanvas();
  const currentBg = _slidesData.slides[_slidesCurrentIdx]?.background || null;
  const newSlide = {
    id: 'slide-' + Date.now(),
    objects: [],
    background: currentBg,
  };
  _slidesData.slides.splice(_slidesCurrentIdx + 1, 0, newSlide);
  _slidesCurrentIdx = _slidesCurrentIdx + 1;
  _slidesLoadSlide(_slidesCurrentIdx);
  _renderSlidesThumbnails();
  _slidesSave();
}

function _slidesDeleteSlide(idx) {
  if (!_slidesData || _slidesData.slides.length <= 1) return;
  const slide = _slidesData.slides[idx];
  delete _slidesUndoStacks[slide.id];
  delete _slidesRedoStacks[slide.id];
  _slidesData.slides.splice(idx, 1);
  if (_slidesCurrentIdx >= _slidesData.slides.length) {
    _slidesCurrentIdx = _slidesData.slides.length - 1;
  } else if (idx <= _slidesCurrentIdx && _slidesCurrentIdx > 0) {
    _slidesCurrentIdx--;
  }
  _slidesLoadSlide(_slidesCurrentIdx);
  _renderSlidesThumbnails();
  _slidesSave();
}

function _slidesDuplicateSlide(idx) {
  if (!_slidesData) return;
  _slidesSaveCurrentCanvas();
  const src = _slidesData.slides[idx];
  const dup = {
    id: 'slide-' + Date.now(),
    objects: JSON.parse(JSON.stringify(src.objects)),
    background: src.background,
  };
  _slidesData.slides.splice(idx + 1, 0, dup);
  _slidesCurrentIdx = idx + 1;
  _slidesLoadSlide(_slidesCurrentIdx);
  _renderSlidesThumbnails();
  _slidesSave();
}

// ── Thumbnails ──

function _renderSlidesThumbnails() {
  const panel = document.getElementById('slides-thumb-panel');
  if (!panel || !_slidesData) return;

  // Save current canvas to get accurate thumbnail
  if (_slidesCanvas) _slidesSaveCurrentCanvas();

  panel.innerHTML = '';

  _slidesData.slides.forEach((slide, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'slides-thumb' + (idx === _slidesCurrentIdx ? ' active' : '');
    thumb.onclick = () => _slidesSwitchTo(idx);

    // Number label
    const num = document.createElement('div');
    num.className = 'text-[0.65rem] text-dimmer mb-1';
    num.textContent = idx + 1;
    thumb.appendChild(num);

    // Mini preview
    const preview = document.createElement('div');
    preview.className = 'slides-thumb-preview';
    preview.style.cssText = 'width:160px;height:90px;background:#1a1a2e;border-radius:3px;overflow:hidden;position:relative';

    // Render mini canvas for this slide
    if (idx === _slidesCurrentIdx && _slidesCanvas) {
      try {
        const dataUrl = _slidesCanvas.toDataURL({ format: 'png', multiplier: 0.2 });
        preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain" />`;
      } catch { /* canvas not ready */ }
    } else if (slide.objects && slide.objects.length > 0) {
      // Render using a temp canvas
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = 160;
      tmpCanvas.height = 90;
      const tmpFabric = new fabric.StaticCanvas(tmpCanvas, { width: 160, height: 90, backgroundColor: slide.background || '#1a1a2e' });
      try {
        tmpFabric.loadFromJSON({ objects: slide.objects, background: slide.background || '#1a1a2e' }, () => {
          // Scale objects to fit thumbnail
          const origW = _slidesCanvas ? _slidesCanvas.width : 960;
          const origH = _slidesCanvas ? _slidesCanvas.height : 540;
          const scale = Math.min(160 / origW, 90 / origH);
          tmpFabric.setZoom(scale);
          tmpFabric.renderAll();
          try {
            preview.innerHTML = `<img src="${tmpFabric.toDataURL()}" style="width:100%;height:100%;object-fit:contain" />`;
          } catch { /* */ }
          tmpFabric.dispose();
        });
      } catch { tmpFabric.dispose(); }
    }

    thumb.appendChild(preview);

    // Hover buttons
    const btns = document.createElement('div');
    btns.className = 'slides-thumb-btns';
    btns.innerHTML = `
      <button onclick="event.stopPropagation(); _slidesDuplicateSlide(${idx})" class="w-5 h-5 rounded bg-card/80 border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-primary text-[0.7rem]" title="Duplicate">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </button>
      ${_slidesData.slides.length > 1 ? `<button onclick="event.stopPropagation(); _slidesDeleteSlide(${idx})" class="w-5 h-5 rounded bg-card/80 border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400 text-[0.7rem]" title="Delete">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>` : ''}`;
    thumb.appendChild(btns);

    panel.appendChild(thumb);
  });

  // Add slide button
  const addBtn = document.createElement('div');
  addBtn.className = 'slides-thumb-add';
  addBtn.onclick = () => _slidesAddSlide();
  addBtn.innerHTML = '<span class="text-dimmer text-lg">+</span>';
  panel.appendChild(addBtn);
}

// ── Drawing Tools (mirrors .draw editor) ──

function _getSlidesColors() {
  const fill = document.getElementById('slides-fill');
  const stroke = document.getElementById('slides-stroke');
  const sw = document.getElementById('slides-stroke-width');
  return {
    fill: fill ? fill.value : '#b4451a',
    stroke: stroke ? stroke.value : '#e0e0e0',
    strokeWidth: sw ? parseInt(sw.value) : 2,
  };
}

function _slidesShowThemePicker(btn) {
  // Close if already open
  const existing = document.getElementById('slides-theme-picker');
  if (existing) { existing.remove(); return; }

  const rect = btn.getBoundingClientRect();
  const picker = document.createElement('div');
  picker.id = 'slides-theme-picker';
  picker.style.cssText = `position:fixed;top:${rect.bottom + 6}px;left:${rect.left}px;z-index:9999;background:var(--bg-card);border:1px solid var(--border-card);border-radius:10px;padding:12px;box-shadow:0 8px 32px rgba(0,0,0,0.3);width:280px`;

  let html = '<div style="font-size:0.75rem;color:var(--text-dimmer);margin-bottom:8px;font-weight:600">Slide Theme</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">';
  for (const t of _slidesThemes) {
    html += `<button onclick="_slidesApplyTheme('${t.id}')" style="display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 4px;border-radius:6px;border:1px solid var(--border-card);background:transparent;cursor:pointer;transition:border-color 0.15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border-card)'">
      <div style="width:48px;height:27px;border-radius:3px;background:${t.preview[0]};display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid rgba(128,128,128,0.2)">
        <div style="width:20px;height:3px;border-radius:1px;background:${t.preview[1]}"></div>
      </div>
      <span style="font-size:0.6rem;color:var(--text-dimmer)">${t.name}</span>
    </button>`;
  }
  html += '</div>';

  // "Apply to all slides" checkbox
  html += `<label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:0.7rem;color:var(--text-dim);cursor:pointer">
    <input type="checkbox" id="slides-theme-all" checked style="accent-color:var(--accent)"> Apply to all slides
  </label>`;

  picker.innerHTML = html;
  document.body.appendChild(picker);

  // Close on outside click
  const close = (e) => {
    if (!picker.contains(e.target) && e.target !== btn) {
      picker.remove();
      document.removeEventListener('mousedown', close);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

function _slidesApplyTheme(themeId) {
  const theme = _slidesThemes.find(t => t.id === themeId);
  if (!theme || !_slidesCanvas || !_slidesData) return;

  const applyAll = document.getElementById('slides-theme-all')?.checked;

  // Update color inputs
  const fillInput = document.getElementById('slides-fill');
  const strokeInput = document.getElementById('slides-stroke');
  if (fillInput) fillInput.value = theme.fill;
  if (strokeInput) strokeInput.value = theme.stroke;

  if (applyAll) {
    // Save current slide first
    _slidesSaveCurrentCanvas();
    // Apply to every slide
    for (let i = 0; i < _slidesData.slides.length; i++) {
      _slidesData.slides[i].background = theme.bg;
      // Recolor text objects in each slide
      if (_slidesData.slides[i].objects) {
        for (const obj of _slidesData.slides[i].objects) {
          if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
            obj.fill = theme.fill;
          }
        }
      }
    }
    // Reload current slide
    _slidesLoadSlide(_slidesCurrentIdx);
  } else {
    // Apply to current slide only
    _slidesCanvas.setBackgroundColor(theme.bg, () => _slidesCanvas.renderAll());
    // Recolor text objects on current canvas
    _slidesCanvas.getObjects().forEach(obj => {
      if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
        obj.set('fill', theme.fill);
      }
    });
    _slidesCanvas.renderAll();
  }

  _slidesOnChange();
  _renderSlidesThumbnails();

  // Close picker
  const picker = document.getElementById('slides-theme-picker');
  if (picker) picker.remove();
}

function _setSlidesTool(tool) {
  _slidesCurrentTool = tool;
  if (!_slidesCanvas) return;

  document.querySelectorAll('.draw-toolbar .draw-tool[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  _slidesCanvas.isDrawingMode = false;
  _slidesCanvas.selection = tool === 'select';
  _slidesCanvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';

  if (tool === 'select') {
    _slidesCanvas.forEachObject(o => { o.selectable = true; o.evented = true; });
  } else {
    _slidesCanvas.discardActiveObject();
    _slidesCanvas.renderAll();
    if (tool !== 'pen') {
      _slidesCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
    }
  }

  if (tool === 'pen') {
    const colors = _getSlidesColors();
    _slidesCanvas.isDrawingMode = true;
    _slidesCanvas.freeDrawingBrush.color = colors.stroke;
    _slidesCanvas.freeDrawingBrush.width = colors.strokeWidth;
    _slidesCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
  }
}

function _slidesMouseDown(opt) {
  if (!_slidesCanvas) return;
  const tool = _slidesCurrentTool;
  if (tool === 'select' || tool === 'pen') return;

  if (tool === 'text') {
    const pointer = _slidesCanvas.getPointer(opt.e);
    const colors = _getSlidesColors();
    const text = new fabric.IText('Text', {
      left: pointer.x, top: pointer.y, fontSize: 24,
      fill: colors.fill, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    });
    _slidesCanvas.add(text);
    _slidesCanvas.setActiveObject(text);
    text.enterEditing();
    _setSlidesTool('select');
    return;
  }

  if (tool === 'latex') {
    const pointer = _slidesCanvas.getPointer(opt.e);
    _slidesShowLatexInput(pointer.x, pointer.y);
    _setSlidesTool('select');
    return;
  }

  if (tool === 'image') return;

  const pointer = _slidesCanvas.getPointer(opt.e);
  _slidesIsDrawingShape = true;
  _slidesShapeOrigin = { x: pointer.x, y: pointer.y };
  const colors = _getSlidesColors();

  if (tool === 'rect') {
    _slidesTempShape = new fabric.Rect({
      left: pointer.x, top: pointer.y, width: 0, height: 0,
      fill: colors.fill, stroke: colors.stroke, strokeWidth: colors.strokeWidth,
      originX: 'left', originY: 'top',
    });
  } else if (tool === 'circle') {
    _slidesTempShape = new fabric.Ellipse({
      left: pointer.x, top: pointer.y, rx: 0, ry: 0,
      fill: colors.fill, stroke: colors.stroke, strokeWidth: colors.strokeWidth,
      originX: 'left', originY: 'top',
    });
  } else if (tool === 'line' || tool === 'arrow') {
    _slidesTempShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
      stroke: colors.stroke, strokeWidth: colors.strokeWidth, selectable: false,
    });
  }

  if (_slidesTempShape) {
    _slidesCanvas.add(_slidesTempShape);
    _slidesCanvas.renderAll();
  }
}

function _slidesMouseMove(opt) {
  if (!_slidesIsDrawingShape || !_slidesTempShape || !_slidesCanvas) return;
  const pointer = _slidesCanvas.getPointer(opt.e);
  const ox = _slidesShapeOrigin.x;
  const oy = _slidesShapeOrigin.y;
  const tool = _slidesCurrentTool;

  if (tool === 'rect') {
    _slidesTempShape.set({
      left: Math.min(ox, pointer.x), top: Math.min(oy, pointer.y),
      width: Math.abs(pointer.x - ox), height: Math.abs(pointer.y - oy),
    });
  } else if (tool === 'circle') {
    _slidesTempShape.set({
      left: Math.min(ox, pointer.x), top: Math.min(oy, pointer.y),
      rx: Math.abs(pointer.x - ox) / 2, ry: Math.abs(pointer.y - oy) / 2,
    });
  } else if (tool === 'line' || tool === 'arrow') {
    _slidesTempShape.set({ x2: pointer.x, y2: pointer.y });
  }
  _slidesCanvas.renderAll();
}

function _slidesMouseUp(opt) {
  if (!_slidesIsDrawingShape || !_slidesCanvas) return;
  _slidesIsDrawingShape = false;

  if (_slidesTempShape) {
    const tool = _slidesCurrentTool;
    let tooSmall = false;
    if (tool === 'rect') tooSmall = _slidesTempShape.width < 3 && _slidesTempShape.height < 3;
    else if (tool === 'circle') tooSmall = _slidesTempShape.rx < 3 && _slidesTempShape.ry < 3;
    else if (tool === 'line' || tool === 'arrow') {
      const dx = _slidesTempShape.x2 - _slidesTempShape.x1;
      const dy = _slidesTempShape.y2 - _slidesTempShape.y1;
      tooSmall = Math.sqrt(dx * dx + dy * dy) < 3;
    }

    if (tooSmall) {
      _slidesCanvas.remove(_slidesTempShape);
    } else if (tool === 'arrow') {
      const line = _slidesTempShape;
      _slidesCanvas.remove(line);
      _slidesAddArrow(line.x1, line.y1, line.x2, line.y2);
    } else {
      _slidesTempShape.setCoords();
    }
    _slidesTempShape = null;
    _slidesShapeOrigin = null;
    _slidesCanvas.renderAll();
  }
}

function _slidesAddArrow(x1, y1, x2, y2) {
  const colors = _getSlidesColors();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 15;
  const line = new fabric.Line([x1, y1, x2, y2], {
    stroke: colors.stroke, strokeWidth: colors.strokeWidth,
  });
  const head = new fabric.Triangle({
    left: x2, top: y2, originX: 'center', originY: 'center',
    width: headLen, height: headLen, fill: colors.stroke,
    angle: (angle * 180 / Math.PI) + 90,
  });
  const group = new fabric.Group([line, head], { selectable: true });
  _slidesCanvas.add(group);
  _slidesCanvas.renderAll();
}

// ── Canvas Actions ──

function _slidesDeleteSelected() {
  if (!_slidesCanvas) return;
  const active = _slidesCanvas.getActiveObjects();
  if (active.length === 0) return;
  active.forEach(o => _slidesCanvas.remove(o));
  _slidesCanvas.discardActiveObject();
  _slidesCanvas.renderAll();
}

function _slidesBringToFront() {
  if (!_slidesCanvas) return;
  const obj = _slidesCanvas.getActiveObject();
  if (obj) { _slidesCanvas.bringToFront(obj); _slidesCanvas.renderAll(); }
}

function _slidesSendToBack() {
  if (!_slidesCanvas) return;
  const obj = _slidesCanvas.getActiveObject();
  if (obj) { _slidesCanvas.sendToBack(obj); _slidesCanvas.renderAll(); }
}

function _slidesNudge(dx, dy) {
  if (!_slidesCanvas) return;
  const active = _slidesCanvas.getActiveObjects();
  if (active.length === 0) return;
  active.forEach(o => {
    o.set({ left: o.left + dx, top: o.top + dy });
    o.setCoords();
  });
  _slidesCanvas.renderAll();
  _slidesOnChange();
}

function _slidesApplyColorsToSelection() {
  if (!_slidesCanvas) return;
  const objs = _slidesCanvas.getActiveObjects();
  if (objs.length === 0) return;
  const colors = _getSlidesColors();
  objs.forEach(o => {
    if (o.type === 'path' || o.type === 'line') {
      o.set({ stroke: colors.stroke, strokeWidth: colors.strokeWidth });
    } else if (o.type === 'i-text' || o.type === 'text' || o.type === 'textbox') {
      o.set({ fill: colors.fill });
    } else {
      o.set({ fill: colors.fill, stroke: colors.stroke, strokeWidth: colors.strokeWidth });
    }
  });
  _slidesCanvas.renderAll();
  _slidesOnChange();
}

function _slidesSyncColorInputs(opt) {
  const obj = opt.selected ? opt.selected[0] : null;
  if (!obj) return;
  const fillEl = document.getElementById('slides-fill');
  const strokeEl = document.getElementById('slides-stroke');
  const swEl = document.getElementById('slides-stroke-width');
  if (obj.fill && typeof obj.fill === 'string' && obj.fill[0] === '#' && fillEl) fillEl.value = obj.fill.slice(0, 7);
  if (obj.stroke && typeof obj.stroke === 'string' && obj.stroke[0] === '#' && strokeEl) strokeEl.value = obj.stroke.slice(0, 7);
  if (obj.strokeWidth && swEl) swEl.value = obj.strokeWidth;
}

function _slidesPickImage() {
  if (!_slidesCanvas) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      fabric.Image.fromURL(ev.target.result, function(img) {
        const maxDim = Math.min(_slidesCanvas.width, _slidesCanvas.height) * 0.6;
        if (img.width > maxDim || img.height > maxDim) {
          const scale = maxDim / Math.max(img.width, img.height);
          img.scale(scale);
        }
        img.set({ left: 50, top: 50 });
        _slidesCanvas.add(img);
        _slidesCanvas.setActiveObject(img);
        _slidesCanvas.renderAll();
      });
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ── Undo / Redo (per-slide) ──

function _slidesPushUndo() {
  if (!_slidesCanvas || !_slidesData) return;
  const slide = _slidesCurrentSlide();
  if (!slide) return;
  const state = JSON.stringify(_slidesCanvas.toJSON(['_latexSrc']));
  if (!_slidesUndoStacks[slide.id]) _slidesUndoStacks[slide.id] = [];
  const stack = _slidesUndoStacks[slide.id];
  if (stack.length > 0 && stack[stack.length - 1] === state) return;
  stack.push(state);
  if (stack.length > 50) stack.shift();
  _slidesRedoStacks[slide.id] = [];
}

function _slidesUndo() {
  if (!_slidesCanvas || !_slidesData) return;
  const slide = _slidesCurrentSlide();
  if (!slide) return;
  const stack = _slidesUndoStacks[slide.id];
  if (!stack || stack.length <= 1) return;
  const current = stack.pop();
  if (!_slidesRedoStacks[slide.id]) _slidesRedoStacks[slide.id] = [];
  _slidesRedoStacks[slide.id].push(current);
  const prev = stack[stack.length - 1];
  _slidesLoadStateFromString(prev);
}

function _slidesRedo() {
  if (!_slidesCanvas || !_slidesData) return;
  const slide = _slidesCurrentSlide();
  if (!slide) return;
  const redoStack = _slidesRedoStacks[slide.id];
  if (!redoStack || redoStack.length === 0) return;
  const state = redoStack.pop();
  if (!_slidesUndoStacks[slide.id]) _slidesUndoStacks[slide.id] = [];
  _slidesUndoStacks[slide.id].push(state);
  _slidesLoadStateFromString(state);
}

function _slidesLoadStateFromString(stateStr) {
  if (!_slidesCanvas) return;
  _slidesCanvas.off('object:modified', _slidesOnChange);
  _slidesCanvas.off('object:added', _slidesOnChange);
  _slidesCanvas.off('object:removed', _slidesOnChange);

  _slidesCanvas.loadFromJSON(stateStr, () => {
    _slidesCanvas.renderAll();
    _slidesCanvas.on('object:modified', _slidesOnChange);
    _slidesCanvas.on('object:added', _slidesOnChange);
    _slidesCanvas.on('object:removed', _slidesOnChange);
    _slidesSave();
  });
}

// ── Persistence ──

function _slidesOnChange() {
  _slidesPushUndo();
  _slidesSave();
  // Debounced thumbnail update
  clearTimeout(_slidesOnChange._thumbTimer);
  _slidesOnChange._thumbTimer = setTimeout(() => _renderSlidesThumbnails(), 500);
}

function _slidesSave() {
  if (_slidesSaveTimer) clearTimeout(_slidesSaveTimer);
  _slidesSaveTimer = setTimeout(() => {
    if (!_slidesCanvas || !_slidesData || _slidesSaving) return;
    _slidesSaving = true;
    _slidesSaveCurrentCanvas();
    const data = JSON.stringify(_slidesData);
    apiPut(`/api/experiments/${currentExpId}/files/${encodeURIComponent(_slidesFname)}`, { content: data })
      .finally(() => { _slidesSaving = false; });
  }, 600);
}

async function _slidesExportPDF() {
  if (!_slidesData || !_slidesCanvas) return;
  _slidesSaveCurrentCanvas();

  const { jsPDF } = window.jspdf;
  // 16:9 landscape in mm (roughly 254mm x 143mm)
  const pw = 254;
  const ph = pw * 9 / 16;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pw, ph] });

  const editW = _slidesCanvas.width || 960;
  const editH = _slidesCanvas.height || 540;
  // Off-screen static canvas for rendering each slide
  const offscreen = document.createElement('canvas');
  offscreen.id = '_slides-export-canvas';
  offscreen.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(offscreen);

  const renderW = 1920;
  const renderH = 1080;
  const exportCanvas = new fabric.StaticCanvas('_slides-export-canvas', {
    width: renderW, height: renderH, backgroundColor: '#1a1a2e',
  });
  const scale = renderW / editW;

  for (let i = 0; i < _slidesData.slides.length; i++) {
    if (i > 0) pdf.addPage([pw, ph], 'landscape');
    const slide = _slidesData.slides[i];
    const loadData = {
      objects: slide.objects || [],
      background: slide.background || '#1a1a2e',
    };
    await new Promise(resolve => {
      exportCanvas.loadFromJSON(loadData, () => {
        exportCanvas.setZoom(scale);
        exportCanvas.renderAll();
        resolve();
      });
    });
    const imgData = exportCanvas.toDataURL({ format: 'png', multiplier: 1 });
    pdf.addImage(imgData, 'PNG', 0, 0, pw, ph);
  }

  offscreen.remove();
  pdf.save(_slidesFname.replace('.slides', '') + '.pdf');
}

// ── LaTeX Tool ──

function _slidesMouseDblClick(opt) {
  const obj = opt.target;
  if (obj && obj._latexSrc) {
    _slidesShowLatexInput(obj.left, obj.top, obj);
  }
}

function _slidesShowLatexInput(x, y, existingObj) {
  // Remove any existing popup
  const old = document.getElementById('slides-latex-popup');
  if (old) old.remove();

  const wrap = document.getElementById('slides-canvas-wrap');
  if (!wrap || !_slidesCanvas) return;

  const canvasEl = _slidesCanvas.getElement();
  const canvasRect = canvasEl.getBoundingClientRect();
  const zoom = _slidesCanvas.getZoom ? _slidesCanvas.getZoom() : 1;
  const screenX = canvasRect.left + x * zoom;
  const screenY = canvasRect.top + y * zoom;

  const popup = document.createElement('div');
  popup.id = 'slides-latex-popup';
  popup.style.cssText = `position:fixed;z-index:10001;left:${screenX}px;top:${screenY}px;background:var(--bg-card);border:1px solid var(--border-card);border-radius:8px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);min-width:280px;`;
  popup.innerHTML = `
    <div class="flex items-center gap-2 mb-2">
      <span class="text-[0.7rem] text-dimmer uppercase tracking-wide">LaTeX</span>
      <span class="text-[0.65rem] text-dimmest ml-auto">Enter to insert · Esc to cancel</span>
    </div>
    <input id="slides-latex-input" type="text" class="w-full bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-[0.85rem] font-mono outline-none focus:border-accent" spellcheck="false" placeholder="e.g. E = mc^2" value="${existingObj ? escapeHtml(existingObj._latexSrc) : ''}">
    <div id="slides-latex-preview" class="mt-2 text-center min-h-[32px] text-primary"></div>
    <div id="slides-latex-error" class="text-red-400 text-[0.7rem] mt-1" style="display:none"></div>
  `;
  document.body.appendChild(popup);

  // Keep popup within viewport
  requestAnimationFrame(() => {
    const pr = popup.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) popup.style.left = (window.innerWidth - pr.width - 8) + 'px';
    if (pr.bottom > window.innerHeight - 8) popup.style.top = (window.innerHeight - pr.height - 8) + 'px';
  });

  const input = document.getElementById('slides-latex-input');
  input.focus();
  if (existingObj) input.select();

  // Live preview
  const updatePreview = () => {
    const val = input.value.trim();
    const preview = document.getElementById('slides-latex-preview');
    const error = document.getElementById('slides-latex-error');
    if (!val) { preview.innerHTML = ''; error.style.display = 'none'; return; }
    try {
      preview.innerHTML = katex.renderToString(val, { throwOnError: true, displayMode: true, macros: KATEX_MACROS });
      error.style.display = 'none';
    } catch (e) {
      error.textContent = e.message.replace(/^KaTeX parse error:\s*/i, '');
      error.style.display = '';
    }
  };
  input.addEventListener('input', updatePreview);
  updatePreview();

  const closePopup = () => { popup.remove(); document.removeEventListener('keydown', keyHandler); };

  const keyHandler = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closePopup(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) { closePopup(); return; }
      try {
        katex.renderToString(val, { throwOnError: true, macros: KATEX_MACROS });
      } catch { return; }
      _slidesInsertLatex(val, x, y, existingObj);
      closePopup();
    }
  };
  document.addEventListener('keydown', keyHandler, true);

  // Close on click outside
  setTimeout(() => {
    const outside = (e) => {
      if (!popup.contains(e.target)) { closePopup(); document.removeEventListener('mousedown', outside); }
    };
    document.addEventListener('mousedown', outside);
  }, 0);
}

async function _slidesInsertLatex(latex, x, y, existingObj) {
  if (!_slidesCanvas) return;
  const colors = _getSlidesColors();
  const fillColor = colors.fill || '#ffffff';

  // Wait for MathJax to be ready
  if (typeof MathJax === 'undefined' || !MathJax.tex2svgPromise) return;

  try {
    const wrapper = await MathJax.tex2svgPromise(latex, { display: true });
    const svgEl = wrapper.querySelector('svg');
    if (!svgEl) return;

    // Color the SVG paths
    svgEl.style.color = fillColor;
    svgEl.querySelectorAll('path, rect, line').forEach(el => {
      if (el.getAttribute('fill') && el.getAttribute('fill') !== 'none') el.setAttribute('fill', fillColor);
      if (el.getAttribute('stroke') && el.getAttribute('stroke') !== 'none') el.setAttribute('stroke', fillColor);
    });
    // Also set fill on the top-level g elements
    svgEl.querySelectorAll('g[fill]').forEach(el => el.setAttribute('fill', fillColor));
    if (!svgEl.getAttribute('fill') || svgEl.getAttribute('fill') === 'currentColor') {
      svgEl.setAttribute('fill', fillColor);
    }

    // Set explicit width/height from the viewBox or ex-based dimensions
    const vb = svgEl.getAttribute('viewBox');
    if (vb) {
      const parts = vb.split(/\s+/);
      const vbW = parseFloat(parts[2]) || 100;
      const vbH = parseFloat(parts[3]) || 40;
      // MathJax viewBox is in milliems; scale to reasonable pixel size for slides
      const scaleFactor = 0.075;
      svgEl.setAttribute('width', vbW * scaleFactor);
      svgEl.setAttribute('height', vbH * scaleFactor);
    }

    // Add xmlns if missing
    if (!svgEl.getAttribute('xmlns')) svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const svgStr = svgEl.outerHTML;

    // Load SVG directly into fabric.js as vector (no rasterization, no tainted canvas)
    fabric.loadSVGFromString(svgStr, (objects, options) => {
      if (!objects || !objects.length) return;
      const group = fabric.util.groupSVGElements(objects, options);
      group.set({ left: x, top: y, _latexSrc: latex });

      if (existingObj) {
        const idx = _slidesCanvas.getObjects().indexOf(existingObj);
        _slidesCanvas.remove(existingObj);
        group.set({ left: existingObj.left, top: existingObj.top, scaleX: existingObj.scaleX, scaleY: existingObj.scaleY });
        _slidesCanvas.insertAt(group, idx);
      } else {
        _slidesCanvas.add(group);
      }
      _slidesCanvas.setActiveObject(group);
      _slidesCanvas.renderAll();

      // Clean up MathJax output cache
      MathJax.startup.document.clear();
      MathJax.startup.document.updateDocument();
    });
  } catch (e) {
    console.warn('LaTeX render failed:', e);
  }
}

// ── Share & Export Menu ──

function _toggleSlidesShareMenu(btn) {
  const existing = document.getElementById('slides-share-menu');
  if (existing) { existing.remove(); return; }

  const dd = document.createElement('div');
  dd.id = 'slides-share-menu';
  dd.style.cssText = 'position:fixed;z-index:10001;background:var(--bg-card);border:1px solid var(--border-card);border-radius:8px;padding:6px 0;min-width:200px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:12px';
  document.body.appendChild(dd);
  const rect = btn.getBoundingClientRect();
  dd.style.top = (rect.bottom + 4) + 'px';
  dd.style.right = (window.innerWidth - rect.right) + 'px';

  const close = (e) => { if (!dd.contains(e.target) && e.target !== btn) { dd.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);

  dd.innerHTML = `
    <div style="padding:4px 12px 6px;color:var(--text-dimmer);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Export</div>
    <div class="hover:bg-hover" style="padding:6px 12px;cursor:pointer;color:var(--text-primary);display:flex;align-items:center;gap:8px" onclick="_slidesExportPDF(); document.getElementById('slides-share-menu')?.remove()">
      <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Download PDF</span>
    </div>
    <div class="hover:bg-hover" style="padding:6px 12px;cursor:pointer;color:var(--text-primary);display:flex;align-items:center;gap:8px" onclick="_slidesExportCurrentPNG(); document.getElementById('slides-share-menu')?.remove()">
      <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Download slide as PNG</span>
    </div>
    <div class="hover:bg-hover" style="padding:6px 12px;cursor:pointer;color:var(--text-primary);display:flex;align-items:center;gap:8px" onclick="_slidesCopyLink(); document.getElementById('slides-share-menu')?.remove()">
      <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-4.122a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.374" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Copy link</span>
    </div>
    <div style="margin:4px 12px;border-top:1px solid var(--border-dim)"></div>
    <div style="padding:4px 12px 6px;color:var(--text-dimmer);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Share to team</div>
    <div id="slides-share-teams" style="padding:2px 0">
      <div style="padding:6px 12px;color:var(--text-dimmer);font-size:11px">Loading...</div>
    </div>
  `;

  // Load teams
  _loadSlidesShareTeams();
}

async function _loadSlidesShareTeams() {
  const container = document.getElementById('slides-share-teams');
  if (!container) return;
  if (typeof _cachedTeams !== 'undefined' && !_cachedTeams.length && typeof fetchTeams === 'function') await fetchTeams();
  const teams = typeof _cachedTeams !== 'undefined' ? _cachedTeams : [];
  if (!teams.length) {
    container.innerHTML = '<div style="padding:6px 12px;color:var(--text-dimmer);font-size:11px">No teams yet</div>';
    return;
  }
  container.innerHTML = teams.map(t => `
    <div class="hover:bg-hover" style="padding:6px 12px;cursor:pointer;color:var(--text-primary);display:flex;align-items:center;gap:8px" onclick="shareFileToTeam(${t.id}, this)">
      <div style="width:24px;height:24px;border-radius:6px;background:color-mix(in srgb, var(--accent) 20%, transparent);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${escapeHtml(t.name[0].toUpperCase())}</div>
      <span>${escapeHtml(t.name)}</span>
    </div>
  `).join('');
}

function _slidesExportCurrentPNG() {
  if (!_slidesCanvas) return;
  const dataUrl = _slidesCanvas.toDataURL({ format: 'png', multiplier: 2 });
  const link = document.createElement('a');
  link.download = _slidesFname.replace('.slides', '') + '_slide' + (_slidesCurrentIdx + 1) + '.png';
  link.href = dataUrl;
  link.click();
}

function _slidesCopyLink() {
  if (!currentExpId || !_slidesFname) return;
  const url = `${window.location.origin}/#experiment/${encodeURIComponent(currentExpId)}?file=${encodeURIComponent(_slidesFname)}`;
  navigator.clipboard.writeText(url).then(() => {
    Motion.toast('Link copied to clipboard', { position: 'bottom', duration: 2000 });
  });
}

// ── Present Mode ──

function _slidesPresentMode() {
  if (!_slidesData || !_slidesCanvas) return;
  _slidesSaveCurrentCanvas();
  _slidesPresentIdx = _slidesCurrentIdx;

  const overlay = document.createElement('div');
  overlay.id = 'slides-present-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000;display:flex;align-items:center;justify-content:center;flex-direction:column';

  const canvasEl = document.createElement('canvas');
  canvasEl.id = 'slides-present-canvas';
  overlay.appendChild(canvasEl);

  // Slide indicator
  const indicator = document.createElement('div');
  indicator.id = 'slides-present-indicator';
  indicator.className = 'slides-present-indicator';
  overlay.appendChild(indicator);

  document.body.appendChild(overlay);
  _slidesPresentOverlay = overlay;

  // Calculate dimensions
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  let cw, ch;
  if (screenW / screenH > 16 / 9) {
    ch = screenH;
    cw = Math.floor(ch * 16 / 9);
  } else {
    cw = screenW;
    ch = Math.floor(cw * 9 / 16);
  }

  _slidesPresentCanvas = new fabric.StaticCanvas('slides-present-canvas', {
    width: cw,
    height: ch,
    backgroundColor: '#1a1a2e',
  });

  _slidesPresentRenderSlide();

  _slidesPresentKeyHandler = function(e) {
    if (e.key === 'Escape') { _slidesExitPresent(); return; }
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      _slidesPresentNext();
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      _slidesPresentPrev();
    }
  };
  document.addEventListener('keydown', _slidesPresentKeyHandler);
}

function _slidesPresentRenderSlide() {
  if (!_slidesPresentCanvas || !_slidesData) return;
  const slide = _slidesData.slides[_slidesPresentIdx];
  if (!slide) return;

  const loadData = {
    objects: slide.objects || [],
    background: slide.background || '#1a1a2e',
  };

  // Scale objects from edit canvas size to present canvas size
  const editW = _slidesCanvas ? _slidesCanvas.width : 960;
  const editH = _slidesCanvas ? _slidesCanvas.height : 540;
  const presW = _slidesPresentCanvas.width;
  const presH = _slidesPresentCanvas.height;
  const scale = Math.min(presW / editW, presH / editH);

  _slidesPresentCanvas.loadFromJSON(loadData, () => {
    if (scale !== 1) {
      _slidesPresentCanvas.setZoom(scale);
    }
    _slidesPresentCanvas.renderAll();
  });

  const indicator = document.getElementById('slides-present-indicator');
  if (indicator) indicator.textContent = `${_slidesPresentIdx + 1} / ${_slidesData.slides.length}`;
}

function _slidesPresentNext() {
  if (_slidesPresentIdx < _slidesData.slides.length - 1) {
    _slidesPresentIdx++;
    _slidesPresentRenderSlide();
  }
}

function _slidesPresentPrev() {
  if (_slidesPresentIdx > 0) {
    _slidesPresentIdx--;
    _slidesPresentRenderSlide();
  }
}

function _slidesExitPresent() {
  if (_slidesPresentKeyHandler) {
    document.removeEventListener('keydown', _slidesPresentKeyHandler);
    _slidesPresentKeyHandler = null;
  }
  if (_slidesPresentCanvas) {
    _slidesPresentCanvas.dispose();
    _slidesPresentCanvas = null;
  }
  if (_slidesPresentOverlay) {
    _slidesPresentOverlay.remove();
    _slidesPresentOverlay = null;
  }
}
