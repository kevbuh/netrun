/* AetherUI Controls — Button, TextField, Toggle, Slider, Picker, Stepper
   Integrates with Binding for two-way state. Uses existing .nr-* CSS classes. */

'use strict';

import { View, _spaceToken, _colorToken } from '/aether/ui/view.js';
import { isSignal, isBinding, resolve, Effect, Computed, State } from '/aether/ui/state.js';
import { HStack, VStack, Text, Icon } from '/aether/ui/primitives.js';

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

  // TextField(binding) or TextField('placeholder') or TextField(binding, 'placeholder')
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
    // Remove previous listener if re-binding
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

// ─── Toggle (switch) ─────────────────────────────────────

function Toggle(binding, label) {
  var v = new View('label');
  v._viewType = 'Toggle';
  v.el.className = 'aether-ui-toggle';
  v.el.style.display = 'inline-flex';
  v.el.style.alignItems = 'center';
  v.el.style.gap = _spaceToken(2);
  v.el.style.cursor = 'pointer';

  // Label text
  if (label) {
    var labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.fontSize = '0.875rem';
    labelSpan.style.color = 'var(--nr-text-primary)';
    v.el.appendChild(labelSpan);
  }

  // Switch container
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

// ─── Slider ───────────────────────────────────────────────

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

// ─── Picker (select) ─────────────────────────────────────

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

// ─── Stepper ──────────────────────────────────────────────

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
    Text(display).font('body').frame({ minWidth: 32 }).style('textAlign', 'center'),
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
    // Resize on appear
    v._onAppearFns.push(resize);
    return v;
  };

  return v;
}

// ─── Checkbox ───────────────────────────────────────────

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

// ─── RadioGroup ─────────────────────────────────────────

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

// ─── TabView ────────────────────────────────────────────

function TabView(binding, tabs) {
  var v = new View('div');
  v._viewType = 'TabView';
  v.el.className = 'nr-tab-view';
  var _segmented = false;
  var _cache = {};       // index → { view, el }
  var _activeIndex = -1;

  var bar = document.createElement('div');
  bar.className = 'nr-tab-bar';
  var content = document.createElement('div');
  content.className = 'nr-tab-content';
  v.el.appendChild(bar);
  v.el.appendChild(content);

  function render(index) {
    if (index === _activeIndex) return;

    // Update buttons
    var btns = bar.querySelectorAll('.nr-tab-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('nr-tab-active', i === index);
    }

    // Hide current tab
    if (_activeIndex >= 0 && _cache[_activeIndex]) {
      _cache[_activeIndex].el.style.display = 'none';
    }

    // Show or create requested tab
    if (tabs && tabs[index] && tabs[index].content) {
      if (_cache[index]) {
        // Cached — just show it
        _cache[index].el.style.display = '';
      } else {
        // First visit — render and cache
        var child = tabs[index].content();
        if (child instanceof View) {
          var el = child.build();
          content.appendChild(el);
          for (var k = 0; k < child._onAppearFns.length; k++) child._onAppearFns[k]();
          v._children.push(child);
          _cache[index] = { view: child, el: el };
        } else if (child instanceof HTMLElement) {
          content.appendChild(child);
          _cache[index] = { view: null, el: child };
        }
      }
    }

    _activeIndex = index;
  }

  function buildTabs(tabList) {
    bar.innerHTML = '';
    // Dispose all cached tabs
    for (var key in _cache) {
      if (_cache[key].view && _cache[key].view.dispose) _cache[key].view.dispose();
      if (_cache[key].el.parentNode) _cache[key].el.parentNode.removeChild(_cache[key].el);
    }
    _cache = {};
    _activeIndex = -1;

    for (var i = 0; i < tabList.length; i++) {
      var btn = document.createElement('button');
      btn.className = 'nr-tab-btn';
      btn.textContent = tabList[i].label;
      (function(idx) {
        btn.addEventListener('click', function() {
          if (S.isSignal(binding)) binding.value = idx;
          else if (S.isBinding(binding)) binding.value = idx;
        });
      })(i);
      bar.appendChild(btn);
    }
    render(S.resolve(binding) || 0);
  }

  if (tabs) buildTabs(tabs);

  if (binding) {
    v._effects.push(S.Effect(function() {
      render(S.resolve(binding));
    }));
  }

  v.segmented = function() {
    _segmented = true;
    bar.classList.add('nr-tab-bar-segmented');
    return v;
  };
  v.underlined = function() {
    _segmented = false;
    bar.classList.remove('nr-tab-bar-segmented');
    return v;
  };

  return v;
}

