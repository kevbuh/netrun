// core-sidebar.js — Sidebar config, drag-to-reorder
// Extracted from core.js

// ── Sidebar icon visibility & order ──
const SIDEBAR_ICON_IDS = ['sb-dashboard','sb-home','sb-vault','sb-browse','sb-neuralook','sb-dev','sb-rain','sb-settings'];

function _sidebarEl(id) {
  return document.getElementById(id + '-wrap') || document.getElementById(id);
}

function applySidebarVisibility() {
  let hidden = [];
  try { hidden = JSON.parse(localStorage.getItem('hiddenSidebarIcons')) || []; } catch (e) { /* fire-and-forget */ }
  SIDEBAR_ICON_IDS.forEach(id => {
    const el = _sidebarEl(id);
    if (el) el.style.display = hidden.includes(id) ? 'none' : '';
  });
}

function getSidebarOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem('sidebarOrder'));
    if (Array.isArray(saved) && saved.length) {
      // Add any new icons not in saved order
      const full = SIDEBAR_ICON_IDS.filter(id => !saved.includes(id));
      return [...saved.filter(id => SIDEBAR_ICON_IDS.includes(id)), ...full];
    }
  } catch (e) { /* fire-and-forget */ }
  return [...SIDEBAR_ICON_IDS];
}

function applySidebarOrder() {
  const nav = document.getElementById('pill-nav-icons');
  if (!nav) return;
  const order = getSidebarOrder();
  const pet = document.getElementById('pixel-pet-sidebar');
  order.forEach(id => {
    const el = _sidebarEl(id);
    if (el) nav.insertBefore(el, pet);
  });
}

// ── Sidebar drag-to-reorder ──
(function() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  function getDraggables() {
    return Array.from(nav.querySelectorAll('.sidebar-draggable'));
  }

  function getSpacer() {
    return nav.querySelector('.mt-auto');
  }

  // Restore saved order from localStorage
  function restoreOrder() {
    const saved = localStorage.getItem('sidebarOrder');
    if (!saved) return;
    try {
      const order = JSON.parse(saved); // array of ids e.g. ['sb-home','sb-experiments',...]
      const spacer = getSpacer();
      const btns = getDraggables();
      const btnMap = {};
      btns.forEach(b => { btnMap[b.id] = b; });
      order.forEach(id => {
        if (btnMap[id]) nav.insertBefore(btnMap[id], spacer);
      });
      // Append any buttons not in saved order (new buttons)
      btns.forEach(b => {
        if (!order.includes(b.id)) nav.insertBefore(b, spacer);
      });
    } catch (e) { /* fire-and-forget */ }
  }

  function saveOrder() {
    const ids = getDraggables().map(b => b.id);
    localStorage.setItem('sidebarOrder', JSON.stringify(ids));
  }

  restoreOrder();
  applySidebarOrder();
  applySidebarVisibility();

  let dragEl = null;
  let dragGhost = null;
  let startX = 0;
  let dragStarted = false;

  nav.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.sidebar-draggable');
    if (!btn) return;
    dragEl = btn;
    startX = e.clientX;
    dragStarted = false;
    dragEl.setPointerCapture(e.pointerId);
  });

  nav.addEventListener('pointermove', e => {
    if (!dragEl) return;
    if (!dragStarted && Math.abs(e.clientX - startX) < 5) return;
    if (!dragStarted) {
      dragStarted = true;
      dragEl.style.opacity = '0.3';
      dragGhost = dragEl.cloneNode(true);
      dragGhost.classList.add('sidebar-drag-ghost');
      dragGhost.style.cssText = `position:fixed;top:${nav.getBoundingClientRect().top}px;pointer-events:none;z-index:999;opacity:0.9;`;
      document.body.appendChild(dragGhost);
    }
    const rect = nav.getBoundingClientRect();
    dragGhost.style.left = (e.clientX - 17) + 'px';
    dragGhost.style.top = rect.top + 'px';

    // Find drop target
    const btns = getDraggables();
    for (const b of btns) {
      if (b === dragEl) continue;
      const r = b.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      if (e.clientX < mid) {
        nav.insertBefore(dragEl, b);
        return;
      }
    }
    // Past all — insert before spacer
    const spacer = getSpacer();
    if (spacer) nav.insertBefore(dragEl, spacer);
  });

  function endDrag() {
    if (!dragEl) return;
    dragEl.style.opacity = '';
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    if (dragStarted) {
      saveOrder();
      // Suppress the click that would follow the drag
      const suppress = e => { e.stopPropagation(); e.preventDefault(); };
      dragEl.addEventListener('click', suppress, { capture: true, once: true });
    }
    dragEl = null;
    dragStarted = false;
  }

  nav.addEventListener('pointerup', endDrag);
  nav.addEventListener('pointercancel', endDrag);
})();

