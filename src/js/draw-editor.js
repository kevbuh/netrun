/* ── Drawing Editor (.draw) — Fabric.js canvas editor ── */

var _drawCanvas = null;
var _drawUndoStack = [];
var _drawRedoStack = [];
var _drawSaving = false;
var _drawCurrentTool = 'select';
var _drawFname = '';
var _drawKeyHandler = null;
var _drawPasteHandler = null;
var _drawResizeHandler = null;
var _drawIsDrawingShape = false;
var _drawShapeOrigin = null;
var _drawTempShape = null;

function _cleanupDrawEditor() {
  if (_drawCanvas) {
    _drawCanvas.dispose();
    _drawCanvas = null;
  }
  if (_drawKeyHandler) {
    document.removeEventListener('keydown', _drawKeyHandler);
    _drawKeyHandler = null;
  }
  if (_drawPasteHandler) {
    document.removeEventListener('paste', _drawPasteHandler);
    _drawPasteHandler = null;
  }
  if (_drawResizeHandler) {
    window.removeEventListener('resize', _drawResizeHandler);
    _drawResizeHandler = null;
  }
  _drawUndoStack = [];
  _drawRedoStack = [];
  _drawIsDrawingShape = false;
  _drawShapeOrigin = null;
  _drawTempShape = null;
}

