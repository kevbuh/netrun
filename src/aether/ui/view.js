/* AetherUI View — base class with modifier chaining
   Every view wraps a real DOM element. Modifiers mutate and return `this`. */

'use strict';

import { isSignal, isBinding, resolve, Effect, Computed } from '/aether/ui/state.js';
import { AetherTokens } from '/aether/tokens.js';

var S = { isSignal, isBinding, resolve, Effect, Computed };
var tokens = AetherTokens;

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
  if (!name) return name;
  // Pass through raw var() expressions and raw CSS values (hex, rgb, hsl, etc.)
  if (name.startsWith('var(') || name.startsWith('#') || name.startsWith('rgb') || name.startsWith('hsl')) return name;
  // Wrap bare CSS custom property names
  if (name.startsWith('--')) return 'var(' + name + ')';
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
  this._children = [];
  this._viewType = null;
  this._onAppearFns = [];
  this._onDisappearFn = null;
  this._listeners = [];
}

var VP = View.prototype;

// Build returns the DOM element
VP.build = function() { return this.el; };

// Dispose: call onDisappear, recurse into children, clean up listeners, then dispose own effects
VP.dispose = function() {
  if (this._onDisappearFn) this._onDisappearFn();
  for (var i = 0; i < this._children.length; i++) {
    if (this._children[i].dispose) this._children[i].dispose();
  }
  this._children.length = 0;
  for (var k = 0; k < this._listeners.length; k++) {
    this.el.removeEventListener(this._listeners[k][0], this._listeners[k][1]);
  }
  this._listeners.length = 0;
  for (var j = 0; j < this._effects.length; j++) {
    if (this._effects[j].dispose) this._effects[j].dispose();
  }
  this._effects.length = 0;
};

// ─── Reactive text helper ─────────────────────────────────

