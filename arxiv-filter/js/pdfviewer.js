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

// ── Init ──

function initPdfViewer(container, url, arxivId) {
  cleanupPdfViewer();
  _pdfContainer = container;
  _pdfArxivId = arxivId;
  _pdfHighlights = loadPdfHighlights(arxivId);

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
      // Placeholder sizing — will be updated when rendered
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
    createdAt: new Date().toISOString(),
  };

  _pdfHighlights.push(highlight);
  savePdfHighlights();
  renderHighlightRects(wrapper, highlight);

  _pdfSavedRange = null;
  window.getSelection()?.removeAllRanges();
  dismissHighlightPopup();
}

// ── Render highlight rects ──

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
    div.onclick = (e) => { e.stopPropagation(); showDeletePopup(e, highlight.id); };
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

// ── Delete highlight ──

function showDeletePopup(e, highlightId) {
  // Remove any existing delete popup
  const existing = document.querySelector('.pdf-delete-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.className = 'pdf-delete-popup';
  popup.style.left = e.clientX + 'px';
  popup.style.top = e.clientY + 'px';
  popup.style.position = 'fixed';

  const btn = document.createElement('button');
  btn.textContent = 'Delete highlight';
  btn.onclick = (ev) => { ev.stopPropagation(); deleteHighlight(highlightId); popup.remove(); };
  popup.appendChild(btn);

  document.body.appendChild(popup);

  const dismiss = (ev) => {
    if (!popup.contains(ev.target)) { popup.remove(); document.removeEventListener('mousedown', dismiss); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

function deleteHighlight(id) {
  _pdfHighlights = _pdfHighlights.filter(h => h.id !== id);
  savePdfHighlights();
  // Remove from DOM
  document.querySelectorAll(`.pdf-highlight-rect[data-highlight-id="${id}"]`).forEach(el => el.remove());
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
  dismissHighlightPopup();
  const dp = document.querySelector('.pdf-delete-popup');
  if (dp) dp.remove();
}
