// ── Action Registry: event delegation for inline handler replacement ──
// Replaces onclick="fn()" with data-action-click="fn" + data-action-arg="..."

const _actions = {};

/**
 * Register a single action handler.
 * @param {string} name — action name (matches data-action-* value)
 * @param {function} handler — (event, arg, element) => void
 */
export function registerAction(name, handler) {
  _actions[name] = handler;
}

/**
 * Register multiple actions at once.
 * @param {Object<string, function>} map — { actionName: handler, ... }
 */
export function registerActions(map) {
  for (const [name, handler] of Object.entries(map)) {
    _actions[name] = handler;
  }
}

/**
 * Look up and invoke an action by name.
 * @param {string} name
 * @param {Event} event
 * @param {string|undefined} arg
 * @param {Element} el — the element that matched the data-action attribute
 */
function _dispatch(name, event, arg, el) {
  const handler = _actions[name];
  if (!handler) {
    console.warn(`[actions] No handler registered for "${name}"`);
    return;
  }
  handler(event, arg, el);
}

// Event types we delegate
const _delegatedEvents = ['click', 'keydown', 'keyup', 'mouseenter', 'mouseleave', 'focus', 'blur', 'input', 'change', 'submit'];

/**
 * Install event delegation on document.
 * Call once at app startup (after DOM ready).
 */
export function installEventDelegation() {
  for (const eventType of _delegatedEvents) {
    const attr = `data-action-${eventType}`;
    // mouseenter/mouseleave don't bubble — use capture
    const useCapture = eventType === 'mouseenter' || eventType === 'mouseleave' ||
                       eventType === 'focus' || eventType === 'blur';

    document.addEventListener(eventType, (e) => {
      // Walk from target up to find element with the action attribute
      let el = e.target;
      while (el && el !== document) {
        const actionName = el.getAttribute(attr);
        if (actionName) {
          const arg = el.getAttribute('data-action-arg');
          _dispatch(actionName, e, arg || undefined, el);
          return;
        }
        el = el.parentElement;
      }
    }, useCapture);
  }
}

// Install delegation immediately — modules execute after DOM parsing
installEventDelegation();

// ── Backward compatibility: expose on window ──
window.registerAction = registerAction;
window.registerActions = registerActions;
window.installEventDelegation = installEventDelegation;
