// ── PDF Viewer with persistent highlighting (PDF.js) ──

const HIGHLIGHT_COLORS = [
  { name: 'yellow', bg: 'rgba(255,235,59,0.35)', solid: '#ffeb3b' },
  { name: 'green',  bg: 'rgba(76,175,80,0.35)',  solid: '#4caf50' },
  { name: 'blue',   bg: 'rgba(66,165,245,0.35)', solid: '#42a5f5' },
  { name: 'pink',   bg: 'rgba(236,64,122,0.35)', solid: '#ec407a' },
];

let _pdfSearchOverlays = [];

let _pdfDoc = null;
let _pdfScale = 1.0;
let _pdfArxivId = '';
let _pdfTotalPages = 0;
let _pdfHighlights = [];
let _pdfContainer = null;
let _pdfPagesContainer = null;
let _pdfRenderedPages = new Set();
let _pdfObserver = null;
let _pdfPopup = null;
let _pdfSavedRange = null;

// ── Pen / Drawing state ──
let _pdfHighlightMode = false;
let _pdfPenMode = false;
let _pdfPenColor = '#000000';
let _pdfPenSize = 2;
let _pdfDrawings = {};       // { pageNum: [ { points, color, size } ] }
let _pdfCurrentStroke = null;
let _pdfCurrentDrawCanvas = null;
let _pdfEraserMode = false;    // false | 'partial' | 'full'

// ── Drawing undo/redo ──
let _pdfUndoStacks = {};   // { pageNum: [ snapshotArray, ... ] }
let _pdfRedoStacks = {};   // { pageNum: [ snapshotArray, ... ] }

// ── Storage ──

function loadPdfHighlights(arxivId) {
  try {
    const all = JSON.parse(localStorage.getItem('pdfHighlights') || '{}');
    return all[arxivId] || [];
  } catch { return []; }
}

function savePdfHighlights() {
  try {
    const all = JSON.parse(localStorage.getItem('pdfHighlights') || '{}');
    if (_pdfHighlights.length) all[_pdfArxivId] = _pdfHighlights;
    else delete all[_pdfArxivId];
    localStorage.setItem('pdfHighlights', JSON.stringify(all));
  } catch (e) { console.error('Failed to save highlights', e); }
}

// ── Drawing storage ──

function loadPdfDrawings(arxivId) {
  try {
    const all = JSON.parse(localStorage.getItem('pdfDrawings') || '{}');
    return all[arxivId] || {};
  } catch { return {}; }
}

function savePdfDrawings() {
  try {
    const all = JSON.parse(localStorage.getItem('pdfDrawings') || '{}');
    const hasStrokes = Object.values(_pdfDrawings).some(arr => arr.length > 0);
    if (hasStrokes) all[_pdfArxivId] = _pdfDrawings;
    else delete all[_pdfArxivId];
    localStorage.setItem('pdfDrawings', JSON.stringify(all));
  } catch (e) { console.error('Failed to save drawings', e); }
}

// ── Init ──

