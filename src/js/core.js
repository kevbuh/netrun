// ── Ell logo (curvy ℓ) inline SVG for new-tab favicons ──
var _ELL_SVG = '<svg class="ell-favicon" viewBox="0 0 961 1259" width="16" height="16" fill="none"><path d="M334.385 761.105L286.951 798.06C278.902 804.874 272.865 808.281 268.84 808.281C264.815 808.281 260.503 805.398 255.903 799.632C251.304 793.866 249.004 789.673 249.004 787.052C249.004 783.907 253.029 778.927 261.078 772.113C266.828 767.395 278.902 757.829 297.3 743.414C315.699 728.999 326.336 720.743 329.21 718.646C329.21 665.704 339.416 607.782 359.827 544.88C380.238 481.978 409.273 426.808 446.933 379.37C484.593 331.931 524.121 308.212 565.518 308.212C583.916 308.212 599.584 314.109 612.521 325.903C625.457 337.697 631.925 357.223 631.925 384.48C631.925 462.059 570.98 555.364 449.089 664.393C447.364 666.49 442.477 670.946 434.428 677.76C426.378 684.574 421.204 689.03 418.904 691.127C413.729 719.433 411.142 741.972 411.142 758.746C411.142 813.785 428.391 841.305 462.888 841.305C496.81 841.305 539.357 822.172 590.528 783.907C596.278 778.665 600.878 776.044 604.327 776.044C608.927 776.044 613.527 778.796 618.126 784.3C622.726 789.804 625.026 794.128 625.026 797.274C625.026 799.894 624.02 802.253 622.007 804.35C619.995 806.447 614.102 811.164 604.327 818.503C553.731 852.575 506.01 869.611 461.163 869.611C430.115 869.611 403.236 860.569 380.525 842.484C357.815 824.4 342.434 797.274 334.385 761.105ZM433.565 629.011C462.313 604.899 491.923 573.71 522.396 535.445C569.543 477.261 593.116 424.58 593.116 377.404C593.116 350.146 583.629 336.518 564.655 336.518C539.932 336.518 514.634 371.638 488.761 441.878C478.412 470.708 460.013 533.086 433.565 629.011Z" fill="currentColor"/></svg>';

// ── Link hover preview (bottom-left status bar) ──
var _linkPreviewEl = null;
var _linkPreviewTimer = 0;
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
  var a = target.closest('a[href]');
  if (a) {
    var h = a.href || a.getAttribute('href');
    if (h && h !== '#' && !h.startsWith('javascript:')) return h;
  }
  // 2. Walk up to find onclick handlers
  var node = target;
  while (node && node !== document.body) {
    var oc = node.getAttribute && node.getAttribute('onclick');
    if (oc) {
      // Feed cards: openPaper(index, event)
      var paperM = oc.match(/openPaper\((\d+)/);
      if (paperM && typeof lastFilteredPapers !== 'undefined') {
        var paper = lastFilteredPapers[+paperM[1]];
        if (paper) return paper.link;
      }
      // Browse tabs: browseSelectTab(id)
      var tabM = oc.match(/browseSelectTab\((\d+)\)/);
      if (tabM && typeof _browseWindows !== 'undefined') {
        for (var wi = 0; wi < _browseWindows.length; wi++) {
          var tabs = _browseWindows[wi].tabs;
          for (var ti = 0; ti < tabs.length; ti++) {
            if (tabs[ti].id === +tabM[1] && tabs[ti].url) return tabs[ti].url;
          }
        }
      }
      // Hash navigation: location.hash='#...'
      var hashM = oc.match(/location\.hash\s*=\s*['"]([^'"]+)['"]/);
      if (hashM) return location.origin + '/' + hashM[1];
    }
    node = node.parentElement;
  }
  return null;
}
document.addEventListener('mouseover', function(e) {
  var url = _linkUrlFromElement(e.target);
  if (url) _showLinkPreview(url);
  else _hideLinkPreview();
}, true);
document.addEventListener('mouseout', function(e) {
  if (_linkUrlFromElement(e.target)) _hideLinkPreview();
});

// ── Pill stack manager (bottom-right notification pills) ──
var _pillStack = [];
var _PILL_GAP = 8;
var _PILL_BOTTOM = 20;

function pillStackAdd(id) {
  if (_pillStack.indexOf(id) < 0) _pillStack.push(id);
  requestAnimationFrame(_pillStackReflow);
}
function pillStackRemove(id) {
  var i = _pillStack.indexOf(id);
  if (i >= 0) _pillStack.splice(i, 1);
  _pillStackReflow();
}
function _pillStackReflow() {
  var bottom = _PILL_BOTTOM;
  for (var i = 0; i < _pillStack.length; i++) {
    var el = document.getElementById(_pillStack[i]);
    if (!el || el.style.display === 'none') continue;
    el.style.bottom = bottom + 'px';
    bottom += el.offsetHeight + _PILL_GAP;
  }
}

// ── Dynamic Island — live activity capsule ──
var _islandActivities = {};  // { id: { type, label, detail, progress, done, _ts } }
var _islandDismissTimers = {};  // { id: timeoutId }

// Keep pill container constrained on resize/mode change
window.addEventListener('resize', function() {
  var cont = document.getElementById('pill-island');
  var wrap = document.getElementById('pill-url-wrap');
  var nav = document.getElementById('sidebar-nav');
  if (!cont || !wrap || !nav || !nav.classList.contains('island-mode')) {
    if (cont) cont.style.removeProperty('--island-pills-max-w');
    return;
  }
  var ur = wrap.getBoundingClientRect();
  var cr = cont.getBoundingClientRect();
  var avail = ur.left - cr.left - 12;
  if (avail > 0) cont.style.setProperty('--island-pills-max-w', Math.floor(avail) + 'px');
});