// ─── ProgressBar ────────────────────────────────────────

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

// ─── Pill ───────────────────────────────────────────────

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

// ─── FormField — label + control + description wrapper ────

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

// ─── SearchField — TextField with search icon + clear ─────

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

  // Search icon
  var searchIcon = document.createElement('span');
  searchIcon.style.cssText = 'position:absolute;left:var(--nr-space-2);pointer-events:none;color:var(--nr-text-tertiary);display:inline-flex;align-items:center;';
  if (window.icon) searchIcon.innerHTML = window.icon('search', { size: 14 });
  else searchIcon.textContent = '\uD83D\uDD0D';

  // Clear button
  var clearBtn = document.createElement('span');
  clearBtn.style.cssText = 'position:absolute;right:var(--nr-space-2);cursor:pointer;color:var(--nr-text-tertiary);display:none;align-items:center;';
  if (window.icon) clearBtn.innerHTML = window.icon('close', { size: 14 });
  else clearBtn.textContent = '\u2715';

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

// ─── Spinner — CSS loading indicator ──────────────────────

function Spinner(size) {
  var v = new View('span');
  v._viewType = 'Spinner';
  var s = size || 20;
  v.el.style.cssText = 'display:inline-block;width:' + s + 'px;height:' + s + 'px;border:2px solid var(--nr-border-default);border-top-color:var(--nr-accent);border-radius:50%;animation:nr-spin 0.6s linear infinite;';

  // Inject keyframes if not already present
  if (!document.getElementById('nr-spin-keyframes')) {
    var style = document.createElement('style');
    style.id = 'nr-spin-keyframes';
    style.textContent = '@keyframes nr-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  v.size = function(sz) {
    v.el.style.width = sz + 'px';
    v.el.style.height = sz + 'px';
    return v;
  };

  return v;
}

// ─── Disclosure / CollapsibleSection ──────────────────────

function Disclosure(title, contentFn) {
  var v = new View('div');
  v._viewType = 'Disclosure';
  v.el.className = 'nr-disclosure';

  var _expanded = S.State(false);
  var _animate = false;
  var _childView = null;

  // Header
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

  // Content wrapper
  var content = document.createElement('div');
  content.className = 'nr-disclosure-content';
  content.style.display = 'none';
  if (_animate) content.style.overflow = 'hidden';
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
      if (_animate && window.Motion && window.Motion.animate) {
        window.Motion.animate(content, { opacity: [0, 1], duration: 150 });
      }
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

// ─── Skeleton — loading placeholder ──────────────────────

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

// ─── Export ───────────────────────────────────────────────

window._AetherUIControls = {
  Button: Button,
  TextField: TextField,
  Toggle: Toggle,
  Slider: Slider,
  Picker: Picker,
  Stepper: Stepper,
  Textarea: Textarea,
  Checkbox: Checkbox,
  RadioGroup: RadioGroup,
  TabView: TabView,
  ProgressBar: ProgressBar,
  Pill: Pill,
  FormField: FormField,
  SearchField: SearchField,
  Spinner: Spinner,
  Disclosure: Disclosure,
  Badge: Badge,
  SegmentedControl: SegmentedControl,
  Skeleton: Skeleton
};

export {
  Button, TextField, Toggle, Slider, Picker, Stepper,
  Textarea, Checkbox, RadioGroup, TabView, ProgressBar, Pill,
  FormField, SearchField, Spinner,
  Disclosure, Badge, SegmentedControl, Skeleton
};
