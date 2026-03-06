import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Import state primitives directly (they use relative paths, not browser absolute) ──
import {
  State, Computed, Effect, Binding,
  isSignal, isBinding, resolve
} from './state.js';

// ── Re-implement View as a minimal test-friendly version ──
// The real View lives in view.js which imports from '/aether/ui/state.js' (browser path)
// and '/aether/tokens.js', so we replicate the subset that controls.js depends on.

function _spaceToken(v) {
  if (typeof v === 'number') return 'var(--nr-space-' + v + ')';
  if (typeof v === 'string' && v.match(/^\d/)) return v;
  return v;
}

function _colorToken(name) {
  if (!name) return name;
  if (name.startsWith('var(') || name.startsWith('#') || name.startsWith('rgb') || name.startsWith('hsl')) return name;
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

function View(tag) {
  this.el = document.createElement(tag || 'div');
  this._effects = [];
  this._children = [];
  this._viewType = null;
  this._onAppearFns = [];
  this._onDisappearFn = null;
  this._listeners = [];
}

View.prototype.build = function() { return this.el; };

View.prototype.dispose = function() {
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

View.prototype._bindText = function(content) {
  var el = this.el;
  if (isSignal(content) || isBinding(content)) {
    el.textContent = resolve(content);
    this._effects.push(Effect(function() {
      el.textContent = resolve(content);
    }));
  } else if (typeof content === 'function') {
    var comp = Computed(content);
    el.textContent = comp.value;
    this._effects.push(Effect(function() {
      el.textContent = comp.value;
    }));
  } else if (content != null) {
    el.textContent = content;
  }
  return this;
};

View.prototype.text = function(content) { return this._bindText(content); };

View.prototype._appendChildren = function(children) {
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

View.prototype.add = function() {
  var children = arguments.length === 1 && Array.isArray(arguments[0])
    ? arguments[0] : Array.prototype.slice.call(arguments);
  this._appendChildren(children);
  return this;
};

View.prototype.onTap = function(fn) {
  this.el.addEventListener('click', fn);
  this._listeners.push(['click', fn]);
  this.el.style.cursor = 'pointer';
  return this;
};

View.prototype.onChange = function(fn) {
  this.el.addEventListener('change', fn);
  this._listeners.push(['change', fn]);
  return this;
};

View.prototype.on = function(event, fn) {
  this.el.addEventListener(event, fn);
  this._listeners.push([event, fn]);
  return this;
};

View.prototype.padding = function(v, h) {
  if (h !== undefined) {
    this.el.style.padding = _spaceToken(v) + ' ' + _spaceToken(h);
  } else {
    this.el.style.padding = _spaceToken(v);
  }
  return this;
};

View.prototype.frame = function(opts) {
  if (!opts) return this;
  if (opts.width != null) this.el.style.width = typeof opts.width === 'number' ? opts.width + 'px' : opts.width;
  if (opts.height != null) this.el.style.height = typeof opts.height === 'number' ? opts.height + 'px' : opts.height;
  if (opts.minWidth != null) this.el.style.minWidth = typeof opts.minWidth === 'number' ? opts.minWidth + 'px' : opts.minWidth;
  if (opts.minHeight != null) this.el.style.minHeight = typeof opts.minHeight === 'number' ? opts.minHeight + 'px' : opts.minHeight;
  if (opts.maxWidth != null) this.el.style.maxWidth = typeof opts.maxWidth === 'number' ? opts.maxWidth + 'px' : opts.maxWidth;
  if (opts.maxHeight != null) this.el.style.maxHeight = typeof opts.maxHeight === 'number' ? opts.maxHeight + 'px' : opts.maxHeight;
  return this;
};

View.prototype.font = function() { return this; };
View.prototype.foreground = function() { return this; };
View.prototype.background = function() { return this; };
View.prototype.style = function(k, v) { this.el.style[k] = v; return this; };
View.prototype.cornerRadius = function() { return this; };
View.prototype.opacity = function() { return this; };
View.prototype.id = function(v) { this.el.id = v; return this; };
View.prototype.className = function(v) { if (v) this.el.className += (this.el.className ? ' ' : '') + v; return this; };
View.prototype.disabled = function(v) { this.el.disabled = !!v; return this; };
View.prototype.visible = function(v) { this.el.style.display = v ? '' : 'none'; return this; };

// ── Minimal primitives used by controls.js (Stepper, FormField) ──

function HStack() {
  var children = arguments.length === 1 && Array.isArray(arguments[0])
    ? arguments[0] : Array.prototype.slice.call(arguments);
  var v = new View('div');
  v.el.style.display = 'flex';
  v.el.style.flexDirection = 'row';
  v.el.style.alignItems = 'center';
  v.spacing = function(s) { v.el.style.gap = _spaceToken(s); return v; };
  v._appendChildren(children.filter(Boolean));
  return v;
}

function VStack() {
  var children = arguments.length === 1 && Array.isArray(arguments[0])
    ? arguments[0] : Array.prototype.slice.call(arguments);
  var v = new View('div');
  v.el.style.display = 'flex';
  v.el.style.flexDirection = 'column';
  v.spacing = function(s) { v.el.style.gap = _spaceToken(s); return v; };
  v._appendChildren(children.filter(Boolean));
  return v;
}

function Text(content) {
  var v = new View('span');
  v._bindText(content);
  v.bold = function() { v.el.style.fontWeight = '600'; return v; };
  v.italic = function() { v.el.style.fontStyle = 'italic'; return v; };
  return v;
}

function Icon() { return new View('span'); }

// ── Replicate controls.js logic using our local View + State ──
// We reproduce the control constructors inline (they depend on View, state, and primitives).

var S = { isSignal, isBinding, resolve, Effect, Computed, State };

// ─── Button ───────────────────────────────────────────────

var _BTN_VARIANTS = ['nr-btn-primary', 'nr-btn-secondary', 'nr-btn-ghost', 'nr-btn-danger'];

function _setBtnVariant(el, variant) {
  el.classList.remove.apply(el.classList, _BTN_VARIANTS);
  el.classList.add(variant);
}

function Button(label) {
  var v = new View('button');
  v._viewType = 'Button';
  v.el.className = 'nr-btn nr-btn-primary';
  v._bindText(label);
  v.primary   = function() { _setBtnVariant(v.el, 'nr-btn-primary');   return v; };
  v.secondary = function() { _setBtnVariant(v.el, 'nr-btn-secondary'); return v; };
  v.ghost     = function() { _setBtnVariant(v.el, 'nr-btn-ghost');     return v; };
  v.danger    = function() { _setBtnVariant(v.el, 'nr-btn-danger');    return v; };
  v.small = function() { v.el.classList.add('nr-btn-sm'); return v; };
  v.large = function() { v.el.classList.add('nr-btn-lg'); return v; };
  v.iconButton = function(iconName) {
    v.el.classList.add('nr-btn-icon');
    if (iconName && window.icon) {
      v.el.innerHTML = window.icon(iconName, { size: 14 });
    }
    return v;
  };
  v.icon = function(name, position) {
    if (!window.icon) return v;
    var iconHtml = window.icon(name, { size: 14 });
    var labelText = v.el.textContent;
    if (position === 'trailing') {
      v.el.innerHTML = '<span>' + labelText + '</span> ' + iconHtml;
    } else {
      v.el.innerHTML = iconHtml + ' <span>' + labelText + '</span>';
    }
    v.el.style.display = 'inline-flex';
    v.el.style.alignItems = 'center';
    v.el.style.gap = 'var(--nr-space-2)';
    return v;
  };
  return v;
}

// ─── TextField ────────────────────────────────────────────

function TextField(placeholderOrBinding, placeholder) {
  var v = new View('input');
  v._viewType = 'TextField';
  v.el.type = 'text';
  v.el.className = 'nr-input';
  var binding = null;
  if (placeholderOrBinding && (S.isSignal(placeholderOrBinding) || S.isBinding(placeholderOrBinding))) {
    binding = placeholderOrBinding;
    if (placeholder) v.el.placeholder = placeholder;
  } else if (typeof placeholderOrBinding === 'string') {
    v.el.placeholder = placeholderOrBinding;
  }
  if (binding) {
    v.el.value = S.resolve(binding);
    v.el.addEventListener('input', function() {
      if (S.isSignal(binding)) binding.value = v.el.value;
      else if (S.isBinding(binding)) binding.value = v.el.value;
    });
    v._effects.push(S.Effect(function() {
      var val = S.resolve(binding);
      if (v.el.value !== val) v.el.value = val;
    }));
  }
  var _bindListener = null;
  v.bind = function(b) {
    if (_bindListener) v.el.removeEventListener('input', _bindListener);
    v.el.value = S.resolve(b);
    _bindListener = function() { b.value = v.el.value; };
    v.el.addEventListener('input', _bindListener);
    v._effects.push(S.Effect(function() {
      var val = S.resolve(b);
      if (v.el.value !== val) v.el.value = val;
    }));
    return v;
  };
  v.secure = function() { v.el.type = 'password'; return v; };
  v.placeholder = function(p) { v.el.placeholder = p; return v; };
  return v;
}

// ─── Toggle ──────────────────────────────────────────────

function Toggle(binding, label) {
  var v = new View('label');
  v._viewType = 'Toggle';
  v.el.className = 'aether-ui-toggle';
  v.el.style.display = 'inline-flex';
  v.el.style.alignItems = 'center';
  v.el.style.gap = _spaceToken(2);
  v.el.style.cursor = 'pointer';
  if (label) {
    var labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.fontSize = '0.875rem';
    labelSpan.style.color = 'var(--nr-text-primary)';
    v.el.appendChild(labelSpan);
  }
  var sw = document.createElement('span');
  sw.className = 'nr-switch';
  var input = document.createElement('input');
  input.type = 'checkbox';
  var track = document.createElement('span');
  track.className = 'nr-switch-track';
  sw.appendChild(input);
  sw.appendChild(track);
  v.el.appendChild(sw);
  if (binding) {
    input.checked = !!S.resolve(binding);
    input.addEventListener('change', function() {
      if (S.isSignal(binding)) binding.value = input.checked;
      else if (S.isBinding(binding)) binding.value = input.checked;
    });
    v._effects.push(S.Effect(function() {
      input.checked = !!S.resolve(binding);
    }));
  }
  v.label = function(t) {
    if (!label) {
      var span = document.createElement('span');
      span.textContent = t;
      span.style.fontSize = '0.875rem';
      span.style.color = 'var(--nr-text-primary)';
      v.el.insertBefore(span, v.el.firstChild);
    }
    return v;
  };
  return v;
}

// ─── Slider ──────────────────────────────────────────────

function Slider(binding, opts) {
  opts = opts || {};
  var v = new View('input');
  v._viewType = 'Slider';
  v.el.type = 'range';
  v.el.className = 'nr-input';
  v.el.style.padding = '0';
  if (opts.min != null) v.el.min = opts.min;
  if (opts.max != null) v.el.max = opts.max;
  if (opts.step != null) v.el.step = opts.step;
  if (binding) {
    v.el.value = S.resolve(binding);
    v.el.addEventListener('input', function() {
      var val = parseFloat(v.el.value);
      if (S.isSignal(binding)) binding.value = val;
      else if (S.isBinding(binding)) binding.value = val;
    });
    v._effects.push(S.Effect(function() {
      v.el.value = S.resolve(binding);
    }));
  }
  v.range = function(min, max) { v.el.min = min; v.el.max = max; return v; };
  v.step = function(s) { v.el.step = s; return v; };
  return v;
}

// ─── Picker ──────────────────────────────────────────────

function Picker(binding, options) {
  var v = new View('select');
  v._viewType = 'Picker';
  v.el.className = 'nr-select';
  if (options) {
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var optEl = document.createElement('option');
      if (typeof opt === 'object') {
        optEl.value = opt.value != null ? opt.value : opt.label;
        optEl.textContent = opt.label;
      } else {
        optEl.value = opt;
        optEl.textContent = opt;
      }
      v.el.appendChild(optEl);
    }
  }
  if (binding) {
    v.el.value = S.resolve(binding);
    v.el.addEventListener('change', function() {
      if (S.isSignal(binding)) binding.value = v.el.value;
      else if (S.isBinding(binding)) binding.value = v.el.value;
    });
    v._effects.push(S.Effect(function() {
      var val = S.resolve(binding);
      if (v.el.value !== val) v.el.value = val;
    }));
  }
  v.options = function(opts) {
    v.el.innerHTML = '';
    for (var i = 0; i < opts.length; i++) {
      var opt = opts[i];
      var optEl = document.createElement('option');
      if (typeof opt === 'object') {
        optEl.value = opt.value != null ? opt.value : opt.label;
        optEl.textContent = opt.label;
      } else {
        optEl.value = opt;
        optEl.textContent = opt;
      }
      v.el.appendChild(optEl);
    }
    return v;
  };
  return v;
}

// ─── Stepper ─────────────────────────────────────────────

function Stepper(binding, opts) {
  opts = opts || {};
  var min = opts.min != null ? opts.min : -Infinity;
  var max = opts.max != null ? opts.max : Infinity;
  var step = opts.step || 1;
  var display = S.Computed(function() {
    return '' + S.resolve(binding);
  });
  var v = HStack(
    Button('-').ghost().small().onTap(function() {
      var cur = S.resolve(binding);
      var next = cur - step;
      if (next >= min) {
        if (S.isSignal(binding)) binding.value = next;
        else if (S.isBinding(binding)) binding.value = next;
      }
    }),
    Text(display).frame({ minWidth: 32 }).style('textAlign', 'center'),
    Button('+').ghost().small().onTap(function() {
      var cur = S.resolve(binding);
      var next = cur + step;
      if (next <= max) {
        if (S.isSignal(binding)) binding.value = next;
        else if (S.isBinding(binding)) binding.value = next;
      }
    })
  ).spacing(1);
  v._viewType = 'Stepper';
  v._effects.push(display);
  return v;
}

// ─── Textarea ────────────────────────────────────────────

function Textarea(binding, placeholder) {
  var v = new View('textarea');
  v._viewType = 'Textarea';
  v.el.className = 'nr-textarea';
  if (typeof binding === 'string' && !placeholder) {
    v.el.placeholder = binding;
    binding = null;
  } else if (placeholder) {
    v.el.placeholder = placeholder;
  }
  if (binding) {
    v.el.value = S.resolve(binding);
    v.el.addEventListener('input', function() {
      if (S.isSignal(binding)) binding.value = v.el.value;
      else if (S.isBinding(binding)) binding.value = v.el.value;
    });
    v._effects.push(S.Effect(function() {
      var val = S.resolve(binding);
      if (v.el.value !== val) v.el.value = val;
    }));
  }
  v.rows = function(n) { v.el.rows = n; return v; };
  v.maxLength = function(n) { v.el.maxLength = n; return v; };
  v.autoResize = function() {
    function resize() {
      v.el.style.height = 'auto';
      v.el.style.height = v.el.scrollHeight + 'px';
    }
    v.el.addEventListener('input', resize);
    v.el.style.overflow = 'hidden';
    v.el.style.resize = 'none';
    v._onAppearFns.push(resize);
    return v;
  };
  return v;
}

// ─── Checkbox ────────────────────────────────────────────

function Checkbox(binding, label) {
  var v = new View('label');
  v._viewType = 'Checkbox';
  v.el.className = 'nr-checkbox-label';
  var input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'nr-checkbox-input';
  var box = document.createElement('span');
  box.className = 'nr-checkbox';
  v.el.appendChild(input);
  v.el.appendChild(box);
  if (label) {
    var span = document.createElement('span');
    span.textContent = label;
    v.el.appendChild(span);
  }
  if (binding) {
    input.checked = !!S.resolve(binding);
    input.addEventListener('change', function() {
      if (S.isSignal(binding)) binding.value = input.checked;
      else if (S.isBinding(binding)) binding.value = input.checked;
    });
    v._effects.push(S.Effect(function() {
      input.checked = !!S.resolve(binding);
    }));
  }
  v.indeterminate = function() {
    input.indeterminate = true;
    return v;
  };
  return v;
}

// ─── RadioGroup ──────────────────────────────────────────

function RadioGroup(binding, options) {
  var v = new View('div');
  v._viewType = 'RadioGroup';
  v.el.className = 'nr-radio-group';
  var groupName = 'nr-radio-' + Math.random().toString(36).slice(2, 8);
  function buildOptions(opts) {
    v.el.innerHTML = '';
    for (var i = 0; i < opts.length; i++) {
      var opt = opts[i];
      var val = typeof opt === 'object' ? opt.value : opt;
      var lbl = typeof opt === 'object' ? opt.label : opt;
      var label = document.createElement('label');
      label.className = 'nr-radio-item';
      var input = document.createElement('input');
      input.type = 'radio';
      input.className = 'nr-radio-input';
      input.name = groupName;
      input.value = val;
      var circle = document.createElement('span');
      circle.className = 'nr-radio';
      var text = document.createElement('span');
      text.textContent = lbl;
      label.appendChild(input);
      label.appendChild(circle);
      label.appendChild(text);
      v.el.appendChild(label);
      if (binding) {
        if (S.resolve(binding) === val) input.checked = true;
        (function(inp, value) {
          inp.addEventListener('change', function() {
            if (inp.checked) {
              if (S.isSignal(binding)) binding.value = value;
              else if (S.isBinding(binding)) binding.value = value;
            }
          });
        })(input, val);
      }
    }
  }
  if (options) buildOptions(options);
  if (binding) {
    v._effects.push(S.Effect(function() {
      var cur = S.resolve(binding);
      var radios = v.el.querySelectorAll('input[type="radio"]');
      for (var i = 0; i < radios.length; i++) {
        radios[i].checked = radios[i].value === cur;
      }
    }));
  }
  v.horizontal = function() { v.el.classList.add('nr-radio-group-horizontal'); return v; };
  v.options = function(opts) { buildOptions(opts); return v; };
  return v;
}

// ─── ProgressBar ─────────────────────────────────────────

function ProgressBar(binding) {
  var v = new View('div');
  v._viewType = 'ProgressBar';
  v.el.className = 'nr-progress';
  var fill = document.createElement('div');
  fill.className = 'nr-progress-fill';
  v.el.appendChild(fill);
  if (binding) {
    fill.style.width = (S.resolve(binding) * 100) + '%';
    v._effects.push(S.Effect(function() {
      fill.style.width = (S.resolve(binding) * 100) + '%';
    }));
  }
  v.tint = function(color) {
    var resolved = color.startsWith('--') ? 'var(' + color + ')' : 'var(--nr-' + color + ')';
    fill.style.background = resolved;
    return v;
  };
  v.indeterminate = function() {
    v.el.classList.add('nr-progress-indeterminate');
    return v;
  };
  return v;
}

// ─── Pill ────────────────────────────────────────────────

function Pill(textOrBinding) {
  var v = new View('span');
  v._viewType = 'Pill';
  v.el.className = 'nr-pill';
  v._bindText(textOrBinding);
  v.accent = function() { v.el.classList.add('nr-pill-accent'); return v; };
  v.outline = function() { v.el.classList.add('nr-pill-outline'); return v; };
  v.small = function() { v.el.classList.add('nr-pill-sm'); return v; };
  v.large = function() { v.el.classList.add('nr-pill-lg'); return v; };
  v.dot = function() { v.el.classList.add('nr-pill-dot'); return v; };
  v.interactive = function() { v.el.classList.add('nr-pill-interactive'); return v; };
  return v;
}

// ─── FormField ───────────────────────────────────────────

function FormField(label, control, opts) {
  opts = opts || {};
  var v = VStack(
    Text(label).font('subhead').foreground('secondary'),
    opts.description ? Text(opts.description).font('caption1').foreground('tertiary') : null,
    control,
    opts.error ? Text(opts.error).font('caption1').foreground(_colorToken('#dc2626')) : null
  ).spacing(1);
  v._viewType = 'FormField';
  return v;
}

// ─── SearchField ─────────────────────────────────────────

function SearchField(binding, placeholder) {
  var v = new View('div');
  v._viewType = 'SearchField';
  v.el.style.position = 'relative';
  v.el.style.display = 'flex';
  v.el.style.alignItems = 'center';
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'nr-input';
  input.placeholder = placeholder || 'Search\u2026';
  input.style.paddingLeft = 'var(--nr-space-8)';
  input.style.paddingRight = 'var(--nr-space-8)';
  input.style.width = '100%';
  var searchIcon = document.createElement('span');
  searchIcon.textContent = '\uD83D\uDD0D';
  var clearBtn = document.createElement('span');
  clearBtn.style.display = 'none';
  clearBtn.textContent = '\u2715';
  v.el.appendChild(searchIcon);
  v.el.appendChild(input);
  v.el.appendChild(clearBtn);
  var _debounceTimer = null;
  var _debounceMs = 200;
  function updateClear() {
    clearBtn.style.display = input.value ? 'inline-flex' : 'none';
  }
  if (binding) {
    input.value = S.resolve(binding);
    updateClear();
    input.addEventListener('input', function() {
      updateClear();
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(function() {
        if (S.isSignal(binding)) binding.value = input.value;
        else if (S.isBinding(binding)) binding.value = input.value;
      }, _debounceMs);
    });
    v._effects.push(S.Effect(function() {
      var val = S.resolve(binding);
      if (input.value !== val) { input.value = val; updateClear(); }
    }));
  } else {
    input.addEventListener('input', updateClear);
  }
  clearBtn.addEventListener('click', function() {
    input.value = '';
    updateClear();
    if (binding) {
      if (S.isSignal(binding)) binding.value = '';
      else if (S.isBinding(binding)) binding.value = '';
    }
    input.focus();
  });
  v.debounce = function(ms) { _debounceMs = ms; return v; };
  return v;
}

// ─── Spinner ─────────────────────────────────────────────

function Spinner(size) {
  var v = new View('span');
  v._viewType = 'Spinner';
  var s = size || 20;
  v.el.style.width = s + 'px';
  v.el.style.height = s + 'px';
  v.el.style.display = 'inline-block';
  v.size = function(sz) {
    v.el.style.width = sz + 'px';
    v.el.style.height = sz + 'px';
    return v;
  };
  return v;
}

// ─── Disclosure ──────────────────────────────────────────

function Disclosure(title, contentFn) {
  var v = new View('div');
  v._viewType = 'Disclosure';
  v.el.className = 'nr-disclosure';
  var _expanded = S.State(false);
  var _animate = false;
  var _childView = null;
  var header = document.createElement('button');
  header.className = 'nr-disclosure-header';
  header.type = 'button';
  var chevron = document.createElement('span');
  chevron.className = 'nr-disclosure-chevron';
  chevron.innerHTML = '\u25B6';
  var titleSpan = document.createElement('span');
  titleSpan.className = 'nr-disclosure-title';
  titleSpan.textContent = typeof title === 'string' ? title : '';
  header.appendChild(chevron);
  header.appendChild(titleSpan);
  v.el.appendChild(header);
  var content = document.createElement('div');
  content.className = 'nr-disclosure-content';
  content.style.display = 'none';
  v.el.appendChild(content);
  header.addEventListener('click', function() {
    _expanded.value = !_expanded.value;
  });
  v._listeners.push(['click', header]);
  v._effects.push(S.Effect(function() {
    var open = _expanded.value;
    chevron.style.transform = open ? 'rotate(90deg)' : '';
    if (open) {
      if (!_childView && contentFn) {
        var child = contentFn();
        if (child instanceof View) {
          content.appendChild(child.build());
          v._children.push(child);
          for (var k = 0; k < child._onAppearFns.length; k++) child._onAppearFns[k]();
          _childView = child;
        } else if (child instanceof HTMLElement) {
          content.appendChild(child);
        }
      }
      content.style.display = '';
    } else {
      content.style.display = 'none';
    }
  }));
  v.isExpanded = function(signal) {
    if (S.isSignal(signal)) {
      _expanded = signal;
    }
    return v;
  };
  v.animates = function() {
    _animate = true;
    chevron.style.transition = 'transform 0.15s ease';
    return v;
  };
  return v;
}

// ─── Badge ───────────────────────────────────────────────

function Badge(contentOrSignal) {
  var v = new View('span');
  v._viewType = 'Badge';
  v.el.className = 'nr-badge';
  var _isDot = false;
  if (S.isSignal(contentOrSignal)) {
    v._effects.push(S.Effect(function() {
      var val = contentOrSignal.value;
      if (_isDot) {
        v.el.style.display = '';
        return;
      }
      if (val === 0 || val === null || val === undefined || val === '') {
        v.el.style.display = 'none';
      } else {
        v.el.style.display = '';
        v.el.textContent = val;
      }
    }));
  } else if (contentOrSignal != null) {
    v.el.textContent = contentOrSignal;
  }
  v.tint = function(color) {
    v.el.style.background = color === 'accent' ? 'var(--nr-accent)' :
      color.startsWith('--') ? 'var(' + color + ')' : color;
    v.el.style.color = '#fff';
    return v;
  };
  v.dot = function() {
    _isDot = true;
    v.el.classList.add('nr-badge-dot');
    v.el.textContent = '';
    return v;
  };
  return v;
}

// ─── SegmentedControl ────────────────────────────────────

function SegmentedControl(binding, options) {
  var v = new View('div');
  v._viewType = 'SegmentedControl';
  v.el.className = 'nr-tab-bar nr-tab-bar-segmented';
  function buildSegments(opts) {
    v.el.innerHTML = '';
    for (var i = 0; i < opts.length; i++) {
      var opt = opts[i];
      var btn = document.createElement('button');
      btn.className = 'nr-tab-btn';
      btn.textContent = typeof opt === 'object' ? opt.label : opt;
      var val = typeof opt === 'object' ? opt.value : opt;
      (function(value) {
        btn.addEventListener('click', function() {
          if (S.isSignal(binding)) binding.value = value;
          else if (S.isBinding(binding)) binding.value = value;
        });
      })(val);
      btn.setAttribute('data-value', val);
      v.el.appendChild(btn);
    }
    _syncActive();
  }
  function _syncActive() {
    var cur = S.resolve(binding);
    var btns = v.el.querySelectorAll('.nr-tab-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('nr-tab-active', btns[i].getAttribute('data-value') === '' + cur);
    }
  }
  if (options) buildSegments(options);
  if (binding) {
    v._effects.push(S.Effect(function() {
      S.resolve(binding);
      _syncActive();
    }));
  }
  v.options = function(opts) { buildSegments(opts); return v; };
  return v;
}

// ─── Skeleton ────────────────────────────────────────────

function Skeleton() {
  var v = new View('div');
  v._viewType = 'Skeleton';
  v.el.className = 'nr-skeleton';
  v.circle = function(size) {
    var s = (size || 40) + 'px';
    v.el.style.width = s;
    v.el.style.height = s;
    v.el.style.borderRadius = '50%';
    return v;
  };
  v.lines = function(n) {
    v.el.innerHTML = '';
    v.el.style.display = 'flex';
    v.el.style.flexDirection = 'column';
    v.el.style.gap = 'var(--nr-space-2)';
    for (var i = 0; i < (n || 3); i++) {
      var line = document.createElement('div');
      line.className = 'nr-skeleton';
      line.style.height = '0.875rem';
      line.style.borderRadius = 'var(--nr-radius-sm)';
      if (i === n - 1) line.style.width = '60%';
      v.el.appendChild(line);
    }
    return v;
  };
  return v;
}

// ─── Switch (simple alias test) ──────────────────────────
// Switch is exported from controls.js but is actually defined in containers.js;
// we skip it here since it is not in controls.js source.

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

// ─── Button ───────────────────────────────────────────────

describe('Button', () => {
  it('creates a <button> element', () => {
    const b = Button('Click');
    expect(b.el.tagName).toBe('BUTTON');
  });

  it('sets _viewType to Button', () => {
    const b = Button('OK');
    expect(b._viewType).toBe('Button');
  });

  it('has default primary variant class', () => {
    const b = Button('Submit');
    expect(b.el.classList.contains('nr-btn')).toBe(true);
    expect(b.el.classList.contains('nr-btn-primary')).toBe(true);
  });

  it('sets text content from string label', () => {
    const b = Button('Save');
    expect(b.el.textContent).toBe('Save');
  });

  it('sets text content from State signal', () => {
    const label = State('Loading');
    const b = Button(label);
    expect(b.el.textContent).toBe('Loading');
    label.value = 'Ready';
    expect(b.el.textContent).toBe('Ready');
  });

  it('.primary() sets primary variant and returns this', () => {
    const b = Button('A').secondary();
    const ret = b.primary();
    expect(ret).toBe(b);
    expect(b.el.classList.contains('nr-btn-primary')).toBe(true);
    expect(b.el.classList.contains('nr-btn-secondary')).toBe(false);
  });

  it('.secondary() sets secondary variant', () => {
    const b = Button('B').secondary();
    expect(b.el.classList.contains('nr-btn-secondary')).toBe(true);
    expect(b.el.classList.contains('nr-btn-primary')).toBe(false);
  });

  it('.ghost() sets ghost variant', () => {
    const b = Button('C').ghost();
    expect(b.el.classList.contains('nr-btn-ghost')).toBe(true);
    expect(b.el.classList.contains('nr-btn-primary')).toBe(false);
  });

  it('.danger() sets danger variant', () => {
    const b = Button('D').danger();
    expect(b.el.classList.contains('nr-btn-danger')).toBe(true);
    expect(b.el.classList.contains('nr-btn-primary')).toBe(false);
  });

  it('.small() adds size class and returns this', () => {
    const b = Button('E');
    const ret = b.small();
    expect(ret).toBe(b);
    expect(b.el.classList.contains('nr-btn-sm')).toBe(true);
  });

  it('.large() adds size class and returns this', () => {
    const b = Button('F');
    const ret = b.large();
    expect(ret).toBe(b);
    expect(b.el.classList.contains('nr-btn-lg')).toBe(true);
  });

  it('.iconButton() adds icon class and returns this', () => {
    const b = Button('').iconButton();
    expect(b.el.classList.contains('nr-btn-icon')).toBe(true);
  });

  it('variant modifiers are exclusive (only one variant at a time)', () => {
    const b = Button('X').primary().secondary().ghost().danger();
    expect(b.el.classList.contains('nr-btn-danger')).toBe(true);
    expect(b.el.classList.contains('nr-btn-primary')).toBe(false);
    expect(b.el.classList.contains('nr-btn-secondary')).toBe(false);
    expect(b.el.classList.contains('nr-btn-ghost')).toBe(false);
  });

  it('size and variant classes coexist', () => {
    const b = Button('Z').danger().small();
    expect(b.el.classList.contains('nr-btn-danger')).toBe(true);
    expect(b.el.classList.contains('nr-btn-sm')).toBe(true);
  });

  it('.icon() with window.icon injects icon HTML leading', () => {
    window.icon = (name, opts) => `<svg data-icon="${name}" width="${opts.size}"></svg>`;
    const b = Button('Go').icon('arrow');
    expect(b.el.innerHTML).toContain('data-icon="arrow"');
    expect(b.el.innerHTML).toContain('Go');
    expect(b.el.style.display).toBe('inline-flex');
    expect(b.el.style.gap).toBe('var(--nr-space-2)');
    delete window.icon;
  });

  it('.icon() with trailing position', () => {
    window.icon = (name, opts) => `<svg data-icon="${name}"></svg>`;
    const b = Button('Next').icon('chevron', 'trailing');
    const html = b.el.innerHTML;
    const spanIndex = html.indexOf('<span>');
    const svgIndex = html.indexOf('<svg');
    expect(spanIndex).toBeLessThan(svgIndex);
    delete window.icon;
  });

  it('.icon() without window.icon returns this (no-op)', () => {
    delete window.icon;
    const b = Button('Test');
    const ret = b.icon('foo');
    expect(ret).toBe(b);
  });
});

// ─── TextField ────────────────────────────────────────────

describe('TextField', () => {
  it('creates an <input> element with type text', () => {
    const tf = TextField('Name');
    expect(tf.el.tagName).toBe('INPUT');
    expect(tf.el.type).toBe('text');
  });

  it('sets _viewType to TextField', () => {
    const tf = TextField('Email');
    expect(tf._viewType).toBe('TextField');
  });

  it('has nr-input class', () => {
    const tf = TextField('Search');
    expect(tf.el.classList.contains('nr-input')).toBe(true);
  });

  it('sets placeholder from string argument', () => {
    const tf = TextField('Enter name');
    expect(tf.el.placeholder).toBe('Enter name');
  });

  it('binds to a State signal (two-way)', () => {
    const name = State('Alice');
    const tf = TextField(name);
    expect(tf.el.value).toBe('Alice');

    // Signal -> input
    name.value = 'Bob';
    expect(tf.el.value).toBe('Bob');

    // Input -> signal
    tf.el.value = 'Carol';
    tf.el.dispatchEvent(new Event('input'));
    expect(name.value).toBe('Carol');
  });

  it('binds to a Binding (two-way)', () => {
    const src = State('hello');
    const b = Binding(src);
    const tf = TextField(b);
    expect(tf.el.value).toBe('hello');

    b.value = 'world';
    expect(tf.el.value).toBe('world');

    tf.el.value = 'test';
    tf.el.dispatchEvent(new Event('input'));
    expect(src.value).toBe('test');
  });

  it('sets placeholder when used with binding', () => {
    const s = State('');
    const tf = TextField(s, 'Enter value');
    expect(tf.el.placeholder).toBe('Enter value');
  });

  it('.secure() changes type to password and returns this', () => {
    const tf = TextField('Password');
    const ret = tf.secure();
    expect(ret).toBe(tf);
    expect(tf.el.type).toBe('password');
  });

  it('.placeholder() modifier sets placeholder and returns this', () => {
    const tf = TextField();
    const ret = tf.placeholder('Type here');
    expect(ret).toBe(tf);
    expect(tf.el.placeholder).toBe('Type here');
  });

  it('.bind() method binds after construction', () => {
    const s = State('initial');
    const b = Binding(s);
    const tf = TextField('Placeholder');
    tf.bind(b);
    expect(tf.el.value).toBe('initial');

    s.value = 'updated';
    expect(tf.el.value).toBe('updated');

    tf.el.value = 'typed';
    tf.el.dispatchEvent(new Event('input'));
    expect(s.value).toBe('typed');
  });
});

// ─── Toggle ──────────────────────────────────────────────

describe('Toggle', () => {
  it('creates a <label> element', () => {
    const t = Toggle(null);
    expect(t.el.tagName).toBe('LABEL');
  });

  it('sets _viewType to Toggle', () => {
    const t = Toggle(null);
    expect(t._viewType).toBe('Toggle');
  });

  it('has correct class', () => {
    const t = Toggle(null);
    expect(t.el.classList.contains('aether-ui-toggle')).toBe(true);
  });

  it('contains a checkbox input inside switch structure', () => {
    const t = Toggle(null);
    const input = t.el.querySelector('input[type="checkbox"]');
    expect(input).not.toBeNull();
  });

  it('displays label text when provided', () => {
    const t = Toggle(null, 'Dark Mode');
    expect(t.el.textContent).toContain('Dark Mode');
  });

  it('binds checkbox state to a State signal (two-way)', () => {
    const enabled = State(false);
    const t = Toggle(enabled);
    const input = t.el.querySelector('input[type="checkbox"]');

    expect(input.checked).toBe(false);

    // Signal -> checkbox
    enabled.value = true;
    expect(input.checked).toBe(true);

    // Checkbox -> signal
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    expect(enabled.value).toBe(false);
  });

  it('binds to a Binding (two-way)', () => {
    const src = State(true);
    const b = Binding(src);
    const t = Toggle(b);
    const input = t.el.querySelector('input[type="checkbox"]');

    expect(input.checked).toBe(true);

    input.checked = false;
    input.dispatchEvent(new Event('change'));
    expect(src.value).toBe(false);
  });

  it('.label() adds label text when none was provided', () => {
    const t = Toggle(null);
    const ret = t.label('Enable');
    expect(ret).toBe(t);
    expect(t.el.textContent).toContain('Enable');
  });
});

// ─── Slider ──────────────────────────────────────────────

describe('Slider', () => {
  it('creates an <input type="range"> element', () => {
    const s = Slider(null);
    expect(s.el.tagName).toBe('INPUT');
    expect(s.el.type).toBe('range');
  });

  it('sets _viewType to Slider', () => {
    const s = Slider(null);
    expect(s._viewType).toBe('Slider');
  });

  it('sets min/max/step from options', () => {
    const s = Slider(null, { min: 0, max: 100, step: 5 });
    expect(s.el.min).toBe('0');
    expect(s.el.max).toBe('100');
    expect(s.el.step).toBe('5');
  });

  it('binds to a State signal (two-way)', () => {
    const val = State(50);
    const s = Slider(val, { min: 0, max: 100 });
    expect(s.el.value).toBe('50');

    // Signal -> slider
    val.value = 75;
    expect(s.el.value).toBe('75');

    // Slider -> signal (parses as float)
    s.el.value = '30';
    s.el.dispatchEvent(new Event('input'));
    expect(val.value).toBe(30);
  });

  it('.range() sets min and max and returns this', () => {
    const s = Slider(null);
    const ret = s.range(10, 200);
    expect(ret).toBe(s);
    expect(s.el.min).toBe('10');
    expect(s.el.max).toBe('200');
  });

  it('.step() sets step and returns this', () => {
    const s = Slider(null);
    const ret = s.step(0.5);
    expect(ret).toBe(s);
    expect(s.el.step).toBe('0.5');
  });
});

// ─── Picker ──────────────────────────────────────────────

describe('Picker', () => {
  it('creates a <select> element', () => {
    const p = Picker(null, ['a', 'b']);
    expect(p.el.tagName).toBe('SELECT');
  });

  it('sets _viewType to Picker', () => {
    const p = Picker(null);
    expect(p._viewType).toBe('Picker');
  });

  it('has nr-select class', () => {
    const p = Picker(null);
    expect(p.el.classList.contains('nr-select')).toBe(true);
  });

  it('renders string options', () => {
    const p = Picker(null, ['Red', 'Green', 'Blue']);
    const opts = p.el.querySelectorAll('option');
    expect(opts.length).toBe(3);
    expect(opts[0].value).toBe('Red');
    expect(opts[0].textContent).toBe('Red');
    expect(opts[2].value).toBe('Blue');
  });

  it('renders object options with value/label', () => {
    const p = Picker(null, [
      { value: 'r', label: 'Red' },
      { value: 'g', label: 'Green' }
    ]);
    const opts = p.el.querySelectorAll('option');
    expect(opts[0].value).toBe('r');
    expect(opts[0].textContent).toBe('Red');
    expect(opts[1].value).toBe('g');
    expect(opts[1].textContent).toBe('Green');
  });

  it('binds to a State signal (two-way)', () => {
    const color = State('g');
    const p = Picker(color, [
      { value: 'r', label: 'Red' },
      { value: 'g', label: 'Green' },
      { value: 'b', label: 'Blue' }
    ]);
    expect(p.el.value).toBe('g');

    // Signal -> picker
    color.value = 'b';
    expect(p.el.value).toBe('b');

    // Picker -> signal
    p.el.value = 'r';
    p.el.dispatchEvent(new Event('change'));
    expect(color.value).toBe('r');
  });

  it('.options() replaces options and returns this', () => {
    const p = Picker(null, ['x']);
    const ret = p.options(['a', 'b', 'c']);
    expect(ret).toBe(p);
    const opts = p.el.querySelectorAll('option');
    expect(opts.length).toBe(3);
    expect(opts[1].value).toBe('b');
  });
});

// ─── Stepper ─────────────────────────────────────────────

describe('Stepper', () => {
  it('sets _viewType to Stepper', () => {
    const val = State(5);
    const s = Stepper(val);
    expect(s._viewType).toBe('Stepper');
  });

  it('creates an HStack with - and + buttons', () => {
    const val = State(5);
    const s = Stepper(val);
    const buttons = s.el.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('-');
    expect(buttons[1].textContent).toBe('+');
  });

  it('displays the current value', () => {
    const val = State(10);
    const s = Stepper(val);
    expect(s.el.textContent).toContain('10');
  });

  it('decrement button decreases the value', () => {
    const val = State(5);
    const s = Stepper(val);
    const minusBtn = s.el.querySelectorAll('button')[0];
    minusBtn.click();
    expect(val.value).toBe(4);
  });

  it('increment button increases the value', () => {
    const val = State(5);
    const s = Stepper(val);
    const plusBtn = s.el.querySelectorAll('button')[1];
    plusBtn.click();
    expect(val.value).toBe(6);
  });

  it('respects min option', () => {
    const val = State(0);
    const s = Stepper(val, { min: 0 });
    const minusBtn = s.el.querySelectorAll('button')[0];
    minusBtn.click();
    expect(val.value).toBe(0); // should not go below min
  });

  it('respects max option', () => {
    const val = State(10);
    const s = Stepper(val, { max: 10 });
    const plusBtn = s.el.querySelectorAll('button')[1];
    plusBtn.click();
    expect(val.value).toBe(10); // should not go above max
  });

  it('uses custom step', () => {
    const val = State(0);
    const s = Stepper(val, { step: 5 });
    const plusBtn = s.el.querySelectorAll('button')[1];
    plusBtn.click();
    expect(val.value).toBe(5);
    plusBtn.click();
    expect(val.value).toBe(10);
  });
});

// ─── Textarea ────────────────────────────────────────────

describe('Textarea', () => {
  it('creates a <textarea> element', () => {
    const ta = Textarea('Enter text');
    expect(ta.el.tagName).toBe('TEXTAREA');
  });

  it('sets _viewType to Textarea', () => {
    const ta = Textarea('Placeholder');
    expect(ta._viewType).toBe('Textarea');
  });

  it('has nr-textarea class', () => {
    const ta = Textarea('Placeholder');
    expect(ta.el.classList.contains('nr-textarea')).toBe(true);
  });

  it('sets placeholder from plain string argument', () => {
    const ta = Textarea('Type here');
    expect(ta.el.placeholder).toBe('Type here');
  });

  it('binds to a State signal (two-way)', () => {
    const text = State('Hello');
    const ta = Textarea(text, 'placeholder');
    expect(ta.el.value).toBe('Hello');

    // Signal -> textarea
    text.value = 'World';
    expect(ta.el.value).toBe('World');

    // Textarea -> signal
    ta.el.value = 'Test';
    ta.el.dispatchEvent(new Event('input'));
    expect(text.value).toBe('Test');
  });

  it('.rows() sets rows attribute and returns this', () => {
    const ta = Textarea('Text');
    const ret = ta.rows(5);
    expect(ret).toBe(ta);
    expect(String(ta.el.rows)).toBe('5');
  });

  it('.maxLength() sets maxLength and returns this', () => {
    const ta = Textarea('Text');
    const ret = ta.maxLength(100);
    expect(ret).toBe(ta);
    expect(ta.el.maxLength).toBe(100);
  });

  it('.autoResize() sets overflow hidden and resize none', () => {
    const ta = Textarea('Text');
    const ret = ta.autoResize();
    expect(ret).toBe(ta);
    expect(ta.el.style.overflow).toBe('hidden');
    expect(ta.el.style.resize).toBe('none');
    expect(ta._onAppearFns.length).toBeGreaterThan(0);
  });
});

// ─── Checkbox ────────────────────────────────────────────

describe('Checkbox', () => {
  it('creates a <label> element', () => {
    const cb = Checkbox(null, 'Agree');
    expect(cb.el.tagName).toBe('LABEL');
  });

  it('sets _viewType to Checkbox', () => {
    const cb = Checkbox(null);
    expect(cb._viewType).toBe('Checkbox');
  });

  it('has nr-checkbox-label class', () => {
    const cb = Checkbox(null);
    expect(cb.el.classList.contains('nr-checkbox-label')).toBe(true);
  });

  it('contains a checkbox input', () => {
    const cb = Checkbox(null);
    const input = cb.el.querySelector('input[type="checkbox"]');
    expect(input).not.toBeNull();
    expect(input.classList.contains('nr-checkbox-input')).toBe(true);
  });

  it('displays label text when provided', () => {
    const cb = Checkbox(null, 'I agree');
    expect(cb.el.textContent).toContain('I agree');
  });

  it('binds checkbox to a State signal (two-way)', () => {
    const checked = State(false);
    const cb = Checkbox(checked, 'Accept');
    const input = cb.el.querySelector('input[type="checkbox"]');

    expect(input.checked).toBe(false);

    // Signal -> checkbox
    checked.value = true;
    expect(input.checked).toBe(true);

    // Checkbox -> signal
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    expect(checked.value).toBe(false);
  });

  it('.indeterminate() sets indeterminate state and returns this', () => {
    const cb = Checkbox(null);
    const ret = cb.indeterminate();
    expect(ret).toBe(cb);
    const input = cb.el.querySelector('input[type="checkbox"]');
    expect(input.indeterminate).toBe(true);
  });
});

// ─── RadioGroup ──────────────────────────────────────────

describe('RadioGroup', () => {
  it('creates a <div> element', () => {
    const rg = RadioGroup(null, ['a', 'b']);
    expect(rg.el.tagName).toBe('DIV');
  });

  it('sets _viewType to RadioGroup', () => {
    const rg = RadioGroup(null);
    expect(rg._viewType).toBe('RadioGroup');
  });

  it('has nr-radio-group class', () => {
    const rg = RadioGroup(null, []);
    expect(rg.el.classList.contains('nr-radio-group')).toBe(true);
  });

  it('renders radio inputs for string options', () => {
    const rg = RadioGroup(null, ['Alpha', 'Beta', 'Gamma']);
    const inputs = rg.el.querySelectorAll('input[type="radio"]');
    expect(inputs.length).toBe(3);
    expect(inputs[0].value).toBe('Alpha');
    expect(inputs[2].value).toBe('Gamma');
  });

  it('renders radio inputs for object options', () => {
    const rg = RadioGroup(null, [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' }
    ]);
    const inputs = rg.el.querySelectorAll('input[type="radio"]');
    expect(inputs[0].value).toBe('a');
    expect(rg.el.textContent).toContain('Alpha');
  });

  it('checks the radio matching the initial State value', () => {
    const choice = State('b');
    const rg = RadioGroup(choice, ['a', 'b', 'c']);
    const inputs = rg.el.querySelectorAll('input[type="radio"]');
    expect(inputs[1].checked).toBe(true);
    expect(inputs[0].checked).toBe(false);
  });

  it('binds radio selection to State (two-way)', () => {
    const choice = State('a');
    const rg = RadioGroup(choice, ['a', 'b', 'c']);
    const inputs = rg.el.querySelectorAll('input[type="radio"]');

    // Signal -> radio
    choice.value = 'c';
    expect(inputs[2].checked).toBe(true);

    // Radio -> signal
    inputs[0].checked = true;
    inputs[0].dispatchEvent(new Event('change'));
    expect(choice.value).toBe('a');
  });

  it('.horizontal() adds class and returns this', () => {
    const rg = RadioGroup(null, ['a']);
    const ret = rg.horizontal();
    expect(ret).toBe(rg);
    expect(rg.el.classList.contains('nr-radio-group-horizontal')).toBe(true);
  });

  it('.options() replaces options and returns this', () => {
    const rg = RadioGroup(null, ['x']);
    const ret = rg.options(['p', 'q', 'r']);
    expect(ret).toBe(rg);
    const inputs = rg.el.querySelectorAll('input[type="radio"]');
    expect(inputs.length).toBe(3);
  });
});

// ─── ProgressBar ─────────────────────────────────────────

describe('ProgressBar', () => {
  it('creates a <div> element', () => {
    const pb = ProgressBar(null);
    expect(pb.el.tagName).toBe('DIV');
  });

  it('sets _viewType to ProgressBar', () => {
    const pb = ProgressBar(null);
    expect(pb._viewType).toBe('ProgressBar');
  });

  it('has nr-progress class', () => {
    const pb = ProgressBar(null);
    expect(pb.el.classList.contains('nr-progress')).toBe(true);
  });

  it('contains a fill child element', () => {
    const pb = ProgressBar(null);
    const fill = pb.el.querySelector('.nr-progress-fill');
    expect(fill).not.toBeNull();
  });

  it('sets fill width from signal value (0-1 scale)', () => {
    const progress = State(0.5);
    const pb = ProgressBar(progress);
    const fill = pb.el.querySelector('.nr-progress-fill');
    expect(fill.style.width).toBe('50%');

    progress.value = 0.75;
    expect(fill.style.width).toBe('75%');
  });

  it('.tint() sets fill background color with --prefix', () => {
    const pb = ProgressBar(State(0.5));
    const ret = pb.tint('--nr-accent');
    expect(ret).toBe(pb);
    const fill = pb.el.querySelector('.nr-progress-fill');
    expect(fill.style.background).toBe('var(--nr-accent)');
  });

  it('.tint() sets fill background color with name', () => {
    const pb = ProgressBar(State(0.5));
    pb.tint('accent');
    const fill = pb.el.querySelector('.nr-progress-fill');
    expect(fill.style.background).toBe('var(--nr-accent)');
  });

  it('.indeterminate() adds class and returns this', () => {
    const pb = ProgressBar(null);
    const ret = pb.indeterminate();
    expect(ret).toBe(pb);
    expect(pb.el.classList.contains('nr-progress-indeterminate')).toBe(true);
  });
});

// ─── Pill ────────────────────────────────────────────────

describe('Pill', () => {
  it('creates a <span> element', () => {
    const p = Pill('Tag');
    expect(p.el.tagName).toBe('SPAN');
  });

  it('sets _viewType to Pill', () => {
    const p = Pill('Tag');
    expect(p._viewType).toBe('Pill');
  });

  it('has nr-pill class', () => {
    const p = Pill('Tag');
    expect(p.el.classList.contains('nr-pill')).toBe(true);
  });

  it('sets text content', () => {
    const p = Pill('Status');
    expect(p.el.textContent).toBe('Status');
  });

  it('reacts to State signal', () => {
    const label = State('Active');
    const p = Pill(label);
    expect(p.el.textContent).toBe('Active');
    label.value = 'Inactive';
    expect(p.el.textContent).toBe('Inactive');
  });

  it('.accent() adds class and returns this', () => {
    const p = Pill('X');
    const ret = p.accent();
    expect(ret).toBe(p);
    expect(p.el.classList.contains('nr-pill-accent')).toBe(true);
  });

  it('.outline() adds class and returns this', () => {
    const p = Pill('X');
    const ret = p.outline();
    expect(ret).toBe(p);
    expect(p.el.classList.contains('nr-pill-outline')).toBe(true);
  });

  it('.small() adds class', () => {
    const p = Pill('X').small();
    expect(p.el.classList.contains('nr-pill-sm')).toBe(true);
  });

  it('.large() adds class', () => {
    const p = Pill('X').large();
    expect(p.el.classList.contains('nr-pill-lg')).toBe(true);
  });

  it('.dot() adds class', () => {
    const p = Pill('X').dot();
    expect(p.el.classList.contains('nr-pill-dot')).toBe(true);
  });

  it('.interactive() adds class', () => {
    const p = Pill('X').interactive();
    expect(p.el.classList.contains('nr-pill-interactive')).toBe(true);
  });

  it('multiple modifiers chain', () => {
    const p = Pill('T').accent().small().dot();
    expect(p.el.classList.contains('nr-pill-accent')).toBe(true);
    expect(p.el.classList.contains('nr-pill-sm')).toBe(true);
    expect(p.el.classList.contains('nr-pill-dot')).toBe(true);
  });
});

// ─── FormField ───────────────────────────────────────────

describe('FormField', () => {
  it('sets _viewType to FormField', () => {
    const control = new View('input');
    const ff = FormField('Username', control);
    expect(ff._viewType).toBe('FormField');
  });

  it('contains label text', () => {
    const control = new View('input');
    const ff = FormField('Email', control);
    expect(ff.el.textContent).toContain('Email');
  });

  it('includes description text when provided', () => {
    const control = new View('input');
    const ff = FormField('Password', control, { description: 'Must be 8+ chars' });
    expect(ff.el.textContent).toContain('Must be 8+ chars');
  });

  it('includes error text when provided', () => {
    const control = new View('input');
    const ff = FormField('Name', control, { error: 'Required' });
    expect(ff.el.textContent).toContain('Required');
  });
});

// ─── SearchField ─────────────────────────────────────────

describe('SearchField', () => {
  it('creates a <div> wrapper element', () => {
    const sf = SearchField(null);
    expect(sf.el.tagName).toBe('DIV');
  });

  it('sets _viewType to SearchField', () => {
    const sf = SearchField(null);
    expect(sf._viewType).toBe('SearchField');
  });

  it('contains an input element', () => {
    const sf = SearchField(null);
    const input = sf.el.querySelector('input');
    expect(input).not.toBeNull();
    expect(input.type).toBe('text');
  });

  it('sets default placeholder', () => {
    const sf = SearchField(null);
    const input = sf.el.querySelector('input');
    expect(input.placeholder).toBe('Search\u2026');
  });

  it('sets custom placeholder', () => {
    const sf = SearchField(null, 'Find items');
    const input = sf.el.querySelector('input');
    expect(input.placeholder).toBe('Find items');
  });

  it('binds to State signal', () => {
    const query = State('test');
    const sf = SearchField(query);
    const input = sf.el.querySelector('input');
    expect(input.value).toBe('test');

    // Signal -> input
    query.value = 'updated';
    expect(input.value).toBe('updated');
  });

  it('clear button resets value to empty', () => {
    const query = State('something');
    const sf = SearchField(query);
    const clearBtn = sf.el.querySelectorAll('span')[1]; // second span is clear btn

    clearBtn.click();
    expect(query.value).toBe('');
  });

  it('.debounce() sets debounce time and returns this', () => {
    const sf = SearchField(null);
    const ret = sf.debounce(500);
    expect(ret).toBe(sf);
  });
});

// ─── Spinner ─────────────────────────────────────────────

describe('Spinner', () => {
  it('creates a <span> element', () => {
    const sp = Spinner();
    expect(sp.el.tagName).toBe('SPAN');
  });

  it('sets _viewType to Spinner', () => {
    const sp = Spinner();
    expect(sp._viewType).toBe('Spinner');
  });

  it('defaults to 20px size', () => {
    const sp = Spinner();
    expect(sp.el.style.width).toBe('20px');
    expect(sp.el.style.height).toBe('20px');
  });

  it('accepts custom initial size', () => {
    const sp = Spinner(32);
    expect(sp.el.style.width).toBe('32px');
    expect(sp.el.style.height).toBe('32px');
  });

  it('.size() changes size and returns this', () => {
    const sp = Spinner();
    const ret = sp.size(48);
    expect(ret).toBe(sp);
    expect(sp.el.style.width).toBe('48px');
    expect(sp.el.style.height).toBe('48px');
  });
});

// ─── Disclosure ──────────────────────────────────────────

describe('Disclosure', () => {
  it('creates a <div> element', () => {
    const d = Disclosure('Section');
    expect(d.el.tagName).toBe('DIV');
  });

  it('sets _viewType to Disclosure', () => {
    const d = Disclosure('Section');
    expect(d._viewType).toBe('Disclosure');
  });

  it('has nr-disclosure class', () => {
    const d = Disclosure('Section');
    expect(d.el.classList.contains('nr-disclosure')).toBe(true);
  });

  it('displays the title text', () => {
    const d = Disclosure('Advanced Settings');
    const titleSpan = d.el.querySelector('.nr-disclosure-title');
    expect(titleSpan.textContent).toBe('Advanced Settings');
  });

  it('content is hidden by default', () => {
    const d = Disclosure('Section', () => Text('Body'));
    const content = d.el.querySelector('.nr-disclosure-content');
    expect(content.style.display).toBe('none');
  });

  it('clicking header toggles expanded state', () => {
    const d = Disclosure('Section', () => Text('Body'));
    const header = d.el.querySelector('.nr-disclosure-header');
    const content = d.el.querySelector('.nr-disclosure-content');

    header.click();
    expect(content.style.display).toBe('');

    header.click();
    expect(content.style.display).toBe('none');
  });

  it('renders content lazily on first expand', () => {
    let rendered = false;
    const d = Disclosure('Section', () => {
      rendered = true;
      return Text('Lazy');
    });
    expect(rendered).toBe(false);

    const header = d.el.querySelector('.nr-disclosure-header');
    header.click();
    expect(rendered).toBe(true);
  });

  it('.animates() sets transition and returns this', () => {
    const d = Disclosure('Section');
    const ret = d.animates();
    expect(ret).toBe(d);
    const chevron = d.el.querySelector('.nr-disclosure-chevron');
    expect(chevron.style.transition).toContain('transform');
  });

  it('.isExpanded() accepts external signal', () => {
    const expanded = State(false);
    const d = Disclosure('Section', () => Text('Body'));
    const ret = d.isExpanded(expanded);
    expect(ret).toBe(d);
  });
});

// ─── Badge ───────────────────────────────────────────────

describe('Badge', () => {
  it('creates a <span> element', () => {
    const b = Badge(5);
    expect(b.el.tagName).toBe('SPAN');
  });

  it('sets _viewType to Badge', () => {
    const b = Badge(5);
    expect(b._viewType).toBe('Badge');
  });

  it('has nr-badge class', () => {
    const b = Badge(5);
    expect(b.el.classList.contains('nr-badge')).toBe(true);
  });

  it('displays static content', () => {
    const b = Badge(42);
    expect(b.el.textContent).toBe('42');
  });

  it('displays content from signal', () => {
    const count = State(3);
    const b = Badge(count);
    expect(b.el.textContent).toBe('3');

    count.value = 10;
    expect(b.el.textContent).toBe('10');
  });

  it('hides when signal value is 0', () => {
    const count = State(5);
    const b = Badge(count);
    expect(b.el.style.display).not.toBe('none');

    count.value = 0;
    expect(b.el.style.display).toBe('none');
  });

  it('hides when signal value is empty string', () => {
    const val = State('x');
    const b = Badge(val);
    val.value = '';
    expect(b.el.style.display).toBe('none');
  });

  it('.tint("accent") sets accent background', () => {
    const b = Badge(1);
    const ret = b.tint('accent');
    expect(ret).toBe(b);
    expect(b.el.style.background).toBe('var(--nr-accent)');
    expect(b.el.style.color).toBe('#fff');
  });

  it('.tint() with custom property', () => {
    const b = Badge(1);
    b.tint('--my-color');
    expect(b.el.style.background).toBe('var(--my-color)');
  });

  it('.tint() with raw color value', () => {
    const b = Badge(1);
    b.tint('red');
    expect(b.el.style.background).toBe('red');
  });

  it('.dot() adds dot class and clears text', () => {
    const b = Badge(5);
    const ret = b.dot();
    expect(ret).toBe(b);
    expect(b.el.classList.contains('nr-badge-dot')).toBe(true);
    expect(b.el.textContent).toBe('');
  });

  it('.dot() badge always shows regardless of signal value', () => {
    const count = State(5);
    const b = Badge(count).dot();
    // After dot(), setting value to 0 should still show (dot mode ignores value)
    count.value = 0;
    expect(b.el.style.display).toBe('');
  });
});

// ─── SegmentedControl ────────────────────────────────────

describe('SegmentedControl', () => {
  it('creates a <div> element', () => {
    const sel = State('a');
    const sc = SegmentedControl(sel, ['a', 'b', 'c']);
    expect(sc.el.tagName).toBe('DIV');
  });

  it('sets _viewType to SegmentedControl', () => {
    const sc = SegmentedControl(State('a'), ['a']);
    expect(sc._viewType).toBe('SegmentedControl');
  });

  it('has segmented bar classes', () => {
    const sc = SegmentedControl(State('a'), ['a']);
    expect(sc.el.classList.contains('nr-tab-bar')).toBe(true);
    expect(sc.el.classList.contains('nr-tab-bar-segmented')).toBe(true);
  });

  it('renders button segments for string options', () => {
    const sc = SegmentedControl(State('a'), ['Alpha', 'Beta', 'Gamma']);
    const btns = sc.el.querySelectorAll('.nr-tab-btn');
    expect(btns.length).toBe(3);
    expect(btns[0].textContent).toBe('Alpha');
    expect(btns[2].textContent).toBe('Gamma');
  });

  it('renders button segments for object options', () => {
    const sc = SegmentedControl(State('x'), [
      { value: 'x', label: 'Option X' },
      { value: 'y', label: 'Option Y' }
    ]);
    const btns = sc.el.querySelectorAll('.nr-tab-btn');
    expect(btns[0].textContent).toBe('Option X');
    expect(btns[0].getAttribute('data-value')).toBe('x');
  });

  it('marks active segment based on signal value', () => {
    const sel = State('b');
    const sc = SegmentedControl(sel, ['a', 'b', 'c']);
    const btns = sc.el.querySelectorAll('.nr-tab-btn');
    expect(btns[1].classList.contains('nr-tab-active')).toBe(true);
    expect(btns[0].classList.contains('nr-tab-active')).toBe(false);
  });

  it('clicking a segment updates the signal', () => {
    const sel = State('a');
    const sc = SegmentedControl(sel, ['a', 'b', 'c']);
    const btns = sc.el.querySelectorAll('.nr-tab-btn');
    btns[2].click();
    expect(sel.value).toBe('c');
  });

  it('signal change updates active segment', () => {
    const sel = State('a');
    const sc = SegmentedControl(sel, ['a', 'b', 'c']);
    sel.value = 'c';
    const btns = sc.el.querySelectorAll('.nr-tab-btn');
    expect(btns[2].classList.contains('nr-tab-active')).toBe(true);
    expect(btns[0].classList.contains('nr-tab-active')).toBe(false);
  });

  it('.options() replaces segments and returns this', () => {
    const sel = State('x');
    const sc = SegmentedControl(sel, ['x']);
    const ret = sc.options(['p', 'q']);
    expect(ret).toBe(sc);
    const btns = sc.el.querySelectorAll('.nr-tab-btn');
    expect(btns.length).toBe(2);
  });
});

// ─── Skeleton ────────────────────────────────────────────

describe('Skeleton', () => {
  it('creates a <div> element', () => {
    const sk = Skeleton();
    expect(sk.el.tagName).toBe('DIV');
  });

  it('sets _viewType to Skeleton', () => {
    const sk = Skeleton();
    expect(sk._viewType).toBe('Skeleton');
  });

  it('has nr-skeleton class', () => {
    const sk = Skeleton();
    expect(sk.el.classList.contains('nr-skeleton')).toBe(true);
  });

  it('.circle() sets width, height, and border-radius and returns this', () => {
    const sk = Skeleton();
    const ret = sk.circle(60);
    expect(ret).toBe(sk);
    expect(sk.el.style.width).toBe('60px');
    expect(sk.el.style.height).toBe('60px');
    expect(sk.el.style.borderRadius).toBe('50%');
  });

  it('.circle() defaults to 40px', () => {
    const sk = Skeleton().circle();
    expect(sk.el.style.width).toBe('40px');
    expect(sk.el.style.height).toBe('40px');
  });

  it('.lines() creates skeleton line children and returns this', () => {
    const sk = Skeleton();
    const ret = sk.lines(4);
    expect(ret).toBe(sk);
    const lines = sk.el.querySelectorAll('.nr-skeleton');
    expect(lines.length).toBe(4);
  });

  it('.lines() defaults to 3 lines', () => {
    const sk = Skeleton().lines();
    const lines = sk.el.querySelectorAll('.nr-skeleton');
    expect(lines.length).toBe(3);
  });

  it('.lines() last line has 60% width', () => {
    const sk = Skeleton().lines(3);
    const lines = sk.el.querySelectorAll('.nr-skeleton');
    expect(lines[2].style.width).toBe('60%');
  });
});
