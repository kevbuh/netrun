/* AetherUI Primitives — layout, text, and media views
   VStack, HStack, ZStack, Spacer, Divider, ScrollView, Text, Label, Link, Image, Icon */

(function() {
  'use strict';

  var View = window._AetherUIView;
  var S = window._AetherUIState;

  // ─── Helper: create a View subclass ────────────────────────

  function _extend(tag) {
    function V() { View.call(this, tag); }
    V.prototype = Object.create(View.prototype);
    V.prototype.constructor = V;
    return V;
  }

  function _spaceToken(v) {
    if (typeof v === 'number') return 'var(--nr-space-' + v + ')';
    return v;
  }

  // ─── Stack Base ───────────────────────────────────────────

  function _makeStack(direction, children) {
    var v = new View('div');
    v.el.style.display = 'flex';
    v.el.style.flexDirection = direction;
    v._appendChildren(children);
    v.spacing = function(s) {
      v.el.style.gap = _spaceToken(s);
      return v;
    };
    v.alignment = function(a) {
      var crossMap = { center: 'center', leading: 'flex-start', trailing: 'flex-end', stretch: 'stretch' };
      v.el.style.alignItems = crossMap[a] || a;
      return v;
    };
    return v;
  }

  // ─── VStack ───────────────────────────────────────────────

  function VStack() {
    var children = Array.prototype.slice.call(arguments);
    // Flatten single array argument
    if (children.length === 1 && Array.isArray(children[0])) children = children[0];
    return _makeStack('column', children);
  }

  // ─── HStack ───────────────────────────────────────────────

  function HStack() {
    var children = Array.prototype.slice.call(arguments);
    if (children.length === 1 && Array.isArray(children[0])) children = children[0];
    var v = _makeStack('row', children);
    v.el.style.alignItems = 'center';
    return v;
  }

  // ─── ZStack ───────────────────────────────────────────────

  function ZStack() {
    var children = Array.prototype.slice.call(arguments);
    if (children.length === 1 && Array.isArray(children[0])) children = children[0];
    var v = new View('div');
    v.el.style.position = 'relative';
    // All children are positioned absolutely except the first (which defines size)
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child == null) continue;
      var childEl = child instanceof View ? child.build() : child;
      if (i > 0 && childEl.style) {
        childEl.style.position = 'absolute';
        childEl.style.inset = '0';
      }
      v.el.appendChild(childEl);
      if (child instanceof View && child._onAppearFn) child._onAppearFn();
    }
    v.alignment = function(a) {
      var map = {
        center: ['center', 'center'],
        topLeading: ['flex-start', 'flex-start'],
        top: ['center', 'flex-start'],
        topTrailing: ['flex-end', 'flex-start'],
        leading: ['flex-start', 'center'],
        trailing: ['flex-end', 'center'],
        bottomLeading: ['flex-start', 'flex-end'],
        bottom: ['center', 'flex-end'],
        bottomTrailing: ['flex-end', 'flex-end']
      };
      v.el.style.display = 'flex';
      v.el.style.alignItems = (map[a] || map.center)[1];
      v.el.style.justifyContent = (map[a] || map.center)[0];
      return v;
    };
    return v;
  }

  // ─── Spacer ───────────────────────────────────────────────

  function Spacer(minSize) {
    var v = new View('div');
    v.el.style.flex = '1';
    if (minSize) v.el.style.minWidth = _spaceToken(minSize);
    return v;
  }

  // ─── Divider ──────────────────────────────────────────────

  function Divider() {
    var v = new View('hr');
    v.el.style.border = 'none';
    v.el.style.borderTop = '1px solid var(--nr-border-default)';
    v.el.style.margin = '0';
    v.el.style.width = '100%';
    return v;
  }

  // ─── ScrollView ───────────────────────────────────────────

  function ScrollView() {
    var children = Array.prototype.slice.call(arguments);
    if (children.length === 1 && Array.isArray(children[0])) children = children[0];
    var v = new View('div');
    v.el.style.overflowY = 'auto';
    v.el.style.flex = '1';
    v._appendChildren(children);
    v.horizontal = function() {
      v.el.style.overflowY = '';
      v.el.style.overflowX = 'auto';
      v.el.style.display = 'flex';
      return v;
    };
    return v;
  }

  // ─── Text ─────────────────────────────────────────────────

  function Text(content) {
    var v = new View('span');
    v._bindText(content);
    v.bold = function() { v.el.style.fontWeight = '600'; return v; };
    v.italic = function() { v.el.style.fontStyle = 'italic'; return v; };
    v.mono = function() {
      v.el.style.fontFamily = (window.AetherTokens && window.AetherTokens.typography)
        ? window.AetherTokens.typography.fontMono : 'monospace';
      return v;
    };
    v.align = function(a) { v.el.style.textAlign = a; return v; };
    v.lineLimit = function(n) {
      v.el.style.display = '-webkit-box';
      v.el.style.webkitLineClamp = n;
      v.el.style.webkitBoxOrient = 'vertical';
      v.el.style.overflow = 'hidden';
      return v;
    };
    v.selectable = function() { v.el.style.userSelect = 'text'; return v; };
    return v;
  }

  // ─── Label (icon + text) ──────────────────────────────────

  function Label(text, iconName) {
    var v = HStack();
    if (iconName) v._appendChildren([Icon(iconName)]);
    v._appendChildren([Text(text)]);
    v.spacing(2);
    return v;
  }

  // ─── Link ─────────────────────────────────────────────────

  function Link(text, href) {
    var v = new View('a');
    v.el.textContent = typeof text === 'string' ? text : '';
    if (href) v.el.href = href;
    v.el.style.color = 'var(--nr-text-link)';
    v.el.style.textDecoration = 'none';
    v.el.style.cursor = 'pointer';
    return v;
  }

  // ─── Image ────────────────────────────────────────────────

  function Image(src) {
    var v = new View('img');
    if (S.isSignal(src)) {
      v.el.src = S.resolve(src);
      v._effects.push(S.Effect(function() {
        v.el.src = S.resolve(src);
      }));
    } else {
      v.el.src = src || '';
    }
    v.el.style.display = 'block';
    v.el.style.maxWidth = '100%';
    v.resizable = function() { v.el.style.objectFit = 'contain'; return v; };
    v.fill = function() { v.el.style.objectFit = 'cover'; return v; };
    v.aspectRatio = function(r) { v.el.style.aspectRatio = r; return v; };
    return v;
  }

  // ─── Icon (uses window.icon if available) ─────────────────

  function Icon(name, size) {
    var v = new View('span');
    v.el.style.display = 'inline-flex';
    v.el.style.alignItems = 'center';
    v.el.style.justifyContent = 'center';
    v.el.style.flexShrink = '0';
    if (window.icon) {
      v.el.innerHTML = window.icon(name, { size: size || 16 });
    } else {
      v.el.textContent = name;
    }
    v.size = function(s) {
      if (window.icon) v.el.innerHTML = window.icon(name, { size: s });
      return v;
    };
    return v;
  }

  // ─── RawHTML (trusted HTML string → View) ─────────────────

  function RawHTML(htmlString) {
    var v = new View('div');
    v.el.innerHTML = htmlString || '';
    return v;
  }

  // ─── Export ───────────────────────────────────────────────

  window._AetherUIPrimitives = {
    VStack: VStack, HStack: HStack, ZStack: ZStack,
    Spacer: Spacer, Divider: Divider, ScrollView: ScrollView,
    Text: Text, Label: Label, Link: Link,
    Image: Image, Icon: Icon, RawHTML: RawHTML
  };

})();
