// browse-pdf-viewer.js — PDF.js renderer for Nerd Mode
// Renders PDF pages with canvas + textLayer, toolbar, thumbnails, TOC, highlights, search
// Depends on: browse-state.js

import { icon } from '/js/core/icons.js';
import { _paperState } from '/js/browse/browse-paper.js';
import { togglePanel } from '/js/core/core-nav.js';

// ── PDF.js CDN loader ──
var _pdfjsLoaded = false;
var _pdfjsLoadPromise = null;

// PDF.js legacy global build (CDN)
function _ensurePdfjsLegacy() {
  if (_pdfjsLoaded && window.pdfjsLib) return Promise.resolve();
  if (_pdfjsLoadPromise) return _pdfjsLoadPromise;
  _pdfjsLoadPromise = new Promise(function(resolve, reject) {
    if (window.pdfjsLib) { _pdfjsLoaded = true; resolve(); return; }
    var script = document.createElement('script');
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
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf_viewer.min.css';
      document.head.appendChild(link);
    }
  });
  return _pdfjsLoadPromise;
}

// ── Constants ──
var _PDF_SCALE_DEFAULT = 1.5;
var _PDF_SCALE_MIN = 0.5;
var _PDF_SCALE_MAX = 4.0;
var _PDF_HL_COLORS = [
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
  tab._pdfDarkMode = tab._pdfDarkMode || false;
  tab._pdfLeftPanelVisible = tab._pdfLeftPanelVisible != null ? tab._pdfLeftPanelVisible : true;
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
        var exists = tab._pdfHighlights.some(function(h) { return h.id === row.id; });
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
      if (tab._pdfRenderedPages && tab._pdfPagesContainer) {
        tab._pdfRenderedPages.forEach(function(_, pageNum) {
          var wrapper = tab._pdfPagesContainer.querySelector('[data-page-num="' + pageNum + '"]');
          if (!wrapper) return;
          var hlLayer = wrapper.querySelector('.pdf-highlight-layer');
          if (hlLayer) {
            hlLayer.innerHTML = '';
            _pdfViewerRenderHighlightsForPage(tab, pageNum, hlLayer);
          }
        });
      }
    });
  }

  _ensurePdfjsLegacy().then(function() {
    _pdfViewerLoadDoc(tab, pdfUrl);
  }).catch(function(err) {
    var msg = tab._pdfPagesContainer;
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
  // Preserve _pdfCurrentPage, _pdfZoom, _pdfDarkMode, _pdfLeftPanelVisible for re-init
}

// ── DOM Structure ──

function _buildViewerDOM(tab, viewerEl) {
  viewerEl.innerHTML = '';

  // Toolbar
  var toolbarView = new View('div').className('pdf-toolbar');
  viewerEl.appendChild(toolbarView.el);
  tab._pdfToolbar = toolbarView.el;
  _buildToolbar(tab, toolbarView);

  // Body wrapper (left panel + pages)
  var bodyWrapper = new View('div').className('pdf-body-wrapper');
  viewerEl.appendChild(bodyWrapper.el);

  // Left panel
  var leftPanelView = new View('div').className('pdf-left-panel');
  bodyWrapper.add(leftPanelView);
  tab._pdfLeftPanel = leftPanelView.el;
  _buildLeftPanel(tab, leftPanelView);

  // Pages container
  var pagesContainer = new View('div').className('pdf-pages-container');
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
  }

  // Restore left panel visibility
  if (tab._pdfLeftPanelVisible === false) {
    leftPanelView.el.style.display = 'none';
  }

  // Scroll listener for page tracking
  pagesContainer.on('scroll', function() {
    _pdfViewerOnScroll(tab);
  });

  // Pinch-to-zoom: use CSS transform for instant feedback, debounce canvas re-render
  var zoomCommitTimer = null;
  var zoomBaseScale = null; // the scale at which canvases were last rendered

  function _pdfViewerPreviewZoom(tab, newZoom) {
    newZoom = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, newZoom));
    // Capture the rendered scale before updating
    if (zoomBaseScale === null) zoomBaseScale = tab._pdfZoom;
    tab._pdfZoom = newZoom;
    tab._pdfZoomLabel.textContent = Math.round(newZoom * 100) + '%';
    var ratio = newZoom / zoomBaseScale;
    var wrappers = tab._pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
    for (var i = 0; i < wrappers.length; i++) {
      wrappers[i].style.transform = 'scale(' + ratio + ')';
      wrappers[i].style.transformOrigin = 'top center';
    }
    // Debounce the full re-render
    clearTimeout(zoomCommitTimer);
    zoomCommitTimer = setTimeout(function() {
      _pdfViewerCommitZoom(tab);
      zoomBaseScale = null;
    }, 200);
  }

  function _pdfViewerCommitZoom(tab) {
    // Clear CSS transforms and do a full canvas re-render
    var wrappers = tab._pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
    for (var i = 0; i < wrappers.length; i++) {
      wrappers[i].style.transform = '';
      wrappers[i].style.transformOrigin = '';
    }
    _pdfViewerSetZoom(tab, tab._pdfZoom, true);
  }

  // Chrome/Firefox trackpad pinch fires wheel with ctrlKey
  pagesContainer.el.addEventListener('wheel', function(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    var delta = -e.deltaY * 0.01;
    var newZoom = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, tab._pdfZoom + delta));
    _pdfViewerPreviewZoom(tab, newZoom);
  }, { passive: false });

  // Safari native gesture events
  var gestureBaseZoom = 1;
  pagesContainer.el.addEventListener('gesturestart', function(e) {
    e.preventDefault();
    gestureBaseZoom = tab._pdfZoom;
  }, { passive: false });
  pagesContainer.el.addEventListener('gesturechange', function(e) {
    e.preventDefault();
    var newZoom = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, gestureBaseZoom * e.scale));
    _pdfViewerPreviewZoom(tab, newZoom);
  }, { passive: false });
  pagesContainer.el.addEventListener('gestureend', function(e) {
    e.preventDefault();
  }, { passive: false });
}

