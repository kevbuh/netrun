// browse-pdf-viewer.js — PDF.js renderer for Nerd Mode
// Renders PDF pages with canvas + textLayer, toolbar, thumbnails, TOC, highlights, search
// Depends on: browse-state.js

import { icon } from '/js/core/icons.js';
import { toast } from '/js/core/core-utils.js';
import { _paperState } from '/js/browse/browse-paper.js';
import { _generateCiteFormats } from '/js/browse/browse-nerd-panel.js';
import { togglePanel } from '/js/core/core-nav.js';
import { _buildFilesContent } from '/js/browse/browse-nerd-mode.js';

// ── Canvas pool + bitmap cache for smooth rendering ──
var _canvasPool = [];
var _CANVAS_POOL_MAX = 20;
var _bitmapCache = new Map(); // key: "pageNum-scale", value: ImageBitmap
var _BITMAP_CACHE_MAX = 60;

function _acquireCanvas(w, h, dpr) {
  var canvas = _canvasPool.pop();
  if (!canvas) canvas = document.createElement('canvas');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas: canvas, ctx: ctx };
}

function _releaseCanvas(canvas) {
  if (_canvasPool.length < _CANVAS_POOL_MAX) {
    _canvasPool.push(canvas);
  }
}

export function _pdfApplyDarkBg(dark) {
  if (dark) {
    document.documentElement.style.setProperty('--nr-bg-body', '#1a1a1a');
  } else {
    // Remove inline override so the CSS theme value takes effect
    document.documentElement.style.removeProperty('--nr-bg-body');
  }
}

// ── PDF.js CDN loader ──
let _pdfjsLoaded = false;
let _pdfjsLoadPromise = null;

// PDF.js legacy global build (CDN)
function _ensurePdfjsLegacy() {
  if (_pdfjsLoaded && window.pdfjsLib) return Promise.resolve();
  if (_pdfjsLoadPromise) return _pdfjsLoadPromise;
  _pdfjsLoadPromise = new Promise(function(resolve, reject) {
    if (window.pdfjsLib) { _pdfjsLoaded = true; resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = function() {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        _pdfjsLoaded = true;
        resolve();
      } else {
        reject(new Error('pdfjsLib not available'));
      }
    };
    script.onerror = function() { reject(new Error('Failed to load PDF.js')); };
    document.head.appendChild(script);

    if (!document.querySelector('link[href*="pdf_viewer"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf_viewer.min.css';
      document.head.appendChild(link);
    }
  });
  return _pdfjsLoadPromise;
}

// ── Constants ──
const _PDF_SCALE_DEFAULT = 1.5;
const _PDF_SCALE_MIN = 0.5;
const _PDF_SCALE_MAX = 4.0;
export var _PDF_HL_COLORS = [
  { name: 'yellow', color: 'rgba(255,235,59,0.4)' },
  { name: 'green', color: 'rgba(76,175,80,0.4)' },
  { name: 'blue', color: 'rgba(66,165,245,0.4)' },
  { name: 'pink', color: 'rgba(236,64,122,0.4)' },
  { name: 'orange', color: 'rgba(255,152,0,0.4)' },
];

// ── ID helper ──

function _hlId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Init ──

export function _pdfViewerInit(tab, viewerEl, pdfUrl) {
  tab._pdfCurrentPage = tab._pdfCurrentPage || 1;
  tab._pdfZoom = tab._pdfZoom || _PDF_SCALE_DEFAULT;
  tab._pdfHighlights = tab._pdfHighlights || [];
  if (tab._pdfDarkMode == null) {
    // Always derive from current app theme — don't persist across sessions
    const theme = document.documentElement.getAttribute('data-theme');
    tab._pdfDarkMode = !theme || theme === 'dark';
  }
  tab._pdfLeftPanelVisible = tab._pdfLeftPanelVisible != null ? tab._pdfLeftPanelVisible : false;
  tab._pdfRenderedPages = new Map();
  tab._pdfUrl = pdfUrl;

  _buildViewerDOM(tab, viewerEl);

  // Install text selection → highlight handler
  _pdfViewerInstallHighlightHandler(tab);

  // Load persisted highlights from DB
  if (window.electronAPI && window.electronAPI.dbQuery) {
    window.electronAPI.dbQuery('highlights-list', pdfUrl).then(function(rows) {
      if (!rows || !rows.length) return;
      rows.forEach(function(row) {
        const exists = tab._pdfHighlights.some(function(h) { return h.id === row.id; });
        if (exists) return;
        tab._pdfHighlights.push({
          id: row.id,
          text: row.text,
          pageNum: row.page_num,
          rects: JSON.parse(row.rects_json),
          color: row.color,
          note: row.note,
          ts: row.created_at * 1000
        });
      });
      // Re-render highlights on already-rendered pages
      if (tab._pdfRenderedPages && tab._pdfPageWrappers) {
        tab._pdfRenderedPages.forEach(function(_, pageNum) {
          const wrapper = tab._pdfPageWrappers[pageNum];
          if (!wrapper) return;
          const hlLayer = wrapper.querySelector('.pdf-highlight-layer');
          if (hlLayer) {
            hlLayer.innerHTML = '';
            _pdfViewerRenderHighlightsForPage(tab, pageNum, hlLayer);
          }
        });
      }
      // Refresh files panel so highlights appear in sidebar
      if (typeof window._refreshFilesContent === 'function') window._refreshFilesContent();
    });
  }

  _ensurePdfjsLegacy().then(function() {
    _pdfViewerLoadDoc(tab, pdfUrl);
  }).catch(function(err) {
    const msg = tab._pdfPagesContainer;
    if (msg) {
      AetherUI.mount(
        new View('div')
          .styles({ padding: '40px', color: 'var(--nr-text-secondary)', textAlign: 'center' })
          .text('Failed to load PDF.js: ' + err.message),
        msg
      );
    }
  });
}

export function _pdfViewerDestroy(tab) {
  // Save scroll position before destroying
  if (tab._pdfPagesContainer) {
    tab._pdfScrollTop = tab._pdfPagesContainer.scrollTop;
  }
  if (tab._pdfDoc) {
    tab._pdfDoc.destroy();
    tab._pdfDoc = null;
  }
  tab._pdfRenderedPages = null;
  tab._pdfPageWrappers = null;
  tab._pdfThumbItems = null;
  tab._pdfTextIndex = null;
  tab._pdfTextIndexPromise = null;
  tab._pdfSearchMatches = null;
  if (_searchBar && _searchBar.parentNode) { _searchBar.remove(); _searchBar = null; }
  if (tab._pdfThumbObserver) { tab._pdfThumbObserver.disconnect(); tab._pdfThumbObserver = null; }
  if (tab._pdfPageObserver) { tab._pdfPageObserver.disconnect(); tab._pdfPageObserver = null; }
  _bitmapCache.forEach(function(bmp) { bmp.close(); });
  _bitmapCache.clear();
  // Preserve _pdfCurrentPage, _pdfZoom, _pdfDarkMode, _pdfLeftPanelVisible for re-init
}

// ── DOM Structure ──

function _buildViewerDOM(tab, viewerEl) {
  viewerEl.innerHTML = '';

  // Toolbar
  const toolbarView = new View('div').className('pdf-toolbar');
  viewerEl.appendChild(toolbarView.el);
  tab._pdfToolbar = toolbarView.el;
  _buildToolbar(tab, toolbarView);

  // Body wrapper (left panel + pages)
  const bodyWrapper = new View('div').className('pdf-body-wrapper');
  viewerEl.appendChild(bodyWrapper.el);

  // Left panel
  const leftPanelView = new View('div').className('pdf-left-panel');
  bodyWrapper.add(leftPanelView);
  tab._pdfLeftPanel = leftPanelView.el;
  _buildLeftPanel(tab, leftPanelView);

  // Drag handle for resizing left panel
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'pdf-left-panel-resize';
  bodyWrapper.el.insertBefore(resizeHandle, leftPanelView.el.nextSibling);
  resizeHandle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const panel = leftPanelView.el;
    const startX = e.clientX;
    const startW = panel.offsetWidth;
    function onMove(ev) {
      const w = Math.max(100, Math.min(500, startW + ev.clientX - startX));
      panel.style.width = w + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Pages container
  const pagesContainer = new View('div').className('pdf-pages-container');
  if (window.Skeleton) {
    AetherUI.mount(window.Skeleton().lines(5).padding(4), pagesContainer.el);
  } else {
    AetherUI.mount(
      new View('div')
        .styles({ padding: '40px', color: 'var(--nr-text-secondary)', textAlign: 'center' })
        .text('Loading PDF...'),
      pagesContainer.el
    );
  }
  bodyWrapper.add(pagesContainer);
  tab._pdfPagesContainer = pagesContainer.el;

  // Restore dark mode state
  if (tab._pdfDarkMode) {
    pagesContainer.el.classList.add('pdf-dark-render');
    leftPanelView.el.classList.add('pdf-dark-render');
  }

  // Restore left panel visibility
  if (tab._pdfLeftPanelVisible === false) {
    leftPanelView.el.style.display = 'none';
  }

  // Scroll listener for page tracking (rAF-throttled)
  let scrollRaf = 0;
  pagesContainer.on('scroll', function() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function() {
      scrollRaf = 0;
      _pdfViewerOnScroll(tab);
    });
  });

  // Arrow key page navigation — always flip unless there's a horizontal scrollbar
  pagesContainer.el.setAttribute('tabindex', '0');
  pagesContainer.el.style.outline = 'none';
  pagesContainer.el.addEventListener('keydown', function(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // Only skip if there's horizontal overflow (arrows needed for scrolling)
    const container = tab._pdfPagesContainer;
    if (container.scrollWidth > container.clientWidth) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft') {
      _pdfViewerGoToPage(tab, tab._pdfCurrentPage - 1);
    } else {
      _pdfViewerGoToPage(tab, tab._pdfCurrentPage + 1);
    }
  });

  // Pinch-to-zoom: use CSS transform for instant feedback, debounce canvas re-render
  let zoomCommitTimer = null;
  let zoomBaseScale = null; // the scale at which canvases were last rendered
  let zoomCachedHeights = null; // cached offsetHeights to avoid reflow during gesture
  let zoomRaf = 0;
  let zoomPendingNewZoom = 0;

  function _pdfViewerPreviewZoom(tab, newZoom) {
    tab._pdfFitMode = null;
    zoomPendingNewZoom = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, newZoom));
    if (zoomRaf) return; // already scheduled
    zoomRaf = requestAnimationFrame(function() {
      zoomRaf = 0;
      _pdfViewerApplyZoomPreview(tab, zoomPendingNewZoom);
    });
  }

  function _pdfViewerApplyZoomPreview(tab, newZoom) {
    // Capture the rendered scale + heights before first zoom tick
    if (zoomBaseScale === null) {
      zoomBaseScale = tab._pdfZoom;
      // Cache all wrapper heights in one read pass (single reflow)
      zoomCachedHeights = [];
      const wrappers = tab._pdfPageWrappers || [];
      for (let i = 1; i <= tab._pdfPageCount; i++) {
        zoomCachedHeights[i] = wrappers[i] ? wrappers[i].offsetHeight : 0;
      }
      // Promote visible pages to GPU layers for the gesture duration
      const container = tab._pdfPagesContainer;
      const scrollTop = container.scrollTop;
      const viewH = container.clientHeight;
      for (let i = 1; i <= tab._pdfPageCount; i++) {
        const w = wrappers[i];
        if (!w) continue;
        const top = w.offsetTop;
        if (top > scrollTop + viewH * 3) break;
        if (top + zoomCachedHeights[i] >= scrollTop - viewH * 2) {
          w.style.willChange = 'transform';
        }
      }
    }
    tab._pdfZoom = newZoom;
    tab._pdfZoomLabel.textContent = Math.round(newZoom * 100) + '%';
    const ratio = newZoom / zoomBaseScale;

    // Only transform visible pages (± 2 screens), use cached heights
    const container = tab._pdfPagesContainer;
    const scrollTop = container.scrollTop;
    const viewH = container.clientHeight;
    const wrappers = tab._pdfPageWrappers || [];
    for (let i = 1; i <= tab._pdfPageCount; i++) {
      const w = wrappers[i];
      if (!w) continue;
      const top = w.offsetTop;
      if (top > scrollTop + viewH * 3) break;
      if (top + (zoomCachedHeights[i] || 400) < scrollTop - viewH * 2) continue;
      w.style.transform = 'scale(' + ratio + ')';
      w.style.transformOrigin = 'top center';
      w.style.marginBottom = (zoomCachedHeights[i] * (ratio - 1)) + 'px';
    }
    // Debounce the full re-render
    clearTimeout(zoomCommitTimer);
    zoomCommitTimer = setTimeout(function() {
      _pdfViewerCommitZoom(tab);
      zoomBaseScale = null;
      zoomCachedHeights = null;
    }, 200);
  }

  function _pdfViewerCommitZoom(tab) {
    // Clear will-change hints
    const wrappers = tab._pdfPageWrappers || [];
    for (let i = 1; i <= tab._pdfPageCount; i++) {
      if (wrappers[i]) wrappers[i].style.willChange = '';
    }
    // Don't clear transforms or content here — let per-page re-render swap them
    // to avoid all pages blinking blank simultaneously
    tab._pdfRenderedPages = new Map();
    // Reinstall observer so it re-fires for visible pages at the new zoom
    _pdfViewerInstallObserver(tab);
    _pdfViewerOnScroll(tab);
  }

  // Chrome/Firefox trackpad pinch fires wheel with ctrlKey
  pagesContainer.el.addEventListener('wheel', function(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.01;
    _pdfViewerPreviewZoom(tab, tab._pdfZoom + delta);
  }, { passive: false });

  // Safari native gesture events
  let gestureBaseZoom = 1;
  pagesContainer.el.addEventListener('gesturestart', function(e) {
    e.preventDefault();
    gestureBaseZoom = tab._pdfZoom;
  }, { passive: false });
  pagesContainer.el.addEventListener('gesturechange', function(e) {
    e.preventDefault();
    _pdfViewerPreviewZoom(tab, gestureBaseZoom * e.scale);
  }, { passive: false });
  pagesContainer.el.addEventListener('gestureend', function(e) {
    e.preventDefault();
  }, { passive: false });
}