function initPdfViewer(container, url, arxivId) {
  cleanupPdfViewer();
  _pdfContainer = container;
  _pdfArxivId = arxivId;
  _pdfHighlights = loadPdfHighlights(arxivId);
  _pdfDrawings = loadPdfDrawings(arxivId);
  _pdfPenMode = false;
  _pdfUndoStacks = {};
  _pdfRedoStacks = {};

  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.overflow = 'hidden';

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'pdf-toolbar';
  toolbar.innerHTML = `
    <div style="display:flex;align-items:center;gap:0;">
      <button class="pdf-tb-btn" onclick="pdfScrollToPage(-1)" title="Previous page">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <span class="pdf-page-indicator" id="pdf-page-indicator">Loading…</span>
      <button class="pdf-tb-btn" onclick="pdfScrollToPage(1)" title="Next page">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </button>
    </div>
    <span class="pdf-tb-sep"></span>
    <div style="display:flex;align-items:center;gap:0;">
      <button class="pdf-tb-btn" onclick="pdfZoom(-0.25)" title="Zoom out">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>
      </button>
      <span class="pdf-zoom-label" id="pdf-zoom-label">${Math.round(_pdfScale * 100)}%</span>
      <button class="pdf-tb-btn" onclick="pdfZoom(0.25)" title="Zoom in">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </button>
    </div>
    <span class="pdf-tb-sep"></span>
    <button class="pdf-tb-btn" id="pdf-hl-mode-toggle" onclick="togglePdfHighlightMode()" title="Highlight mode">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 14l3 3v5h6v-5l3-3V9H6v5zm5-12h2v3h-2V2zM3.5 5.88l1.41-1.41 2.12 2.12L5.62 8 3.5 5.88zm13.46.71l2.12-2.12 1.41 1.41L18.38 8l-1.42-1.41z"/></svg>
    </button>
    <button class="pdf-tb-btn" id="pdf-pen-toggle" onclick="togglePdfPen()" title="Pen tool">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
    </button>
    <div class="pdf-pen-controls" id="pdf-pen-controls" style="display:none">
      <input type="color" id="pdf-pen-color-input" value="${_pdfPenColor}" class="pdf-pen-color-input" oninput="pdfSetPenColor(this.value)" title="Pen color">
      <input type="number" id="pdf-pen-size-input" class="pdf-pen-size-input" min="1" max="50" value="${_pdfPenSize}" onchange="_pdfPenSize=Math.max(1,Math.min(50,+this.value))" title="Pen width (px)">
      <span class="pdf-tb-sep" style="margin:0 2px"></span>
      <button class="pdf-tb-btn" id="pdf-eraser-partial" onclick="setPdfEraserMode('partial')" title="Partial eraser">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.24 3.56l4.95 4.94a1.5 1.5 0 010 2.12l-8.49 8.49a3 3 0 01-2.12.88H7.17a3 3 0 01-2.12-.88L2.93 16.99a1.5 1.5 0 010-2.12L12.12 5.68l2-2.12a1.5 1.5 0 012.12 0zM4.34 16.28l2.12 2.12a1 1 0 00.71.3h3.41a1 1 0 00.71-.3l3.18-3.18-4.95-4.95-5.18 5.3v.71z"/></svg>
      </button>
      <button class="pdf-tb-btn" id="pdf-eraser-full" onclick="setPdfEraserMode('full')" title="Stroke eraser">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="4" x2="20" y2="20" stroke-linecap="round"/><line x1="20" y1="4" x2="4" y2="20" stroke-linecap="round"/></svg>
      </button>
      <span class="pdf-tb-sep" style="margin:0 2px"></span>
      <button class="pdf-tb-btn" id="pdf-undo-btn" onclick="pdfDrawUndo()" title="Undo (⌘Z)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L2 7v10h10l-3.72-3.72A8.97 8.97 0 0112.5 11c3.31 0 6.13 2.13 7.16 5.09l2.09-.72A11.003 11.003 0 0012.5 8z"/></svg>
      </button>
      <button class="pdf-tb-btn" id="pdf-redo-btn" onclick="pdfDrawRedo()" title="Redo (⌘⇧Z)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11.5 8c2.65 0 5.05 1.04 6.83 2.73L22 7v10H12l3.72-3.72A8.97 8.97 0 0011.5 11c-3.31 0-6.13 2.13-7.16 5.09l-2.09-.72A11.003 11.003 0 0111.5 8z"/></svg>
      </button>
    </div>
    <span style="flex:1"></span>
    <span id="pdf-openreview-link" class="hidden" style="flex-shrink:0"></span>
    <div class="pdf-search-bar" id="pdf-search-bar" style="display:flex;align-items:center;gap:4px;">
      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="opacity:0.4;flex-shrink:0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
      <div style="display:flex;align-items:center;border:1px solid var(--border-input);border-radius:5px;overflow:hidden;background:var(--input-bg,transparent);">
        <input id="pdf-search-input" type="text" placeholder="Find..." style="width:110px;font-size:0.75rem;padding:3px 6px;border:none;background:transparent;color:var(--text-primary,#fff);outline:none;" />
        <span id="pdf-find-count" style="font-size:0.65rem;color:var(--text-dimmer,#888);white-space:nowrap;padding:0 4px;"></span>
        <span style="width:1px;height:16px;background:var(--border-input);flex-shrink:0;"></span>
        <button onclick="pdfSearchPrev()" title="Previous (Shift+Enter)" style="display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;padding:3px 4px;color:var(--text-dimmer,#888);">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M18 15l-6-6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button onclick="pdfSearchNext()" title="Next (Enter)" style="display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;padding:3px 4px;color:var(--text-dimmer,#888);">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  `;
  container.appendChild(toolbar);

  // Wire up toolbar search input
  const searchInput = toolbar.querySelector('#pdf-search-input');
  let _pdfSearchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(_pdfSearchTimer);
      const q = this.value.trim();
      _pdfSearchTimer = setTimeout(() => pdfSearchHighlight(q), 300);
    });
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { this.value = ''; pdfClearSearchHighlights(); this.blur(); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pdfSearchNext(); }
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); pdfSearchPrev(); }
    });
  }

  // Pages container
  const pages = document.createElement('div');
  pages.className = 'pdf-pages-container';
  pages.addEventListener('mouseup', onPdfTextSelected);
  container.appendChild(pages);
  _pdfPagesContainer = pages;

  // Initialize touch gestures for mobile
  initPdfTouchGestures();

  // Configure PDF.js worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  // Load PDF
  const loadingTask = pdfjsLib.getDocument(url);
  loadingTask.promise.then(pdf => {
    _pdfDoc = pdf;
    _pdfTotalPages = pdf.numPages;
    document.getElementById('pdf-page-indicator').textContent = `1 / ${_pdfTotalPages}`;

    // Create placeholder wrappers for all pages
    for (let i = 1; i <= _pdfTotalPages; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page-wrapper';
      wrapper.dataset.page = i;
      wrapper.id = `pdf-page-${i}`;
      wrapper.style.minHeight = '800px';
      pages.appendChild(wrapper);
    }

    // Set first page size from actual PDF dimensions
    pdf.getPage(1).then(page => {
      const vp = page.getViewport({ scale: _pdfScale });
      for (const w of pages.children) {
        w.style.width = vp.width + 'px';
        w.style.minHeight = vp.height + 'px';
      }
    });

    // Lazy-render with IntersectionObserver
    _pdfObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.page);
          if (!_pdfRenderedPages.has(pageNum)) {
            _pdfRenderedPages.add(pageNum);
            renderPdfPage(pageNum, entry.target);
          }
        }
      });
    }, { root: pages, rootMargin: '200px' });

    for (const w of pages.children) {
      _pdfObserver.observe(w);
    }

    // Track current page on scroll
    pages.addEventListener('scroll', updatePdfPageIndicator);

    // Render sidebar panel for existing highlights
    renderHighlightsPanel();
  }).catch(err => {
    console.error('PDF load error', err);
    container.innerHTML = `<div class="flex items-center justify-center h-full text-dim">
      <span>Failed to load PDF. <a href="${url}" target="_blank" class="text-link">Open directly</a></span>
    </div>`;
  });
}

// ── Render a single page ──

