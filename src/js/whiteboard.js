// ── Whiteboard ──
let _wbStrokes = [];
let _wbRedoStack = [];
let _wbDrawing = false;
let _wbCurrent = null;
let _wbCtx = null;
let _wbCanvas = null;
let _wbMode = 'draw'; // 'draw' | 'eraser' | 'stroke-eraser'
let _wbInited = false;
let _wbResizeObs = null;
let _wbCurrentId = null; // id of active whiteboard
let _wbBoards = []; // [{id, name, createdAt}]

function _loadWbBoards() {
  try {
    const raw = localStorage.getItem('whiteboardBoards');
    _wbBoards = raw ? JSON.parse(raw) : [];
  } catch { _wbBoards = []; }
}

function _saveWbBoards() {
  try { localStorage.setItem('whiteboardBoards', JSON.stringify(_wbBoards)); } catch {}
}

function _wbStrokesKey(id) { return 'wb_strokes_' + id; }

function wbNew(silent) {
  _loadWbBoards();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const board = { id, name: 'Untitled', createdAt: Date.now() };
  _wbBoards.unshift(board);
  _saveWbBoards();
  wbOpen(id);
  if (!silent) _renderWbList();
}

function wbOpen(id) {
  // Save current board first
  if (_wbCurrentId && _wbCurrentId !== id) _saveWbStrokes();
  _wbCurrentId = id;
  // Load strokes
  try {
    const raw = localStorage.getItem(_wbStrokesKey(id));
    _wbStrokes = raw ? JSON.parse(raw) : [];
  } catch { _wbStrokes = []; }
  _wbRedoStack = [];
  if (_wbCtx) { _sizeWbCanvas(); _redrawWb(); }
  _renderWbList();
  // Update title display
  const board = _wbBoards.find(b => b.id === id);
  const titleEl = document.getElementById('wb-title-display');
  if (titleEl && board) titleEl.textContent = board.name;
}

function wbDelete(id) {
  _loadWbBoards();
  _wbBoards = _wbBoards.filter(b => b.id !== id);
  _saveWbBoards();
  try { localStorage.removeItem(_wbStrokesKey(id)); } catch {}
  if (_wbCurrentId === id) {
    if (_wbBoards.length) wbOpen(_wbBoards[0].id);
    else { wbNew(true); }
  }
  _renderWbList();
}

function wbRename(id) {
  const board = _wbBoards.find(b => b.id === id);
  if (!board) return;
  const el = document.getElementById('wb-name-' + id);
  if (!el) return;
  _wbStartEditable(el, (newName) => {
    board.name = newName;
    _saveWbBoards();
    const titleEl = document.getElementById('wb-title-display');
    if (titleEl && _wbCurrentId === id) titleEl.textContent = newName;
    _renderWbList();
  });
}

function _wbStartEditable(el, onFinish) {
  el.contentEditable = 'true';
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const finish = () => {
    el.contentEditable = 'false';
    const newName = el.textContent.trim() || 'Untitled';
    el.textContent = newName;
    onFinish(newName);
  };
  el.onblur = finish;
  el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } };
}