// Register pulse pill + wire updates from Motion.pulse
(function() {
  function _initPulse() {
    islandUpdate('pulse', { type: 'pulse', label: '' });
    if (typeof Motion !== 'undefined' && Motion.pulse) {
      var _pulseThrottle = null;
      Motion.pulse.on(function() {
        if (_pulseThrottle) return;
        _pulseThrottle = setTimeout(function() {
          _pulseThrottle = null;
          islandUpdate('pulse', { type: 'pulse', label: '' });
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
  var el = document.querySelector('.pill-island[data-island-id="'+id+'"]');
  if (!el) {
    var anchor = document.getElementById('pill-island-tabs-anchor');
    if (anchor) el = anchor.querySelector('.pill-island[data-island-id="'+id+'"]');
  }
  if (_islandDismissTimers[id]) { clearTimeout(_islandDismissTimers[id]); delete _islandDismissTimers[id]; }
  delete _islandActivities[id];
  if (el && !el.classList.contains('island-exiting')) {
    var parentCont = el.parentNode;
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
    action: function() { islandRemove('achievement'); }
  });
}

var _islandWaveformBars = '<span class="island-waveform"><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span></span>';
var _islandAudioBars = '<span class="island-waveform island-waveform-anim"><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span></span>';

function _islandRenderPill(a) {
  if (a.type === 'feed-notif') {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg><span style="color:var(--accent)">' + escapeHtml(a.label || '') + '</span>';
  } else if (a.done) {
    return '<span class="island-dot-done"></span><span style="color:#22c55e">' + escapeHtml(a.label || 'Done') + '</span>';
  } else if (a.type === 'download') {
    var pct = a.progress || 0;
    var circ = 2 * Math.PI * 6;
    var offset = circ * (1 - pct / 100);
    var ring = pct > 0 ? '<svg class="island-ring" viewBox="0 0 16 16"><circle class="island-ring-bg" cx="8" cy="8" r="6"/><circle class="island-ring-fg" cx="8" cy="8" r="6" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" transform="rotate(-90 8 8)"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    return ring + '<span>' + escapeHtml(a.label || pct + '%') + '</span><span class="island-dismiss" data-island-dismiss="download" style="margin-left:4px;opacity:0.4;font-size:15px;line-height:1;padding:0 2px;cursor:pointer">&times;</span>';
  } else if (a.type === 'tts') {
    var ttsIconC = a.paused
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
      : _islandWaveformBars;
    return ttsIconC + '<span>' + escapeHtml(a.label || '') + '</span>';
  } else if (a.type === 'audio') {
    return _islandAudioBars + '<span>' + escapeHtml(a.label || '') + '</span>';
  } else if (a.type === 'ai') {
    return '<span class="island-ai-dot"></span><span>' + escapeHtml(a.label || '') + '</span>';
  } else if (a.type === 'achievement') {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#caa12a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-4.27 1.772 6.003 6.003 0 01-4.27-1.772"/></svg>';
  } else if (a.type === 'rss') {
    var rssIcon = a.subscribed
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 019 9"/><path d="M4 4a16 16 0 0116 16"/><circle cx="5" cy="19" r="1"/></svg>';
    return rssIcon + '<span style="color:' + (a.subscribed ? '#22c55e' : 'var(--aether-text)') + '">' + escapeHtml(a.label || '') + '</span>';
  } else if (a.type === 'tabs') {
    var tabItems = a.items || [];
    var _globePath = 'M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418';
    function _globeIcon(cls, attrs) { return '<svg class="' + (cls || '') + '" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' + (attrs || '') + '><path stroke-linecap="round" stroke-linejoin="round" d="' + _globePath + '"/></svg>'; }
    var tabIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/></svg>';
    var ellIcon = _ELL_SVG;
    // Collect non-blank tabs sorted by lastVisited desc
    var nonBlank = [];
    for (var si = 0; si < tabItems.length; si++) {
      if (!tabItems[si].blank) nonBlank.push(tabItems[si]);
    }
    nonBlank.sort(function(x, y) { return (y.lastVisited || 0) - (x.lastVisited || 0); });
    // If no non-blank tabs (all NTP), show stacked-pages icon
    if (nonBlank.length === 0) {
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2h10"/><path d="M5 6h14"/><rect width="18" height="12" x="3" y="10" rx="2"/></svg><span style="opacity:0.4">0 tabs</span>';
    }
    // Pick up to 2 most recently visited non-blank tabs for favicon strip
    var visible = nonBlank.slice(0, 3);
    var overflow = tabItems.length - visible.length;
    var html = '<span class="island-favicon-strip">';
    for (var ti = 0; ti < visible.length; ti++) {
      var t = visible[ti];
      var cls = 'island-strip-fav' + (t.active ? ' island-strip-fav-active' : '');
      var tipAttr = ' title="' + escapeHtml(t.title || 'Tab') + '"';
      if (t.favicon) {
        html += '<img class="' + cls + '" src="' + escapeHtml(t.favicon) + '"' + tipAttr + ' data-island-tab="' + t.id + '" onerror="this.outerHTML=\'<svg class=&quot;' + cls + '&quot; width=&quot;16&quot; height=&quot;16&quot; viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.5&quot;><path stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot; d=&quot;' + _globePath + '&quot;/></svg>\'">';
      } else {
        html += _globeIcon(cls, tipAttr + ' data-island-tab="' + t.id + '"');
      }
    }
    html += '<span class="island-strip-overflow">' + nonBlank.length + ' tab' + (nonBlank.length !== 1 ? 's' : '') + '</span>';
    html += '</span>';
    return html;
  } else if (a.type === 'annotate') {
    var annPenIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#ffc107" stroke-width="2"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (a.offer) {
      return annPenIcon + '<span>' + escapeHtml(a.label || 'Annotate') + '</span>';
    }
    if (a.loading) {
      return '<span class="island-annotate-dot"></span><span>' + escapeHtml(a.label || 'Annotating…') + '</span>';
    }
    var _annModeColors = { ALPHA: '#4caf50', CONTRADICTION: '#ef5350', AD: '#ff9800', CONNECTION: '#2196f3' };
    var annColor = _annModeColors[a.modeType] || '#4caf50';
    var annIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="' + annColor + '" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return annIcon + '<span style="color:var(--aether-text)">' + escapeHtml(a.label || '') + '</span>';
  } else if (a.type === 'calendar') {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span style="color:#3b82f6">' + escapeHtml(a.label || '') + '</span>';
  } else if (a.type === 'bookmark') {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
  } else if (a.type === 'pulse') {
    var pulseIntensity = (typeof Motion !== 'undefined') ? Math.min(Motion.pulse.rate / 5, 1) : 0;
    var pulseClass = pulseIntensity > 0.3 ? 'island-pulse-dot-active' : 'island-pulse-dot-idle';
    return '<span class="island-pulse-dot ' + pulseClass + '" style="--pulse-intensity:' + pulseIntensity.toFixed(2) + '"></span>';
  } else if (a.type === 'context') {
    return '<span style="opacity:0.5">\u25CF</span><span style="opacity:0.7">' + escapeHtml(a.label || '') + '</span>';
  }
  return '<span class="island-dot"></span><span>' + escapeHtml(a.label || '') + '</span>';
}

// Build tray HTML for context/download/annotate/achievement/tabs pills
function _islandBuildTray(a, isBrowse) {
  if (a.type === 'context' && a.items && a.items.length) {
    var trayHtml = '';
    if (isBrowse) {
      trayHtml += '<div class="island-tab-newtab" data-island-tab-new="1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg><span>New tab</span></div>';
      trayHtml += '<div style="height:1px;background:var(--aether-border);margin:4px 0"></div>';
    }
    for (var ti = 0; ti < a.items.length; ti++) {
      var item = a.items[ti];
      var t = item.title || 'New Tab';
      if (t.length > 36) t = t.slice(0, 34) + '\u2026';
      var fav = item.favicon ? '<img src="' + escapeHtml(item.favicon) + '" width="14" height="14" style="border-radius:2px;flex-shrink:0" onerror="this.style.display=\'none\'">' : '';
      var closeBtn = isBrowse ? '<button class="island-tab-item-close" data-island-tab-close="' + item.id + '" title="Close">&times;</button>' : '';
      trayHtml += '<div class="island-ctx-item' + (item.active ? ' active' : '') + '" data-island-tab="' + item.id + '">' + fav + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(t) + '</span>' + closeBtn + '</div>';
    }
    return trayHtml;
  } else if (a.type === 'download' && a.items && a.items.length) {
    var trayHtml = '<div class="island-dl-header"><span>Downloads</span><span class="island-dl-clear" data-island-dl-clear="1">Clear all</span></div>';
    for (var ti = 0; ti < a.items.length; ti++) {
      var item = a.items[ti];
      var fname = item.filename || 'Download';
      if (fname.length > 40) fname = fname.slice(0, 38) + '\u2026';
      var dlIcon = item.state === 'completed'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="#22c55e" stroke="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>';
      var dlStatus = item.state === 'completed' ? 'Done' + (item.size ? ' · ' + item.size : '')
        : item.state === 'cancelled' ? 'Cancelled'
        : item.pct + '% · ' + item.received + (item.size ? ' / ' + item.size : '');
      var progressHtml = item.state === 'progressing'
        ? '<div class="island-dl-progress"><div class="island-dl-progress-bar" style="width:' + item.pct + '%"></div></div>'
        : '';
      trayHtml += '<div class="island-dl-item" data-island-dl="' + escapeHtml(item.id) + '">'
        + '<div class="island-dl-icon">' + dlIcon + '</div>'
        + '<div class="island-dl-info"><div class="island-dl-name">' + escapeHtml(fname) + '</div><div class="island-dl-status">' + escapeHtml(dlStatus) + '</div>' + progressHtml + '</div>'
        + '<button class="island-dl-remove" data-island-dl-remove="' + escapeHtml(item.id) + '" title="Remove">&times;</button>'
        + '</div>';
    }
    return trayHtml;
  } else if (a.type === 'annotate' && a.items && a.items.length) {
    var annColors = { ALPHA: '#4caf50', CONTRADICTION: '#ef5350', AD: '#ff9800', CONNECTION: '#2196f3' };
    var annLabels = { ALPHA: 'Alpha', CONTRADICTION: 'Contradiction', AD: 'Ad', CONNECTION: 'Connection' };
    var trayHtml = '';
    for (var ai = 0; ai < a.items.length; ai++) {
      var ann = a.items[ai];
      var ac = annColors[ann.type] || '#888';
      var al = annLabels[ann.type] || ann.type;
      var quote = ann.quote || '';
      var isConnection = ann.type === 'CONNECTION';
      var displayText = isConnection ? ('Linked: ' + (ann.linkedTitle || 'Related content')) : quote;
      var confBadge = ann.confidence != null ? '<span style="font-size:10px;color:var(--text-dimmer);margin-left:auto;flex-shrink:0">' + ann.confidence + '%</span>' : '';
      trayHtml += '<div class="island-ann-item" data-island-ann="' + ai + '"' + (isConnection && ann.linkedUrl ? ' data-island-ann-url="' + escapeHtml(ann.linkedUrl) + '"' : '') + ' style="padding:6px 10px;cursor:pointer;display:flex;flex-direction:column;gap:2px;">';
      trayHtml += '<div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:' + ac + ';flex-shrink:0"></span><span style="font-size:11px;font-weight:600;color:' + ac + '">' + escapeHtml(al) + '</span>' + confBadge + '</div>';
      trayHtml += '<div style="font-size:12px;color:var(--text-primary);padding-left:14px;opacity:0.85">' + escapeHtml(displayText) + '</div>';
      if (ann.explanation) trayHtml += '<div style="font-size:11px;color:var(--text-dimmer);padding-left:14px">' + escapeHtml(ann.explanation) + '</div>';
      trayHtml += '</div>';
    }
    return trayHtml;
  } else if (a.type === 'achievement') {
    return '<div class="island-ach-tray-content">'
      + '<div class="island-ach-tray-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#caa12a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-4.27 1.772 6.003 6.003 0 01-4.27-1.772"/></svg></div>'
      + '<div class="island-ach-tray-info">'
      + '<div class="island-ach-tray-subtitle">Achievement Unlocked</div>'
      + '<div class="island-ach-tray-name">' + escapeHtml(a.label || 'Unlocked!') + '</div>'
      + '<div class="island-ach-tray-desc">' + escapeHtml(a.detail || '') + '</div>'
      + '</div></div>';
  } else if (a.type === 'tabs' && a.items && a.items.length) {
    var trayHtml = '<div class="island-tab-newtab" data-island-tab-new="1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg><span>New tab</span></div><div style="height:1px;background:var(--aether-border);margin:4px 0"></div>';
    var pinnedItems = a.items.filter(function(it) { return it.pinned; });
    var unpinnedItems = a.items.filter(function(it) { return !it.pinned; }).slice().sort(function(x, y) { return (y.lastVisited || 0) - (x.lastVisited || 0); });
    if (pinnedItems.length) {
      for (var pi = 0; pi < pinnedItems.length; pi++) {
        var pItem = pinnedItems[pi];
        var pTitle = pItem.title || 'New Tab';
        if (pTitle.length > 32) pTitle = pTitle.slice(0, 30) + '\u2026';
        var pFav = pItem.favicon ? '<img src="' + escapeHtml(pItem.favicon) + '" width="14" height="14" style="border-radius:2px;flex-shrink:0" onerror="this.style.display=\'none\'">' : '';
        var pAudio = pItem.hasAudio ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;opacity:0.6"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>' : '';
        trayHtml += '<div class="island-tab-item' + (pItem.active ? ' active' : '') + '" data-island-tab="' + pItem.id + '">' + pFav + pAudio + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(pTitle) + '</span></div>';
      }
      if (unpinnedItems.length) trayHtml += '<div style="height:1px;background:var(--aether-border);margin:4px 0"></div>';
    }
    for (var ti = 0; ti < unpinnedItems.length; ti++) {
      var item = unpinnedItems[ti];
      var t = item.title || 'New Tab';
      if (t.length > 32) t = t.slice(0, 30) + '\u2026';
      var fav = item.favicon ? '<img src="' + escapeHtml(item.favicon) + '" width="14" height="14" style="border-radius:2px;flex-shrink:0" onerror="this.style.display=\'none\'">' : '';
      var audioIcon = item.hasAudio ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;opacity:0.6"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>' : '';
      trayHtml += '<div class="island-tab-item' + (item.active ? ' active' : '') + '" data-island-tab="' + item.id + '">' + fav + audioIcon + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(t) + '</span><button class="island-tab-item-close" data-island-tab-close="' + item.id + '" title="Close">&times;</button></div>';
    }
    return trayHtml;
  }
  if (a.type === 'pulse') {
    var recent = (typeof Motion !== 'undefined') ? Motion.pulse.recent : [];
    var trayHtml = '<div style="padding:6px 8px;font-size:0.6rem;color:#fff;opacity:0.6;text-transform:uppercase;letter-spacing:0.5px">Live Pulse</div>';
    var start = Math.max(0, recent.length - 30);
    for (var ri = recent.length - 1; ri >= start; ri--) {
      var ev = recent[ri];
      var catColors = { ai: '#a78bfa', embed: '#38bdf8', feed: '#f97316', quality: '#22c55e', network: '#94a3b8', system: '#e879f9' };
      var col = catColors[ev.category] || '#94a3b8';
      var age = Math.round((Date.now() - ev.timestamp) / 1000);
      var ageStr = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago';
      var statusDot = ev.ok === true ? '#22c55e' : ev.ok === false ? '#ef4444' : '#94a3b8';
      trayHtml += '<div class="island-ctx-item" style="font-size:0.65rem;gap:6px;padding:3px 8px"><span style="width:4px;height:4px;border-radius:50%;background:' + statusDot + ';flex-shrink:0"></span><span style="color:' + col + ';min-width:36px">' + escapeHtml(ev.category) + '</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.7">' + escapeHtml(ev.label) + '</span><span style="opacity:0.35;flex-shrink:0">' + ageStr + '</span></div>';
    }
    if (!recent.length) trayHtml += '<div style="padding:8px;opacity:0.3;font-size:0.65rem;text-align:center">No events yet</div>';
    return trayHtml;
  }
  return '';
}

// Attach click handlers and hover/tray behavior to pill
function _islandAttachHandlers(pill, a, hasTray) {
  pill.onclick = function(e) {
    var dismissEl = e.target.closest('[data-island-dismiss]');
    if (dismissEl) {
      e.stopPropagation();
      var dismissId = dismissEl.getAttribute('data-island-dismiss');
      var act = _islandActivities[dismissId];
      if (act && act.dismiss) act.dismiss();
      else islandRemove(dismissId);
      return;
    }
    var tabCloseBtn = e.target.closest('[data-island-tab-close]');
    if (tabCloseBtn) {
      e.stopPropagation();
      var closeTabId = +tabCloseBtn.getAttribute('data-island-tab-close');
      if (typeof browseCloseTab === 'function') browseCloseTab(closeTabId);
      return;
    }
    var tabNewBtn = e.target.closest('[data-island-tab-new]');
    if (tabNewBtn) {
      e.stopPropagation();
      if (typeof browseNewTab === 'function') browseNewTab();
      pill.classList.remove('island-tray-open');
      return;
    }
    var tabItem = e.target.closest('[data-island-tab]');
    if (tabItem) {
      e.stopPropagation();
      var tabId = +tabItem.getAttribute('data-island-tab');
      if (typeof browseSelectTab === 'function') browseSelectTab(tabId);
      pill.classList.remove('island-tray-open');
      return;
    }
    var annItem = e.target.closest('[data-island-ann]');
    if (annItem) {
      e.stopPropagation();
      var annUrl = annItem.getAttribute('data-island-ann-url');
      if (annUrl && typeof browseNewTab === 'function') {
        browseNewTab(annUrl);
      } else {
        var annIdx = +annItem.getAttribute('data-island-ann');
        if (typeof scrollToAnnotation === 'function') scrollToAnnotation(annIdx);
      }
      return;
    }
    var dlClear = e.target.closest('[data-island-dl-clear]');
    if (dlClear) {
      e.stopPropagation();
      if (typeof clearBrowseDownloads === 'function') clearBrowseDownloads();
      islandRemove('download');
      return;
    }
    var dlRemove = e.target.closest('[data-island-dl-remove]');
    if (dlRemove) {
      e.stopPropagation();
      var dlId = dlRemove.getAttribute('data-island-dl-remove');
      if (typeof removeBrowseDownload === 'function') removeBrowseDownload(dlId);
      return;
    }
    var dlItem = e.target.closest('[data-island-dl]');
    if (dlItem) {
      e.stopPropagation();
      var dlId = dlItem.getAttribute('data-island-dl');
      if (typeof openDownloadFile === 'function') openDownloadFile(dlId);
      return;
    }
    if (a.action) a.action();
  };
  pill.style.cursor = (a.action || a.type === 'annotate' || a.type === 'tabs') ? 'pointer' : 'default';

  // Hover/click management for tray
  if (hasTray) {
    if (a.type === 'tabs') {
      // Tabs/annotate uses click-to-toggle instead of hover
      if (!pill._islandClickBound) {
        pill._islandClickBound = true;
        pill.style.cursor = 'pointer';
        pill.addEventListener('click', function(e) {
          if (e.target.closest('[data-island-tab], [data-island-tab-close], [data-island-tab-new], [data-island-dismiss]')) return;
          pill.classList.toggle('island-tray-open');
        });
        // Close on outside click or focus loss (webview clicks don't bubble)
        document.addEventListener('click', function(e) {
          if (!pill.contains(e.target)) pill.classList.remove('island-tray-open');
        });
        window.addEventListener('blur', function() {
          pill.classList.remove('island-tray-open');
        });
        document.addEventListener('mousedown', function(e) {
          if (!pill.contains(e.target)) pill.classList.remove('island-tray-open');
        });
      }
    } else if (!pill._islandHoverBound) {
      pill._islandHoverBound = true;
      pill.addEventListener('mouseenter', function() {
        if (pill._islandLeaveTimer) { clearTimeout(pill._islandLeaveTimer); pill._islandLeaveTimer = null; }
        if (pill._islandAutoClose) { clearTimeout(pill._islandAutoClose); pill._islandAutoClose = null; }
        pill.classList.add('island-tray-open');
      });
      pill.addEventListener('mouseleave', function() {
        pill._islandLeaveTimer = setTimeout(function() { pill.classList.remove('island-tray-open'); }, 120);
      });
    }
  }
}

// FLIP-animate neighboring pills when one enters/exits/compacts
function _islandFlipNeighbors(cont) {
  if (!cont) return;
  var pills = cont.querySelectorAll('.pill-island:not(.island-exiting)');
  pills.forEach(function(p) {
    if (p.classList.contains('island-entering')) return;
    if (!p._flipRect) return;
    var newRect = p.getBoundingClientRect();
    var dx = p._flipRect.left - newRect.left;
    if (Math.abs(dx) > 1) {
      Motion.animate(p, { spring: 'snappy', from: { x: dx }, to: { x: 0 } });
    }
  });
}

// Snapshot pill positions for FLIP
function _islandSnapshotRects(cont) {
  if (!cont) return;
  cont.querySelectorAll('.pill-island').forEach(function(p) {
    p._flipRect = p.getBoundingClientRect();
  });
}

function _islandRender() {
  var container = document.getElementById('pill-island');
  if (!container) return;
  var rightContainer = document.getElementById('pill-island-right');

  var ids = Object.keys(_islandActivities);
  if (!ids.length) {
    container.innerHTML = '';
    if (rightContainer) rightContainer.innerHTML = '';
    return;
  }

  // Pinned pills always first (far left): pulse → tabs → nowplaying
  var pinnedLeft = [];
  ['pulse', 'tabs', 'nowplaying'].forEach(function(pid) {
    var idx = ids.indexOf(pid);
    if (idx !== -1) { ids.splice(idx, 1); pinnedLeft.push(pid); }
  });
  var priority = { achievement: 5, download: 4, calendar: 3.5, cc: 3, tts: 3, ai: 3, rss: 2.6, bookmark: 2.55, annotate: 2.5, 'feed-notif': 2, audio: 2, qf: 2, feed: 1, context: 0 };
  ids.sort(function(a, b) {
    var pa = priority[_islandActivities[a].type] || 0;
    var pb = priority[_islandActivities[b].type] || 0;
    return pb - pa || _islandActivities[b]._ts - _islandActivities[a]._ts;
  });
  ids = pinnedLeft.concat(ids);

  // Build pills — reuse existing DOM elements where possible
  var existingEls = {};
  container.querySelectorAll('.pill-island[data-island-id]').forEach(function(el) {
    existingEls[el.getAttribute('data-island-id')] = el;
  });
  // Also check the tabs anchor (tabs pill may live there in island mode)
  var _tabsAnchorEl = document.getElementById('pill-island-tabs-anchor');
  if (_tabsAnchorEl) {
    _tabsAnchorEl.querySelectorAll('.pill-island[data-island-id]').forEach(function(el) {
      existingEls[el.getAttribute('data-island-id')] = el;
    });
  }
  // Also check right overflow container
  if (rightContainer) {
    rightContainer.querySelectorAll('.pill-island[data-island-id]').forEach(function(el) {
      existingEls[el.getAttribute('data-island-id')] = el;
    });
  }

  var prevPill = null; // track insertion order
  ids.forEach(function(id) {
    var a = _islandActivities[id];
    var pill = existingEls[id];
    var isNew = !pill;
    if (isNew) {
      pill = document.createElement('div');
      pill.className = 'pill-island';
      pill.setAttribute('data-island-id', id);
      // Goo background layer — filtered shapes that merge pill + tray into organic blob
      var gooBg = document.createElement('div');
      gooBg.className = 'pill-goo-bg';
      var gooPill = document.createElement('div');
      gooPill.className = 'goo-shape goo-pill-shape';
      var gooTray = document.createElement('div');
      gooTray.className = 'goo-shape goo-tray-shape';
      gooBg.appendChild(gooPill);
      gooBg.appendChild(gooTray);
      pill.appendChild(gooBg);
      var compactDiv = document.createElement('div');
      compactDiv.className = 'pill-island-content';
      pill.appendChild(compactDiv);
      // Items tray for context pills (morphs inside the pill)
      var itemsTray = document.createElement('div');
      itemsTray.className = 'island-ctx-tray';
      pill.appendChild(itemsTray);
    }
    delete existingEls[id];
    var compact = pill.querySelector('.pill-island-content');
    var tray = pill.querySelector('.island-ctx-tray');
    // Smart content diffing: skip innerHTML if content unchanged
    var newCompactHtml = _islandRenderPill(a);
    if (compact._lastHtml !== newCompactHtml) { compact.innerHTML = newCompactHtml; compact._lastHtml = newCompactHtml; }
    // Download completion burst
    if (a.type === 'download' && a.progress >= 100 && !pill._dlCompleteFired) {
      pill._dlCompleteFired = true;
      pill.classList.add('download-complete');
      pill.addEventListener('animationend', function() { pill.classList.remove('download-complete'); }, { once: true });
    } else if (a.type === 'download' && a.progress < 100) {
      pill._dlCompleteFired = false;
    }
    // Fill items tray for context / download pills
    if (tray) {
      var isBrowse = (typeof _browseTabLayout !== 'undefined') && ((_currentRouteHash || window.location.hash || '').match(/^#(browse|research|search)$/));
      tray.innerHTML = _islandBuildTray(a, isBrowse);
    }
    var hasItems = !!(a.items && a.items.length);
    var hasTray = (hasItems && (a.type === 'context' || a.type === 'download' || a.type === 'tabs' || a.type === 'annotate')) || a.type === 'achievement' || a.type === 'pulse';
    pill.classList.toggle('island-context', a.type === 'context');
    pill.classList.toggle('island-download-pill', a.type === 'download');
    pill.classList.toggle('island-tabs-pill', a.type === 'tabs');
    pill.classList.toggle('island-has-items', hasTray);

    // Attach event handlers
    _islandAttachHandlers(pill, a, hasTray);

    // Sync goo tray dimensions with actual tray content
    if (hasTray && tray && tray.innerHTML) {
      var syncGoo = function() {
        // Measure actual tray content height from children
        var h = 0;
        for (var ci = 0; ci < tray.children.length; ci++) {
          h += tray.children[ci].offsetHeight;
        }
        if (tray.children.length > 1) h += (tray.children.length - 1) * 1; // 1px gap
        h += 12; // tray padding (6px top + 6px bottom)
        var w = 0;
        for (var wi = 0; wi < tray.children.length; wi++) {
          var cw = tray.children[wi].offsetWidth;
          if (cw > w) w = cw;
        }
        w += 12; // tray padding
        if (h > 0) pill.style.setProperty('--goo-tray-h', h + 'px');
        if (w > 0) pill.style.setProperty('--goo-tray-w', w + 'px');
      };
      if (!pill._gooSyncBound) {
        pill._gooSyncBound = true;
        var obs = new MutationObserver(function() {
          if (pill.classList.contains('island-tray-open')) {
            setTimeout(function() { requestAnimationFrame(syncGoo); }, 50);
          }
        });
        obs.observe(pill, { attributes: true, attributeFilter: ['class'] });
      }
      requestAnimationFrame(syncGoo);
    }

    // Animate in
    var tabsAnchor = document.getElementById('pill-island-tabs-anchor');
    var isIslandMode = document.getElementById('sidebar-nav') && document.getElementById('sidebar-nav').classList.contains('island-mode');
    var targetContainer = (id === 'tabs' && isIslandMode && tabsAnchor) ? tabsAnchor : container;
    if (isNew) {
      // Pre-apply compact before entering so animation targets compact size
      if ((a.type === 'rss' && a.subscribed) || (a.type === 'annotate' && !a.loading && !a.done && a._compact)) {
        pill.classList.add('island-compact');
      }
      // Snapshot neighbors before insert so FLIP can animate them
      _islandSnapshotRects(targetContainer);
      targetContainer.appendChild(pill);
      pill.classList.add('island-entering');
      var _enterAnims = { 'pill-enter': 1, 'pill-enter-browse': 1, 'pill-enter-compact': 1, 'pill-enter-anchor': 1 };
      pill.addEventListener('animationend', function onEnter(ev) {
        if (!_enterAnims[ev.animationName]) return;
        pill.removeEventListener('animationend', onEnter);
        pill.classList.remove('island-entering');
        pill.classList.add('island-active');
        // After entering, FLIP neighboring pills that shifted
        _islandFlipNeighbors(targetContainer);
      });
      // Achievement: auto-expand tray then collapse after delay
      if (a.type === 'achievement') {
        pill.classList.add('island-tray-open');
        pill._islandAutoClose = setTimeout(function() {
          pill.classList.remove('island-tray-open');
          pill._islandAutoClose = null;
        }, 7000);
      }
    } else {
      // Move tabs pill to correct container if needed (e.g. mode switch) — FLIP animate
      if (pill.parentNode !== targetContainer) {
        var oldRect = pill.getBoundingClientRect();
        targetContainer.appendChild(pill);
        var newRect = pill.getBoundingClientRect();
        var dx = oldRect.left - newRect.left;
        var dy = oldRect.top - newRect.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          Motion.animate(pill, { spring: 'snappy', from: { x: dx, y: dy }, to: { x: 0, y: 0 } });
        }
      }
      pill.classList.add('island-active');
    }

    // Auto-dismiss on done — stagger so pills collapse one by one
    if (a.done && !_islandDismissTimers[id]) {
      var baseDelay = a.type === 'achievement' ? 5000 : a.type === 'feed-notif' ? 10000 : 2500;
      var pendingCount = Object.keys(_islandDismissTimers).length;
      var stagger = pendingCount * 500;
      _islandDismissTimers[id] = setTimeout(function() {
        islandRemove(id);
      }, baseDelay + stagger);
    }

    // RSS: icon-only when subscribed immediately, otherwise collapse after 15s
    if (a.type === 'rss' && a.subscribed) {
      if (pill._rssCompactTimer) { clearTimeout(pill._rssCompactTimer); pill._rssCompactTimer = null; }
      if (!pill.classList.contains('island-compact')) {
        _islandSnapshotRects(targetContainer);
        pill.classList.add('island-compact');
        _islandFlipNeighbors(targetContainer);
      }
    } else if (a.type === 'rss') {
      if (!pill._rssCompactTimer && !pill.classList.contains('island-compact')) {
        pill._rssCompactTimer = setTimeout(function() {
          _islandSnapshotRects(targetContainer);
          pill.classList.add('island-compact');
          _islandFlipNeighbors(targetContainer);
        }, 15000);
      }
    }

    // Annotate: compact to icon-only after 15s (results and offers)
    if (a.type === 'annotate' && !a.loading && !a.done) {
      if (!pill._annCompactTimer) {
        pill._annCompactTimer = setTimeout(function() {
          _islandSnapshotRects(targetContainer);
          pill.classList.add('island-compact');
          _islandFlipNeighbors(targetContainer);
        }, 15000);
      }
    } else if (a.type === 'annotate' && (a.loading || a.done)) {
      if (pill._annCompactTimer) { clearTimeout(pill._annCompactTimer); pill._annCompactTimer = null; }
      if (pill.classList.contains('island-compact')) {
        _islandSnapshotRects(targetContainer);
        pill.classList.remove('island-compact');
        _islandFlipNeighbors(targetContainer);
      }
    }
  });

  // Remove stale pills (with exit animation + FLIP neighbors)
  var hasStale = false;
  Object.keys(existingEls).forEach(function(id) {
    var staleEl = existingEls[id];
    if (!staleEl.classList.contains('island-exiting')) {
      var staleCont = staleEl.parentNode;
      if (!hasStale) { _islandSnapshotRects(container); if (rightContainer) _islandSnapshotRects(rightContainer); hasStale = true; }
      staleEl.classList.add('island-exiting');
      staleEl.addEventListener('animationend', function onExit(ev) {
        if (ev.animationName !== 'pill-exit') return;
        staleEl.removeEventListener('animationend', onExit);
        _islandSnapshotRects(staleCont);
        staleEl.remove();
        _islandFlipNeighbors(staleCont);
      });
    }
  });

  // Phase 7: FLIP reordering — capture positions before reorder
  var rects = {};
  container.querySelectorAll('.pill-island').forEach(function(p) {
    var pid = p.getAttribute('data-island-id');
    if (pid) rects[pid] = p.getBoundingClientRect();
  });

  // Force DOM order to match sorted ids — always tabs first (skip tabs pill if in anchor)
  var sortedPills = ids.filter(function(id) {
    // Don't reorder tabs pill if it's in the anchor container
    if (id === 'tabs' && _tabsAnchorEl && _tabsAnchorEl.querySelector('.pill-island[data-island-id="tabs"]')) return false;
    return true;
  }).map(function(id) {
    return container.querySelector('.pill-island[data-island-id="' + id + '"]');
  }).filter(Boolean);
  for (var si = 0; si < sortedPills.length; si++) {
    container.appendChild(sortedPills[si]);
  }

  // FLIP: animate from old to new position
  sortedPills.forEach(function(p) {
    var pid = p.getAttribute('data-island-id');
    if (!rects[pid]) return;
    var dx = rects[pid].left - p.getBoundingClientRect().left;
    if (Math.abs(dx) > 1) {
      Motion.animate(p, { spring: 'snappy', from: { x: dx }, to: { x: 0 } });
    }
  });

  // Proximity detection: move overflow pills to right side of URL capsule
  var urlWrap = document.getElementById('pill-url-wrap');
  var isIslandNow = document.getElementById('sidebar-nav') && document.getElementById('sidebar-nav').classList.contains('island-mode');
  if (urlWrap && isIslandNow && rightContainer) {
    var urlRect = urlWrap.getBoundingClientRect();
    var contRect = container.getBoundingClientRect();
    // 12px gap between pills and URL capsule
    var availW = urlRect.left - contRect.left - 12;
    if (availW > 0) {
      container.style.setProperty('--island-pills-max-w', Math.floor(availW) + 'px');
    }
    // Constrain right container too — don't overlap right-side buttons (mic, more, new-window)
    var navBar = document.getElementById('sidebar-nav');
    var navRect = navBar ? navBar.getBoundingClientRect() : { right: window.innerWidth };
    // Measure width of right-side buttons so pills sit to their left
    var rightBtnsW = 0;
    ['pill-readaloud-wrap', 'pill-browse-more', 'pill-newwin-btn'].forEach(function(bid) {
      var b = document.getElementById(bid);
      if (b && b.offsetWidth > 0) rightBtnsW += b.offsetWidth + 2; // + gap
    });
    rightBtnsW += 8; // right padding
    rightContainer.style.setProperty('--island-right-offset', rightBtnsW + 'px');
    var rightAvail = navRect.right - urlRect.right - 20; // 12px gap + 8px right padding
    if (rightAvail > 0) {
      rightContainer.style.setProperty('--island-pills-right-max-w', Math.floor(rightAvail - rightBtnsW) + 'px');
    }
    // Check each pill — if it clips or goes past the URL capsule, move to right container
    var leftPills = Array.from(container.querySelectorAll('.pill-island:not(.island-exiting)'));
    leftPills.forEach(function(p) {
      var pr = p.getBoundingClientRect();
      var dist = urlRect.left - pr.right;
      // Pill clips the URL capsule (right edge past URL left edge minus gap)
      if (dist < 4) {
        var oldRect = p.getBoundingClientRect();
        rightContainer.appendChild(p);
        var newRect = p.getBoundingClientRect();
        var dx = oldRect.left - newRect.left;
        var dy = oldRect.top - newRect.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          Motion.animate(p, { spring: 'snappy', from: { x: dx, y: dy }, to: { x: 0, y: 0 } });
        }
      }
      p.classList.toggle('near-url-bar', dist >= 0 && dist < 60);
    });
    // Find the left edge of the first visible right-side button
    var rightBoundary = navRect.right - 4;
    ['pill-readaloud-wrap', 'pill-browse-more', 'pill-newwin-btn'].forEach(function(bid) {
      var b = document.getElementById(bid);
      if (b && b.offsetWidth > 0) {
        var br = b.getBoundingClientRect();
        if (br.left < rightBoundary) rightBoundary = br.left;
      }
    });
    rightBoundary -= 6; // gap before buttons

    // Compact/expand right-side pills based on clipping
    var rightPills = Array.from(rightContainer.querySelectorAll('.pill-island:not(.island-exiting)'));
    rightPills.forEach(function(p) {
      var pr = p.getBoundingClientRect();
      if (pr.right > rightBoundary && !p.classList.contains('island-compact')) {
        p.classList.add('island-compact');
      } else if (pr.right <= rightBoundary - 40 && p.classList.contains('island-compact') && !p._userCompacted) {
        // Expand back if there's enough room (40px headroom)
        p.classList.remove('island-compact');
      }
    });

    // Move pills back to left container if there's now room
    if (rightPills.length > 0) {
      // Recalculate how much space is left
      var lastLeft = container.querySelector('.pill-island:last-child');
      var leftEdge = lastLeft ? lastLeft.getBoundingClientRect().right + 4 : contRect.left;
      var spaceLeft = urlRect.left - leftEdge - 12;
      rightPills.forEach(function(p) {
        var pw = p.getBoundingClientRect().width;
        if (pw > 0 && spaceLeft >= pw) {
          var oldRect = p.getBoundingClientRect();
          p.classList.remove('island-compact');
          container.appendChild(p);
          var newRect = p.getBoundingClientRect();
          var dx = oldRect.left - newRect.left;
          if (Math.abs(dx) > 1) {
            Motion.animate(p, { spring: 'snappy', from: { x: dx }, to: { x: 0 } });
          }
          spaceLeft -= (pw + 4);
        }
      });
    }
  } else {
    container.style.removeProperty('--island-pills-max-w');
    // Not in island mode — move any right-side pills back to main container
    if (rightContainer) {
      var strandedPills = Array.from(rightContainer.querySelectorAll('.pill-island'));
      strandedPills.forEach(function(p) { container.appendChild(p); });
    }
  }
}

// Re-check right-side pill clipping on resize
var _islandResizeTimer = null;
window.addEventListener('resize', function() {
  clearTimeout(_islandResizeTimer);
  _islandResizeTimer = setTimeout(function() {
    if (Object.keys(_islandActivities).length) _islandRender();
  }, 100);
});

// ── Now Playing context pill (removed — not useful) ──
function _updateNowPlayingContext() {
  islandRemove('nowplaying');
}

// ── Content safe bounds for popups ──
// Returns {top, left, right, bottom} — the usable area where popups may appear,
// avoiding the tab row, URL bar, and macOS traffic lights.
let _boundsCache = null;
function _invalidateBoundsCache() { _boundsCache = null; }
window.addEventListener('resize', _invalidateBoundsCache);
function _popupSafeBounds() {
  if (_boundsCache) return _boundsCache;
  const tabRow = document.getElementById('browse-tab-row');
  const bar = document.getElementById('browse-bar');
  const pillBar = document.getElementById('sidebar-nav');
  let left = 0, top = 0;
  if (pillBar && pillBar.offsetParent !== null) {
    top = Math.max(top, pillBar.getBoundingClientRect().bottom + 4);
  }
  if (tabRow && tabRow.offsetParent !== null) {
    top = Math.max(top, tabRow.getBoundingClientRect().bottom);
  }
  if (bar && bar.offsetParent !== null) {
    top = Math.max(top, bar.getBoundingClientRect().bottom);
  }
  if (window.electronAPI && window.electronAPI.isElectron) {
    top = Math.max(top, 42);
    if (left < 80 && top <= 42) left = Math.max(left, 80);
  }
  _boundsCache = { top, left, right: window.innerWidth, bottom: window.innerHeight };
  return _boundsCache;
}

// ── Cmd/Ctrl+click → open in new browse tab ──
function _isNewTabClick(e) { return e && (e.metaKey || e.ctrlKey); }
function _openInNewTab(url) {
  const isElectron = window.electronAPI && window.electronAPI.isElectron;
  if (isElectron && typeof openBrowse === 'function') {
    // Open as a new tab in the app's browse tab system
    if (typeof browseNewTab === 'function' && typeof _browseWindows !== 'undefined' && _browseWindows.length) {
      openBrowse(); // navigate to browse view without opening a URL
      browseNewTab(url); // always create a new tab
    } else {
      openBrowse(url);
    }
  } else {
    // Web: open in a real browser tab
    window.open(url, '_blank');
  }
}

// ── Electron detection ──
if (window.electronAPI && window.electronAPI.isElectron) {
  document.body.classList.add('electron-app');
  // Listen for open-in-browse IPC from main process (Cmd+click in webviews, window.open calls)
  if (window.electronAPI.onOpenInBrowse) {
    window.electronAPI.onOpenInBrowse((_event, url) => { _openInNewTab(url); });
  }
}

// ── Download app banner (web only) ──
function showDownloadBanner() {
  const isElectron = window.electronAPI && window.electronAPI.isElectron;
  const dismissed = localStorage.getItem('downloadBannerDismissed') === 'true';
  if (!isElectron && !dismissed) {
    const banner = document.getElementById('download-app-banner');
    if (banner) banner.classList.remove('hidden');
  }
}

function dismissDownloadBanner() {
  localStorage.setItem('downloadBannerDismissed', 'true');
  const banner = document.getElementById('download-app-banner');
  if (banner) {
    Motion.fadeOut(banner, { y: -20, duration: 300, onFinish: function() { banner.classList.add('hidden'); } });
  }
}

// Update Browse button tooltip when not in Electron
function updateBrowseButtonTooltip() {
  const isElectron = window.electronAPI && window.electronAPI.isElectron;
  if (!isElectron) {
    const browseBtn = document.getElementById('sb-browse');
    const tooltip = browseBtn?.querySelector('.sidebar-tooltip');
    if (tooltip) {
      tooltip.textContent = 'Browse (Desktop only)';
    }
  }
}

// Show banner after DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    showDownloadBanner();
    updateBrowseButtonTooltip();
  });
} else {
  showDownloadBanner();
  updateBrowseButtonTooltip();
}

// ── Spinner system ──
let _spinnerData = null;
let _spinnerNames = [];
let _spinnerInterval = null;

function getSelectedSpinner() {
  return localStorage.getItem('spinner') || 'squareCorners';
}

function setSelectedSpinner(name) {
  localStorage.setItem('spinner', name);
  restartSpinners();
}

function loadSpinners() {
  return fetch('/spinners.json').then(r => r.json()).then(data => {
    _spinnerData = data;
    _spinnerNames = Object.keys(data);
    restartSpinners();
    return data;
  });
}

function restartSpinners() {
  if (_spinnerInterval) { clearInterval(_spinnerInterval); _spinnerInterval = null; }
  if (!_spinnerData) return;
  const name = getSelectedSpinner();
  const spinner = _spinnerData[name];
  if (!spinner) return;
  const frames = spinner.frames;
  const interval = spinner.interval;
  let i = 0;
  function tick() {
    const els = document.querySelectorAll('.spinner');
    if (!els.length) {
      // No spinners in DOM — stop interval so MutationObserver can restart when new ones appear
      clearInterval(_spinnerInterval);
      _spinnerInterval = null;
      return;
    }
    els.forEach(el => { el.textContent = frames[i]; });
    i = (i + 1) % frames.length;
  }
  tick();
  if (document.querySelectorAll('.spinner').length) {
    _spinnerInterval = setInterval(tick, interval);
  }
}

// Observe DOM for new .spinner elements
const _spinnerMO = new MutationObserver(() => {
  const els = document.querySelectorAll('.spinner');
  if (els.length && !_spinnerInterval && _spinnerData) restartSpinners();
});
_spinnerMO.observe(document.documentElement, { childList: true, subtree: true });

loadSpinners();

function debounce(fn, ms) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Track the last non-paper view for back navigation
let _lastActiveView = localStorage.getItem('_lastActiveView') || 'feed';
const _sidebarToView = { 'sb-home': 'feed', 'sb-dashboard': 'dashboard', 'sb-vault': 'vault', 'sb-browse': 'browse', 'sb-settings': 'settings', 'sb-neuralook': 'neuralook' };

// Research view tab state
let _researchActiveTab = null;

function setSidebarActive(id) {
  if (id && _sidebarToView[id]) { _lastActiveView = _sidebarToView[id]; localStorage.setItem('_lastActiveView', _lastActiveView); }
  document.querySelectorAll('.sidebar-icon').forEach(b => {
    b.classList.remove('active');
    // Don't remove sb-loading here - let animation finish on its own
  });
  const desktopEl = document.getElementById(id);
  if (desktopEl) desktopEl.classList.add('active');
}

function setSidebarLoading(id) {
  Motion.retrigger(document.getElementById(id), 'sb-loading', 350);
}

// ── Sidebar Keyboard Navigation ──
let _sidebarFocused = false;
let _sidebarSelectedIndex = -1;

function _getSidebarItems() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return [];
  // Get all visible sidebar icons in DOM order
  return Array.from(nav.querySelectorAll('.sidebar-icon')).filter(el => {
    // Filter out hidden elements
    return el.offsetParent !== null;
  });
}

function _focusSidebar() {
  _sidebarFocused = true;
  const nav = document.getElementById('sidebar-nav');
  if (nav) nav.classList.add('sidebar-focused');

  // If no selection, select the currently active item
  if (_sidebarSelectedIndex < 0) {
    const items = _getSidebarItems();
    const activeIdx = items.findIndex(el => el.classList.contains('active'));
    _sidebarSelectedIndex = activeIdx >= 0 ? activeIdx : 0;
  }
  _renderSidebarSelection();
}

function _blurSidebar() {
  _sidebarFocused = false;
  _sidebarSelectedIndex = -1;
  const nav = document.getElementById('sidebar-nav');
  if (nav) nav.classList.remove('sidebar-focused');
  _getSidebarItems().forEach(el => el.classList.remove('sidebar-kbd-selected'));
}

function _renderSidebarSelection() {
  const items = _getSidebarItems();
  items.forEach(el => el.classList.remove('sidebar-kbd-selected'));
  // Scroll into view if needed
  if (_sidebarSelectedIndex >= 0 && items[_sidebarSelectedIndex]) {
    items[_sidebarSelectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

var _sidebarNavClicking = false;
function _sidebarNavigate(direction) {
  const items = _getSidebarItems();
  if (!items.length) return;

  _sidebarSelectedIndex += direction;
  if (_sidebarSelectedIndex < 0) _sidebarSelectedIndex = items.length - 1;
  if (_sidebarSelectedIndex >= items.length) _sidebarSelectedIndex = 0;
  _renderSidebarSelection();
  // Immediately open the selected view
  if (items[_sidebarSelectedIndex]) {
    _sidebarNavClicking = true;
    items[_sidebarSelectedIndex].click();
    _sidebarNavClicking = false;
  }
}

function _sidebarActivateSelected() {
  const items = _getSidebarItems();
  if (_sidebarSelectedIndex >= 0 && items[_sidebarSelectedIndex]) {
    items[_sidebarSelectedIndex].click();
  }
}

// Install global keyboard handler for sidebar navigation
(function initSidebarKeyNav() {
  document.addEventListener('keydown', (e) => {
    // Don't intercept if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    // Press [ to focus sidebar
    if (e.key === '[' && !_sidebarFocused) {
      e.preventDefault();
      _focusSidebar();
      return;
    }

    if (!_sidebarFocused) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      _sidebarNavigate(-1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      _sidebarNavigate(1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      _sidebarActivateSelected();
      _blurSidebar();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _blurSidebar();
    }
  });

  // Click outside sidebar blurs it
  document.addEventListener('mousedown', (e) => {
    if (!_sidebarFocused) return;
    const nav = document.getElementById('sidebar-nav');
    if (nav && !nav.contains(e.target)) {
      _blurSidebar();
    }
  });
})();

// Hook into sidebar icon clicks to enable keyboard navigation
function _installSidebarClickFocus() {
  document.querySelectorAll('.sidebar-icon').forEach(el => {
    el.addEventListener('click', () => {
      if (_sidebarNavClicking) return;
      const items = _getSidebarItems();
      const idx = items.indexOf(el);
      if (idx >= 0) {
        _sidebarSelectedIndex = idx;
        _focusSidebar();
      }
    });
  });
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _installSidebarClickFocus);
} else {
  _installSidebarClickFocus();
}

// ── Performance Optimizations ──

// Lazy load images using IntersectionObserver
let _lazyImageObserver = null;

function initLazyImageLoading() {
  if (!('IntersectionObserver' in window)) {
    // Fallback: load all images immediately on older browsers
    return;
  }

  _lazyImageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        }
        observer.unobserve(img);
      }
    });
  }, {
    rootMargin: '50px' // Start loading 50px before image enters viewport
  });
}

