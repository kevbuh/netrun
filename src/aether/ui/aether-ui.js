/* AetherUI — Assembler
   Exposes window.AetherUI and Aether.ui. Optional globals() to put primitives on window. */

'use strict';

import { State, Computed, Effect, Binding, Store, batch, untrack, Context } from '/aether/ui/state.js';
import { View } from '/aether/ui/view.js';
import { VStack, HStack, ZStack, Grid, Spacer, Divider, ScrollView, Text, Label, Link, Image, Icon, RawHTML } from '/aether/ui/primitives.js';
import { Button, TextField, Textarea, Toggle, Checkbox, RadioGroup, Slider, Picker, Stepper, TabView, ProgressBar, Pill } from '/aether/ui/controls.js';
import { ForEach, List, Group, Section, Show, Switch } from '/aether/ui/containers.js';
import { Sheet, Alert, Popover, Menu } from '/aether/ui/overlay.js';
import { defineComponent, getComponent, listComponents } from '/aether/ui/component.js';

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
    for (var i = 0; i < view._onAppearFns.length; i++) view._onAppearFns[i]();
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
    for (var i = 0; i < view._onAppearFns.length; i++) view._onAppearFns[i]();
  } else if (view instanceof HTMLElement) {
    container.appendChild(view);
  }
}

// ─── Serialize: walk a view tree into a semantic indented string ──

var INTERACTIVE_VIEW_TYPES = { Button: 1, TextField: 1, Textarea: 1, Toggle: 1, Checkbox: 1, RadioGroup: 1, Slider: 1, Picker: 1, Stepper: 1, Link: 1 };

function _serializeAttrs(view) {
  var el = view.el;
  var t = view._viewType;
  var parts = [];

  if (t === 'TextField') {
    if (el.placeholder) parts.push('placeholder="' + el.placeholder + '"');
    if (el.type && el.type !== 'text') parts.push('type=' + el.type);
    if (el.type === 'password') parts.push('secure');
    if (el.value) parts.push('value="' + el.value + '"');
    if (el.disabled) parts.push('disabled');
  } else if (t === 'Button') {
    var label = (el.textContent || '').trim();
    if (label) parts.push('"' + label + '"');
    if (el.disabled) parts.push('disabled');
  } else if (t === 'Link') {
    var linkText = (el.textContent || '').trim();
    if (linkText) parts.push('"' + linkText + '"');
    if (el.href) parts.push('href="' + el.href + '"');
  } else if (t === 'Toggle' || t === 'Checkbox') {
    var lbl = el.getAttribute('aria-label') || (el.textContent || '').trim();
    if (lbl) parts.push('label="' + lbl + '"');
    var inp = el.querySelector('input') || el;
    parts.push('checked=' + !!inp.checked);
  } else if (t === 'Slider') {
    if (el.min) parts.push('min=' + el.min);
    if (el.max) parts.push('max=' + el.max);
    parts.push('value=' + (el.value || 0));
  } else if (t === 'Picker') {
    if (el.value) parts.push('value="' + el.value + '"');
    if (el.options) parts.push('options=' + el.options.length);
  } else if (t === 'Textarea') {
    if (el.placeholder) parts.push('placeholder="' + el.placeholder + '"');
    if (el.value) parts.push('value="' + el.value + '"');
  } else if (t === 'Text') {
    var txt = (el.textContent || '').trim();
    if (txt) parts.push('"' + (txt.length > 80 ? txt.slice(0, 80) + '\u2026' : txt) + '"');
  } else if (t === 'Image') {
    if (el.alt) parts.push('alt="' + el.alt + '"');
  } else if (t === 'Section') {
    var header = el.querySelector('.aether-ui-section-header');
    if (header) {
      var hText = (header.textContent || '').trim();
      if (hText) parts.push('"' + hText + '"');
    }
  }

  return parts.length ? ' ' + parts.join(' ') : '';
}

var _serializeNextId = 1;

function _serializeNode(view, depth, lines) {
  var t = view._viewType || view.el.getAttribute('data-component') || view.el.tagName.toLowerCase();
  var indent = '';
  for (var d = 0; d < depth; d++) indent += '  ';
  var isInteractive = !!INTERACTIVE_VIEW_TYPES[t];

  if (isInteractive) {
    var id = _serializeNextId++;
    lines.push(indent + '[' + id + '] ' + t + _serializeAttrs(view));
  } else {
    lines.push(indent + t + _serializeAttrs(view));
  }

  for (var i = 0; i < view._children.length; i++) {
    _serializeNode(view._children[i], depth + 1, lines);
  }
}

function serialize(view) {
  _serializeNextId = 1;
  var lines = [];
  _serializeNode(view, 0, lines);
  return lines.join('\n');
}

// ─── API Object ───────────────────────────────────────────

var AetherUI = {
  // State
  State: State,
  Computed: Computed,
  Effect: Effect,
  Binding: Binding,
  Store: Store,
  batch: batch,
  untrack: untrack,
  Context: Context,

  // View base
  View: View,

  // Primitives
  VStack: VStack,
  HStack: HStack,
  ZStack: ZStack,
  Grid: Grid,
  Spacer: Spacer,
  Divider: Divider,
  ScrollView: ScrollView,
  Text: Text,
  Label: Label,
  Link: Link,
  Image: Image,
  Icon: Icon,
  RawHTML: RawHTML,

  // Controls
  Button: Button,
  TextField: TextField,
  Textarea: Textarea,
  Toggle: Toggle,
  Checkbox: Checkbox,
  RadioGroup: RadioGroup,
  Slider: Slider,
  Picker: Picker,
  Stepper: Stepper,
  TabView: TabView,
  ProgressBar: ProgressBar,
  Pill: Pill,

  // Containers
  ForEach: ForEach,
  List: List,
  Group: Group,
  Section: Section,
  Show: Show,
  Switch: Switch,

  // Overlays
  Sheet: Sheet,
  Alert: Alert,
  Popover: Popover,
  Menu: Menu,

  // Component
  defineComponent: defineComponent,
  getComponent: getComponent,
  listComponents: listComponents,

  // Mount
  mount: mount,
  append: append,
  serialize: serialize,

  // Put all primitives, controls, containers on window for convenience
  globals: function() {
    var names = [
      'View',
      'State', 'Computed', 'Effect', 'Binding', 'Store', 'batch', 'untrack', 'Context',
      'VStack', 'HStack', 'ZStack', 'Grid', 'Spacer', 'Divider', 'ScrollView',
      'Text', 'Label', 'Link', 'Image', 'Icon', 'RawHTML',
      'Button', 'TextField', 'Textarea', 'Toggle', 'Checkbox', 'RadioGroup',
      'Slider', 'Picker', 'Stepper', 'TabView', 'ProgressBar', 'Pill',
      'ForEach', 'List', 'Group', 'Section', 'Show', 'Switch',
      'Sheet', 'Alert', 'Popover', 'Menu',
      'defineComponent'
    ];
    for (var i = 0; i < names.length; i++) {
      if (AetherUI[names[i]]) window[names[i]] = AetherUI[names[i]];
    }
  }
};

// ─── Expose ───────────────────────────────────────────────

window.AetherUI = AetherUI;
AetherUI.globals();

// Extend Aether if loaded
if (window.Aether) {
  window.Aether.ui = AetherUI;
}

export { AetherUI };
