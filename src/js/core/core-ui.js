// core-ui.js — Link preview, pill stack, etc.
// Extracted from core.js

// ── Ell logo (curvy ℓ) inline SVG for new-tab favicons ──

// ── Link hover preview (bottom-left status bar) ──
function _showLinkPreview(url) {
  if (!_linkPreviewEl) _linkPreviewEl = document.getElementById('link-hover-preview');
  if (!_linkPreviewEl) return;
  clearTimeout(_linkPreviewTimer);
  _linkPreviewEl.textContent = url;
  _linkPreviewEl.style.opacity = '1';
}
function _hideLinkPreview() {
  if (!_linkPreviewEl) return;
  _linkPreviewTimer = setTimeout(function() { _linkPreviewEl.style.opacity = '0'; }, 80);
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
      if (tabM && typeof _browseWindows !== 'undefined') {
        for (let wi = 0; wi < _browseWindows.length; wi++) {
          const tabs = _browseWindows[wi].tabs;
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

function pillStackAdd(id) {
  if (_pillStack.indexOf(id) < 0) _pillStack.push(id);
  requestAnimationFrame(_pillStackReflow);
}
function pillStackRemove(id) {
  const i = _pillStack.indexOf(id);
  if (i >= 0) _pillStack.splice(i, 1);
  _pillStackReflow();
}
function _pillStackReflow() {
  let bottom = _PILL_BOTTOM;
  for (let i = 0; i < _pillStack.length; i++) {
    const el = document.getElementById(_pillStack[i]);
    if (!el || el.style.display === 'none') continue;
    el.style.bottom = bottom + 'px';
    bottom += el.offsetHeight + _PILL_GAP;
  }
}

// ── Custom annotation categories (loaded from server) ──

function _loadCustomAnnotationCategories() {
  apiGet('/api/annotation-categories')
    .then(function(d) { _customAnnotationCategories = d.categories || []; })
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

// Register pulse pill — renders into #pill-live-pulse (right of audio pill)
(function() {
  let _pulseFlashTimer = null;
  let _pulseLastEventTs = 0;
  const _pulseCatColors = { ai: '#a78bfa', embed: '#38bdf8', feed: '#f97316', quality: '#22c55e', network: '#94a3b8', system: '#e879f9' };

  function _renderLivePulse() {
    const el = document.getElementById('pill-live-pulse');
    if (!el) return;
    var recent = (typeof Motion !== 'undefined' && Motion.pulse) ? Motion.pulse.recent : [];
    const lastEvent = recent.length ? recent[recent.length - 1] : null;
    let dot = el.querySelector('.live-pulse-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'live-pulse-dot island-pulse-dot island-pulse-dot-idle nr-breathe';
      el.appendChild(dot);
    }

    // Flash the color of the latest event for 3 seconds
    if (lastEvent && lastEvent.timestamp > _pulseLastEventTs) {
      _pulseLastEventTs = lastEvent.timestamp;
      var col = _pulseCatColors[lastEvent.category] || '#94a3b8';
      dot.style.background = col;
      dot.style.boxShadow = '0 0 6px ' + col;
      dot.className = 'live-pulse-dot island-pulse-dot pulse-flash-active';
      if (_pulseFlashTimer) clearTimeout(_pulseFlashTimer);
      _pulseFlashTimer = setTimeout(function() {
        _pulseFlashTimer = null;
        dot.style.background = '';
        dot.style.boxShadow = '';
        dot.className = 'live-pulse-dot island-pulse-dot island-pulse-dot-idle nr-breathe';
      }, 3000);
    } else if (!_pulseFlashTimer) {
      dot.className = 'live-pulse-dot island-pulse-dot island-pulse-dot-idle nr-breathe';
      dot.style.background = '';
      dot.style.boxShadow = '';
    }

    // Build dropdown
    let dropdown = el.querySelector('.pulse-dropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'pulse-dropdown';
      el.appendChild(dropdown);
    }
    var recent = (typeof Motion !== 'undefined' && Motion.pulse) ? Motion.pulse.recent : [];
    let html = '<div class="pulse-dropdown-header">Live Pulse</div>';
    const start = Math.max(0, recent.length - 30);
    for (let ri = recent.length - 1; ri >= start; ri--) {
      const ev = recent[ri];
      var col = _pulseCatColors[ev.category] || '#94a3b8';
      const age = Math.round((Date.now() - ev.timestamp) / 1000);
      const ageStr = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago';
      const statusDot = ev.ok === true ? '#22c55e' : ev.ok === false ? '#ef4444' : '#94a3b8';
      html += '<div class="pulse-event-row"><span class="pulse-status-dot" style="background:' + statusDot + '"></span><span class="pulse-cat" style="color:' + col + '">' + escapeHtml(ev.category) + '</span><span class="pulse-label">' + escapeHtml(ev.label) + '</span><span class="pulse-age">' + ageStr + '</span></div>';
    }
    if (!recent.length) html += '<div style="padding:8px;opacity:0.3;font-size:0.65rem;text-align:center">No events yet</div>';
    dropdown.innerHTML = html;
  }
  function _initPulse() {
    _renderLivePulse();
    if (typeof Motion !== 'undefined' && Motion.pulse) {
      let _pulseThrottle = null;
      Motion.pulse.on(function() {
        if (_pulseThrottle) return;
        _pulseThrottle = setTimeout(function() {
          _pulseThrottle = null;
          _renderLivePulse();
        }, 500);
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initPulse);
  else setTimeout(_initPulse, 0);
})();

function islandUpdate(id, data) {
  _islandActivities[id] = Object.assign(_islandActivities[id] || {}, data, { _ts: Date.now() });
  _islandRender();
}

function islandRemove(id) {
  let el = document.querySelector('.pill-island[data-island-id="'+id+'"]');
  if (!el) {
    const anchor = document.getElementById('pill-island-tabs-anchor');
    if (anchor) el = anchor.querySelector('.pill-island[data-island-id="'+id+'"]');
  }
  if (_islandDismissTimers[id]) { clearTimeout(_islandDismissTimers[id]); delete _islandDismissTimers[id]; }
  delete _islandActivities[id];
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
function showAchievement(name, description) {
  islandUpdate('achievement', {
    type: 'achievement',
    label: name || 'Unlocked!',
    detail: description || 'Achievement Unlocked!',
    cssClass: 'nr-glow',
    action: function() { islandRemove('achievement'); }
  });
}


// ── Unified Audio Pill ──