function _buildToolbar(tab, toolbarView) {
  // Page nav (panel toggles moved to right side)

  // Page nav
  const prevBtn = _tbBtn(icon('chevronLeft', { size: 16 }), 'Previous page', function() {
    _pdfViewerGoToPage(tab, tab._pdfCurrentPage - 1);
  });
  toolbarView.add(prevBtn);

  const pageIndicator = new View('span')
    .className('pdf-page-indicator')
    .text('1 / ?');
  toolbarView.add(pageIndicator);
  tab._pdfPageIndicator = pageIndicator.el;

  const nextBtn = _tbBtn(icon('chevronRight', { size: 16 }), 'Next page', function() {
    _pdfViewerGoToPage(tab, tab._pdfCurrentPage + 1);
  });
  toolbarView.add(nextBtn);

  toolbarView.add(_tbSep());

  // Zoom
  const zoomOut = _tbBtn(icon('minus', { size: 16 }), 'Zoom out', function() {
    tab._pdfFitMode = null;
    _pdfViewerSetZoom(tab, tab._pdfZoom - 0.25);
  });
  toolbarView.add(zoomOut);

  var zoomLabel = new View('button')
    .className('pdf-zoom-label')
    .text(Math.round(tab._pdfZoom * 100) + '%')
    .attr('title', 'Zoom')
    .onTap(function() { _pdfViewerToggleZoomDropdown(tab, zoomLabel.el); });
  toolbarView.add(zoomLabel);
  tab._pdfZoomLabel = zoomLabel.el;

  const zoomIn = _tbBtn(icon('plus', { size: 16 }), 'Zoom in', function() {
    tab._pdfFitMode = null;
    _pdfViewerSetZoom(tab, tab._pdfZoom + 0.25);
  });
  toolbarView.add(zoomIn);

  toolbarView.add(_tbSep());

  // Dark mode toggle
  var darkToggle = _tbBtn(icon('moon', { size: 16 }), 'Dark mode', function() {
    tab._pdfDarkMode = !tab._pdfDarkMode;
    tab._pdfPagesContainer.classList.toggle('pdf-dark-render', tab._pdfDarkMode);
    if (tab._pdfLeftPanel) tab._pdfLeftPanel.classList.toggle('pdf-dark-render', tab._pdfDarkMode);
    darkToggle.el.classList.toggle('active', tab._pdfDarkMode);
    _pdfApplyDarkBg(tab._pdfDarkMode);
  });
  if (tab._pdfDarkMode) darkToggle.el.classList.add('active');
  toolbarView.add(darkToggle);

  // Highlight mode toggle
  var hlToggle = _tbBtn(icon('highlighter', { size: 16 }), 'Highlight mode', function() {
    const active = tab._pdfPagesContainer.classList.toggle('pdf-hl-mode');
    hlToggle.el.classList.toggle('active', active);
  });
  hlToggle.el.id = 'pdf-hl-mode-toggle';
  toolbarView.add(hlToggle);

  // Bookmark button
  const bookmarkBtn = _tbBtn(icon('bookmark', { size: 16 }), 'Save to Reading List', function() {
    if (typeof window.browseSaveToReadingList === 'function') window.browseSaveToReadingList();
  });
  toolbarView.add(bookmarkBtn);

  // TTS — Read aloud
  var ttsBtn = _tbBtn(icon('speaker', { size: 16 }), 'Read aloud', function() {
    if (window._ttsAudio || (window._ttsChunks && window._ttsChunks.length > 0)) {
      if (typeof window._ttsStopAll === 'function') window._ttsStopAll();
      ttsBtn.el.classList.remove('active');
      return;
    }
    _pdfViewerGetText(tab).then(function(text) {
      if (!text || text.length < 10) return;
      window._ttsTabId = tab.id;
      window._ttsStopped = false;
      window._ttsPaused = false;
      window._ttsChunks = window._ttsChunkText ? window._ttsChunkText(text) : [text];
      window._ttsChunkIdx = 0;
      window._ttsPlayedDurations = [];
      window._ttsRemainingDurations = [];
      window._ttsQueue = [];
      if (typeof window._ttsFetchAndQueue === 'function') window._ttsFetchAndQueue();
      ttsBtn.el.classList.add('active');
    });
  });
  ttsBtn.el.id = 'pdf-tts-btn';
  toolbarView.add(ttsBtn);

  // Cite — copy citation in chosen format
  let _citeMenu = null;
  var citeBtn = _tbBtn(icon('blockquote', { size: 16 }), 'Cite', function() {
    if (_citeMenu && _citeMenu.isOpen.value) { _citeMenu.dismiss(); return; }
    const state = _paperState.get(tab.id);
    const s2 = state && state.s2Data;
    if (!s2) {
      toast('No paper data available');
      return;
    }
    const formats = _generateCiteFormats(s2);
    const items = [];
    items.push({ view: function() {
      return Text('Cite').cssText('padding:8px 12px 4px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--nr-text-secondary);');
    }});
    Object.keys(formats).forEach(function(fmt) {
      items.push({ view: function() {
        const row = new View('div')
          .cssText('display:flex;gap:10px;padding:8px 12px;border-radius:6px;align-items:baseline;');
        row.add(
          Text(fmt).cssText('font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--nr-accent);white-space:nowrap;min-width:70px;'),
          Text(formats[fmt]).cssText('font-size:0.75rem;color:var(--nr-text-primary);line-height:1.45;word-break:break-word;flex:1;')
        );
        const copyBtn = new View('button')
          .text('Copy')
          .cssText('flex-shrink:0;padding:2px 8px;font-size:0.68rem;border:1px solid var(--nr-border-default);border-radius:4px;background:transparent;color:var(--nr-text-secondary);cursor:pointer;transition:all 0.15s;');
        copyBtn.el.addEventListener('mouseenter', function() { copyBtn.el.style.background = 'var(--nr-bg-raised)'; });
        copyBtn.el.addEventListener('mouseleave', function() { copyBtn.el.style.background = ''; });
        copyBtn.el.addEventListener('click', function(e) {
          e.stopPropagation();
          if (window.electronAPI && electronAPI.clipboardWriteText) electronAPI.clipboardWriteText(formats[fmt]);
          else navigator.clipboard.writeText(formats[fmt]).catch(function() {});
          copyBtn.el.textContent = 'Copied';
          setTimeout(function() { copyBtn.el.textContent = 'Copy'; }, 1500);
        });
        row.add(copyBtn);
        return row;
      }});
    });
    _citeMenu = Menu(null, items);
    const rect = citeBtn.el.getBoundingClientRect();
    _citeMenu.showAt(rect.left, rect.bottom + 4);
  });
  toolbarView.add(citeBtn);

  // Auto-resume most recent session when entering nerd mode
  if (!tab._implSessionId && window.electronAPI && window.electronAPI.implList) {
    electronAPI.implList({ paperUrl: tab.url }).then(function(sessions) {
      if (!sessions || sessions.error || !sessions.length) return;
      const recent = sessions[0];
      if (window._implSessionEnable) window._implSessionEnable(tab, recent.id);
    });
  }

  // Spacer
  const spacer = new View('div').style('flex', '1');
  toolbarView.add(spacer);

  // Search
  const searchBtn = _tbBtn(icon('search', { size: 16 }), 'Search in PDF', function() {
    _pdfViewerToggleSearch(tab);
  });
  toolbarView.add(searchBtn);

  toolbarView.add(_tbSep());

  // Panel toggle button group
  const panelGroup = new View('div').className('pdf-panel-toggle-group');

  var leftPanelBtn = _tbBtn(icon('panelLeft', { size: 16 }), 'Toggle thumbnails', function() {
    tab._pdfLeftPanelVisible = !tab._pdfLeftPanelVisible;
    tab._pdfLeftPanel.style.display = tab._pdfLeftPanelVisible ? '' : 'none';
    leftPanelBtn.el.classList.toggle('active', tab._pdfLeftPanelVisible);
  });
  if (tab._pdfLeftPanelVisible) leftPanelBtn.el.classList.add('active');
  panelGroup.add(leftPanelBtn);

  var rightPanelBtn = _tbBtn(icon('panelRight', { size: 16 }), 'Toggle lookup panel', function() {
    togglePanel();
    // Update active state after toggle
    setTimeout(function() {
      const panelEl = document.getElementById('universal-panel');
      const visible = panelEl && panelEl.style.display !== 'none' && !panelEl.classList.contains('panel-hidden');
      rightPanelBtn.el.classList.toggle('active', visible);
    }, 50);
  });
  rightPanelBtn.el.classList.add('active');
  panelGroup.add(rightPanelBtn);

  toolbarView.add(panelGroup);
}

