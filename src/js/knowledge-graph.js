/* knowledge-graph.js — Personal Knowledge Graph
   Force-directed canvas visualization of papers, authors, topics, and notes. */

// ── State ──
let _kgNodes = [];      // { id, type, label, x, y, vx, vy, pinned, data }
let _kgEdges = [];      // { source, target, type }
let _kgState = {
  zoom: 1, panX: 0, panY: 0,
  dragging: null, dragOffX: 0, dragOffY: 0,
  panning: false, panStartX: 0, panStartY: 0, panStartPanX: 0, panStartPanY: 0,
  hovered: null, selected: null,
  highlightSet: null,   // Set of node IDs to highlight (null = show all)
  filters: { paper: true, author: true, topic: true, note: true },
  simRunning: false, simFrame: 0,
  built: false,
};
let _kgCanvas = null;
let _kgCtx = null;
let _kgRAF = null;
let _kgResizeObs = null;

// ── Colors ──
const _KG_COLORS = {
  paper:  null, // resolved from CSS accent at render time
  author: '#4da6ff',
  topic:  '#22c55e',
  note:   '#f59e0b',
};
const _KG_SHAPES = { paper: 'circle', author: 'circle', topic: 'diamond', note: 'square' };
const _KG_RADII  = { paper: 6, author: 5, topic: 5, note: 5 };

// ── Entry point ──
async function openKnowledgeGraph() {
  hideAllViews();
  const view = await ensureView('knowledge-graph-view');
  view.classList.add('active');
  view.style.display = 'flex';
  view.style.flexDirection = 'column';
  if (window.location.hash !== '#graph') window.location.hash = '#graph';
  setSidebarActive('sb-graph');
  if (!_kgState.built) {
    _kgInit();
    _kgBuildGraph().then(() => {
      _kgRenderLegend();
      _kgRenderFilters();
      _kgRenderStats();
      _kgZoomFit();
      _kgStartSim();
    });
  } else {
    _kgResize();
    _kgDraw();
  }
}

// ── Init canvas ──
function _kgInit() {
  _kgCanvas = document.getElementById('kg-canvas');
  if (!_kgCanvas) return;
  _kgCtx = _kgCanvas.getContext('2d');
  _kgResize();

  // Resize observer
  const wrap = _kgCanvas.parentElement;
  if (wrap && typeof ResizeObserver !== 'undefined') {
    _kgResizeObs = new ResizeObserver(() => { _kgResize(); _kgDraw(); });
    _kgResizeObs.observe(wrap);
  }

  // Events
  _kgCanvas.addEventListener('wheel', _kgOnWheel, { passive: false });
  _kgCanvas.addEventListener('pointerdown', _kgOnPointerDown);
  _kgCanvas.addEventListener('pointermove', _kgOnPointerMove);
  _kgCanvas.addEventListener('pointerup', _kgOnPointerUp);
  _kgCanvas.addEventListener('pointerleave', _kgOnPointerUp);

  // Search
  const searchInput = document.getElementById('kg-search');
  if (searchInput) {
    let _searchTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      const q = searchInput.value.trim();
      if (!q) { _kgClearHighlight(); return; }
      _searchTimer = setTimeout(() => _kgSearch(q), 400);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { searchInput.value = ''; _kgClearHighlight(); }
    });
  }
}

