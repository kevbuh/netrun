// browse-pdf-viewer.js — PDF.js renderer for Nerd Mode
// Renders PDF pages with canvas + textLayer, toolbar, thumbnails, TOC, highlights, search
// Depends on: browse-state.js

import { icon } from '/js/core/icons.js';
import { _paperState } from '/js/browse/browse-paper.js';

// ── PDF.js CDN loader ──
var _pdfjsLoaded = false;
var _pdfjsLoadPromise = null;

function _ensurePdfjs() {
  if (_pdfjsLoaded && window.pdfjsLib) return Promise.resolve();
  if (_pdfjsLoadPromise) return _pdfjsLoadPromise;
  _pdfjsLoadPromise = new Promise(function(resolve, reject) {
    if (window.pdfjsLib) { _pdfjsLoaded = true; resolve(); return; }
    var script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs';
    script.type = 'module';
    script.onload = function() {
      // pdf.js 4.x exposes pdfjsLib via the module; for CDN we use the global build
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs';
        _pdfjsLoaded = true;
        resolve();
      } else {
        reject(new Error('pdfjsLib not available'));
      }
    };
    script.onerror = function() { reject(new Error('Failed to load PDF.js')); };
    document.head.appendChild(script);

    // Also load the text layer CSS
    if (!document.querySelector('link[href*="pdf_viewer.css"]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf_viewer.min.css';
      document.head.appendChild(link);
    }
  });
  return _pdfjsLoadPromise;
}

// Use the legacy global build instead of ESM for easier CDN loading
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

// ── Init ──

export function _pdfViewerInit(tab, viewerEl, pdfUrl) {
  tab._pdfCurrentPage = 1;
  tab._pdfZoom = _PDF_SCALE_DEFAULT;
  tab._pdfHighlights = tab._pdfHighlights || [];
  tab._pdfDarkMode = false;
  tab._pdfLeftPanelVisible = true;
  tab._pdfRenderedPages = new Map();

  _buildViewerDOM(tab, viewerEl);

  // Install text selection → highlight handler
  _pdfViewerInstallHighlightHandler(tab);

  _ensurePdfjsLegacy().then(function() {
    _pdfViewerLoadDoc(tab, pdfUrl);
  }).catch(function(err) {
    var msg = viewerEl.querySelector('.pdf-pages-container');
    if (msg) msg.innerHTML = '<div style="padding:40px;color:var(--nr-text-secondary);text-align:center;">Failed to load PDF.js: ' + err.message + '</div>';
  });
}

export function _pdfViewerDestroy(tab) {
  if (tab._pdfDoc) {
    tab._pdfDoc.destroy();
    tab._pdfDoc = null;
  }
  tab._pdfRenderedPages = null;
  tab._pdfCurrentPage = null;
  tab._pdfZoom = null;
}

// ── DOM Structure ──