function observeLazyImages() {
  if (!_lazyImageObserver) return;

  document.querySelectorAll('img[data-src]').forEach(img => {
    _lazyImageObserver.observe(img);
  });
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initLazyImageLoading();
    observeLazyImages();
  });
} else {
  initLazyImageLoading();
  observeLazyImages();
}

// ── View management ──
const ARXIV_LOGO_INLINE = '<img class="h-3.5 w-auto opacity-50 inline-block" src="/arxiv-logomark-small@2x.png" alt="arXiv" />';
const RSS_LOGO_INLINE = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#f90" width="256" height="256" rx="24"/><circle cx="68" cy="189" r="28" fill="#fff"/><path d="M40 120a108 108 0 01108 108h-36a72 72 0 00-72-72v-36z" fill="#fff"/><path d="M40 56a172 172 0 01172 172h-36A136 136 0 0076 92V56h-36z" fill="#fff"/></svg>';
const SUBSTACK_LOGO_INLINE = '<svg class="h-3.5 w-auto inline-block" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.54 6.42H1.46V4.2h21.08v2.22zM1.46 9.26h21.08V7.04H1.46v2.22zM22.54 12.1H1.46v9.52l10.54-5.87 10.54 5.87V12.1z" fill="#FF6719"/></svg>';

// ── Feed catalog ──
const FEED_CATALOG = [
  // Research & Science
  { key: 'arxiv', name: 'arXiv', desc: 'Latest CS research papers', cat: 'Research & Science', special: 'arxiv', img: '/arxiv-logomark-small@2x.png', favicon: 'arxiv.org' },
  { key: 'nature', name: 'Nature', desc: 'Scientific research and discoveries', cat: 'Research & Science', url: 'https://www.nature.com/nature.rss', letter: 'N', bg: '#c00', fg: '#fff', favicon: 'nature.com' },
  { key: 'science', name: 'Science', desc: 'Peer-reviewed research from AAAS', cat: 'Research & Science', url: 'https://www.science.org/rss/news_current.xml', letter: 'S', bg: '#1a5276', fg: '#fff', favicon: 'science.org' },
  { key: 'quanta', name: 'Quanta Magazine', desc: 'In-depth math and science journalism', cat: 'Research & Science', url: 'https://www.quantamagazine.org/feed/', letter: 'Q', bg: '#000', fg: '#f5c518', favicon: 'quantamagazine.org' },
  // Tech & News
  { key: 'hn', name: 'Hacker News', desc: 'Top stories from the tech community', cat: 'Tech & News', special: 'hn', letter: 'Y', bg: '#f60', fg: '#fff', font: 'Verdana,sans-serif', favicon: 'news.ycombinator.com' },
  { key: 'verge', name: 'The Verge', desc: 'Technology news and culture', cat: 'Tech & News', url: 'https://www.theverge.com/rss/index.xml', letter: 'V', bg: '#000', fg: '#fa4b2a', stroke: '#333', favicon: 'theverge.com' },
  { key: 'arstechnica', name: 'Ars Technica', desc: 'In-depth technology reporting', cat: 'Tech & News', url: 'https://feeds.arstechnica.com/arstechnica/index', letter: 'a', bg: '#ff4e00', fg: '#fff', favicon: 'arstechnica.com' },
  { key: 'techcrunch', name: 'TechCrunch', desc: 'Startup and technology news', cat: 'Tech & News', url: 'https://techcrunch.com/feed/', letter: 'T', bg: '#0a9e01', fg: '#fff', favicon: 'techcrunch.com' },
  { key: 'wired', name: 'Wired', desc: 'Future trends in tech and culture', cat: 'Tech & News', url: 'https://www.wired.com/feed/rss', letter: 'W', bg: '#000', fg: '#fff', favicon: 'wired.com' },
  { key: 'mittr', name: 'MIT Tech Review', desc: 'Emerging technology analysis', cat: 'Tech & News', url: 'https://www.technologyreview.com/feed/', letter: 'M', bg: '#a31c44', fg: '#fff', favicon: 'technologyreview.com' },
  // Programming
  { key: 'lobsters', name: 'Lobsters', desc: 'Community-curated programming links', cat: 'Programming', url: 'https://lobste.rs/rss', letter: 'L', bg: '#ac130d', fg: '#fff', favicon: 'lobste.rs' },
  // AI & Machine Learning
  { key: 'gradient', name: 'The Gradient', desc: 'AI research perspectives', cat: 'AI & Machine Learning', url: 'https://thegradient.pub/rss/', letter: 'G', bg: '#6b21a8', fg: '#fff', favicon: 'thegradient.pub' },
  // Security
  { key: 'krebs', name: 'Krebs on Security', desc: 'Cybersecurity news and investigations', cat: 'Security', url: 'https://krebsonsecurity.com/feed/', letter: 'K', bg: '#2d3436', fg: '#00b894', favicon: 'krebsonsecurity.com' },
  // Ideas & Culture
  { key: 'aeon', name: 'Aeon', desc: 'Essays on science, philosophy, society', cat: 'Ideas & Culture', url: 'https://aeon.co/feed', letter: 'Æ', bg: '#1a1a2e', fg: '#e7d4b5', favicon: 'aeon.co' },
  { key: 'nautilus', name: 'Nautilus', desc: 'Science meets philosophy and culture', cat: 'Ideas & Culture', url: 'https://nautil.us/feed/', letter: 'N', bg: '#0891b2', fg: '#fff', favicon: 'nautil.us' },
  // Sports
  { key: 'espn', name: 'ESPN', desc: 'Top sports news and scores', cat: 'Sports', url: 'https://www.espn.com/espn/rss/news', letter: 'E', bg: '#d00', fg: '#fff', favicon: 'espn.com' },
  { key: 'theathletic', name: 'The Athletic', desc: 'In-depth sports journalism', cat: 'Sports', url: 'https://theathletic.com/feed/', letter: 'A', bg: '#000', fg: '#d4a853', favicon: 'theathletic.com' },
  { key: 'bleacherreport', name: 'Bleacher Report', desc: 'Sports highlights and analysis', cat: 'Sports', url: 'https://bleacherreport.com/articles/feed', letter: 'B', bg: '#000', fg: '#ff0', favicon: 'bleacherreport.com' },
  // Prediction Markets
  { key: 'polymarket', name: 'Polymarket', desc: 'Breaking prediction markets', cat: 'Prediction Markets', special: 'polymarket', letter: 'P', bg: '#0052ff', fg: '#fff', favicon: 'polymarket.com' },
  // Programming (additional)
  { key: 'devto', name: 'DEV Community', desc: 'Developer articles and tutorials', cat: 'Programming', url: 'https://dev.to/feed', letter: 'D', bg: '#0a0a0a', fg: '#fff', favicon: 'dev.to' },
  { key: 'hackernoon', name: 'Hacker Noon', desc: 'Tech industry stories and takes', cat: 'Programming', url: 'https://hackernoon.com/feed', letter: 'H', bg: '#00ff00', fg: '#000', favicon: 'hackernoon.com' },
  { key: 'smashing', name: 'Smashing Magazine', desc: 'Web design and development', cat: 'Programming', url: 'https://www.smashingmagazine.com/feed/', letter: 'S', bg: '#e53b2c', fg: '#fff', favicon: 'smashingmagazine.com' },
  // AI & Machine Learning (additional)
  { key: 'aiweirdness', name: 'AI Weirdness', desc: 'Humor and oddities in AI', cat: 'AI & Machine Learning', url: 'https://www.aiweirdness.com/rss/', letter: 'A', bg: '#7c3aed', fg: '#fff', favicon: 'aiweirdness.com' },
  { key: 'mlmastery', name: 'ML Mastery', desc: 'Machine learning tutorials and guides', cat: 'AI & Machine Learning', url: 'https://machinelearningmastery.com/feed/', letter: 'M', bg: '#1e40af', fg: '#fff', favicon: 'machinelearningmastery.com' },
  // News & World
  { key: 'reuters', name: 'Reuters', desc: 'Breaking world news', cat: 'News & World', url: 'https://feeds.reuters.com/reuters/topNews', letter: 'R', bg: '#ff8000', fg: '#fff', favicon: 'reuters.com' },
  { key: 'bbc', name: 'BBC News', desc: 'Global news coverage', cat: 'News & World', url: 'https://feeds.bbci.co.uk/news/rss.xml', letter: 'B', bg: '#bb1919', fg: '#fff', favicon: 'bbc.com' },
  { key: 'npr', name: 'NPR', desc: 'National and international news', cat: 'News & World', url: 'https://feeds.npr.org/1001/rss.xml', letter: 'N', bg: '#1a1a1a', fg: '#5a82a1', favicon: 'npr.org' },
  { key: 'apnews', name: 'AP News', desc: 'Breaking news from the Associated Press', cat: 'News & World', url: 'https://rsshub.app/apnews/topics/apf-topnews', letter: 'AP', bg: '#e00', fg: '#fff', favicon: 'apnews.com' },
  // Ideas & Culture (additional)
  { key: 'atlantic', name: 'The Atlantic', desc: 'Politics, culture, and ideas', cat: 'Ideas & Culture', url: 'https://www.theatlantic.com/feed/all/', letter: 'A', bg: '#000', fg: '#e4c9a8', favicon: 'theatlantic.com' },
  { key: 'newyorker', name: 'The New Yorker', desc: 'Reporting, commentary, and essays', cat: 'Ideas & Culture', url: 'https://www.newyorker.com/feed/everything', letter: 'NY', bg: '#000', fg: '#fff', favicon: 'newyorker.com' },
  { key: 'brainpickings', name: 'The Marginalian', desc: 'Literature, science, and philosophy', cat: 'Ideas & Culture', url: 'https://www.themarginalian.org/feed/', letter: 'M', bg: '#4a2c6e', fg: '#f0d78c', favicon: 'themarginalian.org' },
  // Science (additional)
  { key: 'sciamerican', name: 'Scientific American', desc: 'Science news and features', cat: 'Research & Science', url: 'http://rss.sciam.com/ScientificAmerican-Global', letter: 'SA', bg: '#000', fg: '#fff', favicon: 'scientificamerican.com' },
  { key: 'newscientist', name: 'New Scientist', desc: 'Science and technology news', cat: 'Research & Science', url: 'https://www.newscientist.com/section/news/feed/', letter: 'NS', bg: '#d32f2f', fg: '#fff', favicon: 'newscientist.com' },
  { key: 'phys', name: 'Phys.org', desc: 'Physics, space, and earth science', cat: 'Research & Science', url: 'https://phys.org/rss-feed/', letter: 'P', bg: '#005a87', fg: '#fff', favicon: 'phys.org' },
  // Design
  { key: 'designernews', name: 'Designer News', desc: 'Design community links', cat: 'Design', url: 'https://www.designernews.co/?format=rss', letter: 'DN', bg: '#2d72d9', fg: '#fff', favicon: 'designernews.co' },
  { key: 'sidebar', name: 'Sidebar', desc: 'Five curated design links daily', cat: 'Design', url: 'https://sidebar.io/feed.xml', letter: 'S', bg: '#f8f0e3', fg: '#333', favicon: 'sidebar.io' },
  // Finance & Economics
  { key: 'ft', name: 'Financial Times', desc: 'Global business and finance', cat: 'Finance & Economics', url: 'https://www.ft.com/rss/home', letter: 'FT', bg: '#fff1e5', fg: '#000', favicon: 'ft.com' },
  { key: 'economist', name: 'The Economist', desc: 'Global economics and policy', cat: 'Finance & Economics', url: 'https://www.economist.com/latest/rss.xml', letter: 'E', bg: '#e3120b', fg: '#fff', favicon: 'economist.com' },
  { key: 'mattstoller', name: 'BIG by Matt Stoller', desc: 'Monopoly power and political economy', cat: 'Finance & Economics', url: 'https://www.thebignewsletter.com/feed', letter: 'B', bg: '#1a1a1a', fg: '#e8d44d', favicon: 'thebignewsletter.com' },
  // Space
  { key: 'nasabreaking', name: 'NASA', desc: 'Space news and mission updates', cat: 'Space', url: 'https://www.nasa.gov/news-release/feed/', letter: 'N', bg: '#0b3d91', fg: '#fff', favicon: 'nasa.gov' },
  { key: 'spacenews', name: 'SpaceNews', desc: 'Space industry coverage', cat: 'Space', url: 'https://spacenews.com/feed/', letter: 'S', bg: '#0c1445', fg: '#4fc3f7', favicon: 'spacenews.com' },
  // Blogs & Newsletters
  { key: 'acx', name: 'Astral Codex Ten', desc: 'Scott Alexander on science, philosophy, and rationality', cat: 'Blogs & Newsletters', url: 'https://www.astralcodexten.com/feed', letter: 'A', bg: '#1a1a2e', fg: '#6ee7b7', favicon: 'astralcodexten.com' },
  { key: 'dwarkesh', name: 'Dwarkesh Patel', desc: 'Deep-dive interviews on progress and ideas', cat: 'Blogs & Newsletters', url: 'https://www.dwarkesh.com/feed', letter: 'D', bg: '#18181b', fg: '#f59e0b', favicon: 'dwarkesh.com' },
  { key: 'geohot', name: 'geohot', desc: 'George Hotz on technology, AI, and hacking', cat: 'Blogs & Newsletters', url: 'https://geohot.github.io/blog/feed.xml', letter: 'G', bg: '#111', fg: '#0f0', favicon: 'geohot.github.io' },
  { key: 'lilianweng', name: "Lil'Log", desc: 'Lilian Weng on deep learning and AI research', cat: 'Blogs & Newsletters', url: 'https://lilianweng.github.io/index.xml', letter: 'L', bg: '#4a1a6b', fg: '#e8b4f8', favicon: 'lilianweng.github.io' },
  { key: 'colah', name: "colah's blog", desc: 'Visual explanations of neural networks', cat: 'Blogs & Newsletters', url: 'https://colah.github.io/rss.xml', letter: 'C', bg: '#2c3e50', fg: '#1abc9c', favicon: 'colah.github.io' },
  { key: 'dennybritz', name: 'Denny Britz', desc: 'Machine learning and software engineering', cat: 'Blogs & Newsletters', url: 'https://dennybritz.com/index.xml', letter: 'D', bg: '#1e3a5f', fg: '#fff', favicon: 'dennybritz.com' },
  { key: 'gwern', name: 'Gwern', desc: 'Essays on AI, statistics, and technology', cat: 'Blogs & Newsletters', url: 'https://gwern.substack.com/feed', letter: 'G', bg: '#1a1a1a', fg: '#98fb98', favicon: 'gwern.net' },
  { key: 'lesswrong', name: 'LessWrong', desc: 'Rationality, AI safety, and decision-making', cat: 'Blogs & Newsletters', url: 'https://www.lesswrong.com/feed.xml', letter: 'LW', bg: '#3d6b37', fg: '#fff', favicon: 'lesswrong.com' },
  { key: 'trentonbricken', name: 'Trenton Bricken', desc: 'Computational neuroscience and AI research', cat: 'Blogs & Newsletters', url: 'https://www.trentonbricken.com/feed.xml', letter: 'T', bg: '#1a1a2e', fg: '#7dd3fc', favicon: 'trentonbricken.com' },
  { key: 'jasonwei', name: 'Jason Wei', desc: 'Chain-of-thought and LLM research', cat: 'Blogs & Newsletters', url: 'https://www.jasonwei.net/blog?format=rss', letter: 'J', bg: '#1e293b', fg: '#fbbf24', favicon: 'jasonwei.net' },
  { key: 'fanpu', name: 'Fan Pu Zeng', desc: 'CS, math, and research', cat: 'Blogs & Newsletters', url: 'https://fanpu.io/feed.xml', letter: 'F', bg: '#1e40af', fg: '#fff', favicon: 'fanpu.io' },
  { key: 'mcyoung', name: 'mcyoung', desc: 'Compilers, performance, and systems programming', cat: 'Blogs & Newsletters', url: 'https://mcyoung.xyz/feed.xml', letter: 'M', bg: '#18181b', fg: '#f472b6', favicon: 'mcyoung.xyz' },
  { key: 'itcanthink', name: 'It Can Think!', desc: 'Substack on AI and cognition', cat: 'Blogs & Newsletters', url: 'https://itcanthink.substack.com/feed', letter: 'I', bg: '#312e81', fg: '#c4b5fd', favicon: 'itcanthink.substack.com' },
  { key: 'sanderai', name: 'Sander Dieleman', desc: 'Generative modeling and diffusion models', cat: 'Blogs & Newsletters', url: 'https://sander.ai/feed.xml', letter: 'S', bg: '#0f172a', fg: '#38bdf8', favicon: 'sander.ai' },
  { key: 'gundersen', name: 'Gregory Gundersen', desc: 'Statistics, ML, and technical writing', cat: 'Blogs & Newsletters', url: 'https://gregorygundersen.com/feed.xml', letter: 'G', bg: '#f5f0eb', fg: '#333', favicon: 'gregorygundersen.com' },
  { key: 'brandinho', name: 'Brandinho', desc: 'Data science and machine learning', cat: 'Blogs & Newsletters', url: 'https://brandinho.github.io/feed.xml', letter: 'B', bg: '#1e293b', fg: '#4ade80', favicon: 'brandinho.github.io' },
  { key: 'fabiensanglard', name: 'Fabien Sanglard', desc: 'Game engines, graphics, and systems', cat: 'Blogs & Newsletters', url: 'https://fabiensanglard.net/rss.xml', letter: 'F', bg: '#000', fg: '#e74c3c', favicon: 'fabiensanglard.net' },
  { key: 'andyjones', name: 'Andy Jones', desc: 'Statistics, ML, and academic life', cat: 'Blogs & Newsletters', url: 'https://andrewcharlesjones.github.io/feed.xml', letter: 'A', bg: '#2d3748', fg: '#fbd38d', favicon: 'andrewcharlesjones.github.io' },
  { key: 'thegeeko', name: 'thegeeko', desc: 'GPU debugging, rendering, and WebSockets', cat: 'Blogs & Newsletters', url: 'https://thegeeko.me/rss.xml', letter: 'T', bg: '#111827', fg: '#34d399', favicon: 'thegeeko.me' },
  { key: 'rohany', name: 'Rohan Yadav', desc: 'Compilers and high-performance computing', cat: 'Blogs & Newsletters', url: 'https://rohany.github.io/index.xml', letter: 'R', bg: '#1a1a2e', fg: '#a78bfa', favicon: 'rohany.github.io' },
  { key: 'eliben', name: 'Eli Bendersky', desc: 'Go, Python, compilers, and ML', cat: 'Blogs & Newsletters', url: 'https://eli.thegreenplace.net/feeds/all.atom.xml', letter: 'E', bg: '#2e7d32', fg: '#fff', favicon: 'eli.thegreenplace.net' },
  { key: 'jaredtumiel', name: 'Jared Tumiel', desc: 'Physics, computation, and AI', cat: 'Blogs & Newsletters', url: 'https://jaredtumiel.github.io/blog/feed.xml', letter: 'J', bg: '#1e293b', fg: '#60a5fa', favicon: 'jaredtumiel.github.io' },
  { key: 'paulcavallaro', name: 'Paul Cavallaro', desc: 'CS, systems, and software engineering', cat: 'Blogs & Newsletters', url: 'https://paulcavallaro.com/blog/index.xml', letter: 'P', bg: '#18181b', fg: '#e2e8f0', favicon: 'paulcavallaro.com' },
  { key: 'clashluke', name: 'Lucas Nestler', desc: 'ML normalization, attention, and AI research', cat: 'Blogs & Newsletters', url: 'https://clashluke.github.io/index.xml', letter: 'L', bg: '#1e1b4b', fg: '#818cf8', favicon: 'clashluke.github.io' },
  { key: 'karpathy', name: 'Andrej Karpathy', desc: 'AI, LLMs, and technical deep dives', cat: 'Blogs & Newsletters', url: 'https://karpathy.bearblog.dev/feed/', letter: 'K', bg: '#18181b', fg: '#f59e0b', favicon: 'karpathy.bearblog.dev' },
  { key: 'wzml', name: 'Hill Climbing', desc: 'Machine learning concepts and techniques', cat: 'Blogs & Newsletters', url: 'https://blog.wz-ml.com/feed.xml', letter: 'H', bg: '#0c4a6e', fg: '#7dd3fc', favicon: 'blog.wz-ml.com' },
  { key: 'simonwillison', name: 'Simon Willison', desc: 'Python, Django, AI tools, and LLMs', cat: 'Blogs & Newsletters', url: 'https://simonwillison.net/atom/everything/', letter: 'S', bg: '#1e3a5f', fg: '#fde68a', favicon: 'simonwillison.net' },
  { key: 'jeffgeerling', name: 'Jeff Geerling', desc: 'Raspberry Pi, Ansible, and open-source hardware', cat: 'Blogs & Newsletters', url: 'https://www.jeffgeerling.com/blog.xml', letter: 'J', bg: '#b91c1c', fg: '#fff', favicon: 'jeffgeerling.com' },
  { key: 'robotsinplainenglish', name: 'Robots In Plain English', desc: 'Robotics, engineering, and automation', cat: 'Blogs & Newsletters', url: 'https://robotsinplainenglish.substack.com/feed', letter: 'R', bg: '#334155', fg: '#fb923c', favicon: 'robotsinplainenglish.com' },
  { key: 'occasionalinformationist', name: 'The Occasional Informationist', desc: 'Information science and related topics', cat: 'Blogs & Newsletters', url: 'https://theoccasionalinformationist.com/feed/', letter: 'O', bg: '#4a2c6e', fg: '#f0d78c', favicon: 'theoccasionalinformationist.com' },
  { key: 'bactra', name: 'Cosma Shalizi', desc: 'Statistics, complexity, and social science', cat: 'Blogs & Newsletters', url: 'http://bactra.org/weblog/index.rss', letter: 'C', bg: '#1a1a1a', fg: '#d4d4d4', favicon: 'bactra.org' },
  { key: 'nearblog', name: 'near.blog', desc: 'AI, animals, philosophy, and reflections', cat: 'Blogs & Newsletters', url: 'https://near.blog/feed/', letter: 'N', bg: '#1e293b', fg: '#86efac', favicon: 'near.blog' },
  { key: 'moultano', name: 'Ryan Moulton', desc: 'ML, game dev, and miscellaneous topics', cat: 'Blogs & Newsletters', url: 'https://moultano.wordpress.com/feed/', letter: 'R', bg: '#374151', fg: '#93c5fd', favicon: 'moultano.wordpress.com' },
  { key: 'convergentthinking', name: 'Convergent Thinking', desc: 'ML research and deep learning', cat: 'Blogs & Newsletters', url: 'https://convergentthinking.sh/index.xml', letter: 'C', bg: '#0f172a', fg: '#a78bfa', favicon: 'convergentthinking.sh' },
  { key: 'entropicthoughts', name: 'Entropic Thoughts', desc: 'Programming and software engineering', cat: 'Blogs & Newsletters', url: 'https://entropicthoughts.com/feed.xml', letter: 'E', bg: '#1c1917', fg: '#d6d3d1', favicon: 'entropicthoughts.com' },
  // HN Top Blogs 2025
  { key: 'seangoedecke', name: 'Sean Goedecke', desc: 'Software engineering and career', cat: 'HN Top Blogs 2025', url: 'https://www.seangoedecke.com/rss.xml', letter: 'S', bg: '#1e293b', fg: '#94a3b8', favicon: 'seangoedecke.com' },
  { key: 'daringfireball', name: 'Daring Fireball', desc: 'Apple, tech, and culture by John Gruber', cat: 'HN Top Blogs 2025', url: 'https://daringfireball.net/feeds/main', letter: 'DF', bg: '#4a4a4a', fg: '#fff', favicon: 'daringfireball.net' },
  { key: 'ericmigi', name: 'Eric Migicovsky', desc: 'Hardware, startups, and Pebble', cat: 'HN Top Blogs 2025', url: 'https://ericmigi.com/rss.xml', letter: 'E', bg: '#111', fg: '#4ade80', favicon: 'ericmigi.com' },
  { key: 'antirez', name: 'antirez', desc: 'Redis creator on programming and systems', cat: 'HN Top Blogs 2025', url: 'http://antirez.com/rss', letter: 'A', bg: '#1a1a1a', fg: '#e74c3c', favicon: 'antirez.com' },
  { key: 'idiallo', name: 'Ibrahim Diallo', desc: 'Web development and programming stories', cat: 'HN Top Blogs 2025', url: 'https://idiallo.com/feed.rss', letter: 'I', bg: '#1e3a5f', fg: '#fff', favicon: 'idiallo.com' },
  { key: 'maurycyz', name: 'Maurycy Zarzycki', desc: 'Programming and tech', cat: 'HN Top Blogs 2025', url: 'https://maurycyz.com/index.xml', letter: 'M', bg: '#18181b', fg: '#a78bfa', favicon: 'maurycyz.com' },
  { key: 'pluralistic', name: 'Pluralistic', desc: 'Cory Doctorow on tech, monopolies, and rights', cat: 'HN Top Blogs 2025', url: 'https://pluralistic.net/feed/', letter: 'P', bg: '#1a1a2e', fg: '#ff6b6b', favicon: 'pluralistic.net' },
  { key: 'shkspr', name: 'Terence Eden', desc: 'Web standards, tech, and open source', cat: 'HN Top Blogs 2025', url: 'https://shkspr.mobi/blog/feed/', letter: 'T', bg: '#2d3748', fg: '#fbd38d', favicon: 'shkspr.mobi' },
  { key: 'lcamtuf', name: 'lcamtuf', desc: 'Security research and fuzzing', cat: 'HN Top Blogs 2025', url: 'https://lcamtuf.substack.com/feed', letter: 'L', bg: '#111827', fg: '#34d399', favicon: 'lcamtuf.substack.com' },
  { key: 'mitchellh', name: 'Mitchell Hashimoto', desc: 'Ghostty, systems, and open source', cat: 'HN Top Blogs 2025', url: 'https://mitchellh.com/feed.xml', letter: 'M', bg: '#0f172a', fg: '#38bdf8', favicon: 'mitchellh.com' },
  { key: 'dynomight', name: 'Dynomight', desc: 'Science, data, and contrarian analysis', cat: 'HN Top Blogs 2025', url: 'https://dynomight.net/feed.xml', letter: 'D', bg: '#1c1917', fg: '#fb923c', favicon: 'dynomight.net' },
  { key: 'cks', name: 'Chris Siebenmann', desc: 'Unix, sysadmin, and systems', cat: 'HN Top Blogs 2025', url: 'https://utcc.utoronto.ca/~cks/space/blog/?atom', letter: 'C', bg: '#334155', fg: '#e2e8f0', favicon: 'utcc.utoronto.ca' },
  { key: 'xeiaso', name: 'Xe Iaso', desc: 'Nix, Go, and philosophy of tech', cat: 'HN Top Blogs 2025', url: 'https://xeiaso.net/blog.rss', letter: 'X', bg: '#4c1d95', fg: '#c4b5fd', favicon: 'xeiaso.net' },
  { key: 'oldnewthing', name: 'The Old New Thing', desc: 'Raymond Chen on Windows internals', cat: 'HN Top Blogs 2025', url: 'https://devblogs.microsoft.com/oldnewthing/feed', letter: 'O', bg: '#0078d4', fg: '#fff', favicon: 'devblogs.microsoft.com' },
  { key: 'righto', name: 'Ken Shirriff', desc: 'Reverse engineering chips and hardware', cat: 'HN Top Blogs 2025', url: 'https://www.righto.com/feeds/posts/default', letter: 'K', bg: '#1a1a1a', fg: '#4fc3f7', favicon: 'righto.com' },
  { key: 'lucumr', name: 'Armin Ronacher', desc: 'Python, Rust, and developer tooling', cat: 'HN Top Blogs 2025', url: 'https://lucumr.pocoo.org/feed.atom', letter: 'A', bg: '#1e293b', fg: '#f472b6', favicon: 'lucumr.pocoo.org' },
  { key: 'skyfall', name: 'Skyfall', desc: 'Tech and engineering', cat: 'HN Top Blogs 2025', url: 'https://skyfall.dev/rss.xml', letter: 'S', bg: '#0c4a6e', fg: '#7dd3fc', favicon: 'skyfall.dev' },
  { key: 'garymarcus', name: 'Gary Marcus', desc: 'AI criticism and cognitive science', cat: 'HN Top Blogs 2025', url: 'https://garymarcus.substack.com/feed', letter: 'G', bg: '#312e81', fg: '#fbbf24', favicon: 'garymarcus.substack.com' },
  { key: 'rachelbythebay', name: 'rachelbythebay', desc: 'Systems programming war stories', cat: 'HN Top Blogs 2025', url: 'https://rachelbythebay.com/w/atom.xml', letter: 'R', bg: '#18181b', fg: '#d6d3d1', favicon: 'rachelbythebay.com' },
  { key: 'overreacted', name: 'Overreacted', desc: 'Dan Abramov on React and programming', cat: 'HN Top Blogs 2025', url: 'https://overreacted.io/rss.xml', letter: 'O', bg: '#000', fg: '#ff6a6a', favicon: 'overreacted.io' },
  { key: 'timsh', name: 'Tim Shedor', desc: 'Tech and engineering', cat: 'HN Top Blogs 2025', url: 'https://timsh.org/rss/', letter: 'T', bg: '#1e293b', fg: '#86efac', favicon: 'timsh.org' },
  { key: 'johndcook', name: 'John D. Cook', desc: 'Math, statistics, and computing', cat: 'HN Top Blogs 2025', url: 'https://www.johndcook.com/blog/feed/', letter: 'J', bg: '#1e3a5f', fg: '#fff', favicon: 'johndcook.com' },
  { key: 'gilesthomas', name: 'Giles Thomas', desc: 'Programming and tech', cat: 'HN Top Blogs 2025', url: 'https://gilesthomas.com/feed/rss.xml', letter: 'G', bg: '#374151', fg: '#93c5fd', favicon: 'gilesthomas.com' },
  { key: 'matklad', name: 'matklad', desc: 'Rust, rust-analyzer, and IDE tooling', cat: 'HN Top Blogs 2025', url: 'https://matklad.github.io/feed.xml', letter: 'M', bg: '#1a1a2e', fg: '#f97316', favicon: 'matklad.github.io' },
  { key: 'derekthompson', name: 'Derek Thompson', desc: 'Culture, economics, and ideas', cat: 'HN Top Blogs 2025', url: 'https://www.theatlantic.com/feed/author/derek-thompson/', letter: 'D', bg: '#000', fg: '#e4c9a8', favicon: 'theatlantic.com' },
  { key: 'evanhahn', name: 'Evan Hahn', desc: 'Web development and JavaScript', cat: 'HN Top Blogs 2025', url: 'https://evanhahn.com/feed.xml', letter: 'E', bg: '#1e293b', fg: '#60a5fa', favicon: 'evanhahn.com' },
  { key: 'terriblesoftware', name: 'Terrible Software', desc: 'Software engineering opinions', cat: 'HN Top Blogs 2025', url: 'https://terriblesoftware.org/feed/', letter: 'T', bg: '#18181b', fg: '#ef4444', favicon: 'terriblesoftware.org' },
  { key: 'rakhim', name: 'Rakhim', desc: 'Programming and creativity', cat: 'HN Top Blogs 2025', url: 'https://rakhim.exotext.com/rss.xml', letter: 'R', bg: '#1c1917', fg: '#fde68a', favicon: 'rakhim.exotext.com' },
  { key: 'joanwestenberg', name: 'Joan Westenberg', desc: 'Tech culture and criticism', cat: 'HN Top Blogs 2025', url: 'https://joanwestenberg.com/rss', letter: 'J', bg: '#111827', fg: '#f9a8d4', favicon: 'joanwestenberg.com' },
  { key: 'xania', name: 'Matt Godbolt', desc: 'Compilers, C++, and Compiler Explorer', cat: 'HN Top Blogs 2025', url: 'https://xania.org/feed', letter: 'M', bg: '#1a1a1a', fg: '#4ade80', favicon: 'xania.org' },
  { key: 'micahflee', name: 'Micah Lee', desc: 'Security, privacy, and journalism', cat: 'HN Top Blogs 2025', url: 'https://micahflee.com/feed/', letter: 'M', bg: '#1e293b', fg: '#38bdf8', favicon: 'micahflee.com' },
  { key: 'nesbitt', name: 'Andrew Nesbitt', desc: 'Open source and software supply chain', cat: 'HN Top Blogs 2025', url: 'https://nesbitt.io/feed.xml', letter: 'N', bg: '#0f172a', fg: '#a78bfa', favicon: 'nesbitt.io' },
  { key: 'constructionphysics', name: 'Construction Physics', desc: 'Engineering, building, and infrastructure', cat: 'HN Top Blogs 2025', url: 'https://www.construction-physics.com/feed', letter: 'C', bg: '#78350f', fg: '#fde68a', favicon: 'construction-physics.com' },
  { key: 'tedium', name: 'Tedium', desc: 'The dull side of the internet', cat: 'HN Top Blogs 2025', url: 'https://feed.tedium.co/', letter: 'T', bg: '#1a1a2e', fg: '#e2e8f0', favicon: 'tedium.co' },
  { key: 'susam', name: 'Susam Pal', desc: 'Math, programming, and Unix', cat: 'HN Top Blogs 2025', url: 'https://susam.net/feed.xml', letter: 'S', bg: '#1e3a5f', fg: '#d6d3d1', favicon: 'susam.net' },
  { key: 'hillelwayne', name: 'Hillel Wayne', desc: 'Formal methods and software engineering', cat: 'HN Top Blogs 2025', url: 'https://buttondown.com/hillelwayne/rss', letter: 'H', bg: '#1e293b', fg: '#fbbf24', favicon: 'buttondown.com' },
  { key: 'borretti', name: 'Fernando Borretti', desc: 'Programming languages and compilers', cat: 'HN Top Blogs 2025', url: 'https://borretti.me/feed.xml', letter: 'F', bg: '#18181b', fg: '#a78bfa', favicon: 'borretti.me' },
  { key: 'wheresyoured', name: "Where's Your Ed At", desc: 'Tech industry criticism', cat: 'HN Top Blogs 2025', url: 'https://www.wheresyoured.at/rss/', letter: 'W', bg: '#111827', fg: '#f87171', favicon: 'wheresyoured.at' },
  { key: 'jaydml', name: 'Jay Dixit', desc: 'Programming and tech', cat: 'HN Top Blogs 2025', url: 'https://jayd.ml/feed.xml', letter: 'J', bg: '#1c1917', fg: '#86efac', favicon: 'jayd.ml' },
  { key: 'minimaxir', name: 'Max Woolf', desc: 'Data science, AI, and Python', cat: 'HN Top Blogs 2025', url: 'https://minimaxir.com/index.xml', letter: 'M', bg: '#0f172a', fg: '#fb923c', favicon: 'minimaxir.com' },
  { key: 'paulgraham', name: 'Paul Graham', desc: 'Startups, programming, and essays', cat: 'HN Top Blogs 2025', url: 'http://www.aaronsw.com/2002/feeds/pgessays.rss', letter: 'P', bg: '#000', fg: '#fff', favicon: 'paulgraham.com' },
  { key: 'filfre', name: 'The Digital Antiquarian', desc: 'History of computing and games', cat: 'HN Top Blogs 2025', url: 'https://www.filfre.net/feed/', letter: 'F', bg: '#1a1a1a', fg: '#d4a853', favicon: 'filfre.net' },
  { key: 'jimnielsen', name: 'Jim Nielsen', desc: 'Web design and development', cat: 'HN Top Blogs 2025', url: 'https://blog.jim-nielsen.com/feed.xml', letter: 'J', bg: '#1e293b', fg: '#93c5fd', favicon: 'blog.jim-nielsen.com' },
  { key: 'dfarq', name: 'Dave Farquhar', desc: 'Vintage computing and IT', cat: 'HN Top Blogs 2025', url: 'https://dfarq.homeip.net/feed/', letter: 'D', bg: '#334155', fg: '#e2e8f0', favicon: 'dfarq.homeip.net' },
  { key: 'jyndev', name: 'jyn', desc: 'Rust and compiler development', cat: 'HN Top Blogs 2025', url: 'https://jyn.dev/atom.xml', letter: 'J', bg: '#4c1d95', fg: '#c4b5fd', favicon: 'jyn.dev' },
  { key: 'geoffreylitt', name: 'Geoffrey Litt', desc: 'End-user programming and local-first', cat: 'HN Top Blogs 2025', url: 'https://www.geoffreylitt.com/feed.xml', letter: 'G', bg: '#1e3a5f', fg: '#fde68a', favicon: 'geoffreylitt.com' },
  { key: 'dougbrown', name: 'Doug Brown', desc: 'Retro computing and hardware hacking', cat: 'HN Top Blogs 2025', url: 'https://www.downtowndougbrown.com/feed/', letter: 'D', bg: '#1a1a1a', fg: '#4fc3f7', favicon: 'downtowndougbrown.com' },
  { key: 'brutecat', name: 'Brutecat', desc: 'Security research and exploits', cat: 'HN Top Blogs 2025', url: 'https://brutecat.com/rss.xml', letter: 'B', bg: '#111', fg: '#ef4444', favicon: 'brutecat.com' },
  { key: 'abortretryfail', name: 'Abort Retry Fail', desc: 'Computing history and retro tech', cat: 'HN Top Blogs 2025', url: 'https://www.abortretry.fail/feed', letter: 'A', bg: '#1a1a2e', fg: '#fb923c', favicon: 'abortretry.fail' },
  { key: 'oldvcr', name: 'Old VCR', desc: 'Vintage computing and retrotech', cat: 'HN Top Blogs 2025', url: 'https://oldvcr.blogspot.com/feeds/posts/default', letter: 'O', bg: '#18181b', fg: '#d6d3d1', favicon: 'oldvcr.blogspot.com' },
  { key: 'bogdanthegeek', name: 'Bogdan Rosu', desc: 'Electronics and embedded systems', cat: 'HN Top Blogs 2025', url: 'https://bogdanthegeek.github.io/blog/index.xml', letter: 'B', bg: '#1e293b', fg: '#34d399', favicon: 'bogdanthegeek.github.io' },
  { key: 'hugotunius', name: 'Hugo Tunius', desc: 'Software engineering and compilers', cat: 'HN Top Blogs 2025', url: 'https://hugotunius.se/feed.xml', letter: 'H', bg: '#1c1917', fg: '#7dd3fc', favicon: 'hugotunius.se' },
  { key: 'berthub', name: 'bert hubert', desc: 'DNS, networking, and policy', cat: 'HN Top Blogs 2025', url: 'https://berthub.eu/articles/index.xml', letter: 'B', bg: '#0f172a', fg: '#fbbf24', favicon: 'berthub.eu' },
  { key: 'chadnauseam', name: 'Chad Nauseam', desc: 'Philosophy, AI, and contrarian takes', cat: 'HN Top Blogs 2025', url: 'https://chadnauseam.com/rss.xml', letter: 'C', bg: '#312e81', fg: '#e2e8f0', favicon: 'chadnauseam.com' },
  { key: 'simoneorg', name: 'Simone', desc: 'Creative tech projects and hardware', cat: 'HN Top Blogs 2025', url: 'https://simone.org/feed/', letter: 'S', bg: '#111827', fg: '#f9a8d4', favicon: 'simone.org' },
  { key: 'dragas', name: 'IT Notes', desc: 'Sysadmin and IT operations', cat: 'HN Top Blogs 2025', url: 'https://it-notes.dragas.net/feed/', letter: 'I', bg: '#334155', fg: '#94a3b8', favicon: 'it-notes.dragas.net' },
  { key: 'beej', name: "Beej's Blog", desc: 'Network programming guides and C', cat: 'HN Top Blogs 2025', url: 'https://beej.us/blog/rss.xml', letter: 'B', bg: '#1e3a5f', fg: '#4ade80', favicon: 'beej.us' },
  { key: 'heyparis', name: 'hey.paris', desc: 'Design and technology', cat: 'HN Top Blogs 2025', url: 'https://hey.paris/index.xml', letter: 'H', bg: '#1a1a1a', fg: '#f472b6', favicon: 'hey.paris' },
  { key: 'danielwirtz', name: 'Daniel Wirtz', desc: 'Design, productivity, and indie dev', cat: 'HN Top Blogs 2025', url: 'https://danielwirtz.com/rss.xml', letter: 'D', bg: '#18181b', fg: '#60a5fa', favicon: 'danielwirtz.com' },
  { key: 'matduggan', name: 'Mat Duggan', desc: 'Infrastructure and DevOps', cat: 'HN Top Blogs 2025', url: 'https://matduggan.com/rss/', letter: 'M', bg: '#1e293b', fg: '#ef4444', favicon: 'matduggan.com' },
  { key: 'refactoringenglish', name: 'Refactoring English', desc: 'Technical writing and communication', cat: 'HN Top Blogs 2025', url: 'https://refactoringenglish.com/index.xml', letter: 'R', bg: '#1c1917', fg: '#fde68a', favicon: 'refactoringenglish.com' },
  { key: 'worksonmymachine', name: 'Works On My Machine', desc: 'Software and engineering culture', cat: 'HN Top Blogs 2025', url: 'https://worksonmymachine.substack.com/feed', letter: 'W', bg: '#0f172a', fg: '#a78bfa', favicon: 'worksonmymachine.substack.com' },
  { key: 'philiplaine', name: 'Philip Laine', desc: 'Kubernetes and cloud native', cat: 'HN Top Blogs 2025', url: 'https://philiplaine.com/index.xml', letter: 'P', bg: '#111827', fg: '#38bdf8', favicon: 'philiplaine.com' },
  { key: 'steveblank', name: 'Steve Blank', desc: 'Startups and entrepreneurship', cat: 'HN Top Blogs 2025', url: 'https://steveblank.com/feed/', letter: 'S', bg: '#1e3a5f', fg: '#fff', favicon: 'steveblank.com' },
  { key: 'bernsteinbear', name: 'Max Bernstein', desc: 'Compilers, runtimes, and PL research', cat: 'HN Top Blogs 2025', url: 'https://bernsteinbear.com/feed.xml', letter: 'M', bg: '#1a1a2e', fg: '#86efac', favicon: 'bernsteinbear.com' },
  { key: 'danieldelaney', name: 'Daniel Delaney', desc: 'Web and software engineering', cat: 'HN Top Blogs 2025', url: 'https://danieldelaney.net/feed', letter: 'D', bg: '#374151', fg: '#fbd38d', favicon: 'danieldelaney.net' },
  { key: 'troyhunt', name: 'Troy Hunt', desc: 'Security, HIBP, and web safety', cat: 'HN Top Blogs 2025', url: 'https://www.troyhunt.com/rss/', letter: 'T', bg: '#1a1a1a', fg: '#3b82f6', favicon: 'troyhunt.com' },
  { key: 'herman', name: 'Herman Martinus', desc: 'Indie dev and Bear Blog creator', cat: 'HN Top Blogs 2025', url: 'https://herman.bearblog.dev/feed/', letter: 'H', bg: '#18181b', fg: '#fb923c', favicon: 'herman.bearblog.dev' },
  { key: 'tomrenner', name: 'Tom Renner', desc: 'Engineering and tech', cat: 'HN Top Blogs 2025', url: 'https://tomrenner.com/index.xml', letter: 'T', bg: '#1e293b', fg: '#d6d3d1', favicon: 'tomrenner.com' },
  { key: 'pixelmelt', name: 'PixelMelt', desc: 'Creative coding and projects', cat: 'HN Top Blogs 2025', url: 'https://blog.pixelmelt.dev/rss/', letter: 'P', bg: '#4c1d95', fg: '#c4b5fd', favicon: 'blog.pixelmelt.dev' },
  { key: 'martinalderson', name: 'Martin Alderson', desc: 'Security and tech', cat: 'HN Top Blogs 2025', url: 'https://martinalderson.com/feed.xml', letter: 'M', bg: '#0f172a', fg: '#34d399', favicon: 'martinalderson.com' },
  { key: 'danielhooper', name: 'Daniel Hooper', desc: 'Graphics, shaders, and creative coding', cat: 'HN Top Blogs 2025', url: 'https://danielchasehooper.com/feed.xml', letter: 'D', bg: '#111', fg: '#f97316', favicon: 'danielchasehooper.com' },
  { key: 'sgtatham', name: 'Simon Tatham', desc: 'PuTTY author on puzzles and programming', cat: 'HN Top Blogs 2025', url: 'https://www.chiark.greenend.org.uk/~sgtatham/quasiblog/feed.xml', letter: 'S', bg: '#334155', fg: '#94a3b8', favicon: 'chiark.greenend.org.uk' },
  { key: 'grantslatton', name: 'Grant Slatton', desc: 'Programming and software engineering', cat: 'HN Top Blogs 2025', url: 'https://grantslatton.com/rss.xml', letter: 'G', bg: '#1e293b', fg: '#fbbf24', favicon: 'grantslatton.com' },
  { key: 'experimentalhistory', name: 'Experimental History', desc: 'Science, psychology, and culture', cat: 'HN Top Blogs 2025', url: 'https://www.experimental-history.com/feed', letter: 'E', bg: '#1a1a2e', fg: '#f9a8d4', favicon: 'experimental-history.com' },
  { key: 'anildash', name: 'Anil Dash', desc: 'Tech culture, ethics, and the web', cat: 'HN Top Blogs 2025', url: 'https://anildash.com/feed.xml', letter: 'A', bg: '#18181b', fg: '#60a5fa', favicon: 'anildash.com' },
  { key: 'aresluna', name: 'Marcin Wichary', desc: 'Design, keyboards, and typography', cat: 'HN Top Blogs 2025', url: 'https://aresluna.org/main.rss', letter: 'M', bg: '#1c1917', fg: '#e2e8f0', favicon: 'aresluna.org' },
  { key: 'stapelberg', name: 'Michael Stapelberg', desc: 'Linux, i3wm, and infrastructure', cat: 'HN Top Blogs 2025', url: 'https://michael.stapelberg.ch/feed.xml', letter: 'M', bg: '#1e3a5f', fg: '#4fc3f7', favicon: 'michael.stapelberg.ch' },
  { key: 'miguelgrinberg', name: 'Miguel Grinberg', desc: 'Python, Flask, and web development', cat: 'HN Top Blogs 2025', url: 'https://blog.miguelgrinberg.com/feed', letter: 'M', bg: '#0f172a', fg: '#4ade80', favicon: 'miguelgrinberg.com' },
  { key: 'keygen', name: 'Keygen', desc: 'Software licensing and distribution', cat: 'HN Top Blogs 2025', url: 'https://keygen.sh/blog/feed.xml', letter: 'K', bg: '#111827', fg: '#a78bfa', favicon: 'keygen.sh' },
  { key: 'mjg59', name: 'Matthew Garrett', desc: 'Linux, firmware, and security', cat: 'HN Top Blogs 2025', url: 'https://mjg59.dreamwidth.org/data/rss', letter: 'M', bg: '#374151', fg: '#fb923c', favicon: 'mjg59.dreamwidth.org' },
  { key: 'computerrip', name: 'computer.rip', desc: 'Telecom, networking, and computing history', cat: 'HN Top Blogs 2025', url: 'https://computer.rip/rss.xml', letter: 'C', bg: '#1a1a1a', fg: '#7dd3fc', favicon: 'computer.rip' },
  { key: 'tedunangst', name: 'Ted Unangst', desc: 'OpenBSD and systems programming', cat: 'HN Top Blogs 2025', url: 'https://www.tedunangst.com/flak/rss', letter: 'T', bg: '#1e293b', fg: '#fde68a', favicon: 'tedunangst.com' },
  // Atom Format Feeds
  { key: 'github', name: 'GitHub Blog', desc: 'Developer platform news and features (Atom)', cat: 'Programming', url: 'https://github.blog/feed/', letter: 'G', bg: '#24292e', fg: '#fff', favicon: 'github.com' },
  { key: 'stackoverflow', name: 'Stack Overflow Blog', desc: 'Programming Q&A and developer insights (Atom)', cat: 'Programming', url: 'https://stackoverflow.blog/feed/', letter: 'SO', bg: '#f48024', fg: '#fff', favicon: 'stackoverflow.com' },
  { key: 'reddit-programming', name: 'r/programming', desc: 'Programming subreddit discussions (Atom)', cat: 'Programming', url: 'https://www.reddit.com/r/programming/.rss', letter: 'R', bg: '#ff4500', fg: '#fff', favicon: 'reddit.com' },
  { key: 'reddit-machinelearning', name: 'r/MachineLearning', desc: 'ML research and discussions (Atom)', cat: 'AI & Machine Learning', url: 'https://www.reddit.com/r/MachineLearning/.rss', letter: 'R', bg: '#ff4500', fg: '#fff', favicon: 'reddit.com' },
  { key: 'medium-engineering', name: 'Medium Engineering', desc: 'Engineering blog from Medium (Atom)', cat: 'Programming', url: 'https://medium.engineering/feed', letter: 'M', bg: '#12100e', fg: '#fff', favicon: 'medium.com' },
  { key: 'chromium', name: 'Chromium Blog', desc: 'Chrome and Chromium development (Atom)', cat: 'Programming', url: 'https://blog.chromium.org/feeds/posts/default', letter: 'C', bg: '#4285f4', fg: '#fff', favicon: 'blog.chromium.org' },
  { key: 'android-developers', name: 'Android Developers', desc: 'Official Android development blog (Atom)', cat: 'Programming', url: 'https://android-developers.googleblog.com/feeds/posts/default', letter: 'A', bg: '#3ddc84', fg: '#000', favicon: 'developer.android.com' },
];