function _kgResize() {
  if (!_kgCanvas) return;
  const wrap = _kgCanvas.parentElement;
  if (!wrap) return;
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  _kgCanvas.width = w * dpr;
  _kgCanvas.height = h * dpr;
  _kgCanvas.style.width = w + 'px';
  _kgCanvas.style.height = h + 'px';
  _kgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Graph Building ──
async function _kgBuildGraph() {
  _kgNodes = [];
  _kgEdges = [];
  const nodeMap = {};

  // 1. Collect engaged papers
  const papers = _kgCollectEngagedPapers();

  // 2. Create paper nodes
  for (const p of papers) {
    const id = 'p:' + (p.link || p.title);
    if (nodeMap[id]) continue;
    const node = { id, type: 'paper', label: _kgTruncate(p.title, 40), x: 0, y: 0, vx: 0, vy: 0, pinned: false, data: p };
    _kgNodes.push(node);
    nodeMap[id] = node;
  }

  // 3. Extract authors
  _kgExtractAuthors(papers, nodeMap);

  // 4. Extract topics
  _kgExtractTopics(papers, nodeMap);

  // 5. Collect notes
  await _kgCollectNotes(nodeMap);

  // 6. Note references
  _kgNoteReferences(nodeMap);

  // 7. Fetch similarities (graceful failure)
  await _kgFetchSimilarities(papers, nodeMap);

  // Random initial positions
  const w = _kgCanvas ? _kgCanvas.clientWidth : 800;
  const h = _kgCanvas ? _kgCanvas.clientHeight : 600;
  for (const n of _kgNodes) {
    n.x = (Math.random() - 0.5) * w * 0.6 + w / 2;
    n.y = (Math.random() - 0.5) * h * 0.6 + h / 2;
  }

  _kgState.built = true;
}

function _kgCollectEngagedPapers() {
  const readSet = new Set(typeof getReadPosts === 'function' ? getReadPosts() : []);
  const saved = typeof getSavedPosts === 'function' ? getSavedPosts() : {};
  const papers = [];
  const seen = new Set();

  // Saved papers have full objects
  for (const [url, entry] of Object.entries(saved)) {
    if (seen.has(url)) continue;
    seen.add(url);
    const p = entry.paper || entry;
    papers.push({ ...p, link: p.link || url, _engaged: 'saved' });
  }

  // Read-only papers from allPapers
  if (typeof allPapers !== 'undefined' && Array.isArray(allPapers)) {
    for (const p of allPapers) {
      const url = p.link;
      if (!url || seen.has(url)) continue;
      if (readSet.has(url)) {
        seen.add(url);
        papers.push({ ...p, _engaged: 'read' });
      }
    }
  }

  // Sort by recency (saved first, then read), cap at 200
  papers.sort((a, b) => {
    if (a._engaged === 'saved' && b._engaged !== 'saved') return -1;
    if (b._engaged === 'saved' && a._engaged !== 'saved') return 1;
    return 0;
  });
  return papers.slice(0, 200);
}

function _kgExtractAuthors(papers, nodeMap) {
  const authorPapers = {};
  for (const p of papers) {
    if (!p.authors) continue;
    const authorStr = typeof p.authors === 'string' ? p.authors : (Array.isArray(p.authors) ? p.authors.join(', ') : '');
    const names = authorStr.split(',').map(s => s.trim()).filter(Boolean);
    const paperId = 'p:' + (p.link || p.title);
    for (const name of names) {
      const key = name.toLowerCase();
      if (!authorPapers[key]) authorPapers[key] = { name, papers: [] };
      authorPapers[key].papers.push(paperId);
    }
  }

  // Only include authors with 2+ papers to avoid clutter
  for (const [key, info] of Object.entries(authorPapers)) {
    if (info.papers.length < 2) continue;
    const id = 'a:' + key;
    if (!nodeMap[id]) {
      const node = { id, type: 'author', label: info.name, x: 0, y: 0, vx: 0, vy: 0, pinned: false, data: { name: info.name, paperCount: info.papers.length } };
      _kgNodes.push(node);
      nodeMap[id] = node;
    }
    for (const pid of info.papers) {
      if (nodeMap[pid]) {
        _kgEdges.push({ source: id, target: pid, type: 'authored' });
      }
    }
  }
}

function _kgExtractTopics(papers, nodeMap) {
  const wordMap = {};
  const paperTopics = {}; // paperId -> [topic keys]

  for (const p of papers) {
    const paperId = 'p:' + (p.link || p.title);
    const topics = [];

    // From categories
    if (p.categories && Array.isArray(p.categories)) {
      for (const cat of p.categories) {
        const key = cat.toLowerCase().trim();
        if (key.length < 2) continue;
        wordMap[key] = (wordMap[key] || 0) + 3;
        topics.push(key);
      }
    }

    // From title words (reuse stop word filtering logic)
    const words = (p.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    for (const w of words) {
      if (w.length < 3 || _KG_STOP_WORDS.has(w)) continue;
      wordMap[w] = (wordMap[w] || 0) + 1;
      topics.push(w);
    }

    paperTopics[paperId] = topics;
  }

  // Top 30 topics
  const topTopics = Object.entries(wordMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([w]) => w);
  const topSet = new Set(topTopics);

  // Create topic nodes + edges
  for (const topic of topTopics) {
    const id = 't:' + topic;
    if (!nodeMap[id]) {
      const node = { id, type: 'topic', label: topic, x: 0, y: 0, vx: 0, vy: 0, pinned: false, data: { weight: wordMap[topic] } };
      _kgNodes.push(node);
      nodeMap[id] = node;
    }
  }

  for (const [paperId, topics] of Object.entries(paperTopics)) {
    if (!nodeMap[paperId]) continue;
    const added = new Set();
    for (const t of topics) {
      if (!topSet.has(t) || added.has(t)) continue;
      added.add(t);
      _kgEdges.push({ source: paperId, target: 't:' + t, type: 'has_topic' });
    }
  }
}

async function _kgCollectNotes(nodeMap) {
  let notes = [];
  if (typeof _vaultNotes !== 'undefined' && Array.isArray(_vaultNotes) && _vaultNotes.length > 0) {
    notes = _vaultNotes;
  } else {
    try {
      const headers = {};
      const token = localStorage.getItem('authToken');
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const resp = await fetch('/api/vault/notes', { headers });
      if (resp.ok) notes = await resp.json();
    } catch (e) { /* ignore */ }
  }

  for (const note of notes) {
    const id = 'n:' + (note.id || note.title || note.name);
    if (nodeMap[id]) continue;
    const node = {
      id, type: 'note',
      label: _kgTruncate(note.title || note.name || 'Untitled', 30),
      x: 0, y: 0, vx: 0, vy: 0, pinned: false,
      data: { ...note }
    };
    _kgNodes.push(node);
    nodeMap[id] = node;
  }
}

function _kgNoteReferences(nodeMap) {
  const noteNodes = _kgNodes.filter(n => n.type === 'note');
  const paperNodes = _kgNodes.filter(n => n.type === 'paper');

  for (const nn of noteNodes) {
    const content = nn.data.content || nn.data.body || '';
    if (!content) continue;

    // Match URLs that correspond to paper links
    for (const pn of paperNodes) {
      const link = pn.data.link;
      if (link && content.includes(link)) {
        _kgEdges.push({ source: nn.id, target: pn.id, type: 'references' });
      }
    }

    // Match [[WikiLinks]] to other notes
    const wikiLinks = content.match(/\[\[([^\]]+)\]\]/g);
    if (wikiLinks) {
      for (const wl of wikiLinks) {
        const title = wl.slice(2, -2).toLowerCase();
        for (const other of noteNodes) {
          if (other.id === nn.id) continue;
          const otherTitle = (other.data.title || other.data.name || '').toLowerCase();
          if (otherTitle && otherTitle === title) {
            _kgEdges.push({ source: nn.id, target: other.id, type: 'note_link' });
          }
        }
      }
    }
  }
}

async function _kgFetchSimilarities(papers, nodeMap) {
  const links = papers.map(p => p.link).filter(Boolean);
  if (links.length < 2) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('authToken');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const resp = await fetch('/api/knowledge-graph/similarities', {
      method: 'POST',
      headers,
      body: JSON.stringify({ links, threshold: 0.65 }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    for (const edge of (data.edges || [])) {
      const srcId = 'p:' + edge.source;
      const tgtId = 'p:' + edge.target;
      if (nodeMap[srcId] && nodeMap[tgtId]) {
        _kgEdges.push({ source: srcId, target: tgtId, type: 'related' });
      }
    }
  } catch (e) { /* Ollama unavailable — graceful */ }
}

// ── Force Layout ──
function _kgStartSim() {
  _kgState.simRunning = true;
  _kgState.simFrame = 0;
  _kgSimLoop();
}

function _kgSimLoop() {
  if (!_kgState.simRunning) return;
  _kgSimulate();
  _kgDraw();
  _kgState.simFrame++;
  if (_kgState.simFrame < 300) {
    _kgRAF = requestAnimationFrame(_kgSimLoop);
  } else {
    _kgState.simRunning = false;
    _kgDraw();
  }
}

function _kgSimulate() {
  const nodes = _kgVisibleNodes();
  const edges = _kgVisibleEdges();
  const damping = 0.85;
  const repulsionK = 800;
  const springLen = 120;
  const springK = 0.015;
  const gravityK = 0.002;
  const w = _kgCanvas ? _kgCanvas.clientWidth : 800;
  const h = _kgCanvas ? _kgCanvas.clientHeight : 600;
  const cx = w / 2, cy = h / 2;

  // Repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = repulsionK / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
      if (!b.pinned) { b.vx += fx; b.vy += fy; }
    }
  }

  // Build node index for edge lookups
  const nodeIdx = {};
  for (const n of nodes) nodeIdx[n.id] = n;

  // Attraction along edges
  for (const e of edges) {
    const a = nodeIdx[e.source], b = nodeIdx[e.target];
    if (!a || !b) continue;
    let dx = b.x - a.x, dy = b.y - a.y;
    let dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const displacement = dist - springLen;
    const force = displacement * springK;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.pinned) { a.vx += fx; a.vy += fy; }
    if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
  }

  // Center gravity + damping + integrate
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx += (cx - n.x) * gravityK;
    n.vy += (cy - n.y) * gravityK;
    n.vx *= damping;
    n.vy *= damping;
    n.x += n.vx;
    n.y += n.vy;
  }
}

