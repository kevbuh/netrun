// ── PDF Viewer with persistent highlighting (PDF.js) ──

const HIGHLIGHT_COLORS = [
  { name: 'yellow', bg: 'rgba(255,235,59,0.35)', solid: '#ffeb3b' },
  { name: 'green',  bg: 'rgba(76,175,80,0.35)',  solid: '#4caf50' },
  { name: 'blue',   bg: 'rgba(66,165,245,0.35)', solid: '#42a5f5' },
  { name: 'pink',   bg: 'rgba(236,64,122,0.35)', solid: '#ec407a' },
];

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
let _pdfPenMode = false;
let _pdfPenColor = '#000000';
let _pdfPenSize = 2;
let _pdfDrawings = {};       // { pageNum: [ { points, color, size } ] }
let _pdfCurrentStroke = null;
let _pdfCurrentDrawCanvas = null;
let _pdfEraserMode = false;

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

  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.overflow = 'hidden';

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'pdf-toolbar';
  toolbar.innerHTML = `
    <button class="pdf-tb-btn" onclick="pdfScrollToPage(-1)" title="Previous page">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
    </button>
    <span class="pdf-page-indicator" id="pdf-page-indicator">Loading…</span>
    <button class="pdf-tb-btn" onclick="pdfScrollToPage(1)" title="Next page">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
    </button>
    <span class="pdf-tb-sep"></span>
    <button class="pdf-tb-btn" onclick="pdfZoom(-0.25)" title="Zoom out">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>
    </button>
    <span class="pdf-zoom-label" id="pdf-zoom-label">${Math.round(_pdfScale * 100)}%</span>
    <button class="pdf-tb-btn" onclick="pdfZoom(0.25)" title="Zoom in">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
    </button>
    <span class="pdf-tb-sep"></span>
    <button class="pdf-tb-btn" id="pdf-pen-toggle" onclick="togglePdfPen()" title="Pen tool">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
    </button>
    <div class="pdf-pen-controls" id="pdf-pen-controls" style="display:none">
      <button class="pdf-pen-color-btn" id="pdf-pen-color-btn" style="background:${_pdfPenColor}" onclick="document.getElementById('pdf-pen-color-input').click()" title="Pen color"></button>
      <input type="color" id="pdf-pen-color-input" value="${_pdfPenColor}" style="display:none" oninput="pdfSetPenColor(this.value)">
      <input type="range" class="pdf-pen-size-slider" id="pdf-pen-size" min="1" max="12" value="${_pdfPenSize}" onchange="_pdfPenSize=+this.value" title="Pen size">
      <button class="pdf-tb-btn" id="pdf-eraser-toggle" onclick="togglePdfEraser()" title="Eraser (tap a stroke to delete it)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.24 3.56l4.95 4.94a1.5 1.5 0 010 2.12l-8.49 8.49a3 3 0 01-2.12.88H7.17a3 3 0 01-2.12-.88L2.93 16.99a1.5 1.5 0 010-2.12L12.12 5.68l2-2.12a1.5 1.5 0 012.12 0zM4.34 16.28l2.12 2.12a1 1 0 00.71.3h3.41a1 1 0 00.71-.3l3.18-3.18-4.95-4.95-5.18 5.3v.71z"/></svg>
      </button>
      <button class="pdf-tb-btn" onclick="pdfPenUndo()" title="Undo last stroke">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L2 7v10h10l-3.72-3.72A8.97 8.97 0 0112.5 11c3.31 0 6.13 2.13 7.16 5.09l2.09-.72A11.003 11.003 0 0012.5 8z"/></svg>
      </button>
    </div>
  `;
  container.appendChild(toolbar);

  // Pages container
  const pages = document.createElement('div');
  pages.className = 'pdf-pages-container';
  pages.addEventListener('mouseup', onPdfTextSelected);
  container.appendChild(pages);
  _pdfPagesContainer = pages;

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
  if (_pdfPenMode) return;
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

function togglePdfPen() {
  _pdfPenMode = !_pdfPenMode;
  if (!_pdfPenMode) _pdfEraserMode = false;
  const btn = document.getElementById('pdf-pen-toggle');
  const controls = document.getElementById('pdf-pen-controls');
  const eraserBtn = document.getElementById('pdf-eraser-toggle');
  if (btn) btn.classList.toggle('active', _pdfPenMode);
  if (controls) controls.style.display = _pdfPenMode ? 'flex' : 'none';
  if (eraserBtn) eraserBtn.classList.remove('active');
  if (_pdfPagesContainer) {
    _pdfPagesContainer.classList.toggle('pdf-pen-active', _pdfPenMode);
    _pdfPagesContainer.classList.remove('pdf-eraser-active');
  }
}

function pdfSetPenColor(color) {
  _pdfPenColor = color;
  const btn = document.getElementById('pdf-pen-color-btn');
  if (btn) btn.style.background = color;
}

function togglePdfEraser() {
  _pdfEraserMode = !_pdfEraserMode;
  const btn = document.getElementById('pdf-eraser-toggle');
  if (btn) btn.classList.toggle('active', _pdfEraserMode);
  if (_pdfPagesContainer) {
    _pdfPagesContainer.classList.toggle('pdf-eraser-active', _pdfEraserMode);
  }
}

function eraseStrokeAt(canvas, x, y) {
  const pageNum = canvas.dataset.page;
  const strokes = _pdfDrawings[pageNum];
  if (!strokes || !strokes.length) return;
  // x, y are in CSS pixels; convert to PDF-unit space
  const px = x / _pdfScale;
  const py = y / _pdfScale;
  const threshold = 8 / _pdfScale; // 8 CSS px hit radius
  for (let si = strokes.length - 1; si >= 0; si--) {
    const pts = strokes[si].points;
    for (let i = 0; i < pts.length - 1; i++) {
      if (distToSegment(px, py, pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y) < threshold + strokes[si].size / 2) {
        strokes.splice(si, 1);
        savePdfDrawings();
        replayDrawingsForPage(pageNum);
        return;
      }
    }
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
    eraseStrokeAt(canvas, x, y);
    canvas.setPointerCapture(e.pointerId);
    _pdfCurrentDrawCanvas = canvas;
    _pdfCurrentStroke = null; // flag: erasing, not drawing
    return;
  }

  canvas.setPointerCapture(e.pointerId);
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

function pdfPenUndo() {
  const pageNum = getCurrentPdfPage().toString();
  if (!_pdfDrawings[pageNum] || !_pdfDrawings[pageNum].length) return;
  _pdfDrawings[pageNum].pop();
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
  _pdfPenMode = false;
  _pdfEraserMode = false;
  _pdfDrawings = {};
  _pdfCurrentStroke = null;
  _pdfCurrentDrawCanvas = null;
  dismissHighlightPopup();
  dismissNotePopup();
}