function catalogLogo(entry, size) {
  // For inline (card chips), prefer favicon
  if (size === 'inline' && entry.favicon) {
    return `<img class="h-3.5 w-3.5 rounded-sm inline-block" src="https://www.google.com/s2/favicons?domain=${entry.favicon}&sz=32" alt="${entry.name}" onerror="this.style.display='none'" />`;
  }
  if (entry.img) {
    const cls = size === 'onboard' ? 'h-5 w-auto opacity-70'
      : size === 'inline' ? 'h-3.5 w-auto opacity-50 inline-block'
      : 'absolute top-2.5 right-2.5 h-4 w-auto opacity-30';
    return `<img class="${cls}" src="${entry.img}" alt="${entry.name}" />`;
  }
  const cls = size === 'onboard' ? 'h-5 w-auto opacity-70'
    : size === 'inline' ? 'h-3.5 w-auto opacity-50 inline-block'
    : 'absolute top-2.5 right-2.5 h-4 w-auto opacity-40';
  const stroke = entry.stroke ? ` stroke="${entry.stroke}"` : '';
  const font = entry.font || 'Georgia,serif';
  const fs = (entry.letter || '').length > 1 ? 140 : 170;
  return `<svg class="${cls}" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="${entry.bg}"${stroke} width="256" height="256" rx="24"/><text x="128" y="185" text-anchor="middle" fill="${entry.fg}" font-size="${fs}" font-weight="bold" font-family="${font}">${entry.letter}</text></svg>`;
}

