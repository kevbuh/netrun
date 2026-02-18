// ── Whiteboard ──
let _wbStrokes = [];
let _wbRedoStack = [];
const _wbDrawing = false;
const _wbCurrent = null;
const _wbCtx = null;
const _wbCanvas = null;
const _wbMode = 'draw'; // 'draw' | 'eraser' | 'stroke-eraser'
const _wbInited = false;
const _wbResizeObs = null;
let _wbCurrentId = null; // id of active whiteboard
let _wbBoards = []; // [{id, name, createdAt}]

function _loadWbBoards() {
  try {
    _wbBoards = Settings.getJSON('whiteboardBoards', []);
  } catch { _wbBoards = []; }
}

function _saveWbBoards() {
  try { Settings.setJSON('whiteboardBoards', _wbBoards); } catch {}
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
    _wbStrokes = Settings.getJSON(_wbStrokesKey(id), []);
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
  try { Settings.remove(_wbStrokesKey(id)); } catch {}
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




function _saveWbStrokes() {
  if (!_wbCurrentId) return;
  try {
    Settings.setJSON(_wbStrokesKey(_wbCurrentId), _wbStrokes);
  } catch {}
}
