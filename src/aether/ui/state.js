/* AetherUI State — signal-based reactivity
   State, Computed, Effect, Binding, batch */

// ─── Dependency Tracking ──────────────────────────────────

var _currentSubscriber = null;
var _batchDepth = 0;
var _batchQueue = [];
var _errorHandler = null;
var _autoBatch = false;
var _microBatchQueue = null;

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
    } else if (_autoBatch) {
      if (!_microBatchQueue) {
        _microBatchQueue = [];
        queueMicrotask(function() {
          var q = _microBatchQueue;
          _microBatchQueue = null;
          for (var j = 0; j < q.length; j++) q[j]._update();
        });
      }
      if (_microBatchQueue.indexOf(sub) === -1) _microBatchQueue.push(sub);
    } else {
      sub._update();
    }
  }
}

// ─── untrack(fn) — read signals without subscribing ──────

function untrack(fn) {
  var prev = _currentSubscriber;
  _currentSubscriber = null;
  try { return fn(); }
  finally { _currentSubscriber = prev; }
}

// ─── Dev Mode Counters ───────────────────────────────────

var _effectCount = 0;
var _signalCount = 0;
var _allSignals = null; // Set, only in dev mode
var _allEffects = null; // Set, only in dev mode

function _devInit() {
  if (window._AETHER_DEV && !_allSignals) {
    _allSignals = new Set();
    _allEffects = new Set();
  }
}

// ─── State(value, opts) — read/write signal ─────────────

function State(initial, opts) {
  var _value = initial;
  var _equals = (opts && opts.equals) || function(a, b) { return a === b; };
  var signal = {
    _subscribers: new Set(),
    _isSignal: true,
    _name: (opts && opts.name) || null,
    get value() {
      _track(signal);
      return _value;
    },
    set value(next) {
      if (_equals(next, _value)) return;
      _value = next;
      _notify(signal);
    },
    peek: function() { return _value; },
    binding: function() { return Binding(signal); },
    dispose: function() {
      signal._subscribers.clear();
      if (_allSignals) { _allSignals.delete(signal); _signalCount--; }
    }
  };
  if (window._AETHER_DEV) { _devInit(); _signalCount++; if (_allSignals) _allSignals.add(signal); }
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
        } catch (err) {
          if (_errorHandler) _errorHandler(err, 'Computed');
          else console.error('[AetherUI Computed]', err);
        } finally {
          _currentSubscriber = prev;
        }
        _dirty = false;
      }
      return _value;
    },
    peek: function() { return _value; }
  };

  signal.dispose = function() {
    signal._dependencies.forEach(function(dep) {
      dep._subscribers.delete(signal);
    });
    signal._dependencies.clear();
    signal._subscribers.clear();
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
    _isEffect: true,
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
      } catch (err) {
        if (_errorHandler) _errorHandler(err, 'Effect');
        else console.error('[AetherUI Effect]', err);
      } finally {
        _currentSubscriber = prev;
      }
    },
    dispose: function() {
      effect._dependencies.forEach(function(dep) {
        dep._subscribers.delete(effect);
      });
      effect._dependencies.clear();
      if (_allEffects) { _allEffects.delete(effect); _effectCount--; }
    }
  };

  if (window._AETHER_DEV) { _devInit(); _effectCount++; if (_allEffects) _allEffects.add(effect); }

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

// ─── Context — stack-based provide/inject ─────────────────

function Context(defaultValue) {
  var _stack = [];
  return {
    provide: function(value, fn) {
      _stack.push(value);
      try { return fn(); }
      finally { _stack.pop(); }
    },
    use: function() {
      return _stack.length > 0 ? _stack[_stack.length - 1] : defaultValue;
    }
  };
}

// ─── Store(obj) — deep reactive object ───────────────────