function renderPdfPage(pageNum, wrapper) {
  if (!_pdfDoc) return;
  _pdfDoc.getPage(pageNum).then(page => {
    const viewport = page.getViewport({ scale: _pdfScale });
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.minHeight = viewport.height + 'px';
    wrapper.style.height = viewport.height + 'px';
    wrapper.innerHTML = '';

    // Canvas
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width * (window.devicePixelRatio || 1);
    canvas.height = viewport.height * (window.devicePixelRatio || 1);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    wrapper.appendChild(canvas);

    page.render({ canvasContext: ctx, viewport }).promise.then(() => {
      return page.getTextContent();
    }).then(textContent => {
      // Text layer — must use 'textLayer' class for PDF.js CSS
      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      textLayerDiv.style.setProperty('--scale-factor', _pdfScale.toString());
      wrapper.appendChild(textLayerDiv);

      const renderTask = pdfjsLib.renderTextLayer({
        textContent,
        container: textLayerDiv,
        viewport,
      });
      renderTask.promise.catch(err => console.error('Text layer render error:', err));

      // Annotation layer — renders internal links (citations, TOC, URLs)
      page.getAnnotations().then(annotations => {
        if (!annotations.length) return;
        const annotLayer = document.createElement('div');
        annotLayer.className = 'pdf-annotation-layer';
        annotLayer.style.width = viewport.width + 'px';
        annotLayer.style.height = viewport.height + 'px';
        wrapper.appendChild(annotLayer);
        for (const annot of annotations) {
          if (annot.subtype !== 'Link') continue;
          const rect = annot.rect;
          if (!rect) continue;
          const [x1, y1, x2, y2] = pdfjsLib.Util.normalizeRect(viewport.convertToViewportRectangle(rect));
          const link = document.createElement('a');
          link.className = 'pdf-annot-link';
          link.style.left = x1 + 'px';
          link.style.top = y1 + 'px';
          link.style.width = (x2 - x1) + 'px';
          link.style.height = (y2 - y1) + 'px';
          if (annot.dest) {
            link.href = '#';
            link.dataset.dest = typeof annot.dest === 'string' ? annot.dest : JSON.stringify(annot.dest);
            link.addEventListener('click', _onPdfAnnotClick);
          } else if (annot.url) {
            link.href = annot.url;
            link.target = '_blank';
            link.rel = 'noopener';
          }
          annotLayer.appendChild(link);
        }
      });

      // Highlight layer
      const hlLayer = document.createElement('div');
      hlLayer.className = 'pdf-highlight-layer';
      hlLayer.style.width = viewport.width + 'px';
      hlLayer.style.height = viewport.height + 'px';
      wrapper.appendChild(hlLayer);

      // Replay saved highlights for this page
      replayHighlightsForPage(pageNum);

      // Drawing canvas layer
      const drawCanvas = document.createElement('canvas');
      drawCanvas.className = 'pdf-drawing-canvas';
      drawCanvas.width = viewport.width * (window.devicePixelRatio || 1);
      drawCanvas.height = viewport.height * (window.devicePixelRatio || 1);
      drawCanvas.style.width = viewport.width + 'px';
      drawCanvas.style.height = viewport.height + 'px';
      drawCanvas.dataset.page = pageNum;
      wrapper.appendChild(drawCanvas);

      // Set up drawing event listeners
      drawCanvas.addEventListener('pointerdown', onPdfDrawStart);
      drawCanvas.addEventListener('pointermove', onPdfDrawMove);
      drawCanvas.addEventListener('pointerup', onPdfDrawEnd);
      drawCanvas.addEventListener('pointerleave', onPdfDrawEnd);

      // Replay saved drawings for this page
      replayDrawingsForPage(pageNum);
    });
  });
}

// ── Zoom ──

function pdfZoom(delta) {
  const newScale = Math.max(0.5, Math.min(3, _pdfScale + delta));
  if (newScale === _pdfScale) return;
  _pdfScale = newScale;
  document.getElementById('pdf-zoom-label').textContent = Math.round(_pdfScale * 100) + '%';

  _pdfRenderedPages.clear();
  if (!_pdfPagesContainer || !_pdfDoc) return;

  // Disconnect old observer — re-observing already-observed elements is a no-op
  if (_pdfObserver) _pdfObserver.disconnect();

  _pdfDoc.getPage(1).then(page => {
    const vp = page.getViewport({ scale: _pdfScale });
    for (const w of _pdfPagesContainer.children) {
      w.style.width = vp.width + 'px';
      w.style.minHeight = vp.height + 'px';
      w.innerHTML = '';
    }
    // Create fresh observer so it fires for currently-visible pages
    _pdfObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.page);
          if (!_pdfRenderedPages.has(pageNum)) {
            _pdfRenderedPages.add(pageNum);
            renderPdfPage(pageNum, entry.target);
          }
        }
      });
    }, { root: _pdfPagesContainer, rootMargin: '200px' });

    for (const w of _pdfPagesContainer.children) {
      _pdfObserver.observe(w);
    }
  });
}

// ── Page navigation ──

function pdfScrollToPage(delta) {
  if (!_pdfPagesContainer) return;
  const current = getCurrentPdfPage();
  const target = Math.max(1, Math.min(_pdfTotalPages, current + delta));
  const wrapper = document.getElementById(`pdf-page-${target}`);
  if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getCurrentPdfPage() {
  if (!_pdfPagesContainer) return 1;
  const containerRect = _pdfPagesContainer.getBoundingClientRect();
  const midY = containerRect.top + containerRect.height / 3;
  for (const child of _pdfPagesContainer.children) {
    const r = child.getBoundingClientRect();
    if (r.top <= midY && r.bottom > midY) {
      return parseInt(child.dataset.page) || 1;
    }
  }
  return 1;
}

function updatePdfPageIndicator() {
  const el = document.getElementById('pdf-page-indicator');
  if (el) el.textContent = `${getCurrentPdfPage()} / ${_pdfTotalPages}`;
}

// ── Text selection → highlight popup ──

function onPdfTextSelected(e) {
  if (_pdfPenMode || !_pdfHighlightMode) return;
  dismissHighlightPopup();
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

  // Make sure selection is within our PDF text layers
  const range = sel.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  const inPdf = ancestor.closest ? ancestor.closest('.textLayer') : ancestor.parentElement?.closest('.textLayer');
  if (!inPdf) return;

  const rect = range.getBoundingClientRect();
  showHighlightPopup(rect.left + rect.width / 2, rect.top - 44);
  // Save the range AFTER showHighlightPopup (which calls dismissHighlightPopup internally)
  _pdfSavedRange = range.cloneRange();
}

function showHighlightPopup(x, y) {
  dismissHighlightPopup();
  const popup = document.createElement('div');
  popup.className = 'pdf-highlight-popup';
  popup.style.position = 'fixed';
  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
  popup.style.zIndex = '10000';

  // Prevent mousedown from collapsing selection, and stop mouseup
  // from bubbling to pages container (which would dismiss the popup
  // via onPdfTextSelected before the click handler fires)
  popup.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  popup.addEventListener('mouseup', (e) => e.stopPropagation());

  HIGHLIGHT_COLORS.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'pdf-hl-color-btn';
    btn.style.background = c.solid;
    btn.title = c.name;
    btn.addEventListener('click', (e) => { e.stopPropagation(); createHighlight(c); });
    popup.appendChild(btn);
  });

  document.body.appendChild(popup);
  _pdfPopup = popup;

  // Dismiss on mousedown elsewhere
  setTimeout(() => {
    document.addEventListener('mousedown', _dismissPopupHandler);
  }, 0);
}

function _dismissPopupHandler(e) {
  if (_pdfPopup && !_pdfPopup.contains(e.target)) {
    dismissHighlightPopup();
  }
}

function dismissHighlightPopup() {
  if (_pdfPopup) {
    _pdfPopup.remove();
    _pdfPopup = null;
  }
  _pdfSavedRange = null;
  document.removeEventListener('mousedown', _dismissPopupHandler);
}

// ── Create highlight from current selection ──

