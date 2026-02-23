// draw-view.js — Whiteboard / drawing canvas as an NTP morph (draw:// protocol)
// Uses fabric.js (loaded globally) for canvas drawing.
import { _browseRenderTabs } from '/js/toolbar/toolbar-tabs.js';
const _updateIslandNavButtons = (...args) => window._updateIslandNavButtons?.(...args);
import { _browseSetUrlDisplay } from '/js/browse-urlbar.js';
import { _browseUpdateNewTabPage } from '/js/browse/browse-passwords.js';
import { openBrowse } from '/js/browse/browse-windows.js';

let _drawId = null;
let _drawCanvas = null;       // fabric.Canvas instance
let _drawContainer = null;    // .draw-view-container element
let _drawToolbarView = null;  // AetherUI View for toolbar
let _drawResizeObs = null;    // ResizeObserver
let _drawSaveTimer = null;
let _drawUndoStack = [];
let _drawRedoStack = [];
let _drawUndoLock = false;    // prevents recording undo during undo/redo

// @signal — reactive drawing state
let _drawCurrentTool = null;  // State signal (initialized in _buildToolbar)
let _drawColorState = null;   // State signal
let _drawStrokeWidthState = null; // State signal

// Plain values kept in sync with signals for canvas operations
let _drawCurrentToolVal = 'pen';
let _drawColorVal = '#ffffff';
let _drawStrokeWidthVal = 3;

let _drawShapeStart = null;   // { x, y } for shape drawing
let _drawActiveShape = null;  // live shape being drawn

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

  // Tear down any special page (netrun, history, help, chat, terminal, bookmarks) so the NTP can appear
  if (tab._historyPage || tab._helpPage || tab._netrunPage || tab._chatPage || tab._terminalPage || tab._bookmarksPage) {
    if (tab.el) { tab.el.remove(); tab.el = null; }
    delete tab._historyPage;
    delete tab._helpPage;
    delete tab._netrunPage;
    delete tab._chatPage;
    delete tab._chatThreadId;
    delete tab._terminalPage;
    delete tab._bookmarksPage;
  }

  // If already in draw mode, tear down first
  if (tab._drawPage) {
    _drawViewCleanupMorph();
  }

  // Ensure NTP is showing (needed after tearing down special pages)
  let ntp = container?.querySelector('.browse-ntp');
  if (!ntp || ntp.style.display === 'none') {
    tab.blank = true;
    _browseUpdateNewTabPage(tab);
    ntp = container?.querySelector('.browse-ntp');
    if (!ntp) return;
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

  // Update URL bar and tabs (must re-force NTP visible after setting tab.blank=false,
  // since _browseRenderTabs may trigger _browseUpdateNewTabPage which hides non-blank NTPs)
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) _browseSetUrlDisplay(urlInput, tab.url);
  _browseRenderTabs();
  _updateIslandNavButtons();
  ntp.style.display = '';
}
window.openDrawPage = openDrawPage;

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

  // Create container using AetherUI View
  const containerView = new View('div').className('draw-view-container');
  _drawContainer = containerView.el;

  const canvasEl = document.createElement('canvas');
  canvasEl.id = 'draw-canvas-' + drawingId;
  _drawContainer.appendChild(canvasEl);

  ntp.appendChild(_drawContainer);

  // Wait a frame so the container has layout dimensions before fabric init
  await new Promise(r => requestAnimationFrame(r));

  // Force NTP visible — it may have been hidden by _browseUpdateNewTabPage during the yield
  ntp.style.display = '';

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

  // Build toolbar and append to container
  _buildToolbar();
  _drawContainer.appendChild(_drawToolbarView.el);

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
  _drawToolbarView = null;

  // Reset signals so they get re-created fresh next time
  _drawCurrentTool = null;
  _drawColorState = null;
  _drawStrokeWidthState = null;

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
  _drawCurrentToolVal = tool;
  if (_drawCurrentTool) _drawCurrentTool.value = tool;
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
    // Eraser = black brush (since background is dark)
    _drawCanvas.freeDrawingBrush = new fabric.PencilBrush(_drawCanvas);
    _drawCanvas.freeDrawingBrush.color = 'rgba(0,0,0,1)';
    _drawCanvas.freeDrawingBrush.width = _drawStrokeWidthVal * 4;
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
}