const SOURCE_LOGO_INLINE = {};
const SOURCE_NAMES = {};
const FEED_CAT_MAP = {};
FEED_CATALOG.forEach(f => {
  SOURCE_LOGO_INLINE[f.key] = catalogLogo(f, 'inline');
  SOURCE_NAMES[f.key] = f.name;
  FEED_CAT_MAP[f.key] = f.cat;
});
SOURCE_LOGO_INLINE['quote'] = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#6b7280" width="256" height="256" rx="24"/><text x="128" y="185" text-anchor="middle" fill="#fff" font-size="180" font-weight="bold" font-family="Georgia,serif">&quot;</text></svg>';
SOURCE_NAMES['quote'] = 'Quote';

function _isSubstackSource(source) {
  if (!source?.startsWith('custom:')) return false;
  const feeds = typeof getCustomFeeds === 'function' ? getCustomFeeds() : [];
  const name = source.slice(7);
  return feeds.some(f => f.name === name && /substack\.com/i.test(f.url));
}

function getSourceChip(source, arxivId) {
  const isSubstack = _isSubstackSource(source);
  const logo = SOURCE_LOGO_INLINE[source]
    || (isSubstack ? SUBSTACK_LOGO_INLINE : '')
    || (source?.startsWith('custom:') ? RSS_LOGO_INLINE : '')
    || (arxivId ? ARXIV_LOGO_INLINE : '');
  if (!logo) return '';
  const name = SOURCE_NAMES[source]
    || (source?.startsWith('custom:') ? source.slice(7) : '')
    || (arxivId ? 'arXiv' : '');
  return `<span class="inline-flex items-center gap-1">${logo}<span class="text-[0.68rem] text-dim">${name}</span></span>`;
}

// ── View Manager (lazy-load templates) ──
const _viewTemplateCache = {};   // { viewId: htmlString }
const _mountedViews = new Set(); // currently injected view IDs

const VIEW_REGISTRY = {
  'exp-detail-view':     { template: '/views/experiment-detail.html', tier: 2 },
  'dashboard-view':      { template: '/views/dashboard.html', tier: 2 },
  'research-view':       { template: '/views/research.html',  tier: 2 },
  'vault-view':          { template: '/views/vault.html',     tier: 3 },
  'blog-view':           { template: '/views/blog.html',      tier: 2 },
  'settings-view':       { template: '/views/settings.html',  tier: 2 },
  'quality-view':        { template: '/views/quality.html',   tier: 2 },
  'algorithm-view':      { template: '/views/algorithm.html', tier: 2 },
  'inbox-view':          { template: '/views/inbox.html',     tier: 2 },
  'profile-view':        { template: '/views/profile.html',   tier: 2 },
  'author-profile-view': { template: '/views/author-profile.html', tier: 2 },
  'teams-view':          { template: '/views/teams.html',     tier: 2 },
  'neuralook-view':      { template: '/views/neuralook.html', tier: 2 },
  'dev-stats-view':      { template: '/views/dev.html',      tier: 2 },
  'knowledge-graph-view': { template: '/views/knowledge-graph.html', tier: 2 },
};

async function ensureView(viewId) {
  const existing = document.getElementById(viewId);
  if (existing) return existing;
  const config = VIEW_REGISTRY[viewId];
  if (!config) return null;
  if (!_viewTemplateCache[viewId]) {
    const resp = await fetch(config.template);
    _viewTemplateCache[viewId] = await resp.text();
  }
  const div = document.createElement('div');
  div.id = viewId;
  div.className = 'hidden view';
  // Preserve extra styles for specific views
  if (viewId === 'vault-view' || viewId === 'blog-view' || viewId === 'knowledge-graph-view') div.style.height = '100%';
  if (viewId === 'dashboard-view') div.classList.add('overflow-x-hidden');
  div.innerHTML = _viewTemplateCache[viewId];
  document.getElementById('view-mount').appendChild(div);
  _mountedViews.add(viewId);
  return div;
}

function unmountView(viewId) {
  if (!_mountedViews.has(viewId)) return;
  const el = document.getElementById(viewId);
  if (el) el.remove();
  _mountedViews.delete(viewId);
}

function hideAllViews() {
  document.getElementById('home-main').style.display = 'none';
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.classList.add('hidden'); v.style.display = ''; });
  // Unmount Tier 2 views to free DOM
  for (const viewId of [..._mountedViews]) {
    const config = VIEW_REGISTRY[viewId];
    if (config && config.tier === 2) unmountView(viewId);
  }
  // Stop feed refresh timer and any in-flight loading when leaving home
  if (typeof _refreshTimer !== 'undefined' && _refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
  if (typeof stopFeedLoading === 'function') stopFeedLoading();
  if (typeof _stopScrollTracker === 'function') _stopScrollTracker();
  if (typeof _spinnerPreviewInterval !== 'undefined' && _spinnerPreviewInterval) { clearInterval(_spinnerPreviewInterval); _spinnerPreviewInterval = null; }
  if (typeof _setPillBrowseMode === 'function') _setPillBrowseMode(false);
  if (typeof _browseRemoveKeyGuard === 'function') _browseRemoveKeyGuard();
  if (typeof _devFpsRaf !== 'undefined' && _devFpsRaf) { cancelAnimationFrame(_devFpsRaf); _devFpsRaf = null; }
  if (typeof _vaultGitMode !== 'undefined' && _vaultGitMode) { document.removeEventListener('keydown', _vibeKeyHandler); }
  // Hide universal panel (next view's open function will re-show if it has registered tabs)
  const _upanel = document.getElementById('universal-panel');
  if (_upanel) _upanel.style.display = 'none';
  _removePanelMargin();
  _panelActiveView = null;
}

// ── Niri-style Tiling Window Manager ──
let _wmMode = 'fullscreen';   // 'tiling' | 'fullscreen'
let _wmFocusIndex = 0;
let _wmPreviews = {};          // { viewKey: 'data:image/png;base64,...' }

// Capture a preview screenshot of the current view (below the pill bar)
async function _wmCapturePreview() {
  if (!window.electronAPI?.captureScreen) return;
  var key = _wmWindows[_wmFocusIndex]?.key;
  if (!key) return;
  try {
    var pill = document.getElementById('sidebar-nav');
    var top = pill ? pill.offsetTop + pill.offsetHeight : 0;
    var base64 = await window.electronAPI.captureScreen({
      x: 0, y: top, width: window.innerWidth, height: window.innerHeight - top
    });
    if (base64) _wmPreviews[key] = 'data:image/png;base64,' + base64;
  } catch (e) { /* ignore capture failures */ }
}

const _wmViewMeta = {
  dashboard:  { sidebarId: 'sb-dashboard', label: 'Home',       openFn() { openDashboard(); } },
  feed:       { sidebarId: 'sb-home',      label: 'Feed',       openFn() { goHome(); } },
  vault:      { sidebarId: 'sb-vault',     label: 'Vault',      openFn() { openVault(); } },
  browse:     { sidebarId: 'sb-browse',    label: 'Browse',     openFn() { openBrowse(); } },
  inbox:      { sidebarId: 'sb-inbox',     label: 'Inbox',      openFn() { openInbox(); } },
  neuralook:  { sidebarId: 'sb-neuralook', label: 'Neuralook',  openFn() { openNeuralook(); } },
  dev:        { sidebarId: 'sb-dev',       label: 'Dev Stats',  openFn() { openDevStats(); } },
  settings:   { sidebarId: 'sb-settings',  label: 'Settings',   openFn() { openSettings(); } },
  calendar:   { sidebarId: 'sb-dashboard',  label: 'Dashboard',  openFn() { openDashboard(); } },
  graph:      { sidebarId: 'sb-graph',    label: 'Graph',      openFn() { openKnowledgeGraph(); } },
};

// Pre-populate all views (pill bar order)
const _wmDefaultOrder = ['dashboard','feed','vault','browse','neuralook','dev','settings'];
let _wmWindows = _wmDefaultOrder.map(key => ({
  key,
  label: _wmViewMeta[key].label,
  sidebarId: _wmViewMeta[key].sidebarId,
}));

let _wmLastNavTime = 0; // timestamp of last wmOpen navigation
function wmOpen(key) {
  const meta = _wmViewMeta[key];
  if (!meta) return;
  // Dismiss overview if open
  if (typeof _browseTabOverviewVisible !== 'undefined' && _browseTabOverviewVisible && typeof hideBrowseTabOverview === 'function') hideBrowseTabOverview();
  const existIdx = _wmWindows.findIndex(w => w.key === key);
  if (existIdx >= 0 && existIdx === _wmFocusIndex && _wmMode === 'fullscreen') {
    // Skip if this is a re-entrant call from the hash router after a recent navigation
    if (Date.now() - _wmLastNavTime < 500) return;
    // Already on browse NTP — toggle the nowplaying context pill tray
    if (key === 'browse') {
      const activeTab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
        ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
      if (activeTab && activeTab.blank) {
        const npPill = document.querySelector('.pill-island[data-island-id="nowplaying"]');
        if (npPill) { npPill.classList.toggle('island-tray-open'); return; }
      }
    }
    // Already on this view — wiggle the sidebar icon
    const btn = document.getElementById(meta.sidebarId);
    if (btn) {
      Motion.retrigger(btn, 'sb-wiggle', 400);
    }
    setSidebarLoading(meta.sidebarId);
    return;
  }
  _wmCapturePreview();
  if (existIdx >= 0) {
    _wmFocusIndex = existIdx;
  } else {
    _wmWindows.push({ key, label: meta.label, sidebarId: meta.sidebarId });
    _wmFocusIndex = _wmWindows.length - 1;
  }
  _wmLastNavTime = Date.now();
  _invalidateBoundsCache(); // view switch may show/hide tab bars
  _wmActivateWindow(_wmFocusIndex);
}

function _wmActivateWindow(index) {
  if (index < 0 || index >= _wmWindows.length) return;
  _wmFocusIndex = index;
  _wmMode = 'fullscreen';
  const w = _wmWindows[index];
  const meta = _wmViewMeta[w.key];
  if (meta) meta.openFn();
}

function _wmToggleTiling() {
  if (typeof toggleBrowseTabOverview === 'function') toggleBrowseTabOverview();
}

/* ── Drag pill — horizontal drag to switch windows ── */
(function() {
  var STEP = 5; // px per window step
  var _dragStartX = 0;
  var _dragAccum = 0;
  var _previewIdx = -1;
  var _originIdx = -1;
  var _icons = []; // visible sidebar icons for this drag

  function _getVisibleIcons() {
    var nav = document.getElementById('sidebar-nav');
    if (!nav) return [];
    var all = nav.querySelectorAll('.sidebar-icon');
    var visible = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null || all[i].offsetWidth > 0) visible.push(all[i]);
    }
    return visible;
  }
  function _iconToWmIndex(el) {
    var id = el.id;
    for (var i = 0; i < _wmWindows.length; i++) {
      if (_wmWindows[i].sidebarId === id) return i;
    }
    // Settings icon → settings
    if (id === 'sb-settings') {
      for (var j = 0; j < _wmWindows.length; j++) {
        if (_wmWindows[j].key === 'settings') return j;
      }
    }
    return -1;
  }
  function _clearPreview() {
    document.querySelectorAll('.sidebar-icon.drag-preview').forEach(function(el) {
      el.classList.remove('drag-preview');
    });
    _previewIdx = -1;
  }
  function _showPreview(idx) {
    if (idx === _previewIdx) return;
    _clearPreview();
    _previewIdx = idx;
    if (_icons[idx]) _icons[idx].classList.add('drag-preview');
  }
  function _currentIconIdx() {
    for (var i = 0; i < _icons.length; i++) {
      if (_icons[i].classList.contains('active')) return i;
    }
    return 0;
  }

  function onMove(e) {
    var x = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    _dragAccum += x - _dragStartX;
    _dragStartX = x;
    var steps = Math.round(_dragAccum / STEP);
    var target = _originIdx + steps;
    var n = _icons.length;
    if (n > 0) target = ((target % n) + n) % n;
    _showPreview(target);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
    if (_previewIdx >= 0 && _previewIdx !== _originIdx) {
      var targetIcon = _icons[_previewIdx];
      if (targetIcon) {
        var wmIdx = _iconToWmIndex(targetIcon);
        if (wmIdx >= 0) _wmActivateWindow(wmIdx);
        else targetIcon.click();
      }
    }
    _clearPreview();
  }

  function startDrag(x) {
    _dragStartX = x;
    _dragAccum = 0;
    _icons = _getVisibleIcons();
    _originIdx = _currentIconIdx();
    _previewIdx = -1;
  }

  document.addEventListener('DOMContentLoaded', function() {
    var pill = document.getElementById('drag-pill');
    if (!pill) return;
    pill.addEventListener('mousedown', function(e) {
      e.preventDefault();
      startDrag(e.clientX);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    pill.addEventListener('touchstart', function(e) {
      startDrag(e.touches[0].clientX);
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onUp);
    }, { passive: true });
  });
})();

function goHome() {
  const alreadyOnFeed = window.location.hash === '#feed';
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = ''; });
  // Unmount Tier 2 views when going home
  for (const viewId of [..._mountedViews]) {
    const config = VIEW_REGISTRY[viewId];
    if (config && config.tier === 2) unmountView(viewId);
  }
  document.getElementById('home-main').style.display = '';
  window.location.hash = 'feed';
  setSidebarActive('sb-home');
  if (alreadyOnFeed) {
    // Reset source filter pills
    if (typeof hiddenSourceFilters !== 'undefined') hiddenSourceFilters.clear();
    if (typeof renderSourceBubbles === 'function') renderSourceBubbles();
  }
  loadAllFeeds();
}

async function openResearch(tab) {
  if (tab) _researchActiveTab = tab;
  // Open browse and ensure a blank tab is active
  openBrowse();
  const win = typeof _getCurrentWindow === 'function' ? _getCurrentWindow() : null;
  if (win) {
    const blank = win.tabs.find(t => t.blank);
    if (blank) {
      browseSelectTab(blank.id);
    } else {
      browseNewTab();
    }
  }
  switchResearchTab(_researchActiveTab);
}