function _buildViewerDOM(tab, viewerEl) {
  viewerEl.innerHTML = '';

  // Toolbar
  var toolbar = document.createElement('div');
  toolbar.className = 'pdf-toolbar';
  viewerEl.appendChild(toolbar);
  tab._pdfToolbar = toolbar;
  _buildToolbar(tab, toolbar);

  // Body wrapper (left panel + pages)
  var bodyWrapper = document.createElement('div');
  bodyWrapper.className = 'pdf-body-wrapper';
  viewerEl.appendChild(bodyWrapper);

  // Left panel
  var leftPanel = document.createElement('div');
  leftPanel.className = 'pdf-left-panel';
  bodyWrapper.appendChild(leftPanel);
  tab._pdfLeftPanel = leftPanel;
  _buildLeftPanel(tab, leftPanel);

  // Pages container
  var pagesContainer = document.createElement('div');
  pagesContainer.className = 'pdf-pages-container';
  if (window.Skeleton) {
    AetherUI.mount(window.Skeleton().lines(5).padding(4), pagesContainer);
  } else {
    pagesContainer.innerHTML = '<div style="padding:40px;color:var(--nr-text-secondary);text-align:center;">Loading PDF...</div>';
  }
  bodyWrapper.appendChild(pagesContainer);
  tab._pdfPagesContainer = pagesContainer;

  // Scroll listener for page tracking
  pagesContainer.addEventListener('scroll', function() {
    _pdfViewerOnScroll(tab);
  });

  // Pinch-to-zoom: Chrome/Firefox trackpad pinch fires wheel with ctrlKey
  pagesContainer.addEventListener('wheel', function(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    var delta = -e.deltaY * 0.01;
    var newZoom = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, tab._pdfZoom + delta));
    _pdfViewerSetZoom(tab, newZoom);
  }, { passive: false });

  // Pinch-to-zoom: Safari native gesture events
  var gestureBaseZoom = 1;
  pagesContainer.addEventListener('gesturestart', function(e) {
    e.preventDefault();
    gestureBaseZoom = tab._pdfZoom;
  }, { passive: false });
  pagesContainer.addEventListener('gesturechange', function(e) {
    e.preventDefault();
    var newZoom = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, gestureBaseZoom * e.scale));
    _pdfViewerSetZoom(tab, newZoom);
  }, { passive: false });
  pagesContainer.addEventListener('gestureend', function(e) {
    e.preventDefault();
  }, { passive: false });
}

function _buildToolbar(tab, toolbar) {
  // Left panel toggle
  var thumbToggle = _tbBtn(tab, 'pdf-thumb-toggle', icon('sidebarToggle', { size: 16 }), 'Thumbnails', function() {
    tab._pdfLeftPanelVisible = !tab._pdfLeftPanelVisible;
    tab._pdfLeftPanel.style.display = tab._pdfLeftPanelVisible ? '' : 'none';
    thumbToggle.classList.toggle('active', tab._pdfLeftPanelVisible);
  });
  thumbToggle.classList.add('active');
  toolbar.appendChild(thumbToggle);

  toolbar.appendChild(_tbSep());

  // Page nav
  var prevBtn = _tbBtn(tab, null, icon('chevronLeft', { size: 16 }), 'Previous page', function() {
    _pdfViewerGoToPage(tab, tab._pdfCurrentPage - 1);
  });
  toolbar.appendChild(prevBtn);

  var pageIndicator = document.createElement('span');
  pageIndicator.className = 'pdf-page-indicator';
  pageIndicator.textContent = '1 / ?';
  toolbar.appendChild(pageIndicator);
  tab._pdfPageIndicator = pageIndicator;

  var nextBtn = _tbBtn(tab, null, icon('chevronRight', { size: 16 }), 'Next page', function() {
    _pdfViewerGoToPage(tab, tab._pdfCurrentPage + 1);
  });
  toolbar.appendChild(nextBtn);

  toolbar.appendChild(_tbSep());

  // Zoom
  var zoomOut = _tbBtn(tab, null, icon('minus', { size: 16 }), 'Zoom out', function() {
    _pdfViewerSetZoom(tab, tab._pdfZoom - 0.25);
  });
  toolbar.appendChild(zoomOut);

  var zoomLabel = document.createElement('button');
  zoomLabel.className = 'pdf-zoom-label';
  zoomLabel.textContent = Math.round(tab._pdfZoom * 100) + '%';
  zoomLabel.title = 'Zoom';
  zoomLabel.addEventListener('click', function() { _pdfViewerToggleZoomDropdown(tab, zoomLabel); });
  toolbar.appendChild(zoomLabel);
  tab._pdfZoomLabel = zoomLabel;

  var zoomIn = _tbBtn(tab, null, icon('plus', { size: 16 }), 'Zoom in', function() {
    _pdfViewerSetZoom(tab, tab._pdfZoom + 0.25);
  });
  toolbar.appendChild(zoomIn);

  toolbar.appendChild(_tbSep());

  // Dark mode toggle
  var darkToggle = _tbBtn(tab, null, icon('moon', { size: 16 }), 'Dark mode', function() {
    tab._pdfDarkMode = !tab._pdfDarkMode;
    tab._pdfPagesContainer.classList.toggle('pdf-dark-render', tab._pdfDarkMode);
    darkToggle.classList.toggle('active', tab._pdfDarkMode);
  });
  toolbar.appendChild(darkToggle);

  // Highlight mode toggle
  var hlToggle = _tbBtn(tab, 'pdf-hl-mode-toggle', icon('highlighter', { size: 16 }), 'Highlight mode', function() {
    var active = tab._pdfPagesContainer.classList.toggle('pdf-hl-mode');
    hlToggle.classList.toggle('active', active);
  });
  toolbar.appendChild(hlToggle);

  // HUD mode toggle
  var hudToggle = _tbBtn(tab, null, icon('crosshair', { size: 16 }), 'HUD mode', function() {
    tab._pdfHudMode = !tab._pdfHudMode;
    var viewer = tab._nerdViewerEl || tab._pdfViewerEl;
    if (viewer) viewer.classList.toggle('nerd-hud-active', tab._pdfHudMode);
    document.body.classList.toggle('nerd-hud-active', tab._pdfHudMode);
    hudToggle.classList.toggle('hud-active', tab._pdfHudMode);
  });
  toolbar.appendChild(hudToggle);

  // Bookmark button
  var bookmarkBtn = _tbBtn(tab, null, icon('bookmark', { size: 16 }), 'Save to Reading List', function() {
    if (typeof window.browseSaveToReadingList === 'function') window.browseSaveToReadingList();
  });
  toolbar.appendChild(bookmarkBtn);

  // TTS — Read aloud
  var ttsBtn = _tbBtn(tab, 'pdf-tts-btn', icon('speaker', { size: 16 }), 'Read aloud', function() {
    if (window._ttsAudio || (window._ttsChunks && window._ttsChunks.length > 0)) {
      if (typeof window._ttsStopAll === 'function') window._ttsStopAll();
      ttsBtn.classList.remove('active');
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
      ttsBtn.classList.add('active');
    });
  });
  toolbar.appendChild(ttsBtn);

  // Spacer
  var spacer = document.createElement('div');
  spacer.style.flex = '1';
  toolbar.appendChild(spacer);

  // Search
  var searchBtn = _tbBtn(tab, null, icon('search', { size: 16 }), 'Search in PDF', function() {
    _pdfViewerToggleSearch(tab);
  });
  toolbar.appendChild(searchBtn);
}