function _renderWbList() {
  const list = document.getElementById('wb-list');
  if (!list) return;
  list.innerHTML = _wbBoards.map(b => {
    const sel = b.id === _wbCurrentId;
    const date = new Date(b.createdAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    return `<div class="wb-list-item group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${sel ? 'bg-accent/15' : 'hover:bg-hover'}" onclick="wbOpen('${b.id}')">
      <div class="flex-1 min-w-0">
        <div id="wb-name-${b.id}" class="text-[0.82rem] text-primary truncate" ondblclick="event.stopPropagation(); wbRename('${b.id}')">${escapeHtml(b.name)}</div>
        <div class="text-[0.68rem] text-dimmer">${dateStr}</div>
      </div>
      <button onclick="event.stopPropagation(); wbDelete('${b.id}')" class="shrink-0 bg-transparent border-none cursor-pointer p-0.5 text-dimmer hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');
}

function _wbDefaultColor() {
  const theme = document.documentElement.getAttribute('data-theme');
  return (theme === 'light' || theme === 'sepia') ? '#000000' : '#ffffff';
}

function initWhiteboard() {
  _wbCanvas = document.getElementById('wb-canvas');
  _wbCtx = _wbCanvas.getContext('2d');

  // Set color picker default based on theme
  const colorInput = document.getElementById('wb-color');
  if (colorInput) colorInput.value = _wbDefaultColor();

  _sizeWbCanvas();
  _redrawWb();

  if (_wbInited) return;
  _wbInited = true;

  // Pointer events
  _wbCanvas.addEventListener('pointerdown', _wbPointerDown);
  _wbCanvas.addEventListener('pointermove', _wbPointerMove);
  _wbCanvas.addEventListener('pointerup', _wbPointerUp);
  _wbCanvas.addEventListener('pointerleave', _wbPointerUp);

  // Toolbar — mode buttons
  const setMode = (mode) => {
    _wbMode = mode;
    document.getElementById('wb-eraser').classList.toggle('active', mode === 'eraser');
    document.getElementById('wb-stroke-eraser').classList.toggle('active', mode === 'stroke-eraser');
    _wbCanvas.style.cursor = mode === 'draw' ? 'crosshair' : 'pointer';
  };
  document.getElementById('wb-eraser').addEventListener('click', () => {
    setMode(_wbMode === 'eraser' ? 'draw' : 'eraser');
  });
  document.getElementById('wb-stroke-eraser').addEventListener('click', () => {
    setMode(_wbMode === 'stroke-eraser' ? 'draw' : 'stroke-eraser');
  });
  document.getElementById('wb-undo').addEventListener('click', _wbUndo);
  document.getElementById('wb-redo').addEventListener('click', _wbRedo);
  document.getElementById('wb-clear').addEventListener('click', _wbClear);
  document.getElementById('wb-size').addEventListener('input', (e) => {
    document.getElementById('wb-size-label').textContent = e.target.value;
  });

  // Resize
  _wbResizeObs = new ResizeObserver(() => {
    _sizeWbCanvas();
    _redrawWb();
  });
  _wbResizeObs.observe(document.getElementById('wb-canvas-area'));
}

function _sizeWbCanvas() {
  const area = document.getElementById('wb-canvas-area');
  if (!area) return;
  const toolbar = area.querySelector('.wb-toolbar');
  const toolbarH = toolbar ? toolbar.offsetHeight : 0;
  _wbCanvas.width = area.clientWidth;
  _wbCanvas.height = area.clientHeight - toolbarH;
}

function _getWbBgColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--bg-body').trim() || '#0a0a0a';
}

function _wbPointerDown(e) {
  const rect = _wbCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (_wbMode === 'stroke-eraser') {
    // Find and remove the topmost stroke near this point
    _wbDrawing = true;
    _wbCanvas.setPointerCapture(e.pointerId);
    _wbStrokeErase(x, y);
    return;
  }

  _wbDrawing = true;
  _wbCanvas.setPointerCapture(e.pointerId);
  const color = _wbMode === 'eraser' ? _getWbBgColor() : document.getElementById('wb-color').value;
  const size = parseInt(document.getElementById('wb-size').value, 10);
  _wbCurrent = { points: [{ x, y }], color, size, eraser: _wbMode === 'eraser' };
  _wbCtx.lineCap = 'round';
  _wbCtx.lineJoin = 'round';
  _wbCtx.strokeStyle = color;
  _wbCtx.lineWidth = size;
  _wbCtx.beginPath();
  _wbCtx.moveTo(x, y);
}

function _wbPointerMove(e) {
  if (!_wbDrawing) return;
  const rect = _wbCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (_wbMode === 'stroke-eraser') {
    _wbStrokeErase(x, y);
    return;
  }

  if (!_wbCurrent) return;
  _wbCurrent.points.push({ x, y });
  _wbCtx.lineTo(x, y);
  _wbCtx.stroke();
  _wbCtx.beginPath();
  _wbCtx.moveTo(x, y);
}

function _wbPointerUp() {
  if (!_wbDrawing) return;
  _wbDrawing = false;
  if (_wbMode !== 'stroke-eraser' && _wbCurrent && _wbCurrent.points.length > 0) {
    _wbStrokes.push(_wbCurrent);
    _wbRedoStack = [];
    _saveWbStrokes();
  }
  _wbCurrent = null;
}

// Distance from point (px,py) to line segment (ax,ay)-(bx,by)
function _ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function _wbStrokeErase(x, y) {
  const threshold = 8;
  // Walk strokes top-to-bottom (last drawn = topmost)
  for (let i = _wbStrokes.length - 1; i >= 0; i--) {
    const s = _wbStrokes[i];
    if (s.eraser) continue; // skip eraser strokes
    for (let j = 0; j < s.points.length - 1; j++) {
      const d = _ptSegDist(x, y, s.points[j].x, s.points[j].y, s.points[j + 1].x, s.points[j + 1].y);
      if (d <= threshold + s.size / 2) {
        _wbRedoStack = [];
        _wbStrokes.splice(i, 1);
        _redrawWb();
        _saveWbStrokes();
        return;
      }
    }
    // Single-point stroke (dot)
    if (s.points.length === 1) {
      const d = Math.hypot(x - s.points[0].x, y - s.points[0].y);
      if (d <= threshold + s.size / 2) {
        _wbRedoStack = [];
        _wbStrokes.splice(i, 1);
        _redrawWb();
        _saveWbStrokes();
        return;
      }
    }
  }
}

function _redrawWb() {
  const ctx = _wbCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, _wbCanvas.width, _wbCanvas.height);
  ctx.fillStyle = _getWbBgColor();
  ctx.fillRect(0, 0, _wbCanvas.width, _wbCanvas.height);
  for (const stroke of _wbStrokes) {
    if (stroke.points.length === 0) continue;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }
}

function _wbUndo() {
  if (!_wbStrokes.length) return;
  _wbRedoStack.push(_wbStrokes.pop());
  _redrawWb();
  _saveWbStrokes();
}

function _wbRedo() {
  if (!_wbRedoStack.length) return;
  _wbStrokes.push(_wbRedoStack.pop());
  _redrawWb();
  _saveWbStrokes();
}

function _wbClear() {
  if (!_wbStrokes.length) return;
  _wbRedoStack = [];
  _wbStrokes = [];
  _redrawWb();
  _saveWbStrokes();
}

function _saveWbStrokes() {
  if (!_wbCurrentId) return;
  try {
    localStorage.setItem(_wbStrokesKey(_wbCurrentId), JSON.stringify(_wbStrokes));
  } catch {}
}