function switchResearchTab(tab) {
  _researchActiveTab = tab;

  // Update tab buttons
  document.querySelectorAll('.research-tab').forEach(btn => btn.classList.remove('active'));
  if (tab) {
    const activeBtn = document.getElementById('research-tab-' + tab);
    if (activeBtn) activeBtn.classList.add('active');
  }

  // Update panels
  document.querySelectorAll('.research-panel').forEach(panel => panel.style.display = 'none');
  if (tab) {
    const activePanel = document.getElementById('research-panel-' + tab);
    if (activePanel) activePanel.style.display = '';
  }

  // Focus search input on new tab page (always visible)
  const searchInput = document.getElementById('search-query');
  if (searchInput) setTimeout(() => searchInput.focus(), 50);

  // Tab-specific initialization
  if (tab === 'search') {
    // focus already handled above
  } else if (tab === 'users') {
    const input = document.getElementById('user-search-query');
    if (input) setTimeout(() => input.focus(), 50);
    renderResearchUsers();
  } else if (tab === 'teams') {
    renderResearchTeams();
  } else if (tab === 'vault') {
    if (typeof renderNtpVaultPanel === 'function') renderNtpVaultPanel();
  }
}

// User search in Research view
let _userSearchDebounce = null;
async function submitUserSearch() {
  const input = document.getElementById('user-search-query');
  const query = input?.value.trim() || '';
  renderResearchUsers(query);
}

async function renderResearchUsers(query = '') {
  const container = document.getElementById('user-search-results');
  if (!container) return;

  container.innerHTML = '<div class="text-dimmer text-sm">Loading users...</div>';

  try {
    const url = query ? '/api/users?q=' + encodeURIComponent(query) : '/api/users';
    const res = await fetch(url, { headers: _authHeaders() });
    const users = await res.json();

    if (!users.length) {
      container.innerHTML = '<div class="text-dimmer text-sm py-4">No users found</div>';
      return;
    }

    container.innerHTML = `<div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">` +
      users.map(u => {
        const joinDate = u.created ? new Date(u.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '';
        return `<a href="#profile/${encodeURIComponent(u.username)}" class="flex flex-col items-center gap-2 px-4 py-4 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
          ${u.picture
            ? `<img src="${escapeAttr(u.picture)}" class="w-12 h-12 rounded-full" referrerpolicy="no-referrer" />`
            : `<div class="w-12 h-12 rounded-full bg-accent/20 text-accent flex items-center justify-center text-lg font-bold">${escapeHtml((u.username || '?')[0].toUpperCase())}</div>`
          }
          <span class="text-primary text-sm font-medium">${escapeHtml(u.username)}</span>
          ${joinDate ? `<span class="text-dimmer text-[0.7rem]">Joined ${joinDate}</span>` : ''}
        </a>`;
      }).join('') + '</div>';
  } catch (e) {
    container.innerHTML = '<div class="text-dimmer text-sm">Failed to load users</div>';
    console.error('User search error', e);
  }
}

// Legacy functions for compatibility
function openSearch() {
  openResearch('search');
}

function openExperiments() {
  wmOpen('vault');
}

async function openDashboard() {
  hideAllViews();
  const view = await ensureView('dashboard-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = '';
  setSidebarActive('sb-dashboard');
  renderDashboard();
}

async function openDevStats() {
  hideAllViews();
  const view = await ensureView('dev-stats-view');
  view.classList.add('active');
  view.style.display = 'block';
  if (window.location.hash !== '#dev') window.location.hash = '#dev';
  setSidebarActive('sb-dev');
  renderDevPanel();
}

function expGoBack() {
  if (_expBackAction && _expBackAction.fn) {
    _expBackAction.fn();
  } else if (!navBack()) {
    wmOpen('vault');
  }
}

let _expBackAction = null; // stores {fn, label} for context-aware back button
let _prevRouteHash = ''; // the hash before the current route
let _currentRouteHash = ''; // the current route hash

// ── Navigation history stack (survives Cmd+Shift+R via localStorage) ──
let _navHistory = JSON.parse(localStorage.getItem('_navHistory') || '[]');
let _navForward = JSON.parse(localStorage.getItem('_navForward') || '[]');
let _navNavigating = false; // guard to prevent push while navigating back/forward

function _navSave() {
  localStorage.setItem('_navHistory', JSON.stringify(_navHistory));
  localStorage.setItem('_navForward', JSON.stringify(_navForward));
}

function _navPush(hash) {
  if (_navNavigating) return;
  if (!hash || hash === '#') return;
  // Don't push duplicates
  if (_navHistory.length && _navHistory[_navHistory.length - 1] === hash) return;
  _navHistory.push(hash);
  // Cap at 50 entries
  if (_navHistory.length > 50) _navHistory = _navHistory.slice(-50);
  // Clear forward stack on new navigation
  _navForward = [];
  _navSave();
}

function navBack() {
  if (_navHistory.length <= 1) return false;
  _navNavigating = true;
  const current = _navHistory.pop();
  _navForward.push(current);
  const prev = _navHistory[_navHistory.length - 1];
  _navSave();
  window.location.hash = prev;
  _navNavigating = false;
  return true;
}

async function openExperimentDetail(id, e) {
  // Redirect through vault — open vault and expand the project folder
  wmOpen('vault');
  window.location.hash = 'experiment/' + encodeURIComponent(id);
  setSidebarActive('sb-vault');
  setTimeout(() => {
    if (typeof vaultExpandProject === 'function') vaultExpandProject(id);
  }, 300);
}

// ── Universal Side Panel ──
let _panelRegistry = {};
let _panelVisible = localStorage.getItem('universalPanelVisible') !== 'false'; // default true
let _panelActiveView = null;
let _panelActiveTab = null;
let _panelWidth = parseInt(localStorage.getItem('universalPanelWidth') || '280', 10);
let _panelScrollPositions = {};
let _panelRenderedViews = {};

function registerPanelTabs(viewKey, config) {
  _panelRegistry[viewKey] = config;
}

function showPanelForView(viewKey) {
  const reg = _panelRegistry[viewKey];
  if (!reg || !reg.tabs || !reg.tabs.length) { hidePanel(); return; }
  const viewChanged = _panelActiveView !== viewKey;
  _panelActiveView = viewKey;
  const panel = document.getElementById('universal-panel');
  const tabBar = document.getElementById('universal-panel-tabs');
  const headerEl = document.getElementById('universal-panel-header');
  if (!panel || !tabBar) return;

  // Render header slot
  if (headerEl) {
    headerEl.innerHTML = '';
    if (reg.header) {
      reg.header(headerEl);
    }
  }

  // Render tab buttons
  tabBar.innerHTML = reg.tabs.map(t =>
    `<button class="universal-panel-tab-btn${_panelActiveTab === t.id ? ' active' : ''}" data-tab-id="${t.id}" onclick="switchPanelTab('${t.id}')" title="${t.label}">${t.icon ? t.icon : ''}<span class="panel-tab-label">${t.label}</span></button>`
  ).join('');

  // For renderAll mode, render all panes once
  const container = document.getElementById('universal-panel-content');
  if (reg.renderAll && container) {
    if (viewChanged || !_panelRenderedViews[viewKey]) {
      container.innerHTML = '';
      reg.renderContent(container);
      _panelRenderedViews[viewKey] = true;
    }
  }

  // Select default tab
  const defaultTab = reg.tabs.find(t => t.id === _panelActiveTab) ? _panelActiveTab : reg.tabs[0].id;
  switchPanelTab(defaultTab);

  if (_panelVisible) {
    panel.style.display = 'flex';
    panel.style.width = _panelWidth + 'px';
    _applyPanelMargin();
    requestAnimationFrame(() => _panelCheckTabOverflow());
  }
}

function hidePanel() {
  const panel = document.getElementById('universal-panel');
  if (panel) panel.style.display = 'none';
  _removePanelMargin();
  if (_panelActiveView && _panelRegistry[_panelActiveView]?.onHide) {
    _panelRegistry[_panelActiveView].onHide();
  }
  _panelActiveView = null;
}

function togglePanel() {
  _panelVisible = !_panelVisible;
  localStorage.setItem('universalPanelVisible', _panelVisible ? 'true' : 'false');
  if (_panelVisible && _panelActiveView) {
    showPanelForView(_panelActiveView);
  } else {
    const panel = document.getElementById('universal-panel');
    if (panel) panel.style.display = 'none';
    _removePanelMargin();
  }
}

function switchPanelTab(tabId) {
  const reg = _panelRegistry[_panelActiveView];
  if (!reg) return;
  const tab = reg.tabs.find(t => t.id === tabId);
  if (!tab) return;
  const oldTab = _panelActiveTab;
  _panelActiveTab = tabId;

  // Update tab button active states
  document.querySelectorAll('#universal-panel-tabs .universal-panel-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tabId === tabId);
  });

  const container = document.getElementById('universal-panel-content');
  if (!container) return;

  if (reg.renderAll) {
    // Save scroll position of outgoing pane
    if (oldTab && oldTab !== tabId) {
      const oldPane = container.querySelector('[data-pane-id="' + oldTab + '"]');
      if (oldPane) _panelScrollPositions[oldTab] = oldPane.scrollTop;
    }
    // Show/hide panes by data-pane-id
    container.querySelectorAll('[data-pane-id]').forEach(pane => {
      pane.style.display = pane.dataset.paneId === tabId ? '' : 'none';
    });
    // Restore scroll position
    const newPane = container.querySelector('[data-pane-id="' + tabId + '"]');
    if (newPane && _panelScrollPositions[tabId] !== undefined) {
      setTimeout(() => { newPane.scrollTop = _panelScrollPositions[tabId]; }, 0);
    }
    // Notify tab switch callback
    if (reg.onTabSwitch) reg.onTabSwitch(oldTab, tabId);
  } else {
    container.innerHTML = '';
    tab.render(container);
  }
}

function _panelCheckTabOverflow() {
  const tabBar = document.getElementById('universal-panel-tabs');
  if (!tabBar) return;
  tabBar.classList.remove('icons-only');
  // If tabs overflow, collapse to icons only
  if (tabBar.scrollWidth > tabBar.clientWidth) {
    tabBar.classList.add('icons-only');
  }
}

function _applyPanelMargin() {
  // Set margin-right on the active view element
  const vaultView = document.getElementById('vault-view');
  if (vaultView && vaultView.style.display !== 'none') {
    vaultView.style.marginRight = _panelWidth + 'px';
  }
  // home-main
  const homeMain = document.getElementById('home-main');
  if (homeMain && homeMain.style.display !== 'none') {
    homeMain.style.marginRight = _panelWidth + 'px';
  }
  // browse-content
  const browseContent = document.getElementById('browse-content');
  if (browseContent && browseContent.offsetParent) {
    browseContent.style.marginRight = _panelWidth + 'px';
  }
}

function _removePanelMargin() {
  document.querySelectorAll('.view, #home-main').forEach(el => {
    el.style.marginRight = '';
  });
  // Also handle vault-view specifically
  const vaultView = document.getElementById('vault-view');
  if (vaultView) vaultView.style.marginRight = '';
  // browse-content
  const browseContent = document.getElementById('browse-content');
  if (browseContent) browseContent.style.marginRight = '';
}

function _invalidatePanelRender(viewKey) {
  delete _panelRenderedViews[viewKey];
  _panelScrollPositions = {};
}

function _initPanelResize() {
  const handle = document.getElementById('universal-panel-resize');
  const panel = document.getElementById('universal-panel');
  if (!handle || !panel) return;
  let startX, startW;
  function onMouseMove(e) {
    const newW = Math.max(200, Math.min(700, startW + (startX - e.clientX)));
    _panelWidth = newW;
    panel.style.width = newW + 'px';
    _applyPanelMargin();
    _panelCheckTabOverflow();
  }
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.userSelect = '';
    localStorage.setItem('universalPanelWidth', String(_panelWidth));
  }
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = panel.offsetWidth;
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// Init resize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initPanelResize);
} else {
  _initPanelResize();
}

// Global Cmd+[/] shortcuts — browse back/forward when in browse, panel toggle otherwise
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const browseView = document.getElementById('browse-view');
  const browseVisible = browseView && browseView.style.display !== 'none';
  if (e.key === '[') {
    e.preventDefault();
    if (browseVisible && typeof browseBack === 'function') browseBack();
  } else if (e.key === ']') {
    e.preventDefault();
    if (browseVisible && typeof browseForward === 'function') browseForward();
    else togglePanel();
  }
});

// ── Route table — exact hash → action ──
var _ROUTE_TABLE = {
  '#research':    () => { openResearch(); },
  '#experiments': () => wmOpen('vault'),
  '#settings':    () => wmOpen('settings'),
  '#quality':     () => { _settingsSection = 'feed'; _settingsFeedTab = 'quality'; sessionStorage.setItem('settingsSection', 'feed'); wmOpen('settings'); },
  '#algorithm':   () => { _settingsSection = 'feed'; _settingsFeedTab = 'algorithm'; sessionStorage.setItem('settingsSection', 'feed'); wmOpen('settings'); },
  '#calendar':    () => wmOpen('dashboard'),
  '#inbox':       () => wmOpen('inbox'),
  '#teams':       () => openTeams(),
  '#vault':       () => wmOpen('vault'),
  '#profile':     () => openUserProfile(''),
  '#saved-all':   () => openAllSaved(),
  '#saved':       () => wmOpen('dashboard'),
  '#browse':      () => wmOpen('browse'),
  '#search':      () => { openResearch('search'); },
  '#terminal':    () => { openTerminal(); },
  '#neuralook':   () => wmOpen('neuralook'),
  '#dev':         () => wmOpen('dev'),
  '#graph':       () => wmOpen('graph'),
  '#vibe':        () => wmOpen('vault'),
  '#feed':        () => wmOpen('feed'),
};

// ── Prefix route handlers — hash prefix → handler(remainder) ──
var _ROUTE_PREFIX_HANDLERS = [
  ['#blog/',       (rest) => { const parts = rest.split('/'); if (parts.length >= 2) { const username = decodeURIComponent(parts[0]); const slug = decodeURIComponent(parts.slice(1).join('/')); if (typeof openBlogPost === 'function') openBlogPost(username, slug); } }],
  ['#team/',       (rest) => { const teamId = parseInt(rest, 10); if (teamId && typeof showTeamDetailView === 'function') showTeamDetailView(teamId); }],
  ['#profile/',    (rest) => openUserProfile(decodeURIComponent(rest))],
  ['#experiment/', (rest) => { const qIdx = rest.indexOf('?'); const expId = qIdx >= 0 ? decodeURIComponent(rest.slice(0, qIdx)) : decodeURIComponent(rest); const params = qIdx >= 0 ? new URLSearchParams(rest.slice(qIdx)) : null; const autoFile = params && params.get('file'); wmOpen('vault'); setTimeout(() => { if (typeof vaultExpandProject === 'function') vaultExpandProject(expId); if (autoFile && typeof vaultOpenProjectFile === 'function') vaultOpenProjectFile(expId, decodeURIComponent(autoFile)); }, 300); }],
];

function routeFromHash() {
  const hash = window.location.hash;
  const _oldHash = _currentRouteHash || '';
  _currentRouteHash = hash;
  _prevRouteHash = _oldHash;
  _navPush(hash);

  // Exact match
  const exactHandler = _ROUTE_TABLE[hash];
  if (exactHandler) { exactHandler(); return; }

  // Prefix match
  for (let i = 0; i < _ROUTE_PREFIX_HANDLERS.length; i++) {
    const [prefix, handler] = _ROUTE_PREFIX_HANDLERS[i];
    if (hash.startsWith(prefix)) { handler(hash.slice(prefix.length)); return; }
  }

  // Default
  wmOpen('dashboard');
}

// Save hash to localStorage for "remember where we left off"
window.addEventListener('hashchange', () => {
  const hash = window.location.hash;
  if (hash && hash !== '#') {
    localStorage.setItem('lastHash', hash);
  }
  routeFromHash();
  _updateNowPlayingContext();
});

// On page load, restore last hash if no hash specified
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.location.hash || window.location.hash === '#') {
      const lastHash = localStorage.getItem('lastHash');
      if (lastHash) {
        window.location.hash = lastHash;
        return;
      }
    }
    routeFromHash();
    _updateNowPlayingContext();
  });
} else {
  setTimeout(() => {
    if (!window.location.hash || window.location.hash === '#') {
      const lastHash = localStorage.getItem('lastHash');
      if (lastHash) {
        window.location.hash = lastHash;
        return;
      }
    }
    routeFromHash();
    _updateNowPlayingContext();
  }, 0);
}

// ── User Profile ──

async function openUserProfile(username) {
  hideAllViews();
  const view = await ensureView('profile-view');
  view.classList.add('active');
  view.style.display = 'block';
  if (username) {
    window.location.hash = 'profile/' + encodeURIComponent(username);
  } else {
    window.location.hash = 'profile';
  }
  setSidebarActive(username ? '' : 'sb-people');
  renderUserProfile(username);
}

