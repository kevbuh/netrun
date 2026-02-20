// draw-view.js — Whiteboard / drawing canvas as an NTP morph (draw:// protocol)
// Uses fabric.js (loaded globally) for canvas drawing.
import { _browseRenderTabs, _updateIslandNavButtons } from '/js/browse/browse-island.js';
import { _browseSetUrlDisplay } from '/js/browse-urlbar.js';
import { _browseUpdateNewTabPage } from '/js/browse/browse-passwords.js';
import { openBrowse } from '/js/browse/browse-windows.js';

let _drawId = null;
let _drawCanvas = null;       // fabric.Canvas instance
let _drawContainer = null;    // .draw-view-container element
let _drawToolbar = null;      // .draw-toolbar element
let _drawResizeObs = null;    // ResizeObserver
let _drawSaveTimer = null;
let _drawUndoStack = [];
let _drawRedoStack = [];
let _drawUndoLock = false;    // prevents recording undo during undo/redo
let _drawCurrentTool = 'pen';
let _drawColor = '#ffffff';
let _drawStrokeWidth = 3;
let _drawShapeStart = null;   // { x, y } for shape drawing
let _drawActiveShape = null;  // live shape being drawn
let _drawPopover = null;      // active popover element

// ── SVG icons for toolbar ──
const _icons = {
  select: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>',
  pen: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
  line: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/></svg>',
  rect: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  ellipse: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="10" ry="7"/></svg>',
  text: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9.5" y1="20" x2="14.5" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  eraser: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.8 1.4c.8-.8 2-.8 2.8 0l5 5c.8.8.8 2 0 2.8L11 20"/><line x1="18" y1="13" x2="9" y2="4"/></svg>',
  undo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  redo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
};

function _genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ── Public API ──

export function openDrawPage(drawingId) {
  if (typeof openBrowse === 'function') openBrowse();

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) return;

  const container = document.getElementById('browse-content');
  const ntp = container?.querySelector('.browse-ntp');
  if (!ntp) return;

  // If already in draw mode, tear down first
  if (tab._drawPage) {
    _drawViewCleanupMorph();
  }

  const id = drawingId || _genId();

  // Save current state for back navigation
  if (!tab.backStack) tab.backStack = [];
  if (tab.url && !tab.blank) {
    tab.backStack.push(tab.url);
    if (tab.backStack.length > 50) tab.backStack = tab.backStack.slice(-50);
  }
  tab.forwardStack = [];

  // Set tab metadata
  tab.blank = false;
  tab._drawPage = true;
  tab._drawId = id;
  tab.url = 'draw://' + id;
  tab.title = 'Drawing';
  tab.favicon = '';

  _drawId = id;

  // Morph the NTP
  _morphNTP(ntp, id);

  // Update URL bar and tabs
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) _browseSetUrlDisplay(urlInput, tab.url);
  _browseRenderTabs();
  _updateIslandNavButtons();
}

export function drawViewCleanupMorph() {
  _drawViewCleanupMorph();
}

export function drawViewUnmorph() {
  _drawViewCleanupMorph();

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab) {
    if (tab.backStack && tab.backStack.length) tab.backStack.pop();
    tab.blank = true;
    tab.url = '';
    tab.title = 'New Tab';
    tab.favicon = '';
    delete tab._drawPage;
    delete tab._drawId;
    _browseRenderTabs();
    const urlInput = document.getElementById('browse-url-input');
    if (urlInput) _browseSetUrlDisplay(urlInput, '');
    _browseUpdateNewTabPage(tab);
  }

  if (typeof _updateIslandNavButtons === 'function') _updateIslandNavButtons();
}

// ── Internal: morph NTP into canvas ──

