// ── Whiteboard ──
if (window.AetherUI) AetherUI.globals();
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
  const closeSvg = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  AetherUI.mount(VStack(
    _wbBoards.map(b => {
      const sel = b.id === _wbCurrentId;
      const date = new Date(b.createdAt);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
      const nameEl = Text(b.name).font('0.82rem').foreground('primary').truncate().id('wb-name-' + b.id)
        .on('dblclick', e => { e.stopPropagation(); wbRename(b.id); });
      const deleteBtn = Button(RawHTML(closeSvg)).ghost().small()
        .styles({ background: 'transparent', border: 'none', padding: '2px', flexShrink: 0, opacity: 0, transition: 'opacity 0.15s' })
        .foreground('quaternary').attr('title', 'Delete')
        .onTap(e => { e.stopPropagation(); wbDelete(b.id); });
      const row = HStack([
        VStack([nameEl, Text(dateStr).font('0.68rem').foreground('quaternary')]).flex(1).styles({ minWidth: 0 }),
        deleteBtn
      ]).spacing(1.5).padding(1, 1.5).cornerRadius('md')
        .className(sel ? 'bg-accent/15' : 'hover:bg-hover')
        .styles({ cursor: 'pointer', transition: 'background 0.15s' })
        .onTap(() => wbOpen(b.id))
        .onHover(
          () => { deleteBtn.el.style.opacity = '1'; },
          () => { deleteBtn.el.style.opacity = '0'; }
        );
      return row;
    })
  ), list);
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