function createHighlight(color) {
  const range = _pdfSavedRange;
  if (!range) { dismissHighlightPopup(); return; }

  const text = range.toString().trim();
  if (!text) { dismissHighlightPopup(); return; }

  // Find which page wrapper contains this selection
  const ancestor = range.commonAncestorContainer;
  const textLayerEl = ancestor.closest
    ? ancestor.closest('.textLayer')
    : ancestor.parentElement?.closest('.textLayer');
  if (!textLayerEl) { dismissHighlightPopup(); return; }

  const wrapper = textLayerEl.closest('.pdf-page-wrapper');
  if (!wrapper) { dismissHighlightPopup(); return; }

  const pageNum = parseInt(wrapper.dataset.page);
  const wrapperRect = wrapper.getBoundingClientRect();

  // Get all client rects from the range (one per line of selected text)
  const clientRects = range.getClientRects();
  const rects = [];
  for (let i = 0; i < clientRects.length; i++) {
    const cr = clientRects[i];
    if (cr.width < 1 || cr.height < 1) continue;
    rects.push({
      x: (cr.left - wrapperRect.left) / _pdfScale,
      y: (cr.top - wrapperRect.top) / _pdfScale,
      w: cr.width / _pdfScale,
      h: cr.height / _pdfScale,
    });
  }

  if (!rects.length) { dismissHighlightPopup(); return; }

  const highlight = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    page: pageNum,
    color: color.name,
    rects,
    text,
    note: '',
    createdAt: new Date().toISOString(),
  };

  _pdfHighlights.push(highlight);
  savePdfHighlights();
  renderHighlightRects(wrapper, highlight);
  renderHighlightsPanel();

  _pdfSavedRange = null;
  window.getSelection()?.removeAllRanges();
  dismissHighlightPopup();
}

// ── Render highlight rects on PDF ──

function renderHighlightRects(wrapper, highlight) {
  const hlLayer = wrapper.querySelector('.pdf-highlight-layer');
  if (!hlLayer) return;

  const colorObj = HIGHLIGHT_COLORS.find(c => c.name === highlight.color) || HIGHLIGHT_COLORS[0];

  highlight.rects.forEach(r => {
    const div = document.createElement('div');
    div.className = 'pdf-highlight-rect';
    div.dataset.highlightId = highlight.id;
    div.style.left = (r.x * _pdfScale) + 'px';
    div.style.top = (r.y * _pdfScale) + 'px';
    div.style.width = (r.w * _pdfScale) + 'px';
    div.style.height = (r.h * _pdfScale) + 'px';
    div.style.background = colorObj.bg;
    div.onclick = (e) => { e.stopPropagation(); showNotePopup(e, highlight.id); };
    hlLayer.appendChild(div);
  });
}

// ── Replay highlights for a page ──

function replayHighlightsForPage(pageNum) {
  const wrapper = document.getElementById(`pdf-page-${pageNum}`);
  if (!wrapper) return;
  const pageHighlights = _pdfHighlights.filter(h => h.page === pageNum);
  pageHighlights.forEach(h => renderHighlightRects(wrapper, h));
}

// ── Note popup on highlight click ──

let _pdfNotePopup = null;

function showNotePopup(e, highlightId) {
  dismissNotePopup();
  const hl = _pdfHighlights.find(h => h.id === highlightId);
  if (!hl) return;

  const colorObj = HIGHLIGHT_COLORS.find(c => c.name === hl.color) || HIGHLIGHT_COLORS[0];
  const snippet = hl.text.length > 60 ? hl.text.slice(0, 60) + '…' : hl.text;

  const popup = document.createElement('div');
  popup.className = 'pdf-note-popup';
  popup.style.position = 'fixed';
  popup.style.zIndex = '10000';

  popup.innerHTML = `
    <div class="pdf-note-popup-header">
      <div class="pdf-note-popup-quote" style="border-left-color:${colorObj.solid}">${escapeHtml(snippet)}</div>
      <button class="pdf-note-popup-del" onclick="event.stopPropagation();deleteHighlight('${highlightId}')" title="Delete highlight">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V4a1 1 0 011-1h6a1 1 0 011 1v3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <textarea class="pdf-note-popup-textarea" placeholder="Write a note…" rows="3">${escapeHtml(hl.note || '')}</textarea>
  `;

  // Prevent clicks inside from bubbling
  popup.addEventListener('mousedown', (ev) => ev.stopPropagation());
  popup.addEventListener('mouseup', (ev) => ev.stopPropagation());

  document.body.appendChild(popup);
  _pdfNotePopup = popup;

  // Position near click, clamped to viewport
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  let left = e.clientX + 8;
  let top = e.clientY - ph / 2;
  if (left + pw > window.innerWidth - 12) left = e.clientX - pw - 8;
  if (top < 8) top = 8;
  if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';

  // Wire up textarea
  const textarea = popup.querySelector('textarea');
  textarea.focus();
  textarea.addEventListener('input', () => {
    hl.note = textarea.value;
    savePdfHighlights();
    // Sync sidebar card if visible
    const sidebarTextarea = document.querySelector(`.pdf-hl-card-note[data-hl-id="${highlightId}"]`);
    if (sidebarTextarea) { sidebarTextarea.value = textarea.value; autoResizeTextarea(sidebarTextarea); }
  });

  // Dismiss on click outside
  setTimeout(() => {
    document.addEventListener('mousedown', _dismissNotePopupHandler);
  }, 0);
}

function _dismissNotePopupHandler(e) {
  if (_pdfNotePopup && !_pdfNotePopup.contains(e.target)) {
    dismissNotePopup();
  }
}

function dismissNotePopup() {
  if (_pdfNotePopup) {
    _pdfNotePopup.remove();
    _pdfNotePopup = null;
  }
  document.removeEventListener('mousedown', _dismissNotePopupHandler);
}

function deleteHighlight(id) {
  dismissNotePopup();
  _pdfHighlights = _pdfHighlights.filter(h => h.id !== id);
  savePdfHighlights();
  document.querySelectorAll(`.pdf-highlight-rect[data-highlight-id="${id}"]`).forEach(el => el.remove());
  renderHighlightsPanel();
}