// ── Browse bar drag-to-reorder ──
(function() {
  const bar = document.getElementById('browse-bar');
  if (!bar) return;

  function getDraggables() {
    return Array.from(bar.querySelectorAll('.browse-bar-draggable'));
  }

  function getAnchor() {
    return document.getElementById('browse-url-input');
  }

  function getOverflowIds() {
    try { return JSON.parse(localStorage.getItem('browseBarOverflow') || '[]'); } catch { return []; }
  }

  function addToBarOverflow(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
    const ids = getOverflowIds();
    if (!ids.includes(id)) ids.push(id);
    localStorage.setItem('browseBarOverflow', JSON.stringify(ids));
  }

  function removeFromBarOverflow(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
    const ids = getOverflowIds().filter(i => i !== id);
    localStorage.setItem('browseBarOverflow', JSON.stringify(ids));
    saveBrowseBarOrder();
  }

  const DEFAULT_OVERFLOW = ['browse-search-history-btn'];

  function restoreBrowseBarOrder() {
    // Ensure default overflow buttons are hidden if user hasn't explicitly moved them
    const existingOverflow = localStorage.getItem('browseBarOverflow');
    if (!existingOverflow) {
      localStorage.setItem('browseBarOverflow', JSON.stringify(DEFAULT_OVERFLOW));
    } else {
      // For existing users: add new default overflow items they haven't seen yet,
      // and remove stale IDs for buttons that no longer exist in the bar
      try {
        let cur = JSON.parse(existingOverflow);
        const savedOrder = localStorage.getItem('browseBarOrder');
        const knownIds = savedOrder ? JSON.parse(savedOrder) : [];
        let changed = false;
        for (const id of DEFAULT_OVERFLOW) {
          if (!cur.includes(id) && !knownIds.includes(id)) {
            cur.push(id);
            changed = true;
          }
        }
        // Remove IDs for buttons no longer in the DOM
        const before = cur.length;
        cur = cur.filter(id => document.getElementById(id));
        if (cur.length !== before) changed = true;
        if (changed) localStorage.setItem('browseBarOverflow', JSON.stringify(cur));
      } catch (e) { /* fire-and-forget */ }
    }
    const saved = localStorage.getItem('browseBarOrder');
    if (!saved) {
      // Still hide overflow buttons even with no saved order
      const overflow = getOverflowIds();
      overflow.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      return;
    }
    try {
      const PINNED_RIGHT = ['browse-more-btn', 'browse-sidebar-toggle'];
      const order = JSON.parse(saved);
      const btns = getDraggables();
      const btnMap = {};
      btns.forEach(b => { btnMap[b.id] = b; });
      // Insert in saved order, each after the previous (or after anchor for first)
      let ref = getAnchor();
      order.forEach(id => {
        if (btnMap[id] && !PINNED_RIGHT.includes(id)) {
          ref.after(btnMap[id]);
          ref = btnMap[id];
        }
      });
      // Append any buttons not in saved order (new buttons) before pinned
      btns.forEach(b => {
        if (!order.includes(b.id) && !PINNED_RIGHT.includes(b.id)) {
          ref.after(b);
          ref = b;
        }
      });
      // Ensure pinned-right buttons are always last (more, then sidebar toggle)
      const moreEl = btnMap['browse-more-btn'];
      const sidebarEl = btnMap['browse-sidebar-toggle'];
      if (moreEl) { ref.after(moreEl); ref = moreEl; }
      // more-menu div sits between more btn and sidebar toggle in DOM
      const menuDiv = document.getElementById('browse-more-menu');
      if (menuDiv) { ref.after(menuDiv); ref = menuDiv; }
      if (sidebarEl) { ref.after(sidebarEl); }
    } catch (e) { /* fire-and-forget */ }
    // Hide any buttons in overflow
    const overflow = getOverflowIds();
    overflow.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function saveBrowseBarOrder() {
    const ids = getDraggables().map(b => b.id);
    localStorage.setItem('browseBarOrder', JSON.stringify(ids));
  }

  restoreBrowseBarOrder();

  let dragEl = null;
  let dragGhost = null;
  let startX = 0;
  let dragStarted = false;
  let dragPointerId = -1;

  const NON_DRAGGABLE = ['browse-more-btn'];

  bar.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.browse-bar-draggable');
    if (!btn || NON_DRAGGABLE.includes(btn.id)) return;
    dragEl = btn;
    startX = e.clientX;
    dragStarted = false;
    dragPointerId = e.pointerId;
  });

  bar.addEventListener('pointermove', e => {
    if (!dragEl) return;
    if (!dragStarted && Math.abs(e.clientX - startX) < 5) return;
    if (!dragStarted) {
      dragStarted = true;
      dragEl.setPointerCapture(dragPointerId);
      dragEl.classList.add('dragging');
      // Hide all tooltips during drag
      getDraggables().forEach(b => {
        if (b.title) { b.dataset.savedTitle = b.title; b.removeAttribute('title'); }
      });
      dragGhost = dragEl.cloneNode(true);
      dragGhost.classList.add('browse-bar-drag-ghost');
      dragGhost.classList.remove('dragging');
      dragGhost.removeAttribute('title');
      const r = dragEl.getBoundingClientRect();
      dragGhost.style.top = r.top + 'px';
      dragGhost.style.width = r.width + 'px';
      dragGhost.style.height = r.height + 'px';
      document.body.appendChild(dragGhost);
    }
    dragGhost.style.left = (e.clientX - dragGhost.offsetWidth / 2) + 'px';

    // Detect hover over More button for overflow drop
    const moreBtn = document.getElementById('browse-more-btn');
    if (moreBtn && dragEl !== moreBtn) {
      const mr = moreBtn.getBoundingClientRect();
      if (e.clientX >= mr.left && e.clientX <= mr.right && e.clientY >= mr.top && e.clientY <= mr.bottom) {
        moreBtn.classList.add('browse-more-btn-drop-target');
      } else {
        moreBtn.classList.remove('browse-more-btn-drop-target');
      }
    }

    // Find drop target (skip pinned-right buttons)
    const PINNED_RIGHT = ['browse-more-btn', 'browse-sidebar-toggle'];
    const btns = getDraggables().filter(b => !PINNED_RIGHT.includes(b.id));
    for (const b of btns) {
      if (b === dragEl) continue;
      if (b.offsetParent === null && b.style.display === 'none') continue;
      const r = b.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      if (e.clientX < mid) {
        bar.insertBefore(dragEl, b);
        return;
      }
    }
    // Past all reorderable buttons — insert before the more button
    const moreEl = document.getElementById('browse-more-btn');
    if (moreEl) bar.insertBefore(dragEl, moreEl);
  });

  function endDrag() {
    if (!dragEl) return;
    const moreBtn = document.getElementById('browse-more-btn');
    const droppedOnMore = moreBtn && moreBtn.classList.contains('browse-more-btn-drop-target');
    if (moreBtn) moreBtn.classList.remove('browse-more-btn-drop-target');
    dragEl.classList.remove('dragging');
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    // Restore tooltips
    getDraggables().forEach(b => {
      if (b.dataset.savedTitle) { b.title = b.dataset.savedTitle; delete b.dataset.savedTitle; }
    });
    if (dragStarted) {
      if (droppedOnMore && dragEl !== moreBtn) {
        addToBarOverflow(dragEl.id);
      }
      saveBrowseBarOrder();
      const suppress = e => { e.stopPropagation(); e.preventDefault(); };
      dragEl.addEventListener('click', suppress, { capture: true, once: true });
    }
    dragEl = null;
    dragStarted = false;
  }

  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  // Expose functions globally so they can be called after sync / from menus
  window.restoreBrowseBarOrder = restoreBrowseBarOrder;
  window.removeFromBarOverflow = removeFromBarOverflow;
  window.getBarOverflowIds = getOverflowIds;
})();

// ── Button click sound (Web Audio API) ──