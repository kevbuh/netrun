/* AetherUI — Assembler
   Exposes window.AetherUI and Aether.ui. Optional globals() to put primitives on window. */

(function() {
  'use strict';

  var state = window._AetherUIState || {};
  var View = window._AetherUIView;
  var prims = window._AetherUIPrimitives || {};
  var ctrls = window._AetherUIControls || {};
  var conts = window._AetherUIContainers || {};
  var ovrl = window._AetherUIOverlay || {};
  var comp = window._AetherUIComponent || {};

  // ─── Mount / Append ───────────────────────────────────────

  var _mountedViews = new WeakMap();

  function mount(view, target) {
    var container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) return;

    // Dispose previous view tree if any
    var prev = _mountedViews.get(container);
    if (prev && prev.dispose) prev.dispose();

    container.innerHTML = '';
    if (view instanceof View) {
      container.appendChild(view.build());
      if (view._onAppearFn) view._onAppearFn();
      _mountedViews.set(container, view);
    } else if (view instanceof HTMLElement) {
      container.appendChild(view);
      _mountedViews.delete(container);
    }
  }

  function append(view, target) {
    var container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) return;
    if (view instanceof View) {
      container.appendChild(view.build());
      if (view._onAppearFn) view._onAppearFn();
    } else if (view instanceof HTMLElement) {
      container.appendChild(view);
    }
  }

  // ─── API Object ───────────────────────────────────────────

  var api = {
    // State
    State: state.State,
    Computed: state.Computed,
    Effect: state.Effect,
    Binding: state.Binding,
    batch: state.batch,
    untrack: state.untrack,
    Context: state.Context,

    // View base
    View: View,

    // Primitives
    VStack: prims.VStack,
    HStack: prims.HStack,
    ZStack: prims.ZStack,
    Grid: prims.Grid,
    Spacer: prims.Spacer,
    Divider: prims.Divider,
    ScrollView: prims.ScrollView,
    Text: prims.Text,
    Label: prims.Label,
    Link: prims.Link,
    Image: prims.Image,
    Icon: prims.Icon,
    RawHTML: prims.RawHTML,

    // Controls
    Button: ctrls.Button,
    TextField: ctrls.TextField,
    Textarea: ctrls.Textarea,
    Toggle: ctrls.Toggle,
    Checkbox: ctrls.Checkbox,
    RadioGroup: ctrls.RadioGroup,
    Slider: ctrls.Slider,
    Picker: ctrls.Picker,
    Stepper: ctrls.Stepper,
    TabView: ctrls.TabView,
    ProgressBar: ctrls.ProgressBar,
    Pill: ctrls.Pill,

    // Containers
    ForEach: conts.ForEach,
    List: conts.List,
    Group: conts.Group,
    Section: conts.Section,

    // Overlays
    Sheet: ovrl.Sheet,
    Alert: ovrl.Alert,
    Popover: ovrl.Popover,
    Menu: ovrl.Menu,

    // Component
    defineComponent: comp.defineComponent,
    getComponent: comp.getComponent,
    listComponents: comp.listComponents,

    // Mount
    mount: mount,
    append: append,

    // Put all primitives, controls, containers on window for convenience
    globals: function() {
      var names = [
        'View',
        'State', 'Computed', 'Effect', 'Binding', 'batch', 'untrack', 'Context',
        'VStack', 'HStack', 'ZStack', 'Grid', 'Spacer', 'Divider', 'ScrollView',
        'Text', 'Label', 'Link', 'Image', 'Icon', 'RawHTML',
        'Button', 'TextField', 'Textarea', 'Toggle', 'Checkbox', 'RadioGroup',
        'Slider', 'Picker', 'Stepper', 'TabView', 'ProgressBar', 'Pill',
        'ForEach', 'List', 'Group', 'Section',
        'Sheet', 'Alert', 'Popover', 'Menu',
        'defineComponent'
      ];
      for (var i = 0; i < names.length; i++) {
        if (api[names[i]]) window[names[i]] = api[names[i]];
      }
    }
  };

  // ─── Expose ───────────────────────────────────────────────

  window.AetherUI = api;

  // Extend Aether if loaded
  if (window.Aether) {
    window.Aether.ui = api;
  }

})();