// ── Rendering ──
function _kgDraw() {
  if (!_kgCtx || !_kgCanvas) return;
  const ctx = _kgCtx;
  const w = _kgCanvas.clientWidth;
  const h = _kgCanvas.clientHeight;
  const { zoom, panX, panY, hovered, selected, highlightSet, filters } = _kgState;

  // Resolve accent color
  _KG_COLORS.paper = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  const visibleNodes = _kgVisibleNodes();
  const visibleEdges = _kgVisibleEdges();
  const nodeIdx = {};
  for (const n of visibleNodes) nodeIdx[n.id] = n;

  // Draw edges
  for (const e of visibleEdges) {
    const a = nodeIdx[e.source], b = nodeIdx[e.target];
    if (!a || !b) continue;
    const dimmed = highlightSet && (!highlightSet.has(a.id) || !highlightSet.has(b.id));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = dimmed ? 'rgba(128,128,128,0.08)' : _kgEdgeColor(e.type);
    ctx.lineWidth = e.type === 'related' ? 1.5 : 1;
    if (e.type === 'related') ctx.setLineDash([4, 3]);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw nodes
  for (const n of visibleNodes) {
    const dimmed = highlightSet && !highlightSet.has(n.id);
    const isHover = hovered === n.id;
    const isSel = selected === n.id;
    const r = _KG_RADII[n.type] * (isHover || isSel ? 1.4 : 1);
    const color = _KG_COLORS[n.type] || '#888';
    const alpha = dimmed ? 0.15 : 1;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = isSel ? '#fff' : (isHover ? 'rgba(255,255,255,0.7)' : 'transparent');
    ctx.lineWidth = isSel ? 2 : 1.5;

    _kgDrawShape(ctx, n.x, n.y, r, _KG_SHAPES[n.type]);

    // Label
    if (zoom > 0.6 || isHover || isSel) {
      ctx.fillStyle = dimmed ? 'rgba(200,200,200,0.15)' : 'rgba(230,230,230,0.9)';
      ctx.font = `${isSel ? '11' : '9'}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + r + 12);
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function _kgDrawShape(ctx, x, y, r, shape) {
  ctx.beginPath();
  if (shape === 'diamond') {
    ctx.moveTo(x, y - r * 1.3);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r * 1.3);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  } else if (shape === 'square') {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  if (ctx.strokeStyle !== 'transparent') ctx.stroke();
}

function _kgEdgeColor(type) {
  switch (type) {
    case 'authored': return 'rgba(77,166,255,0.25)';
    case 'has_topic': return 'rgba(34,197,94,0.2)';
    case 'related': return 'rgba(180,69,26,0.35)';
    case 'references': return 'rgba(245,158,11,0.3)';
    case 'note_link': return 'rgba(245,158,11,0.25)';
    default: return 'rgba(128,128,128,0.15)';
  }
}

// ── Visibility filtering ──
function _kgVisibleNodes() {
  return _kgNodes.filter(n => _kgState.filters[n.type]);
}

function _kgVisibleEdges() {
  const vis = new Set(_kgVisibleNodes().map(n => n.id));
  return _kgEdges.filter(e => vis.has(e.source) && vis.has(e.target));
}

// ── Interaction ──
function _kgScreenToWorld(sx, sy) {
  return {
    x: (sx - _kgState.panX) / _kgState.zoom,
    y: (sy - _kgState.panY) / _kgState.zoom,
  };
}

function _kgHitTest(wx, wy) {
  const nodes = _kgVisibleNodes();
  let best = null, bestDist = Infinity;
  for (const n of nodes) {
    const dx = n.x - wx, dy = n.y - wy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r = _KG_RADII[n.type] * 2;
    if (dist < r && dist < bestDist) {
      best = n;
      bestDist = dist;
    }
  }
  return best;
}

function _kgOnWheel(e) {
  e.preventDefault();
  const rect = _kgCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const oldZoom = _kgState.zoom;
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  _kgState.zoom = Math.max(0.1, Math.min(5, oldZoom * delta));
  // Zoom centered on cursor
  _kgState.panX = mx - (mx - _kgState.panX) * (_kgState.zoom / oldZoom);
  _kgState.panY = my - (my - _kgState.panY) * (_kgState.zoom / oldZoom);
  _kgDraw();
}

function _kgOnPointerDown(e) {
  const rect = _kgCanvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const { x: wx, y: wy } = _kgScreenToWorld(sx, sy);
  const hit = _kgHitTest(wx, wy);

  if (hit) {
    _kgState.dragging = hit;
    _kgState.dragOffX = hit.x - wx;
    _kgState.dragOffY = hit.y - wy;
    hit.pinned = true;
    _kgCanvas.setPointerCapture(e.pointerId);
  } else {
    _kgState.panning = true;
    _kgState.panStartX = sx;
    _kgState.panStartY = sy;
    _kgState.panStartPanX = _kgState.panX;
    _kgState.panStartPanY = _kgState.panY;
    _kgCanvas.setPointerCapture(e.pointerId);
  }
}

function _kgOnPointerMove(e) {
  const rect = _kgCanvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (_kgState.dragging) {
    const { x: wx, y: wy } = _kgScreenToWorld(sx, sy);
    _kgState.dragging.x = wx + _kgState.dragOffX;
    _kgState.dragging.y = wy + _kgState.dragOffY;
    // Restart simulation on drag
    if (!_kgState.simRunning) _kgStartSim();
    else _kgDraw();
    return;
  }

  if (_kgState.panning) {
    _kgState.panX = _kgState.panStartPanX + (sx - _kgState.panStartX);
    _kgState.panY = _kgState.panStartPanY + (sy - _kgState.panStartY);
    _kgDraw();
    return;
  }

  // Hover
  const { x: wx, y: wy } = _kgScreenToWorld(sx, sy);
  const hit = _kgHitTest(wx, wy);
  const newHover = hit ? hit.id : null;
  if (newHover !== _kgState.hovered) {
    _kgState.hovered = newHover;
    _kgCanvas.style.cursor = newHover ? 'pointer' : 'grab';
    _kgDraw();
  }
}

function _kgOnPointerUp(e) {
  if (_kgState.dragging) {
    _kgState.dragging.pinned = false;
    // If it was just a click (no significant drag), select it
    const rect = _kgCanvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = _kgScreenToWorld(sx, sy);
    const hit = _kgHitTest(wx, wy);
    if (hit && hit.id === _kgState.dragging.id) {
      _kgState.selected = hit.id;
      _kgRenderInfoPanel(hit);
    }
    _kgState.dragging = null;
    _kgDraw();
  } else if (_kgState.panning) {
    _kgState.panning = false;
  } else {
    // Click on empty space — deselect
    _kgState.selected = null;
    const panel = document.getElementById('kg-info-panel');
    if (panel) panel.style.display = 'none';
    _kgDraw();
  }
}

// ── Search ──
async function _kgSearch(query) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('authToken');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const resp = await fetch('/api/semantic-search', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, limit: 30 }),
    });
    if (!resp.ok) { _kgClearHighlight(); return; }
    const data = await resp.json();
    const matchedLinks = new Set((data.results || []).map(r => r.link));

    // Build highlight set: matched papers + 1-hop connected nodes
    const highlight = new Set();
    for (const n of _kgNodes) {
      if (n.type === 'paper' && n.data.link && matchedLinks.has(n.data.link)) {
        highlight.add(n.id);
      }
    }

    // 1-hop expansion
    for (const e of _kgEdges) {
      if (highlight.has(e.source)) highlight.add(e.target);
      if (highlight.has(e.target)) highlight.add(e.source);
    }

    // Also match by title substring
    const lower = query.toLowerCase();
    for (const n of _kgNodes) {
      if (n.label.toLowerCase().includes(lower)) {
        highlight.add(n.id);
        // 1-hop for title matches too
        for (const e of _kgEdges) {
          if (e.source === n.id) highlight.add(e.target);
          if (e.target === n.id) highlight.add(e.source);
        }
      }
    }

    _kgState.highlightSet = highlight.size > 0 ? highlight : null;
    _kgDraw();
  } catch (e) {
    // Fall back to title-only matching
    const lower = query.toLowerCase();
    const highlight = new Set();
    for (const n of _kgNodes) {
      if (n.label.toLowerCase().includes(lower)) {
        highlight.add(n.id);
        for (const e of _kgEdges) {
          if (e.source === n.id) highlight.add(e.target);
          if (e.target === n.id) highlight.add(e.source);
        }
      }
    }
    _kgState.highlightSet = highlight.size > 0 ? highlight : null;
    _kgDraw();
  }
}

function _kgClearHighlight() {
  _kgState.highlightSet = null;
  _kgDraw();
}

// ── Info Panel ──
function _kgRenderInfoPanel(node) {
  const panel = document.getElementById('kg-info-panel');
  if (!panel) return;
  panel.style.display = 'flex';

  const connections = [];
  for (const e of _kgEdges) {
    if (e.source === node.id) {
      const target = _kgNodes.find(n => n.id === e.target);
      if (target) connections.push({ node: target, type: e.type, direction: 'out' });
    }
    if (e.target === node.id) {
      const source = _kgNodes.find(n => n.id === e.source);
      if (source) connections.push({ node: source, type: e.type, direction: 'in' });
    }
  }

  const typeLabel = { paper: 'Paper', author: 'Author', topic: 'Topic', note: 'Note' };
  const typeIcon = { paper: '&#9679;', author: '&#9679;', topic: '&#9670;', note: '&#9632;' };
  const edgeLabel = {
    authored: 'Author', has_topic: 'Topic', related: 'Related',
    references: 'References', note_link: 'Linked note'
  };

  let html = `<div class="kg-info-header">
    <span style="color:${_KG_COLORS[node.type]}">${typeIcon[node.type]}</span>
    <span class="kg-info-type">${typeLabel[node.type]}</span>
    <button class="kg-info-close" onclick="document.getElementById('kg-info-panel').style.display='none'; _kgState.selected=null; _kgDraw();">&times;</button>
  </div>
  <div class="kg-info-title">${_kgEscape(node.data.title || node.data.name || node.label)}</div>`;

  if (node.type === 'paper' && node.data.link) {
    html += `<a class="kg-info-link" href="javascript:void(0)" onclick="openPaperByUrl('${_kgEscape(node.data.link)}')">Open paper</a>`;
  }
  if (node.type === 'author') {
    html += `<div class="kg-info-meta">${node.data.paperCount} paper${node.data.paperCount !== 1 ? 's' : ''} in graph</div>`;
  }
  if (node.type === 'topic') {
    html += `<div class="kg-info-meta">Weight: ${node.data.weight}</div>`;
  }

  if (connections.length > 0) {
    html += '<div class="kg-info-section">Connections</div><div class="kg-info-connections">';
    for (const c of connections.slice(0, 20)) {
      html += `<div class="kg-info-conn" onclick="_kgFocusNode('${c.node.id}')">
        <span style="color:${_KG_COLORS[c.node.type]};font-size:8px">${typeIcon[c.node.type]}</span>
        <span class="kg-info-conn-label">${_kgEscape(c.node.label)}</span>
        <span class="kg-info-conn-type">${edgeLabel[c.type] || c.type}</span>
      </div>`;
    }
    if (connections.length > 20) {
      html += `<div class="kg-info-more">+${connections.length - 20} more</div>`;
    }
    html += '</div>';
  }

  panel.innerHTML = html;
}

function _kgFocusNode(id) {
  const node = _kgNodes.find(n => n.id === id);
  if (!node) return;
  _kgState.selected = id;
  // Center on node
  const w = _kgCanvas.clientWidth;
  const h = _kgCanvas.clientHeight;
  _kgState.panX = w / 2 - node.x * _kgState.zoom;
  _kgState.panY = h / 2 - node.y * _kgState.zoom;
  _kgRenderInfoPanel(node);
  _kgDraw();
}

// ── UI Helpers ──
function _kgRenderLegend() {
  const el = document.getElementById('kg-legend');
  if (!el) return;
  el.innerHTML = [
    { label: 'Paper', color: 'var(--accent)', shape: '&#9679;' },
    { label: 'Author', color: '#4da6ff', shape: '&#9679;' },
    { label: 'Topic', color: '#22c55e', shape: '&#9670;' },
    { label: 'Note', color: '#f59e0b', shape: '&#9632;' },
  ].map(item =>
    `<span class="kg-legend-item"><span style="color:${item.color}">${item.shape}</span> ${item.label}</span>`
  ).join('');
}

function _kgRenderStats() {
  const el = document.getElementById('kg-stats');
  if (!el) return;
  const counts = { paper: 0, author: 0, topic: 0, note: 0 };
  for (const n of _kgNodes) counts[n.type]++;
  el.textContent = `${counts.paper} papers, ${counts.author} authors, ${counts.topic} topics, ${counts.note} notes, ${_kgEdges.length} edges`;
}

function _kgRenderFilters() {
  const el = document.getElementById('kg-filters');
  if (!el) return;
  const types = ['paper', 'author', 'topic', 'note'];
  el.innerHTML = types.map(t => {
    const checked = _kgState.filters[t] ? 'checked' : '';
    const color = t === 'paper' ? 'var(--accent)' : _KG_COLORS[t];
    return `<label class="kg-filter-label" style="--filter-color:${color}">
      <input type="checkbox" ${checked} onchange="_kgToggleFilter('${t}', this.checked)">
      <span>${t.charAt(0).toUpperCase() + t.slice(1)}s</span>
    </label>`;
  }).join('');
}

function _kgToggleFilter(type, on) {
  _kgState.filters[type] = on;
  _kgRenderStats();
  _kgDraw();
}

function _kgZoomFit() {
  const nodes = _kgVisibleNodes();
  if (nodes.length === 0) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const w = _kgCanvas.clientWidth;
  const h = _kgCanvas.clientHeight;
  const graphW = (maxX - minX) || 100;
  const graphH = (maxY - minY) || 100;
  const padding = 60;
  const zoom = Math.min((w - padding * 2) / graphW, (h - padding * 2) / graphH, 2);
  _kgState.zoom = zoom;
  _kgState.panX = w / 2 - ((minX + maxX) / 2) * zoom;
  _kgState.panY = h / 2 - ((minY + maxY) / 2) * zoom;
  _kgDraw();
}

function _kgTruncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
}

function _kgEscape(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Stop words (shared with quality.js concept)
const _KG_STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','it','as','be','was','are','this','that','which','what','how',
  'has','had','have','not','no','do','does','did','will','would','can','could',
  'should','may','might','its','they','their','them','we','our','you','your',
  'he','she','his','her','my','me','new','than','more','most','also','just',
  'about','into','over','after','before','between','under','through','during',
  'using','via','based','been','being','such','these','those','other','each',
  'all','any','some','only','very','both','few','many','much','own','same',
  'use','used','one','two','three','first','well','get','make','like','know',
  'see','way','look','think','time','back','then','now','even','because','since',
]);