function _tbBtn(svgHtml, title, onClick) {
  return new View('button')
    .className('pdf-tb-btn')
    .attr('title', title)
    .add(RawHTML(svgHtml))
    .onTap(onClick);
}

function _tbSep() {
  return new View('div').className('pdf-tb-sep');
}

// ── Left Panel ──

function _buildLeftPanel(tab, leftPanelView) {
  // Tab bar
  const tabBar = new View('div').className('pdf-left-panel-tabs');

  const hasImpl = !!(tab._implSessionId && tab._implFolderPath);

  const filesScroll = new View('div').className('pdf-thumb-scroll nerd-files-scroll');
  const thumbScroll = new View('div').className('pdf-thumb-scroll');
  const outlineScroll = new View('div').className('pdf-outline-scroll').style('display', 'none');

  tab._pdfFilesScroll = filesScroll.el;
  tab._pdfThumbScroll = thumbScroll.el;
  tab._pdfOutlineScroll = outlineScroll.el;

  let tabBtns = [];
  let scrolls, tabOffset;

  const filesTab = new View('button').className('pdf-left-panel-tab').text('Files')
    .onTap(function() { selectLeftTab(0); });
  const thumbTab = new View('button').className('pdf-left-panel-tab').text('Thumbs')
    .onTap(function() { selectLeftTab(hasImpl ? 1 : 0); });
  const outlineTab = new View('button').className('pdf-left-panel-tab').text('Outline')
    .onTap(function() { selectLeftTab(hasImpl ? 2 : 1); });

  if (hasImpl) {
    filesScroll.style('display', 'none');
    thumbScroll.style('display', 'none');
    tabBtns = [filesTab, thumbTab, outlineTab];
    scrolls = [filesScroll.el, thumbScroll.el, outlineScroll.el];
    tabBar.add(filesTab, thumbTab, outlineTab);
  } else {
    tabBtns = [thumbTab, outlineTab];
    scrolls = [thumbScroll.el, outlineScroll.el];
    tabBar.add(thumbTab, outlineTab);
  }
  leftPanelView.add(tabBar);

  function selectLeftTab(idx) {
    for (let i = 0; i < scrolls.length; i++) {
      scrolls[i].style.display = i === idx ? '' : 'none';
      tabBtns[i].el.classList.toggle('active', i === idx);
    }
    if (hasImpl && idx === 0) _buildFilesContent(filesScroll.el);
  }

  // Content area
  const content = new View('div').className('pdf-left-panel-content');
  if (hasImpl) content.add(filesScroll);
  content.add(thumbScroll, outlineScroll);
  leftPanelView.add(content);

  // Default to Thumbs tab
  selectLeftTab(0);
}

// ── Load Document ──

