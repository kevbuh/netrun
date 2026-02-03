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

function _initSlidesCanvas() {
  const wrap = document.getElementById('slides-canvas-wrap');
  if (!wrap) return;

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
  const json = _slidesCanvas.toJSON();
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
      _slidesUndoStacks[slide.id] = [JSON.stringify(_slidesCanvas.toJSON())];
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
  const newSlide = {
    id: 'slide-' + Date.now(),
    objects: [],
    background: null,
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
  const state = JSON.stringify(_slidesCanvas.toJSON());
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
    fetch(`/api/experiments/${currentExpId}/files/${encodeURIComponent(_slidesFname)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: data }),
    }).finally(() => { _slidesSaving = false; });
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
    // Brief toast
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--bg-card);border:1px solid var(--border-card);color:var(--text-primary);padding:8px 16px;border-radius:8px;font-size:13px;z-index:10002;box-shadow:0 4px 12px rgba(0,0,0,.3)';
    toast.textContent = 'Link copied to clipboard';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
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