function Store(initial) {
  // Each path gets its own signal for fine-grained reactivity
  var _data = _deepClone(initial);
  var _signals = {};          // 'path.key' → signal
  var _rootSignal = { _subscribers: new Set(), _isSignal: true };

  function _deepClone(obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(_deepClone);
    var out = {};
    for (var k in obj) {
      if (obj.hasOwnProperty(k)) out[k] = _deepClone(obj[k]);
    }
    return out;
  }

  function _parsePath(path) {
    if (Array.isArray(path)) return path;
    return path.replace(/\[(\d+)\]/g, '.$1').split('.');
  }

  function _getByPath(obj, parts) {
    for (var i = 0; i < parts.length; i++) {
      if (obj == null) return undefined;
      obj = obj[parts[i]];
    }
    return obj;
  }

  function _setByPath(obj, parts, val) {
    for (var i = 0; i < parts.length - 1; i++) {
      var key = parts[i];
      var nextKey = parts[i + 1];
      if (obj[key] == null) {
        obj[key] = /^\d+$/.test(nextKey) ? [] : {};
      }
      obj = obj[key];
    }
    obj[parts[parts.length - 1]] = val;
  }

  function _getSignal(pathStr) {
    if (!_signals[pathStr]) {
      _signals[pathStr] = { _subscribers: new Set(), _isSignal: true };
    }
    return _signals[pathStr];
  }

  // Notify a path and all ancestor paths (skip paths without subscribers)
  function _notifyPath(parts) {
    for (var i = parts.length; i >= 0; i--) {
      var key = parts.slice(0, i).join('.');
      var sig = key ? _signals[key] : _rootSignal;
      if (sig && sig._subscribers.size > 0) _notify(sig);
    }
  }

  var store = {
    _isStore: true,
    _isSignal: true,
    _subscribers: _rootSignal._subscribers,

    // Read the whole object (tracked at root level)
    get value() {
      _track(_rootSignal);
      return _data;
    },

    // Replace the entire object
    set value(next) {
      _data = _deepClone(next);
      // Notify all path signals + root
      for (var key in _signals) _notify(_signals[key]);
      _notify(_rootSignal);
    },

    // get('user.name') — fine-grained tracked read
    get: function(path) {
      var parts = _parsePath(path);
      var pathStr = parts.join('.');
      _track(_getSignal(pathStr));
      return _getByPath(_data, parts);
    },

    // set('user.name', 'Alice') — fine-grained update
    set: function(path, val) {
      var parts = _parsePath(path);
      var old = _getByPath(_data, parts);
      if (old === val) return;
      _setByPath(_data, parts, val);
      _notifyPath(parts);
    },

    // update('user', fn) — read-modify-write at a path
    update: function(path, fn) {
      var parts = _parsePath(path);
      var old = _getByPath(_data, parts);
      var next = fn(old);
      if (old === next) return;
      _setByPath(_data, parts, next);
      _notifyPath(parts);
    },

    // delete('user') — remove a key and notify
    delete: function(path) {
      var parts = _parsePath(path);
      var parent = parts.length > 1 ? _getByPath(_data, parts.slice(0, -1)) : _data;
      if (parent != null) {
        delete parent[parts[parts.length - 1]];
        // Clean up any cached signal for this path
        var pathStr = parts.join('.');
        delete _signals[pathStr];
        _notifyPath(parts);
      }
    },

    // peek() — untracked full read
    peek: function() { return _data; }
  };

  return store;
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
  Store: Store,
  batch: batch,
  untrack: untrack,
  Context: Context,
  isSignal: isSignal,
  isBinding: isBinding,
  resolve: resolve,
  _setErrorHandler: function(fn) { _errorHandler = fn; },
  _setAutoBatch: function(v) { _autoBatch = !!v; },
  _debug: {
    get signalCount() { return _signalCount; },
    get effectCount() { return _effectCount; },
    signals: function() {
      if (!_allSignals) return [];
      var result = [];
      _allSignals.forEach(function(s) {
        result.push({ name: s._name || '(anonymous)', subscribers: s._subscribers.size, value: s.peek() });
      });
      return result;
    },
    effects: function() {
      if (!_allEffects) return [];
      var result = [];
      _allEffects.forEach(function(e) {
        result.push({ dependencies: e._dependencies.size });
      });
      return result;
    },
    graph: function() {
      if (!_allSignals) return {};
      var adj = {};
      _allSignals.forEach(function(s) {
        var name = s._name || '(anonymous)';
        adj[name] = [];
        s._subscribers.forEach(function(sub) {
          adj[name].push(sub._isEffect ? 'Effect' : sub._isComputed ? 'Computed' : 'unknown');
        });
      });
      return adj;
    },
    warnLeaks: function() {
      if (_signalCount > 100) console.warn('[AetherUI] ' + _signalCount + ' live signals — possible leak');
      if (_effectCount > 100) console.warn('[AetherUI] ' + _effectCount + ' live effects — possible leak');
    }
  }
};

// Expose primitives directly on window so they are available to scripts
// that load before the full AetherUI framework (e.g. core-state.js).
// aether-ui.js globals() will re-assign the same references later.
window.State = State;
window.Computed = Computed;
window.Effect = Effect;
window.Binding = Binding;
window.Store = Store;
window.batch = batch;
window.untrack = untrack;

export { State, Computed, Effect, Binding, Store, batch, untrack, Context, isSignal, isBinding, resolve };