async function _morphNTP(ntp, drawingId) {
  ntp.classList.add('draw-mode');

  // Create container + canvas element
  _drawContainer = document.createElement('div');
  _drawContainer.className = 'draw-view-container';

  const canvasEl = document.createElement('canvas');
  canvasEl.id = 'draw-canvas-' + drawingId;
  _drawContainer.appendChild(canvasEl);

  ntp.appendChild(_drawContainer);

  // Init fabric canvas
  _drawCanvas = new fabric.Canvas(canvasEl, {
    isDrawingMode: true,
    backgroundColor: 'transparent',
    selection: true,
    preserveObjectStacking: true,
  });

  // Set brush
  _applyBrush();

  // Size canvas to container
  _resizeCanvas();
  _drawResizeObs = new ResizeObserver(_resizeCanvas);
  _drawResizeObs.observe(_drawContainer);

  // Build toolbar
  _buildToolbar();
  _drawContainer.appendChild(_drawToolbar);

  // Load existing drawing
  try {
    const existing = await electronAPI.dbQuery('draw-get', drawingId);
    if (existing && existing.canvas_json && existing.canvas_json !== '{}') {
      const json = JSON.parse(existing.canvas_json);
      _drawUndoLock = true;
      _drawCanvas.loadFromJSON(json, () => {
        _drawCanvas.renderAll();
        _drawUndoLock = false;
        _pushUndoState();
      });
      if (existing.title && existing.title !== 'Untitled') {
        const tab = _browseTabs.find(t => t.id === _browseActiveTab);
        if (tab) tab.title = existing.title;
        _browseRenderTabs();
      }
    } else {
      // Create the drawing record
      await electronAPI.dbQuery('draw-create', drawingId);
      _pushUndoState();
    }
  } catch {
    _pushUndoState();
  }

  // Bind canvas events for auto-save + undo
  _drawCanvas.on('object:modified', _onCanvasChange);
  _drawCanvas.on('object:added', _onCanvasChange);
  _drawCanvas.on('object:removed', _onCanvasChange);
  _drawCanvas.on('path:created', _onCanvasChange);

  // Keyboard shortcuts
  document.addEventListener('keydown', _drawKeydown);
}

function _resizeCanvas() {
  if (!_drawCanvas || !_drawContainer) return;
  const w = _drawContainer.clientWidth;
  const h = _drawContainer.clientHeight;
  _drawCanvas.setWidth(w);
  _drawCanvas.setHeight(h);
  _drawCanvas.renderAll();
}

// ── Cleanup morph DOM ──

function _drawViewCleanupMorph() {
  // Dismiss any popover
  _dismissPopover();

  // Save before cleanup
  _saveNow();

  document.removeEventListener('keydown', _drawKeydown);

  if (_drawResizeObs) {
    _drawResizeObs.disconnect();
    _drawResizeObs = null;
  }

  if (_drawSaveTimer) {
    clearTimeout(_drawSaveTimer);
    _drawSaveTimer = null;
  }

  if (_drawCanvas) {
    _drawCanvas.off();
    _drawCanvas.dispose();
    _drawCanvas = null;
  }

  if (_drawContainer) {
    _drawContainer.remove();
    _drawContainer = null;
  }
  _drawToolbar = null;

  const container = document.getElementById('browse-content');
  const ntp = container?.querySelector('.browse-ntp');
  if (ntp) ntp.classList.remove('draw-mode');

  _drawId = null;
  _drawUndoStack = [];
  _drawRedoStack = [];
  _drawShapeStart = null;
  _drawActiveShape = null;
}

// ── Canvas changes: undo + auto-save ──

function _onCanvasChange() {
  if (_drawUndoLock) return;
  _pushUndoState();
  _debounceSave();
}

function _pushUndoState() {
  const json = JSON.stringify(_drawCanvas.toJSON());
  _drawUndoStack.push(json);
  if (_drawUndoStack.length > 100) _drawUndoStack.shift();
  _drawRedoStack = [];
}

function _undo() {
  if (_drawUndoStack.length <= 1) return;
  _drawRedoStack.push(_drawUndoStack.pop());
  const prev = _drawUndoStack[_drawUndoStack.length - 1];
  _drawUndoLock = true;
  _drawCanvas.loadFromJSON(JSON.parse(prev), () => {
    _drawCanvas.renderAll();
    _drawUndoLock = false;
    _applyBrush(); // restore brush after loadFromJSON
    _debounceSave();
  });
}

function _redo() {
  if (!_drawRedoStack.length) return;
  const next = _drawRedoStack.pop();
  _drawUndoStack.push(next);
  _drawUndoLock = true;
  _drawCanvas.loadFromJSON(JSON.parse(next), () => {
    _drawCanvas.renderAll();
    _drawUndoLock = false;
    _applyBrush();
    _debounceSave();
  });
}