function _pdfViewerLoadDoc(tab, url) {
  const loadingTask = window.pdfjsLib.getDocument(url);
  loadingTask.promise.then(function(pdfDoc) {
    tab._pdfDoc = pdfDoc;
    tab._pdfPageCount = pdfDoc.numPages;
    tab._pdfPageIndicator.textContent = '1 / ' + pdfDoc.numPages;
    tab._pdfPagesContainer.innerHTML = '';

    // Render visible pages
    _pdfViewerRenderAllPages(tab);

    // Render thumbnails
    _pdfViewerRenderThumbnails(tab);

    // Extract outline
    _pdfViewerExtractOutline(tab);

    // Restore scroll position after pages render
    if (tab._pdfScrollTop) {
      setTimeout(function() {
        if (tab._pdfPagesContainer) {
          tab._pdfPagesContainer.scrollTop = tab._pdfScrollTop;
        }
      }, 200);
    }

  }).catch(function(err) {
    if (tab._pdfPagesContainer) {
      AetherUI.mount(
        new View('div')
          .styles({ padding: '40px', color: 'var(--nr-text-secondary)', textAlign: 'center' })
          .text('Failed to load PDF: ' + (err.message || err)),
        tab._pdfPagesContainer
      );
    }
  });
}

// ── Render All Pages ──

function _pdfViewerRenderAllPages(tab) {
  if (!tab._pdfDoc) return;
  // Get first page dimensions to set accurate placeholder heights (avoids scroll jumps)
  tab._pdfDoc.getPage(1).then(function(firstPage) {
    const vp = firstPage.getViewport({ scale: tab._pdfZoom });
    const slotHeight = Math.round(vp.height);
    const slotWidth = Math.round(vp.width);
    tab._pdfSlotHeight = slotHeight; // cached for scroll estimation (avoids reflow)
    for (let i = 1; i <= tab._pdfPageCount; i++) {
      _pdfViewerCreatePageSlot(tab, i, slotWidth, slotHeight);
    }
    // Set up IntersectionObserver for lazy rendering (no reflows on scroll)
    _pdfViewerInstallObserver(tab);
    // Render first few pages immediately, rest via observer
    const initialPages = Math.min(5, tab._pdfPageCount);
    for (let j = 1; j <= initialPages; j++) {
      _pdfViewerRenderPage(tab, j);
    }
  });
}

// IntersectionObserver for lazy page rendering — zero reflow cost on scroll.
// Each page wrapper is observed; when it enters the viewport (+ margin), render fires.
function _pdfViewerInstallObserver(tab) {
  if (tab._pdfPageObserver) tab._pdfPageObserver.disconnect();
  var rootEl = tab._pdfPagesContainer;
  tab._pdfPageObserver = new IntersectionObserver(function(entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      var pageNum = parseInt(entries[i].target.getAttribute('data-page-num'));
      if (pageNum) _pdfViewerRenderPage(tab, pageNum);
    }
  }, { root: rootEl, rootMargin: '200% 0px' });
  var wrappers = tab._pdfPageWrappers || [];
  for (var j = 1; j <= tab._pdfPageCount; j++) {
    if (wrappers[j]) tab._pdfPageObserver.observe(wrappers[j]);
  }
}

function _pdfViewerCreatePageSlot(tab, pageNum, width, height) {
  // Page slots are raw DOM — they host canvas + textLayer which must be imperative
  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-page-wrapper';
  wrapper.setAttribute('data-page-num', pageNum);
  wrapper.style.minHeight = height ? (height + 'px') : '400px';
  if (width) wrapper.style.width = width + 'px';
  if (width && height) wrapper.style.containIntrinsicSize = width + 'px ' + height + 'px';
  tab._pdfPagesContainer.appendChild(wrapper);
  // Cache wrapper reference for fast lookup
  if (!tab._pdfPageWrappers) tab._pdfPageWrappers = [];
  tab._pdfPageWrappers[pageNum] = wrapper;
}

function _assembleRenderedPage(tab, pageNum, wrapper, canvas, cssW, cssH, scale) {
  var oldCanvas = wrapper.querySelector('canvas');
  if (oldCanvas) _releaseCanvas(oldCanvas);
  wrapper.innerHTML = '';
  wrapper.style.width = cssW + 'px';
  wrapper.style.height = cssH + 'px';
  wrapper.style.minHeight = '';
  wrapper.style.transform = '';
  wrapper.style.transformOrigin = '';
  wrapper.style.marginBottom = '';
  wrapper.style.containIntrinsicSize = cssW + 'px ' + cssH + 'px';
  wrapper.style.setProperty('--scale-factor', scale);
  wrapper.appendChild(canvas);

  // Highlight layer (lightweight, render immediately)
  const hlLayer = document.createElement('div');
  hlLayer.className = 'pdf-highlight-layer';
  hlLayer.style.width = cssW + 'px';
  hlLayer.style.height = cssH + 'px';
  wrapper.appendChild(hlLayer);
  _pdfViewerRenderHighlightsForPage(tab, pageNum, hlLayer);
}

function _pdfViewerRenderPage(tab, pageNum) {
  if (!tab._pdfDoc || !tab._pdfRenderedPages) return;
  if (tab._pdfRenderedPages.has(pageNum)) return;
  tab._pdfRenderedPages.set(pageNum, true);

  const wrapper = tab._pdfPageWrappers && tab._pdfPageWrappers[pageNum];
  if (!wrapper) return;

  // Check bitmap cache for instant restore
  var cacheKey = pageNum + '-' + tab._pdfZoom;
  var cached = _bitmapCache.get(cacheKey);
  if (cached) {
    var dpr = window.devicePixelRatio || 1;
    var pool = _acquireCanvas(cached.width / dpr, cached.height / dpr, dpr);
    pool.ctx.setTransform(1, 0, 0, 1, 0, 0); // reset for drawImage
    pool.ctx.drawImage(cached, 0, 0);
    _assembleRenderedPage(tab, pageNum, wrapper, pool.canvas, cached.width / dpr, cached.height / dpr, tab._pdfZoom);
    return;
  }

  tab._pdfDoc.getPage(pageNum).then(function(page) {
    const scale = tab._pdfZoom;
    const viewport = page.getViewport({ scale: scale });
    const dpr = window.devicePixelRatio || 1;

    var pool = _acquireCanvas(viewport.width, viewport.height, dpr);
    var canvas = pool.canvas;

    const renderTask = page.render({ canvasContext: pool.ctx, viewport: viewport });
    renderTask.promise.then(function() {
      _assembleRenderedPage(tab, pageNum, wrapper, canvas, viewport.width, viewport.height, scale);

      // Snapshot to bitmap cache for instant restore
      createImageBitmap(canvas).then(function(bmp) {
        var key = pageNum + '-' + scale;
        _bitmapCache.set(key, bmp);
        if (_bitmapCache.size > _BITMAP_CACHE_MAX) {
          var oldest = _bitmapCache.keys().next().value;
          _bitmapCache.get(oldest).close();
          _bitmapCache.delete(oldest);
        }
      });

      // Defer text layer + annotations to idle time so canvas paint isn't blocked
      const deferFn = window.requestIdleCallback || function(cb) { setTimeout(cb, 16); };
      deferFn(function() {
        // Text layer for selection
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        textLayerDiv.style.setProperty('--scale-factor', scale);
        wrapper.appendChild(textLayerDiv);

        page.getTextContent().then(function(textContent) {
          if (window.pdfjsLib.renderTextLayer) {
            const opts = {
              container: textLayerDiv,
              viewport: viewport,
              textDivs: []
            };
            opts.textContentSource = textContent;
            window.pdfjsLib.renderTextLayer(opts);
          }

          // Citation overlays after text layer is populated
          _installCitationOverlays(tab, pageNum, wrapper, textLayerDiv);
        });
      });

      // Annotation layer (internal PDF links)
      page.getAnnotations().then(function(annotations) {
        if (!annotations || !annotations.length) return;
        const annotLayer = document.createElement('div');
        annotLayer.className = 'pdf-annotation-layer';
        annotLayer.style.width = viewport.width + 'px';
        annotLayer.style.height = viewport.height + 'px';
        wrapper.appendChild(annotLayer);

        annotations.forEach(function(ann) {
          if (ann.subtype !== 'Link' || !ann.rect) return;
          const rect = viewport.convertToViewportRectangle(ann.rect);
          const left = Math.min(rect[0], rect[2]);
          const top = Math.min(rect[1], rect[3]);
          const width = Math.abs(rect[2] - rect[0]);
          const height = Math.abs(rect[3] - rect[1]);

          const link = new View('div')
            .className('pdf-annot-link')
            .cssText('left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;height:' + height + 'px;');

          if (ann.dest) {
            link.attr('data-dest', JSON.stringify(ann.dest))
              .onTap(function() {
                tab._pdfDoc.getDestination(ann.dest).then(function(dest) {
                  if (!dest) return;
                  tab._pdfDoc.getPageIndex(dest[0]).then(function(idx) {
                    _pdfViewerGoToPage(tab, idx + 1);
                  });
                }).catch(function() {});
              });
          } else if (ann.url) {
            link.onTap(function() {
              if (typeof browseNewTab === 'function') window.browseNewTab(ann.url);
            });
          }
          annotLayer.appendChild(link.el);
        });
      });

    }).catch(function() {});
  });
}

