// core-ui.js — Link preview, pill stack, etc.
// Extracted from core.js
import { apiGet } from '/js/api.js';
import { escapeHtml, escapeAttr } from '/js/core/core-utils.js';
import { _islandFlipNeighbors, _islandRender, _islandSnapshotRects } from '/js/core/core-audio.js';
import { browseSelectTab } from '/js/browse/browse-passwords.js';
import { lastFilteredPapers } from '/js/feed.js';
import { openPaper } from '/js/panel.js';

// ── Ell logo (curvy ℓ) inline SVG for new-tab favicons ──

// ── Link hover preview (bottom-left status bar) ──
export function _showLinkPreview(url) {
  if (!window._linkPreviewEl) window._linkPreviewEl = document.getElementById('link-hover-preview');
  if (!window._linkPreviewEl) return;
  clearTimeout(window._linkPreviewTimer);
  window._linkPreviewEl.textContent = url;
  window._linkPreviewEl.style.opacity = '1';
}
export function _hideLinkPreview() {
  if (!window._linkPreviewEl) return;
  window._linkPreviewTimer = setTimeout(function() { window._linkPreviewEl.style.opacity = '0'; }, 80);
}
function _linkUrlFromElement(target) {
  if (!target || !target.closest) return null;
  // 1. Real <a> tags
  const a = target.closest('a[href]');
  if (a) {
    const h = a.href || a.getAttribute('href');
    if (h && h !== '#' && !h.startsWith('javascript:')) return h;
  }
  // 2. Walk up to find onclick handlers
  let node = target;
  while (node && node !== document.body) {
    const oc = node.getAttribute && node.getAttribute('onclick');
    if (oc) {
      // Feed cards: openPaper(index, event)
      const paperM = oc.match(/openPaper\((\d+)/);
      if (paperM && typeof lastFilteredPapers !== 'undefined') {
        const paper = lastFilteredPapers[+paperM[1]];
        if (paper) return paper.link;
      }
      // Browse tabs: browseSelectTab(id)
      const tabM = oc.match(/browseSelectTab\((\d+)\)/);
      if (tabM && typeof window._browseWindows !== 'undefined') {
        for (let wi = 0; wi < window._browseWindows.length; wi++) {
          const tabs = window._browseWindows[wi].tabs;
          for (let ti = 0; ti < tabs.length; ti++) {
            if (tabs[ti].id === +tabM[1] && tabs[ti].url) return tabs[ti].url;
          }
        }
      }
      // Hash navigation: location.hash='#...'
      const hashM = oc.match(/location\.hash\s*=\s*['"]([^'"]+)['"]/);
      if (hashM) return location.origin + '/' + hashM[1];
    }
    node = node.parentElement;
  }
  return null;
}
document.addEventListener('mouseover', function(e) {
  const url = _linkUrlFromElement(e.target);
  if (url) _showLinkPreview(url);
  else _hideLinkPreview();
}, true);
document.addEventListener('mouseout', function(e) {
  if (_linkUrlFromElement(e.target)) _hideLinkPreview();
});

// ── Pill stack manager (bottom-right notification pills) ──

export function pillStackAdd(id) {
  if (window._pillStack.indexOf(id) < 0) window._pillStack.push(id);
  requestAnimationFrame(_pillStackReflow);
}
export function pillStackRemove(id) {
  const i = window._pillStack.indexOf(id);
  if (i >= 0) window._pillStack.splice(i, 1);
  _pillStackReflow();
}
function _pillStackReflow() {
  let bottom = window._PILL_BOTTOM;
  for (let i = 0; i < window._pillStack.length; i++) {
    const el = document.getElementById(window._pillStack[i]);
    if (!el || el.style.display === 'none') continue;
    el.style.bottom = bottom + 'px';
    bottom += el.offsetHeight + window._PILL_GAP;
  }
}

// ── Custom annotation categories (loaded from server) ──

export function _loadCustomAnnotationCategories() {
  apiGet('/api/annotation-categories')
    .then(function(d) { window._customAnnotationCategories = d.categories || []; })
    .catch(function() {});
}

// ── Dynamic Island — live activity capsule ──

// Keep pill container constrained on resize/mode change
window.addEventListener('resize', function() {
  const cont = document.getElementById('pill-island');
  const wrap = document.getElementById('pill-url-wrap');
  const nav = document.getElementById('sidebar-nav');
  if (!cont || !wrap || !nav || !nav.classList.contains('island-mode')) {
    if (cont) cont.style.removeProperty('--island-pills-max-w');
    return;
  }
  const ur = wrap.getBoundingClientRect();
  const cr = cont.getBoundingClientRect();
  const avail = ur.left - cr.left - 12;
  if (avail > 0) cont.style.setProperty('--island-pills-max-w', Math.floor(avail) + 'px');
});

// ── Pulse state provider for unified AI pill ──
let _pulseFlashTimer = null;
let _pulseLastEventTs = 0;
let _pulseIsFlashing = false;

export function _getPulseState() {
  const recent = (typeof Motion !== 'undefined' && Motion.pulse) ? Motion.pulse.recent : [];
  const lastEvent = recent.length ? recent[recent.length - 1] : null;

  // Track flash state
  if (lastEvent && lastEvent.timestamp > _pulseLastEventTs) {
    _pulseLastEventTs = lastEvent.timestamp;
    _pulseIsFlashing = true;
    if (_pulseFlashTimer) clearTimeout(_pulseFlashTimer);
    _pulseFlashTimer = setTimeout(function() {
      _pulseFlashTimer = null;
      _pulseIsFlashing = false;
      if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
    }, 3000);
  }

  return { recent: recent, lastEvent: lastEvent, isFlashing: _pulseIsFlashing };
}
window._getPulseState = _getPulseState;

export function _setIslandActivity(id, data) {
  window._islandActivities.update(id, function(old) {
    return Object.assign({}, old || {}, data, { _ts: Date.now() });
  });
}
export function _clearIslandActivity(id) {
  window._islandActivities.delete(id);
}

export function islandUpdate(id, data) {
  _setIslandActivity(id, data);
  _islandRender();
}

export function islandRemove(id) {
  let el = document.querySelector('.pill-island[data-island-id="'+id+'"]');
  if (!el) {
    const anchor = document.getElementById('pill-island-tabs-anchor');
    if (anchor) el = anchor.querySelector('.pill-island[data-island-id="'+id+'"]');
  }
  if (window._islandDismissTimers[id]) { clearTimeout(window._islandDismissTimers[id]); delete window._islandDismissTimers[id]; }
  _clearIslandActivity(id);
  if (el && !el.classList.contains('island-exiting')) {
    const parentCont = el.parentNode;
    _islandSnapshotRects(parentCont);
    el.classList.add('island-exiting');
    el.addEventListener('animationend', function onExit(ev) {
      if (ev.animationName !== 'pill-exit') return;
      el.removeEventListener('animationend', onExit);
      _islandSnapshotRects(parentCont);
      el.remove();
      _islandFlipNeighbors(parentCont);
    });
  } else if (el) {
    el.remove();
  }
}

// Global achievement helper — persistent island pill, click to dismiss
export function showAchievement(name, description) {
  islandUpdate('achievement', {
    type: 'achievement',
    label: name || 'Unlocked!',
    detail: description || 'Achievement Unlocked!',
    cssClass: 'nr-glow',
    action: function() { islandRemove('achievement'); }
  });
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#d4a017');
}

// ── Unified Audio Pill ──