// ── Auto-save (debounced) ──

function _debounceSave() {
  if (_drawSaveTimer) clearTimeout(_drawSaveTimer);
  _drawSaveTimer = setTimeout(_saveNow, 1000);
}

function _saveNow() {
  if (!_drawCanvas || !_drawId) return;
  const json = JSON.stringify(_drawCanvas.toJSON());
  electronAPI.dbQuery('draw-save', _drawId, json).catch(() => {});
}

// ── Tool management ──

function _setTool(tool) {
  _drawCurrentTool = tool;
  if (!_drawCanvas) return;

  // Unbind shape drawing handlers
  _drawCanvas.off('mouse:down', _shapeMouseDown);
  _drawCanvas.off('mouse:move', _shapeMouseMove);
  _drawCanvas.off('mouse:up', _shapeMouseUp);
  _drawShapeStart = null;
  _drawActiveShape = null;

  if (tool === 'select') {
    _drawCanvas.isDrawingMode = false;
    _drawCanvas.selection = true;
    _drawCanvas.defaultCursor = 'default';
  } else if (tool === 'pen') {
    _drawCanvas.isDrawingMode = true;
    _drawCanvas.selection = false;
    _applyBrush();
  } else if (tool === 'eraser') {
    _drawCanvas.isDrawingMode = true;
    _drawCanvas.selection = false;
    // Eraser = white brush (since background is dark)
    _drawCanvas.freeDrawingBrush = new fabric.PencilBrush(_drawCanvas);
    _drawCanvas.freeDrawingBrush.color = 'rgba(0,0,0,1)';
    _drawCanvas.freeDrawingBrush.width = _drawStrokeWidth * 4;
  } else if (tool === 'text') {
    _drawCanvas.isDrawingMode = false;
    _drawCanvas.selection = false;
    _drawCanvas.defaultCursor = 'text';
    _drawCanvas.on('mouse:down', _textMouseDown);
  } else {
    // Shape tools: line, rect, ellipse
    _drawCanvas.isDrawingMode = false;
    _drawCanvas.selection = false;
    _drawCanvas.defaultCursor = 'crosshair';
    _drawCanvas.on('mouse:down', _shapeMouseDown);
    _drawCanvas.on('mouse:move', _shapeMouseMove);
    _drawCanvas.on('mouse:up', _shapeMouseUp);
  }

  _updateToolbarActive();
}

function _applyBrush() {
  if (!_drawCanvas) return;
  _drawCanvas.freeDrawingBrush = new fabric.PencilBrush(_drawCanvas);
  _drawCanvas.freeDrawingBrush.color = _drawColor;
  _drawCanvas.freeDrawingBrush.width = _drawStrokeWidth;
  _drawCanvas.freeDrawingBrush.decimate = 4;
}

// ── Text tool ──

function _textMouseDown(opt) {
  _drawCanvas.off('mouse:down', _textMouseDown);
  const pointer = _drawCanvas.getPointer(opt.e);
  const text = new fabric.IText('Text', {
    left: pointer.x,
    top: pointer.y,
    fontSize: 20,
    fill: _drawColor,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });
  _drawCanvas.add(text);
  _drawCanvas.setActiveObject(text);
  text.enterEditing();
  text.selectAll();
  // Switch to select after placing text
  _setTool('select');
}

// ── Shape drawing (line, rect, ellipse) ──

function _shapeMouseDown(opt) {
  if (opt.target) return; // clicked on existing object
  const pointer = _drawCanvas.getPointer(opt.e);
  _drawShapeStart = { x: pointer.x, y: pointer.y };

  const common = { stroke: _drawColor, strokeWidth: _drawStrokeWidth, fill: 'transparent', selectable: false, evented: false };

  if (_drawCurrentTool === 'line') {
    _drawActiveShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], common);
  } else if (_drawCurrentTool === 'rect') {
    _drawActiveShape = new fabric.Rect({ left: pointer.x, top: pointer.y, width: 0, height: 0, ...common });
  } else if (_drawCurrentTool === 'ellipse') {
    _drawActiveShape = new fabric.Ellipse({ left: pointer.x, top: pointer.y, rx: 0, ry: 0, ...common });
  }

  if (_drawActiveShape) {
    _drawCanvas.add(_drawActiveShape);
  }
}