VP._bindText = function(content) {
  var el = this.el;
  if (S.isSignal(content) || S.isBinding(content)) {
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

// Public reactive text modifier (delegates to _bindText)
VP.text = function(content) { return this._bindText(content); };

// ─── Reactive helper — DRY signal-aware modifier pattern ──

function _reactive(view, signal, applyFn) {
  applyFn(S.resolve(signal));
  view._effects.push(S.Effect(function() {
    applyFn(S.resolve(signal));
  }));
}

// ─── Layout Modifiers ─────────────────────────────────────

VP.padding = function(v, h) {
  if (S.isSignal(v)) {
    var el = this.el;
    _reactive(this, v, function(val) { el.style.padding = _spaceToken(val); });
  } else if (h !== undefined) {
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
  if (S.isSignal(v)) {
    var el = this.el;
    _reactive(this, v, function(val) { el.style.background = _colorToken(val); });
  } else {
    this.el.style.background = _colorToken(v);
  }
  return this;
};

VP.foreground = function(v) {
  if (S.isSignal(v)) {
    var el = this.el;
    _reactive(this, v, function(val) { el.style.color = _colorToken(val); });
  } else {
    this.el.style.color = _colorToken(v);
  }
  return this;
};

VP.font = function(name) {
  var el = this.el;
  function _applyFont(n) {
    var spec = _fontToken(n);
    if (spec) {
      el.style.fontSize = spec.size;
      el.style.fontWeight = spec.weight;
      el.style.lineHeight = spec.lineHeight;
      if (spec.tracking) el.style.letterSpacing = spec.tracking;
    } else {
      el.style.fontSize = n;
    }
  }
  if (S.isSignal(name)) {
    _reactive(this, name, _applyFont);
  } else {
    _applyFont(name);
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
    _reactive(this, v, function(val) { el.style.opacity = val; });
  } else {
    this.el.style.opacity = v;
  }
  return this;
};

VP.cornerRadius = function(v) {
  if (S.isSignal(v)) {
    var el = this.el;
    _reactive(this, v, function(val) { el.style.borderRadius = _radiusToken(val); });
  } else {
    this.el.style.borderRadius = _radiusToken(v);
  }
  return this;
};

VP.shadow = function(v) {
  var shadowMap = {
    card: '0 4px 12px var(--nr-shadow-card)',
    popup: '0 8px 32px var(--nr-shadow-popup)',
    overlay: '0 24px 64px var(--nr-shadow-overlay)'
  };
  if (S.isSignal(v)) {
    var el = this.el;
    _reactive(this, v, function(val) { el.style.boxShadow = shadowMap[val] || val; });
  } else {
    this.el.style.boxShadow = shadowMap[v] || v;
  }
  return this;
};

VP.border = function(color, width) {
  if (S.isSignal(color)) {
    var el = this.el;
    var w = width || 1;
    _reactive(this, color, function(val) { el.style.border = w + 'px solid ' + _colorToken(val || 'border-default'); });
  } else {
    this.el.style.border = (width || 1) + 'px solid ' + _colorToken(color || 'border-default');
  }
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
    this._onAppearFns.push(function() {
      motion.animate(el, config);
    });
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
  this._onAppearFns.push(fn);
  return this;
};

VP.onDisappear = function(fn) {
  this._onDisappearFn = fn;
  return this;
};

// ─── Event Modifiers ──────────────────────────────────────

VP.onTap = function(fn) {
  this.el.addEventListener('click', fn);
  this._listeners.push(['click', fn]);
  this.el.style.cursor = 'pointer';
  return this;
};

VP.onHover = function(enterFn, leaveFn) {
  if (enterFn) { this.el.addEventListener('mouseenter', enterFn); this._listeners.push(['mouseenter', enterFn]); }
  if (leaveFn) { this.el.addEventListener('mouseleave', leaveFn); this._listeners.push(['mouseleave', leaveFn]); }
  return this;
};

VP.onChange = function(fn) {
  this.el.addEventListener('change', fn);
  this._listeners.push(['change', fn]);
  return this;
};

VP.onSubmit = function(fn) {
  var handler = function(e) { e.preventDefault(); fn(e); };
  this.el.addEventListener('submit', handler);
  this._listeners.push(['submit', handler]);
  return this;
};

VP.on = function(event, fn) {
  this.el.addEventListener(event, fn);
  this._listeners.push([event, fn]);
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

VP.when = function(signal, modifierFn) {
  var self = this;
  if (S.isSignal(signal)) {
    _reactive(this, signal, function(val) {
      if (val) modifierFn(self);
    });
  } else if (signal) {
    modifierFn(this);
  }
  return this;
};

VP.html = function(content) {
  var el = this.el;
  if (S.isSignal(content)) {
    _reactive(this, content, function(val) { el.innerHTML = val || ''; });
  } else {
    el.innerHTML = content || '';
  }
  return this;
};

VP.visible = function(v) {
  if (S.isSignal(v)) {
    var el = this.el;
    _reactive(this, v, function(val) { el.style.display = val ? '' : 'none'; });
  } else {
    this.el.style.display = v ? '' : 'none';
  }
  return this;
};

VP.disabled = function(v) {
  if (S.isSignal(v)) {
    var el = this.el;
    _reactive(this, v, function(val) { el.disabled = !!val; });
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
  if (S.isSignal(v)) {
    var el = this.el;
    var _prev = '';
    _reactive(this, v, function(val) {
      if (_prev) el.classList.remove(_prev);
      if (val) { el.classList.add(val); _prev = val; }
    });
  } else {
    if (v) this.el.className += (this.el.className ? ' ' : '') + v;
  }
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

VP.styles = function(obj) {
  for (var k in obj) {
    if (obj.hasOwnProperty(k)) this.el.style[k] = obj[k];
  }
  return this;
};

VP.truncate = function() {
  this.el.style.overflow = 'hidden';
  this.el.style.textOverflow = 'ellipsis';
  this.el.style.whiteSpace = 'nowrap';
  return this;
};

VP.gap = function(v) {
  this.el.style.gap = _spaceToken(v);
  return this;
};

VP.wrap = function() {
  this.el.style.flexWrap = 'wrap';
  return this;
};

VP.textAlign = function(v) {
  this.el.style.textAlign = v;
  return this;
};

VP.margin = function(v, h) {
  if (S.isSignal(v)) {
    var el = this.el;
    _reactive(this, v, function(val) { el.style.margin = _spaceToken(val); });
  } else if (h !== undefined) {
    this.el.style.margin = _spaceToken(v) + ' ' + _spaceToken(h);
  } else {
    this.el.style.margin = _spaceToken(v);
  }
  return this;
};

VP.marginH = function(v) {
  this.el.style.marginLeft = _spaceToken(v);
  this.el.style.marginRight = _spaceToken(v);
  return this;
};

VP.marginV = function(v) {
  this.el.style.marginTop = _spaceToken(v);
  this.el.style.marginBottom = _spaceToken(v);
  return this;
};

VP.flex = function(v) {
  if (S.isSignal(v)) {
    var el = this.el;
    _reactive(this, v, function(val) { el.style.flex = val != null ? val : '1'; });
  } else {
    this.el.style.flex = v != null ? v : '1';
  }
  return this;
};

VP.cursor = function(v) {
  this.el.style.cursor = v || 'pointer';
  return this;
};

VP.position = function(v) {
  this.el.style.position = v;
  return this;
};

VP.inset = function(t, r, b, l) {
  if (t != null) this.el.style.top = typeof t === 'number' ? t + 'px' : t;
  if (r != null) this.el.style.right = typeof r === 'number' ? r + 'px' : r;
  if (b != null) this.el.style.bottom = typeof b === 'number' ? b + 'px' : b;
  if (l != null) this.el.style.left = typeof l === 'number' ? l + 'px' : l;
  return this;
};

VP.cssText = function(str) {
  this.el.style.cssText = str;
  return this;
};

VP.cssVar = function(name, val) {
  if (S.isSignal(val)) {
    var el = this.el;
    _reactive(this, val, function(v) { el.style.setProperty(name, v); });
  } else {
    this.el.style.setProperty(name, val);
  }
  return this;
};

// ─── Child management (used by container views) ───────────

VP._appendChildren = function(children) {
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (child == null) continue;
    if (child instanceof View) {
      this.el.appendChild(child.build());
      this._children.push(child);
      for (var j = 0; j < child._onAppearFns.length; j++) child._onAppearFns[j]();
    } else if (child instanceof HTMLElement) {
      this.el.appendChild(child);
    } else if (typeof child === 'string') {
      this.el.appendChild(document.createTextNode(child));
    }
  }
};

// Builder pattern: content(fn) returns children array to append
VP.content = function(fn) {
  var children = fn();
  if (Array.isArray(children)) this._appendChildren(children);
  else if (children != null) this._appendChildren([children]);
  return this;
};

// Public API for adding children after construction
VP.add = function() {
  var children = arguments.length === 1 && Array.isArray(arguments[0])
    ? arguments[0] : Array.prototype.slice.call(arguments);
  this._appendChildren(children);
  return this;
};

// ─── Export ───────────────────────────────────────────────

window._AetherUIView = View;
export { View, _spaceToken, _colorToken };
