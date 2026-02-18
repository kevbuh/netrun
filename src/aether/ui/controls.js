/* AetherUI Controls — Button, TextField, Toggle, Slider, Picker, Stepper
   Integrates with Binding for two-way state. Uses existing .nr-* CSS classes. */

(function() {
  'use strict';

  var View = window._AetherUIView;
  var S = window._AetherUIState;

  function _spaceToken(v) {
    if (typeof v === 'number') return 'var(--nr-space-' + v + ')';
    return v;
  }

  // ─── Button ───────────────────────────────────────────────

  function Button(label) {
    var v = new View('button');
    v.el.className = 'nr-btn nr-btn-primary';
    v._bindText(label);

    v.primary = function() {
      v.el.className = v.el.className.replace(/nr-btn-\w+/g, '').trim() + ' nr-btn-primary';
      return v;
    };
    v.secondary = function() {
      v.el.className = v.el.className.replace(/nr-btn-\w+/g, '').trim() + ' nr-btn-secondary';
      return v;
    };
    v.ghost = function() {
      v.el.className = v.el.className.replace(/nr-btn-\w+/g, '').trim() + ' nr-btn-ghost';
      return v;
    };
    v.danger = function() {
      v.el.className = v.el.className.replace(/nr-btn-\w+/g, '').trim() + ' nr-btn-danger';
      return v;
    };
    v.small = function() { v.el.classList.add('nr-btn-sm'); return v; };
    v.large = function() { v.el.classList.add('nr-btn-lg'); return v; };
    v.iconButton = function(iconName) {
      v.el.classList.add('nr-btn-icon');
      if (iconName && window.icon) {
        v.el.innerHTML = window.icon(iconName, { size: 14 });
      }
      return v;
    };

    return v;
  }

  // ─── TextField ────────────────────────────────────────────

  function TextField(placeholderOrBinding, placeholder) {
    var v = new View('input');
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

    v.bind = function(b) {
      v.el.value = S.resolve(b);
      v.el.addEventListener('input', function() { b.value = v.el.value; });
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

    var HStack = window._AetherUIPrimitives.HStack;
    var Text = window._AetherUIPrimitives.Text;

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

    return v;
  }

  // ─── Textarea ────────────────────────────────────────────

  function Textarea(binding, placeholder) {
    var v = new View('textarea');
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
      var origAppear = v._onAppearFn;
      v._onAppearFn = function() {
        if (origAppear) origAppear();
        resize();
      };
      return v;
    };

    return v;
  }

  // ─── Checkbox ───────────────────────────────────────────

  function Checkbox(binding, label) {
    var v = new View('label');
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
    v.el.className = 'nr-tab-view';
    var _segmented = false;

    var bar = document.createElement('div');
    bar.className = 'nr-tab-bar';
    var content = document.createElement('div');
    content.className = 'nr-tab-content';
    v.el.appendChild(bar);
    v.el.appendChild(content);

    function render(index) {
      // Update buttons
      var btns = bar.querySelectorAll('.nr-tab-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('nr-tab-active', i === index);
      }
      // Update content
      content.innerHTML = '';
      if (tabs && tabs[index] && tabs[index].content) {
        var child = tabs[index].content();
        if (child instanceof View) {
          content.appendChild(child.build());
          if (child._onAppearFn) child._onAppearFn();
        } else if (child instanceof HTMLElement) {
          content.appendChild(child);
        }
      }
    }

    function buildTabs(tabList) {
      bar.innerHTML = '';
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
    Pill: Pill
  };

})();