function _shapeMouseMove(opt) {
  if (!_drawShapeStart || !_drawActiveShape) return;
  const pointer = _drawCanvas.getPointer(opt.e);
  const sx = _drawShapeStart.x, sy = _drawShapeStart.y;

  if (_drawCurrentTool === 'line') {
    _drawActiveShape.set({ x2: pointer.x, y2: pointer.y });
  } else if (_drawCurrentTool === 'rect') {
    const left = Math.min(sx, pointer.x);
    const top = Math.min(sy, pointer.y);
    _drawActiveShape.set({ left, top, width: Math.abs(pointer.x - sx), height: Math.abs(pointer.y - sy) });
  } else if (_drawCurrentTool === 'ellipse') {
    const rx = Math.abs(pointer.x - sx) / 2;
    const ry = Math.abs(pointer.y - sy) / 2;
    _drawActiveShape.set({ left: Math.min(sx, pointer.x), top: Math.min(sy, pointer.y), rx, ry });
  }

  _drawCanvas.renderAll();
}

function _shapeMouseUp() {
  if (_drawActiveShape) {
    _drawActiveShape.set({ selectable: true, evented: true });
    _drawCanvas.setActiveObject(_drawActiveShape);
  }
  _drawShapeStart = null;
  _drawActiveShape = null;
}

// ── Keyboard shortcuts ──

function _drawKeydown(e) {
  // Only handle when draw view is active
  if (!_drawCanvas) return;
  const browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;

  // Don't intercept when typing in an input/textarea
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

  // Check if a fabric IText is being edited
  const ao = _drawCanvas.getActiveObject();
  if (ao && ao.isEditing) return;

  const meta = e.metaKey || e.ctrlKey;

  if (meta && e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault(); _redo(); return;
  }
  if (meta && e.key.toLowerCase() === 'z') {
    e.preventDefault(); _undo(); return;
  }
  if (meta && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    _drawCanvas.discardActiveObject();
    const sel = new fabric.ActiveSelection(_drawCanvas.getObjects(), { canvas: _drawCanvas });
    _drawCanvas.setActiveObject(sel);
    _drawCanvas.requestRenderAll();
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const sel = _drawCanvas.getActiveObjects();
    if (sel.length) {
      sel.forEach(o => _drawCanvas.remove(o));
      _drawCanvas.discardActiveObject();
      _drawCanvas.renderAll();
    }
    return;
  }

  // Tool shortcuts (single key, no modifier)
  if (!meta && !e.altKey && !e.shiftKey) {
    const map = { v: 'select', p: 'pen', l: 'line', r: 'rect', e: 'ellipse', t: 'text', x: 'eraser' };
    if (map[e.key.toLowerCase()]) {
      e.preventDefault();
      _setTool(map[e.key.toLowerCase()]);
    }
  }
}

// ── Build toolbar ──

