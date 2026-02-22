// core-ui.js — Link preview, pill stack, etc.
// Extracted from core.js
import { apiGet } from '/js/api.js';
import { escapeHtml, escapeAttr } from '/js/core/core-utils.js';
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

// ── Dynamic Island — delegated to toolbar-activities.js ──
// Re-export for backwards compatibility with files that import from core-ui.js
export { islandUpdate, islandRemove, showAchievement, _getPulseState,
         _setIslandActivity, _clearIslandActivity } from '/js/toolbar/toolbar-activities.js';