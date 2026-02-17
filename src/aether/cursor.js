/**
 * Aether Cursor — Metalab-style smooth custom cursor
 * A small dot follows the mouse exactly; a larger ring follows with inertia.
 */
(function () {
  'use strict';

  // Don't run inside webviews or iframes
  if (window.frameElement) return;

  var dot = document.createElement('div');
  var ring = document.createElement('div');
  dot.className = 'nr-cursor-dot';
  ring.className = 'nr-cursor-ring';
  document.body.appendChild(dot);
  document.body.appendChild(ring);
  document.body.classList.add('nr-custom-cursor');

  var mouse = { x: -100, y: -100 };
  var ringPos = { x: -100, y: -100 };
  var ease = 0.15;
  var running = true;

  function onMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }

  function onMouseEnter() {
    dot.classList.remove('is-hidden');
    ring.classList.remove('is-hidden');
  }

  function onMouseLeave() {
    dot.classList.add('is-hidden');
    ring.classList.add('is-hidden');
  }

  function tick() {
    if (!running) return;

    // Dot follows exactly
    dot.style.transform = 'translate(' + (mouse.x - dot.offsetWidth / 2) + 'px,' + (mouse.y - dot.offsetHeight / 2) + 'px)';

    // Ring follows with easing
    ringPos.x += (mouse.x - ringPos.x) * ease;
    ringPos.y += (mouse.y - ringPos.y) * ease;
    ring.style.transform = 'translate(' + (ringPos.x - ring.offsetWidth / 2) + 'px,' + (ringPos.y - ring.offsetHeight / 2) + 'px)';

    requestAnimationFrame(tick);
  }

  // Detect hover targets
  var hoverSelectors = 'a, button, [role="button"], input[type="submit"], .cursor-pointer, [onclick]';

  function onMouseOver(e) {
    var target = e.target;
    if (target.closest && target.closest(hoverSelectors)) {
      dot.classList.add('is-hovering');
      ring.classList.add('is-hovering');
    }
    // Text cursor
    var cs = window.getComputedStyle(target);
    if (cs.cursor === 'text' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      dot.classList.add('is-text');
    }
  }

  function onMouseOut(e) {
    var target = e.target;
    if (target.closest && target.closest(hoverSelectors)) {
      dot.classList.remove('is-hovering');
      ring.classList.remove('is-hovering');
    }
    var cs = window.getComputedStyle(target);
    if (cs.cursor === 'text' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      dot.classList.remove('is-text');
    }
  }

  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('mouseenter', onMouseEnter);
  document.addEventListener('mouseleave', onMouseLeave);
  document.addEventListener('mouseover', onMouseOver, { passive: true });
  document.addEventListener('mouseout', onMouseOut, { passive: true });

  requestAnimationFrame(tick);

  // Expose toggle on Aether namespace
  var api = {
    enable: function () {
      running = true;
      dot.style.display = '';
      ring.style.display = '';
      document.body.classList.add('nr-custom-cursor');
      requestAnimationFrame(tick);
    },
    disable: function () {
      running = false;
      dot.style.display = 'none';
      ring.style.display = 'none';
      document.body.classList.remove('nr-custom-cursor');
    },
    toggle: function () {
      running ? api.disable() : api.enable();
    }
  };

  if (window.Aether) {
    Aether.cursor = api;
  }
  window.AetherCursor = api;
})();