function _tbBtn(tab, id, svgHtml, title, onClick) {
  var btn = document.createElement('button');
  btn.className = 'pdf-tb-btn';
  if (id) btn.id = id;
  btn.innerHTML = svgHtml;
  btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

function _tbSep() {
  var sep = document.createElement('div');
  sep.className = 'pdf-tb-sep';
  return sep;
}

// ── Left Panel ──

function _buildLeftPanel(tab, leftPanel) {
  // Tab bar
  var tabBar = document.createElement('div');
  tabBar.className = 'pdf-left-panel-tabs';

  var thumbTab = document.createElement('button');
  thumbTab.className = 'pdf-left-panel-tab active';
  thumbTab.textContent = 'Thumbnails';
  thumbTab.addEventListener('click', function() {
    thumbTab.classList.add('active');
    outlineTab.classList.remove('active');
    thumbScroll.style.display = '';
    outlineScroll.style.display = 'none';
  });
  tabBar.appendChild(thumbTab);

  var outlineTab = document.createElement('button');
  outlineTab.className = 'pdf-left-panel-tab';
  outlineTab.textContent = 'Outline';
  outlineTab.addEventListener('click', function() {
    outlineTab.classList.add('active');
    thumbTab.classList.remove('active');
    outlineScroll.style.display = '';
    thumbScroll.style.display = 'none';
  });
  tabBar.appendChild(outlineTab);
  leftPanel.appendChild(tabBar);

  // Content area
  var content = document.createElement('div');
  content.className = 'pdf-left-panel-content';

  var thumbScroll = document.createElement('div');
  thumbScroll.className = 'pdf-thumb-scroll';
  content.appendChild(thumbScroll);
  tab._pdfThumbScroll = thumbScroll;

  var outlineScroll = document.createElement('div');
  outlineScroll.className = 'pdf-outline-scroll';
  outlineScroll.style.display = 'none';
  content.appendChild(outlineScroll);
  tab._pdfOutlineScroll = outlineScroll;

  leftPanel.appendChild(content);
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

  }).catch(function(err) {
    if (tab._pdfPagesContainer) {
      tab._pdfPagesContainer.innerHTML = '<div style="padding:40px;color:var(--nr-text-secondary);text-align:center;">Failed to load PDF: ' + (err.message || err) + '</div>';
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

    // Canvas
    var canvas = document.createElement('canvas');
    canvas.width = viewport.width * (window.devicePixelRatio || 1);
    canvas.height = viewport.height * (window.devicePixelRatio || 1);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    wrapper.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    page.render({ canvasContext: ctx, viewport: viewport });

    // Text layer for selection
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

    // Highlight layer
    var hlLayer = document.createElement('div');
    hlLayer.className = 'pdf-highlight-layer';
    hlLayer.style.width = viewport.width + 'px';
    hlLayer.style.height = viewport.height + 'px';
    wrapper.appendChild(hlLayer);

    // Render existing highlights for this page
    _pdfViewerRenderHighlightsForPage(tab, pageNum, hlLayer, viewport);

    // Annotation layer (internal PDF links)
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

        var link = document.createElement('div');
        link.className = 'pdf-annot-link';
        link.style.cssText = 'left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;height:' + height + 'px;';

        if (ann.dest) {
          link.setAttribute('data-dest', JSON.stringify(ann.dest));
          link.addEventListener('click', function() {
            tab._pdfDoc.getDestination(ann.dest).then(function(dest) {
              if (!dest) return;
              tab._pdfDoc.getPageIndex(dest[0]).then(function(idx) {
                _pdfViewerGoToPage(tab, idx + 1);
              });
            }).catch(function() {});
          });
        } else if (ann.url) {
          link.addEventListener('click', function() {
            if (typeof browseNewTab === 'function') window.browseNewTab(ann.url);
          });
        }
        annotLayer.appendChild(link);
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

function _pdfViewerSetZoom(tab, newZoom) {
  newZoom = Math.max(_PDF_SCALE_MIN, Math.min(_PDF_SCALE_MAX, newZoom));
  if (newZoom === tab._pdfZoom) return;
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

function _pdfViewerToggleZoomDropdown(tab, label) {
  var existing = tab._pdfToolbar.querySelector('.pdf-zoom-dropdown');
  if (existing) { existing.remove(); return; }

  var dropdown = document.createElement('div');
  dropdown.className = 'pdf-zoom-dropdown';

  var levels = [50, 75, 100, 125, 150, 200, 300, 400];
  levels.forEach(function(pct) {
    var btn = document.createElement('button');
    btn.textContent = pct + '%';
    btn.addEventListener('click', function() {
      _pdfViewerSetZoom(tab, pct / 100);
      dropdown.remove();
    });
    dropdown.appendChild(btn);
  });

  // Position relative to label
  var labelWrapper = document.createElement('div');
  labelWrapper.style.cssText = 'position:relative;display:inline-block;';
  label.parentNode.insertBefore(labelWrapper, label);
  labelWrapper.appendChild(label);
  labelWrapper.appendChild(dropdown);

  setTimeout(function() {
    function closeDropdown(e) {
      if (!dropdown.contains(e.target) && e.target !== label) {
        dropdown.remove();
        // Move label back out of wrapper
        if (labelWrapper.parentNode) {
          labelWrapper.parentNode.insertBefore(label, labelWrapper);
          labelWrapper.remove();
        }
        document.removeEventListener('mousedown', closeDropdown);
      }
    }
    document.addEventListener('mousedown', closeDropdown);
  }, 0);
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
      var item = document.createElement('div');
      item.className = 'pdf-thumb-item' + (pageNum === 1 ? ' active' : '');
      item.style.position = 'relative';
      item.setAttribute('data-thumb-page', pageNum);
      item.tabIndex = 0;
      item.addEventListener('click', function() { _pdfViewerGoToPage(tab, pageNum); });

      // Render thumb asynchronously
      tab._pdfDoc.getPage(pageNum).then(function(page) {
        var vp = page.getViewport({ scale: 0.3 });
        var canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = '100%';
        canvas.style.display = 'block';
        item.appendChild(canvas);

        var label = document.createElement('div');
        label.className = 'pdf-thumb-label';
        label.textContent = String(pageNum);
        item.appendChild(label);

        var ctx = canvas.getContext('2d');
        page.render({ canvasContext: ctx, viewport: vp });
      });

      tab._pdfThumbScroll.appendChild(item);
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
      var empty = document.createElement('div');
      empty.className = 'pdf-outline-empty';
      empty.textContent = 'No outline available';
      tab._pdfOutlineScroll.appendChild(empty);
      return;
    }
    _renderOutlineItems(tab, outline, tab._pdfOutlineScroll, 0);
  });
}

function _renderOutlineItems(tab, items, container, level) {
  items.forEach(function(item) {
    var el = document.createElement('div');
    el.className = 'pdf-toc-item';
    el.style.paddingLeft = (6 + level * 14) + 'px';
    el.textContent = item.title;
    el.addEventListener('click', function() {
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
    container.appendChild(el);

    if (item.items && item.items.length) {
      _renderOutlineItems(tab, item.items, container, level + 1);
    }
  });
}

// ── Highlights ──

function _pdfViewerRenderHighlightsForPage(tab, pageNum, hlLayer, viewport) {
  if (!tab._pdfHighlights) return;
  tab._pdfHighlights.forEach(function(hl) {
    if (hl.pageNum !== pageNum || !hl.rects) return;
    hl.rects.forEach(function(r) {
      var rect = document.createElement('div');
      rect.className = 'pdf-highlight-rect';
      rect.style.left = r.left + 'px';
      rect.style.top = r.top + 'px';
      rect.style.width = r.width + 'px';
      rect.style.height = r.height + 'px';
      rect.style.background = hl.color || _PDF_HL_COLORS[0].color;
      hlLayer.appendChild(rect);
    });
  });
}

export function _pdfViewerAddHighlight(tab, highlight) {
  if (!tab._pdfHighlights) tab._pdfHighlights = [];
  tab._pdfHighlights.push(highlight);
  // Re-render the highlight layer for that page
  var wrapper = tab._pdfPagesContainer.querySelector('[data-page-num="' + highlight.pageNum + '"]');
  if (wrapper) {
    var hlLayer = wrapper.querySelector('.pdf-highlight-layer');
    if (hlLayer) {
      var viewport = { width: wrapper.offsetWidth, height: wrapper.offsetHeight };
      _pdfViewerRenderHighlightsForPage(tab, highlight.pageNum, hlLayer, viewport);
    }
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
      var viewport = { width: wrapper.offsetWidth, height: wrapper.offsetHeight };
      _pdfViewerRenderHighlightsForPage(tab, hl.pageNum, hlLayer, viewport);
    }
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

  var popup = document.createElement('div');
  popup.className = 'pdf-highlight-popup';
  popup.style.cssText = 'position:fixed;z-index:10001;left:' + x + 'px;top:' + (y - 50) + 'px;';

  _PDF_HL_COLORS.forEach(function(c) {
    var btn = document.createElement('button');
    btn.className = 'pdf-hl-color-btn';
    btn.style.background = c.color;
    btn.title = c.name;
    btn.addEventListener('click', function() {
      _pdfViewerAddHighlight(tab, {
        text: text,
        pageNum: pageNum,
        rects: rects,
        color: c.color,
        note: '',
        ts: Date.now()
      });
      popup.remove();
      window.getSelection().removeAllRanges();
    });
    popup.appendChild(btn);
  });

  document.body.appendChild(popup);

  // Auto-close
  setTimeout(function() {
    function close(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
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

  _searchBar = document.createElement('div');
  _searchBar.style.cssText = 'display:flex;gap:6px;align-items:center;padding:6px 12px;background:var(--nr-bg-surface);border-bottom:1px solid var(--nr-border-dim);';

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search in PDF...';
  input.style.cssText = 'flex:1;background:var(--nr-bg-input);border:1px solid var(--nr-border-default);border-radius:6px;padding:4px 8px;font-size:0.78rem;color:var(--nr-text-primary);outline:none;';
  _searchBar.appendChild(input);

  var countLabel = document.createElement('span');
  countLabel.style.cssText = 'font-size:0.72rem;color:var(--nr-text-quaternary);min-width:40px;';
  _searchBar.appendChild(countLabel);

  var closeBtn = document.createElement('button');
  closeBtn.className = 'pdf-tb-btn';
  closeBtn.innerHTML = icon('close', { size: 14 });
  closeBtn.addEventListener('click', function() { _pdfViewerToggleSearch(tab); });
  _searchBar.appendChild(closeBtn);

  // Insert after toolbar
  tab._pdfToolbar.parentNode.insertBefore(_searchBar, tab._pdfToolbar.nextSibling);
  input.focus();

  var searchTimer = null;
  input.addEventListener('input', function() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function() {
      _pdfViewerDoSearch(tab, input.value.trim(), countLabel);
    }, 300);
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') _pdfViewerToggleSearch(tab);
    if (e.key === 'Enter') _pdfViewerDoSearch(tab, input.value.trim(), countLabel);
  });
}

function _pdfViewerDoSearch(tab, query, countLabel) {
  // Clear previous
  tab._pdfPagesContainer.querySelectorAll('.pdf-search-highlight').forEach(function(el) { el.remove(); });
  if (!query || !tab._pdfDoc) { countLabel.textContent = ''; return; }

  var matchCount = 0;
  var promises = [];
  var queryLower = query.toLowerCase();

  for (var i = 1; i <= tab._pdfPageCount; i++) {
    (function(pageNum) {
      promises.push(
        tab._pdfDoc.getPage(pageNum).then(function(page) {
          return page.getTextContent().then(function(textContent) {
            var pageText = textContent.items.map(function(it) { return it.str; }).join(' ');
            if (pageText.toLowerCase().indexOf(queryLower) !== -1) {
              matchCount++;
              // Highlight: mark wrapper
              var wrapper = tab._pdfPagesContainer.querySelector('[data-page-num="' + pageNum + '"]');
              if (wrapper) {
                var mark = document.createElement('div');
                mark.className = 'pdf-search-highlight';
                mark.style.cssText = 'position:absolute;inset:0;border:2px solid var(--nr-accent);border-radius:2px;pointer-events:none;z-index:5;';
                wrapper.appendChild(mark);
              }
            }
          });
        })
      );
    })(i);
  }

  Promise.all(promises).then(function() {
    countLabel.textContent = matchCount + ' page' + (matchCount !== 1 ? 's' : '');
  });
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
          var overlay = document.createElement('div');
          overlay.className = 'pdf-citation-ref';
          overlay.style.cssText =
            'position:absolute;pointer-events:auto;cursor:pointer;' +
            'left:' + (cr.left - wrapperRect.left) + 'px;' +
            'top:' + (cr.top - wrapperRect.top) + 'px;' +
            'width:' + cr.width + 'px;' +
            'height:' + cr.height + 'px;';
          (function(nums) {
            overlay.addEventListener('mouseenter', function(e) {
              _showCitationPopup(tab, nums, e.clientX, e.clientY);
            });
            overlay.addEventListener('mouseleave', function() {
              _scheduleCitationHide();
            });
          })(refNums);
          citLayer.appendChild(overlay);
        }
      }
    });
  }
  setTimeout(tryInstall, 500);
}

