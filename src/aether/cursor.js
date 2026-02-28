/**
 * Aether Cursor — Metalab-style smooth custom cursor
 * A small dot follows the mouse exactly; a larger ring follows with inertia.
 * Adapts color/style based on what's underneath.
 * Works across the main app AND inside Electron webviews / same-origin iframes.
 */

// Don't run inside webviews or iframes
if (!window.frameElement) {
_initCursor();
}

function _initCursor() {

  var dot = document.createElement('div');
  var ring = document.createElement('div');
  dot.className = 'nr-cursor-dot';
  ring.className = 'nr-cursor-ring';
  document.body.appendChild(dot);
  document.body.appendChild(ring);

  // Check localStorage for user preference (default: on)
  var startEnabled = localStorage.getItem('customCursor') !== 'off';
  if (startEnabled) {
    document.documentElement.classList.add('nr-custom-cursor');
    document.body.classList.add('nr-custom-cursor');
  } else {
    dot.style.display = 'none';
    ring.style.display = 'none';
  }

  var mouse = { x: -100, y: -100 };
  var ringPos = { x: -100, y: -100 };
  var ease = 0.15;
  var running = startEnabled;
  var currentCtx = '';
  var inWebview = false;

  function onMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;

    // Ensure custom cursor visible on re-entry (mouseenter can be unreliable)
    if (dot.classList.contains('is-hidden')) {
      dot.classList.remove('is-hidden');
      ring.classList.remove('is-hidden');
    }

    if (inWebview) {
      inWebview = false;
      detectContext(e.target);
    }

    // Text cursor detection — morph dot into I-beam over selectable text
    var target = e.target;
    var isText = false;
    var tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
      isText = true;
    } else {
      var cs = window.getComputedStyle(target);
      if (cs.cursor === 'text') {
        isText = true;
      } else if (cs.userSelect !== 'none' && cs.webkitUserSelect !== 'none') {
        var range = document.caretRangeFromPoint(e.clientX, e.clientY);
        isText = !!(range && range.startContainer && range.startContainer.nodeType === 3);
      }
    }
    setText(isText);
  }

  function onMouseEnter() {
    dot.classList.remove('is-hidden');
    ring.classList.remove('is-hidden');
    // Force cursor recalculation in webviews on window re-entry
    if (window.electronAPI && electronAPI.nudgeCursor) electronAPI.nudgeCursor();
  }

  function onMouseLeave() {
    dot.classList.add('is-hidden');
    ring.classList.add('is-hidden');
  }

  function tick() {
    if (!running) return;

    // Dot follows exactly
    dot.style.transform = 'translate(' + (mouse.x - dot.offsetWidth / 2) + 'px,' + (mouse.y - dot.offsetHeight / 2) + 'px)';

    // Ring follows with easing
    ringPos.x += (mouse.x - ringPos.x) * ease;
    ringPos.y += (mouse.y - ringPos.y) * ease;
    ring.style.transform = 'translate(' + (ringPos.x - ring.offsetWidth / 2) + 'px,' + (ringPos.y - ring.offsetHeight / 2) + 'px)';

    requestAnimationFrame(tick);
  }

  // Detect hover targets
  var hoverSelectors = 'a, button, [role="button"], input[type="submit"], .cursor-pointer, [onclick]';
  var mediaSelectors = 'img, video, canvas, svg, picture';

  // Context classes we toggle
  var ctxClasses = ['is-light', 'is-dark', 'is-media'];

  function clearCtx() {
    for (var i = 0; i < ctxClasses.length; i++) {
      dot.classList.remove(ctxClasses[i]);
      ring.classList.remove(ctxClasses[i]);
    }
    currentCtx = '';
  }

  function setCtx(cls) {
    if (currentCtx === cls) return;
    clearCtx();
    if (cls) {
      dot.classList.add(cls);
      ring.classList.add(cls);
      currentCtx = cls;
    }
  }

  function setHover(hovering) {
    if (hovering) {
      dot.classList.add('is-hovering');
      ring.classList.add('is-hovering');
    } else {
      dot.classList.remove('is-hovering');
      ring.classList.remove('is-hovering');
    }
  }

  function setText(isText) {
    if (isText) {
      dot.classList.add('is-text');
    } else {
      dot.classList.remove('is-text');
    }
  }

  /**
   * Sample the effective background luminance of an element.
   * Walks up the tree until it finds a non-transparent background.
   * Returns 0-255 (dark-light) or -1 if undetermined.
   */
  function getBgLuminance(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      var bg = window.getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        var match = bg.match(/\d+/g);
        if (match && match.length >= 3) {
          var r = parseInt(match[0]);
          var g = parseInt(match[1]);
          var b = parseInt(match[2]);
          var a = match[3] !== undefined ? parseFloat(match[3]) : 1;
          if (a < 0.1) { node = node.parentElement; continue; }
          // Relative luminance approximation
          return 0.299 * r + 0.587 * g + 0.114 * b;
        }
      }
      node = node.parentElement;
    }
    return -1;
  }

  function isClearTheme() {
    return document.documentElement.getAttribute('data-theme') === 'clear';
  }

  function detectContext(target) {
    // Clear theme: always use difference blend so cursor inverts against
    // whatever is visible through the transparent UI (desktop, webview, etc.)
    if (isClearTheme()) {
      setCtx('is-media');
      return;
    }

    // Media elements
    if (target.closest && target.closest(mediaSelectors)) {
      setCtx('is-media');
      return;
    }

    // Check if element or ancestor has data-cursor attribute
    var cursorHint = target.closest && target.closest('[data-cursor]');
    if (cursorHint) {
      var hint = cursorHint.getAttribute('data-cursor');
      if (hint === 'light') { setCtx('is-light'); return; }
      if (hint === 'dark') { setCtx('is-dark'); return; }
      if (hint === 'media') { setCtx('is-media'); return; }
    }

    // Auto-detect from background luminance
    var lum = getBgLuminance(target);
    if (lum >= 0) {
      if (lum > 180) {
        setCtx('is-dark'); // light bg → dark cursor
      } else if (lum < 60) {
        setCtx('is-light'); // dark bg → light cursor
      } else {
        clearCtx(); // mid-range → use default blend mode
      }
    } else {
      clearCtx();
    }
  }

  function onMouseOver(e) {
    var target = e.target;
    if (target.closest && target.closest(hoverSelectors)) {
      setHover(true);
    }
    detectContext(target);
  }

  function onMouseOut(e) {
    var target = e.target;
    if (target.closest && target.closest(hoverSelectors)) {
      setHover(false);
    }
  }

  function onMouseDown() {
    dot.classList.add('is-pressing');
    ring.classList.add('is-pressing');
  }

  function onMouseUp() {
    dot.classList.remove('is-pressing');
    ring.classList.remove('is-pressing');
  }

  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('mouseenter', onMouseEnter);
  document.addEventListener('mouseleave', onMouseLeave);
  document.addEventListener('mouseover', onMouseOver, { passive: true });
  document.addEventListener('mouseout', onMouseOut, { passive: true });
  document.addEventListener('mousedown', onMouseDown, { passive: true });
  document.addEventListener('mouseup', onMouseUp, { passive: true });

  requestAnimationFrame(tick);

  // ── Webview / iframe injection ──────────────────────────────────────

  // CSS injected into webviews to hide native cursor
  var WEBVIEW_CSS = '*, *::before, *::after { cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) 0 0, none !important; }';

  // JS injected into webviews to report mouse state back to parent
  var WEBVIEW_JS = '(' + function () {
    if (window.__aetherCursorInjected) return;
    window.__aetherCursorInjected = true;

    var hoverSel = 'a, button, [role="button"], input[type="submit"], [onclick]';

    document.addEventListener('mousemove', function (e) {
      var tag = e.target.tagName;
      var hovering = !!(e.target.closest && e.target.closest(hoverSel));
      var isText = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
      if (!isText) {
        try {
          var cs = window.getComputedStyle(e.target);
          if (cs.cursor === 'text') { isText = true; }
          else if (cs.userSelect !== 'none' && cs.webkitUserSelect !== 'none') {
            var cr = document.caretRangeFromPoint(e.clientX, e.clientY);
            isText = !!(cr && cr.startContainer && cr.startContainer.nodeType === 3);
          }
        } catch (ex) { /* noop */ }
      }
      var isMedia = tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'SVG' || tag === 'PICTURE';
      if (!isMedia && e.target.closest) {
        isMedia = !!e.target.closest('img, video, canvas, svg, picture');
      }
      // Sample background luminance
      var lum = -1;
      var node = e.target;
      while (node && node !== document.documentElement) {
        try {
          var bg = window.getComputedStyle(node).backgroundColor;
          if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
            var m = bg.match(/\\d+/g);
            if (m && m.length >= 3) {
              var a = m[3] !== undefined ? parseFloat(m[3]) : 1;
              if (a >= 0.1) { lum = 0.299 * parseInt(m[0]) + 0.587 * parseInt(m[1]) + 0.114 * parseInt(m[2]); break; }
            }
          }
        } catch (ex) { break; }
        node = node.parentElement;
      }
      console.log('__AETHER_CURSOR__' + JSON.stringify({
        x: e.clientX, y: e.clientY,
        hovering: hovering, text: isText, media: isMedia, lum: lum,
        iw: window.innerWidth, ih: window.innerHeight
      }));
    }, { passive: true });

    document.addEventListener('mouseleave', function () {
      console.log('__AETHER_CURSOR_LEAVE__');
    }, { passive: true });
  } + ')()';

  /**
   * Handle cursor data coming from a webview/iframe.
   * Translates webview-local coords to parent coords.
   */
  function handleWebviewCursor(frame, data) {
    var rect = frame.getBoundingClientRect();
    // When the webview is zoomed (setZoomFactor), its internal viewport shrinks
    // so clientX/Y values span a smaller range. Scale them to parent coords.
    var sx = (data.iw && data.iw > 0) ? rect.width / data.iw : 1;
    var sy = (data.ih && data.ih > 0) ? rect.height / data.ih : 1;
    mouse.x = rect.left + data.x * sx;
    mouse.y = rect.top + data.y * sy;
    inWebview = true;

    setHover(data.hovering);
    setText(data.text);

    if (isClearTheme()) {
      setCtx('is-media');
    } else if (data.media) {
      setCtx('is-media');
    } else if (data.lum >= 0) {
      if (data.lum > 180) setCtx('is-dark');
      else if (data.lum < 60) setCtx('is-light');
      else clearCtx();
    } else {
      clearCtx();
    }

    dot.classList.remove('is-hidden');
    ring.classList.remove('is-hidden');
  }

  // Track webviews/iframes for enable/disable CSS toggling
  var trackedWebviews = [];
  var trackedIframes = [];

  /**
   * Inject cursor support into an Electron <webview> element.
   */
  function injectWebview(wv) {
    if (wv._aetherCursorBound) return;
    wv._aetherCursorBound = true;
    trackedWebviews.push(wv);

    var doInject = function () {
      // Always inject JS for cursor tracking
      wv.executeJavaScript(WEBVIEW_JS).catch(function () {});
      // Only inject cursor-hiding CSS if enabled
      if (running) {
        wv.insertCSS(WEBVIEW_CSS).then(function (key) {
          wv._aetherCursorCSSKey = key;
        }).catch(function () {});
      }
    };

    // Inject on every navigation
    wv.addEventListener('dom-ready', doInject);

    // Listen for cursor messages via console
    wv.addEventListener('console-message', function (ev) {
      if (!running) return;
      var msg = ev.message;
      if (msg.indexOf('__AETHER_CURSOR__') === 0) {
        try {
          var data = JSON.parse(msg.slice(17));
          handleWebviewCursor(wv, data);
        } catch (e) { /* malformed */ }
      } else if (msg === '__AETHER_CURSOR_LEAVE__') {
        // Mouse left the webview content — parent mousemove will take over
        setHover(false);
        setText(false);
        clearCtx();
      }
    });

    // Also inject if already loaded
    try {
      if (wv.getWebContentsId && wv.getWebContentsId()) {
        doInject();
      }
    } catch (e) { /* webview not ready yet — dom-ready listener will handle it */ }
  }

  /**
   * Inject cursor support into a same-origin <iframe>.
   */
  function injectIframe(iframe) {
    if (iframe._aetherCursorBound) return;
    iframe._aetherCursorBound = true;
    trackedIframes.push(iframe);

    var tryInject = function () {
      try {
        var doc = iframe.contentDocument || iframe.contentWindow.document;
        if (!doc || doc._aetherCursorInjected) return;
        doc._aetherCursorInjected = true;

        // Hide native cursor
        var style = doc.createElement('style');
        style.textContent = WEBVIEW_CSS;
        style.id = 'aether-cursor-hide';
        if (running) doc.head.appendChild(style);
        iframe._aetherCursorStyle = style;
        iframe._aetherCursorDoc = doc;

        var iframeHoverSel = 'a, button, [role="button"], input[type="submit"], [onclick]';

        doc.addEventListener('mousemove', function (e) {
          var rect = iframe.getBoundingClientRect();
          // When iframe has CSS transform scale(), rect reflects the visual
          // (scaled) bounds but e.clientX is in the iframe's own CSS pixel space.
          // Scale internal coords to parent coords.
          var sx = iframe.clientWidth > 0 ? rect.width / iframe.clientWidth : 1;
          var sy = iframe.clientHeight > 0 ? rect.height / iframe.clientHeight : 1;
          mouse.x = rect.left + e.clientX * sx;
          mouse.y = rect.top + e.clientY * sy;
          inWebview = true;

          var target = e.target;
          var hovering = !!(target.closest && target.closest(iframeHoverSel));
          setHover(hovering);

          var tag = target.tagName;
          var isText = tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
          if (!isText) {
            try {
              var tcs = doc.defaultView.getComputedStyle(target);
              if (tcs.cursor === 'text') { isText = true; }
              else if (tcs.userSelect !== 'none' && tcs.webkitUserSelect !== 'none') {
                var cr = doc.caretRangeFromPoint(e.clientX, e.clientY);
                isText = !!(cr && cr.startContainer && cr.startContainer.nodeType === 3);
              }
            } catch (ex) { /* noop */ }
          }
          setText(isText);

          // Detect context inside iframe
          var isMedia = !!(target.closest && target.closest('img, video, canvas, svg, picture'));
          if (isMedia) { setCtx('is-media'); return; }

          // Luminance
          var node = target;
          while (node && node !== doc.documentElement) {
            try {
              var bg = doc.defaultView.getComputedStyle(node).backgroundColor;
              if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
                var m = bg.match(/\d+/g);
                if (m && m.length >= 3) {
                  var a = m[3] !== undefined ? parseFloat(m[3]) : 1;
                  if (a >= 0.1) {
                    var lum = 0.299 * parseInt(m[0]) + 0.587 * parseInt(m[1]) + 0.114 * parseInt(m[2]);
                    if (lum > 180) setCtx('is-dark');
                    else if (lum < 60) setCtx('is-light');
                    else clearCtx();
                    return;
                  }
                }
              }
            } catch (ex) { break; }
            node = node.parentElement;
          }
          clearCtx();
        }, { passive: true });

        doc.addEventListener('mouseleave', function () {
          setHover(false);
          setText(false);
          clearCtx();
        });

        dot.classList.remove('is-hidden');
        ring.classList.remove('is-hidden');
      } catch (e) {
        // Cross-origin — can't inject, cursor will just hide over the iframe
      }
    };

    iframe.addEventListener('load', tryInject);
    tryInject();
  }

  /**
   * Scan the DOM for webviews/iframes and inject cursor support.
   */
  function scanFrames() {
    var webviews = document.querySelectorAll('webview');
    for (var i = 0; i < webviews.length; i++) injectWebview(webviews[i]);

    var iframes = document.querySelectorAll('iframe');
    for (var j = 0; j < iframes.length; j++) injectIframe(iframes[j]);
  }

  // Initial scan
  scanFrames();

  // Watch for dynamically added webviews/iframes
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'WEBVIEW') injectWebview(node);
        else if (node.tagName === 'IFRAME') injectIframe(node);
        // Also check children (e.g. a container div with a webview inside)
        if (node.querySelectorAll) {
          var wvs = node.querySelectorAll('webview');
          for (var k = 0; k < wvs.length; k++) injectWebview(wvs[k]);
          var ifs = node.querySelectorAll('iframe');
          for (var l = 0; l < ifs.length; l++) injectIframe(ifs[l]);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── Public API ──────────────────────────────────────────────────────

  var api = {
    enable: function () {
      running = true;
      dot.style.display = '';
      ring.style.display = '';
      document.documentElement.classList.add('nr-custom-cursor');
      document.body.classList.add('nr-custom-cursor');
      // Re-inject cursor-hiding CSS into tracked webviews
      for (var i = 0; i < trackedWebviews.length; i++) {
        (function (wv) {
          try {
            wv.insertCSS(WEBVIEW_CSS).then(function (key) {
              wv._aetherCursorCSSKey = key;
            }).catch(function () {});
          } catch (e) { /* webview may be destroyed */ }
        })(trackedWebviews[i]);
      }
      // Re-add cursor-hiding style to tracked iframes
      for (var j = 0; j < trackedIframes.length; j++) {
        try {
          var ifr = trackedIframes[j];
          if (ifr._aetherCursorStyle && ifr._aetherCursorDoc && ifr._aetherCursorDoc.head) {
            if (!ifr._aetherCursorStyle.parentNode) {
              ifr._aetherCursorDoc.head.appendChild(ifr._aetherCursorStyle);
            }
          }
        } catch (e) { /* iframe may be destroyed */ }
      }
      requestAnimationFrame(tick);
    },
    disable: function () {
      running = false;
      dot.style.display = 'none';
      ring.style.display = 'none';
      document.documentElement.classList.remove('nr-custom-cursor');
      document.body.classList.remove('nr-custom-cursor');
      // Remove cursor-hiding CSS from tracked webviews
      for (var i = 0; i < trackedWebviews.length; i++) {
        (function (wv) {
          try {
            if (wv._aetherCursorCSSKey) {
              wv.removeInsertedCSS(wv._aetherCursorCSSKey).catch(function () {});
              wv._aetherCursorCSSKey = null;
            }
          } catch (e) { /* webview may be destroyed */ }
        })(trackedWebviews[i]);
      }
      // Remove cursor-hiding style from tracked iframes
      for (var j = 0; j < trackedIframes.length; j++) {
        try {
          var ifr = trackedIframes[j];
          if (ifr._aetherCursorStyle && ifr._aetherCursorStyle.parentNode) {
            ifr._aetherCursorStyle.parentNode.removeChild(ifr._aetherCursorStyle);
          }
        } catch (e) { /* iframe may be destroyed */ }
      }
    },
    toggle: function () {
      running ? api.disable() : api.enable();
    },
    injectWebview: injectWebview,
    injectIframe: injectIframe,
    /**
     * Momentary burst animation on the cursor ring.
     * @param {string} [color] — CSS color for the burst (defaults to accent)
     */
    pulse: function (color) {
      if (!running) return;
      ring.style.borderColor = color || 'var(--nr-accent)';
      ring.classList.remove('is-pulse');
      void ring.offsetWidth; // reflow to restart animation
      ring.classList.add('is-pulse');
      ring.addEventListener('animationend', function onEnd() {
        ring.removeEventListener('animationend', onEnd);
        ring.classList.remove('is-pulse');
        ring.style.borderColor = '';
      });
    }
  };

  if (window.Aether) {
    Aether.cursor = api;
  }
  window.AetherCursor = api;
}