function _buildToolbar(tab, toolbarView) {
  // Page nav (panel toggles moved to right side)

  // Page nav
  var prevBtn = _tbBtn(icon('chevronLeft', { size: 16 }), 'Previous page', function() {
    _pdfViewerGoToPage(tab, tab._pdfCurrentPage - 1);
  });
  toolbarView.add(prevBtn);

  var pageIndicator = new View('span')
    .className('pdf-page-indicator')
    .text('1 / ?');
  toolbarView.add(pageIndicator);
  tab._pdfPageIndicator = pageIndicator.el;

  var nextBtn = _tbBtn(icon('chevronRight', { size: 16 }), 'Next page', function() {
    _pdfViewerGoToPage(tab, tab._pdfCurrentPage + 1);
  });
  toolbarView.add(nextBtn);

  toolbarView.add(_tbSep());

  // Zoom
  var zoomOut = _tbBtn(icon('minus', { size: 16 }), 'Zoom out', function() {
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

  var zoomIn = _tbBtn(icon('plus', { size: 16 }), 'Zoom in', function() {
    _pdfViewerSetZoom(tab, tab._pdfZoom + 0.25);
  });
  toolbarView.add(zoomIn);

  toolbarView.add(_tbSep());

  // Dark mode toggle
  var darkToggle = _tbBtn(icon('moon', { size: 16 }), 'Dark mode', function() {
    tab._pdfDarkMode = !tab._pdfDarkMode;
    tab._pdfPagesContainer.classList.toggle('pdf-dark-render', tab._pdfDarkMode);
    darkToggle.el.classList.toggle('active', tab._pdfDarkMode);
  });
  if (tab._pdfDarkMode) darkToggle.el.classList.add('active');
  toolbarView.add(darkToggle);

  // Highlight mode toggle
  var hlToggle = _tbBtn(icon('highlighter', { size: 16 }), 'Highlight mode', function() {
    var active = tab._pdfPagesContainer.classList.toggle('pdf-hl-mode');
    hlToggle.el.classList.toggle('active', active);
  });
  hlToggle.el.id = 'pdf-hl-mode-toggle';
  toolbarView.add(hlToggle);

  // Bookmark button
  var bookmarkBtn = _tbBtn(icon('bookmark', { size: 16 }), 'Save to Reading List', function() {
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

  // Implement this paper (dropdown with session history)
  var implBtn = new View('button')
    .className('pdf-tb-btn pdf-tb-labeled pdf-tb-impl')
    .attr('title', 'Implement this paper');
  var implLabel = Text('Implement').cssText('font-size:0.68rem;');
  var implChevron = RawHTML(icon('chevronDown', { size: 10 }));
  implChevron.el.style.marginLeft = '2px';
  implChevron.el.style.opacity = '0.5';
  implChevron.el.style.display = 'none';
  implBtn.add(implLabel, implChevron);

  // Track whether sessions exist for this paper
  var _implHasSessions = false;

  function _implRefreshBtn() {
    if (!window.electronAPI || !window.electronAPI.implList) return;
    electronAPI.implList({ paperUrl: tab.url }).then(function(sessions) {
      if (!sessions || sessions.error) sessions = [];
      _implHasSessions = sessions.length > 0;
      if (tab._implSessionId) {
        // Active session — show truncated title
        var active = sessions.find(function(s) { return s.id === tab._implSessionId; });
        var label = active ? (active.paper_title || 'Session').slice(0, 16) : 'Active';
        implLabel.el.textContent = label;
        implBtn.el.classList.add('active');
        implChevron.el.style.display = '';
      } else if (sessions.length > 0) {
        implLabel.el.textContent = 'Implement';
        implBtn.el.classList.remove('active');
        implChevron.el.style.display = '';
      } else {
        implLabel.el.textContent = 'Implement';
        implBtn.el.classList.remove('active');
        implChevron.el.style.display = 'none';
      }
    });
  }

  implBtn.onTap(function() {
    if (!_implHasSessions && !tab._implSessionId) {
      // No sessions exist — create first one directly
      if (window._implSessionEnable) window._implSessionEnable(tab);
      setTimeout(_implRefreshBtn, 1500);
      return;
    }
    // Show dropdown with existing sessions + new option
    electronAPI.implList({ paperUrl: tab.url }).then(function(sessions) {
      if (!sessions || sessions.error) sessions = [];
      var items = [];

      sessions.forEach(function(s) {
        var age = (Date.now() / 1000 - s.created_at);
        var ageStr = age < 3600 ? Math.floor(age / 60) + 'm ago' : age < 86400 ? Math.floor(age / 3600) + 'h ago' : Math.floor(age / 86400) + 'd ago';
        var isActive = tab._implSessionId === s.id;
        items.push({
          label: (s.paper_title || 'Untitled').slice(0, 30) + (isActive ? ' ●' : ''),
          trailing: function() { return Text(ageStr).cssText('font-size:0.65rem; opacity:0.5;'); },
          handler: function() {
            if (window._implSessionEnable) window._implSessionEnable(tab, s.id);
          }
        });
      });

      if (sessions.length) items.push({ divider: true });
      items.push({
        icon: icon('plus', { size: 14 }),
        label: 'New implementation',
        handler: function() {
          if (window._implSessionEnable) window._implSessionEnable(tab);
          setTimeout(_implRefreshBtn, 1500);
        }
      });

      var menu = Menu(null, items);
      var rect = implBtn.el.getBoundingClientRect();
      menu.showAt(rect.left, rect.bottom + 4);
    });
  });

  // Auto-resume most recent session when entering nerd mode
  if (!tab._implSessionId && window.electronAPI && window.electronAPI.implList) {
    electronAPI.implList({ paperUrl: tab.url }).then(function(sessions) {
      if (!sessions || sessions.error || !sessions.length) return;
      // Resume most recent session (sorted by updated_at DESC)
      var recent = sessions[0];
      if (window._implSessionEnable) window._implSessionEnable(tab, recent.id);
      _implRefreshBtn();
    });
  }

  // Expose refresh so impl-session can update button after create/resume
  tab._implRefreshBtn = _implRefreshBtn;

  _implRefreshBtn();
  toolbarView.add(implBtn);

  // Spacer
  var spacer = new View('div').style('flex', '1');
  toolbarView.add(spacer);

  // Search
  var searchBtn = _tbBtn(icon('search', { size: 16 }), 'Search in PDF', function() {
    _pdfViewerToggleSearch(tab);
  });
  toolbarView.add(searchBtn);

  toolbarView.add(_tbSep());

  // Panel toggle button group
  var panelGroup = new View('div').className('pdf-panel-toggle-group');

  var leftPanelBtn = _tbBtn(icon('panelLeft', { size: 16 }), 'Toggle thumbnails', function() {
    tab._pdfLeftPanelVisible = !tab._pdfLeftPanelVisible;
    tab._pdfLeftPanel.style.display = tab._pdfLeftPanelVisible ? '' : 'none';
    leftPanelBtn.el.classList.toggle('active', tab._pdfLeftPanelVisible);
  });
  leftPanelBtn.el.classList.add('active');
  panelGroup.add(leftPanelBtn);

  var rightPanelBtn = _tbBtn(icon('panelRight', { size: 16 }), 'Toggle lookup panel', function() {
    togglePanel();
    // Update active state after toggle
    setTimeout(function() {
      var panelEl = document.getElementById('universal-panel');
      var visible = panelEl && panelEl.style.display !== 'none' && !panelEl.classList.contains('panel-hidden');
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
  var tabBar = new View('div').className('pdf-left-panel-tabs');

  var thumbScroll = new View('div').className('pdf-thumb-scroll');
  var outlineScroll = new View('div').className('pdf-outline-scroll').style('display', 'none');

  tab._pdfThumbScroll = thumbScroll.el;
  tab._pdfOutlineScroll = outlineScroll.el;

  var thumbTab = new View('button')
    .className('pdf-left-panel-tab active')
    .text('Thumbnails')
    .onTap(function() {
      thumbTab.el.classList.add('active');
      outlineTab.el.classList.remove('active');
      thumbScroll.el.style.display = '';
      outlineScroll.el.style.display = 'none';
    });

  var outlineTab = new View('button')
    .className('pdf-left-panel-tab')
    .text('Outline')
    .onTap(function() {
      outlineTab.el.classList.add('active');
      thumbTab.el.classList.remove('active');
      outlineScroll.el.style.display = '';
      thumbScroll.el.style.display = 'none';
    });

  tabBar.add(thumbTab, outlineTab);
  leftPanelView.add(tabBar);

  // Content area
  var content = new View('div').className('pdf-left-panel-content');
  content.add(thumbScroll, outlineScroll);
  leftPanelView.add(content);
}

// ── Load Document ──

function _pdfViewerLoadDoc(tab, url) {
  var loadingTask = window.pdfjsLib.getDocument(url);
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
  for (var i = 1; i <= tab._pdfPageCount; i++) {
    _pdfViewerCreatePageSlot(tab, i);
  }
  // Render first few pages immediately, rest on scroll
  var initialPages = Math.min(5, tab._pdfPageCount);
  for (var j = 1; j <= initialPages; j++) {
    _pdfViewerRenderPage(tab, j);
  }
}

function _pdfViewerCreatePageSlot(tab, pageNum) {
  // Page slots are raw DOM — they host canvas + textLayer which must be imperative
  var wrapper = document.createElement('div');
  wrapper.className = 'pdf-page-wrapper';
  wrapper.setAttribute('data-page-num', pageNum);
  wrapper.style.minHeight = '400px';
  tab._pdfPagesContainer.appendChild(wrapper);
}

function _pdfViewerRenderPage(tab, pageNum) {
  if (!tab._pdfDoc || !tab._pdfRenderedPages) return;
  if (tab._pdfRenderedPages.has(pageNum)) return;
  tab._pdfRenderedPages.set(pageNum, true);

  tab._pdfDoc.getPage(pageNum).then(function(page) {
    var scale = tab._pdfZoom;
    var viewport = page.getViewport({ scale: scale });

    var wrapper = tab._pdfPagesContainer.querySelector('[data-page-num="' + pageNum + '"]');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';
    wrapper.style.minHeight = '';
    wrapper.style.setProperty('--scale-factor', scale);

    // Canvas — stays imperative (PDF.js rendering)
    var canvas = document.createElement('canvas');
    canvas.width = viewport.width * (window.devicePixelRatio || 1);
    canvas.height = viewport.height * (window.devicePixelRatio || 1);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    wrapper.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    page.render({ canvasContext: ctx, viewport: viewport });

    // Text layer for selection — stays imperative (PDF.js textLayer API)
    var textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.width = viewport.width + 'px';
    textLayerDiv.style.height = viewport.height + 'px';
    textLayerDiv.style.setProperty('--scale-factor', scale);
    wrapper.appendChild(textLayerDiv);

    page.getTextContent().then(function(textContent) {
      if (window.pdfjsLib.renderTextLayer) {
        var opts = {
          container: textLayerDiv,
          viewport: viewport,
          textDivs: []
        };
        opts.textContentSource = textContent;
        window.pdfjsLib.renderTextLayer(opts);
      }
    });

    // Highlight layer — stays imperative (pixel-positioned rects over canvas)
    var hlLayer = document.createElement('div');
    hlLayer.className = 'pdf-highlight-layer';
    hlLayer.style.width = viewport.width + 'px';
    hlLayer.style.height = viewport.height + 'px';
    wrapper.appendChild(hlLayer);

    // Render existing highlights for this page
    _pdfViewerRenderHighlightsForPage(tab, pageNum, hlLayer);

    // Annotation layer (internal PDF links) — stays imperative (pixel-positioned over canvas)
    page.getAnnotations().then(function(annotations) {
      if (!annotations || !annotations.length) return;
      var annotLayer = document.createElement('div');
      annotLayer.className = 'pdf-annotation-layer';
      annotLayer.style.width = viewport.width + 'px';
      annotLayer.style.height = viewport.height + 'px';
      wrapper.appendChild(annotLayer);

      annotations.forEach(function(ann) {
        if (ann.subtype !== 'Link' || !ann.rect) return;
        var rect = viewport.convertToViewportRectangle(ann.rect);
        var left = Math.min(rect[0], rect[2]);
        var top = Math.min(rect[1], rect[3]);
        var width = Math.abs(rect[2] - rect[0]);
        var height = Math.abs(rect[3] - rect[1]);

        var link = new View('div')
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

    // Citation hover overlays — scan rendered text layer spans after they appear
    _installCitationOverlays(tab, pageNum, wrapper, textLayerDiv);

  }).catch(function() {});
}

// ── Scroll-based lazy rendering ──

function _pdfViewerOnScroll(tab) {
  if (!tab._pdfDoc || !tab._pdfPagesContainer || !tab._pdfRenderedPages) return;

  // Update current page
  var container = tab._pdfPagesContainer;
  var wrappers = container.querySelectorAll('.pdf-page-wrapper');
  var scrollTop = container.scrollTop;
  var containerHeight = container.clientHeight;
  var center = scrollTop + containerHeight / 2;

  var currentPage = 1;
  for (var i = 0; i < wrappers.length; i++) {
    var w = wrappers[i];
    if (w.offsetTop + w.offsetHeight / 2 < center) {
      currentPage = i + 1;
    }
  }
  if (currentPage !== tab._pdfCurrentPage) {
    tab._pdfCurrentPage = currentPage;
    tab._pdfPageIndicator.textContent = currentPage + ' / ' + tab._pdfPageCount;
    _pdfViewerUpdateThumbActive(tab, currentPage);
  }

  // Lazy render pages near viewport
  var buffer = containerHeight * 2;
  for (var j = 0; j < wrappers.length; j++) {
    var wr = wrappers[j];
    var top = wr.offsetTop;
    var bottom = top + wr.offsetHeight;
    if (bottom >= scrollTop - buffer && top <= scrollTop + containerHeight + buffer) {
      _pdfViewerRenderPage(tab, j + 1);
    }
  }
}

// ── Page Navigation ──

function _pdfViewerGoToPage(tab, pageNum) {
  if (!tab._pdfDoc || pageNum < 1 || pageNum > tab._pdfPageCount) return;
  tab._pdfCurrentPage = pageNum;
  tab._pdfPageIndicator.textContent = pageNum + ' / ' + tab._pdfPageCount;

  var wrapper = tab._pdfPagesContainer.querySelector('[data-page-num="' + pageNum + '"]');
  if (wrapper) {
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  _pdfViewerRenderPage(tab, pageNum);
  _pdfViewerUpdateThumbActive(tab, pageNum);
}

export function _pdfViewerScrollToPage(tab, pageNum) {
  _pdfViewerGoToPage(tab, pageNum);
}

// ── Zoom ──

function _pdfViewerSetZoom(tab, newZoom, force) {
  newZoom = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, newZoom));
  if (!force && newZoom === tab._pdfZoom) return;
  tab._pdfZoom = newZoom;
  tab._pdfZoomLabel.textContent = Math.round(newZoom * 100) + '%';

  // Re-render all currently rendered pages
  tab._pdfRenderedPages = new Map();
  var wrappers = tab._pdfPagesContainer.querySelectorAll('.pdf-page-wrapper');
  for (var i = 0; i < wrappers.length; i++) {
    wrappers[i].innerHTML = '';
    wrappers[i].style.minHeight = '400px';
  }
  // Re-render visible pages
  _pdfViewerOnScroll(tab);
}

function _pdfViewerToggleZoomDropdown(tab, labelEl) {
  var existing = tab._pdfToolbar.querySelector('.pdf-zoom-dropdown');
  if (existing) { existing.remove(); return; }

  var levels = [50, 75, 100, 125, 150, 200, 300, 400];
  var menuItems = levels.map(function(pct) {
    return {
      label: pct + '%',
      handler: function() { _pdfViewerSetZoom(tab, pct / 100); }
    };
  });

  var menu = Menu(labelEl, menuItems);
  menu.show();
}

// ── Dark Mode ──

export function _pdfViewerToggleDark(tab) {
  if (!tab._pdfPagesContainer) return;
  tab._pdfDarkMode = !tab._pdfDarkMode;
  tab._pdfPagesContainer.classList.toggle('pdf-dark-render', tab._pdfDarkMode);
}

// ── Thumbnails ──

function _pdfViewerRenderThumbnails(tab) {
  if (!tab._pdfDoc || !tab._pdfThumbScroll) return;
  tab._pdfThumbScroll.innerHTML = '';

  for (var i = 1; i <= tab._pdfPageCount; i++) {
    (function(pageNum) {
      var item = new View('div')
        .className('pdf-thumb-item' + (pageNum === 1 ? ' active' : ''))
        .style('position', 'relative')
        .attr('data-thumb-page', pageNum)
        .attr('tabIndex', '0')
        .onTap(function() { _pdfViewerGoToPage(tab, pageNum); });

      // Render thumb canvas asynchronously — stays imperative (PDF.js canvas rendering)
      tab._pdfDoc.getPage(pageNum).then(function(page) {
        var vp = page.getViewport({ scale: 0.3 });
        var canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = '100%';
        canvas.style.display = 'block';
        item.el.appendChild(canvas);

        var labelEl = new View('div').className('pdf-thumb-label').text(String(pageNum));
        item.add(labelEl);

        var ctx = canvas.getContext('2d');
        page.render({ canvasContext: ctx, viewport: vp });
      });

      tab._pdfThumbScroll.appendChild(item.el);
    })(i);
  }
}

function _pdfViewerUpdateThumbActive(tab, pageNum) {
  if (!tab._pdfThumbScroll) return;
  tab._pdfThumbScroll.querySelectorAll('.pdf-thumb-item').forEach(function(el) {
    el.classList.toggle('active', parseInt(el.getAttribute('data-thumb-page')) === pageNum);
  });
  // Scroll active thumb into view
  var active = tab._pdfThumbScroll.querySelector('.pdf-thumb-item.active');
  if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    var el = new View('div')
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
  var wrapper = hlLayer.parentElement;
  var wW = wrapper.offsetWidth;
  var wH = wrapper.offsetHeight;
  tab._pdfHighlights.forEach(function(hl) {
    if (hl.pageNum !== pageNum || !hl.rects) return;
    hl.rects.forEach(function(r) {
      // Rects stored as fractions (0–1) of wrapper dimensions
      var rect = new View('div')
        .className('pdf-highlight-rect')
        .styles({
          left: (r.left * wW) + 'px',
          top: (r.top * wH) + 'px',
          width: (r.width * wW) + 'px',
          height: (r.height * wH) + 'px',
          background: hl.color || _PDF_HL_COLORS[0].color
        });
      hlLayer.appendChild(rect.el);
    });
  });
}

export function _pdfViewerAddHighlight(tab, highlight) {
  if (!tab._pdfHighlights) tab._pdfHighlights = [];
  highlight.id = _hlId();

  // Normalize rects to fractions (0–1) of wrapper dimensions
  var wrapper = tab._pdfPagesContainer.querySelector('[data-page-num="' + highlight.pageNum + '"]');
  if (wrapper && highlight.rects) {
    var wW = wrapper.offsetWidth;
    var wH = wrapper.offsetHeight;
    highlight.rects = highlight.rects.map(function(r) {
      return { left: r.left / wW, top: r.top / wH, width: r.width / wW, height: r.height / wH };
    });
  }

  tab._pdfHighlights.push(highlight);

  // Re-render the highlight layer for that page
  if (wrapper) {
    var hlLayer = wrapper.querySelector('.pdf-highlight-layer');
    if (hlLayer) {
      _pdfViewerRenderHighlightsForPage(tab, highlight.pageNum, hlLayer);
    }
  }

  // Persist to DB
  if (window.electronAPI && window.electronAPI.dbQuery && tab._pdfUrl) {
    window.electronAPI.dbQuery('highlight-save', highlight.id, tab._pdfUrl, highlight.pageNum, highlight.text || '', JSON.stringify(highlight.rects), highlight.color || '', highlight.note || '');
  }
}

export function _pdfViewerRemoveHighlight(tab, index) {
  if (!tab._pdfHighlights) return;
  var hl = tab._pdfHighlights[index];
  if (!hl) return;
  tab._pdfHighlights.splice(index, 1);
  // Re-render
  var wrapper = tab._pdfPagesContainer.querySelector('[data-page-num="' + hl.pageNum + '"]');
  if (wrapper) {
    var hlLayer = wrapper.querySelector('.pdf-highlight-layer');
    if (hlLayer) {
      hlLayer.innerHTML = '';
      _pdfViewerRenderHighlightsForPage(tab, hl.pageNum, hlLayer);
    }
  }
  // Delete from DB
  if (hl.id && window.electronAPI && window.electronAPI.dbQuery) {
    window.electronAPI.dbQuery('highlight-delete', hl.id);
  }
}

// ── Text selection → highlight popup ──

export function _pdfViewerInstallHighlightHandler(tab) {
  if (!tab._pdfPagesContainer) return;
  tab._pdfPagesContainer.addEventListener('mouseup', function(e) {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

    var text = sel.toString().trim();
    var range = sel.getRangeAt(0);
    var wrapper = range.startContainer.parentElement.closest('.pdf-page-wrapper');
    if (!wrapper) return;
    var pageNum = parseInt(wrapper.getAttribute('data-page-num'));
    if (!pageNum) return;

    // Get selection rects relative to wrapper
    var wrapperRect = wrapper.getBoundingClientRect();
    var rects = [];
    var clientRects = range.getClientRects();
    for (var i = 0; i < clientRects.length; i++) {
      var cr = clientRects[i];
      rects.push({
        left: cr.left - wrapperRect.left,
        top: cr.top - wrapperRect.top,
        width: cr.width,
        height: cr.height
      });
    }

    // Show color popup
    _showHighlightPopup(tab, e.clientX, e.clientY, text, pageNum, rects);
  });
}

function _showHighlightPopup(tab, x, y, text, pageNum, rects) {
  // Remove existing popup
  var old = document.querySelector('.pdf-highlight-popup');
  if (old) old.remove();

  var popup = new View('div')
    .className('pdf-highlight-popup')
    .cssText('position:fixed;z-index:10001;left:' + x + 'px;top:' + (y - 50) + 'px;');

  _PDF_HL_COLORS.forEach(function(c) {
    var btn = new View('button')
      .className('pdf-hl-color-btn')
      .style('background', c.color)
      .attr('title', c.name)
      .onTap(function() {
        _pdfViewerAddHighlight(tab, {
          text: text,
          pageNum: pageNum,
          rects: rects,
          color: c.color,
          note: '',
          ts: Date.now()
        });
        popup.el.remove();
        window.getSelection().removeAllRanges();
      });
    popup.add(btn);
  });

  document.body.appendChild(popup.el);

  // Auto-close
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

// ── Search ──

var _searchBar = null;

function _pdfViewerToggleSearch(tab) {
  if (_searchBar && _searchBar.parentNode) {
    _searchBar.remove();
    _searchBar = null;
    // Clear highlights
    tab._pdfPagesContainer.querySelectorAll('.pdf-search-highlight').forEach(function(el) { el.remove(); });
    return;
  }

  var countLabel = new View('span').styles({
    fontSize: '0.72rem',
    color: 'var(--nr-text-quaternary)',
    minWidth: '40px'
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
      outline: 'none'
    });

  var prevBtn = _tbBtn(icon('chevronUp', { size: 14 }), 'Previous match', function() {
    _pdfSearchPrev(tab);
  });
  var nextBtn = _tbBtn(icon('chevronDown', { size: 14 }), 'Next match', function() {
    _pdfSearchNext(tab);
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
    }, 300);
  });
  input.on('keydown', function(e) {
    if (e.key === 'Escape') _pdfViewerToggleSearch(tab);
    if (e.key === 'Enter' && e.shiftKey) { _pdfSearchPrev(tab); }
    else if (e.key === 'Enter') { _pdfSearchNext(tab); }
  });
}

function _pdfViewerDoSearch(tab, query, countLabelEl) {
  // Clear previous
  tab._pdfPagesContainer.querySelectorAll('.pdf-search-highlight').forEach(function(el) { el.remove(); });
  tab._pdfSearchMatches = [];
  tab._pdfSearchIdx = -1;
  if (!query || !tab._pdfDoc) { countLabelEl.textContent = ''; return; }

  var matchCount = 0;
  var promises = [];
  var queryLower = query.toLowerCase();

  for (var i = 1; i <= tab._pdfPageCount; i++) {
    (function(pageNum) {
      promises.push(
        tab._pdfDoc.getPage(pageNum).then(function(page) {
          var wrapper = tab._pdfPagesContainer.querySelector('[data-page-num="' + pageNum + '"]');
          if (!wrapper) return;
          var textLayer = wrapper.querySelector('.textLayer');
          if (!textLayer) return;

          var spans = textLayer.querySelectorAll('span');
          spans.forEach(function(span) {
            var text = span.textContent || '';
            var textLower = text.toLowerCase();
            var idx = textLower.indexOf(queryLower);
            while (idx !== -1) {
              matchCount++;
              // Create a highlight overlay positioned over the matching text
              var range = document.createRange();
              range.setStart(span.firstChild || span, idx);
              range.setEnd(span.firstChild || span, Math.min(idx + query.length, text.length));
              var rects = range.getClientRects();
              var wrapperRect = wrapper.getBoundingClientRect();

              for (var r = 0; r < rects.length; r++) {
                var rect = rects[r];
                var mark = document.createElement('div');
                mark.className = 'pdf-search-highlight';
                mark.style.cssText = 'position:absolute;left:' + (rect.left - wrapperRect.left) + 'px;top:' + (rect.top - wrapperRect.top) + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;background:rgba(255,165,0,0.35);border-radius:1px;pointer-events:none;z-index:5;';
                wrapper.appendChild(mark);
                tab._pdfSearchMatches.push({ el: mark, pageNum: pageNum });
              }
              idx = textLower.indexOf(queryLower, idx + 1);
            }
          });
        })
      );
    })(i);
  }

  Promise.all(promises).then(function() {
    countLabelEl.textContent = matchCount + ' match' + (matchCount !== 1 ? 'es' : '');
    // Auto-scroll to first match
    if (tab._pdfSearchMatches && tab._pdfSearchMatches.length) {
      tab._pdfSearchIdx = 0;
      _pdfSearchScrollToMatch(tab);
    }
  });
}

function _pdfSearchScrollToMatch(tab) {
  if (!tab._pdfSearchMatches || !tab._pdfSearchMatches.length) return;
  var idx = tab._pdfSearchIdx;
  if (idx < 0 || idx >= tab._pdfSearchMatches.length) return;

  // Remove active class from all, add to current
  tab._pdfSearchMatches.forEach(function(m) { m.el.classList.remove('pdf-search-active'); });
  var match = tab._pdfSearchMatches[idx];
  match.el.classList.add('pdf-search-active');
  match.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function _pdfSearchNext(tab) {
  if (!tab._pdfSearchMatches || !tab._pdfSearchMatches.length) return;
  tab._pdfSearchIdx = (tab._pdfSearchIdx + 1) % tab._pdfSearchMatches.length;
  _pdfSearchScrollToMatch(tab);
}

function _pdfSearchPrev(tab) {
  if (!tab._pdfSearchMatches || !tab._pdfSearchMatches.length) return;
  tab._pdfSearchIdx = (tab._pdfSearchIdx - 1 + tab._pdfSearchMatches.length) % tab._pdfSearchMatches.length;
  _pdfSearchScrollToMatch(tab);
}

// ── Text extraction ──

export function _pdfViewerGetText(tab, startPage, endPage) {
  if (!tab._pdfDoc) return Promise.resolve('');
  startPage = startPage || 1;
  endPage = endPage || tab._pdfPageCount;
  var pages = [];
  for (var i = startPage; i <= endPage; i++) pages.push(i);

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

var _citationPopup = null;
var _citationHideTimer = null;

function _installCitationOverlays(tab, pageNum, wrapper, textLayerDiv) {
  var attempts = 0;
  function tryInstall() {
    attempts++;
    var spans = textLayerDiv.querySelectorAll('span');
    if (!spans.length && attempts < 10) {
      setTimeout(tryInstall, 300);
      return;
    }

    // Citation overlays are pixel-positioned over the canvas — imperative DOM needed
    var citLayer = document.createElement('div');
    citLayer.className = 'pdf-citation-layer';
    wrapper.appendChild(citLayer);

    var wrapperRect = wrapper.getBoundingClientRect();

    spans.forEach(function(span) {
      var text = span.textContent;
      if (!text) return;

      var pattern = /\[(\d+(?:\s*[,\-–]\s*\d+)*)\]/g;
      var match;
      while ((match = pattern.exec(text)) !== null) {
        var refNums = _parseCitationNums(match[1]);
        if (!refNums.length) continue;

        // Try Range for precise position, fall back to whole span
        var rects = null;
        try {
          // Walk text nodes to find the one containing our match offset
          var walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
          var node, offset = 0, startNode = null, startOffset = 0, endNode = null, endOffset = 0;
          while ((node = walker.nextNode())) {
            var nodeLen = node.textContent.length;
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
            var range = document.createRange();
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
            rects = range.getClientRects();
          }
        } catch (e) {}

        // Fallback: use whole span rect
        if (!rects || !rects.length) {
          rects = [span.getBoundingClientRect()];
        }

        for (var r = 0; r < rects.length; r++) {
          var cr = rects[r];
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
  setTimeout(tryInstall, 500);
}

function _showCitationPopup(tab, refNums, x, y) {
  if (_citationHideTimer) { clearTimeout(_citationHideTimer); _citationHideTimer = null; }
  if (_citationPopup) _citationPopup.remove();

  var popup = new View('div').className('citation-popup');
  _citationPopup = popup.el;

  _populateCitationPopup(popup, tab, refNums);

  document.body.appendChild(popup.el);
  var pw = popup.el.offsetWidth;
  var ph = popup.el.offsetHeight;
  var left = Math.max(8, Math.min(x - pw / 2, window.innerWidth - pw - 8));
  var top = y - ph - 12;
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
  var state = _paperState.get(tab.id);
  var refs = state && state.refs ? state.refs : null;

  popupView.el.innerHTML = '';

  if (!refs || !refs.length) {
    AetherUI.append(
      new View('div').className('citation-popup-loading')
        .text('[' + refNums.join(', ') + '] Loading references\u2026'),
      popupView.el
    );
    // Poll until refs arrive
    var pollCount = 0;
    var pollTimer = setInterval(function() {
      pollCount++;
      if (pollCount > 20 || !_citationPopup || _citationPopup !== popupView.el) {
        clearInterval(pollTimer);
        return;
      }
      var s = _paperState.get(tab.id);
      if (s && s.refs && s.refs.length) {
        clearInterval(pollTimer);
        _populateCitationPopup(popupView, tab, refNums);
        // Reposition after content change
        var ph = popupView.el.offsetHeight;
        var curTop = parseFloat(popupView.el.style.top);
        if (curTop + ph > window.innerHeight - 8) {
          popupView.el.style.top = Math.max(8, window.innerHeight - ph - 8) + 'px';
        }
      }
    }, 500);
    return;
  }

  refNums.forEach(function(num, idx) {
    var ref = refs[num - 1];
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

    var meta = [];
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

    var linkEl = new View('a')
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
  var nums = [];
  str.split(',').forEach(function(part) {
    part = part.trim();
    var dashMatch = part.match(/(\d+)\s*[\-–]\s*(\d+)/);
    if (dashMatch) {
      var start = parseInt(dashMatch[1]);
      var end = parseInt(dashMatch[2]);
      for (var i = start; i <= end; i++) nums.push(i);
    } else {
      var n = parseInt(part);
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