function _applyBrush() {
  if (!_drawCanvas) return;
  _drawCanvas.freeDrawingBrush = new fabric.PencilBrush(_drawCanvas);
  _drawCanvas.freeDrawingBrush.color = _drawColorVal;
  _drawCanvas.freeDrawingBrush.width = _drawStrokeWidthVal;
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
    fill: _drawColorVal,
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

  const common = { stroke: _drawColorVal, strokeWidth: _drawStrokeWidthVal, fill: 'transparent', selectable: false, evented: false };

  if (_drawCurrentToolVal === 'line') {
    _drawActiveShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], common);
  } else if (_drawCurrentToolVal === 'rect') {
    _drawActiveShape = new fabric.Rect({ left: pointer.x, top: pointer.y, width: 0, height: 0, ...common });
  } else if (_drawCurrentToolVal === 'ellipse') {
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

  if (_drawCurrentToolVal === 'line') {
    _drawActiveShape.set({ x2: pointer.x, y2: pointer.y });
  } else if (_drawCurrentToolVal === 'rect') {
    const left = Math.min(sx, pointer.x);
    const top = Math.min(sy, pointer.y);
    _drawActiveShape.set({ left, top, width: Math.abs(pointer.x - sx), height: Math.abs(pointer.y - sy) });
  } else if (_drawCurrentToolVal === 'ellipse') {
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

// ── Build toolbar (AetherUI) ──

const _colorPalette = [
  '#ffffff', '#aaaaaa', '#555555', '#000000',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

function _buildToolbar() {
  // Initialize reactive signals
  _drawCurrentTool = State(_drawCurrentToolVal);
  _drawColorState = State(_drawColorVal);
  _drawStrokeWidthState = State(_drawStrokeWidthVal);

  const tools = [
    { id: 'select', icon: _icons.select, title: 'Select (V)' },
    { id: 'pen',    icon: _icons.pen,    title: 'Pen (P)' },
    { id: 'line',   icon: _icons.line,   title: 'Line (L)' },
    { id: 'rect',   icon: _icons.rect,   title: 'Rectangle (R)' },
    { id: 'ellipse',icon: _icons.ellipse,title: 'Ellipse (E)' },
    { id: 'text',   icon: _icons.text,   title: 'Text (T)' },
    { id: 'eraser', icon: _icons.eraser, title: 'Eraser (X)' },
  ];

  // Tool buttons — each reactively updates its active class
  const toolBtns = tools.map(t => {
    const btn = new View('button')
      .className('draw-toolbar-btn')
      .attr('data-tool', t.id)
      .attr('title', t.title)
      .add(RawHTML(t.icon))
      .onTap(() => _setTool(t.id));

    // Reactive active class
    Effect(() => {
      btn.el.classList.toggle('active', _drawCurrentTool.value === t.id);
    });

    return btn;
  });

  // Color swatch — reactively updates background
  const swatchView = new View('div')
    .className('draw-color-swatch')
    .attr('title', 'Color');

  Effect(() => {
    swatchView.el.style.background = _drawColorState.value;
  });

  swatchView.onTap((e) => {
    e.stopPropagation();
    _showColorPopover(e, swatchView.el);
  });

  // Stroke width display — reactively shows current width
  const strokeDisplayView = new View('div')
    .className('draw-stroke-display')
    .attr('title', 'Stroke width');

  Effect(() => {
    strokeDisplayView.el.textContent = _drawStrokeWidthState.value + 'px';
  });

  strokeDisplayView.onTap((e) => {
    e.stopPropagation();
    _showStrokePopover(e, strokeDisplayView.el);
  });

  // Undo button
  const undoBtn = new View('button')
    .className('draw-toolbar-btn')
    .attr('title', 'Undo (Cmd+Z)')
    .add(RawHTML(_icons.undo))
    .onTap(_undo);

  // Redo button
  const redoBtn = new View('button')
    .className('draw-toolbar-btn')
    .attr('title', 'Redo (Cmd+Shift+Z)')
    .add(RawHTML(_icons.redo))
    .onTap(_redo);

  // Delete selected button
  const trashBtn = new View('button')
    .className('draw-toolbar-btn')
    .attr('title', 'Delete selected')
    .add(RawHTML(_icons.trash))
    .onTap(() => {
      if (!_drawCanvas) return;
      const sel = _drawCanvas.getActiveObjects();
      if (sel.length) {
        sel.forEach(o => _drawCanvas.remove(o));
        _drawCanvas.discardActiveObject();
        _drawCanvas.renderAll();
      }
    });

  // Assemble toolbar using HStack
  const toolbarView = HStack(
    ...toolBtns,
    _sepView(),
    swatchView,
    strokeDisplayView,
    _sepView(),
    undoBtn,
    redoBtn,
    _sepView(),
    trashBtn,
  ).className('draw-toolbar');

  _drawToolbarView = toolbarView;
}

function _sepView() {
  return new View('div').className('draw-toolbar-sep');
}

// ── Color popover (AetherUI) ──

let _drawPopoverEl = null; // raw DOM element for active popover

function _showColorPopover(e, anchorEl) {
  _dismissPopover();

  // Build color grid using AetherUI
  const colorOptions = _colorPalette.map(c => {
    const opt = new View('div').className('draw-color-option').styles({ background: c });

    Effect(() => {
      opt.el.classList.toggle('active', _drawColorState.value === c);
    });

    opt.onTap((ev) => {
      ev.stopPropagation();
      _drawColorVal = c;
      _drawColorState.value = c;
      if (_drawCurrentToolVal === 'pen') _applyBrush();
      _dismissPopover();
    });

    return opt;
  });

  const popView = new View('div')
    .className('draw-color-popover')
    .add(...colorOptions);

  _drawToolbarView.el.appendChild(popView.el);
  _drawPopoverEl = popView.el;

  setTimeout(() => document.addEventListener('mousedown', _dismissPopoverOnOutside, { once: true }), 0);
}

function _showStrokePopover(e, anchorEl) {
  _dismissPopover();

  // Reactive stroke width signal bound to slider
  const strokeBinding = _drawStrokeWidthState;

  const sliderView = Slider(strokeBinding, { min: 1, max: 40, step: 1 });

  sliderView.on('input', () => {
    const val = parseInt(sliderView.el.value);
    _drawStrokeWidthVal = val;
    _drawStrokeWidthState.value = val;
    if (_drawCurrentToolVal === 'pen') _applyBrush();
  });

  const labelView = Text('').className('draw-stroke-label');
  Effect(() => {
    labelView.el.textContent = _drawStrokeWidthState.value + 'px';
  });

  const popView = new View('div')
    .className('draw-stroke-popover')
    .add(sliderView, labelView);

  _drawToolbarView.el.appendChild(popView.el);
  _drawPopoverEl = popView.el;

  setTimeout(() => document.addEventListener('mousedown', _dismissPopoverOnOutside, { once: true }), 0);
}

function _dismissPopover() {
  if (_drawPopoverEl) { _drawPopoverEl.remove(); _drawPopoverEl = null; }
}

function _dismissPopoverOnOutside(e) {
  if (_drawPopoverEl && !_drawPopoverEl.contains(e.target)) {
    _dismissPopover();
  }
}
