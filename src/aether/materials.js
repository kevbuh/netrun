/* Aether Materials — blur/vibrancy/translucency system
   Five tiers: ultraThin → thin → regular → thick → chrome */

(function() {
  'use strict';

  var _levels = {
    ultraThin: { blur: 4,  saturation: 110, opacity: 0.3, className: 'nr-material-ultra-thin' },
    thin:      { blur: 8,  saturation: 120, opacity: 0.4, className: 'nr-material-thin' },
    regular:   { blur: 16, saturation: 140, opacity: 0.55, className: 'nr-material-regular' },
    thick:     { blur: 24, saturation: 160, opacity: 0.7, className: 'nr-material-thick' },
    chrome:    { blur: 32, saturation: 180, opacity: 0.85, className: 'nr-material-chrome' },
  };

  // Override from tokens if available
  var _t = window.AetherTokens && window.AetherTokens.materials;
  if (_t) {
    for (var key in _t) {
      if (_levels[key]) {
        _levels[key].blur = _t[key].blur || _levels[key].blur;
        _levels[key].saturation = _t[key].saturation || _levels[key].saturation;
        _levels[key].opacity = _t[key].opacity || _levels[key].opacity;
      }
    }
  }

  var _vibrancySupported = null;

  function supportsVibrancy() {
    if (_vibrancySupported !== null) return _vibrancySupported;
    _vibrancySupported = CSS.supports('backdrop-filter', 'blur(1px)') ||
                         CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
    return _vibrancySupported;
  }

  function apply(el, level) {
    if (!el) return;
    level = level || 'regular';
    var spec = _levels[level];
    if (!spec) return;

    // Remove any existing material classes
    for (var k in _levels) {
      el.classList.remove(_levels[k].className);
    }

    if (supportsVibrancy()) {
      el.classList.add(spec.className);
    } else {
      // Fallback: just set solid background with opacity
      el.style.background = 'rgba(0, 0, 0, ' + spec.opacity + ')';
    }
  }

  function remove(el) {
    if (!el) return;
    for (var k in _levels) {
      el.classList.remove(_levels[k].className);
    }
  }

  window._AetherMaterials = {
    apply: apply,
    remove: remove,
    supportsVibrancy: supportsVibrancy,
    levels: _levels,
  };

})();
