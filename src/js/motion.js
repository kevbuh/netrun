/* AetherMotion — lightweight animation framework
   Opt-in spring physics, GPU layer management, Ollama awareness.
   All existing CSS animations stay untouched. */

(function() {
  'use strict';

  // ─── 1. Design Tokens ───────────────────────────────────────

  var _springs = {
    snappy:  { tension: 300, friction: 20, mass: 1 },
    smooth:  { tension: 170, friction: 26, mass: 1 },
    gentle:  { tension: 120, friction: 14, mass: 1 },
    bouncy:  { tension: 200, friction: 10, mass: 1 }
  };

  var _durations = { instant: 100, fast: 200, normal: 350, slow: 600 };
  var _staggers  = { tight: 20, normal: 40, relaxed: 80 };

  var _springCSSMap = {
    snappy:   'cubic-bezier(0.34, 1.56, 0.64, 1)',
    smooth:   'cubic-bezier(0.25, 1.0, 0.5, 1.0)',
    gentle:   'cubic-bezier(0.22, 1.2, 0.36, 1.0)',
    bouncy:   'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    'ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)'
  };


  // ─── 2. Spring Physics Engine ───────────────────────────────

  var _springCache = new Map();
  var _CACHE_MAX = 64;

  function _simulateSpring(preset, from, to) {
    var key = preset + '|' + from + '|' + to;
    if (_springCache.has(key)) return _springCache.get(key);

    var cfg = _springs[preset] || _springs.smooth;
    var tension = cfg.tension, friction = cfg.friction, mass = cfg.mass;
    var dt = 1 / 60;
    var pos = from, vel = 0;
    var target = to;
    var frames = [from];
    var maxFrames = 90; // 1500ms at 60fps

    for (var i = 0; i < maxFrames; i++) {
      var disp = pos - target;
      var accel = (-tension * disp - friction * vel) / mass;
      vel += accel * dt;
      pos += vel * dt;
      frames.push(pos);
      if (Math.abs(pos - target) < 0.01 && Math.abs(vel) < 0.01) break;
    }
    frames[frames.length - 1] = target; // snap to exact end

    // Evict oldest if over budget
    if (_springCache.size >= _CACHE_MAX) {
      _springCache.delete(_springCache.keys().next().value);
    }
    _springCache.set(key, frames);
    return frames;
  }

  function _springKeyframes(preset, from, to) {
    var frames = _simulateSpring(preset, from, to);
    var kf = [];
    for (var i = 0; i < frames.length; i++) {
      kf.push({ offset: i / (frames.length - 1), value: frames[i] });
    }
    return kf;
  }

  function _springDuration(preset, from, to) {
    var frames = _simulateSpring(preset, from, to);
    return Math.round((frames.length / 60) * 1000);
  }


  // ─── 3. GPU Layer Manager ──────────────────────────────────

  var _promotedLayers = new Set();
  var _layerBudget = 30;

  function _promote(el) {
    if (_promotedLayers.has(el)) return;
    if (_promotedLayers.size >= _layerBudget) return; // silently skip
    el.style.willChange = 'transform, opacity';
    el.style.contain = 'layout style paint';
    _promotedLayers.add(el);
  }

  function _demote(el) {
    if (!_promotedLayers.has(el)) return;
    el.style.willChange = '';
    el.style.contain = '';
    _promotedLayers.delete(el);
  }

  function _autoDemote(el, delay) {
    setTimeout(function() { _demote(el); }, delay || 100);
  }


  // ─── 4. Animation Compositor ───────────────────────────────

  function _buildTransformValue(props) {
    var parts = [];
    if (props.x != null || props.y != null) {
      parts.push('translate(' + (props.x || 0) + 'px, ' + (props.y || 0) + 'px)');
    }
    if (props.scale != null) {
      parts.push('scale(' + props.scale + ')');
    }
    if (props.rotate != null) {
      parts.push('rotate(' + props.rotate + 'deg)');
    }
    return parts.length ? parts.join(' ') : undefined;
  }

  function _hasTransformProps(props) {
    return props.x != null || props.y != null || props.scale != null || props.rotate != null;
  }

  function _standardProps(props) {
    var result = {};
    if (props.opacity != null) result.opacity = props.opacity;
    var tf = _buildTransformValue(props);
    if (tf) result.transform = tf;
    // Pass through any direct CSS props
    if (props.transform != null) result.transform = props.transform;
    if (props.width != null) result.width = props.width;
    if (props.height != null) result.height = props.height;
    if (props.maxWidth != null) result.maxWidth = props.maxWidth;
    if (props.maxHeight != null) result.maxHeight = props.maxHeight;
    if (props.background != null) result.background = props.background;
    if (props.backgroundColor != null) result.backgroundColor = props.backgroundColor;
    if (props.color != null) result.color = props.color;
    if (props.borderRadius != null) result.borderRadius = props.borderRadius;
    if (props.boxShadow != null) result.boxShadow = props.boxShadow;
    return result;
  }

  function _animate(el, config) {
    if (!el || !config) return null;

    var preset = config.spring || 'smooth';
    var from = _standardProps(config.from || {});
    var to = _standardProps(config.to || {});
    var useSpringKeyframes = _hasTransformProps(config.from || {}) || _hasTransformProps(config.to || {});

    // Cancel existing animation on this element
    if (el._motionAnim) {
      try { el._motionAnim.cancel(); } catch(e) {}
    }

    // Auto-promote
    _promote(el);

    var keyframes, duration, easing;

    if (useSpringKeyframes && !_modelActive) {
      // Generate spring keyframes for transform properties
      var fromX = (config.from && config.from.x) || 0;
      var toX = (config.to && config.to.x) || 0;
      var fromY = (config.from && config.from.y) || 0;
      var toY = (config.to && config.to.y) || 0;
      var fromScale = (config.from && config.from.scale != null) ? config.from.scale : 1;
      var toScale = (config.to && config.to.scale != null) ? config.to.scale : 1;
      var fromOpacity = (config.from && config.from.opacity != null) ? config.from.opacity : undefined;
      var toOpacity = (config.to && config.to.opacity != null) ? config.to.opacity : undefined;

      var xFrames = (fromX !== toX) ? _simulateSpring(preset, fromX, toX) : null;
      var yFrames = (fromY !== toY) ? _simulateSpring(preset, fromY, toY) : null;
      var sFrames = (fromScale !== toScale) ? _simulateSpring(preset, fromScale, toScale) : null;
      var len = Math.max(
        xFrames ? xFrames.length : 0,
        yFrames ? yFrames.length : 0,
        sFrames ? sFrames.length : 0,
        2
      );

      keyframes = [];
      for (var i = 0; i < len; i++) {
        var f = {};
        var tx = xFrames ? xFrames[Math.min(i, xFrames.length - 1)] : toX;
        var ty = yFrames ? yFrames[Math.min(i, yFrames.length - 1)] : toY;
        var sc = sFrames ? sFrames[Math.min(i, sFrames.length - 1)] : toScale;
        var parts = [];
        if (fromX !== toX || fromY !== toY) parts.push('translate(' + tx + 'px, ' + ty + 'px)');
        if (fromScale !== toScale) parts.push('scale(' + sc + ')');
        if (parts.length) f.transform = parts.join(' ');
        if (fromOpacity != null && toOpacity != null) {
          f.opacity = fromOpacity + (toOpacity - fromOpacity) * (i / (len - 1));
        }
        f.offset = i / (len - 1);
        keyframes.push(f);
      }

      duration = Math.round((len / 60) * 1000);
      easing = 'linear'; // keyframes encode the spring curve
    } else {
      // Simple 2-keyframe with CSS easing fallback
      keyframes = [from, to];
      duration = config.duration || _durations.normal;
      easing = _springCSSMap[preset] || _springCSSMap.smooth;
    }

    // Reduced motion: collapse to instant
    if (_reducedMotion()) {
      duration = 0;
    }

    var anim = el.animate(keyframes, {
      duration: duration,
      easing: easing,
      fill: 'forwards',
      delay: config.delay || 0
    });

    el._motionAnim = anim;

    anim.finished.then(function() {
      _autoDemote(el);
      if (el._motionAnim === anim) el._motionAnim = null;
      if (config.onFinish) config.onFinish();
    }).catch(function() {
      // Animation cancelled — still demote
      _autoDemote(el);
    });

    return {
      animation: anim,
      cancel: function() {
        try { anim.cancel(); } catch(e) {}
        _autoDemote(el);
        if (el._motionAnim === anim) el._motionAnim = null;
      }
    };
  }


  // ─── 5. Sequence + Stagger ─────────────────────────────────

  function _sequence(steps) {
    var chain = Promise.resolve();
    steps.forEach(function(step) {
      chain = chain.then(function() {
        if (step.delay) {
          return new Promise(function(r) { setTimeout(r, step.delay); });
        }
        var result = _animate(step.el, step);
        return result ? result.animation.finished : Promise.resolve();
      });
    });
    return chain;
  }

  function _staggerFn(selector, config) {
    var els = document.querySelectorAll(selector);
    var stagger = config.stagger || _staggers.normal;
    var results = [];
    for (var i = 0; i < els.length; i++) {
      var elConfig = Object.assign({}, config, { delay: (config.delay || 0) + i * stagger });
      delete elConfig.stagger;
      results.push(_animate(els[i], elConfig));
    }
    return results;
  }


  // ─── 6. Ollama Awareness ───────────────────────────────────

  var _modelActive = false;
  var _ollamaInterval = null;

  function _pollOllama() {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, 2000);
    fetch('http://localhost:11434/api/ps', { signal: ctrl.signal })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        clearTimeout(timer);
        var wasActive = _modelActive;
        _modelActive = !!(data && data.models && data.models.length > 0);
        if (_modelActive !== wasActive) {
          _layerBudget = _modelActive ? 8 : 30;
          _pulseEmit('system', { label: 'ollama', detail: _modelActive ? 'model active' : 'model idle' });
        }
      })
      .catch(function() {
        clearTimeout(timer);
        _modelActive = false;
        _layerBudget = 30;
      });
  }

  function _reducedMotion() {
    return _modelActive ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Start polling after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      _pollOllama();
      _ollamaInterval = setInterval(_pollOllama, 5000);
    });
  } else {
    _pollOllama();
    _ollamaInterval = setInterval(_pollOllama, 5000);
  }


  // ─── 7. Swap + Retrigger ─────────────────────────────────

  function _swap(el, axis, callback, config) {
    if (!el) { if (callback) callback(); return; }
    config = config || {};
    var dist = config.distance || 30;
    var outDur = config.outDuration || (axis === 'y' ? 150 : 120);
    var inDur = config.inDuration || (axis === 'y' ? 200 : 150);
    var outOpacity = config.outOpacity != null ? config.outOpacity : 0;
    var inOpacity = config.inOpacity != null ? config.inOpacity : outOpacity;
    var outVal = axis === 'y' ? { y: dist } : { x: dist };
    var inVal = axis === 'y' ? { y: -dist } : { x: -dist };
    var fromOut = { opacity: 1 }; fromOut[axis] = 0;
    var toOut = { opacity: outOpacity }; toOut[axis] = outVal[axis];
    var fromIn = { opacity: inOpacity }; fromIn[axis] = inVal[axis];
    var toIn = { opacity: 1 }; toIn[axis] = 0;

    _animate(el, {
      spring: 'smooth', duration: outDur,
      from: fromOut, to: toOut,
      onFinish: function() {
        if (callback) callback();
        _animate(el, { spring: 'smooth', duration: inDur, from: fromIn, to: toIn });
      }
    });
  }

  function _retrigger(el, className, durationMs) {
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(function() { el.classList.remove(className); }, durationMs || 400);
  }


  // ─── 8. FLIP Helper ────────────────────────────────────────

  function _flip(el, callback, config) {
    var first = el.getBoundingClientRect();

    // Run the layout-changing callback
    if (typeof callback === 'function') callback();

    var last = el.getBoundingClientRect();
    var dx = first.left - last.left;
    var dy = first.top - last.top;
    var sw = first.width / (last.width || 1);
    var sh = first.height / (last.height || 1);

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sw - 1) < 0.01 && Math.abs(sh - 1) < 0.01) {
      return null; // No meaningful change
    }

    return _animate(el, Object.assign({
      spring: 'smooth',
      from: { x: dx, y: dy },
      to: { x: 0, y: 0 }
    }, config || {}));
  }


  // ─── 8. CSS Token Injection ──────────────────────────────

  function _injectTokens() {
    var root = document.documentElement.style;
    for (var name in _springCSSMap) {
      root.setProperty('--motion-' + name, _springCSSMap[name]);
    }
    for (var d in _durations) {
      root.setProperty('--motion-' + d, _durations[d] + 'ms');
    }
  }

  // Inject on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _injectTokens);
  } else {
    _injectTokens();
  }


  // ─── 9. fadeIn / fadeOut ─────────────────────────────────

  function _fadeIn(el, config) {
    if (!el) return null;
    config = config || {};
    return _animate(el, {
      spring: config.spring || 'smooth',
      duration: config.duration || _durations.fast,
      from: { opacity: 0, y: config.y || 0 },
      to: { opacity: 1, y: 0 },
      delay: config.delay || 0,
      onFinish: config.onFinish
    });
  }

  function _fadeOut(el, config) {
    if (!el) return null;
    config = config || {};
    return _animate(el, {
      spring: config.spring || 'smooth',
      duration: config.duration || _durations.fast,
      from: { opacity: 1, y: 0 },
      to: { opacity: 0, y: config.y || 0 },
      delay: config.delay || 0,
      onFinish: function() {
        if (config.remove) el.remove();
        if (config.onFinish) config.onFinish();
      }
    });
  }


  // ─── 10. Flash + Toast Helpers ──────────────────────────

  function _flash(el, holdMs) {
    if (!el) return;
    holdMs = holdMs || 1200;
    _animate(el, { duration: 200, from: { opacity: 0 }, to: { opacity: 1 } });
    setTimeout(function() {
      _animate(el, { duration: 300, from: { opacity: 1 }, to: { opacity: 0 } });
    }, holdMs);
  }

  function _toast(text, config) {
    config = config || {};
    var el = document.createElement('div');
    el.className = config.className || 'doc-selection-popup';
    el.textContent = text;
    el.style.cssText = 'position:fixed;pointer-events:none;z-index:10002;font-size:0.78rem;padding:6px 14px;'
      + (config.position === 'bottom'
        ? 'bottom:24px;left:50%;transform:translateX(-50%);background:var(--bg-card);border:1px solid var(--border-card);color:var(--text-primary);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.3);'
        : 'left:50%;top:20px;transform:translateX(-50%);');
    el.style.opacity = '0';
    document.body.appendChild(el);
    var fromY = config.position === 'bottom' ? 8 : -8;
    _animate(el, { spring: 'smooth', from: { opacity: 0, y: fromY }, to: { opacity: 1, y: 0 } });
    setTimeout(function() {
      _animate(el, { spring: 'smooth', from: { opacity: 1 }, to: { opacity: 0 }, onFinish: function() { el.remove(); } });
    }, config.duration || 1500);
    return el;
  }


  // ─── 9. Live Pulse — Event Bus ────────────────────────────

  var _pulseListeners = [];
  var _pulseRecent = [];
  var _PULSE_MAX = 50;
  var _pulseStats = { ai: 0, network: 0, embed: 0, feed: 0, quality: 0, system: 0 };
  var _pulseStatsWindow = [];  // timestamps for events/sec calc
  var _PULSE_WINDOW_MS = 3000;

  var _pulseUrlMap = [
    { prefix: '/api/doc-chat', cat: 'ai' },
    { prefix: '/api/panel-suggest', cat: 'ai' },
    { prefix: '/api/search-suggest', cat: 'ai' },
    { prefix: '/api/embed-content', cat: 'embed' },
    { prefix: '/api/semantic-search', cat: 'embed' },
    { prefix: '/api/find-similar', cat: 'embed' },
    { prefix: '/api/quality-filter', cat: 'quality' },
    { prefix: '/api/quality-prompt', cat: 'quality' },
    { prefix: '/api/blocked-titles', cat: 'quality' },
    { prefix: '/api/feed-items', cat: 'feed' },
    { prefix: '/feed', cat: 'feed' },
    { prefix: '/hn-feed', cat: 'feed' },
    { prefix: '/polymarket-feed', cat: 'feed' },
    { prefix: '/api/rss-proxy', cat: 'feed' }
  ];

  function _classifyUrl(url) {
    var path = url;
    try { path = new URL(url, location.origin).pathname; } catch(e) {}
    for (var i = 0; i < _pulseUrlMap.length; i++) {
      if (path.indexOf(_pulseUrlMap[i].prefix) === 0) return _pulseUrlMap[i].cat;
    }
    if (path.indexOf('/api/') === 0) return 'network';
    return null;  // non-api, skip
  }

  function _shortUrl(url) {
    var path = url;
    try { path = new URL(url, location.origin).pathname; } catch(e) {}
    // Strip /api/ prefix for brevity
    if (path.indexOf('/api/') === 0) return path.slice(5);
    return path.slice(1);
  }

  function _pulseEmit(category, data) {
    var now = Date.now();
    var evt = {
      category: category,
      label: (data && data.label) || '',
      detail: (data && data.detail) || '',
      timestamp: now,
      duration: null,
      ok: null,
      done: function(success) {
        evt.duration = Date.now() - now;
        evt.ok = success;
      }
    };
    _pulseRecent.push(evt);
    if (_pulseRecent.length > _PULSE_MAX) _pulseRecent.shift();
    _pulseStats[category] = (_pulseStats[category] || 0) + 1;
    _pulseStatsWindow.push(now);
    // Trim old window entries
    while (_pulseStatsWindow.length && _pulseStatsWindow[0] < now - _PULSE_WINDOW_MS) _pulseStatsWindow.shift();
    for (var i = 0; i < _pulseListeners.length; i++) {
      try { _pulseListeners[i](evt); } catch(e) {}
    }
    return evt;
  }

  function _pulseRate() {
    var now = Date.now();
    while (_pulseStatsWindow.length && _pulseStatsWindow[0] < now - _PULSE_WINDOW_MS) _pulseStatsWindow.shift();
    return _pulseStatsWindow.length / (_PULSE_WINDOW_MS / 1000);
  }

  // Monkey-patch fetch
  var _origFetch = window.fetch;
  window.fetch = function(url, opts) {
    var urlStr = (typeof url === 'string') ? url : (url && url.url) || '';
    // Skip Ollama polling — too noisy
    if (urlStr.indexOf('localhost:11434') !== -1) return _origFetch.apply(this, arguments);
    var category = _classifyUrl(urlStr);
    if (!category) return _origFetch.apply(this, arguments);
    var evt = _pulseEmit(category, { label: _shortUrl(urlStr), detail: (opts && opts.method) || 'GET' });
    return _origFetch.apply(this, arguments).then(function(resp) {
      evt.done(resp.ok);
      return resp;
    }).catch(function(err) {
      evt.done(false);
      throw err;
    });
  };

  var _pulse = {
    emit: _pulseEmit,
    on: function(fn) { _pulseListeners.push(fn); },
    off: function(fn) { var i = _pulseListeners.indexOf(fn); if (i !== -1) _pulseListeners.splice(i, 1); },
    get stats() { return _pulseStats; },
    get recent() { return _pulseRecent; },
    get rate() { return _pulseRate(); }
  };


  // ─── Public API ────────────────────────────────────────────

  window.Motion = {
    // Design tokens
    spring:   _springs,
    duration: _durations,
    stagger:  _staggers,

    // Spring utilities
    css: function(preset) {
      return _springCSSMap[preset] || _springCSSMap.smooth;
    },
    keyframes: function(preset, from, to) {
      return _springKeyframes(preset, from, to);
    },

    // Core animation
    animate:   _animate,
    sequence:  _sequence,
    staggerFn: _staggerFn,

    // GPU layer management
    promote: _promote,
    demote:  _demote,
    get layerCount()  { return _promotedLayers.size; },
    get layerBudget() { return _layerBudget; },

    // Ollama awareness
    get modelActive()   { return _modelActive; },
    get reducedMotion() { return _reducedMotion(); },

    // Helpers
    fadeIn:  _fadeIn,
    fadeOut: _fadeOut,
    flash: _flash,
    toast: _toast,
    injectTokens: _injectTokens,

    // Transitions
    swap: _swap,
    retrigger: _retrigger,

    // FLIP
    flip: _flip,

    // Live Pulse
    pulse: _pulse
  };

})();
