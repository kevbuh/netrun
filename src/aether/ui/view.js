/* AetherUI View — base class with modifier chaining
   Every view wraps a real DOM element. Modifiers mutate and return `this`. */

(function() {
  'use strict';

  var S = window._AetherUIState;
  var tokens = window.AetherTokens;

  // ─── Token Resolution Helpers ─────────────────────────────

  function _spaceToken(v) {
    if (typeof v === 'number') return 'var(--nr-space-' + v + ')';
    if (typeof v === 'string' && v.match(/^\d/)) return v;
    return v;
  }

  function _radiusToken(v) {
    var map = { xs: 'xs', sm: 'sm', md: 'md', lg: 'lg', xl: 'xl', '2xl': '2xl', full: 'full' };
    if (map[v]) return 'var(--nr-radius-' + v + ')';
    return v;
  }

  function _colorToken(name) {
    var map = {
      body: '--nr-bg-body', surface: '--nr-bg-surface', raised: '--nr-bg-raised',
      sunken: '--nr-bg-sunken', overlay: '--nr-bg-overlay', input: '--nr-bg-input',
      primary: '--nr-text-primary', secondary: '--nr-text-secondary',
      tertiary: '--nr-text-tertiary', quaternary: '--nr-text-quaternary',
      inverse: '--nr-text-inverse', link: '--nr-text-link',
      accent: '--nr-accent', 'accent-hover': '--nr-accent-hover',
      'border-default': '--nr-border-default', 'border-strong': '--nr-border-strong',
      'border-subtle': '--nr-border-subtle', 'border-dim': '--nr-border-dim'
    };
    if (map[name]) return 'var(' + map[name] + ')';
    return name;
  }

  function _fontToken(name) {
    var scale = tokens && tokens.typography && tokens.typography.scale;
    // Map SwiftUI-style names to token scale names
    var nameMap = {
      largeTitle: 'largeTitle', title1: 'title1', title2: 'title2', title3: 'title3',
      headline: 'headline', body: 'body', callout: 'callout', subhead: 'subhead',
      footnote: 'footnote', caption1: 'caption1', caption2: 'caption2'
    };
    var key = nameMap[name];
    if (key && scale && scale[key]) return scale[key];
    return null;
  }

  // ─── View Base Class ──────────────────────────────────────

  function View(tag) {
    this.el = document.createElement(tag || 'div');
    this._effects = [];
    this._onAppearFn = null;
    this._onDisappearFn = null;
  }

  var VP = View.prototype;

  // Build returns the DOM element
  VP.build = function() { return this.el; };

  // Dispose all effects
  VP.dispose = function() {
    for (var i = 0; i < this._effects.length; i++) {
      if (this._effects[i].dispose) this._effects[i].dispose();
    }
    this._effects.length = 0;
  };

  // ─── Reactive text helper ─────────────────────────────────

  VP._bindText = function(content) {
    var el = this.el;
    if (S.isSignal(content) || (content && content._isBinding)) {
      el.textContent = S.resolve(content);
      this._effects.push(S.Effect(function() {
        el.textContent = S.resolve(content);
      }));
    } else if (typeof content === 'function') {
      // Treat as computed-like getter
      var comp = S.Computed(content);
      el.textContent = comp.value;
      this._effects.push(S.Effect(function() {
        el.textContent = comp.value;
      }));
    } else if (content != null) {
      el.textContent = content;
    }
    return this;
  };

  // ─── Layout Modifiers ─────────────────────────────────────

  VP.padding = function(v, h) {
    if (h !== undefined) {
      this.el.style.padding = _spaceToken(v) + ' ' + _spaceToken(h);
    } else {
      this.el.style.padding = _spaceToken(v);
    }
    return this;
  };

  VP.paddingH = function(v) {
    this.el.style.paddingLeft = _spaceToken(v);
    this.el.style.paddingRight = _spaceToken(v);
    return this;
  };

  VP.paddingV = function(v) {
    this.el.style.paddingTop = _spaceToken(v);
    this.el.style.paddingBottom = _spaceToken(v);
    return this;
  };

  VP.frame = function(opts) {
    if (!opts) return this;
    if (opts.width != null) this.el.style.width = typeof opts.width === 'number' ? opts.width + 'px' : opts.width;
    if (opts.height != null) this.el.style.height = typeof opts.height === 'number' ? opts.height + 'px' : opts.height;
    if (opts.minWidth != null) this.el.style.minWidth = typeof opts.minWidth === 'number' ? opts.minWidth + 'px' : opts.minWidth;
    if (opts.minHeight != null) this.el.style.minHeight = typeof opts.minHeight === 'number' ? opts.minHeight + 'px' : opts.minHeight;
    if (opts.maxWidth != null) this.el.style.maxWidth = typeof opts.maxWidth === 'number' ? opts.maxWidth + 'px' : opts.maxWidth;
    if (opts.maxHeight != null) this.el.style.maxHeight = typeof opts.maxHeight === 'number' ? opts.maxHeight + 'px' : opts.maxHeight;
    if (opts.alignment) {
      this.el.style.display = 'flex';
      var alignMap = {
        center: ['center', 'center'],
        leading: ['flex-start', 'center'],
        trailing: ['flex-end', 'center'],
        top: ['center', 'flex-start'],
        bottom: ['center', 'flex-end'],
        topLeading: ['flex-start', 'flex-start'],
        topTrailing: ['flex-end', 'flex-start'],
        bottomLeading: ['flex-start', 'flex-end'],
        bottomTrailing: ['flex-end', 'flex-end']
      };
      var a = alignMap[opts.alignment] || ['center', 'center'];
      this.el.style.justifyContent = a[0];
      this.el.style.alignItems = a[1];
    }
    return this;
  };

  VP.offset = function(x, y) {
    this.el.style.transform = 'translate(' + (x || 0) + 'px, ' + (y || 0) + 'px)';
    return this;
  };

  VP.zIndex = function(v) {
    var zMap = { base: 0, raised: 10, sticky: 100, overlay: 1000, modal: 5000, toast: 8000, max: 10002 };
    this.el.style.zIndex = zMap[v] != null ? zMap[v] : v;
    return this;
  };

  // ─── Styling Modifiers ────────────────────────────────────

  VP.background = function(v) {
    this.el.style.background = _colorToken(v);
    return this;
  };

  VP.foreground = function(v) {
    this.el.style.color = _colorToken(v);
    return this;
  };

  VP.font = function(name) {
    var spec = _fontToken(name);
    if (spec) {
      this.el.style.fontSize = spec.size;
      this.el.style.fontWeight = spec.weight;
      this.el.style.lineHeight = spec.lineHeight;
      if (spec.tracking) this.el.style.letterSpacing = spec.tracking;
    } else {
      this.el.style.fontSize = name;
    }
    return this;
  };

  VP.fontWeight = function(w) {
    this.el.style.fontWeight = w;
    return this;
  };

  VP.fontMono = function() {
    this.el.style.fontFamily = tokens && tokens.typography ? tokens.typography.fontMono : 'monospace';
    return this;
  };

  VP.opacity = function(v) {
    if (S.isSignal(v)) {
      var el = this.el;
      el.style.opacity = S.resolve(v);
      this._effects.push(S.Effect(function() {
        el.style.opacity = S.resolve(v);
      }));
    } else {
      this.el.style.opacity = v;
    }
    return this;
  };

  VP.cornerRadius = function(v) {
    this.el.style.borderRadius = _radiusToken(v);
    return this;
  };

  VP.shadow = function(v) {
    var shadowMap = {
      card: '0 4px 12px var(--nr-shadow-card)',
      popup: '0 8px 32px var(--nr-shadow-popup)',
      overlay: '0 24px 64px var(--nr-shadow-overlay)'
    };
    this.el.style.boxShadow = shadowMap[v] || v;
    return this;
  };

  VP.border = function(color, width) {
    this.el.style.border = (width || 1) + 'px solid ' + _colorToken(color || 'border-default');
    return this;
  };

  VP.material = function(level) {
    if (window.Aether && window.Aether.materials) {
      window.Aether.materials.apply(this.el, level || 'regular');
    }
    return this;
  };

  VP.overflow = function(v) {
    this.el.style.overflow = v || 'hidden';
    return this;
  };

  // ─── Effects / Animation Modifiers ────────────────────────

  VP.animation = function(config) {
    var el = this.el;
    var motion = window.Motion;
    if (motion && motion.animate) {
      // defer to after mount
      this._onAppearFn = function() {
        motion.animate(el, config);
      };
    }
    return this;
  };

  VP.transition = function(props, duration) {
    var parts = (typeof props === 'string' ? [props] : props).map(function(p) {
      return p + ' ' + (duration || '0.2s') + ' ease';
    });
    this.el.style.transition = parts.join(', ');
    return this;
  };

  VP.onAppear = function(fn) {
    this._onAppearFn = fn;
    return this;
  };

  VP.onDisappear = function(fn) {
    this._onDisappearFn = fn;
    return this;
  };

  // ─── Event Modifiers ──────────────────────────────────────

  VP.onTap = function(fn) {
    this.el.addEventListener('click', fn);
    this.el.style.cursor = 'pointer';
    return this;
  };

  VP.onHover = function(enterFn, leaveFn) {
    if (enterFn) this.el.addEventListener('mouseenter', enterFn);
    if (leaveFn) this.el.addEventListener('mouseleave', leaveFn);
    return this;
  };

  VP.onChange = function(fn) {
    this.el.addEventListener('change', fn);
    return this;
  };

  VP.onSubmit = function(fn) {
    this.el.addEventListener('submit', function(e) { e.preventDefault(); fn(e); });
    return this;
  };

  VP.on = function(event, fn) {
    this.el.addEventListener(event, fn);
    return this;
  };

  // ─── Conditional Modifiers ────────────────────────────────

  VP.if = function(condOrSignal, thenFn, elseFn) {
    var self = this;
    if (S.isSignal(condOrSignal)) {
      function applyCondition() {
        var val = condOrSignal.value;
        if (val && thenFn) thenFn(self);
        if (!val && elseFn) elseFn(self);
      }
      applyCondition();
      self._effects.push(S.Effect(applyCondition));
    } else {
      if (condOrSignal && thenFn) thenFn(this);
      if (!condOrSignal && elseFn) elseFn(this);
    }
    return this;
  };

  VP.visible = function(v) {
    if (S.isSignal(v)) {
      var el = this.el;
      el.style.display = v.value ? '' : 'none';
      this._effects.push(S.Effect(function() {
        el.style.display = v.value ? '' : 'none';
      }));
    } else {
      this.el.style.display = v ? '' : 'none';
    }
    return this;
  };

  VP.disabled = function(v) {
    if (S.isSignal(v)) {
      var el = this.el;
      el.disabled = S.resolve(v);
      this._effects.push(S.Effect(function() {
        el.disabled = S.resolve(v);
      }));
    } else {
      this.el.disabled = !!v;
    }
    return this;
  };

  // ─── Identity Modifiers ───────────────────────────────────

  VP.id = function(v) {
    this.el.id = v;
    return this;
  };

  VP.className = function(v) {
    if (v) this.el.className += (this.el.className ? ' ' : '') + v;
    return this;
  };

  VP.accessibilityLabel = function(v) {
    this.el.setAttribute('aria-label', v);
    return this;
  };

  VP.testId = function(v) {
    this.el.setAttribute('data-testid', v);
    return this;
  };

  VP.attr = function(k, v) {
    this.el.setAttribute(k, v);
    return this;
  };

  VP.style = function(k, v) {
    this.el.style[k] = v;
    return this;
  };

  // ─── Child management (used by container views) ───────────

  VP._appendChildren = function(children) {
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child == null) continue;
      if (child instanceof View) {
        this.el.appendChild(child.build());
        // Trigger onAppear
        if (child._onAppearFn) child._onAppearFn();
      } else if (child instanceof HTMLElement) {
        this.el.appendChild(child);
      } else if (typeof child === 'string') {
        this.el.appendChild(document.createTextNode(child));
      }
    }
  };

  // ─── Export ───────────────────────────────────────────────

  window._AetherUIView = View;

})();
