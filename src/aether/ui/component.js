/* AetherUI Component — Component(name, renderFn)
   Functional components with props, children, and disposal scope. */

'use strict';

import { View } from '/aether/ui/view.js';
import { runWithScope } from '/aether/ui/state.js';

var _registry = {};

function _isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof View) && !(v instanceof HTMLElement);
}

function Component(name, renderFn) {
  _registry[name] = renderFn;

  var factory = function() {
    var args = Array.prototype.slice.call(arguments);
    var props, children;

    if (args.length > 0 && _isPlainObject(args[0])) {
      props = args[0];
      children = args.slice(1);
    } else {
      props = {};
      children = args;
    }

    // Run render inside a disposal scope — captures all State/Effect/Computed
    var scoped = runWithScope(function() {
      return renderFn(props, children);
    });

    var view = scoped.result;
    if (view instanceof View) {
      view.el.setAttribute('data-component', name);
      // Attach scoped disposables so View.dispose() cleans them up
      for (var i = 0; i < scoped.disposables.length; i++) {
        view._effects.push(scoped.disposables[i]);
      }
    }
    return view;
  };

  factory._componentName = name;
  return factory;
}

// Backward compat alias
function defineComponent(name, fn) {
  return Component(name, function() {
    return fn.apply(null, arguments);
  });
}

function getComponent(name) {
  return _registry[name] || null;
}

function listComponents() {
  return Object.keys(_registry);
}

// ─── Export ───────────────────────────────────────────────

window._AetherUIComponent = {
  Component: Component,
  defineComponent: defineComponent,
  getComponent: getComponent,
  listComponents: listComponents
};

export { Component, defineComponent, getComponent, listComponents };