function renderDrawEditor(fname, content) {
  _cleanupDrawEditor();
  _drawFname = fname;

  let data;
  try { data = JSON.parse(content || '{}'); } catch { data = { version: 1, objects: [] }; }

  const editor = document.getElementById('exp-file-editor');
  editor.innerHTML = '';
  editor.style.display = 'flex';
  editor.style.flexDirection = 'column';
  editor.style.height = '100%';

  // Top bar with filename and actions
  const topBar = document.createElement('div');
  topBar.className = 'flex items-center justify-between px-4 py-2 border-b border-border-dim bg-card/50';
  topBar.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-[0.7rem] px-1.5 py-0.5 rounded font-medium bg-violet-500/20 text-violet-400">drw</span>
      <span id="draw-fname" class="text-[0.85rem] text-primary font-medium cursor-pointer hover:text-accent transition-colors" onclick="startRenameFileInViewer('${escapeHtml(fname)}')" title="Click to rename">${escapeHtml(fname)}</span>
    </div>
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <label class="text-[0.75rem] text-dimmer">Fill</label>
        <input type="color" id="draw-fill" value="#b4451a" class="w-6 h-6 border border-border-input rounded cursor-pointer bg-transparent p-0">
        <label class="text-[0.75rem] text-dimmer">Stroke</label>
        <input type="color" id="draw-stroke" value="#e0e0e0" class="w-6 h-6 border border-border-input rounded cursor-pointer bg-transparent p-0">
        <label class="text-[0.75rem] text-dimmer">Width</label>
        <input type="range" id="draw-stroke-width" min="1" max="20" value="2" class="w-16" style="accent-color:var(--nr-accent)">
      </div>
      ${fileShareButton()}
      <button class="draw-tool" onclick="_drawExportPNG()" title="Export PNG">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
    </div>`;
  editor.appendChild(topBar);

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'draw-toolbar';
  toolbar.innerHTML = `
    <button class="draw-tool active" data-tool="select" onclick="_setDrawTool('select')" title="Select (V)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>
    </button>
    <button class="draw-tool" data-tool="rect" onclick="_setDrawTool('rect')" title="Rectangle (R)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
    </button>
    <button class="draw-tool" data-tool="circle" onclick="_setDrawTool('circle')" title="Ellipse (C)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="10" ry="10"/></svg>
    </button>
    <button class="draw-tool" data-tool="line" onclick="_setDrawTool('line')" title="Line (L)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/></svg>
    </button>
    <button class="draw-tool" data-tool="arrow" onclick="_setDrawTool('arrow')" title="Arrow (A)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="10 5 19 5 19 14"/></svg>
    </button>
    <button class="draw-tool" data-tool="pen" onclick="_setDrawTool('pen')" title="Pen (P)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>
    </button>
    <button class="draw-tool" data-tool="text" onclick="_setDrawTool('text')" title="Text (T)">
      <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>
    </button>
    <button class="draw-tool" data-tool="image" onclick="_drawPickImage()" title="Image (I)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
    </button>
    <span class="draw-sep"></span>
    <button class="draw-tool" onclick="_drawDeleteSelected()" title="Delete (Del)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
    </button>
    <button class="draw-tool" onclick="_drawUndo()" title="Undo (Ctrl+Z)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 10h10a5 5 0 015 5v0a5 5 0 01-5 5H3"/><polyline points="8 15 3 10 8 5"/></svg>
    </button>
    <button class="draw-tool" onclick="_drawRedo()" title="Redo (Ctrl+Shift+Z)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 10H11a5 5 0 00-5 5v0a5 5 0 005 5h10"/><polyline points="16 15 21 10 16 5"/></svg>
    </button>
    <span class="draw-sep"></span>
    <button class="draw-tool" onclick="_drawBringToFront()" title="Bring to Front">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="8" y="2" width="14" height="14" rx="1"/><rect x="2" y="8" width="14" height="14" rx="1" opacity="0.4"/></svg>
    </button>
    <button class="draw-tool" onclick="_drawSendToBack()" title="Send to Back">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="14" height="14" rx="1"/><rect x="8" y="2" width="14" height="14" rx="1" opacity="0.4"/></svg>
    </button>`;
  editor.appendChild(toolbar);

  // Canvas container
  const canvasWrap = document.createElement('div');
  canvasWrap.id = 'draw-canvas-wrap';
  canvasWrap.style.cssText = 'flex:1;overflow:hidden;position:relative;background:var(--nr-bg-sunken)';
  canvasWrap.innerHTML = '<canvas id="draw-canvas"></canvas>';
  editor.appendChild(canvasWrap);

  requestAnimationFrame(() => _initDrawCanvas(data));
}

function _initDrawCanvas(data, _retries) {
  const wrap = document.getElementById('draw-canvas-wrap');
  if (!wrap) return;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;

  // Retry if layout hasn't computed yet (height is 0)
  if (h < 10 && (_retries || 0) < 10) {
    setTimeout(() => _initDrawCanvas(data, (_retries || 0) + 1), 50);
    return;
  }

  _drawCanvas = new fabric.Canvas('draw-canvas', {
    width: w,
    height: h,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() || '#0d0d0d',
    selection: true,
    preserveObjectStacking: true,
  });

  // Load existing objects
  if (data.objects && data.objects.length > 0) {
    _drawCanvas.loadFromJSON({ objects: data.objects, background: _drawCanvas.backgroundColor }, () => {
      _drawCanvas.renderAll();
      _drawPushUndo();
    });
  } else {
    _drawPushUndo();
  }

  // Update selected objects when color/stroke inputs change
  document.getElementById('draw-fill').addEventListener('input', _drawApplyColorsToSelection);
  document.getElementById('draw-stroke').addEventListener('input', _drawApplyColorsToSelection);
  document.getElementById('draw-stroke-width').addEventListener('input', _drawApplyColorsToSelection);

  // Sync color inputs when an object is selected
  _drawCanvas.on('selection:created', _drawSyncColorInputs);
  _drawCanvas.on('selection:updated', _drawSyncColorInputs);

  // Wire auto-save events
  _drawCanvas.on('object:modified', _drawOnChange);
  _drawCanvas.on('object:added', _drawOnChange);
  _drawCanvas.on('object:removed', _drawOnChange);

  // Shape drawing via mouse events
  _drawCanvas.on('mouse:down', _drawMouseDown);
  _drawCanvas.on('mouse:move', _drawMouseMove);
  _drawCanvas.on('mouse:up', _drawMouseUp);

  // Keyboard shortcuts
  _drawKeyHandler = function(e) {
    // Don't capture when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    // Don't capture if editing text on canvas
    if (_drawCanvas && _drawCanvas.getActiveObject() && _drawCanvas.getActiveObject().isEditing) return;

    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); _drawUndo(); }
      else if (key === 'z' && e.shiftKey) { e.preventDefault(); _drawRedo(); }
      return;
    }
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); _drawDeleteSelected(); }
    else if (key === 'v') _setDrawTool('select');
    else if (key === 'r') _setDrawTool('rect');
    else if (key === 'c') _setDrawTool('circle');
    else if (key === 'l') _setDrawTool('line');
    else if (key === 'a') _setDrawTool('arrow');
    else if (key === 'p') _setDrawTool('pen');
    else if (key === 't') _setDrawTool('text');
    else if (key === 'i') _drawPickImage();
    else if (key === 'arrowleft') { e.preventDefault(); _drawNudge(-1 * (e.shiftKey ? 10 : 1), 0); }
    else if (key === 'arrowright') { e.preventDefault(); _drawNudge(1 * (e.shiftKey ? 10 : 1), 0); }
    else if (key === 'arrowup') { e.preventDefault(); _drawNudge(0, -1 * (e.shiftKey ? 10 : 1)); }
    else if (key === 'arrowdown') { e.preventDefault(); _drawNudge(0, 1 * (e.shiftKey ? 10 : 1)); }
  };
  document.addEventListener('keydown', _drawKeyHandler);

  // Paste handler for images
  _drawPasteHandler = function(e) {
    if (!_drawCanvas) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        const reader = new FileReader();
        reader.onload = function(ev) {
          fabric.Image.fromURL(ev.target.result, function(img) {
            // Scale down if too large
            const maxDim = Math.min(_drawCanvas.width, _drawCanvas.height) * 0.6;
            if (img.width > maxDim || img.height > maxDim) {
              const scale = maxDim / Math.max(img.width, img.height);
              img.scale(scale);
            }
            img.set({ left: 50, top: 50 });
            _drawCanvas.add(img);
            _drawCanvas.setActiveObject(img);
            _drawCanvas.renderAll();
          });
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  };
  document.addEventListener('paste', _drawPasteHandler);

  // Resize handler
  _drawResizeHandler = function() {
    if (!_drawCanvas) return;
    const wrap = document.getElementById('draw-canvas-wrap');
    if (!wrap) return;
    _drawCanvas.setWidth(wrap.clientWidth);
    _drawCanvas.setHeight(wrap.clientHeight);
    _drawCanvas.renderAll();
  };
  window.addEventListener('resize', _drawResizeHandler);
}

function _getDrawColors() {
  const fill = document.getElementById('draw-fill');
  const stroke = document.getElementById('draw-stroke');
  const sw = document.getElementById('draw-stroke-width');
  return {
    fill: fill ? fill.value : '#b4451a',
    stroke: stroke ? stroke.value : '#e0e0e0',
    strokeWidth: sw ? parseInt(sw.value) : 2,
  };
}

function _setDrawTool(tool) {
  _drawCurrentTool = tool;
  if (!_drawCanvas) return;

  // Update button states
  document.querySelectorAll('.draw-toolbar .draw-tool[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  // Reset canvas mode
  _drawCanvas.isDrawingMode = false;
  _drawCanvas.selection = tool === 'select';
  _drawCanvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';

  if (tool === 'select') {
    _drawCanvas.forEachObject(o => { o.selectable = true; o.evented = true; });
  } else {
    _drawCanvas.discardActiveObject();
    _drawCanvas.renderAll();
    if (tool !== 'pen') {
      _drawCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
    }
  }

  if (tool === 'pen') {
    const colors = _getDrawColors();
    _drawCanvas.isDrawingMode = true;
    _drawCanvas.freeDrawingBrush.color = colors.stroke;
    _drawCanvas.freeDrawingBrush.width = colors.strokeWidth;
    _drawCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
  }
}

function _drawMouseDown(opt) {
  if (!_drawCanvas) return;
  const tool = _drawCurrentTool;
  if (tool === 'select' || tool === 'pen') return;

  if (tool === 'text') {
    const pointer = _drawCanvas.getPointer(opt.e);
    const colors = _getDrawColors();
    const text = new fabric.IText('Text', {
      left: pointer.x,
      top: pointer.y,
      fontSize: 20,
      fill: colors.fill,
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    });
    _drawCanvas.add(text);
    _drawCanvas.setActiveObject(text);
    text.enterEditing();
    _setDrawTool('select');
    return;
  }

  if (tool === 'image') return;

  const pointer = _drawCanvas.getPointer(opt.e);
  _drawIsDrawingShape = true;
  _drawShapeOrigin = { x: pointer.x, y: pointer.y };
  const colors = _getDrawColors();

  if (tool === 'rect') {
    _drawTempShape = new fabric.Rect({
      left: pointer.x, top: pointer.y, width: 0, height: 0,
      fill: colors.fill, stroke: colors.stroke, strokeWidth: colors.strokeWidth,
      originX: 'left', originY: 'top',
    });
  } else if (tool === 'circle') {
    _drawTempShape = new fabric.Ellipse({
      left: pointer.x, top: pointer.y, rx: 0, ry: 0,
      fill: colors.fill, stroke: colors.stroke, strokeWidth: colors.strokeWidth,
      originX: 'left', originY: 'top',
    });
  } else if (tool === 'line' || tool === 'arrow') {
    _drawTempShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
      stroke: colors.stroke, strokeWidth: colors.strokeWidth,
      selectable: false,
    });
  }

  if (_drawTempShape) {
    _drawCanvas.add(_drawTempShape);
    _drawCanvas.renderAll();
  }
}

function _drawMouseMove(opt) {
  if (!_drawIsDrawingShape || !_drawTempShape || !_drawCanvas) return;
  const pointer = _drawCanvas.getPointer(opt.e);
  const ox = _drawShapeOrigin.x;
  const oy = _drawShapeOrigin.y;
  const tool = _drawCurrentTool;

  if (tool === 'rect') {
    const left = Math.min(ox, pointer.x);
    const top = Math.min(oy, pointer.y);
    _drawTempShape.set({
      left: left, top: top,
      width: Math.abs(pointer.x - ox),
      height: Math.abs(pointer.y - oy),
    });
  } else if (tool === 'circle') {
    const left = Math.min(ox, pointer.x);
    const top = Math.min(oy, pointer.y);
    _drawTempShape.set({
      left: left, top: top,
      rx: Math.abs(pointer.x - ox) / 2,
      ry: Math.abs(pointer.y - oy) / 2,
    });
  } else if (tool === 'line' || tool === 'arrow') {
    _drawTempShape.set({ x2: pointer.x, y2: pointer.y });
  }

  _drawCanvas.renderAll();
}

function _drawMouseUp(opt) {
  if (!_drawIsDrawingShape || !_drawCanvas) return;
  _drawIsDrawingShape = false;

  if (_drawTempShape) {
    // If shape is too small, remove it
    const tool = _drawCurrentTool;
    let tooSmall = false;
    if (tool === 'rect') tooSmall = _drawTempShape.width < 3 && _drawTempShape.height < 3;
    else if (tool === 'circle') tooSmall = _drawTempShape.rx < 3 && _drawTempShape.ry < 3;
    else if (tool === 'line' || tool === 'arrow') {
      const dx = _drawTempShape.x2 - _drawTempShape.x1;
      const dy = _drawTempShape.y2 - _drawTempShape.y1;
      tooSmall = Math.sqrt(dx*dx + dy*dy) < 3;
    }

    if (tooSmall) {
      _drawCanvas.remove(_drawTempShape);
    } else if (_drawCurrentTool === 'arrow') {
      // Replace line with arrow group
      const line = _drawTempShape;
      const x1 = line.x1, y1 = line.y1, x2 = line.x2, y2 = line.y2;
      _drawCanvas.remove(line);
      _drawAddArrow(x1, y1, x2, y2);
    } else {
      _drawTempShape.setCoords();
    }

    _drawTempShape = null;
    _drawShapeOrigin = null;
    _drawCanvas.renderAll();
  }
}

function _drawAddArrow(x1, y1, x2, y2) {
  const colors = _getDrawColors();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 15;

  const line = new fabric.Line([x1, y1, x2, y2], {
    stroke: colors.stroke,
    strokeWidth: colors.strokeWidth,
  });

  const head = new fabric.Triangle({
    left: x2,
    top: y2,
    originX: 'center',
    originY: 'center',
    width: headLen,
    height: headLen,
    fill: colors.stroke,
    angle: (angle * 180 / Math.PI) + 90,
  });

  const group = new fabric.Group([line, head], { selectable: true });
  _drawCanvas.add(group);
  _drawCanvas.renderAll();
}

function _drawOnChange() {
  _drawPushUndo();
  _drawSave();
}

var _drawSaveTimer = null;
function _drawSave() {
  if (_drawSaveTimer) clearTimeout(_drawSaveTimer);
  _drawSaveTimer = setTimeout(() => {
    if (!_drawCanvas || _drawSaving) return;
    _drawSaving = true;
    const json = _drawCanvas.toJSON();
    const data = JSON.stringify({ version: 1, objects: json.objects });
    apiPut(`/api/experiments/${currentExpId}/files/${encodeURIComponent(_drawFname)}`, { content: data })
      .finally(() => { _drawSaving = false; });
  }, 600);
}

function _drawPushUndo() {
  if (!_drawCanvas) return;
  const state = JSON.stringify(_drawCanvas.toJSON());
  // Don't push if identical to last
  if (_drawUndoStack.length > 0 && _drawUndoStack[_drawUndoStack.length - 1] === state) return;
  _drawUndoStack.push(state);
  if (_drawUndoStack.length > 50) _drawUndoStack.shift();
  _drawRedoStack = [];
}

function _drawUndo() {
  if (!_drawCanvas || _drawUndoStack.length <= 1) return;
  const current = _drawUndoStack.pop();
  _drawRedoStack.push(current);
  const prev = _drawUndoStack[_drawUndoStack.length - 1];
  _drawLoadState(prev);
}

function _drawRedo() {
  if (!_drawCanvas || _drawRedoStack.length === 0) return;
  const state = _drawRedoStack.pop();
  _drawUndoStack.push(state);
  _drawLoadState(state);
}

function _drawLoadState(stateStr) {
  if (!_drawCanvas) return;
  // Temporarily remove change listeners to avoid re-triggering
  _drawCanvas.off('object:modified', _drawOnChange);
  _drawCanvas.off('object:added', _drawOnChange);
  _drawCanvas.off('object:removed', _drawOnChange);

  _drawCanvas.loadFromJSON(stateStr, () => {
    _drawCanvas.renderAll();
    _drawCanvas.on('object:modified', _drawOnChange);
    _drawCanvas.on('object:added', _drawOnChange);
    _drawCanvas.on('object:removed', _drawOnChange);
    _drawSave();
  });
}

function _drawDeleteSelected() {
  if (!_drawCanvas) return;
  const active = _drawCanvas.getActiveObjects();
  if (active.length === 0) return;
  active.forEach(o => _drawCanvas.remove(o));
  _drawCanvas.discardActiveObject();
  _drawCanvas.renderAll();
}

function _drawBringToFront() {
  if (!_drawCanvas) return;
  const obj = _drawCanvas.getActiveObject();
  if (obj) { _drawCanvas.bringToFront(obj); _drawCanvas.renderAll(); }
}

function _drawSendToBack() {
  if (!_drawCanvas) return;
  const obj = _drawCanvas.getActiveObject();
  if (obj) { _drawCanvas.sendToBack(obj); _drawCanvas.renderAll(); }
}

function _drawNudge(dx, dy) {
  if (!_drawCanvas) return;
  const active = _drawCanvas.getActiveObjects();
  if (active.length === 0) return;
  active.forEach(o => {
    o.set({ left: o.left + dx, top: o.top + dy });
    o.setCoords();
  });
  _drawCanvas.renderAll();
  _drawOnChange();
}

function _drawExportPNG() {
  if (!_drawCanvas) return;
  const dataUrl = _drawCanvas.toDataURL({ format: 'png', multiplier: 2 });
  const link = document.createElement('a');
  link.download = _drawFname.replace('.draw', '.png');
  link.href = dataUrl;
  link.click();
}

function _drawPickImage() {
  if (!_drawCanvas) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      fabric.Image.fromURL(ev.target.result, function(img) {
        const maxDim = Math.min(_drawCanvas.width, _drawCanvas.height) * 0.6;
        if (img.width > maxDim || img.height > maxDim) {
          const scale = maxDim / Math.max(img.width, img.height);
          img.scale(scale);
        }
        img.set({ left: 50, top: 50 });
        _drawCanvas.add(img);
        _drawCanvas.setActiveObject(img);
        _drawCanvas.renderAll();
      });
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function _drawApplyColorsToSelection() {
  if (!_drawCanvas) return;
  const objs = _drawCanvas.getActiveObjects();
  if (objs.length === 0) return;
  const colors = _getDrawColors();
  objs.forEach(o => {
    if (o.type === 'path' || o.type === 'line') {
      o.set({ stroke: colors.stroke, strokeWidth: colors.strokeWidth });
    } else if (o.type === 'i-text' || o.type === 'text' || o.type === 'textbox') {
      o.set({ fill: colors.fill });
    } else {
      o.set({ fill: colors.fill, stroke: colors.stroke, strokeWidth: colors.strokeWidth });
    }
  });
  _drawCanvas.renderAll();
  _drawOnChange();
}

function _drawSyncColorInputs(opt) {
  const obj = opt.selected ? opt.selected[0] : null;
  if (!obj) return;
  const fillEl = document.getElementById('draw-fill');
  const strokeEl = document.getElementById('draw-stroke');
  const swEl = document.getElementById('draw-stroke-width');
  if (obj.fill && typeof obj.fill === 'string' && obj.fill[0] === '#' && fillEl) fillEl.value = obj.fill.slice(0, 7);
  if (obj.stroke && typeof obj.stroke === 'string' && obj.stroke[0] === '#' && strokeEl) strokeEl.value = obj.stroke.slice(0, 7);
  if (obj.strokeWidth && swEl) swEl.value = obj.strokeWidth;
}
