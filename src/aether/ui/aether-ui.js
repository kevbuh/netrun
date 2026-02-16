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

  function mount(view, target) {
    var container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) return;
    container.innerHTML = '';
    if (view instanceof View) {
      container.appendChild(view.build());
      if (view._onAppearFn) view._onAppearFn();
    } else if (view instanceof HTMLElement) {
      container.appendChild(view);
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

    // View base
    View: View,

    // Primitives
    VStack: prims.VStack,
    HStack: prims.HStack,
    ZStack: prims.ZStack,
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
    Toggle: ctrls.Toggle,
    Slider: ctrls.Slider,
    Picker: ctrls.Picker,
    Stepper: ctrls.Stepper,

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
        'State', 'Computed', 'Effect', 'Binding', 'batch',
        'VStack', 'HStack', 'ZStack', 'Spacer', 'Divider', 'ScrollView',
        'Text', 'Label', 'Link', 'Image', 'Icon', 'RawHTML',
        'Button', 'TextField', 'Toggle', 'Slider', 'Picker', 'Stepper',
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