// ── Scroll-based lazy rendering ──

function _pdfViewerOnScroll(tab) {
  if (!tab._pdfDoc || !tab._pdfPagesContainer || !tab._pdfRenderedPages) return;

  const container = tab._pdfPagesContainer;
  const wrappers = tab._pdfPageWrappers;
  if (!wrappers) return;
  const pageCount = tab._pdfPageCount;

  // Skip page detection if a recent goToPage navigation is settling
  const navGuarded = tab._pdfNavGuardUntil && performance.now() < tab._pdfNavGuardUntil;
  if (!navGuarded) {
    // Estimate current page from scrollTop + known slot height (no reflow)
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const slotH = tab._pdfSlotHeight || 400;
    const gap = 12; // matches css gap on .pdf-pages-container
    const center = scrollTop + containerHeight / 2;
    let currentPage = Math.max(1, Math.min(pageCount, Math.round(center / (slotH + gap)) + 1));
    // Clamp — binary estimation can overshoot on variable-height pages
    if (currentPage > pageCount) currentPage = pageCount;

    if (currentPage !== tab._pdfCurrentPage) {
      tab._pdfCurrentPage = currentPage;
      tab._pdfPageIndicator.textContent = currentPage + ' / ' + pageCount;
      _pdfViewerUpdateThumbActive(tab, currentPage);
    }
  }

  // Lazy rendering handled by IntersectionObserver — no loop needed here
  // Pages stay in DOM permanently; content-visibility: auto lets the browser
  // skip layout/paint for off-screen pages and manage GPU textures natively.
}

// ── Page Navigation ──

function _pdfViewerGoToPage(tab, pageNum) {
  if (!tab._pdfDoc || pageNum < 1 || pageNum > tab._pdfPageCount) return;
  tab._pdfCurrentPage = pageNum;
  tab._pdfPageIndicator.textContent = pageNum + ' / ' + tab._pdfPageCount;
  // Suppress scroll handler from overriding this navigation
  tab._pdfNavGuardUntil = performance.now() + 300;

  const wrapper = tab._pdfPageWrappers && tab._pdfPageWrappers[pageNum];
  if (wrapper) {
    // Center the page when it fits in the viewport, otherwise scroll to top
    const fits = wrapper.offsetHeight <= tab._pdfPagesContainer.clientHeight;
    wrapper.scrollIntoView({ behavior: fits ? 'instant' : 'smooth', block: fits ? 'center' : 'start' });
  }
  _pdfViewerRenderPage(tab, pageNum);
  // Pre-render adjacent pages so flipping feels instant
  if (pageNum > 1) _pdfViewerRenderPage(tab, pageNum - 1);
  if (pageNum < tab._pdfPageCount) _pdfViewerRenderPage(tab, pageNum + 1);
  _pdfViewerUpdateThumbActive(tab, pageNum);
}

export function _pdfViewerScrollToPage(tab, pageNum) {
  _pdfViewerGoToPage(tab, pageNum);
}

// ── Zoom ──

function _pdfViewerSetZoom(tab, newZoom, force) {
  newZoom = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, newZoom));
  if (!force && newZoom === tab._pdfZoom) return;
  var oldZoom = tab._pdfZoom;
  tab._pdfZoom = newZoom;
  // Update cached slot height for scroll estimation
  if (tab._pdfSlotHeight && oldZoom) tab._pdfSlotHeight = Math.round(tab._pdfSlotHeight * newZoom / oldZoom);
  if (!tab._pdfFitMode) {
    tab._pdfZoomLabel.textContent = Math.round(newZoom * 100) + '%';
  }

  // Mark all pages for re-render; old content stays visible until replaced
  tab._pdfRenderedPages = new Map();
  _pdfViewerInstallObserver(tab);
  _pdfViewerOnScroll(tab);
}

function _pdfViewerFitWidth(tab) {
  if (!tab._pdfDoc || !tab._pdfPagesContainer) return;
  tab._pdfDoc.getPage(1).then(function(page) {
    var vp = page.getViewport({ scale: 1 });
    var containerWidth = tab._pdfPagesContainer.clientWidth - 40; // padding
    var scale = containerWidth / vp.width;
    scale = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, scale));
    _pdfViewerSetZoom(tab, scale, true);
    tab._pdfFitMode = 'width';
    tab._pdfZoomLabel.textContent = 'Fit W';
  });
}

function _pdfViewerFitPage(tab) {
  if (!tab._pdfDoc || !tab._pdfPagesContainer) return;
  tab._pdfDoc.getPage(1).then(function(page) {
    var vp = page.getViewport({ scale: 1 });
    var containerWidth = tab._pdfPagesContainer.clientWidth - 40;
    var containerHeight = tab._pdfPagesContainer.clientHeight - 20;
    var scaleW = containerWidth / vp.width;
    var scaleH = containerHeight / vp.height;
    var scale = Math.min(scaleW, scaleH);
    scale = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, scale));
    _pdfViewerSetZoom(tab, scale, true);
    tab._pdfFitMode = 'page';
    tab._pdfZoomLabel.textContent = 'Fit P';
  });
}

function _pdfViewerToggleZoomDropdown(tab, labelEl) {
  const existing = tab._pdfToolbar.querySelector('.pdf-zoom-dropdown');
  if (existing) { existing.remove(); return; }

  var menuItems = [
    { label: 'Fit to width', handler: function() { _pdfViewerFitWidth(tab); } },
    { label: 'Fit to page', handler: function() { _pdfViewerFitPage(tab); } },
    { divider: true }
  ];
  var levels = [50, 75, 100, 125, 150, 200, 300, 400];
  levels.forEach(function(pct) {
    menuItems.push({
      label: pct + '%',
      handler: function() { tab._pdfFitMode = null; _pdfViewerSetZoom(tab, pct / 100); }
    });
  });

  const menu = Menu(labelEl, menuItems);
  menu.show();
}

// ── Dark Mode ──

export function _pdfViewerToggleDark(tab) {
  if (!tab._pdfPagesContainer) return;
  tab._pdfDarkMode = !tab._pdfDarkMode;
  tab._pdfPagesContainer.classList.toggle('pdf-dark-render', tab._pdfDarkMode);
  if (tab._pdfLeftPanel) tab._pdfLeftPanel.classList.toggle('pdf-dark-render', tab._pdfDarkMode);
  _pdfApplyDarkBg(tab._pdfDarkMode);
}

// ── Thumbnails ──

function _pdfViewerRenderThumbnails(tab) {
  if (!tab._pdfDoc || !tab._pdfThumbScroll) return;
  tab._pdfThumbScroll.innerHTML = '';

  // Cache thumb items for fast active-state updates
  if (!tab._pdfThumbItems) tab._pdfThumbItems = [];
  tab._pdfRenderedThumbs = new Set();

  for (let i = 1; i <= tab._pdfPageCount; i++) {
    (function(pageNum) {
      const item = new View('div')
        .className('pdf-thumb-item' + (pageNum === 1 ? ' active' : ''))
        .attr('data-thumb-page', pageNum)
        .attr('tabIndex', '0')
        .onTap(function() { _pdfViewerGoToPage(tab, pageNum); });

      // Set placeholder height based on typical aspect ratio
      item.el.style.minHeight = '120px';

      tab._pdfThumbItems[pageNum] = item.el;
      tab._pdfThumbScroll.appendChild(item.el);
    })(i);
  }

  // Lazy-render visible thumbnails via IntersectionObserver
  const thumbObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const pageNum = parseInt(el.getAttribute('data-thumb-page'));
      if (tab._pdfRenderedThumbs.has(pageNum)) return;
      tab._pdfRenderedThumbs.add(pageNum);
      thumbObserver.unobserve(el);

      tab._pdfDoc.getPage(pageNum).then(function(page) {
        const vp = page.getViewport({ scale: 0.3 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = '100%';
        canvas.style.display = 'block';
        el.appendChild(canvas);
        el.style.minHeight = '';

        const labelEl = document.createElement('div');
        labelEl.className = 'pdf-thumb-label';
        labelEl.textContent = String(pageNum);
        el.appendChild(labelEl);

        const ctx = canvas.getContext('2d');
        page.render({ canvasContext: ctx, viewport: vp });
      });
    });
  }, { root: tab._pdfThumbScroll, rootMargin: '200px' });

  for (let j = 1; j <= tab._pdfPageCount; j++) {
    if (tab._pdfThumbItems[j]) thumbObserver.observe(tab._pdfThumbItems[j]);
  }
  tab._pdfThumbObserver = thumbObserver;
}