async function renderUserProfile(username) {
  const el = document.getElementById('profile-content');
  if (!el) return;

  // No username → search/browse mode
  if (!username) {
    el.innerHTML = `
      <h2 class="text-[1.3rem] font-semibold text-white_ mb-5">Find a user</h2>
      <input type="text" id="profile-search-input" placeholder="Search by username..." class="w-full bg-input border border-border-input rounded-lg px-4 py-2.5 text-primary text-sm outline-none focus:border-accent mb-4">
      <div id="profile-search-results"></div>
      <div id="profile-all-users"></div>
    `;

    function renderUserGrid(container, users) {
      if (!users.length) { container.innerHTML = '<div class="text-dimmer text-sm">No users yet</div>'; return; }
      container.innerHTML = `<div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">` +
        users.map(u => {
          const joinDate = u.created ? new Date(u.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '';
          return `<a href="#profile/${encodeURIComponent(u.username)}" class="flex flex-col items-center gap-2 px-4 py-4 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            ${u.picture
              ? `<img src="${escapeAttr(u.picture)}" class="w-12 h-12 rounded-full" referrerpolicy="no-referrer" />`
              : `<div class="w-12 h-12 rounded-full bg-accent/20 text-accent flex items-center justify-center text-lg font-bold">${escapeHtml((u.username || '?')[0].toUpperCase())}</div>`
            }
            <span class="text-primary text-sm font-medium">${escapeHtml(u.username)}</span>
            ${joinDate ? `<span class="text-dimmer text-[0.7rem]">Joined ${joinDate}</span>` : ''}
          </a>`;
        }).join('') + '</div>';
    }

    // Load all users immediately
    const allUsersEl = document.getElementById('profile-all-users');
    allUsersEl.innerHTML = '<div class="text-dimmer text-sm">Loading users...</div>';
    try {
      const res = await fetch('/api/users', { headers: _authHeaders() });
      const users = await res.json();
      renderUserGrid(allUsersEl, users);
    } catch (e) {
      allUsersEl.innerHTML = '<div class="text-dimmer text-sm">Failed to load users</div>';
      console.error('Load users error', e);
    }

    const input = document.getElementById('profile-search-input');
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const q = input.value.trim();
        const results = document.getElementById('profile-search-results');
        const allUsers = document.getElementById('profile-all-users');
        if (!q) {
          results.innerHTML = '';
          allUsers.style.display = '';
          return;
        }
        allUsers.style.display = 'none';
        try {
          const res = await fetch('/api/users?q=' + encodeURIComponent(q), { headers: _authHeaders() });
          const users = await res.json();
          if (!users.length) { results.innerHTML = '<div class="text-dimmer text-sm">No users found</div>'; return; }
          results.innerHTML = users.map(u => `
            <a href="#profile/${encodeURIComponent(u.username)}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-hover transition-colors" style="text-decoration:none">
              ${u.picture
                ? `<img src="${escapeAttr(u.picture)}" class="w-8 h-8 rounded-full" referrerpolicy="no-referrer" />`
                : `<div class="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold">${escapeHtml((u.username || '?')[0].toUpperCase())}</div>`
              }
              <span class="text-primary text-sm font-medium">${escapeHtml(u.username)}</span>
            </a>
          `).join('');
        } catch (e) { console.error('User search error', e); }
      }, 300);
    });
    setTimeout(() => input.focus(), 50);
    return;
  }

  // Loading state
  el.innerHTML = '<div class="text-dimmer text-sm mt-8 text-center">Loading profile...</div>';

  try {
    const [profileRes, commentsRes, experimentsRes, teamsRes, repostsRes, feedsRes, blogRes, achievementsRes] = await Promise.all([
      fetch('/api/users/' + encodeURIComponent(username), { headers: _authHeaders() }),
      fetch('/api/users/' + encodeURIComponent(username) + '/comments', { headers: _authHeaders() }),
      fetch('/api/users/' + encodeURIComponent(username) + '/experiments', { headers: _authHeaders() }),
      fetch('/api/users/' + encodeURIComponent(username) + '/teams', { headers: _authHeaders() }),
      fetch('/api/users/' + encodeURIComponent(username) + '/reposts', { headers: _authHeaders() }),
      fetch('/api/users/' + encodeURIComponent(username) + '/feeds', { headers: _authHeaders() }),
      fetch('/api/blog/' + encodeURIComponent(username)),
      fetch('/api/achievements/' + encodeURIComponent(username)),
    ]);

    if (!profileRes.ok) {
      el.innerHTML = '<div class="text-dimmer text-sm mt-8 text-center">User not found</div>';
      return;
    }

    const profile = await profileRes.json();
    const comments = await commentsRes.json();
    const experiments = await experimentsRes.json();
    const teams = teamsRes.ok ? await teamsRes.json() : [];
    const reposts = repostsRes.ok ? await repostsRes.json() : [];
    const feedsData = feedsRes.ok ? await feedsRes.json() : { catalogFeeds: [], customFeeds: [] };
    const blogData = blogRes.ok ? await blogRes.json() : { posts: [] };
    const blogPosts = blogData.posts || [];
    const achievementsData = achievementsRes.ok ? await achievementsRes.json() : { achievements: [] };
    const achievements = achievementsData.achievements || [];

    // Handle private profiles
    if (profile.profile_private) {
      el.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16">
          ${profile.picture
            ? `<img src="${escapeAttr(profile.picture)}" class="w-20 h-20 rounded-full mb-4 opacity-60" referrerpolicy="no-referrer" />`
            : `<div class="w-20 h-20 rounded-full bg-accent/10 text-accent/40 flex items-center justify-center text-3xl font-bold mb-4">${escapeHtml((profile.username || '?')[0].toUpperCase())}</div>`
          }
          <div class="flex items-center gap-2 mb-2">
            <h2 class="text-[1.2rem] font-semibold text-white_">${escapeHtml(profile.username)}</h2>
          </div>
          <div class="flex items-center gap-1.5 text-dimmer text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            This profile is private
          </div>
        </div>`;
      return;
    }

    const joinDate = profile.created ? new Date(profile.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : '';
    const isOwnProfile = _authUserInfo && _authUserInfo.username === profile.username;
    const accentColor = profile.accent_color || '#b4451a';

    let html = `
      <div class="relative rounded-xl overflow-hidden mb-6" style="min-height:120px; ${profile.profile_bg ? `background:url('${escapeAttr(profile.profile_bg)}') center/cover no-repeat` : `background:linear-gradient(135deg, ${accentColor}33, ${accentColor}11)`}">
        <div style="position:absolute;bottom:0;left:0;right:0;height:60px;background:linear-gradient(to top,var(--bg-body),transparent)"></div>
        ${isOwnProfile ? `<button onclick="_uploadProfileBg()" class="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center bg-black/40 text-white/70 hover:text-white border-none cursor-pointer transition-colors" title="Change background">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>` : ''}
      </div>
      <div class="flex items-center gap-4 mb-6 -mt-12 relative z-10 px-2">
        <div class="relative group">
          ${profile.picture
            ? `<img src="${escapeAttr(profile.picture)}" class="w-16 h-16 rounded-full border-[3px]" style="border-color:var(--bg-body)" referrerpolicy="no-referrer" />`
            : `<div class="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold border-[3px]" style="border-color:var(--bg-body);background:${accentColor}33;color:${accentColor}">${escapeHtml((profile.username || '?')[0].toUpperCase())}</div>`
          }
          ${isOwnProfile ? `<button onclick="_uploadProfilePic()" class="absolute inset-0 w-full h-full rounded-full bg-black/0 hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-none" title="Change picture">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>` : ''}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-[1.3rem] font-semibold text-white_">${escapeHtml(profile.username)}</h2>
            ${(() => {
              const isOnline = profile.last_seen && (Date.now() / 1000 - profile.last_seen) < 300;
              const dotColor = isOnline ? '#22c55e' : '#6b7280';
              const dotTitle = isOnline ? 'Online' : 'Offline';
              const shadow = isOnline ? 'box-shadow:0 0 4px #22c55e80' : '';
              return `<div class="w-2.5 h-2.5 rounded-full" style="background:${dotColor};${shadow}" title="${dotTitle}"></div>`;
            })()}
          </div>
          ${profile.status_emoji || profile.status_text ? `<div class="flex items-center gap-1.5 mt-1">
            ${profile.status_emoji ? `<canvas class="profile-status-pet shrink-0" width="18" height="18" data-type="${escapeAttr(profile.status_emoji)}" style="image-rendering:pixelated"></canvas>` : ''}
            ${profile.status_text ? `<span class="text-dim text-[0.78rem]">${escapeHtml(profile.status_text)}</span>` : ''}
          </div>` : ''}
          ${joinDate ? `<div class="text-dimmer text-[0.78rem] mt-0.5">Joined ${joinDate}</div>` : ''}
        </div>
        <div class="ml-auto flex items-center gap-2">
          ${isOwnProfile ? `<button onclick="openSettings()" class="w-8 h-8 rounded-lg flex items-center justify-center bg-transparent border border-border-card text-dim hover:text-primary hover:border-accent/40 cursor-pointer transition-colors" title="Settings"><svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg></button>` : `<button onclick="showProfileMessageForm('${escapeAttr(profile.username)}')" class="px-3 py-1 rounded-md text-[0.78rem] bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors">Message</button>`}
        </div>
      </div>
      <div id="profile-message-form" class="hidden mb-6"></div>

      <div class="flex gap-6 mb-8 text-[0.82rem]">
        ${blogPosts.length ? `<a href="#profile-section-posts" onclick="document.getElementById('profile-section-posts')?.scrollIntoView({behavior:'smooth'});return false" class="hover:text-accent cursor-pointer" style="text-decoration:none"><span class="text-white_ font-semibold">${blogPosts.length}</span> <span class="text-dimmer">posts</span></a>` : ''}
        ${comments.length ? `<a href="#profile-section-comments" onclick="document.getElementById('profile-section-comments')?.scrollIntoView({behavior:'smooth'});return false" class="hover:text-accent cursor-pointer" style="text-decoration:none"><span class="text-white_ font-semibold">${comments.length}</span> <span class="text-dimmer">comments</span></a>` : `<div><span class="text-white_ font-semibold">0</span> <span class="text-dimmer">comments</span></div>`}
        ${reposts.length ? `<a href="#profile-section-reposts" onclick="document.getElementById('profile-section-reposts')?.scrollIntoView({behavior:'smooth'});return false" class="hover:text-accent cursor-pointer" style="text-decoration:none"><span class="text-white_ font-semibold">${reposts.length}</span> <span class="text-dimmer">reposts</span></a>` : `<div><span class="text-white_ font-semibold">0</span> <span class="text-dimmer">reposts</span></div>`}
        ${teams.filter(t => !t.private).length ? `<a href="#profile-section-teams" onclick="document.getElementById('profile-section-teams')?.scrollIntoView({behavior:'smooth'});return false" class="hover:text-accent cursor-pointer" style="text-decoration:none"><span class="text-white_ font-semibold">${teams.filter(t => !t.private).length}</span> <span class="text-dimmer">teams</span></a>` : `<div><span class="text-white_ font-semibold">0</span> <span class="text-dimmer">teams</span></div>`}
        ${experiments.length ? `<a href="#profile-section-projects" onclick="document.getElementById('profile-section-projects')?.scrollIntoView({behavior:'smooth'});return false" class="hover:text-accent cursor-pointer" style="text-decoration:none"><span class="text-white_ font-semibold">${experiments.length}</span> <span class="text-dimmer">projects</span></a>` : `<div><span class="text-white_ font-semibold">0</span> <span class="text-dimmer">projects</span></div>`}
      </div>
    `;

    // Achievements section
    if (achievements.length) {
      html += `<div class="mb-8" id="profile-section-achievements">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Achievements</h3>
        <div class="flex flex-wrap gap-2">`;
      for (const ach of achievements) {
        const unlockedDate = ach.unlocked_at ? new Date(ach.unlocked_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        html += `
          <div class="inline-flex items-center gap-3 px-4 py-2.5 rounded-lg border border-accent/30 bg-accent/5" title="${escapeAttr(ach.description)}${unlockedDate ? ' · Unlocked ' + unlockedDate : ''}">
            <div class="achievement-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-4.27 1.772 6.003 6.003 0 01-4.27-1.772"/>
              </svg>
            </div>
            <div>
              <div class="text-primary text-sm font-medium">${escapeHtml(ach.name)}</div>
              <div class="text-dimmer text-[0.7rem]">${escapeHtml(ach.description)}</div>
            </div>
          </div>`;
      }
      html += '</div></div>';
    }

    // Blog posts section
    if (blogPosts.length) {
      html += `<div class="mb-8" id="profile-section-posts">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Blog Posts</h3>
        <div class="flex flex-col gap-2">`;
      for (const post of blogPosts) {
        const pubDate = post.published_at ? new Date(post.published_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        html += `
          <a href="#blog/${encodeURIComponent(username)}/${encodeURIComponent(post.slug)}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"/></svg>
              <div class="text-primary text-sm font-medium">${escapeHtml(post.title)}</div>
            </div>
            ${pubDate ? `<div class="text-dimmer text-[0.7rem] mt-1">${pubDate}</div>` : ''}
          </a>`;
      }
      html += '</div></div>';
    }

    // Shared experiments section
    if (experiments.length) {
      html += `<div class="mb-8" id="profile-section-projects">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Shared Projects</h3>
        <div class="flex flex-col gap-2">`;
      for (const exp of experiments) {
        html += `
          <a href="#experiment/${exp.id}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="text-primary text-sm font-medium">${escapeHtml(exp.title || exp.id)}</div>
            ${exp.desc ? `<div class="text-dimmer text-[0.75rem] mt-1 line-clamp-1">${escapeHtml(exp.desc)}</div>` : ''}
          </a>`;
      }
      html += '</div></div>';
    }

    // Teams section (exclude private teams from public profile)
    const publicTeams = teams.filter(t => !t.private);
    if (publicTeams.length) {
      html += `<div class="mb-8" id="profile-section-teams">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Teams</h3>
        <div class="flex flex-col gap-2">`;
      for (const t of publicTeams) {
        html += `
          <div class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors cursor-pointer" style="text-decoration:none" onclick="showTeamDetailView(${t.id}, event)">
            <div class="text-primary text-sm font-medium">${escapeHtml(t.name)}</div>
            <div class="text-dimmer text-[0.75rem] mt-1">${t.member_count} member${t.member_count !== 1 ? 's' : ''}</div>
          </div>`;
      }
      html += '</div></div>';
    }

    // Feeds section
    const catalogFeeds = feedsData.catalogFeeds || [];
    const customFeeds = feedsData.customFeeds || [];
    if (catalogFeeds.length || customFeeds.length) {
      const myFeedSources = typeof getFeedSources === 'function' ? getFeedSources() : {};
      html += `<div class="mb-8">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Feeds</h3>
        <div class="flex flex-wrap gap-2">`;
      for (const key of catalogFeeds) {
        const chip = getSourceChip(key);
        const subscribed = !!myFeedSources[key];
        if (chip) {
          html += `<div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-card bg-card text-sm">${chip}`;
          if (!subscribed) {
            html += ` <button onclick="window._profileSubscribeFeed('${escapeHtml(key)}', this)" class="text-[0.65rem] text-accent hover:underline ml-1">+ Subscribe</button>`;
          }
          html += '</div>';
        } else {
          const entry = FEED_CATALOG.find(f => f.key === key);
          const name = entry ? entry.name : key;
          html += `<div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-card bg-card text-sm text-primary">${escapeHtml(name)}`;
          if (!subscribed) {
            html += ` <button onclick="window._profileSubscribeFeed('${escapeHtml(key)}', this)" class="text-[0.65rem] text-accent hover:underline ml-1">+ Subscribe</button>`;
          }
          html += '</div>';
        }
      }
      for (const cf of customFeeds) {
        html += `<div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-card bg-card text-sm text-primary">${escapeHtml(cf.name || cf.url)}</div>`;
      }
      html += '</div></div>';
    }

    // Recent comments section
    if (comments.length) {
      html += `<div class="mb-8" id="profile-section-comments">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Recent Comments</h3>
        <div class="flex flex-col gap-2">`;
      for (const c of comments) {
        const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(c.timestamp) : '';
        const contentPreview = (c.content || '').length > 120 ? c.content.slice(0, 120) + '...' : c.content;
        html += `
          <a href="#paper/${encodeURIComponent(c.paperLink)}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="text-[0.78rem] text-primary leading-relaxed">${escapeHtml(contentPreview)}</div>
            <div class="text-dimmer text-[0.7rem] mt-1">${timeAgo}</div>
          </a>`;
      }
      html += '</div></div>';
    }

    // Reposts section
    if (reposts.length) {
      html += `<div class="mb-8" id="profile-section-reposts">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Reposts</h3>
        <div class="flex flex-col gap-2">`;
      for (const r of reposts) {
        const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(r.timestamp) : '';
        const hostname = (() => { try { return new URL(r.paperLink).hostname.replace(/^www\./, ''); } catch { return ''; } })();
        html += `
          <a href="#view/${encodeURIComponent(r.paperLink)}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="flex items-center gap-2">
              <svg class="w-3.5 h-3.5 text-green-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
              <div class="text-[0.78rem] text-primary leading-relaxed truncate">${escapeHtml(r.paperTitle || r.paperLink)}</div>
            </div>
            <div class="text-dimmer text-[0.7rem] mt-1">${hostname ? escapeHtml(hostname) + ' · ' : ''}${timeAgo}</div>
          </a>`;
      }
      html += '</div></div>';
    }

    if (!experiments.length && !comments.length && !teams.length && !reposts.length && !catalogFeeds.length && !customFeeds.length) {
      html += '<div class="text-dimmer text-sm mt-4">No shared activity yet.</div>';
    }

    el.innerHTML = html;

    // Render status pet thumbnails
    if (typeof _renderPetThumb === 'function') {
      el.querySelectorAll('.profile-status-pet').forEach(c => {
        const thumb = _renderPetThumb(c.dataset.type, 18);
        if (thumb) c.getContext('2d').drawImage(thumb, 0, 0);
      });
    }
  } catch (e) {
    console.error('Profile load error', e);
    el.innerHTML = '<div class="text-dimmer text-sm mt-8 text-center">Failed to load profile</div>';
  }
}

window._profileSubscribeFeed = function(key, btn) {
  const sources = typeof getFeedSources === 'function' ? getFeedSources() : {};
  sources[key] = true;
  localStorage.setItem('feedSources', JSON.stringify(sources));
  if (typeof syncToServer === 'function') syncToServer();
  btn.replaceWith(Object.assign(document.createElement('span'), {
    className: 'text-[0.65rem] text-green-400 ml-1',
    textContent: 'Subscribed'
  }));
};

function showProfileMessageForm(username) {
  const el = document.getElementById('profile-message-form');
  if (!el) return;
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="p-4 rounded-lg border border-border-card bg-card">
      <textarea id="profile-msg-textarea" class="w-full text-[0.82rem] bg-input border border-border-input rounded-lg px-3 py-2 text-primary resize-none outline-none focus:border-accent" rows="3" placeholder="Write a message to ${escapeHtml(username)}..."></textarea>
      <div class="flex items-center gap-2 mt-2">
        <button onclick="sendProfileMessage('${escapeAttr(username)}')" class="px-3 py-1 rounded-md text-[0.78rem] bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors">Send</button>
        <button onclick="document.getElementById('profile-message-form').classList.add('hidden')" class="px-3 py-1 rounded-md text-[0.78rem] border border-border-input text-muted bg-transparent cursor-pointer hover:text-primary transition-colors">Cancel</button>
        <span id="profile-msg-status" class="text-[0.75rem] ml-2"></span>
      </div>
    </div>
  `;
  setTimeout(() => document.getElementById('profile-msg-textarea')?.focus(), 50);
}

async function sendProfileMessage(username) {
  const textarea = document.getElementById('profile-msg-textarea');
  const status = document.getElementById('profile-msg-status');
  const content = (textarea?.value || '').trim();
  if (!content) return;
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ to_username: username, content })
    });
    const data = await res.json();
    if (data.error) {
      if (status) { status.style.color = 'var(--text-muted)'; status.textContent = data.error; }
    } else {
      if (status) { status.style.color = 'var(--accent)'; status.textContent = 'Message sent!'; }
      textarea.value = '';
      setTimeout(() => document.getElementById('profile-message-form')?.classList.add('hidden'), 1500);
    }
  } catch (err) {
    if (status) { status.style.color = 'var(--text-muted)'; status.textContent = 'Failed to send'; }
  }
}

function _uploadProfilePic() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/users/me/picture', {
          method: 'PUT',
          headers: _authHeaders(),
          body: JSON.stringify({ image: reader.result })
        });
        const data = await res.json();
        if (data.picture) {
          if (_authUserInfo) _authUserInfo.picture = data.picture;
          const hash = window.location.hash;
          if (hash.startsWith('#profile')) renderUserProfile(_authUserInfo?.username);
          if (hash === '#settings' && typeof renderSettingsView === 'function') renderSettingsView();
        }
      } catch (e) { console.error('Picture upload error', e); }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function _uploadProfileBg() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/users/me/background', {
          method: 'PUT',
          headers: _authHeaders(),
          body: JSON.stringify({ image: reader.result })
        });
        const data = await res.json();
        if (data.profile_bg) {
          renderUserProfile(_authUserInfo?.username);
        }
      } catch (e) { console.error('Background upload error', e); }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ── Greeting system ──
function getGreeting() {
  const name = (_authUserInfo && (_authUserInfo.name || '').split(' ')[0]) || localStorage.getItem('userName') || '';
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  const n = (s) => name ? `${s}, ${name}` : s;
  const nQ = (s) => name ? `${s}, ${name}?` : `${s}?`;

  const timeGreetings = hour < 5
    ? [n('Hello, night owl')]
    : hour < 12
    ? [n('Good morning')]
    : hour < 17
    ? [n('Good afternoon')]
    : hour < 21
    ? [n('Good evening')]
    : [n('Evening')];

  const dayGreetings = [];
  if (day === 0) { dayGreetings.push(n('Happy Sunday')); dayGreetings.push(name ? `Sunday session, ${name}?` : 'Sunday session'); }
  if (day === 1) dayGreetings.push(n('Happy Monday'));
  if (day === 2) dayGreetings.push(n('Happy Tuesday'));
  if (day === 3) dayGreetings.push(n('Happy Wednesday'));
  if (day === 4) dayGreetings.push(n('Happy Thursday'));
  if (day === 5) { dayGreetings.push(n('Happy Friday')); dayGreetings.push(n('That Friday feeling')); }
  if (day === 6) { dayGreetings.push(n('Happy Saturday')); dayGreetings.push(n('Welcome to the weekend')); }

  const casual = [
    n('Hey there'), nQ("How's it going"), n('Back at it'),
    nQ("What's new"), n('Welcome'),
  ];
  if (name) casual.push(`${name} returns!`);

  const all = [...timeGreetings, ...dayGreetings, ...casual];
  return all[Math.floor(Math.random() * all.length)];
}

// ── Utilities ──
function formatDate(d) {
  if (!d) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (d.toDateString() === now.toDateString()) return `${diffHrs}h ago`;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function decodeHtml(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
}

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

// Shared KaTeX macros — \mathcal shortcuts (\gA–\gZ) and \mathbb shortcuts (\sA–\sZ)
// from the standard ICLR/NeurIPS math_commands.tex template
const KATEX_MACROS = (() => {
  const m = {};
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const L of letters) {
    m['\\g' + L] = '{\\mathcal{' + L + '}}';
    m['\\s' + L] = '{\\mathbb{' + L + '}}';
  }
  m['\\R'] = '\\mathbb{R}';
  m['\\E'] = '\\mathbb{E}';
  m['\\Ls'] = '\\mathcal{L}';
  m['\\train'] = '\\mathcal{D}';
  m['\\valid'] = '\\mathcal{D_{\\mathrm{valid}}}';
  m['\\test'] = '\\mathcal{D_{\\mathrm{test}}}';
  return m;
})();

function _katexOpts(display) {
  return { displayMode: display, throwOnError: false, macros: KATEX_MACROS };
}

function renderTitle(rawTitle) {
  const decoded = decodeHtml(rawTitle);
  let html = escapeHtml(decoded);
  if (typeof katex !== 'undefined') {
    html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
      try { return katex.renderToString(tex, _katexOpts(true)); } catch { return _; }
    });
    html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
      try { return katex.renderToString(tex, _katexOpts(false)); } catch { return _; }
    });
  }
  return html;
}

// ── Paper ratings (1-5 stars) ──
function getPaperRatings() {
  try { return JSON.parse(localStorage.getItem('paperRatings') || '{}'); } catch { return {}; }
}
function _normalizeRatingKey(link) {
  // Normalize arXiv URLs: strip version, use https, use /abs/ form
  let k = link;
  try {
    const u = new URL(k);
    if (u.hostname.includes('arxiv.org')) {
      u.protocol = 'https:';
      // /abs/1706.03762v7 → /abs/1706.03762
      u.pathname = u.pathname.replace(/(\/abs\/[\d.]+)v\d+$/, '$1');
      // /pdf/... → /abs/...
      u.pathname = u.pathname.replace(/^\/pdf\//, '/abs/');
      k = u.origin + u.pathname;
    }
  } catch (e) { /* fire-and-forget */ }
  return k;
}
function getPaperRating(link) {
  const ratings = getPaperRatings();
  return ratings[_normalizeRatingKey(link)] || ratings[link] || 0;
}
function setPaperRating(link, rating) {
  const r = getPaperRatings();
  const key = _normalizeRatingKey(link);
  // Clean up old non-normalized key if different
  if (key !== link && r[link]) delete r[link];
  if (rating <= 0) delete r[key]; else r[key] = rating;
  localStorage.setItem('paperRatings', JSON.stringify(r));
  if (rating > 0 && !localStorage.getItem('ach_critic')) {
    localStorage.setItem('ach_critic', '1');
    showAchievement('Critic', 'Rated your first paper');
  }
}

function renderStarRating(link, opts) {
  const nLink = _normalizeRatingKey(link);
  const rating = getPaperRating(nLink);
  const size = opts?.size || 'sm';
  const interactive = opts?.interactive !== false;
  const cls = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  let html = `<span class="inline-flex items-center gap-px paper-rating" data-link="${escapeAttr(nLink)}">`;
  for (let i = 1; i <= 5; i++) {
    const filled = i <= rating;
    const fill = filled ? 'var(--accent)' : 'none';
    const stroke = filled ? 'var(--accent)' : 'currentColor';
    const opacity = filled ? '' : 'opacity:0.3;';
    const click = interactive ? ` onclick="event.stopPropagation();ratePaper('${escapeAttr(nLink)}',${i})" style="cursor:pointer;${opacity}"` : ` style="${opacity}"`;
    html += `<svg class="${cls}"${click} viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  html += '</span>';
  return html;
}

function ratePaper(link, rating) {
  const current = getPaperRating(link);
  // Click same star again → clear rating
  setPaperRating(link, current === rating ? 0 : rating);
  // Update all visible rating widgets for this paper
  document.querySelectorAll(`.paper-rating[data-link="${CSS.escape(link)}"]`).forEach(el => {
    el.outerHTML = renderStarRating(link, { interactive: el.closest('#browse-bar') || el.closest('#paper-topbar') ? true : true, size: el.closest('#browse-bar') || el.closest('#paper-topbar') ? 'md' : 'sm' });
  });
}

function escapeAttr(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function truncate(str, max) {
  if (!str || str.length <= max) return str || '';
  return str.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function renderLatexInEl(el) {
  if (!el) return;
  if (typeof katex === 'undefined') return;
  function decodeTex(t) { return t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"'); }
  let html = el.innerHTML;
  // Display math: $$ ... $$ and \[ ... \]
  html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
    try { return katex.renderToString(decodeTex(tex), _katexOpts(true)); }
    catch (e) { return _; }
  });
  html = html.replace(/\\\[(.+?)\\\]/gs, (_, tex) => {
    try { return katex.renderToString(decodeTex(tex), _katexOpts(true)); }
    catch (e) { return _; }
  });
  // Inline math: $ ... $ and \( ... \)
  html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
    try { return katex.renderToString(decodeTex(tex), _katexOpts(false)); }
    catch (e) { return _; }
  });
  html = html.replace(/\\\((.+?)\\\)/g, (_, tex) => {
    try { return katex.renderToString(decodeTex(tex), _katexOpts(false)); }
    catch (e) { return _; }
  });
  el.innerHTML = html;
}

function renderLatexIn(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (typeof katex === 'undefined') {
    setTimeout(() => renderLatexIn(elementId), 200);
    return;
  }
  renderLatexInEl(el);
}

// Double-tap Cmd/Ctrl → toggle window overview
let _dblCmdLast = 0;
let _dblCmdArmed = false;
window.addEventListener('keydown', e => {
  if (e.key === 'Meta' || e.key === 'Control') {
    const now = Date.now();
    if (_dblCmdArmed && now - _dblCmdLast < 400) {
      _dblCmdArmed = false;
      _wmToggleTiling();
    } else {
      _dblCmdArmed = true;
      _dblCmdLast = now;
    }
  } else {
    _dblCmdArmed = false;
  }
});

// Close settings on Escape + WM tiling toggle
window.addEventListener('keydown', e => {
  // Cmd+Esc → toggle tiling WM
  if ((e.metaKey || e.ctrlKey) && e.key === 'Escape') {
    e.preventDefault();
    _wmToggleTiling();
    return;
  }
  if (e.key === 'Escape') {
    const sv = document.getElementById('settings-view');
    if (sv && sv.style.display === 'block') goHome();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 't') {
    e.preventDefault();
    // Dismiss aether panel if open
    const _popup = document.getElementById('doc-chat-ask-float');
    if (_popup) { _popup.remove(); _aetherTrackMode = false; if (typeof _aetherShowCursor === 'function') _aetherShowCursor(); }
    const browseView = document.getElementById('browse-view');
    const isOpen = browseView && browseView.style.display !== 'none' && browseView.style.display !== '';
    if (!isOpen && typeof openBrowse === 'function') openBrowse();
    if (typeof browseNewTab === 'function') {
      if (!isOpen) { setTimeout(browseNewTab, 50); }
      else {
        // If current tab is already NTP, just focus the search input
        const win = typeof _getCurrentWindow === 'function' && _getCurrentWindow();
        const active = win && win.tabs && win.tabs.find(t => t.id === win.activeTab);
        if (active && active.blank) {
          const inp = browseView.querySelector('.browse-ntp #search-query');
          if (inp) { inp.focus(); inp.select(); }
        } else {
          browseNewTab();
        }
      }
    }
  }
  // Cmd+P: In Electron, handled via IPC (before-input-event → browse-command 'print').
  // In browser, handle here.
  if (!window.electronAPI && (e.metaKey || e.ctrlKey) && e.key === 'p') {
    e.preventDefault();
    const browseView = document.getElementById('browse-view');
    const browseOpen = browseView && browseView.style.display !== 'none' && browseView.style.display !== '';
    if (browseOpen && typeof _browseActiveTab !== 'undefined' && _browseActiveTab !== null) {
      const tab = typeof _browseTabs !== 'undefined' && _browseTabs.find(t => t.id === _browseActiveTab);
      if (typeof browsePrintPage === 'function') {
        browsePrintPage();
      }
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
    e.preventDefault();
    if (typeof openSearchHistoryPage === 'function') openSearchHistoryPage();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
    const browseView = document.getElementById('browse-view');
    if (browseView && browseView.style.display !== 'none' && browseView.style.display !== '' && typeof _browseActiveTab !== 'undefined' && _browseActiveTab !== null) {
      e.preventDefault();
      browseCloseTab(_browseActiveTab);
    }
  }
});

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
let _clickSoundCtx = null;
let _clickSoundOn = localStorage.getItem('clickSound') === 'on';

const CLICK_SOUND_PRESETS = {
  tap: { label: 'Tap', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sine'; o.frequency.setValueAtTime(400, t); o.frequency.exponentialRampToValueAtTime(250, t + 0.04);
    f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08);
  }},
  pop: { label: 'Pop', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(800, t); o.frequency.exponentialRampToValueAtTime(400, t + 0.05);
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.09);
  }},
  click: { label: 'Click', play(ctx, t) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.003));
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 1;
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t);
  }},
  bubble: { label: 'Bubble', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.06);
    g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1);
  }},
  key: { label: 'Key', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.setValueAtTime(1000, t); o.frequency.exponentialRampToValueAtTime(500, t + 0.02);
    f.type = 'lowpass'; f.frequency.value = 800; f.Q.value = 0.3;
    g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.06);
  }},
  thud: { label: 'Thud', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    f.type = 'lowpass'; f.frequency.value = 200; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1);
  }},
};

