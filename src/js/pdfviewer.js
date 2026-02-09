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
let _pdfHighlightMode = true;
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

// ── Extracted links from PDF annotations ──
let _pdfExtractedLinks = new Set();

// ── PDF outline / table of contents ──
let _pdfOutline = null;

// ── Smart Highlights state ──
let _smartHighlights = [];
let _smartHighlightsVisible = true;
let _smartHighlightOverlays = [];

const SMART_HL_COLORS = {
  Claim:  { bg: 'rgba(66,165,245,0.18)',  border: 'rgba(66,165,245,0.6)',  solid: '#42a5f5' },
  Method: { bg: 'rgba(171,71,188,0.18)',  border: 'rgba(171,71,188,0.6)',  solid: '#ab47bc' },
  Result: { bg: 'rgba(76,175,80,0.18)',   border: 'rgba(76,175,80,0.6)',   solid: '#4caf50' },
};

// ── Fit-width / spread / dark mode state ──
let _pdfFitWidthMode = false;
let _pdfDarkRender = false;
let _pdfSpreadMode = false;
let _pdfResizeObserver = null;
let _pdfFitWidthDebounce = null;

// ── Thumbnail strip state ──
let _pdfThumbStripVisible = false;
let _pdfThumbContainer = null;
let _pdfThumbRendered = new Set();
let _pdfThumbObserver = null;
let _pdfThumbActivePage = 0;
let _pdfThumbScale = 0.15;
let _pdfThumbSyncRaf = null;

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
  _pdfExtractedLinks = new Set();

  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.overflow = 'hidden';

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'pdf-toolbar';
  toolbar.innerHTML = `
    <button class="pdf-tb-btn" id="pdf-thumb-toggle" onclick="togglePdfThumbs()" title="Thumbnails (T)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h7v7H3V3zm0 11h7v7H3v-7zm11-11h7v7h-7V3zm0 11h7v7h-7v-7z"/></svg>
    </button>
    <span class="pdf-tb-sep"></span>
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
      <div style="position:relative;">
        <button class="pdf-zoom-label" id="pdf-zoom-label" onclick="togglePdfZoomDropdown()" title="Zoom options">${Math.round(_pdfScale * 100)}%</button>
        <div class="pdf-zoom-dropdown" id="pdf-zoom-dropdown" style="display:none;">
          <button onclick="pdfFitWidth()">Fit Width</button>
          <button onclick="pdfSetScale(0.5)">50%</button>
          <button onclick="pdfSetScale(0.75)">75%</button>
          <button onclick="pdfSetScale(1.0)">100%</button>
          <button onclick="pdfSetScale(1.25)">125%</button>
          <button onclick="pdfSetScale(1.5)">150%</button>
          <button onclick="pdfSetScale(2.0)">200%</button>
        </div>
      </div>
      <button class="pdf-tb-btn" onclick="pdfZoom(0.25)" title="Zoom in">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </button>
    </div>
    <span class="pdf-tb-sep"></span>
    <button class="pdf-tb-btn" id="pdf-spread-toggle" onclick="togglePdfSpread()" title="Two-page spread (S)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="8" height="16" rx="1"/><rect x="14" y="4" width="8" height="16" rx="1"/></svg>
    </button>
    <button class="pdf-tb-btn" id="pdf-dark-toggle" onclick="togglePdfDarkMode()" title="Dark mode (D)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
    </button>
    <span class="pdf-tb-sep"></span>
    <button class="pdf-tb-btn" id="pdf-pen-toggle" onclick="togglePdfPen()" title="Pen tool">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42"/></svg>
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
    <span class="pdf-tb-sep"></span>
    <button class="pdf-tb-btn" onclick="pdfPrintCurrent()" title="Print (⌘P)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m0 0a48.159 48.159 0 0 1 10.5 0m-10.5 0V4.875c0-.621.504-1.125 1.125-1.125h8.25c.621 0 1.125.504 1.125 1.125v3.034"/></svg>
    </button>
    <span style="flex:1"></span>
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
        <span style="width:1px;height:16px;background:var(--border-input);flex-shrink:0;"></span>
        <button onclick="closePdfFindBar()" title="Close (Esc)" style="display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;padding:3px 4px;color:var(--text-dimmer,#888);">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/></svg>
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

  // Body wrapper (flex row: optional thumbs + pages)
  const bodyWrapper = document.createElement('div');
  bodyWrapper.className = 'pdf-body-wrapper';
  container.appendChild(bodyWrapper);

  // Pages container
  const pages = document.createElement('div');
  pages.className = 'pdf-pages-container';
  bodyWrapper.appendChild(pages);
  _pdfPagesContainer = pages;
  pages.classList.add('pdf-hl-mode');

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
    pages.addEventListener('scroll', _syncThumbHighlight);
    pages.addEventListener('scroll', _syncOutlineHighlight);

    // ResizeObserver for fit-width
    if (_pdfResizeObserver) _pdfResizeObserver.disconnect();
    _pdfResizeObserver = new ResizeObserver(() => {
      if (!_pdfFitWidthMode) return;
      clearTimeout(_pdfFitWidthDebounce);
      _pdfFitWidthDebounce = setTimeout(() => pdfFitWidth(), 150);
    });
    _pdfResizeObserver.observe(pages);

    // Apply dark mode if saved
    if (localStorage.getItem('pdfDarkMode') === 'true') {
      _pdfDarkRender = true;
      pages.classList.add('pdf-dark-render');
      const darkBtn = document.getElementById('pdf-dark-toggle');
      if (darkBtn) darkBtn.classList.add('active');
    }

    // Render sidebar panel for existing highlights
    renderHighlightsPanel();

    // Open thumbnail strip by default
    if (!_pdfThumbStripVisible) togglePdfThumbs();

    // Fetch PDF outline for left panel
    pdf.getOutline().then(outline => {
      _pdfOutline = outline;
    }).catch(() => {});
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

      // Wait for both text layer AND annotations before setting up handlers
      Promise.all([
        renderTask.promise,
        page.getAnnotations()
      ]).then(([_, annotations]) => {
        setupCitationHovers(textLayerDiv);

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
            // Use smart handler that checks for citations at this position
            link.addEventListener('click', (e) => _onSmartAnnotClick(e, link, textLayerDiv));
          } else if (annot.url) {
            link.href = annot.url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.dataset.url = annot.url;
            _pdfExtractedLinks.add(annot.url);
          }
          annotLayer.appendChild(link);
        }
        _renderPdfLinks();
      }).catch(err => console.error('Text/annotation layer error:', err));

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

async function pdfPrintCurrent() {
  if (!_pdfDoc || !_pdfPagesContainer) return;
  showPrintPreview();
}

let _printPreviewPage = 1;

function showPrintPreview() {
  if (!_pdfDoc) return;
  // Hide active webview so overlay renders on top (Electron GPU compositing)
  if (typeof _browseHideActiveWebview === 'function') _browseHideActiveWebview();
  // Remove existing preview if any
  const existing = document.getElementById('print-preview-overlay');
  if (existing) existing.remove();

  _printPreviewPage = getCurrentPdfPage();
  const totalPages = _pdfTotalPages;

  const overlay = document.createElement('div');
  overlay.id = 'print-preview-overlay';
  overlay.className = 'print-preview-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePrintPreview(); });

  const dialog = document.createElement('div');
  dialog.className = 'print-preview-dialog';

  // Left panel — page preview
  const left = document.createElement('div');
  left.className = 'print-preview-page';

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'print-preview-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'print-preview-canvas';
  canvas.id = 'print-preview-canvas';
  canvasWrap.appendChild(canvas);
  left.appendChild(canvasWrap);

  // Page navigation
  const nav = document.createElement('div');
  nav.className = 'print-preview-nav';
  nav.innerHTML = `
    <button class="print-preview-nav-btn" id="pp-prev" title="Previous page">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
    </button>
    <span class="print-preview-page-indicator" id="pp-page-indicator">${_printPreviewPage} / ${totalPages}</span>
    <button class="print-preview-nav-btn" id="pp-next" title="Next page">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
    </button>
  `;
  left.appendChild(nav);

  // Right panel — settings
  const right = document.createElement('div');
  right.className = 'print-preview-settings';
  right.innerHTML = `
    <div class="print-preview-settings-title">Print</div>
    <div class="print-preview-field">
      <label class="print-preview-label">Pages</label>
      <div class="print-preview-radio-group">
        <label class="print-preview-radio"><input type="radio" name="pp-range" value="all" checked> All</label>
        <label class="print-preview-radio"><input type="radio" name="pp-range" value="current"> Current page</label>
        <label class="print-preview-radio"><input type="radio" name="pp-range" value="custom"> Custom
          <input type="text" id="pp-custom-range" class="print-preview-custom-input" placeholder="e.g. 1-5, 8" disabled>
        </label>
      </div>
    </div>
    <div class="print-preview-field">
      <label class="print-preview-label">Orientation</label>
      <div class="print-preview-toggle-row">
        <button class="print-preview-toggle active" id="pp-orient-portrait" title="Portrait">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="3" width="14" height="18" rx="1"/></svg>
          Portrait
        </button>
        <button class="print-preview-toggle" id="pp-orient-landscape" title="Landscape">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="1"/></svg>
          Landscape
        </button>
      </div>
    </div>
    <div class="print-preview-field">
      <label class="print-preview-label">Scale</label>
      <select id="pp-scale" class="print-preview-select">
        <option value="fit" selected>Fit to page</option>
        <option value="100">100%</option>
        <option value="75">75%</option>
        <option value="50">50%</option>
      </select>
    </div>
    <div style="flex:1"></div>
    <div class="print-preview-actions">
      <button class="print-preview-cancel" id="pp-cancel">Cancel</button>
      <button class="print-preview-print" id="pp-print">Print</button>
    </div>
  `;

  dialog.appendChild(left);
  dialog.appendChild(right);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Render initial preview page
  _renderPrintPreviewPage(_printPreviewPage);

  // Wire up nav buttons
  document.getElementById('pp-prev').addEventListener('click', () => {
    if (_printPreviewPage > 1) { _printPreviewPage--; _renderPrintPreviewPage(_printPreviewPage); }
  });
  document.getElementById('pp-next').addEventListener('click', () => {
    if (_printPreviewPage < totalPages) { _printPreviewPage++; _renderPrintPreviewPage(_printPreviewPage); }
  });

  // Wire up radio buttons — enable/disable custom range input
  right.querySelectorAll('input[name="pp-range"]').forEach(r => {
    r.addEventListener('change', () => {
      const customInput = document.getElementById('pp-custom-range');
      customInput.disabled = r.value !== 'custom';
      if (r.value === 'custom') customInput.focus();
    });
  });

  // Orientation toggles
  document.getElementById('pp-orient-portrait').addEventListener('click', function() {
    this.classList.add('active');
    document.getElementById('pp-orient-landscape').classList.remove('active');
  });
  document.getElementById('pp-orient-landscape').addEventListener('click', function() {
    this.classList.add('active');
    document.getElementById('pp-orient-portrait').classList.remove('active');
  });

  // Cancel and print
  document.getElementById('pp-cancel').addEventListener('click', closePrintPreview);
  document.getElementById('pp-print').addEventListener('click', _executePrint);

  // Keyboard
  const onKey = (e) => {
    if (e.key === 'Escape') { closePrintPreview(); e.preventDefault(); }
    if (e.key === 'Enter' && !e.target.matches('input[type="text"]')) { _executePrint(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { document.getElementById('pp-prev')?.click(); e.preventDefault(); }
    if (e.key === 'ArrowRight') { document.getElementById('pp-next')?.click(); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  overlay._ppKeyHandler = onKey;
}

function _renderPrintPreviewPage(pageNum) {
  if (!_pdfDoc) return;
  const canvas = document.getElementById('print-preview-canvas');
  if (!canvas) return;
  const indicator = document.getElementById('pp-page-indicator');
  if (indicator) indicator.textContent = `${pageNum} / ${_pdfTotalPages}`;

  _pdfDoc.getPage(pageNum).then(page => {
    // Fit page into the preview area (~440px wide, ~380px tall)
    const vp = page.getViewport({ scale: 1 });
    const maxW = 440, maxH = 380;
    const scale = Math.min(maxW / vp.width, maxH / vp.height);
    const viewport = page.getViewport({ scale });

    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    page.render({ canvasContext: ctx, viewport });
  });
}

function closePrintPreview() {
  const overlay = document.getElementById('print-preview-overlay');
  if (!overlay) return;
  if (overlay._ppKeyHandler) document.removeEventListener('keydown', overlay._ppKeyHandler);
  overlay.remove();
  // Restore webview after overlay is gone
  if (typeof _browseRestoreActiveWebview === 'function') _browseRestoreActiveWebview();
}

async function _executePrint() {
  if (!_pdfDoc || !_pdfPagesContainer) { closePrintPreview(); return; }

  // Parse page range from settings
  const rangeRadio = document.querySelector('input[name="pp-range"]:checked');
  const rangeValue = rangeRadio ? rangeRadio.value : 'all';
  let pagesToPrint = null; // null = all

  if (rangeValue === 'current') {
    pagesToPrint = new Set([_printPreviewPage]);
  } else if (rangeValue === 'custom') {
    const input = document.getElementById('pp-custom-range');
    pagesToPrint = _parsePageRange(input ? input.value : '', _pdfTotalPages);
    if (!pagesToPrint || pagesToPrint.size === 0) { pagesToPrint = null; }
  }

  closePrintPreview();

  // Hide pages not in range (if subset selected)
  const wrappers = _pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
  const hiddenWrappers = [];
  if (pagesToPrint) {
    for (const w of wrappers) {
      const pn = parseInt(w.dataset.page);
      if (!pagesToPrint.has(pn)) {
        w.style.display = 'none';
        hiddenWrappers.push(w);
      }
    }
  }

  await _ensureAllPagesRendered();
  document.body.classList.add('printing-pdf');

  if (window.electronAPI && window.electronAPI.print) {
    await window.electronAPI.print({ printBackground: true });
  } else {
    window.print();
  }

  document.body.classList.remove('printing-pdf');
  // Restore hidden pages
  for (const w of hiddenWrappers) w.style.display = '';
}

function _parsePageRange(str, total) {
  const pages = new Set();
  if (!str || !str.trim()) return pages;
  const parts = str.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const from = Math.max(1, parseInt(rangeMatch[1]));
      const to = Math.min(total, parseInt(rangeMatch[2]));
      for (let i = from; i <= to; i++) pages.add(i);
    } else {
      const n = parseInt(trimmed);
      if (n >= 1 && n <= total) pages.add(n);
    }
  }
  return pages;
}

function pdfZoom(delta) {
  _pdfFitWidthMode = false;
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
    const wrappers = _pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
    for (const w of wrappers) {
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

    for (const w of wrappers) {
      _pdfObserver.observe(w);
    }
    setTimeout(_syncThumbHighlight, 300);
  });
}

function pdfFitWidth() {
  if (!_pdfDoc || !_pdfPagesContainer) return;
  _closePdfZoomDropdown();
  _pdfDoc.getPage(1).then(page => {
    const baseVp = page.getViewport({ scale: 1.0 });
    const baseWidth = baseVp.width;
    const availableWidth = _pdfPagesContainer.clientWidth - 24;
    let targetScale;
    if (_pdfSpreadMode) {
      targetScale = (availableWidth - 12) / (baseWidth * 2);
    } else {
      targetScale = availableWidth / baseWidth;
    }
    targetScale = Math.max(0.5, Math.min(3.0, targetScale));
    _pdfFitWidthMode = true;
    _pdfScale = targetScale;
    document.getElementById('pdf-zoom-label').textContent = 'Fit W';
    _applyPdfScale();
  });
}

function pdfSetScale(absoluteScale) {
  _pdfFitWidthMode = false;
  _pdfScale = Math.max(0.5, Math.min(3, absoluteScale));
  document.getElementById('pdf-zoom-label').textContent = Math.round(_pdfScale * 100) + '%';
  _applyPdfScale();
  _closePdfZoomDropdown();
}

function togglePdfZoomDropdown() {
  const dd = document.getElementById('pdf-zoom-dropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? '' : 'none';
  if (dd.style.display !== 'none') {
    setTimeout(() => document.addEventListener('click', _closePdfZoomDropdown, { once: true }), 0);
  }
}

function _closePdfZoomDropdown() {
  const dd = document.getElementById('pdf-zoom-dropdown');
  if (dd) dd.style.display = 'none';
}

function _applyPdfScale() {
  _pdfRenderedPages.clear();
  if (!_pdfPagesContainer || !_pdfDoc) return;
  if (_pdfObserver) _pdfObserver.disconnect();

  _pdfDoc.getPage(1).then(page => {
    const vp = page.getViewport({ scale: _pdfScale });
    const wrappers = _pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
    for (const w of wrappers) {
      w.style.width = vp.width + 'px';
      w.style.minHeight = vp.height + 'px';
      w.innerHTML = '';
    }
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

    for (const w of wrappers) {
      _pdfObserver.observe(w);
    }
    setTimeout(_syncThumbHighlight, 300);
  });
}

// ── Dark mode toggle ──

function togglePdfDarkMode() {
  _pdfDarkRender = !_pdfDarkRender;
  localStorage.setItem('pdfDarkMode', _pdfDarkRender ? 'true' : 'false');
  if (_pdfPagesContainer) _pdfPagesContainer.classList.toggle('pdf-dark-render', _pdfDarkRender);
  const btn = document.getElementById('pdf-dark-toggle');
  if (btn) btn.classList.toggle('active', _pdfDarkRender);
}

// ── Two-page spread ──

function togglePdfSpread() {
  _pdfSpreadMode = !_pdfSpreadMode;
  const btn = document.getElementById('pdf-spread-toggle');
  if (btn) btn.classList.toggle('active', _pdfSpreadMode);
  _rebuildPageLayout();
}

function _rebuildPageLayout() {
  if (!_pdfPagesContainer) return;
  // Remove existing spread rows
  _pdfPagesContainer.querySelectorAll('.pdf-spread-row').forEach(r => {
    while (r.firstChild) _pdfPagesContainer.appendChild(r.firstChild);
    r.remove();
  });

  if (_pdfSpreadMode) {
    const wrappers = [..._pdfPagesContainer.querySelectorAll('.pdf-page-wrapper')];
    // First page alone (cover), then pairs
    if (wrappers.length > 0) {
      const row1 = document.createElement('div');
      row1.className = 'pdf-spread-row';
      row1.appendChild(wrappers[0]);
      _pdfPagesContainer.appendChild(row1);
    }
    for (let i = 1; i < wrappers.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'pdf-spread-row';
      row.appendChild(wrappers[i]);
      if (i + 1 < wrappers.length) row.appendChild(wrappers[i + 1]);
      _pdfPagesContainer.appendChild(row);
    }
  }

  // Re-observe for lazy rendering
  if (_pdfObserver) _pdfObserver.disconnect();
  const wrappers = _pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
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
  for (const w of wrappers) _pdfObserver.observe(w);

  // Recalculate fit-width if active
  if (_pdfFitWidthMode) pdfFitWidth();
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
  const wrappers = _pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
  for (const child of wrappers) {
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

// ── Thumbnail strip ──

function togglePdfThumbs() {
  _pdfThumbStripVisible = !_pdfThumbStripVisible;
  const btn = document.getElementById('pdf-thumb-toggle');
  if (btn) btn.classList.toggle('active', _pdfThumbStripVisible);

  if (_pdfThumbStripVisible) {
    if (!_pdfThumbContainer) _initPdfThumbs();
    _pdfThumbContainer.style.display = '';
    // Force sync and focus active thumbnail for keyboard nav
    _pdfThumbActivePage = 0;
    _syncThumbHighlight();
    requestAnimationFrame(() => {
      const active = _pdfThumbContainer?.querySelector('.pdf-thumb-item.active');
      if (active) active.focus();
    });
  } else if (_pdfThumbContainer) {
    _pdfThumbContainer.style.display = 'none';
  }
}

function _initPdfThumbs() {
  if (!_pdfDoc || !_pdfPagesContainer) return;
  const wrapper = _pdfPagesContainer.parentElement; // .pdf-body-wrapper

  const panel = document.createElement('div');
  panel.className = 'pdf-left-panel';

  // Tab bar
  const tabs = document.createElement('div');
  tabs.className = 'pdf-left-panel-tabs';
  tabs.innerHTML = `
    <button class="pdf-left-panel-tab active" data-tab="thumbs" onclick="_switchPdfLeftTab('thumbs')">Thumbnails</button>
    <button class="pdf-left-panel-tab" data-tab="outline" onclick="_switchPdfLeftTab('outline')">Outline</button>
  `;
  panel.appendChild(tabs);

  // Content area
  const content = document.createElement('div');
  content.className = 'pdf-left-panel-content';

  const scroll = document.createElement('div');
  scroll.className = 'pdf-thumb-scroll';
  content.appendChild(scroll);

  const outlineScroll = document.createElement('div');
  outlineScroll.className = 'pdf-outline-scroll';
  outlineScroll.style.display = 'none';
  content.appendChild(outlineScroll);

  panel.appendChild(content);
  wrapper.insertBefore(panel, _pdfPagesContainer);
  _pdfThumbContainer = panel;

  // Render outline
  _renderOutlinePanel(outlineScroll);

  // Default to outline tab if outline exists
  if (_pdfOutline && _pdfOutline.length > 0) {
    _switchPdfLeftTab('outline');
  }

  // Compute scale from page 1
  _pdfDoc.getPage(1).then(page => {
    const vp = page.getViewport({ scale: 1.0 });
    _pdfThumbScale = 120 / vp.width;

    for (let i = 1; i <= _pdfTotalPages; i++) {
      const item = document.createElement('div');
      item.className = 'pdf-thumb-item';
      item.dataset.page = i;
      item.tabIndex = 0;
      const thumbVp = page.getViewport({ scale: _pdfThumbScale });
      item.style.width = '120px';
      item.style.height = Math.round(thumbVp.height) + 'px';
      item.style.position = 'relative';

      const label = document.createElement('div');
      label.className = 'pdf-thumb-label';
      label.textContent = i;
      item.appendChild(label);

      item.addEventListener('keydown', e => _pdfThumbKeyHandler(e, i));
      scroll.appendChild(item);
    }

    // Event delegation for clicks — captures clicks on any child (canvas, label, etc.)
    scroll.addEventListener('click', e => {
      const item = e.target.closest('.pdf-thumb-item');
      if (item) _pdfThumbGoToPage(parseInt(item.dataset.page));
    });

    // Lazy-render thumbnails with IntersectionObserver
    _pdfThumbObserver = new IntersectionObserver(entries => {
      const toRender = [];
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pn = parseInt(entry.target.dataset.page);
          if (!_pdfThumbRendered.has(pn)) toRender.push(pn);
        }
      });
      if (toRender.length) _renderThumbBatch(toRender);
    }, { root: scroll, rootMargin: '200px' });

    for (const item of scroll.children) {
      _pdfThumbObserver.observe(item);
    }
  });
}

function _renderThumbBatch(pageNums) {
  const batch = pageNums.slice(0, 3);
  const rest = pageNums.slice(3);
  batch.forEach(pn => _renderSingleThumb(pn));
  if (rest.length) {
    const cb = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 16);
    cb(() => _renderThumbBatch(rest));
  }
}

function _renderSingleThumb(pageNum) {
  if (_pdfThumbRendered.has(pageNum) || !_pdfDoc) return;
  _pdfThumbRendered.add(pageNum);

  _pdfDoc.getPage(pageNum).then(page => {
    const vp = page.getViewport({ scale: _pdfThumbScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'none';
    const ctx = canvas.getContext('2d');
    page.render({ canvasContext: ctx, viewport: vp }).promise.then(() => {
      if (!_pdfThumbContainer) return;
      const scroll = _pdfThumbContainer.querySelector('.pdf-thumb-scroll');
      if (!scroll) return;
      const item = scroll.querySelector(`.pdf-thumb-item[data-page="${pageNum}"]`);
      if (item) item.insertBefore(canvas, item.firstChild);
    });
  });
}

function _pdfThumbGoToPage(pageNum) {
  const target = document.getElementById(`pdf-page-${pageNum}`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _syncThumbHighlight() {
  if (!_pdfThumbStripVisible || !_pdfThumbContainer) return;
  if (_pdfThumbSyncRaf) cancelAnimationFrame(_pdfThumbSyncRaf);
  _pdfThumbSyncRaf = requestAnimationFrame(() => {
    const current = getCurrentPdfPage();
    if (current === _pdfThumbActivePage) return;
    _pdfThumbActivePage = current;

    const scroll = _pdfThumbContainer.querySelector('.pdf-thumb-scroll');
    if (!scroll) return;
    const prev = scroll.querySelector('.pdf-thumb-item.active');
    if (prev) prev.classList.remove('active');
    const active = scroll.querySelector(`.pdf-thumb-item[data-page="${current}"]`);
    if (active) {
      active.classList.add('active');
      // Auto-scroll thumbnail into view if needed
      const sr = scroll.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      if (ar.top < sr.top || ar.bottom > sr.bottom) {
        active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  });
}

function _pdfThumbKeyHandler(e, pageNum) {
  const scroll = _pdfThumbContainer?.querySelector('.pdf-thumb-scroll');
  if (!scroll) return;
  const items = scroll.querySelectorAll('.pdf-thumb-item');
  const idx = pageNum - 1;

  if (e.key === 'ArrowDown' && idx < items.length - 1) {
    e.preventDefault();
    items[idx + 1].focus();
  } else if (e.key === 'ArrowUp' && idx > 0) {
    e.preventDefault();
    items[idx - 1].focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    _pdfThumbGoToPage(pageNum);
  } else if (e.key === 'Home') {
    e.preventDefault();
    items[0].focus();
  } else if (e.key === 'End') {
    e.preventDefault();
    items[items.length - 1].focus();
  }
}

function _switchPdfLeftTab(tabId) {
  if (!_pdfThumbContainer) return;
  const tabs = _pdfThumbContainer.querySelectorAll('.pdf-left-panel-tab');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  const thumbScroll = _pdfThumbContainer.querySelector('.pdf-thumb-scroll');
  const outlineScroll = _pdfThumbContainer.querySelector('.pdf-outline-scroll');
  if (thumbScroll) thumbScroll.style.display = tabId === 'thumbs' ? '' : 'none';
  if (outlineScroll) outlineScroll.style.display = tabId === 'outline' ? '' : 'none';
  if (tabId === 'outline') _syncOutlineHighlight();
}

function _renderOutlinePanel(container) {
  if (!_pdfOutline || _pdfOutline.length === 0) {
    container.innerHTML = '<div class="pdf-outline-empty">No outline available</div>';
    return;
  }
  container.innerHTML = _buildTocTree(_pdfOutline, 0);
}

function _syncOutlineHighlight() {
  if (!_pdfThumbContainer) return;
  const outlineScroll = _pdfThumbContainer.querySelector('.pdf-outline-scroll');
  if (!outlineScroll || outlineScroll.style.display === 'none') return;
  const currentPage = getCurrentPdfPage();
  const items = outlineScroll.querySelectorAll('.pdf-toc-item');
  // Find the last TOC item whose page <= currentPage
  let bestItem = null;
  for (const item of items) {
    const dest = item.dataset.dest;
    if (!dest) continue;
    // We can't easily resolve dest to page synchronously, so highlight based on scroll position
    item.classList.remove('active');
  }
  // Simple approach: highlight first item for now (full dest resolution is async)
  // We'll do best-effort by marking items that have been clicked
  if (items.length > 0 && !outlineScroll.querySelector('.pdf-toc-item.active')) {
    items[0].classList.add('active');
  }
}

function dismissHighlightPopup() {
  if (_pdfPopup) {
    _pdfPopup.remove();
    _pdfPopup = null;
  }
  _pdfSavedRange = null;
  if (typeof _dismissPopupHandler === 'function') document.removeEventListener('mousedown', _dismissPopupHandler);
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

  // If highlight has saved chat, show chat popup instead
  if (hl.chat && hl.chat.length && typeof _showChatHighlightPopup === 'function') {
    _showChatHighlightPopup(e, hl);
    return;
  }

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
  // Highlight mode is always on — this is a no-op kept for pen mode compatibility
  _pdfHighlightMode = true;
  if (_pdfPagesContainer) {
    _pdfPagesContainer.classList.add('pdf-hl-mode');
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
  // Only handle if PDF viewer is active
  if (!_pdfPagesContainer) return;

  // Check if user is typing in an input/textarea
  const tag = e.target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

  // Thumbnail strip toggle
  if (e.key === 't' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    togglePdfThumbs();
    return;
  }
  // Fit-width toggle
  if (e.key === 'w' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    if (_pdfFitWidthMode) { _pdfFitWidthMode = false; pdfSetScale(1.0); } else { pdfFitWidth(); }
    return;
  }
  // Dark mode toggle
  if (e.key === 'd' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    togglePdfDarkMode();
    return;
  }
  // Spread toggle
  if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    togglePdfSpread();
    return;
  }
  // Outline tab (opens panel if closed, switches to outline)
  if (e.key === 'o' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    if (!_pdfThumbStripVisible) togglePdfThumbs();
    _switchPdfLeftTab('outline');
    return;
  }

  // Arrow key navigation for PDF pages
  if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    pdfScrollToPage(-1);
    return;
  }
  if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    pdfScrollToPage(1);
    return;
  }

  // Pen mode undo/redo
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

// ── Smart Highlights in PDF ──

async function renderSmartHighlightsInPdf(items) {
  clearSmartHighlightOverlays();
  _smartHighlights = items || [];
  if (!_smartHighlights.length || !_pdfPagesContainer || !_smartHighlightsVisible) return;

  await _ensureAllPagesRendered();

  const wrappers = _pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
  for (const item of _smartHighlights) {
    const queryNorm = _normalizeForSearch(item.text);
    if (queryNorm.length < 5) continue;
    const colors = SMART_HL_COLORS[item.category] || SMART_HL_COLORS.Claim;

    for (const wrapper of wrappers) {
      const pageIdx = _buildPageIndex(wrapper);
      if (!pageIdx) continue;

      let searchFrom = 0;
      while (true) {
        const idx = pageIdx.joined.indexOf(queryNorm, searchFrom);
        if (idx === -1) break;
        searchFrom = idx + 1;

        const matchChars = pageIdx.charMap.slice(idx, idx + queryNorm.length);
        const involvedSpans = new Set();
        matchChars.forEach(c => { if (c.span) involvedSpans.add(c.span); });

        const wrapperRect = wrapper.getBoundingClientRect();
        involvedSpans.forEach(span => {
          const rect = span.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return;
          const div = document.createElement('div');
          div.className = 'pdf-smart-highlight';
          div.style.left = (rect.left - wrapperRect.left) + 'px';
          div.style.top = (rect.top - wrapperRect.top) + 'px';
          div.style.width = rect.width + 'px';
          div.style.height = rect.height + 'px';
          div.style.background = colors.bg;
          div.style.borderBottom = '2px solid ' + colors.border;
          pageIdx.hlLayer.appendChild(div);
          _smartHighlightOverlays.push(div);
        });
        break; // only highlight first match per page
      }
    }
  }
}

function clearSmartHighlightOverlays() {
  _smartHighlightOverlays.forEach(el => el.remove());
  _smartHighlightOverlays = [];
}

function toggleSmartHighlightsVisibility() {
  _smartHighlightsVisible = !_smartHighlightsVisible;
  if (_smartHighlightsVisible) {
    renderSmartHighlightsInPdf(_smartHighlights);
  } else {
    clearSmartHighlightOverlays();
  }
  // Update toggle button
  const btn = document.getElementById('smart-hl-toggle');
  if (btn) btn.style.opacity = _smartHighlightsVisible ? '1' : '0.4';
}

function loadSmartHighlights(key) {
  try {
    const all = JSON.parse(localStorage.getItem('smartHighlights') || '{}');
    return all[key] || null;
  } catch { return null; }
}

function saveSmartHighlights(key, data) {
  try {
    const all = JSON.parse(localStorage.getItem('smartHighlights') || '{}');
    all[key] = data;
    localStorage.setItem('smartHighlights', JSON.stringify(all));
  } catch {}
}

// ── Cleanup ──

function cleanupPdfViewer() {
  if (_pdfObserver) { _pdfObserver.disconnect(); _pdfObserver = null; }
  if (_pdfThumbObserver) { _pdfThumbObserver.disconnect(); _pdfThumbObserver = null; }
  if (_pdfThumbSyncRaf) { cancelAnimationFrame(_pdfThumbSyncRaf); _pdfThumbSyncRaf = null; }
  if (_pdfResizeObserver) { _pdfResizeObserver.disconnect(); _pdfResizeObserver = null; }
  clearTimeout(_pdfFitWidthDebounce);
  if (_pdfDoc) { _pdfDoc.destroy(); _pdfDoc = null; }
  _pdfRenderedPages.clear();
  _pdfThumbRendered.clear();
  _pdfThumbStripVisible = false;
  _pdfThumbContainer = null;
  _pdfThumbActivePage = 0;
  _pdfTotalPages = 0;
  _pdfHighlights = [];
  _pdfArxivId = '';
  _pdfContainer = null;
  _pdfPagesContainer = null;
  _pdfHighlightMode = true;
  _pdfPenMode = false;
  _pdfEraserMode = false;
  _pdfDrawings = {};
  _pdfCurrentStroke = null;
  _pdfCurrentDrawCanvas = null;
  _pdfOutline = null;
  _pdfFitWidthMode = false;
  _pdfDarkRender = false;
  _pdfSpreadMode = false;
  clearSmartHighlightOverlays();
  _smartHighlights = [];
  _smartHighlightsVisible = true;
  pdfClearSearchHighlights();
  dismissHighlightPopup();
  dismissNotePopup();
  dismissCitationPopup();
  _citationCache = {};
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

function _pdfSearchHighlightCurrent(noScroll = false) {
  // Hide all matches, show only the current one
  _pdfSearchMatches.forEach(m => m.overlays.forEach(o => o.style.display = 'none'));
  if (_pdfSearchCurrentIdx >= 0 && _pdfSearchCurrentIdx < _pdfSearchMatches.length) {
    const m = _pdfSearchMatches[_pdfSearchCurrentIdx];
    m.overlays.forEach(o => { o.style.display = ''; o.style.background = 'rgba(255,160,0,0.45)'; });
    if (!noScroll && m.overlays[0]) m.overlays[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
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

async function pdfSearchHighlight(query, noScroll = false) {
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
    _pdfSearchHighlightCurrent(noScroll);
  } else {
    _pdfSearchUpdateCounter();
  }
}

// ── PDF annotation (internal link) click handler ──
function _pdfLinkIcon(url) {
  if (url.includes('github.com') || url.includes('github.io'))
    return '<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>';
  if (url.includes('huggingface.co'))
    return '<span class="text-[0.8rem] shrink-0 leading-none">&#129303;</span>';
  if (url.includes('arxiv.org'))
    return '<img src="/arxiv-logomark-small@2x.png" class="w-3.5 h-3.5 shrink-0 object-contain" alt="arXiv">';
  return '<svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function _renderPdfLinks() {
  const el = document.getElementById('pdf-links-section');
  if (!el) return;
  if (_pdfExtractedLinks.size === 0) { el.innerHTML = ''; return; }
  const links = [..._pdfExtractedLinks].sort();
  let html = '<div class="text-[0.72rem] font-semibold text-dim uppercase tracking-wide mb-1.5">Links</div>';
  html += '<div class="flex flex-wrap gap-1.5 mb-3">';
  for (const url of links) {
    const label = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const icon = _pdfLinkIcon(url);
    // Click-only: opens in Internet Browser
    html += `<button class="pdf-sidebar-link inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[0.74rem] text-primary bg-transparent border-none cursor-pointer hover:bg-accent/10 transition-colors text-left" data-url="${escapeHtml(url)}" title="${escapeHtml(url)}">${icon}<span class="truncate max-w-[200px]">${escapeHtml(label)}</span></button>`;
  }
  html += '</div>';
  el.innerHTML = html;
  // Attach click handlers to open in browser
  el.querySelectorAll('.pdf-sidebar-link').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof openInBrowser === 'function') openInBrowser(btn.dataset.url);
    });
  });
}

// ── Citation Hover Popup ──
let _citationCache = {}; // Cache looked up citations

function dismissCitationPopup() {
  // Remove the lookup popup if present
  document.getElementById('doc-chat-ask-float')?.remove();
}

function showCitationPopup(refNum, anchorEl) {
  dismissCitationPopup();
  _showReferencePopup(refNum, anchorEl);
}

// Extract reference text from a block of text using common citation patterns.
// Shared by findReferenceText (sync, from text layers) and _findReferenceTextAsync (async, from PDF pages).
function _extractRefFromText(refNum, text) {
  const patterns = [
    new RegExp(`\\[\\s*${refNum}\\s*\\]\\s*([^\\[\\]]{10,300})`, 'i'),
    new RegExp(`(?:^|\\s)${refNum}\\.\\s*([^\\n]{10,300})`, 'm'),
    new RegExp(`\\(\\s*${refNum}\\s*\\)\\s*([^\\(\\)]{10,300})`, 'i'),
    new RegExp(`(?:^|\\s)${refNum}\\s+([A-Z][a-z]+[^\\d]{10,200})`, 'm'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let refText = match[1].trim();
      const titleMatch = refText.match(/"([^"]+)"|\u201C([^\u201D]+)\u201D|'([^']+)'/);
      if (titleMatch) return titleMatch[1] || titleMatch[2] || titleMatch[3];
      return refText.slice(0, 100).replace(/\s+/g, ' ');
    }
  }
  return null;
}

// Global fallback: search all collected text for reference patterns
function _extractRefGlobal(refNum, allText) {
  const globalPatterns = [
    new RegExp(`\\[\\s*${refNum}\\s*\\]\\s*([A-Z][^\\[\\]]{10,200})`, 'g'),
    new RegExp(`(?:^|\\n)\\s*${refNum}\\.\\s*([A-Z][^\\n]{10,200})`, 'gm'),
  ];
  for (const pattern of globalPatterns) {
    const matches = [...allText.matchAll(pattern)];
    if (matches.length > 0) {
      return matches[matches.length - 1][1].trim().slice(0, 100).replace(/\s+/g, ' ');
    }
  }
  return null;
}

function findReferenceText(refNum) {
  if (!_pdfPagesContainer) return null;

  const textLayers = _pdfPagesContainer.querySelectorAll('.textLayer');
  let inReferences = false;
  let allText = '';

  for (const layer of textLayers) {
    const text = layer.textContent || '';
    allText += text + '\n';

    if (/references|bibliography/i.test(text)) inReferences = true;

    if (inReferences) {
      const result = _extractRefFromText(refNum, text);
      if (result) return result;
    }
  }

  return _extractRefGlobal(refNum, allText);
}

function setupCitationHovers(textLayerDiv) {
  // Find citation patterns in the text layer spans and mark them
  // PDF.js often splits citations so "[13]" becomes "[" + "13" + "]" in separate spans
  const spans = Array.from(textLayerDiv.querySelectorAll('span'));

  const markAsCitation = (span, num) => {
    if (span.classList.contains('pdf-citation-ref')) return;
    span.classList.add('pdf-citation-ref');
    span.dataset.refNum = num;
    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCitationPopup(num, span);
    });
  };

  spans.forEach((span, i) => {
    const text = span.textContent.trim();

    // Standalone number (1-3 digits) — PDF.js splits "[13]" into "[" + "13" + "]"
    if (/^\d{1,3}$/.test(text)) {
      markAsCitation(span, text);
      return;
    }

    // [number] kept together
    const bracketMatch = text.match(/^\[(\d{1,3})\]$/);
    if (bracketMatch) {
      markAsCitation(span, bracketMatch[1]);
      return;
    }

    // Number with comma/bracket: "35," or "35]" or ",35" or "[35" — common in citation lists like [35, 2, 5]
    const commaMatch = text.match(/^[,\s\[\]]*(\d{1,3})[,\s\[\]]*$/);
    if (commaMatch && text.length <= 6) {
      markAsCitation(span, commaMatch[1]);
      return;
    }

    // Span contains [number] somewhere (e.g. "[35]." or "text [7]")
    const inlineMatch = text.match(/\[(\d{1,3})\]/);
    if (inlineMatch && text.length <= 12) {
      markAsCitation(span, inlineMatch[1]);
      return;
    }
  });
}

// Smart handler for annotation clicks - shows citation popup if it's a citation, otherwise navigates
function _onSmartAnnotClick(e, link, textLayerDiv) {
  e.preventDefault();
  e.stopPropagation();

  // Find any citation pattern at this link's position
  const linkRect = link.getBoundingClientRect();

  // First check pre-marked citation spans
  const citationSpans = textLayerDiv.querySelectorAll('.pdf-citation-ref');
  for (const span of citationSpans) {
    const spanRect = span.getBoundingClientRect();
    // Check if link overlaps with this citation span (with some tolerance)
    const tolerance = 5;
    if (linkRect.left - tolerance < spanRect.right && linkRect.right + tolerance > spanRect.left &&
        linkRect.top - tolerance < spanRect.bottom && linkRect.bottom + tolerance > spanRect.top) {
      if (span.dataset.refNum) {
        link.classList.add('pdf-citation-link');
        showCitationPopup(span.dataset.refNum, link);
        return;
      }
    }
  }

  // Fallback: check all spans at this position for citation pattern
  const allSpans = textLayerDiv.querySelectorAll('span');
  for (const span of allSpans) {
    const spanRect = span.getBoundingClientRect();
    const tolerance = 5;
    // Check if link overlaps with this span
    if (linkRect.left - tolerance < spanRect.right && linkRect.right + tolerance > spanRect.left &&
        linkRect.top - tolerance < spanRect.bottom && linkRect.bottom + tolerance > spanRect.top) {
      const text = span.textContent.trim();

      // Check for standalone number (PDF.js splits "[13]" into "[" + "13" + "]")
      if (/^\d{1,3}$/.test(text)) {
        link.classList.add('pdf-citation-link');
        showCitationPopup(text, link);
        return;
      }

      // Also check for [number] pattern
      const match = text.match(/\[(\d+)\]/);
      if (match) {
        link.classList.add('pdf-citation-link');
        showCitationPopup(match[1], link);
        return;
      }
    }
  }

  // Last resort: use document.elementsFromPoint to find text at click position
  const clickX = e.clientX;
  const clickY = e.clientY;
  const elements = document.elementsFromPoint(clickX, clickY);
  for (const el of elements) {
    if (el.tagName === 'SPAN' && el.closest('.textLayer')) {
      // PDF.js splits text - citation number might be in its own span (just "13" not "[13]")
      const text = el.textContent.trim();

      // Check if this span contains just a number (1-3 digits) - likely a citation
      if (/^\d{1,3}$/.test(text)) {
        link.classList.add('pdf-citation-link');
        showCitationPopup(text, link);
        return;
      }

      // Also check for [number] pattern in case some PDFs keep it together
      const match = text.match(/\[(\d+)\]/);
      if (match) {
        link.classList.add('pdf-citation-link');
        showCitationPopup(match[1], link);
        return;
      }
    }
  }

  // Not a citation - navigate normally
  _navigateToPdfDest(link.dataset.dest);
}

// Navigate to a PDF destination (used by annotation clicks)
function _navigateToPdfDest(destRaw) {
  if (!destRaw || !_pdfDoc) return;
  let dest;
  try { dest = JSON.parse(destRaw); } catch { dest = destRaw; }
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

// ── Table of Contents ──

function _buildTocTree(items, depth) {
  if (!items || items.length === 0) return '';
  let html = '';
  for (const item of items) {
    const dest = item.dest;
    const destAttr = dest ? ` data-dest="${typeof dest === 'string' ? dest : JSON.stringify(dest).replace(/"/g, '&quot;')}"` : '';
    const indent = depth * 12;
    html += `<div class="pdf-toc-item" style="padding-left:${indent}px;" ${destAttr} onclick="_onTocItemClick(this)">
      <span class="text-[0.78rem] ${depth === 0 ? 'text-primary font-medium' : 'text-muted'} cursor-pointer hover:text-accent transition-colors leading-relaxed">${item.title}</span>
    </div>`;
    if (item.items && item.items.length > 0) {
      html += _buildTocTree(item.items, depth + 1);
    }
  }
  return html;
}

function _onTocItemClick(el) {
  const dest = el.dataset.dest;
  if (dest) _navigateToPdfDest(dest);
}