function _pdfViewerUpdateThumbActive(tab, pageNum) {
  if (!tab._pdfThumbItems) return;
  // Deactivate previous, activate current (O(1) instead of scanning all)
  if (tab._pdfActiveThumbPage && tab._pdfThumbItems[tab._pdfActiveThumbPage]) {
    tab._pdfThumbItems[tab._pdfActiveThumbPage].classList.remove('active');
  }
  tab._pdfActiveThumbPage = pageNum;
  const active = tab._pdfThumbItems[pageNum];
  if (active) {
    active.classList.add('active');
    active.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
}

// ── Outline / TOC ──

function _pdfViewerExtractOutline(tab) {
  if (!tab._pdfDoc || !tab._pdfOutlineScroll) return;
  tab._pdfDoc.getOutline().then(function(outline) {
    tab._pdfOutlineScroll.innerHTML = '';
    if (!outline || !outline.length) {
      AetherUI.append(
        new View('div').className('pdf-outline-empty').text('No outline available'),
        tab._pdfOutlineScroll
      );
      return;
    }
    _renderOutlineItems(tab, outline, tab._pdfOutlineScroll, 0);
  });
}

function _renderOutlineItems(tab, items, container, level) {
  items.forEach(function(item) {
    const el = new View('div')
      .className('pdf-toc-item')
      .style('paddingLeft', (6 + level * 14) + 'px')
      .text(item.title)
      .onTap(function() {
        if (item.dest) {
          if (typeof item.dest === 'string') {
            tab._pdfDoc.getDestination(item.dest).then(function(dest) {
              if (!dest) return;
              tab._pdfDoc.getPageIndex(dest[0]).then(function(idx) {
                _pdfViewerGoToPage(tab, idx + 1);
              });
            });
          } else if (Array.isArray(item.dest)) {
            tab._pdfDoc.getPageIndex(item.dest[0]).then(function(idx) {
              _pdfViewerGoToPage(tab, idx + 1);
            });
          }
        }
      });
    container.appendChild(el.el);

    if (item.items && item.items.length) {
      _renderOutlineItems(tab, item.items, container, level + 1);
    }
  });
}

// ── Highlights ──

function _pdfViewerRenderHighlightsForPage(tab, pageNum, hlLayer) {
  if (!tab._pdfHighlights) return;
  hlLayer.innerHTML = '';
  const wrapper = hlLayer.parentElement;
  const wW = wrapper.offsetWidth;
  const wH = wrapper.offsetHeight;
  tab._pdfHighlights.forEach(function(hl, hlIdx) {
    if (hl.pageNum !== pageNum || !hl.rects) return;
    hl.rects.forEach(function(r) {
      const rect = new View('div')
        .className('pdf-highlight-rect cursor-pointer')
        .styles({
          left: (r.left * wW) + 'px',
          top: (r.top * wH) + 'px',
          width: (r.width * wW) + 'px',
          height: (r.height * wH) + 'px',
          background: hl.color || _PDF_HL_COLORS[0].color,
          pointerEvents: 'auto'
        });
      rect.on('click', function(e) {
        e.stopPropagation();
        _showNotePopup(tab, hl, hlIdx, e.clientX, e.clientY);
      });
      hlLayer.appendChild(rect.el);
    });
  });
}

function _showNotePopup(tab, hl, hlIdx, x, y) {
  const old = document.querySelector('.pdf-note-popup');
  if (old) old.remove();

  const popup = new View('div').className('pdf-note-popup')
    .cssText('position:fixed;z-index:10002;left:' + x + 'px;top:' + y + 'px;');

  const header = new View('div').className('pdf-note-popup-header');
  const quote = new View('div').className('pdf-note-popup-quote')
    .styles({ borderColor: hl.color || _PDF_HL_COLORS[0].color })
    .text((hl.text || '').length > 120 ? hl.text.slice(0, 120) + '…' : (hl.text || ''));
  const delBtn = new View('button').className('pdf-note-popup-del')
    .attr('title', 'Delete highlight')
    .html(icon('trash', { size: 14 }))
    .on('mousedown', function(e) { e.stopPropagation(); })
    .on('click', function(e) {
      e.stopPropagation();
      _pdfViewerRemoveHighlight(tab, hlIdx);
      popup.el.remove();
    });
  header.add(quote, delBtn);
  popup.add(header);

  const textarea = new View('textarea').className('pdf-note-popup-textarea')
    .attr('placeholder', 'Add a note…')
    .attr('rows', '3');
  textarea.el.value = hl.note || '';
  let _saveTimer = null;
  textarea.on('input', function() {
    hl.note = textarea.el.value;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
      if (hl.id && window.electronAPI && window.electronAPI.dbQuery) {
        window.electronAPI.dbQuery('highlight-update', hl.id, hl.note);
      }
    }, 400);
  });
  popup.add(textarea);

  document.body.appendChild(popup.el);

  // Keep popup in viewport
  requestAnimationFrame(function() {
    const r = popup.el.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) popup.el.style.left = (window.innerWidth - r.width - 8) + 'px';
    if (r.bottom > window.innerHeight - 8) popup.el.style.top = (window.innerHeight - r.height - 8) + 'px';
  });

  setTimeout(function() { textarea.el.focus(); }, 50);

  // Close on outside click
  setTimeout(function() {
    function close(e) {
      if (!popup.el.contains(e.target)) {
        popup.el.remove();
        document.removeEventListener('mousedown', close);
      }
    }
    document.addEventListener('mousedown', close);
  }, 0);
}

export function _pdfViewerAddHighlight(tab, highlight) {
  if (!tab._pdfHighlights) tab._pdfHighlights = [];
  highlight.id = _hlId();

  // Normalize rects to fractions (0–1) of wrapper dimensions
  const wrapper = tab._pdfPagesContainer.querySelector('[data-page-num="' + highlight.pageNum + '"]');
  if (wrapper && highlight.rects) {
    const wW = wrapper.offsetWidth;
    const wH = wrapper.offsetHeight;
    highlight.rects = highlight.rects.map(function(r) {
      return { left: r.left / wW, top: r.top / wH, width: r.width / wW, height: r.height / wH };
    });
  }

  tab._pdfHighlights.push(highlight);

  // Re-render the highlight layer for that page
  if (wrapper) {
    const hlLayer = wrapper.querySelector('.pdf-highlight-layer');
    if (hlLayer) {
      _pdfViewerRenderHighlightsForPage(tab, highlight.pageNum, hlLayer);
    }
  }

  // Persist to DB
  if (window.electronAPI && window.electronAPI.dbQuery && tab._pdfUrl) {
    window.electronAPI.dbQuery('highlight-save', highlight.id, tab._pdfUrl, highlight.pageNum, highlight.text || '', JSON.stringify(highlight.rects), highlight.color || '', highlight.note || '');
  }

  // Refresh sidebar files view to show new highlight
  if (typeof window._refreshFilesContent === 'function') window._refreshFilesContent();
}

export function _pdfViewerRemoveHighlight(tab, index) {
  if (!tab._pdfHighlights) return;
  const hl = tab._pdfHighlights[index];
  if (!hl) return;
  tab._pdfHighlights.splice(index, 1);
  // Re-render
  const wrapper = tab._pdfPagesContainer.querySelector('[data-page-num="' + hl.pageNum + '"]');
  if (wrapper) {
    const hlLayer = wrapper.querySelector('.pdf-highlight-layer');
    if (hlLayer) {
      hlLayer.innerHTML = '';
      _pdfViewerRenderHighlightsForPage(tab, hl.pageNum, hlLayer);
    }
  }
  // Delete from DB
  if (hl.id && window.electronAPI && window.electronAPI.dbQuery) {
    window.electronAPI.dbQuery('highlight-delete', hl.id);
  }

  // Refresh sidebar files view
  if (typeof window._refreshFilesContent === 'function') window._refreshFilesContent();
}

// Highlight color popup removed — now in aether panel (panel.js)
export function _pdfViewerInstallHighlightHandler(tab) {
  // no-op: kept for API compatibility
}

// ── Search ──

let _searchBar = null;

// Pre-extract text content from all pages for fast search
function _pdfEnsureTextIndex(tab) {
  if (tab._pdfTextIndex) return Promise.resolve(tab._pdfTextIndex);
  if (tab._pdfTextIndexPromise) return tab._pdfTextIndexPromise;
  if (!tab._pdfDoc) return Promise.resolve(null);

  tab._pdfTextIndexPromise = new Promise(function(resolve) {
    var index = []; // index[pageNum] = { text, items }
    var promises = [];
    for (var i = 1; i <= tab._pdfPageCount; i++) {
      (function(pageNum) {
        promises.push(
          tab._pdfDoc.getPage(pageNum).then(function(page) {
            return page.getTextContent();
          }).then(function(content) {
            var fullText = '';
            var items = [];
            content.items.forEach(function(item) {
              items.push({ str: item.str, offset: fullText.length, transform: item.transform, width: item.width, height: item.height });
              fullText += item.str;
            });
            index[pageNum] = { text: fullText, textLower: fullText.toLowerCase(), items: items };
          })
        );
      })(i);
    }
    Promise.all(promises).then(function() {
      tab._pdfTextIndex = index;
      tab._pdfTextIndexPromise = null;
      resolve(index);
    });
  });
  return tab._pdfTextIndexPromise;
}

