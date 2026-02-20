/* Aether — Netrun's Design System Assembler
   Wraps all modules into a single window.Aether API.
   Loaded after tokens.js, motion.js, materials.js, ambient.js */

'use strict';

import { AetherTokens } from '/aether/tokens.js';
import { _AetherMotion } from '/aether/motion.js';
import { _AetherMaterials } from '/aether/materials.js';
import { _AetherAmbient } from '/aether/ambient.js';
import { _AetherIcons } from '/aether/icons.js';

var tokens = AetherTokens || {};
var motion = _AetherMotion || {};
var materials = _AetherMaterials || {};
var ambient = _AetherAmbient || {};
var icons = _AetherIcons || {};

// Dot-path token lookup: Aether.token('space.4') → '16px'
function token(path) {
  if (tokens.get) return tokens.get(path);
  var parts = path.split('.');
  var value = tokens;
  for (var i = 0; i < parts.length; i++) {
    if (value == null) return undefined;
    value = value[parts[i]];
  }
  return value;
}

// Component render helpers
var component = {
  button: function(text, opts) {
    opts = opts || {};
    var el = document.createElement('button');
    el.className = 'nr-btn' + (opts.variant ? ' nr-btn-' + opts.variant : ' nr-btn-primary');
    if (opts.size) el.classList.add('nr-btn-' + opts.size);
    if (opts.icon) el.classList.add('nr-btn-icon');
    if (opts.className) el.className += ' ' + opts.className;
    if (opts.icon && icons.icon) {
      el.innerHTML = icons.icon(opts.icon, { size: opts.iconSize || 14 });
      if (text) el.innerHTML += '<span>' + text + '</span>';
    } else {
      el.textContent = text;
    }
    if (opts.title) el.title = opts.title;
    if (opts.onClick) el.addEventListener('click', opts.onClick);
    if (opts.disabled) el.disabled = true;
    return el;
  },

  card: function(content, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'nr-card' + (opts.raised ? ' nr-card-raised' : '');
    if (opts.className) el.className += ' ' + opts.className;
    if (typeof content === 'string') {
      el.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      el.appendChild(content);
    }
    return el;
  },

  toast: function(text, opts) {
    // Delegate to motion toast if available, with nr-* styling
    if (motion && motion.toast) {
      return motion.toast(text, Object.assign({ className: 'nr-toast' }, opts || {}));
    }
    // Fallback
    var el = document.createElement('div');
    el.className = 'nr-toast';
    el.textContent = text;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:var(--nr-z-toast, 8000);';
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, (opts && opts.duration) || 2000);
    return el;
  }
};

var Aether = {
  tokens: tokens,
  token: token,
  motion: motion,
  pulse: motion.pulse || {},
  materials: materials,
  ambient: ambient,
  icons: icons,
  component: component,
};

window.Aether = Aether;

// Backward compat: ensure window.Motion points to the motion module
if (!window.Motion && motion) {
  window.Motion = motion;
}

export { Aether };
