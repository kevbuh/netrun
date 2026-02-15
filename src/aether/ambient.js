/* Aether Ambient — breathing animations, living UI
   Pauses when Ollama model is active or prefers-reduced-motion */

(function() {
  'use strict';

  var _active = true;
  var _pausedByModel = false;
  var _el = null; // cached style element

  function _getStyleEl() {
    if (_el) return _el;
    _el = document.getElementById('nr-ambient-state');
    if (!_el) {
      _el = document.createElement('style');
      _el.id = 'nr-ambient-state';
      document.head.appendChild(_el);
    }
    return _el;
  }

  function _updateState() {
    var style = _getStyleEl();
    if (!_active) {
      style.textContent = '.nr-breathe, .nr-glow, .nr-living-gradient { animation-play-state: paused !important; }';
    } else {
      style.textContent = '';
    }
  }

  function pause() {
    _active = false;
    _updateState();
  }

  function resume() {
    _active = true;
    _pausedByModel = false;
    _updateState();
  }

  // Watch for Ollama model activity via Motion's modelActive
  function _watchOllama() {
    setInterval(function() {
      var modelActive = window.Motion && window.Motion.modelActive;
      if (modelActive && _active && !_pausedByModel) {
        _pausedByModel = true;
        pause();
      } else if (!modelActive && _pausedByModel) {
        _pausedByModel = false;
        resume();
      }
    }, 2000);
  }

  // Respect prefers-reduced-motion
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) pause();
    mq.addEventListener('change', function(e) {
      if (e.matches) pause();
      else resume();
    });
  }

  // Start watching after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _watchOllama);
  } else {
    _watchOllama();
  }

  window._AetherAmbient = {
    get active() { return _active; },
    pause: pause,
    resume: resume,
  };

})();