function _pdfViewerToggleSearch(tab) {
  if (_searchBar && _searchBar.parentNode) {
    _searchBar.remove();
    _searchBar = null;
    _pdfSearchClearHighlights(tab);
    return;
  }

  // Start building text index immediately
  _pdfEnsureTextIndex(tab);

  var countLabel = new View('span').styles({
    fontSize: '0.72rem',
    color: 'var(--nr-text-quaternary)',
    minWidth: '40px',
    whiteSpace: 'nowrap'
  });

  var input = new View('input')
    .attr('type', 'text')
    .attr('placeholder', 'Search in PDF...')
    .styles({
      flex: '1',
      background: 'var(--nr-bg-input)',
      border: '1px solid var(--nr-border-default)',
      borderRadius: '6px',
      padding: '4px 8px',
      fontSize: '0.78rem',
      color: 'var(--nr-text-primary)',
      outline: 'none',
      minWidth: '120px'
    });

  var prevBtn = _tbBtn(icon('chevronUp', { size: 14 }), 'Previous match', function() {
    _pdfSearchPrev(tab, countLabel.el);
  });
  var nextBtn = _tbBtn(icon('chevronDown', { size: 14 }), 'Next match', function() {
    _pdfSearchNext(tab, countLabel.el);
  });
  var closeBtn = _tbBtn(icon('close', { size: 14 }), 'Close search', function() {
    _pdfViewerToggleSearch(tab);
  });

  var searchBarView = new HStack()
    .styles({
      gap: '6px',
      alignItems: 'center',
      padding: '6px 12px',
      background: 'var(--nr-bg-surface)',
      borderBottom: '1px solid var(--nr-border-dim)'
    })
    .add(input, countLabel, prevBtn, nextBtn, closeBtn);

  _searchBar = searchBarView.el;

  // Insert after toolbar
  tab._pdfToolbar.parentNode.insertBefore(_searchBar, tab._pdfToolbar.nextSibling);
  input.el.focus();

  var searchTimer = null;
  input.on('input', function() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function() {
      _pdfViewerDoSearch(tab, input.el.value.trim(), countLabel.el);
    }, 150);
  });
  input.on('keydown', function(e) {
    if (e.key === 'Escape') _pdfViewerToggleSearch(tab);
    else if (e.key === 'Enter' && e.shiftKey) _pdfSearchPrev(tab, countLabel.el);
    else if (e.key === 'Enter') _pdfSearchNext(tab, countLabel.el);
  });
}

function _pdfSearchClearHighlights(tab) {
  if (tab._pdfPagesContainer) {
    tab._pdfPagesContainer.querySelectorAll('.pdf-search-highlight').forEach(function(el) { el.remove(); });
  }
  tab._pdfSearchMatches = [];
  tab._pdfSearchIdx = -1;
}

function _pdfViewerDoSearch(tab, query, countLabelEl) {
  _pdfSearchClearHighlights(tab);
  if (!query || !tab._pdfDoc) { countLabelEl.textContent = ''; return; }

  _pdfEnsureTextIndex(tab).then(function(index) {
    if (!index) { countLabelEl.textContent = ''; return; }
    var queryLower = query.toLowerCase();
    var matches = []; // { pageNum, charOffset, length }

    // Phase 1: fast text-only scan across all pages (no DOM)
    for (var p = 1; p <= tab._pdfPageCount; p++) {
      var entry = index[p];
      if (!entry) continue;
      var idx = entry.textLower.indexOf(queryLower);
      while (idx !== -1) {
        matches.push({ pageNum: p, charOffset: idx, length: query.length });
        idx = entry.textLower.indexOf(queryLower, idx + 1);
      }
    }

    tab._pdfSearchMatches = matches;
    tab._pdfSearchIdx = matches.length ? 0 : -1;
    countLabelEl.textContent = matches.length ? '1 / ' + matches.length : 'No results';

    // Phase 2: highlight matches on rendered pages
    _pdfSearchHighlightVisible(tab);

    // Scroll to first match
    if (matches.length) _pdfSearchScrollToMatch(tab);
  });
}

function _pdfSearchHighlightVisible(tab) {
  if (!tab._pdfSearchMatches || !tab._pdfSearchMatches.length) return;
  var index = tab._pdfTextIndex;
  if (!index) return;

  // Only highlight on pages that have rendered text layers
  tab._pdfSearchMatches.forEach(function(match, matchIdx) {
    if (match._highlighted) return;
    var wrapper = tab._pdfPageWrappers && tab._pdfPageWrappers[match.pageNum];
    if (!wrapper) return;
    var textLayer = wrapper.querySelector('.textLayer');
    if (!textLayer) return;

    var entry = index[match.pageNum];
    if (!entry) return;

    // Find which spans contain this match
    var spans = textLayer.querySelectorAll('span');
    var charPos = 0;
    var matchStart = match.charOffset;
    var matchEnd = matchStart + match.length;

    for (var s = 0; s < spans.length; s++) {
      var span = spans[s];
      var spanText = span.textContent || '';
      var spanStart = charPos;
      var spanEnd = charPos + spanText.length;
      charPos = spanEnd;

      // Check overlap
      if (spanEnd <= matchStart || spanStart >= matchEnd) continue;

      var hlStart = Math.max(0, matchStart - spanStart);
      var hlEnd = Math.min(spanText.length, matchEnd - spanStart);

      try {
        var range = document.createRange();
        range.setStart(span.firstChild || span, hlStart);
        range.setEnd(span.firstChild || span, hlEnd);
        var rects = range.getClientRects();
        var wrapperRect = wrapper.getBoundingClientRect();

        for (var r = 0; r < rects.length; r++) {
          var rect = rects[r];
          var mark = document.createElement('div');
          mark.className = 'pdf-search-highlight';
          mark.setAttribute('data-match-idx', matchIdx);
          mark.style.cssText = 'position:absolute;left:' + (rect.left - wrapperRect.left) + 'px;top:' + (rect.top - wrapperRect.top) + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;background:rgba(255,165,0,0.35);border-radius:1px;pointer-events:none;z-index:5;';
          wrapper.appendChild(mark);
        }
      } catch (e) { /* range error on unrendered spans */ }
    }
    match._highlighted = true;
  });
}