function _buildToolbar() {
  _drawToolbar = document.createElement('div');
  _drawToolbar.className = 'draw-toolbar';

  const tools = [
    { id: 'select', icon: _icons.select, title: 'Select (V)' },
    { id: 'pen', icon: _icons.pen, title: 'Pen (P)' },
    { id: 'line', icon: _icons.line, title: 'Line (L)' },
    { id: 'rect', icon: _icons.rect, title: 'Rectangle (R)' },
    { id: 'ellipse', icon: _icons.ellipse, title: 'Ellipse (E)' },
    { id: 'text', icon: _icons.text, title: 'Text (T)' },
    { id: 'eraser', icon: _icons.eraser, title: 'Eraser (X)' },
  ];

  tools.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'draw-toolbar-btn';
    btn.dataset.tool = t.id;
    btn.title = t.title;
    btn.innerHTML = t.icon;
    btn.addEventListener('click', () => _setTool(t.id));
    _drawToolbar.appendChild(btn);
  });

  // Separator
  _drawToolbar.appendChild(_sep());

  // Color swatch
  const swatch = document.createElement('div');
  swatch.className = 'draw-color-swatch';
  swatch.style.background = _drawColor;
  swatch.title = 'Color';
  swatch.addEventListener('click', (e) => _showColorPopover(e, swatch));
  _drawToolbar.appendChild(swatch);

  // Stroke width
  const strokeBtn = document.createElement('div');
  strokeBtn.className = 'draw-stroke-display';
  strokeBtn.textContent = _drawStrokeWidth + 'px';
  strokeBtn.title = 'Stroke width';
  strokeBtn.addEventListener('click', (e) => _showStrokePopover(e, strokeBtn));
  _drawToolbar.appendChild(strokeBtn);

  // Separator
  _drawToolbar.appendChild(_sep());

  // Undo / Redo
  const undoBtn = _makeBtn(_icons.undo, 'Undo (Cmd+Z)');
  undoBtn.addEventListener('click', _undo);
  _drawToolbar.appendChild(undoBtn);

  const redoBtn = _makeBtn(_icons.redo, 'Redo (Cmd+Shift+Z)');
  redoBtn.addEventListener('click', _redo);
  _drawToolbar.appendChild(redoBtn);

  // Separator
  _drawToolbar.appendChild(_sep());

  // Delete selected
  const trashBtn = _makeBtn(_icons.trash, 'Delete selected');
  trashBtn.addEventListener('click', () => {
    if (!_drawCanvas) return;
    const sel = _drawCanvas.getActiveObjects();
    if (sel.length) {
      sel.forEach(o => _drawCanvas.remove(o));
      _drawCanvas.discardActiveObject();
      _drawCanvas.renderAll();
    }
  });
  _drawToolbar.appendChild(trashBtn);

  _updateToolbarActive();
}

function _sep() {
  const el = document.createElement('div');
  el.className = 'draw-toolbar-sep';
  return el;
}

function _makeBtn(iconHtml, title) {
  const btn = document.createElement('button');
  btn.className = 'draw-toolbar-btn';
  btn.title = title;
  btn.innerHTML = iconHtml;
  return btn;
}

function _updateToolbarActive() {
  if (!_drawToolbar) return;
  _drawToolbar.querySelectorAll('.draw-toolbar-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === _drawCurrentTool);
  });
}

// ── Color popover ──

const _colorPalette = [
  '#ffffff', '#aaaaaa', '#555555', '#000000',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

function _showColorPopover(e, swatch) {
  e.stopPropagation();
  _dismissPopover();
  const pop = document.createElement('div');
  pop.className = 'draw-color-popover';

  _colorPalette.forEach(c => {
    const opt = document.createElement('div');
    opt.className = 'draw-color-option' + (c === _drawColor ? ' active' : '');
    opt.style.background = c;
    opt.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _drawColor = c;
      swatch.style.background = c;
      if (_drawCurrentTool === 'pen') _applyBrush();
      _dismissPopover();
    });
    pop.appendChild(opt);
  });

  _drawToolbar.appendChild(pop);
  _drawPopover = pop;
  setTimeout(() => document.addEventListener('mousedown', _dismissPopoverOnOutside, { once: true }), 0);
}

function _showStrokePopover(e, strokeBtn) {
  e.stopPropagation();
  _dismissPopover();
  const pop = document.createElement('div');
  pop.className = 'draw-stroke-popover';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '1';
  slider.max = '40';
  slider.value = String(_drawStrokeWidth);
  const label = document.createElement('span');
  label.className = 'draw-stroke-label';
  label.textContent = _drawStrokeWidth + 'px';

  slider.addEventListener('input', () => {
    _drawStrokeWidth = parseInt(slider.value);
    label.textContent = _drawStrokeWidth + 'px';
    strokeBtn.textContent = _drawStrokeWidth + 'px';
    if (_drawCurrentTool === 'pen') _applyBrush();
  });

  pop.appendChild(slider);
  pop.appendChild(label);
  _drawToolbar.appendChild(pop);
  _drawPopover = pop;
  setTimeout(() => document.addEventListener('mousedown', _dismissPopoverOnOutside, { once: true }), 0);
}

function _dismissPopover() {
  if (_drawPopover) { _drawPopover.remove(); _drawPopover = null; }
}

function _dismissPopoverOnOutside(e) {
  if (_drawPopover && !_drawPopover.contains(e.target)) {
    _dismissPopover();
  }
}