function toggleClickSound(on) {
  _clickSoundOn = on;
  localStorage.setItem('clickSound', on ? 'on' : 'off');
  if (on) playClickSound();
}

function setClickSoundType(type) {
  localStorage.setItem('clickSoundType', type);
  // Play a preview
  const wasOn = _clickSoundOn;
  _clickSoundOn = true;
  playClickSound();
  _clickSoundOn = wasOn;
}

function playClickSound() {
  if (!_clickSoundOn) return;
  try {
    if (!_clickSoundCtx) _clickSoundCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _clickSoundCtx;
    const t = ctx.currentTime;

    const type = localStorage.getItem('clickSoundType') || 'thud';
    const preset = CLICK_SOUND_PRESETS[type] || CLICK_SOUND_PRESETS.tap;
    preset.play(ctx, t);
  } catch (e) { /* fire-and-forget */ }
}

// Global click listener for interactive elements
document.addEventListener('click', function(e) {
  if (!_clickSoundOn) return;
  const el = e.target.closest('button, a, .sidebar-icon, [onclick], input[type="checkbox"], input[type="radio"], .toggle-switch');
  if (el) playClickSound();
}, { passive: true });

// ── Ambient rain sounds (Web Audio API) ──

let _rainCtx = null;
let _rainAudio = null;
let _rainNodes = [];
let _rainOn = false;
let _rainVolume = parseFloat(localStorage.getItem('rainVolume') || '0.3');
let _rainNoiseType = localStorage.getItem('rainNoiseType') || 'rain';
let _rainFreq = parseInt(localStorage.getItem('rainFreq') || '0');

// Noise type presets: each defines layers for _makeNoise
const NOISE_PRESETS = {
  rain:    { label: 'Rain',    layers: [['brown', 0.7], ['pink', 0.3]], thunder: true },
  storm:   { label: 'Storm',   layers: [['brown', 0.8], ['pink', 0.2]], thunder: true, thunderFreq: 0.4 },
  brown:   { label: 'Brown',   layers: [['brown', 1.0]], thunder: false },
  pink:    { label: 'Pink',    layers: [['pink', 1.0]], thunder: false },
  white:   { label: 'White',   layers: [['white', 1.0]], thunder: false },
  ocean:   { label: 'Ocean',   audio: 'audio/ocean.mp3' },
  stream:  { label: 'Stream',  audio: 'audio/stream.mp3' },
  fire:    { label: 'Fire',    audio: 'audio/fire.mp3' },
};

function toggleRain() {
  _rainOn ? stopRain() : startRain();
}

function startRain() {
  if (_rainOn) return;
  _rainOn = true;
  const btn = document.getElementById('sb-rain');
  if (btn) btn.classList.add('active');
  localStorage.setItem('rainOn', '1');

  const preset = NOISE_PRESETS[_rainNoiseType] || NOISE_PRESETS.rain;

  if (preset.audio) {
    // Sample-based preset: loop an audio file
    var a = new Audio(preset.audio);
    a.loop = true;
    a.volume = _rainVolume;
    a.addEventListener('canplaythrough', function() { a.play(); }, { once: true });
    a.load();
    _rainAudio = a;
    return;
  }

  _rainCtx = new (window.AudioContext || window.webkitAudioContext)();
  const master = _rainCtx.createGain();
  master.gain.value = _rainVolume;
  master.connect(_rainCtx.destination);
  _rainNodes.push(master);

  preset.layers.forEach(([type, amp]) => _makeNoise(_rainCtx, master, type, amp));
  if (preset.thunder) _rainThunderLoop(_rainCtx, master, preset.thunderFreq || 1);
}

function stopRain() {
  if (!_rainOn) return;
  _rainOn = false;
  const btn = document.getElementById('sb-rain');
  if (btn) btn.classList.remove('active');
  localStorage.removeItem('rainOn');
  if (_rainAudio) {
    _rainAudio.pause();
    _rainAudio = null;
  }
  if (_rainCtx) {
    _rainCtx.close();
    _rainCtx = null;
  }
  _rainNodes = [];
}

function setRainNoiseType(type) {
  _rainNoiseType = type;
  localStorage.setItem('rainNoiseType', type);
  if (_rainOn) { stopRain(); startRain(); }
}

function setRainFreq(hz) {
  _rainFreq = Math.max(0, Math.min(5000, parseInt(hz) || 0));
  localStorage.setItem('rainFreq', _rainFreq.toString());
  const label = document.getElementById('rain-freq-label');
  if (label) label.textContent = _rainFreq > 0 ? _rainFreq + ' Hz' : 'Auto';
  if (_rainOn) { stopRain(); startRain(); }
}

function setRainVolume(v) {
  _rainVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem('rainVolume', _rainVolume.toString());
  if (_rainAudio) {
    _rainAudio.volume = _rainVolume;
  }
  if (_rainNodes.length && _rainNodes[0]) {
    _rainNodes[0].gain.value = _rainVolume;
  }
  // Update settings percentage if visible
  const sliderVal = document.getElementById('rain-volume-value');
  if (sliderVal) sliderVal.textContent = Math.round(_rainVolume * 100) + '%';
  // Update sidebar tooltip if dragging
  const tooltip = document.querySelector('#sb-rain .sidebar-tooltip');
  if (tooltip && tooltip.dataset.volDrag) tooltip.textContent = Math.round(_rainVolume * 100) + '%';
}

function setRainSidebarVisible(show) {
  localStorage.setItem('rainSidebarVisible', show ? '1' : '0');
  const btn = document.getElementById('sb-rain');
  if (btn) btn.style.display = show ? '' : 'none';
  if (!show) stopRain();
}

function isRainSidebarVisible() {
  const v = localStorage.getItem('rainSidebarVisible');
  return v !== '0'; // default visible
}

// ── Rain button drag-to-adjust-volume ──
(function() {
  let _rainDragging = false;
  let _rainDragStartY = 0;
  let _rainDragStartVol = 0;

  function showVolInTooltip() {
    const tooltip = document.querySelector('#sb-rain .sidebar-tooltip');
    if (tooltip) {
      tooltip.dataset.volDrag = '1';
      tooltip.style.opacity = '1';
      tooltip.style.visibility = 'visible';
      tooltip.textContent = Math.round(_rainVolume * 100) + '%';
    }
  }

  function restoreTooltip() {
    const tooltip = document.querySelector('#sb-rain .sidebar-tooltip');
    if (tooltip) {
      delete tooltip.dataset.volDrag;
      tooltip.textContent = 'White noise';
      tooltip.style.opacity = '';
      tooltip.style.visibility = '';
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    const btn = document.getElementById('sb-rain');
    if (!btn) return;
    // Apply initial sidebar visibility
    if (!isRainSidebarVisible()) btn.style.display = 'none';

    btn.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      _rainDragStartY = e.clientY;
      _rainDragStartVol = _rainVolume;
      _rainDragging = false;

      function onMove(ev) {
        const dy = ev.clientY - _rainDragStartY;
        if (!_rainDragging && Math.abs(dy) > 4) {
          _rainDragging = true;
          showVolInTooltip();
        }
        if (_rainDragging) {
          // drag down = lower volume, drag up = raise volume; 150px = full range
          const newVol = Math.max(0, Math.min(1, _rainDragStartVol - dy / 150));
          setRainVolume(newVol);
        }
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (_rainDragging) {
          restoreTooltip();
          // Delay reset so click handler can see the flag
          setTimeout(function() { _rainDragging = false; }, 50);
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    btn.addEventListener('click', function(e) {
      if (_rainDragging) { e.preventDefault(); e.stopPropagation(); return; }
      toggleRain();
    });
  });
})();

function _makeNoise(ctx, dest, type, amp) {
  const bufSize = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(2, bufSize, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufSize; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'brown') {
        b0 = (b0 + (0.02 * white)) / 1.02;
        data[i] = b0 * 3.5 * amp;
      } else if (type === 'white') {
        data[i] = white * 0.3 * amp;
      } else {
        // pink noise (Paul Kellet's algorithm)
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11 * amp;
        b6 = white * 0.115926;
      }
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  // Default filter frequencies per type
  const defaultLp = type === 'brown' ? 400 : type === 'white' ? 4000 : 2500;
  const defaultHp = type === 'brown' ? 40 : type === 'white' ? 100 : 200;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = _rainFreq > 0 ? _rainFreq : defaultLp;
  lp.Q.value = 0.5;

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = defaultHp;
  hp.Q.value = 0.5;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(dest);
  src.start();
  _rainNodes.push(src);
}

function _rainThunderLoop(ctx, dest, freqMul) {
  if (!_rainOn) return;
  const baseDelay = freqMul > 1 ? 5000 : 15000;
  const randDelay = freqMul > 1 ? 15000 : 45000;
  const delay = baseDelay + Math.random() * randDelay;
  setTimeout(function() {
    if (!_rainOn || !_rainCtx) return;
    // Low rumble
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 40 + Math.random() * 30;
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.08 * _rainVolume, ctx.currentTime + 0.5);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2 + Math.random() * 2);
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    osc.stop(ctx.currentTime + 4);
    _rainThunderLoop(ctx, dest, freqMul);
  }, delay);
}

// Restore rain on page load
if (localStorage.getItem('rainOn') === '1') {
  document.addEventListener('click', function _resumeRain() {
    document.removeEventListener('click', _resumeRain);
    startRain();
  }, { once: true });
  // Visually mark button as active immediately
  requestAnimationFrame(function() {
    const btn = document.getElementById('sb-rain');
    if (btn) btn.classList.add('active');
  });
}

// ── User accounts & sync ──

const GOOGLE_CLIENT_ID = '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com';
let _authToken = localStorage.getItem('authToken') || null;
// Hydrate token from secure storage (macOS Keychain) if available
if (!_authToken && window.electronAPI?.getAuthToken) {
  window.electronAPI.getAuthToken().then(t => {
    if (t && !_authToken) { _authToken = t; localStorage.setItem('authToken', t); }
  });
}
let _authUser = localStorage.getItem('authUser') || null;  // email or name
let _authUserInfo = JSON.parse(localStorage.getItem('authUserInfo') || 'null');  // { google_id, email, name, username }
let _syncInterval = null;
let _authReady = false;  // true once login gate has been resolved

// Track dirty sync keys so we only serialize changed ones
const _syncDirtyKeys = new Set();
const _syncKeysSet = new Set();
(function() {
  const origSetItem = localStorage.setItem.bind(localStorage);
  const origRemoveItem = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    if (_syncKeysSet.has(key)) _syncDirtyKeys.add(key);
    return origSetItem(key, value);
  };
  localStorage.removeItem = function(key) {
    if (_syncKeysSet.has(key)) _syncDirtyKeys.add(key);
    return origRemoveItem(key);
  };
})();

// Keys to sync between devices (all user settings)
const SYNC_KEYS = [
  'feedSources', 'customFeeds', 'qualityFilter', 'qualityPrompt',
  'qualityThreshold', 'qualityCache', 'hiddenPosts', 'savedPosts',
  'readPosts', 'qualityTestTitles', 'paperRatings', 'theme',
  'accentColor', 'spinner', 'userName', 'sidebarOrder',
  'clickSound', 'clickSoundType', 'clickAether', 'rainNoiseType', 'rainVolume', 'rainFreq',
  'editorTheme', 'rainSidebarVisible',
  'pixelPet', 'pixelPetType', 'pixelPetMode',
  'feedNotifications', 'seenPostLinks',
  'adBlockEnabled', 'feedNotifSources', 'browseBarOrder',
  'browseHistory', 'webSearchHistory', 'chatThreads',
  'aetherColor',
  'interestProfile',
  'urlBarSections',
  'blockedWords', 'qualityBypass', 'searchHistory', 'userQuotes', 'repostedLinks',
  'fyWeightBase', 'fyWeightAffinity', 'fyWeightRecency', 'maxPerCategoryRun',
  'smartHighlights',
  'chatModel', 'chatTools', 'insightsAllowHeuristics',
  'iconSize', 'hiddenSidebarIcons'
];
SYNC_KEYS.forEach(k => _syncKeysSet.add(k));

// Default ad blocker to enabled
if (localStorage.getItem('adBlockEnabled') === null) {
  localStorage.setItem('adBlockEnabled', 'true');
}

function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_authToken) h['Authorization'] = 'Bearer ' + _authToken;
  return h;
}

// ── localStorage helpers (reduce try/parse/default boilerplate) ──
function getLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function setLS(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ── Auth fetch helper (reduces fetch+auth+error boilerplate) ──
// ── Login gate ──

function _showLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.style.display = '';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      _renderGoogleButton();
    });
  } else {
    _renderGoogleButton();
  }
}

function _hideLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.style.display = 'none';
}

let _gisRetries = 0;
function _renderGoogleButton() {
  const container = document.getElementById('google-signin-btn');
  if (!container) { console.warn('[auth] no google-signin-btn container'); return; }
  // Wait for GIS library to load (up to ~10s)
  if (typeof google === 'undefined' || !google.accounts) {
    _gisRetries++;
    if (_gisRetries % 10 === 1) console.log('[auth] waiting for GIS library... attempt', _gisRetries);
    if (_gisRetries < 50) {
      setTimeout(_renderGoogleButton, 200);
    } else {
      console.error('[auth] Google Identity Services failed to load after 50 attempts');
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Google Sign-In failed to load. Check that accounts.google.com is reachable and the current origin is an authorized JavaScript origin in your Google Cloud Console.</p>';
    }
    return;
  }
  console.log('[auth] GIS loaded, rendering button');
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: _handleGoogleCredential,
    });
    // Render real Google button inside a wrapper we style ourselves
    container.innerHTML = '<div id="google-btn-real"></div>';
    google.accounts.id.renderButton(document.getElementById('google-btn-real'), {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      width: 280,
    });
  } catch (e) {
    console.error('[auth] GIS renderButton error:', e);
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Google Sign-In error: ' + e.message + '</p>';
  }
}

async function _handleGoogleCredential(response) {
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.textContent = '';
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sign-in failed');
    _authToken = data.token;
    _authUser = (data.name || data.email || '').split(' ')[0];
    _authUserInfo = { email: data.email, name: data.name, username: data.username || null, picture: data.picture || null };
    localStorage.setItem('authToken', _authToken);
    window.electronAPI?.saveAuthToken?.(_authToken);
    localStorage.setItem('authUser', _authUser);
    localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
    // Clear any stale user data before pulling new user's data
    for (const key of SYNC_KEYS) localStorage.removeItem(key);
    // Sync: pull from server for returning users
    await syncFromServer();
    if (!data.username) {
      _showUsernamePicker();
    } else {
      _onLoginSuccess();
    }
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

// ── Username picker ──

function _showUsernamePicker() {
  const container = document.getElementById('google-signin-btn');
  if (!container) return;
  container.innerHTML = `
    <div style="text-align:center;max-width:320px;margin:0 auto;">
      <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">Choose a username</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">This will be your public identity for comments.</div>
      <div style="position:relative;">
        <input id="username-input" type="text" maxlength="20" placeholder="username"
          style="width:100%;box-sizing:border-box;padding:8px 12px;font-size:14px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input,var(--bg-secondary));color:var(--text-primary);outline:none;" />
        <div id="username-hint" style="font-size:11px;color:var(--text-muted);margin-top:4px;text-align:left;">2-20 chars: letters, numbers, hyphens, underscores</div>
      </div>
      <div id="username-error" style="font-size:12px;color:#e74c3c;margin-top:8px;min-height:18px;"></div>
      <button id="username-submit-btn" onclick="_submitUsername()"
        style="margin-top:8px;padding:8px 24px;font-size:14px;font-weight:500;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;opacity:0.5;" disabled>
        Continue
      </button>
    </div>
  `;
  const input = document.getElementById('username-input');
  input.addEventListener('input', () => {
    const val = input.value.replace(/[^a-zA-Z0-9_-]/g, '');
    if (val !== input.value) input.value = val;
    const btn = document.getElementById('username-submit-btn');
    const valid = val.length >= 2 && val.length <= 20;
    btn.disabled = !valid;
    btn.style.opacity = valid ? '1' : '0.5';
    document.getElementById('username-error').textContent = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const btn = document.getElementById('username-submit-btn');
      if (!btn.disabled) _submitUsername();
    }
  });
  input.focus();
}

async function _submitUsername() {
  const input = document.getElementById('username-input');
  const errEl = document.getElementById('username-error');
  const btn = document.getElementById('username-submit-btn');
  if (!input || !errEl) return;
  const username = input.value.trim();
  if (username.length < 2 || username.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    errEl.textContent = 'Invalid username format';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    const res = await fetch('/api/auth/username', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Failed to set username';
      btn.disabled = false;
      btn.textContent = 'Continue';
      return;
    }
    _authUserInfo.username = data.username;
    localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
    _onLoginSuccess();
  } catch (e) {
    errEl.textContent = 'Network error, please try again';
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

// ── Auth actions ──

function _onLoginSuccess() {
  _authReady = true;
  _hideLoginGate();
  _updateAccountUI();
  _startSyncInterval();
  // Apply any synced appearance settings
  if (typeof applyStoredAppearance === 'function') applyStoredAppearance();
  // Refresh inbox badge
  if (typeof refreshInboxBadge === 'function') {
    refreshInboxBadge();
    setInterval(refreshInboxBadge, 60000);
  }
  // Calendar event notifications
  if (typeof startCalendarNotifications === 'function') startCalendarNotifications();
  // Route to the correct view now that auth is resolved
  routeFromHash();
  _updateNowPlayingContext();
}

async function authLogout() {
  if (_authToken) {
    // Push latest settings before logging out
    await syncToServer(true).catch((e) => { /* fire-and-forget */ });
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: _authHeaders()
    }).catch((e) => { /* fire-and-forget */ });
  }
  _authToken = null;
  _authUser = null;
  _authUserInfo = null;
  _authReady = false;
  // Clear all user-specific data from localStorage
  for (const key of SYNC_KEYS) localStorage.removeItem(key);
  localStorage.removeItem('authToken');
  window.electronAPI?.deleteAuthToken?.();
  localStorage.removeItem('authUser');
  localStorage.removeItem('authUserInfo');
  _updateAccountUI();
  _stopSyncInterval();
  _showLoginGate();
}

function _updateAccountUI() {
  const avatarSpan = document.getElementById('sb-dashboard-avatar');
  const avatarIcon = document.getElementById('sb-dashboard-icon');
  if (!avatarSpan) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _updateAccountUI, { once: true });
    }
    return;
  }
  if (_authUserInfo && (_authUserInfo.username || _authUserInfo.name)) {
    if (_authUserInfo.picture) {
      avatarSpan.innerHTML = `<img src="${_authUserInfo.picture.replace(/"/g, '&quot;')}" style="width:22px;height:22px;object-fit:cover;border-radius:50%;display:block;" referrerpolicy="no-referrer" />`;
    } else {
      const letter = (_authUserInfo.username || _authUserInfo.name || '?')[0].toUpperCase();
      avatarSpan.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#fff;">${letter}</span>`;
    }
    avatarSpan.style.display = '';
    if (avatarIcon) avatarIcon.style.display = 'none';
  } else {
    avatarSpan.style.display = 'none';
    if (avatarIcon) avatarIcon.style.display = '';
  }
}


// ── Sync ──

function _buildSyncPayload(keysToSync) {
  const data = {};
  const now = Date.now() / 1000;
  for (const key of keysToSync) {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      let value;
      try { value = JSON.parse(raw); } catch { value = raw; }
      data[key] = { value, updated: now };
    }
  }
  return data;
}

function _applySyncData(serverData) {
  for (const [key, entry] of Object.entries(serverData)) {
    if (!_syncKeysSet.has(key)) continue;
    const value = entry.value;
    if (value === null || value === undefined) continue;
    // Temporarily remove from dirty set — this write is from server, not user
    _syncDirtyKeys.delete(key);
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    _syncDirtyKeys.delete(key);
  }
}

async function syncToServer(force) {
  if (!_authToken) return;
  const keysToSync = force ? SYNC_KEYS : [..._syncDirtyKeys];
  if (!keysToSync.length) return; // nothing changed
  _syncDirtyKeys.clear();
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ data: _buildSyncPayload(keysToSync) })
    });
    if (res.status === 401) { authLogout(); return; }
    const result = await res.json();
    if (result.data) _applySyncData(result.data);
  } catch (e) {
    console.warn('[sync] push failed:', e);
    // Re-mark as dirty so they retry next cycle
    for (const k of keysToSync) _syncDirtyKeys.add(k);
  }
}

async function syncFromServer() {
  if (!_authToken) return;
  try {
    // Pull only — send empty payload so server data always wins
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ data: {} })
    });
    if (res.status === 401) { authLogout(); return; }
    const result = await res.json();
    if (result.data) _applySyncData(result.data);
  } catch (e) {
    console.warn('[sync] pull failed:', e);
  }
}

function _startSyncInterval() {
  _stopSyncInterval();
  _syncInterval = setInterval(syncToServer, 60000);
}

function _stopSyncInterval() {
  if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; }
}

// ── UI action handlers ──

function _doLogout() {
  authLogout();
}

async function _doDeleteAccount() {
  if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
  if (!confirm('All your data will be permanently deleted. Continue?')) return;
  try {
    await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: _authHeaders()
    });
  } catch (e) { /* proceed with local cleanup regardless */ }
  _authToken = null;
  _authUser = null;
  _authUserInfo = null;
  _authReady = false;
  localStorage.clear();
  window.electronAPI?.deleteAuthToken?.();
  _updateAccountUI();
  _stopSyncInterval();
  _showLoginGate();
}

// ── Initialize: check session, show login gate if needed ──
(function _initAuth() {
  _updateAccountUI();
  if (_authToken) {
    // Verify session is still valid
    fetch('/api/auth/me', { headers: _authHeaders() })
      .then(r => {
        if (r.ok) return r.json();
        throw new Error('expired');
      })
      .then(data => {
        _authUser = (data.name || data.email || _authUser || '').split(' ')[0];
        _authUserInfo = { email: data.email, name: data.name, google_id: data.google_id, username: data.username || null, picture: data.picture || null };
        localStorage.setItem('authUser', _authUser);
        localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
        if (!data.username) {
          _showLoginGate();
          _showUsernamePicker();
        } else {
          _onLoginSuccess();
        }
        syncFromServer();
      })
      .catch(() => {
        _authToken = null;
        _authUser = null;
        _authUserInfo = null;
        localStorage.removeItem('authToken');
        window.electronAPI?.deleteAuthToken?.();
        localStorage.removeItem('authUser');
        localStorage.removeItem('authUserInfo');
        _updateAccountUI();
        _showLoginGate();
      });
  } else {
    // No token — show login gate
    _showLoginGate();
  }
})();