function _showCitationPopup(tab, refNums, x, y) {
  if (_citationHideTimer) { clearTimeout(_citationHideTimer); _citationHideTimer = null; }
  if (_citationPopup) _citationPopup.remove();

  var popup = document.createElement('div');
  popup.className = 'citation-popup';
  _citationPopup = popup;

  _populateCitationPopup(popup, tab, refNums);

  document.body.appendChild(popup);
  var pw = popup.offsetWidth;
  var ph = popup.offsetHeight;
  var left = Math.max(8, Math.min(x - pw / 2, window.innerWidth - pw - 8));
  var top = y - ph - 12;
  if (top < 8) top = y + 20;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';

  popup.addEventListener('mouseenter', function() {
    if (_citationHideTimer) { clearTimeout(_citationHideTimer); _citationHideTimer = null; }
  });
  popup.addEventListener('mouseleave', function() {
    _scheduleCitationHide();
  });
}

function _populateCitationPopup(popup, tab, refNums) {
  var state = _paperState.get(tab.id);
  var refs = state && state.refs ? state.refs : null;

  popup.innerHTML = '';

  if (!refs || !refs.length) {
    popup.innerHTML = '<div class="citation-popup-loading">[' + refNums.join(', ') + '] Loading references\u2026</div>';
    // Poll until refs arrive
    var pollCount = 0;
    var pollTimer = setInterval(function() {
      pollCount++;
      if (pollCount > 20 || !_citationPopup || _citationPopup !== popup) {
        clearInterval(pollTimer);
        return;
      }
      var s = _paperState.get(tab.id);
      if (s && s.refs && s.refs.length) {
        clearInterval(pollTimer);
        _populateCitationPopup(popup, tab, refNums);
        // Reposition after content change
        var ph = popup.offsetHeight;
        var curTop = parseFloat(popup.style.top);
        if (curTop + ph > window.innerHeight - 8) {
          popup.style.top = Math.max(8, window.innerHeight - ph - 8) + 'px';
        }
      }
    }, 500);
    return;
  }

  refNums.forEach(function(num, idx) {
    var ref = refs[num - 1];
    if (!ref) return;

    if (idx > 0) {
      var sep = document.createElement('div');
      sep.style.cssText = 'border-top:1px solid var(--nr-border-dim);margin:8px 0;';
      popup.appendChild(sep);
    }

    var numEl = document.createElement('div');
    numEl.style.cssText = 'font-size:0.68rem;font-weight:600;color:var(--nr-text-quaternary);margin-bottom:2px;';
    numEl.textContent = '[' + num + ']';
    popup.appendChild(numEl);

    var titleEl = document.createElement('div');
    titleEl.className = 'citation-popup-title';
    titleEl.textContent = ref.title || 'Untitled';
    popup.appendChild(titleEl);

    var meta = [];
    if (ref.authors && ref.authors.length) {
      meta.push(ref.authors.slice(0, 3).map(function(a) { return a.name; }).join(', ') + (ref.authors.length > 3 ? ' et al.' : ''));
    }
    if (ref.year) meta.push(String(ref.year));
    if (ref.venue) meta.push(ref.venue);
    if (ref.citationCount != null) meta.push(ref.citationCount + ' citations');
    if (meta.length) {
      var metaEl = document.createElement('div');
      metaEl.className = 'citation-popup-meta';
      metaEl.textContent = meta.join(' \u00b7 ');
      popup.appendChild(metaEl);
    }

    var linkEl = document.createElement('a');
    linkEl.className = 'citation-popup-link';
    linkEl.textContent = 'Search on Google Scholar \u2192';
    linkEl.href = '#';
    linkEl.addEventListener('click', function(e) {
      e.preventDefault();
      if (typeof window.browseNewTab === 'function') window.browseNewTab('https://scholar.google.com/scholar?q=' + encodeURIComponent(ref.title));
      if (_citationPopup) { _citationPopup.remove(); _citationPopup = null; }
    });
    popup.appendChild(linkEl);
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