function scrollToHighlightNote(id) {
  const card = document.querySelector(`.pdf-hl-card[data-highlight-id="${id}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  card.style.outline = '1px solid var(--accent)';
  setTimeout(() => { card.style.outline = ''; }, 1200);
  const textarea = card.querySelector('textarea');
  if (textarea) textarea.focus();
}

// ── Highlights sidebar panel ──

function renderHighlightsPanel() {
  const panel = document.getElementById('pdf-highlights-panel');
  if (!panel) return;

  if (!_pdfHighlights.length) {
    panel.innerHTML = '<div class="text-[0.75rem] text-dimmer py-2">No highlights yet. Select text in the PDF to highlight.</div>';
    return;
  }

  panel.innerHTML = '';
  _pdfHighlights.forEach((h, i) => {
    const num = i + 1;
    const colorObj = HIGHLIGHT_COLORS.find(c => c.name === h.color) || HIGHLIGHT_COLORS[0];
    const snippet = h.text.length > 80 ? h.text.slice(0, 80) + '…' : h.text;

    const card = document.createElement('div');
    card.className = 'pdf-hl-card';
    card.dataset.highlightId = h.id;

    card.innerHTML = `
      <div class="pdf-hl-card-header" onclick="scrollToHighlight('${h.id}')">
        <span class="pdf-hl-card-badge" style="background:${colorObj.solid}">${num}</span>
        <span class="pdf-hl-card-text">${escapeHtml(snippet)}</span>
        <span class="pdf-hl-card-page">p.${h.page}</span>
        <button class="pdf-hl-card-del" onclick="event.stopPropagation();deleteHighlight('${h.id}')" title="Delete">×</button>
      </div>
      <textarea class="pdf-hl-card-note" placeholder="Add a note…" rows="1" data-hl-id="${h.id}">${escapeHtml(h.note || '')}</textarea>
    `;

    panel.appendChild(card);

    // Auto-resize and save note on input
    const textarea = card.querySelector('textarea');
    autoResizeTextarea(textarea);
    textarea.addEventListener('input', () => {
      autoResizeTextarea(textarea);
      const hl = _pdfHighlights.find(x => x.id === h.id);
      if (hl) { hl.note = textarea.value; savePdfHighlights(); }
    });
  });
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 24) + 'px';
}

function scrollToHighlight(id) {
  const rect = document.querySelector(`.pdf-highlight-rect[data-highlight-id="${id}"]`);
  if (rect) {
    rect.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Flash effect
    rect.style.outline = '2px solid var(--accent)';
    setTimeout(() => { rect.style.outline = ''; }, 1200);
    return;
  }
  // Page might not be rendered yet — scroll to the page wrapper
  const hl = _pdfHighlights.find(h => h.id === id);
  if (hl) {
    const wrapper = document.getElementById(`pdf-page-${hl.page}`);
    if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ── Pen / Drawing ──

function togglePdfHighlightMode() {
  _pdfHighlightMode = !_pdfHighlightMode;
  // Turn off pen mode if switching out of highlight mode
  if (!_pdfHighlightMode && _pdfPenMode) togglePdfPen();
  const btn = document.getElementById('pdf-hl-mode-toggle');
  if (btn) btn.classList.toggle('active', _pdfHighlightMode);
  if (_pdfPagesContainer) {
    _pdfPagesContainer.classList.toggle('pdf-hl-mode', _pdfHighlightMode);
  }
}

function togglePdfPen() {
  // Entering pen mode also activates highlight mode
  if (!_pdfPenMode && !_pdfHighlightMode) togglePdfHighlightMode();
  _pdfPenMode = !_pdfPenMode;
  if (!_pdfPenMode) _pdfEraserMode = false;
  const btn = document.getElementById('pdf-pen-toggle');
  const controls = document.getElementById('pdf-pen-controls');
  if (btn) btn.classList.toggle('active', _pdfPenMode);
  if (controls) controls.style.display = _pdfPenMode ? 'flex' : 'none';
  const partial = document.getElementById('pdf-eraser-partial');
  const full = document.getElementById('pdf-eraser-full');
  if (partial) partial.classList.remove('active');
  if (full) full.classList.remove('active');
  if (_pdfPagesContainer) {
    _pdfPagesContainer.classList.toggle('pdf-pen-active', _pdfPenMode);
    _pdfPagesContainer.classList.remove('pdf-eraser-active');
  }
}

document.addEventListener('keydown', function(e) {
  if (!_pdfPenMode) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    pdfDrawUndo();
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
    e.preventDefault();
    pdfDrawRedo();
  }
});

function pdfSetPenColor(color) {
  _pdfPenColor = color;
}

function setPdfEraserMode(mode) {
  // Toggle off if clicking the same mode
  if (_pdfEraserMode === mode) {
    _pdfEraserMode = false;
  } else {
    _pdfEraserMode = mode;
  }
  const partial = document.getElementById('pdf-eraser-partial');
  const full = document.getElementById('pdf-eraser-full');
  if (partial) partial.classList.toggle('active', _pdfEraserMode === 'partial');
  if (full) full.classList.toggle('active', _pdfEraserMode === 'full');
  if (_pdfPagesContainer) {
    _pdfPagesContainer.classList.toggle('pdf-eraser-active', !!_pdfEraserMode);
  }
}

function eraseStrokeAt(canvas, x, y) {
  const pageNum = canvas.dataset.page;
  const strokes = _pdfDrawings[pageNum];
  if (!strokes || !strokes.length) return;
  const px = x / _pdfScale;
  const py = y / _pdfScale;
  const threshold = 8 / _pdfScale;
  let changed = false;

  if (_pdfEraserMode === 'full') {
    // Full stroke eraser: remove the entire stroke on hit
    for (let si = strokes.length - 1; si >= 0; si--) {
      const pts = strokes[si].points;
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(px, py, pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y) < threshold + strokes[si].size / 2) {
          strokes.splice(si, 1);
          changed = true;
          break;
        }
      }
    }
  } else {
    // Partial eraser: split strokes around erased segments
    for (let si = strokes.length - 1; si >= 0; si--) {
      const stroke = strokes[si];
      const pts = stroke.points;
      const hitSegments = new Set();
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(px, py, pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y) < threshold + stroke.size / 2) {
          hitSegments.add(i);
        }
      }
      if (!hitSegments.size) continue;
      const newStrokes = [];
      let run = [];
      for (let i = 0; i < pts.length; i++) {
        const segHit = hitSegments.has(i);
        const prevHit = hitSegments.has(i - 1);
        if (!segHit && !prevHit) {
          run.push(pts[i]);
        } else if (!segHit && prevHit) {
          if (run.length >= 2) newStrokes.push({ points: run, color: stroke.color, size: stroke.size });
          run = [pts[i]];
        } else {
          if (!prevHit && run.length >= 1) {
            run.push(pts[i]);
            if (run.length >= 2) newStrokes.push({ points: run, color: stroke.color, size: stroke.size });
            run = [];
          }
        }
      }
      if (run.length >= 2) newStrokes.push({ points: run, color: stroke.color, size: stroke.size });
      strokes.splice(si, 1, ...newStrokes);
      changed = true;
    }
  }

  if (changed) {
    savePdfDrawings();
    replayDrawingsForPage(pageNum);
  }
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function onPdfDrawStart(e) {
  if (!_pdfPenMode) return;
  const canvas = e.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (_pdfEraserMode) {
    const pageNum = canvas.dataset.page;
    _pdfSnapshotPage(pageNum);
    eraseStrokeAt(canvas, x, y);
    canvas.setPointerCapture(e.pointerId);
    _pdfCurrentDrawCanvas = canvas;
    _pdfCurrentStroke = null; // flag: erasing, not drawing
    return;
  }

  canvas.setPointerCapture(e.pointerId);
  _pdfSnapshotPage(canvas.dataset.page);
  const dpr = window.devicePixelRatio || 1;
  _pdfCurrentStroke = {
    points: [{ x: x / _pdfScale, y: y / _pdfScale }],
    color: _pdfPenColor,
    size: _pdfPenSize
  };
  _pdfCurrentDrawCanvas = canvas;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = _pdfPenColor;
  ctx.lineWidth = _pdfPenSize * dpr;
  ctx.beginPath();
  ctx.moveTo(x * dpr, y * dpr);
}

function onPdfDrawMove(e) {
  if (!_pdfPenMode || !_pdfCurrentDrawCanvas) return;

  const canvas = _pdfCurrentDrawCanvas;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (_pdfEraserMode) {
    eraseStrokeAt(canvas, x, y);
    return;
  }

  if (!_pdfCurrentStroke) return;
  const dpr = window.devicePixelRatio || 1;
  _pdfCurrentStroke.points.push({ x: x / _pdfScale, y: y / _pdfScale });
  const ctx = canvas.getContext('2d');
  ctx.lineTo(x * dpr, y * dpr);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x * dpr, y * dpr);
}

function onPdfDrawEnd(e) {
  if (_pdfEraserMode) {
    _pdfCurrentDrawCanvas = null;
    return;
  }
  if (!_pdfCurrentStroke || !_pdfCurrentDrawCanvas) return;
  const pageNum = _pdfCurrentDrawCanvas.dataset.page;
  if (!_pdfDrawings[pageNum]) _pdfDrawings[pageNum] = [];
  if (_pdfCurrentStroke.points.length > 1) {
    _pdfDrawings[pageNum].push(_pdfCurrentStroke);
    savePdfDrawings();
  }
  _pdfCurrentStroke = null;
  _pdfCurrentDrawCanvas = null;
}

function replayDrawingsForPage(pageNum) {
  const wrapper = document.getElementById(`pdf-page-${pageNum}`);
  if (!wrapper) return;
  const canvas = wrapper.querySelector('.pdf-drawing-canvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const strokes = _pdfDrawings[pageNum] || [];
  strokes.forEach(stroke => {
    if (stroke.points.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size * dpr;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * _pdfScale * dpr, stroke.points[0].y * _pdfScale * dpr);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x * _pdfScale * dpr, stroke.points[i].y * _pdfScale * dpr);
    }
    ctx.stroke();
  });
}

function _pdfSnapshotPage(pageNum) {
  if (!_pdfUndoStacks[pageNum]) _pdfUndoStacks[pageNum] = [];
  const strokes = _pdfDrawings[pageNum] || [];
  _pdfUndoStacks[pageNum].push(JSON.parse(JSON.stringify(strokes)));
  if (_pdfUndoStacks[pageNum].length > 100) _pdfUndoStacks[pageNum].shift();
  // Clear redo on new action
  _pdfRedoStacks[pageNum] = [];
}

function pdfDrawUndo() {
  const pageNum = getCurrentPdfPage().toString();
  const undoStack = _pdfUndoStacks[pageNum];
  if (!undoStack || !undoStack.length) return;
  // Save current state to redo
  if (!_pdfRedoStacks[pageNum]) _pdfRedoStacks[pageNum] = [];
  _pdfRedoStacks[pageNum].push(JSON.parse(JSON.stringify(_pdfDrawings[pageNum] || [])));
  // Restore previous state
  _pdfDrawings[pageNum] = undoStack.pop();
  savePdfDrawings();
  replayDrawingsForPage(pageNum);
}

function pdfDrawRedo() {
  const pageNum = getCurrentPdfPage().toString();
  const redoStack = _pdfRedoStacks[pageNum];
  if (!redoStack || !redoStack.length) return;
  // Save current state to undo
  if (!_pdfUndoStacks[pageNum]) _pdfUndoStacks[pageNum] = [];
  _pdfUndoStacks[pageNum].push(JSON.parse(JSON.stringify(_pdfDrawings[pageNum] || [])));
  // Restore redo state
  _pdfDrawings[pageNum] = redoStack.pop();
  savePdfDrawings();
  replayDrawingsForPage(pageNum);
}

// ── Cleanup ──

function cleanupPdfViewer() {
  if (_pdfObserver) { _pdfObserver.disconnect(); _pdfObserver = null; }
  if (_pdfDoc) { _pdfDoc.destroy(); _pdfDoc = null; }
  _pdfRenderedPages.clear();
  _pdfTotalPages = 0;
  _pdfHighlights = [];
  _pdfArxivId = '';
  _pdfContainer = null;
  _pdfPagesContainer = null;
  _pdfHighlightMode = false;
  _pdfPenMode = false;
  _pdfEraserMode = false;
  _pdfDrawings = {};
  _pdfCurrentStroke = null;
  _pdfCurrentDrawCanvas = null;
  pdfClearSearchHighlights();
  dismissHighlightPopup();
  dismissNotePopup();
}

// ── Search highlight: find text in PDF and overlay highlights ──

let _pdfSearchMatches = []; // array of { overlays: [div,...] } per match
let _pdfSearchCurrentIdx = -1;

function pdfClearSearchHighlights() {
  _pdfSearchOverlays.forEach(el => el.remove());
  _pdfSearchOverlays = [];
  _pdfSearchMatches = [];
  _pdfSearchCurrentIdx = -1;
}

function _pdfSearchHighlightCurrent() {
  // Hide all matches, show only the current one
  _pdfSearchMatches.forEach(m => m.overlays.forEach(o => o.style.display = 'none'));
  if (_pdfSearchCurrentIdx >= 0 && _pdfSearchCurrentIdx < _pdfSearchMatches.length) {
    const m = _pdfSearchMatches[_pdfSearchCurrentIdx];
    m.overlays.forEach(o => { o.style.display = ''; o.style.background = 'rgba(255,160,0,0.45)'; });
    if (m.overlays[0]) m.overlays[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  _pdfSearchUpdateCounter();
}

function _pdfSearchUpdateCounter() {
  const el = document.getElementById('pdf-find-count');
  if (!el) return;
  if (_pdfSearchMatches.length === 0) {
    el.textContent = 'No matches';
  } else {
    el.textContent = `${_pdfSearchCurrentIdx + 1} of ${_pdfSearchMatches.length}`;
  }
}

function pdfSearchNext() {
  if (!_pdfSearchMatches.length) return;
  _pdfSearchCurrentIdx = (_pdfSearchCurrentIdx + 1) % _pdfSearchMatches.length;
  _pdfSearchHighlightCurrent();
}

function pdfSearchPrev() {
  if (!_pdfSearchMatches.length) return;
  _pdfSearchCurrentIdx = (_pdfSearchCurrentIdx - 1 + _pdfSearchMatches.length) % _pdfSearchMatches.length;
  _pdfSearchHighlightCurrent();
}

function _normalizeForSearch(s) {
  // Ligatures
  s = s.replace(/\ufb00/g,'ff').replace(/\ufb01/g,'fi').replace(/\ufb02/g,'fl')
       .replace(/\ufb03/g,'ffi').replace(/\ufb04/g,'ffl').replace(/\ufb05/g,'st').replace(/\ufb06/g,'st');
  // Collapse whitespace and strip hyphens at line-break boundaries (e.g. "LLaMA- 65B" → "LLaMA-65B", "mod-\nel" → "model")
  s = s.replace(/-\s+/g, '-').replace(/\s+/g, ' ');
  return s.toLowerCase();
}

function _buildPageIndex(wrapper) {
  const textLayer = wrapper.querySelector('.textLayer');
  const hlLayer = wrapper.querySelector('.pdf-highlight-layer');
  if (!textLayer || !hlLayer) return null;

  const spans = textLayer.querySelectorAll('span');
  const charMap = [];
  const fullText = [];
  spans.forEach(span => {
    const t = span.textContent;
    for (let i = 0; i < t.length; i++) {
      charMap.push({ span, offset: i });
      fullText.push(t[i]);
    }
    charMap.push({ span: null, offset: 0 });
    fullText.push(' ');
  });
  const joined = _normalizeForSearch(fullText.join(''));
  return { charMap, joined, hlLayer };
}

function _highlightMatchInPage(wrapper, pageIdx, queryNorm, firstMatch) {
  let searchFrom = 0;
  let found = false;
  const pageNum = parseInt(wrapper.dataset.page);
  while (true) {
    const idx = pageIdx.joined.indexOf(queryNorm, searchFrom);
    if (idx === -1) break;
    searchFrom = idx + 1;
    found = true;

    const matchChars = pageIdx.charMap.slice(idx, idx + queryNorm.length);
    // Reconstruct original (non-normalized) text from the spans
    const textParts = [];
    let lastSpan = null;
    matchChars.forEach(c => {
      if (c.span && c.span !== lastSpan) {
        textParts.push(c.span.textContent);
        lastSpan = c.span;
      }
    });
    const matchText = textParts.join(' ').trim();

    const involvedSpans = new Set();
    matchChars.forEach(c => { if (c.span) involvedSpans.add(c.span); });

    const matchOverlays = [];
    const matchRects = [];
    const wrapperRect = wrapper.getBoundingClientRect();
    involvedSpans.forEach(span => {
      const rect = span.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      matchRects.push({
        x: (rect.left - wrapperRect.left) / _pdfScale,
        y: (rect.top - wrapperRect.top) / _pdfScale,
        w: rect.width / _pdfScale,
        h: rect.height / _pdfScale,
      });

      const div = document.createElement('div');
      div.className = 'pdf-search-highlight';
      div.style.position = 'absolute';
      div.style.left = (rect.left - wrapperRect.left) + 'px';
      div.style.top = (rect.top - wrapperRect.top) + 'px';
      div.style.width = rect.width + 'px';
      div.style.height = rect.height + 'px';
      div.style.background = 'rgba(255,160,0,0.45)';
      div.style.borderRadius = '2px';
      div.style.cursor = 'pointer';
      div.style.mixBlendMode = 'multiply';
      div.style.display = 'none';
      pageIdx.hlLayer.appendChild(div);
      _pdfSearchOverlays.push(div);
      matchOverlays.push(div);

      if (!firstMatch.el) firstMatch.el = div;
    });
    if (matchOverlays.length) {
      const matchEntry = { overlays: matchOverlays, text: matchText, page: pageNum, rects: matchRects };
      _pdfSearchMatches.push(matchEntry);
      // Click any overlay in this match to convert to a note
      matchOverlays.forEach(div => {
        div.addEventListener('click', (e) => {
          e.stopPropagation();
          _convertSearchMatchToHighlight(matchEntry, e);
        });
      });
    }
  }
  return found;
}

function _convertSearchMatchToHighlight(match, event) {
  const colorObj = HIGHLIGHT_COLORS[0]; // default yellow
  const highlight = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    page: match.page,
    color: colorObj.name,
    rects: match.rects,
    text: match.text,
    note: '',
    createdAt: new Date().toISOString(),
  };
  _pdfHighlights.push(highlight);
  savePdfHighlights();
  const wrapper = document.getElementById(`pdf-page-${match.page}`);
  if (wrapper) renderHighlightRects(wrapper, highlight);
  renderHighlightsPanel();
  showNotePopup(event, highlight.id);
}

function pdfTextExists(query) {
  if (!query || query.length < 2 || !_pdfPagesContainer) return false;
  const qNorm = _normalizeForSearch(query);
  const wrappers = _pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
  for (const wrapper of wrappers) {
    const textLayer = wrapper.querySelector('.textLayer');
    if (!textLayer) continue;
    const spans = textLayer.querySelectorAll('span');
    const parts = [];
    spans.forEach(span => { parts.push(span.textContent); });
    const joined = _normalizeForSearch(parts.join(' '));
    if (joined.includes(qNorm)) return true;
  }
  return false;
}

async function _ensureAllPagesRendered() {
  if (!_pdfDoc || !_pdfPagesContainer) return;
  const wrappers = _pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
  const promises = [];
  for (const w of wrappers) {
    const pageNum = parseInt(w.dataset.page);
    if (!_pdfRenderedPages.has(pageNum)) {
      _pdfRenderedPages.add(pageNum);
      promises.push(new Promise(resolve => {
        renderPdfPage(pageNum, w);
        // Wait for text layer to appear
        const check = (tries) => {
          if (w.querySelector('.textLayer') || tries > 40) resolve();
          else setTimeout(() => check(tries + 1), 100);
        };
        check(0);
      }));
    }
  }
  if (promises.length) await Promise.all(promises);
}

async function pdfSearchHighlight(query) {
  pdfClearSearchHighlights();
  if (!query || query.length < 2 || !_pdfPagesContainer) { _pdfSearchUpdateCounter(); return; }

  // Ensure all pages are rendered so we can search their text layers
  await _ensureAllPagesRendered();

  const queryNorm = _normalizeForSearch(query);
  const wrappers = _pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
  const firstMatch = { el: null };

  let found = false;
  const pageIndices = [];
  wrappers.forEach(wrapper => {
    const idx = _buildPageIndex(wrapper);
    if (!idx) { pageIndices.push(null); return; }
    pageIndices.push({ wrapper, idx });
    if (_highlightMatchInPage(wrapper, idx, queryNorm, firstMatch)) found = true;
  });

  if (_pdfSearchMatches.length > 0) {
    _pdfSearchCurrentIdx = 0;
    _pdfSearchHighlightCurrent();
  } else {
    _pdfSearchUpdateCounter();
  }
}

// ── PDF annotation (internal link) click handler ──
function _onPdfAnnotClick(e) {
  e.preventDefault();
  e.stopPropagation();
  const raw = e.currentTarget.dataset.dest;
  if (!raw || !_pdfDoc) return;
  let dest;
  try { dest = JSON.parse(raw); } catch { dest = raw; }
  const resolve = typeof dest === 'string'
    ? _pdfDoc.getDestination(dest).then(d => d)
    : Promise.resolve(dest);
  resolve.then(destArray => {
    if (!destArray || !destArray.length) return;
    const ref = destArray[0];
    return _pdfDoc.getPageIndex(ref).then(idx => idx + 1);
  }).then(pageNum => {
    if (!pageNum || !_pdfPagesContainer) return;
    const wrapper = _pdfPagesContainer.querySelector(`.pdf-page-wrapper[data-page="${pageNum}"]`);
    if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }).catch(() => {});
}

// ── Mobile Touch Gestures ──

let _pdfTouchStartX = 0;
let _pdfTouchStartY = 0;
let _pdfTouchDeltaX = 0;
let _pdfTouchDeltaY = 0;
let _pdfInitialDistance = 0;
let _pdfInitialScale = 1.0;
let _pdfIsPinching = false;

function initPdfTouchGestures() {
  if (!_pdfPagesContainer) return;

  // Only enable on mobile
  if (window.innerWidth >= 768) return;

  _pdfPagesContainer.addEventListener('touchstart', handlePdfTouchStart, { passive: false });
  _pdfPagesContainer.addEventListener('touchmove', handlePdfTouchMove, { passive: false });
  _pdfPagesContainer.addEventListener('touchend', handlePdfTouchEnd, { passive: true });
}

function handlePdfTouchStart(e) {
  // Skip if pen mode active or highlight mode active
  if (_pdfPenMode || _pdfHighlightMode) return;

  if (e.touches.length === 1) {
    // Single touch: prepare for swipe navigation
    _pdfTouchStartX = e.touches[0].clientX;
    _pdfTouchStartY = e.touches[0].clientY;
    _pdfTouchDeltaX = 0;
    _pdfTouchDeltaY = 0;
    _pdfIsPinching = false;
  } else if (e.touches.length === 2) {
    // Two-finger touch: prepare for pinch zoom
    e.preventDefault();
    _pdfIsPinching = true;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _pdfInitialDistance = Math.sqrt(dx * dx + dy * dy);
    _pdfInitialScale = _pdfScale;
  }
}

function handlePdfTouchMove(e) {
  // Skip if pen mode active or highlight mode active
  if (_pdfPenMode || _pdfHighlightMode) return;

  if (e.touches.length === 2 && _pdfIsPinching) {
    // Pinch zoom
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const currentDistance = Math.sqrt(dx * dx + dy * dy);
    const scaleFactor = currentDistance / _pdfInitialDistance;
    let newScale = _pdfInitialScale * scaleFactor;

    // Clamp scale between 0.5x and 3.0x
    newScale = Math.max(0.5, Math.min(3.0, newScale));

    if (newScale !== _pdfScale) {
      _pdfScale = newScale;
      renderAllPdfPages();
      updatePdfZoomLabel();
    }
  } else if (e.touches.length === 1 && !_pdfIsPinching) {
    // Track swipe for page navigation
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    _pdfTouchDeltaX = currentX - _pdfTouchStartX;
    _pdfTouchDeltaY = currentY - _pdfTouchStartY;

    // Only prevent default if horizontal swipe is dominant
    if (Math.abs(_pdfTouchDeltaX) > Math.abs(_pdfTouchDeltaY) && Math.abs(_pdfTouchDeltaX) > 20) {
      e.preventDefault();
    }
  }
}

function handlePdfTouchEnd(e) {
  // Skip if pen mode active or highlight mode active
  if (_pdfPenMode || _pdfHighlightMode) return;

  if (_pdfIsPinching) {
    _pdfIsPinching = false;
    return;
  }

  // Swipe navigation (threshold: 80px horizontal swipe)
  if (Math.abs(_pdfTouchDeltaX) > 80 && Math.abs(_pdfTouchDeltaX) > Math.abs(_pdfTouchDeltaY)) {
    if (_pdfTouchDeltaX > 0) {
      // Swipe right: previous page
      pdfScrollToPage(-1);
    } else {
      // Swipe left: next page
      pdfScrollToPage(1);
    }
  }

  _pdfTouchDeltaX = 0;
  _pdfTouchDeltaY = 0;
}

function updatePdfZoomLabel() {
  const label = document.getElementById('pdf-zoom-label');
  if (label) {
    label.textContent = Math.round(_pdfScale * 100) + '%';
  }
}
