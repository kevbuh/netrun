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

// ── Detail in pill dropdown ──

function _ambientShowDetail(insight) {
  var dd = document.getElementById('pill-url-dropdown');
  var wrap = document.getElementById('pill-url-wrap');
  if (!dd || !wrap) return;

  // Remove old popover if any
  var existing = document.getElementById('ambient-detail-popover');
  if (existing) existing.remove();

  var html = '<div style="padding:12px 14px;">';
  html += '<p style="font-size:0.82rem;color:var(--text-primary);margin:0 0 8px 0;line-height:1.5;">' + _escapeHtml(insight.detail) + '</p>';
  if (insight.related && insight.related.length > 0) {
    html += '<div style="font-size:0.72rem;color:var(--text-dim);border-top:1px solid var(--aether-border, var(--border-card));padding-top:8px;margin-top:8px;">';
    html += '<span style="font-weight:600;">Related:</span>';
    for (var i = 0; i < insight.related.length; i++) {
      var r = insight.related[i];
      html += '<div style="margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escapeHtml(r.title) + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  dd.innerHTML = html;
  dd.style.display = '';
  dd.classList.remove('hidden');
  wrap.classList.add('pill-dropdown-open');
  dd.onclick = null;
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