function _pdfSearchScrollToMatch(tab) {
  if (!tab._pdfSearchMatches || !tab._pdfSearchMatches.length) return;
  var idx = tab._pdfSearchIdx;
  if (idx < 0 || idx >= tab._pdfSearchMatches.length) return;

  var match = tab._pdfSearchMatches[idx];

  // Remove active class from all highlights
  if (tab._pdfPagesContainer) {
    tab._pdfPagesContainer.querySelectorAll('.pdf-search-active').forEach(function(el) {
      el.classList.remove('pdf-search-active');
    });
  }

  // Ensure the target page is rendered, then scroll
  _pdfViewerRenderPage(tab, match.pageNum);

  // Wait a tick for render, then highlight and scroll
  setTimeout(function() {
    _pdfSearchHighlightVisible(tab);
    var els = tab._pdfPagesContainer.querySelectorAll('[data-match-idx="' + idx + '"]');
    if (els.length) {
      els.forEach(function(el) { el.classList.add('pdf-search-active'); });
      els[0].scrollIntoView({ behavior: 'instant', block: 'center' });
    } else {
      // Fallback: scroll to the page wrapper
      var wrapper = tab._pdfPageWrappers && tab._pdfPageWrappers[match.pageNum];
      if (wrapper) wrapper.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }, 100);
}

function _pdfSearchNext(tab, countLabelEl) {
  if (!tab._pdfSearchMatches || !tab._pdfSearchMatches.length) return;
  tab._pdfSearchIdx = (tab._pdfSearchIdx + 1) % tab._pdfSearchMatches.length;
  if (countLabelEl) countLabelEl.textContent = (tab._pdfSearchIdx + 1) + ' / ' + tab._pdfSearchMatches.length;
  _pdfSearchScrollToMatch(tab);
}

function _pdfSearchPrev(tab, countLabelEl) {
  if (!tab._pdfSearchMatches || !tab._pdfSearchMatches.length) return;
  tab._pdfSearchIdx = (tab._pdfSearchIdx - 1 + tab._pdfSearchMatches.length) % tab._pdfSearchMatches.length;
  if (countLabelEl) countLabelEl.textContent = (tab._pdfSearchIdx + 1) + ' / ' + tab._pdfSearchMatches.length;
  _pdfSearchScrollToMatch(tab);
}

// ── Text extraction ──

export function _pdfViewerGetText(tab, startPage, endPage) {
  if (!tab._pdfDoc) return Promise.resolve('');
  startPage = startPage || 1;
  endPage = endPage || tab._pdfPageCount;
  const pages = [];
  for (let i = startPage; i <= endPage; i++) pages.push(i);

  return Promise.all(pages.map(function(pageNum) {
    return tab._pdfDoc.getPage(pageNum).then(function(page) {
      return page.getTextContent().then(function(tc) {
        return tc.items.map(function(it) { return it.str; }).join(' ');
      });
    });
  })).then(function(texts) {
    return texts.join('\n\n');
  });
}

// ── Citation hover popups ──

let _citationPopup = null;
let _citationHideTimer = null;

function _installCitationOverlays(tab, pageNum, wrapper, textLayerDiv) {
  // Called after text layer is rendered, so spans should be present
  const spans = textLayerDiv.querySelectorAll('span');
  if (!spans.length) return;

  // Citation overlays are pixel-positioned over the canvas — imperative DOM needed
  const citLayer = document.createElement('div');
  citLayer.className = 'pdf-citation-layer';
  wrapper.appendChild(citLayer);

  const wrapperRect = wrapper.getBoundingClientRect();

  spans.forEach(function(span) {
      const text = span.textContent;
      if (!text) return;

      const pattern = /\[(\d+(?:\s*[,\-–]\s*\d+)*)\]/g;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const refNums = _parseCitationNums(match[1]);
        if (!refNums.length) continue;

        // Try Range for precise position, fall back to whole span
        let rects = null;
        try {
          // Walk text nodes to find the one containing our match offset
          const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
          var node, offset = 0, startNode = null, startOffset = 0, endNode = null, endOffset = 0;
          while ((node = walker.nextNode())) {
            const nodeLen = node.textContent.length;
            if (!startNode && offset + nodeLen > match.index) {
              startNode = node;
              startOffset = match.index - offset;
            }
            if (!endNode && offset + nodeLen >= match.index + match[0].length) {
              endNode = node;
              endOffset = match.index + match[0].length - offset;
              break;
            }
            offset += nodeLen;
          }
          if (startNode && endNode) {
            const range = document.createRange();
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
            rects = range.getClientRects();
          }
        } catch (e) {}

        // Fallback: use whole span rect
        if (!rects || !rects.length) {
          rects = [span.getBoundingClientRect()];
        }

        for (let r = 0; r < rects.length; r++) {
          const cr = rects[r];
          if (cr.width < 1 || cr.height < 1) continue;
          var overlay = new View('div')
            .className('pdf-citation-ref')
            .cssText(
              'position:absolute;pointer-events:auto;cursor:pointer;' +
              'left:' + (cr.left - wrapperRect.left) + 'px;' +
              'top:' + (cr.top - wrapperRect.top) + 'px;' +
              'width:' + cr.width + 'px;' +
              'height:' + cr.height + 'px;'
            );
          (function(nums) {
            overlay.onHover(
              function(e) { _showCitationPopup(tab, nums, e.clientX, e.clientY); },
              function() { _scheduleCitationHide(); }
            );
          })(refNums);
          citLayer.appendChild(overlay.el);
        }
      }
    });
}

function _showCitationPopup(tab, refNums, x, y) {
  if (_citationHideTimer) { clearTimeout(_citationHideTimer); _citationHideTimer = null; }
  if (_citationPopup) _citationPopup.remove();

  const popup = new View('div').className('citation-popup');
  _citationPopup = popup.el;

  _populateCitationPopup(popup, tab, refNums);

  document.body.appendChild(popup.el);
  const pw = popup.el.offsetWidth;
  const ph = popup.el.offsetHeight;
  const left = Math.max(8, Math.min(x - pw / 2, window.innerWidth - pw - 8));
  let top = y - ph - 12;
  if (top < 8) top = y + 20;
  popup.el.style.left = left + 'px';
  popup.el.style.top = top + 'px';

  popup.onHover(
    function() {
      if (_citationHideTimer) { clearTimeout(_citationHideTimer); _citationHideTimer = null; }
    },
    function() { _scheduleCitationHide(); }
  );
}

function _populateCitationPopup(popupView, tab, refNums) {
  const state = _paperState.get(tab.id);
  const refs = state && state.refs ? state.refs : null;

  popupView.el.innerHTML = '';

  if (!refs || !refs.length) {
    AetherUI.append(
      new View('div').className('citation-popup-loading')
        .text('[' + refNums.join(', ') + '] Loading references\u2026'),
      popupView.el
    );
    // Poll until refs arrive
    let pollCount = 0;
    var pollTimer = setInterval(function() {
      pollCount++;
      if (pollCount > 20 || !_citationPopup || _citationPopup !== popupView.el) {
        clearInterval(pollTimer);
        return;
      }
      const s = _paperState.get(tab.id);
      if (s && s.refs && s.refs.length) {
        clearInterval(pollTimer);
        _populateCitationPopup(popupView, tab, refNums);
        // Reposition after content change
        const ph = popupView.el.offsetHeight;
        const curTop = parseFloat(popupView.el.style.top);
        if (curTop + ph > window.innerHeight - 8) {
          popupView.el.style.top = Math.max(8, window.innerHeight - ph - 8) + 'px';
        }
      }
    }, 500);
    return;
  }

  refNums.forEach(function(num, idx) {
    const ref = refs[num - 1];
    if (!ref) return;

    if (idx > 0) {
      AetherUI.append(
        new View('div').styles({ borderTop: '1px solid var(--nr-border-dim)', margin: '8px 0' }),
        popupView.el
      );
    }

    AetherUI.append(
      new View('div')
        .styles({ fontSize: '0.68rem', fontWeight: '600', color: 'var(--nr-text-quaternary)', marginBottom: '2px' })
        .text('[' + num + ']'),
      popupView.el
    );

    AetherUI.append(
      new View('div').className('citation-popup-title').text(ref.title || 'Untitled'),
      popupView.el
    );

    const meta = [];
    if (ref.authors && ref.authors.length) {
      meta.push(ref.authors.slice(0, 3).map(function(a) { return a.name; }).join(', ') + (ref.authors.length > 3 ? ' et al.' : ''));
    }
    if (ref.year) meta.push(String(ref.year));
    if (ref.venue) meta.push(ref.venue);
    if (ref.citationCount != null) meta.push(ref.citationCount + ' citations');
    if (meta.length) {
      AetherUI.append(
        new View('div').className('citation-popup-meta').text(meta.join(' \u00b7 ')),
        popupView.el
      );
    }

    const linkEl = new View('a')
      .className('citation-popup-link')
      .text('Search on Google Scholar \u2192')
      .attr('href', '#')
      .onTap(function(e) {
        e.preventDefault();
        if (typeof window.browseNewTab === 'function') window.browseNewTab('https://scholar.google.com/scholar?q=' + encodeURIComponent(ref.title));
        if (_citationPopup) { _citationPopup.remove(); _citationPopup = null; }
      });
    AetherUI.append(linkEl, popupView.el);
  });
}

function _scheduleCitationHide() {
  if (_citationHideTimer) clearTimeout(_citationHideTimer);
  _citationHideTimer = setTimeout(function() {
    if (_citationPopup) { _citationPopup.remove(); _citationPopup = null; }
  }, 300);
}

function _parseCitationNums(str) {
  const nums = [];
  str.split(',').forEach(function(part) {
    part = part.trim();
    const dashMatch = part.match(/(\d+)\s*[\-–]\s*(\d+)/);
    if (dashMatch) {
      const start = parseInt(dashMatch[1]);
      const end = parseInt(dashMatch[2]);
      for (let i = start; i <= end; i++) nums.push(i);
    } else {
      const n = parseInt(part);
      if (!isNaN(n)) nums.push(n);
    }
  });
  return nums;
}

// ── Window bridge ──
window._pdfViewerInit = _pdfViewerInit;
window._pdfViewerDestroy = _pdfViewerDestroy;
window._pdfViewerScrollToPage = _pdfViewerScrollToPage;
window._pdfViewerGetText = _pdfViewerGetText;
window._pdfViewerAddHighlight = _pdfViewerAddHighlight;
window._pdfViewerRemoveHighlight = _pdfViewerRemoveHighlight;
window._pdfViewerToggleSearch = _pdfViewerToggleSearch;
