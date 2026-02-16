/* AetherUI Component — defineComponent(name, fn)
   Reusable view definitions with lifecycle hooks. */

(function() {
  'use strict';

  var View = window._AetherUIView;
  var _registry = {};

  function defineComponent(name, fn) {
    _registry[name] = fn;

    // Return a factory function
    return function() {
      var args = Array.prototype.slice.call(arguments);
      var view = fn.apply(null, args);
      if (view instanceof View) {
        view.el.setAttribute('data-component', name);
      }
      return view;
    };
  }

  function getComponent(name) {
    return _registry[name] || null;
  }

  function listComponents() {
    return Object.keys(_registry);
  }

  // ─── Export ───────────────────────────────────────────────

  window._AetherUIComponent = {
    defineComponent: defineComponent,
    getComponent: getComponent,
    listComponents: listComponents
  };

})();
