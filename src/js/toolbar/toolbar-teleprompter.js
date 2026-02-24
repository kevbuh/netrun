// toolbar-teleprompter.js — Unified live text display for mic + CC
// Notch-style dropdown anchored below the AI pill

let _teleEl = null;
let _teleLinesEl = null;
let _teleStatusEl = null;
let _teleLines = [];
const _teleSources = new Set(); // 'mic', 'cc'
const _teleMaxLines = 12;
let _teleVisible = false;

function _ensureTeleprompter() {
  if (_teleEl) return;

  _teleEl = document.createElement('div');
  _teleEl.className = 'nr-teleprompter';
  _teleEl.addEventListener('click', _onTeleClick);

  _teleStatusEl = document.createElement('div');
  _teleStatusEl.className = 'nr-teleprompter-status';
  _teleEl.appendChild(_teleStatusEl);

  _teleLinesEl = document.createElement('div');
  _teleLinesEl.className = 'nr-teleprompter-lines';
  _teleEl.appendChild(_teleLinesEl);

  document.body.appendChild(_teleEl);
}

function _positionTeleprompter() {
  if (!_teleEl) return;
  const pill = document.getElementById('pill-ai-unified');
  if (!pill) return;
  const rect = pill.getBoundingClientRect();
  _teleEl.style.left = rect.left + rect.width / 2 + 'px';
  _teleEl.style.top = (rect.bottom + 6) + 'px';
}

function _updateStatus() {
  if (!_teleStatusEl) return;
  const parts = [];
  if (_teleSources.has('mic')) parts.push('<span class="nr-teleprompter-dot nr-teleprompter-dot-mic"></span>Listening\u2026');
  if (_teleSources.has('cc')) parts.push('<span class="nr-teleprompter-dot nr-teleprompter-dot-cc"></span>CC Live');
  _teleStatusEl.innerHTML = parts.join('<span class="nr-teleprompter-sep">\u00b7</span>');
}

function _renderLines() {
  if (!_teleLinesEl) return;
  const visibleCount = 4;
  const start = Math.max(0, _teleLines.length - visibleCount);
  const visible = _teleLines.slice(start);

  _teleLinesEl.innerHTML = '';
  for (let i = 0; i < visible.length; i++) {
    const line = document.createElement('div');
    line.className = 'nr-teleprompter-line';
    line.textContent = visible[i];
    // Brightness: last line brightest
    const fromEnd = visible.length - 1 - i;
    if (fromEnd === 0) line.style.opacity = '1';
    else if (fromEnd === 1) line.style.opacity = '0.7';
    else if (fromEnd === 2) line.style.opacity = '0.45';
    else line.style.opacity = '0.25';
    _teleLinesEl.appendChild(line);
  }
  // Scroll to bottom
  _teleLinesEl.scrollTop = _teleLinesEl.scrollHeight;
}

function _onTeleClick() {
  // Click to stop active sources
  if (_teleSources.has('mic') && typeof window._pillMicClick === 'function') {
    window._pillMicClick();
  }
  if (_teleSources.has('cc') && typeof window.toggleCaptions === 'function') {
    window.toggleCaptions();
  }
}

export function showTeleprompter(source) {
  _ensureTeleprompter();
  _teleSources.add(source);
  _updateStatus();
  _positionTeleprompter();
  if (!_teleVisible) {
    _teleVisible = true;
    _teleEl.classList.add('nr-teleprompter-visible');
  }
}

export function hideTeleprompter(source) {
  _teleSources.delete(source);
  if (_teleSources.size === 0) {
    _teleVisible = false;
    if (_teleEl) _teleEl.classList.remove('nr-teleprompter-visible');
    // Clear lines after fade out
    setTimeout(function() {
      if (!_teleVisible) {
        _teleLines = [];
        if (_teleLinesEl) _teleLinesEl.innerHTML = '';
      }
    }, 300);
  } else {
    _updateStatus();
  }
}

export function teleprompterAppend(text) {
  if (!text || !text.trim()) return;
  _teleLines.push(text.trim());
  if (_teleLines.length > _teleMaxLines) _teleLines.shift();
  _renderLines();
}

// Reposition on resize
window.addEventListener('resize', function() {
  if (_teleVisible) _positionTeleprompter();
});
