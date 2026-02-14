/* browse-ambient.js — Ambient AI: renderer-side bridge + URL bar transformation */

var _ambientDebounceTimers = {};
var _ambientDismissTimer = null;
var _ambientOriginalUrl = '';
var _ambientActive = false;
var _ambientCurrentInsight = null;

// ── Text extraction & send ──

function _ambientExtractAndSend(tab, frame) {
  if (!window.electronAPI || !window.electronAPI.ambientPageLoaded) return;
  if (!tab || !frame || !tab.url) return;

  var tabId = tab.id;

  // Clear previous debounce for this tab
  if (_ambientDebounceTimers[tabId]) {
    clearTimeout(_ambientDebounceTimers[tabId]);
  }

  _ambientDebounceTimers[tabId] = setTimeout(function () {
    delete _ambientDebounceTimers[tabId];
    try {
      frame.executeJavaScript(
        '(() => { try { return document.body?.innerText || ""; } catch(e) { return ""; } })()'
      ).then(function (text) {
        if (!text || text.length < 100) return;
        window.electronAPI.ambientPageLoaded({
          url: tab.url,
          title: tab.title || '',
          text: text.slice(0, 3000),
          tabId: tabId,
        });
      }).catch(function () {});
    } catch (e) { /* silent */ }
  }, 1500);
}

// ── URL bar ambient mode ──

function _ambientShowInsight(insight) {
  var wrap = document.getElementById('pill-url-wrap');
  var input = document.getElementById('pill-browse-url-input');
  if (!wrap || !input) return;

  // Store original URL
  _ambientOriginalUrl = input.value || '';
  _ambientCurrentInsight = insight;
  _ambientActive = true;

  // Add ambient class for glow
  wrap.classList.add('ambient-active');

  // Fade out, swap text, fade in
  input.style.opacity = '0';
  setTimeout(function () {
    input.value = insight.label;
    input.style.opacity = '1';
  }, 200);

  // Auto-dismiss after 15s
  if (_ambientDismissTimer) clearTimeout(_ambientDismissTimer);
  _ambientDismissTimer = setTimeout(function () {
    _ambientDismiss();
  }, 15000);
}

function _ambientDismiss() {
  if (!_ambientActive) return;

  var wrap = document.getElementById('pill-url-wrap');
  var input = document.getElementById('pill-browse-url-input');
  if (!wrap || !input) return;

  wrap.classList.remove('ambient-active');

  // Fade out, restore URL, fade in
  input.style.opacity = '0';
  setTimeout(function () {
    input.value = _ambientOriginalUrl;
    input.style.opacity = '1';
  }, 200);

  _ambientActive = false;
  _ambientCurrentInsight = null;

  if (_ambientDismissTimer) {
    clearTimeout(_ambientDismissTimer);
    _ambientDismissTimer = null;
  }
}

function _ambientOnNavigate() {
  _ambientDismiss();
}

// ── Detail popover on click ──

function _ambientShowDetail(insight) {
  // Remove existing popover if any
  var existing = document.getElementById('ambient-detail-popover');
  if (existing) existing.remove();

  var input = document.getElementById('pill-browse-url-input');
  if (!input) return;

  // Get position from the URL input to place popover below it
  var rect = input.getBoundingClientRect();

  var popover = document.createElement('div');
  popover.id = 'ambient-detail-popover';
  popover.className = 'fixed z-50 bg-card border border-border-card rounded-lg shadow-lg p-4 max-w-md';
  popover.style.minWidth = '280px';
  popover.style.top = (rect.bottom + 8) + 'px';
  popover.style.left = (rect.left + rect.width / 2) + 'px';
  popover.style.transform = 'translateX(-50%)';

  var detail = '<p class="text-sm text-primary mb-2">' + _escapeHtml(insight.detail) + '</p>';
  if (insight.related && insight.related.length > 0) {
    detail += '<div class="text-xs text-muted mt-2 border-t border-border-card pt-2">';
    detail += '<span class="font-medium">Related:</span>';
    for (var i = 0; i < insight.related.length; i++) {
      var r = insight.related[i];
      detail += '<div class="mt-1 truncate">' + _escapeHtml(r.title) + '</div>';
    }
    detail += '</div>';
  }
  popover.innerHTML = detail;

  document.body.appendChild(popover);

  // Close on click outside
  function closeHandler(e) {
    if (!popover.contains(e.target)) {
      popover.remove();
      document.removeEventListener('click', closeHandler, true);
    }
  }
  setTimeout(function () {
    document.addEventListener('click', closeHandler, true);
  }, 100);
}

function _escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Listener setup ──

function _initAmbientListener() {
  if (!window.electronAPI || !window.electronAPI.onAmbientInsight) return;

  window.electronAPI.onAmbientInsight(function (_event, insight) {
    if (!insight || !insight.tabId) return;

    // Only show if this insight is for the currently active tab
    if (typeof _browseActiveTab !== 'undefined' && insight.tabId !== _browseActiveTab) return;

    _ambientShowInsight(insight);
  });

  // Intercept clicks on the URL input while ambient is active
  var input = document.getElementById('pill-browse-url-input');
  if (input) {
    input.addEventListener('click', function (e) {
      if (_ambientActive && _ambientCurrentInsight) {
        e.preventDefault();
        e.stopPropagation();
        _ambientShowDetail(_ambientCurrentInsight);
      }
    });
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initAmbientListener);
} else {
  _initAmbientListener();
}
