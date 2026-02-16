/* AetherUI State — signal-based reactivity
   State, Computed, Effect, Binding, batch */

(function() {
  'use strict';

  // ─── Dependency Tracking ──────────────────────────────────

  var _currentSubscriber = null;
  var _batchDepth = 0;
  var _batchQueue = [];

  function _track(signal) {
    if (_currentSubscriber) {
      signal._subscribers.add(_currentSubscriber);
      _currentSubscriber._dependencies.add(signal);
    }
  }

  function _notify(signal) {
    var subs = Array.from(signal._subscribers);
    for (var i = 0; i < subs.length; i++) {
      var sub = subs[i];
      if (_batchDepth > 0) {
        if (_batchQueue.indexOf(sub) === -1) _batchQueue.push(sub);
      } else {
        sub._update();
      }
    }
  }

  // ─── State(value) — read/write signal ─────────────────────

  function State(initial) {
    var _value = initial;
    var signal = {
      _subscribers: new Set(),
      _isSignal: true,
      get value() {
        _track(signal);
        return _value;
      },
      set value(next) {
        if (next === _value) return;
        _value = next;
        _notify(signal);
      },
      peek: function() { return _value; },
      binding: function() { return Binding(signal); }
    };
    return signal;
  }

  // ─── Computed(fn) — derived read-only signal ──────────────

  function Computed(fn) {
    var _value;
    var _dirty = true;

    var signal = {
      _subscribers: new Set(),
      _dependencies: new Set(),
      _isSignal: true,
      _isComputed: true,
      _update: function() {
        _dirty = true;
        _notify(signal);
      },
      get value() {
        _track(signal);
        if (_dirty) {
          // Unsubscribe from old deps
          signal._dependencies.forEach(function(dep) {
            dep._subscribers.delete(signal);
          });
          signal._dependencies.clear();

          var prev = _currentSubscriber;
          _currentSubscriber = signal;
          try {
            _value = fn();
          } finally {
            _currentSubscriber = prev;
          }
          _dirty = false;
        }
        return _value;
      },
      peek: function() { return _value; }
    };

    // Initial computation to set up subscriptions
    var prev = _currentSubscriber;
    _currentSubscriber = signal;
    try {
      _value = fn();
    } finally {
      _currentSubscriber = prev;
    }
    _dirty = false;

    return signal;
  }

  // ─── Effect(fn) — auto-tracking side effect ───────────────

  function Effect(fn) {
    var effect = {
      _dependencies: new Set(),
      _update: function() {
        // Unsubscribe from old deps
        effect._dependencies.forEach(function(dep) {
          dep._subscribers.delete(effect);
        });
        effect._dependencies.clear();

        var prev = _currentSubscriber;
        _currentSubscriber = effect;
        try {
          fn();
        } finally {
          _currentSubscriber = prev;
        }
      },
      dispose: function() {
        effect._dependencies.forEach(function(dep) {
          dep._subscribers.delete(effect);
        });
        effect._dependencies.clear();
      }
    };

    // Run immediately to set up subscriptions
    effect._update();
    return effect;
  }

  // ─── Binding — two-way link ───────────────────────────────

  function Binding(source, transform, inverse) {
    return {
      _isBinding: true,
      get value() {
        var v = source.value;
        return transform ? transform(v) : v;
      },
      set value(next) {
        source.value = inverse ? inverse(next) : next;
      },
      get: function() { return this.value; },
      set: function(v) { this.value = v; }
    };
  }

  // ─── batch(fn) — batch updates ────────────────────────────

  function batch(fn) {
    _batchDepth++;
    try {
      fn();
    } finally {
      _batchDepth--;
      if (_batchDepth === 0) {
        var queue = _batchQueue.slice();
        _batchQueue.length = 0;
        for (var i = 0; i < queue.length; i++) {
          queue[i]._update();
        }
      }
    }
  }

  // ─── isSignal helper ──────────────────────────────────────

  function isSignal(v) {
    return v != null && v._isSignal === true;
  }

  function isBinding(v) {
    return v != null && v._isBinding === true;
  }

  // Resolve a value that might be a signal, computed, or plain value
  function resolve(v) {
    if (v != null && (v._isSignal || v._isBinding)) return v.value;
    return v;
  }

  // ─── Export ───────────────────────────────────────────────

  window._AetherUIState = {
    State: State,
    Computed: Computed,
    Effect: Effect,
    Binding: Binding,
    batch: batch,
    isSignal: isSignal,
    isBinding: isBinding,
    resolve: resolve
  };

})();
