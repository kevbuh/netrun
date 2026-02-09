// panel.js — Unified popup panel system, context menus, slash commands
// ── Selection popup: state for inline chat ──
let _popupChatMessages = [];
let _popupChatAbort = null;
let _chatStreamStart = 0;
let _aetherTrackModeVal = false;
Object.defineProperty(window, '_aetherTrackMode', {
  get() { return _aetherTrackModeVal; },
  set(v) {
    const was = _aetherTrackModeVal;
    _aetherTrackModeVal = v;
    if (v && !was) {
      // Entering track mode: disable iframe pointer events so clicks reach parent
      document.querySelectorAll('iframe, webview').forEach(f => {
        f.dataset.peTrack = f.style.pointerEvents || '';
        f.style.pointerEvents = 'none';
      });
    } else if (!v && was) {
      // Leaving track mode: restore iframe pointer events
      document.querySelectorAll('iframe, webview').forEach(f => {
        if ('peTrack' in f.dataset) {
          f.style.pointerEvents = f.dataset.peTrack;
          delete f.dataset.peTrack;
        }
      });
    }
  }
});
let _lastMouseX = 0;
let _lastMouseY = 0;
let _pendingScreenshots = [];
let _pendingNoteContexts = []; // {id, title, content} — vault notes attached to chat
let _pendingTabContexts = []; // {tabId, title, url, content} — browser tabs attached to chat
let _aetherDragging = false;
let _aetherDragOffset = { x: 0, y: 0 };
let _aetherDragPopup = null;
let _aetherPinned = false;
let _aetherPrevFocus = null; // { el, selStart, selEnd } — restore on Escape
let _ttsAudio = null; // current Kokoro TTS audio element
let _ttsAudioCtx = null;
let _ttsAnalyser = null;
let _ttsRafId = null;

function _ttsStartWaveform(audio) {
  if (!_ttsAudioCtx) _ttsAudioCtx = new AudioContext();
  var src = _ttsAudioCtx.createMediaElementSource(audio);
  _ttsAnalyser = _ttsAudioCtx.createAnalyser();
  _ttsAnalyser.fftSize = 64;
  src.connect(_ttsAnalyser);
  _ttsAnalyser.connect(_ttsAudioCtx.destination);
  var buf = new Uint8Array(_ttsAnalyser.frequencyBinCount);
  function tick() {
    _ttsRafId = requestAnimationFrame(tick);
    if (!_ttsAnalyser) return;
    _ttsAnalyser.getByteFrequencyData(buf);
    var pill = document.querySelector('.pill-island[data-island-id="tts"]');
    if (!pill) return;
    var bars = pill.querySelectorAll('.island-waveform-bar');
    // Sample 7 bars from frequency data
    var count = bars.length;
    var step = Math.floor(buf.length / count);
    for (var i = 0; i < count; i++) {
      var v = buf[i * step] / 255;
      bars[i].style.height = Math.max(2, v * 14) + 'px';
    }
  }
  tick();
}

function _ttsStopWaveform() {
  if (_ttsRafId) { cancelAnimationFrame(_ttsRafId); _ttsRafId = null; }
  _ttsAnalyser = null;
  // Don't close AudioContext — reuse it (creating new ones is expensive)
}

function _aetherHideCursorOverlay() {
  document.body.classList.add('aether-hide-cursor');
}
function _aetherShowCursor() {
  document.body.classList.remove('aether-hide-cursor');
  // Force browser to recalculate cursor via synthetic mouse move (Electron only)
  if (window.electronAPI?.nudgeCursor) window.electronAPI.nudgeCursor();
}

function _aetherRestoreFocus() {
  if (!_aetherPrevFocus) return;
  const { el, selStart, selEnd } = _aetherPrevFocus;
  _aetherPrevFocus = null;
  if (!el || !document.body.contains(el)) return;
  el.focus();
  if (selStart != null && typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(selStart, selEnd); } catch (_) {}
  }
}

function _isAetherEligible(text) {
  if (!text || text.length > 80) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  // Skip if it looks like a sentence (contains sentence-ending punctuation)
  if (/[.!?;]/.test(text)) return false;
  return true;
}

async function _fetchWikipediaPreview(text, containerDiv) {
  const title = text.trim().replace(/\s+/g, '_');
  try {
    const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (!resp.ok) { containerDiv.style.display = 'none'; return; }
    const data = await resp.json();
    if (data.type === 'disambiguation' || !data.extract) { containerDiv.style.display = 'none'; return; }
    const extract = data.extract.length > 200 ? data.extract.slice(0, 200) + '…' : data.extract;
    let html = '<div class="doc-wiki-result">';
    if (data.thumbnail && data.thumbnail.source) {
      html += `<img class="doc-wiki-thumb" src="${data.thumbnail.source}" alt="" />`;
    }
    html += '<div>';
    html += `<div class="doc-wiki-title">${escapeHtml(data.title)}</div>`;
    html += `<div class="doc-wiki-extract">${escapeHtml(extract)}</div>`;
    html += `<a class="doc-wiki-link" href="${data.content_urls?.desktop?.page || '#'}" data-external-link>Wikipedia →</a>`;
    html += '</div></div>';
    containerDiv.innerHTML = html;
    containerDiv.style.display = '';
    containerDiv.querySelectorAll('[data-external-link]').forEach(a => {
      a.addEventListener('mousedown', (ev) => ev.stopPropagation());
      a.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        window.open(a.getAttribute('href'), '_blank');
      });
    });
    _repositionSelectionPopup();
  } catch (e) {
    containerDiv.style.display = 'none';
  }
}

function _isAuthorEligible(text) {
  if (!text || text.length > 50) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  // All words should start with uppercase (name pattern)
  if (!words.every(w => /^[A-Z\u00C0-\u024F]/.test(w))) return false;
  // No digits, no sentence punctuation
  if (/[\d.!?;:,]/.test(text)) return false;
  return true;
}

function _findKnownAuthor(text) {
  // Check if this author name matches one already loaded in the sidebar Authors tab
  if (!window._insightAuthors?.length) return null;
  const q = text.trim().toLowerCase();
  return window._insightAuthors.find(a => a.name && a.name.toLowerCase() === q) || null;
}

function _renderAuthorPreviewHtml(data, containerDiv) {
  let html = '<div class="doc-author-result">';
  html += `<div class="doc-author-name">${escapeHtml(data.name)}</div>`;
  const affil = data.affiliations?.length ? data.affiliations[0] : data.affiliation;
  if (affil) {
    html += `<div class="doc-author-affil">${escapeHtml(affil)}</div>`;
  }
  html += `<div class="doc-author-stats">`;
  if (data.hIndex) html += `<span>h-index: ${data.hIndex}</span>`;
  if (data.paperCount) html += `<span>${fmtNum(data.paperCount)} papers</span>`;
  if (data.citationCount) html += `<span>${fmtNum(data.citationCount)} citations</span>`;
  html += `</div>`;
  if (data.topPapers?.length) {
    html += `<div class="doc-author-papers">`;
    for (const p of data.topPapers) {
      html += `<div class="doc-author-paper">${escapeHtml(p.title)}${p.year ? ` (${p.year})` : ''}${p.citationCount ? ` · ${fmtNum(p.citationCount)}` : ''}</div>`;
    }
    html += `</div>`;
  }
  // Author profile link (opens in-app) and Semantic Scholar link (opens in browser)
  const authorId = data.authorId;
  html += `<div class="doc-ref-footer">`;
  if (authorId) {
    html += `<a class="doc-ref-link" href="#author/${encodeURIComponent(authorId)}" data-author-nav>Profile →</a>`;
  }
  if (data.url) {
    html += `<a class="doc-ref-link" href="${escapeHtml(data.url)}" data-external-link>Semantic Scholar →</a>`;
  }
  html += `</div>`;
  html += '</div>';
  containerDiv.innerHTML = html;
  containerDiv.style.display = '';

  // Wire up link handlers
  containerDiv.querySelectorAll('[data-external-link]').forEach(a => {
    a.addEventListener('mousedown', (ev) => ev.stopPropagation());
    a.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      window.open(a.getAttribute('href'), '_blank');
    });
  });
  containerDiv.querySelectorAll('[data-author-nav]').forEach(a => {
    a.addEventListener('mousedown', (ev) => ev.stopPropagation());
    a.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // Remove the popup when navigating to profile
      document.getElementById('doc-chat-ask-float')?.remove();
    });
  });

  _repositionSelectionPopup();
}

async function _fetchAuthorPreview(text, containerDiv) {
  // First check if this author is already known from the sidebar
  const known = _findKnownAuthor(text);
  if (known && known.authorId) {
    // Use the known author data directly — right person guaranteed
    _renderAuthorPreviewHtml(known, containerDiv);
    return;
  }

  try {
    const resp = await fetch('/api/author-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text.trim() })
    });
    if (!resp.ok) { containerDiv.style.display = 'none'; return; }
    const data = await resp.json();
    if (data.error || !data.name) { containerDiv.style.display = 'none'; return; }
    _renderAuthorPreviewHtml(data, containerDiv);
  } catch (e) {
    containerDiv.style.display = 'none';
  }
}

// ── Semantic preview in selection popup ──
async function _fetchSemanticPreview(text, containerDiv) {
  if (!text || text.trim().length < 3) { containerDiv.style.display = 'none'; return; }
  if (localStorage.getItem('panelSemanticSearch') === 'off') { containerDiv.style.display = 'none'; return; }
  const minScore = (parseInt(localStorage.getItem('panelSemanticMin') || '80', 10)) / 100;
  try {
    const resp = await fetch('/api/semantic-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text.trim().slice(0, 200), limit: 5 })
    });
    if (!resp.ok) { containerDiv.style.display = 'none'; return; }
    const data = await resp.json();
    const results = (data.results || []).filter(r => r.score >= minScore);
    if (!results.length) { containerDiv.style.display = 'none'; return; }
    let html = '<div class="doc-semantic-results">';
    html += '<div class="doc-semantic-heading">Related</div>';
    for (const r of results) {
      const pct = Math.round(r.score * 100);
      const chip = typeof getSourceChip === 'function' ? getSourceChip(r.source) : '';
      html += `<a class="doc-semantic-row" href="${escapeAttr(r.link)}" data-semantic-link>`;
      html += chip;
      html += `<span class="doc-semantic-title">${escapeHtml(r.title)}</span>`;
      html += `<span class="doc-semantic-score">${pct}%</span>`;
      html += `</a>`;
    }
    html += '</div>';
    containerDiv.innerHTML = html;
    containerDiv.style.display = '';
    containerDiv.querySelectorAll('[data-semantic-link]').forEach(a => {
      a.addEventListener('mousedown', (ev) => ev.stopPropagation());
      a.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const link = a.getAttribute('href');
        if (link && typeof openPaperByUrl === 'function') openPaperByUrl(link, ev);
        document.getElementById('doc-chat-ask-float')?.remove();
      });
    });
    _repositionSelectionPopup();
  } catch (e) {
    containerDiv.style.display = 'none';
  }
}

// ── Panel suggestion (tiny model generates a question from context) ──
let _panelSuggestAbort = null;

function _fetchPanelSuggestion(popup, text) {
  if (_panelSuggestAbort) { _panelSuggestAbort.abort(); _panelSuggestAbort = null; }
  if (localStorage.getItem('panelTabComplete') === 'off') return;
  if (!text || text.length < 3) return;
  const ctrl = _panelSuggestAbort = new AbortController();
  fetch('/api/panel-suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: ctrl.signal
  })
    .then(r => r.json())
    .then(data => {
      if (ctrl.signal.aborted || !popup.isConnected) return;
      const suggestion = (data.suggestion || '').trim();
      if (!suggestion) return;
      // Don't show if user already started typing or chatting
      const input = popup.querySelector('.doc-ask-inline-input');
      if (input && input.value.trim()) return;
      if (_popupChatMessages.length) return;
      _renderPanelSuggestion(popup, suggestion);
    })
    .catch(() => {});
}

function _renderPanelSuggestion(popup, suggestion) {
  let el = popup.querySelector('.aether-suggestion');
  if (el) el.remove();
  const askWrap = popup.querySelector('.doc-ask-inline-wrap');
  if (!askWrap) return;
  el = document.createElement('div');
  el.className = 'aether-suggestion';
  el.innerHTML = `<span class="aether-suggestion-text">${escapeHtml(suggestion)}</span><span class="aether-suggestion-hint">Tab</span>`;
  el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    _acceptPanelSuggestion(popup, suggestion);
  });
  askWrap.style.position = 'relative';
  askWrap.insertBefore(el, askWrap.firstChild);
  // Hide placeholder when suggestion is visible
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.placeholder = '';
  _repositionSelectionPopup();
}

function _acceptPanelSuggestion(popup, suggestion) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (!input) return;
  input.value = suggestion;
  const el = popup.querySelector('.aether-suggestion');
  if (el) el.remove();
  _sendPopupChatMessage(popup, popup._capturedText || '');
}

function _sendPopupChatMessage(popup, capturedText) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q && _pendingScreenshots.length === 0) return;
  input.value = '';

  // Pin the panel in place and restore the cursor
  _aetherTrackMode = false;
  _aetherPinned = true;
  _aetherShowCursor();

  // Grab pending screenshots and note contexts, clear strip
  const images = _pendingScreenshots.slice();
  _pendingScreenshots = [];
  const noteContexts = _pendingNoteContexts.slice();
  _pendingNoteContexts = [];
  const tabContexts = _pendingTabContexts.slice();
  _pendingTabContexts = [];
  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (strip) { strip.innerHTML = ''; strip.style.display = 'none'; }

  // Build user message with context on first message
  const userMsg = _popupChatMessages.length === 0 && capturedText
    ? (q || 'What is this?') + '\n\n> ' + capturedText
    : (q || 'What is this?');
  const msgObj = { role: 'user', content: userMsg, _display: q || 'What is this?' };
  if (images.length) msgObj.images = images;
  _popupChatMessages.push(msgObj);
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true });

  // Show chat area, add has-chat class
  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  input.disabled = true;
  const sendBtn = popup.querySelector('.doc-ask-inline-send');
  if (sendBtn) sendBtn.disabled = true;

  _popupChatAbort = new AbortController();

  // Check if any message has images (vision mode)
  const hasVision = _popupChatMessages.some(m => m.images && m.images.length > 0);

  const filteredMsgs = _popupChatMessages.filter(m => !m._thinking).map(m => {
    const msg = { role: m.role, content: m.content };
    if (m.images && m.images.length) msg.images = m.images;
    return msg;
  });

  (async () => {
    try {
      const body = { messages: filteredMsgs };
      const chatModel = localStorage.getItem('chatModel');
      if (chatModel) body.model = chatModel;
      const toolsOn = localStorage.getItem('chatTools') !== 'off';
      // Include current page info for tool context
      if (toolsOn) {
        const paper = _currentPaperViewPaper;
        const browseTab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
          ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
        if (paper) {
          body.pageUrl = paper.link || paper.url || '';
          body.pageTitle = paper.title || '';
        } else if (browseTab && browseTab.url) {
          body.pageUrl = browseTab.url;
          body.pageTitle = browseTab.title || '';
        }
      }
      if (hasVision) {
        body.vision = true;
        const vm = localStorage.getItem('visionModel');
        if (vm) body.model = vm;
      } else {
        if (toolsOn) body.tools = true;
        // Build context from doc text + any attached note/tab contents
        let ctx = _docText || '';
        if (noteContexts.length) {
          const notesCtx = noteContexts.map(n =>
            `--- Note: ${n.title} ---\n${n.content}`
          ).join('\n\n');
          ctx = ctx ? ctx + '\n\n' + notesCtx : notesCtx;
        }
        if (tabContexts.length) {
          const tabCtx = tabContexts.map(t =>
            `--- Tab: ${t.title} (${t.url}) ---\n${t.content}`
          ).join('\n\n');
          ctx = ctx ? ctx + '\n\n' + tabCtx : tabCtx;
        }
        body.context = ctx;
      }
      _chatStreamStart = Date.now();
      const resp = await fetch('/api/doc-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: _popupChatAbort.signal
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        _popupChatMessages[_popupChatMessages.length - 1].content = 'Error: server returned ' + resp.status;
        _popupChatMessages[_popupChatMessages.length - 1]._thinking = false;
        _renderPopupChat(popup, true);
        return;
      }

      let aiText = '';
      const aiIdx = _popupChatMessages.length - 1;
      _popupChatMessages[aiIdx]._thinking = false;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            if (currentEvent === 'token') {
              try {
                const token = JSON.parse(line.slice(6));
                aiText += token;
                _popupChatMessages[aiIdx].content = aiText;
                _renderPopupChat(popup, false);
              } catch (e) {}
            } else if (currentEvent === 'tool_call') {
              try {
                const tc = JSON.parse(line.slice(6));
                const labels = { web_search: 'Searching web…', search_papers: 'Searching papers…', fetch_page: 'Fetching page…', save_to_reading_list: 'Bookmarking…', navigate: 'Navigating…', create_experiment: 'Creating experiment…' };
                _popupChatMessages[aiIdx].content = '';
                _popupChatMessages[aiIdx]._thinking = true;
                _popupChatMessages[aiIdx]._thinkingLabel = labels[tc.name] || 'Using tool…';
                _renderPopupChat(popup, false);
              } catch (e) {}
            } else if (currentEvent === 'action') {
              try {
                const act = JSON.parse(line.slice(6));
                if (act.type === 'bookmark' && act.url) {
                  const paper = { link: act.url, title: act.title || act.url };
                  if (typeof toggleSavePost === 'function') {
                    const saved = JSON.parse(localStorage.getItem('savedPosts') || '{}');
                    if (!saved[act.url]) toggleSavePost(paper);
                  }
                } else if (act.type === 'navigate' && act.view) {
                  const routes = { home: '#', experiments: '#experiments', saved: '#saved', calendar: '#calendar', settings: '#settings', quality: '#quality' };
                  location.hash = routes[act.view] || '#';
                }
              } catch (e) {}
            } else if (currentEvent === 'usage') {
              try {
                const usage = JSON.parse(line.slice(6));
                _popupChatMessages[aiIdx]._usage = usage;
              } catch (e) {}
            } else if (currentEvent === 'done') {
              streamDone = true;
            } else if (currentEvent === 'error') {
              try {
                const errMsg = JSON.parse(line.slice(6));
                _popupChatMessages[aiIdx].content = aiText || ('Error: ' + errMsg);
              } catch (e) {}
              streamDone = true;
            }
            currentEvent = '';
          } else if (line === '') {
            currentEvent = '';
          }
        }
      }

      _popupChatMessages[aiIdx].content = aiText;
      _renderPopupChat(popup, true);
    } catch (e) {
      if (e.name !== 'AbortError') {
        _popupChatMessages.push({ role: 'assistant', content: 'Error: ' + e.message });
        _renderPopupChat(popup, true);
      }
    }
    _popupChatAbort = null;
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.focus();
    _repositionSelectionPopup();
  })();
}

function _updateContextBar(popup) {
  const fill = popup.querySelector('.aether-context-fill');
  if (!fill) return;
  // Estimate tokens: chars / 4, context window ~32k for most models
  let chars = 0;
  // Document context
  if (_docText) chars += _docText.length;
  // Note contexts
  for (const n of _pendingNoteContexts) chars += (n.content || '').length;
  // Tab contexts
  for (const t of _pendingTabContexts) chars += (t.content || '').length;
  // All messages
  for (const m of _popupChatMessages) chars += (m.content || '').length;
  // Screenshots count as ~1k tokens each
  const imgTokens = _pendingScreenshots.length * 1000;
  for (const m of _popupChatMessages) {
    if (m.images) imgTokens + m.images.length * 1000;
  }
  const estTokens = Math.round(chars / 4) + imgTokens;
  // Use actual token counts from usage data if available
  let actualTokens = 0;
  for (const m of _popupChatMessages) {
    if (m._usage) {
      actualTokens += (m._usage.prompt_tokens || 0) + (m._usage.completion_tokens || 0);
    }
  }
  const tokens = actualTokens || estTokens;
  const limit = 32000;
  const pct = Math.min(100, (tokens / limit) * 100);
  fill.style.width = pct + '%';
  // Color: green → yellow → red
  if (pct < 50) fill.style.background = 'var(--accent)';
  else if (pct < 80) fill.style.background = '#c8a030';
  else fill.style.background = '#c44';
  const label = actualTokens
    ? tokens.toLocaleString() + ' tokens used (' + Math.round(pct) + '% of ' + limit.toLocaleString() + ')'
    : '~' + Math.round(tokens).toLocaleString() + ' / ' + limit.toLocaleString() + ' tokens (~' + Math.round(pct) + '%)';
  fill.title = label;
  fill.parentElement.title = label;
}

function _renderPopupChat(popup, final) {
  const container = popup.querySelector('.doc-popup-chat-messages');
  if (!container) return;
  container.innerHTML = _popupChatMessages.map((m, i) => {
    if (m.role === 'user') {
      const display = m._display || m.content;
      let imgsHtml = '';
      if (m.images && m.images.length) {
        imgsHtml = '<div class="doc-msg-images">' + m.images.map(b64 =>
          `<img src="data:image/png;base64,${b64}" />`
        ).join('') + '</div>';
      }
      const searchIcon = m._isSearch ? '<span class="doc-search-badge">search</span>' : '';
      const paperIcon = m._isPaperSearch ? '<span class="doc-search-badge doc-paper-badge">papers</span>' : '';
      const userIcon = m._isUserSearch ? '<span class="doc-search-badge doc-user-badge">users</span>' : '';
      const noteIcon = m._isNoteSearch ? '<span class="doc-search-badge doc-note-badge">notes</span>' : '';
      return `<div class="doc-msg-user">${imgsHtml}${searchIcon}${paperIcon}${userIcon}${noteIcon}${escapeHtml(display)}</div>`;
    }
    if (m._thinking) {
      const label = m._thinkingLabel ? `<span class="doc-thinking-label">${escapeHtml(m._thinkingLabel)}</span>` : '';
      return `<div class="doc-msg-ai"><span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>${label}</div>`;
    }
    // Search results
    if (m._searchResults && m._searchResults.length) {
      const resultsHtml = m._searchResults.map(r =>
        `<div class="doc-search-result" data-href="${escapeAttr(r.url)}">` +
        `<div class="doc-search-result-title">${escapeHtml(r.title)}</div>` +
        (r.snippet ? `<div class="doc-search-result-snippet">${escapeHtml(r.snippet)}</div>` : '') +
        `<div class="doc-search-result-url">${escapeHtml(r.url.length > 60 ? r.url.slice(0, 57) + '...' : r.url)}</div>` +
        `</div>`
      ).join('');
      return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
    }
    // Paper search results
    if (m._paperResults && m._paperResults.length) {
      const resultsHtml = m._paperResults.map(r =>
        `<div class="doc-paper-result" data-href="${escapeAttr(r.link)}">` +
        `<div class="doc-paper-result-title">${escapeHtml(r.title)}</div>` +
        `<div class="doc-paper-result-meta">${escapeHtml(r.authors)}${r.year ? ' · ' + r.year : ''}</div>` +
        (r.summary ? `<div class="doc-paper-result-summary">${escapeHtml(r.summary.length > 150 ? r.summary.slice(0, 147) + '...' : r.summary)}</div>` : '') +
        `</div>`
      ).join('');
      return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
    }
    // User search results
    if (m._userResults && m._userResults.length) {
      const resultsHtml = m._userResults.map(u =>
        `<div class="doc-user-result" data-username="${escapeAttr(u.username)}">` +
        (u.picture ? `<img class="doc-user-result-avatar" src="${escapeAttr(u.picture)}" />` :
          `<div class="doc-user-result-avatar doc-user-result-avatar-fallback">${escapeHtml(u.username.charAt(0).toUpperCase())}</div>`) +
        `<span class="doc-user-result-name">${escapeHtml(u.username)}</span>` +
        `</div>`
      ).join('');
      return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
    }
    // Note search results
    if (m._noteResults && m._noteResults.length) {
      const resultsHtml = m._noteResults.map(n => {
        const preview = (n.content || '').replace(/[#*_`>\-\[\]()]/g, '').replace(/\s+/g, ' ').trim();
        const snippet = preview.length > 120 ? preview.slice(0, 117) + '...' : preview;
        const tags = (n.tags || []).slice(0, 3);
        return `<div class="doc-note-result" data-note-id="${escapeAttr(n.id)}">` +
          `<div class="doc-note-result-title">${escapeHtml(n.title || 'Untitled')}</div>` +
          (tags.length ? `<div class="doc-note-result-tags">${tags.map(t => '<span class="doc-note-result-tag">' + escapeHtml(t) + '</span>').join('')}</div>` : '') +
          (snippet ? `<div class="doc-note-result-snippet">${escapeHtml(snippet)}</div>` : '') +
          `</div>`;
      }).join('');
      return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
    }
    const isLast = i === _popupChatMessages.length - 1;
    const content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content)
      : escapeHtml(m.content);
    const speakBtn = `<button class="doc-msg-speak-btn" title="Read aloud"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>`;
    return `<div class="doc-msg-ai">${content}${speakBtn}</div>`;
  }).join('');
  // Attach click handlers for search results
  container.querySelectorAll('.doc-search-result[data-href]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const url = el.getAttribute('data-href');
      if (typeof browseNewTab === 'function') browseNewTab(url);
      else window.open(url, '_blank');
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });
  // Attach click handlers for paper results
  container.querySelectorAll('.doc-paper-result[data-href]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const url = el.getAttribute('data-href');
      if (typeof browseNewTab === 'function') browseNewTab(url);
      else window.open(url, '_blank');
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });
  // Attach click handlers for user results
  container.querySelectorAll('.doc-user-result[data-username]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const username = el.getAttribute('data-username');
      window.location.hash = '#profile/' + encodeURIComponent(username);
      // Dismiss the aether panel
      const popup = document.getElementById('doc-chat-ask-float');
      if (popup) { _aetherTrackMode = false; popup.remove(); }
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });
  // Attach click handlers for note results
  container.querySelectorAll('.doc-note-result[data-note-id]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const noteId = el.getAttribute('data-note-id');
      window.location.hash = 'vault';
      setTimeout(() => { if (typeof openVaultNote === 'function') openVaultNote(noteId); }, 100);
      const popup = document.getElementById('doc-chat-ask-float');
      if (popup) { _aetherTrackMode = false; popup.remove(); }
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });
  // Attach speak button handlers (Kokoro TTS)
  container.querySelectorAll('.doc-msg-speak-btn').forEach(btn => {
    btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (_ttsAudio) {
        _ttsAudio.pause();
        _ttsAudio = null;
        _ttsStopWaveform();
        islandRemove('tts');
        container.querySelectorAll('.doc-msg-speak-btn').forEach(b => b.classList.remove('doc-msg-speaking'));
        if (btn.classList.contains('doc-msg-speaking')) return; // was toggling off
      }
      const msgEl = btn.closest('.doc-msg-ai');
      if (!msgEl) return;
      const text = msgEl.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return;
      btn.classList.add('doc-msg-speaking');
      islandUpdate('tts', { type: 'tts', label: 'Generating…', detail: 'Generating speech audio' });
      fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('authToken') || '') },
        body: JSON.stringify({ text })
      }).then(r => {
        if (!r.ok) throw new Error('TTS failed');
        return r.blob();
      }).then(blob => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        _ttsAudio = audio;
        islandUpdate('tts', { type: 'tts', label: 'Speaking', detail: 'Playing speech audio' });
        _ttsStartWaveform(audio);
        audio.onended = () => { btn.classList.remove('doc-msg-speaking'); URL.revokeObjectURL(url); _ttsAudio = null; _ttsStopWaveform(); islandRemove('tts'); };
        audio.onerror = () => { btn.classList.remove('doc-msg-speaking'); URL.revokeObjectURL(url); _ttsAudio = null; _ttsStopWaveform(); islandRemove('tts'); };
        audio.play();
      }).catch(() => { btn.classList.remove('doc-msg-speaking'); islandRemove('tts'); });
    });
  });
  // Update send/stop button state
  const sendBtn = popup.querySelector('.doc-ask-inline-send');
  if (sendBtn) {
    if (_popupChatAbort && !final) {
      sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>';
      sendBtn.title = 'Stop';
      sendBtn.disabled = false;
      sendBtn.classList.add('doc-ask-inline-stop');
    } else {
      sendBtn.innerHTML = '↑';
      sendBtn.title = 'Send';
      sendBtn.classList.remove('doc-ask-inline-stop');
    }
  }

  // Scroll: for search results, scroll to the search query; otherwise scroll to bottom
  const lastMsg = _popupChatMessages[_popupChatMessages.length - 1];
  if (lastMsg && ((lastMsg._searchResults && lastMsg._searchResults.length) || (lastMsg._paperResults && lastMsg._paperResults.length) || (lastMsg._userResults && lastMsg._userResults.length) || (lastMsg._noteResults && lastMsg._noteResults.length))) {
    const msgs = container.querySelectorAll('.doc-msg-user, .doc-msg-ai');
    const searchUserMsg = msgs.length >= 2 ? msgs[msgs.length - 2] : null;
    if (searchUserMsg) searchUserMsg.scrollIntoView({ block: 'start' });
    else container.scrollTop = 0;
  } else {
    container.scrollTop = container.scrollHeight;
  }
  _updateContextBar(popup);
  _updateChatStats(popup, final);
  // Show/hide redo + copy buttons
  const hasAiMsg = _popupChatMessages.some(m => m.role === 'assistant' && !m._thinking && m.content);
  if (popup._redoBtn) popup._redoBtn.style.display = hasAiMsg ? '' : 'none';
  if (popup._copyChatBtn) popup._copyChatBtn.style.display = hasAiMsg ? '' : 'none';
}

const _modelContextSizes = {
  'qwen2.5:1.5b': 32000, 'qwen2.5:3b': 32000, 'qwen2.5:7b': 32000,
  'qwen3:8b': 32000, 'qwen3-vl:8b': 32000, 'llama3:8b': 8000,
  'gemma2:9b': 8000, 'mistral:7b': 32000, 'deepseek-r1:8b': 64000,
};

function _getModelContextSize(model) {
  if (!model) return 32000;
  // Try exact match first, then prefix match
  if (_modelContextSizes[model]) return _modelContextSizes[model];
  const base = model.replace(/:latest$/, '');
  if (_modelContextSizes[base]) return _modelContextSizes[base];
  for (const k of Object.keys(_modelContextSizes)) {
    if (base.startsWith(k.split(':')[0])) return _modelContextSizes[k];
  }
  return 32000;
}

function _fmtTokens(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function _updateContextUsage(popup) {
  const el = popup.querySelector('.aether-context-usage');
  if (!el) return;
  const model = localStorage.getItem('chatModel') || 'qwen2.5:3b';
  const limit = _getModelContextSize(model);
  // Sum prompt_tokens from all assistant messages with usage, or estimate
  let used = 0;
  const lastAi = [..._popupChatMessages].reverse().find(m => m.role === 'assistant' && m._usage);
  if (lastAi && lastAi._usage) {
    used = (lastAi._usage.prompt_tokens || 0) + (lastAi._usage.completion_tokens || 0);
  } else {
    // Estimate from all message content
    for (const m of _popupChatMessages) {
      if (m.content) used += Math.round(m.content.length / 4);
    }
  }
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  el.textContent = `${_fmtTokens(used)}/${_fmtTokens(limit)} (${pct}%)`;
  // Color based on usage
  el.style.color = pct > 80 ? '#e53e3e' : pct > 50 ? '#d69e2e' : '';
}

function _updateChatStats(popup, final) {
  const statsEl = popup.querySelector('.doc-chat-stats');
  if (!statsEl) return;
  _updateContextUsage(popup);
  if (_popupChatMessages.length === 0) { statsEl.textContent = ''; return; }
  const lastAi = [..._popupChatMessages].reverse().find(m => m.role === 'assistant' && !m._thinking);
  if (!lastAi) { statsEl.textContent = ''; return; }
  const parts = [];
  // Token count: use actual usage if available, else estimate from streamed text
  if (lastAi._usage) {
    const u = lastAi._usage;
    const total = (u.prompt_tokens || 0) + (u.completion_tokens || 0);
    if (total) parts.push(total >= 1000 ? (total / 1000).toFixed(1) + 'k tokens' : total + ' tokens');
  } else if (lastAi.content) {
    const est = Math.round(lastAi.content.length / 4);
    if (est > 0) parts.push('~' + (est >= 1000 ? (est / 1000).toFixed(1) + 'k' : est) + ' tokens');
  }
  // Timing: use server duration if final, else live elapsed
  if (lastAi._usage && lastAi._usage.duration_ms) {
    const ms = lastAi._usage.duration_ms;
    parts.push(ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms');
  } else if (_chatStreamStart) {
    const elapsed = Date.now() - _chatStreamStart;
    parts.push(elapsed >= 1000 ? (elapsed / 1000).toFixed(1) + 's' : elapsed + 'ms');
  }
  // Model name
  if (lastAi._usage && lastAi._usage.model) parts.push(lastAi._usage.model);
  statsEl.textContent = parts.join(' \u00B7 ');
}

function _sendPopupChatToSidebar() {
  // Copy popup messages into sidebar doc chat and persist
  for (const m of _popupChatMessages) {
    _docChatMessages.push({ role: m.role, content: m.content });
    _appendToActiveThread(_chatUrl(), { role: m.role, content: m.content, ts: Date.now() });
  }
  renderDocChatMessages(true);
  switchSidebarTab('chat');
  // Dismiss popup
  const popup = document.getElementById('doc-chat-ask-float');
  if (popup) popup.remove();
  _popupChatMessages = [];
  _pendingScreenshots = [];
  _pendingNoteContexts = [];
  _pendingTabContexts = [];
  if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
}

function _saveChatAsHighlight(popup) {
  if (!_popupChatMessages.length) return;
  const range = popup._savedRange;
  if (!range || typeof createHighlight !== 'function') return;

  const text = range.toString().trim();
  if (!text) return;

  const ancestor = range.commonAncestorContainer;
  const textLayerEl = ancestor.closest
    ? ancestor.closest('.textLayer')
    : ancestor.parentElement?.closest('.textLayer');
  if (!textLayerEl) return;

  const wrapper = textLayerEl.closest('.pdf-page-wrapper');
  if (!wrapper) return;

  const pageNum = parseInt(wrapper.dataset.page);
  const wrapperRect = wrapper.getBoundingClientRect();

  const clientRects = range.getClientRects();
  const rects = [];
  for (let i = 0; i < clientRects.length; i++) {
    const cr = clientRects[i];
    if (cr.width < 1 || cr.height < 1) continue;
    rects.push({
      x: (cr.left - wrapperRect.left) / _pdfScale,
      y: (cr.top - wrapperRect.top) / _pdfScale,
      w: cr.width / _pdfScale,
      h: cr.height / _pdfScale,
    });
  }
  if (!rects.length) return;

  const highlight = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    page: pageNum,
    color: 'blue',
    rects,
    text,
    note: '',
    chat: _popupChatMessages.map(m => ({ role: m.role, content: m.content })),
    createdAt: new Date().toISOString(),
  };

  _pdfHighlights.push(highlight);
  savePdfHighlights();
  renderHighlightRects(wrapper, highlight);
  renderHighlightsPanel();

  _popupChatMessages = [];
  if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
  popup.remove();
  window.getSelection()?.removeAllRanges();
}

function _showChatHighlightPopup(e, hl) {
  // Remove any existing popup
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) existing.remove();
  dismissNotePopup();

  _popupChatMessages = (hl.chat || []).map(m => ({ role: m.role, content: m.content }));

  const popup = document.createElement('div');
  popup.id = 'doc-chat-ask-float';
  popup.className = 'doc-selection-popup has-chat';
  popup._chatHighlight = hl;

  // Context quote
  const chatArea = document.createElement('div');
  chatArea.className = 'doc-popup-chat-area visible';
  const chatContext = document.createElement('div');
  chatContext.className = 'doc-popup-chat-context';
  const contextTrunc = hl.text.length > 120 ? hl.text.slice(0, 120) + '…' : hl.text;
  chatContext.textContent = contextTrunc;
  chatArea.appendChild(chatContext);

  const chatMsgs = document.createElement('div');
  chatMsgs.className = 'doc-popup-chat-messages';
  chatArea.appendChild(chatMsgs);

  // Actions
  const chatActions = document.createElement('div');
  chatActions.className = 'doc-popup-chat-actions';
  const openSidebarBtn = document.createElement('button');
  openSidebarBtn.textContent = 'Open in sidebar';
  openSidebarBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  openSidebarBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _sendPopupChatToSidebar();
  });
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  deleteBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    deleteHighlight(hl.id);
    _popupChatMessages = [];
    popup.remove();
  });
  chatActions.appendChild(openSidebarBtn);
  const statsSpanHl = document.createElement('span');
  statsSpanHl.className = 'doc-chat-stats';
  chatActions.appendChild(statsSpanHl);
  chatActions.appendChild(deleteBtn);
  chatArea.appendChild(chatActions);
  popup.appendChild(chatArea);

  // Ask input for follow-ups
  const askWrap = document.createElement('div');
  askWrap.className = 'doc-ask-inline-wrap';
  const askInput = document.createElement('input');
  askInput.type = 'text';
  askInput.placeholder = 'Ask follow-up…';
  askInput.className = 'doc-ask-inline-input';
  const sendBtn = document.createElement('button');
  sendBtn.className = 'doc-ask-inline-send';
  sendBtn.innerHTML = '↑';
  sendBtn.title = 'Send';
  sendBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  sendBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; _renderPopupChat(popup, true); return; }
    _sendPopupChatMessage(popup, hl.text);
  });
  askInput.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      _sendPopupChatMessage(popup, hl.text);
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _aetherPinned = false;
      _savePopupChatToHighlight(popup);
      popup.remove();
      _aetherShowCursor();
      _aetherRestoreFocus();
    }
  });
  askInput.addEventListener('mousedown', (ev) => ev.stopPropagation());
  askWrap.appendChild(askInput);
  askWrap.appendChild(sendBtn);
  popup.appendChild(askWrap);

  // Prevent popup from being dismissed by the selection mousedown handler
  popup.addEventListener('mousedown', (ev) => ev.stopPropagation());

  document.body.appendChild(popup);

  // Render loaded messages
  _renderPopupChat(popup, true);

  // Position above the highlight rects
  const hlRects = document.querySelectorAll(`.pdf-highlight-rect[data-highlight-id="${hl.id}"]`);
  let hlTop = Infinity, hlBottom = -Infinity, hlLeft = Infinity;
  hlRects.forEach(r => {
    const br = r.getBoundingClientRect();
    if (br.top < hlTop) hlTop = br.top;
    if (br.bottom > hlBottom) hlBottom = br.bottom;
    if (br.left < hlLeft) hlLeft = br.left;
  });
  // Fallback to click position if rects not found
  if (hlTop === Infinity) { hlTop = e.clientY; hlBottom = e.clientY; hlLeft = e.clientX; }

  const popupRect = popup.getBoundingClientRect();
  let top = hlTop - popupRect.height - 8;
  const fitsAbove = top >= 4;
  if (!fitsAbove) top = hlBottom + 8;
  let left = hlLeft;
  if (left + popupRect.width > window.innerWidth - 8) left = window.innerWidth - popupRect.width - 8;
  if (left < 4) left = 4;
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  popup._anchorTop = hlTop;
  popup._anchorBottom = hlBottom;
  popup._anchorLeft = hlLeft;
  popup._aboveSelection = fitsAbove;

  setTimeout(() => askInput.focus(), 10);
}

function _savePopupChatToHighlight(popup) {
  const hl = popup && popup._chatHighlight;
  if (hl && _popupChatMessages.length) {
    hl.chat = _popupChatMessages.map(m => ({ role: m.role, content: m.content }));
    savePdfHighlights();
  }
  _popupChatMessages = [];
}

async function _findReferenceTextAsync(refNum) {
  // Extract text from the last pages of the PDF to find the reference
  if (typeof _pdfDoc === 'undefined' || !_pdfDoc) return null;
  const total = _pdfDoc.numPages;
  // Search last 5 pages (references are usually at the end)
  const startPage = Math.max(1, total - 4);

  let allText = '';
  for (let p = startPage; p <= total; p++) {
    try {
      const page = await _pdfDoc.getPage(p);
      const content = await page.getTextContent();
      // Join items without extra spaces — PDF.js items already include trailing spaces
      const pageText = content.items.map(item => item.str + (item.hasEOL ? '\n' : '')).join('');
      allText += pageText + '\n';
    } catch (e) { /* skip */ }
  }

  if (!allText) return null;
  return _extractRefFromText(refNum, allText) || _extractRefGlobal(refNum, allText);
}

function _showReferencePopup(refNum, anchorEl) {
  // Remove any existing popup
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) existing.remove();
  if (typeof dismissCitationPopup === 'function') dismissCitationPopup();

  _popupChatMessages = [];
  if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }

  const popup = document.createElement('div');
  popup.id = 'doc-chat-ask-float';
  popup.className = 'doc-selection-popup';
  popup.style.visibility = 'hidden';

  // -- Reference info area (loading initially) --
  const refInfo = document.createElement('div');
  refInfo.className = 'doc-ref-info';
  refInfo.innerHTML = `<div class="doc-ref-loading"><span class="spinner"></span> Looking up [${refNum}]…</div>`;
  popup.appendChild(refInfo);

  // -- Ask input + send button --
  const askWrap = document.createElement('div');
  askWrap.className = 'doc-ask-inline-wrap';
  const askInput = document.createElement('input');
  askInput.type = 'text';
  askInput.placeholder = 'Ask about this reference…';
  askInput.className = 'doc-ask-inline-input';
  askInput.disabled = true; // Enabled once reference loads
  const sendBtn = document.createElement('button');
  sendBtn.className = 'doc-ask-inline-send';
  sendBtn.innerHTML = '↑';
  sendBtn.title = 'Send';
  sendBtn.disabled = true;

  // We'll store the context text for chat once the reference loads
  let refContextText = `Reference [${refNum}]`;

  sendBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  sendBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; _renderPopupChat(popup, true); return; }
    _sendPopupChatMessage(popup, refContextText);
  });
  askInput.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      _sendPopupChatMessage(popup, refContextText);
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _aetherPinned = false;
      popup.remove();
      _aetherShowCursor();
      _aetherRestoreFocus();
    }
  });
  askInput.addEventListener('mousedown', (ev) => ev.stopPropagation());

  // -- Inline chat area (hidden until first message) --
  const chatArea = document.createElement('div');
  chatArea.className = 'doc-popup-chat-area';
  const chatMsgs = document.createElement('div');
  chatMsgs.className = 'doc-popup-chat-messages';
  chatArea.appendChild(chatMsgs);
  const chatActions = document.createElement('div');
  chatActions.className = 'doc-popup-chat-actions';
  const openSidebarBtn = document.createElement('button');
  openSidebarBtn.textContent = 'Open in sidebar';
  openSidebarBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  openSidebarBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _sendPopupChatToSidebar();
  });
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  clearBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _popupChatMessages = [];
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    chatMsgs.innerHTML = '';
    chatArea.classList.remove('visible');
    popup.classList.remove('has-chat');
    _repositionSelectionPopup();
  });
  chatActions.appendChild(openSidebarBtn);
  const statsSpan2 = document.createElement('span');
  statsSpan2.className = 'doc-chat-stats';
  chatActions.appendChild(statsSpan2);
  chatActions.appendChild(clearBtn);
  chatArea.appendChild(chatActions);
  popup.appendChild(chatArea);

  // Ask input always at the bottom
  askWrap.appendChild(askInput);
  askWrap.appendChild(sendBtn);
  popup.appendChild(askWrap);

  popup.addEventListener('mousedown', (ev) => ev.stopPropagation());
  document.body.appendChild(popup);

  // Position above the anchor element
  const anchorRect = anchorEl.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  let top = anchorRect.top - popupRect.height - 8;
  const fitsAbove = top >= 4;
  if (!fitsAbove) top = anchorRect.bottom + 8;
  let left = anchorRect.left;
  if (left + popupRect.width > window.innerWidth - 8) left = window.innerWidth - popupRect.width - 8;
  if (left < 4) left = 4;
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  popup.style.visibility = '';
  popup._anchorTop = anchorRect.top;
  popup._anchorBottom = anchorRect.bottom;
  popup._anchorLeft = anchorRect.left;
  popup._aboveSelection = fitsAbove;

  // Fetch reference data
  const cacheKey = `${_pdfArxivId}:ref:${refNum}`;
  if (_citationCache[cacheKey]) {
    _renderRefInfo(refInfo, _citationCache[cacheKey], refNum, popup);
    refContextText = _buildRefContext(_citationCache[cacheKey], refNum);
    askInput.disabled = false;
    sendBtn.disabled = false;
    _repositionSelectionPopup();
    setTimeout(() => askInput.focus(), 10);
    return;
  }

  // Try sync search first (rendered pages), then async (extract from PDF directly)
  const refText = typeof findReferenceText === 'function' ? findReferenceText(refNum) : null;

  const doLookup = (query) => {
    fetch('/api/citation-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(data => {
        if (data.error) throw new Error(data.error);
        _citationCache[cacheKey] = data;
        _renderRefInfo(refInfo, data, refNum, popup);
        refContextText = _buildRefContext(data, refNum);
        askInput.disabled = false;
        sendBtn.disabled = false;
        _repositionSelectionPopup();
        setTimeout(() => askInput.focus(), 10);
      })
      .catch(() => {
        // Show the extracted reference text even if the API is down
        refInfo.innerHTML = `<div class="doc-ref-badge">[${refNum}]</div><div class="doc-ref-title" style="font-weight:400">${escapeHtml(query)}</div><div class="doc-ref-meta" style="color:var(--text-dimmer)">Semantic Scholar unavailable</div>`;
        refContextText = `Reference [${refNum}]: ${query}`;
        askInput.disabled = false;
        sendBtn.disabled = false;
        _repositionSelectionPopup();
        setTimeout(() => askInput.focus(), 10);
      });
  };

  const showNotFound = () => {
    refInfo.innerHTML = `<div class="doc-ref-error">Could not find [${refNum}]</div>`;
    askInput.disabled = false;
    sendBtn.disabled = false;
    _repositionSelectionPopup();
  };

  if (refText) {
    doLookup(refText);
  } else {
    // Async fallback: extract text from last pages of PDF to find reference
    _findReferenceTextAsync(refNum).then(asyncRefText => {
      if (asyncRefText) {
        doLookup(asyncRefText);
      } else {
        showNotFound();
      }
    }).catch(() => showNotFound());
  }
}

function _renderRefInfo(container, data, refNum, popup) {
  const authors = data.authors?.length
    ? data.authors.slice(0, 3).join(', ') + (data.authors.length > 3 ? ' et al.' : '')
    : '';
  const abstract = data.abstract ? (data.abstract.length > 150 ? data.abstract.slice(0, 150) + '…' : data.abstract) : '';

  let html = refNum != null ? `<div class="doc-ref-badge">[${refNum}]</div>` : '';
  html += `<div class="doc-ref-title">${escapeHtml(data.title || 'Unknown')}</div>`;
  if (authors || data.year) {
    html += `<div class="doc-ref-meta">`;
    if (authors) html += `<span>${escapeHtml(authors)}</span>`;
    if (data.venue) html += `<span> · ${escapeHtml(data.venue)}</span>`;
    if (data.year) html += `<span> · ${data.year}</span>`;
    html += `</div>`;
  }
  if (abstract) html += `<div class="doc-ref-abstract">${escapeHtml(abstract)}</div>`;
  html += `<div class="doc-ref-footer">`;
  html += `<span class="doc-ref-cited">Cited by ${fmtNum(data.citationCount)}</span>`;
  if (data.url) html += `<a class="doc-ref-link" href="${escapeHtml(data.url)}" data-external-link>View paper →</a>`;
  // Open in viewer if it has an arXiv ID
  if (data.arxivId) {
    html += `<a class="doc-ref-link" href="#view/${encodeURIComponent('https://arxiv.org/abs/' + data.arxivId)}" data-ref-nav>Open →</a>`;
  }
  html += `</div>`;
  container.innerHTML = html;
  // External links: explicit window.open to guarantee new browser tab
  container.querySelectorAll('[data-external-link]').forEach(a => {
    a.addEventListener('mousedown', (ev) => ev.stopPropagation());
    a.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      window.open(a.getAttribute('href'), '_blank');
    });
  });
  // In-app navigation links
  container.querySelectorAll('[data-ref-nav]').forEach(a => {
    a.addEventListener('mousedown', (ev) => ev.stopPropagation());
    a.addEventListener('click', (ev) => {
      ev.stopPropagation();
      document.getElementById('doc-chat-ask-float')?.remove();
    });
  });
}

function _buildRefContext(data, refNum) {
  let ctx = refNum != null ? `Reference [${refNum}]` : 'Paper';
  if (data.title) ctx += `: "${data.title}"`;
  if (data.authors?.length) ctx += ` by ${data.authors.slice(0, 3).join(', ')}`;
  if (data.year) ctx += ` (${data.year})`;
  if (data.abstract) ctx += `\n\nAbstract: ${data.abstract.slice(0, 300)}`;
  return ctx;
}

// Position a popup so one of its four corners is at (cx, cy), picking the best
// corner that keeps it within bounds. preferLeft = bottom-right corner at cursor.
function _positionAtCursor(cx, cy, w, h, preferLeft) {
  const bounds = _popupSafeBounds();
  // Try preferred placement first, then flip axes as needed
  let left, top;
  const fitsLeft  = cx - w >= bounds.left;
  const fitsRight = cx + w <= bounds.right;
  const fitsAbove = cy - h >= bounds.top;
  const fitsBelow = cy + h <= bounds.bottom;

  // Horizontal: prefer putting panel on the preferred side of cursor
  if (preferLeft) {
    left = fitsLeft ? cx - w : cx;  // left of cursor, else right
  } else {
    left = fitsRight ? cx : cx - w; // right of cursor, else left
  }
  // Vertical: prefer above cursor, else below
  top = fitsAbove ? cy - h : cy;

  return { left, top };
}

function _repositionSelectionPopup() {
  const popup = document.getElementById('doc-chat-ask-float');
  if (!popup) return;
  const rect = popup.getBoundingClientRect();

  // Tab context panel: anchor top-left below the tab
  if (popup._tabContextAnchor) {
    let left = popup._tabContextAnchor.left;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    popup.style.top = popup._tabContextAnchor.top + 'px';
    popup.style.left = left + 'px';
    return;
  }

  // Aether panel: position relative to stored mouse position
  if (popup._isAetherPanel) {
    const anchorX = popup._aetherAnchorX ?? _lastMouseX;
    const anchorY = popup._aetherAnchorY ?? _lastMouseY;
    const preferLeft = (localStorage.getItem('aetherPanelSide') || 'left') === 'left';
    const pos = _positionAtCursor(anchorX, anchorY, rect.width, rect.height, preferLeft);
    popup.style.top = pos.top + 'px';
    popup.style.left = pos.left + 'px';
    return;
  }

  // Re-anchor relative to stored selection position so popup grows upward
  const bounds = _popupSafeBounds();
  let top;
  if (popup._aboveSelection) {
    top = popup._anchorTop - rect.height - 8;
    if (top < bounds.top) {
      top = popup._anchorBottom + 8;
      popup._aboveSelection = false;
    }
  } else {
    top = popup._anchorBottom + 8;
  }
  if (top + rect.height > bounds.bottom - 8) {
    top = bounds.bottom - rect.height - 8;
  }
  if (top < bounds.top) top = bounds.top;

  let left = popup._anchorLeft || parseFloat(popup.style.left);
  if (left + rect.width > bounds.right - 8) left = bounds.right - rect.width - 8;
  if (left < bounds.left) left = bounds.left;

  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
}

// Text selection → floating popup; drag-to-screenshot when aether panel is open
let _selPopupDragging = false;

document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing.contains(e.target)) {
    return;
  }
  // In track mode with captureScreen available: start screenshot drag
  if (existing && _aetherTrackMode && (window.electronAPI?.captureScreen || typeof html2canvas !== 'undefined')) {
    e.preventDefault(); // prevent text selection during drag
    e.stopImmediatePropagation(); // prevent other mousedown handlers from running
    _aetherTrackModeVal = false; // bypass setter — keep iframes disabled during drag
    _screenshotCapturing = true; // protect panel from removal throughout entire drag+capture
    _screenshotDragStart = { x: e.clientX, y: e.clientY };
    // Create selection rect + dim overlay elements
    _screenshotDim = document.createElement('div');
    _screenshotDim.className = 'screenshot-dim';
    document.body.appendChild(_screenshotDim);
    _screenshotSelection = document.createElement('div');
    _screenshotSelection.className = 'screenshot-selection';
    document.body.appendChild(_screenshotSelection);
    return;
  }
  // If NOT in track mode and not pinned, remove existing panel
  if (existing && !_aetherTrackMode && !_screenshotCapturing && !_aetherPinned) {
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    _savePopupChatToHighlight(existing);
    existing.remove();
  }
  // Skip interactive elements and navigation
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
  if (e.target.isContentEditable) return;
  if (e.target.closest('#sidebar-nav')) return;
  if (e.target.closest('#browse-bar')) return;
  if (e.target.closest('.doc-selection-popup')) return;
  if (e.target.closest('a[href]')) return;
  if (e.target.closest('[onclick]')) return;
  _selPopupDragging = true;
});

document.addEventListener('selectionchange', function() {
  if (!_selPopupDragging) return;
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 3 || sel.rangeCount === 0) return;
  // User is actively selecting text — stop tracking, show selection preview
  _aetherTrackMode = false;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing._isAetherPanel) existing.remove();
  const range = sel.getRangeAt(0);
  _showPanel({ anchor: { selectionRect: range.getBoundingClientRect() }, selectionText: text, finalized: false });
});

document.addEventListener('mouseup', async function(e) {
  // Screenshot drag completion
  if (_screenshotDragStart) {
    e.stopImmediatePropagation(); // prevent other mouseup handlers
    // Suppress the click event that follows mouseup
    document.addEventListener('click', function suppress(ce) { ce.stopImmediatePropagation(); }, { once: true, capture: true });
    const startPos = _screenshotDragStart;
    _screenshotDragStart = null;
    const x = Math.min(e.clientX, startPos.x);
    const y = Math.min(e.clientY, startPos.y);
    const w = Math.abs(e.clientX - startPos.x);
    const h = Math.abs(e.clientY - startPos.y);
    // Restore iframe pointer events and remove selection visuals before capture
    _screenshotRestoreIframes();
    if (_screenshotSelection) { _screenshotSelection.remove(); _screenshotSelection = null; }
    if (_screenshotDim) { _screenshotDim.remove(); _screenshotDim = null; }
    if (w >= 10 && h >= 10 && (window.electronAPI?.captureScreen || typeof html2canvas !== 'undefined')) {
      // Small delay so overlay removal renders before capture
      await new Promise(r => setTimeout(r, 50));
      try {
        const popup = document.getElementById('doc-chat-ask-float');
        const base64 = window.electronAPI?.captureScreen
          ? await window.electronAPI.captureScreen({ x, y, width: w, height: h })
          : await _browserCaptureRect({ x, y, width: w, height: h });
        if (base64 && popup) {
          _addScreenshotToPanel(popup, base64);
        }
      } catch (err) {
        console.error('Screenshot capture failed:', err);
      }
    }
    _screenshotCapturing = false;
    return;
  }

  if (!_selPopupDragging) return;
  _selPopupDragging = false;

  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;

  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  if (text && text.length >= 3 && sel.rangeCount > 0) {
    // Text was selected → finalize selection popup
    _aetherTrackMode = false;
    const range = sel.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const inTextLayer = ancestor.closest ? !!ancestor.closest('.textLayer') : !!(ancestor.parentElement && ancestor.parentElement.closest('.textLayer'));
    _showPanel({ anchor: { selectionRect: range.getBoundingClientRect() }, selectionText: text, selectionRange: range.cloneRange(), inTextLayer, finalized: true });
    return;
  }

  // Single click, no selection → dismiss existing panel
  if (_screenshotCapturing) return;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing.contains(e.target)) return; // click was inside the panel
  if (existing) { existing.remove(); _aetherTrackMode = false; _aetherPinned = false; }
});

function _postQuoteText(text) {
  const paper = _currentPaperViewPaper;
  if (!paper || !text) return;
  const quotes = JSON.parse(localStorage.getItem('userQuotes') || '[]');
  quotes.push({
    id: 'q-' + Date.now(),
    quote: text,
    link: paper.link,
    title: paper.title,
    source: 'quote',
    pubDate: new Date().toISOString()
  });
  localStorage.setItem('userQuotes', JSON.stringify(quotes));
  // Brief toast
  const toast = document.createElement('div');
  toast.className = 'doc-selection-popup';
  toast.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);padding:6px 14px;font-size:0.78rem;pointer-events:none;';
  toast.textContent = 'Quote posted to feed';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}

async function _showWordAether(word, x, y) {
  const panel = document.createElement('div');
  panel.id = 'doc-chat-ask-float';
  panel.className = 'doc-aether-panel';
  // Position near selection, clamp to viewport
  const left = Math.min(x, window.innerWidth - 340);
  const top = Math.min(Math.max(y, 10), window.innerHeight - 300);
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
  panel.innerHTML = '<div class="flex items-center gap-2 text-[0.75rem] text-dim py-2 px-3"><span class="spinner"></span>Looking up…</div>';
  document.body.appendChild(panel);

  try {
    const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
    if (!resp.ok) throw new Error('Not found');
    const data = await resp.json();
    const entry = data[0];

    let html = '<div class="px-3 py-2.5">';
    // Word + phonetic
    html += `<div class="text-[1rem] font-bold text-primary">${escapeHtml(entry.word)}</div>`;
    const phonetic = entry.phonetics?.find(p => p.text)?.text;
    if (phonetic) html += `<div class="text-[0.78rem] text-dim mt-0.5">${escapeHtml(phonetic)}</div>`;

    // Meanings
    for (const meaning of (entry.meanings || []).slice(0, 3)) {
      html += `<div class="mt-2"><span class="text-[0.68rem] font-semibold text-accent uppercase tracking-wide">${escapeHtml(meaning.partOfSpeech)}</span></div>`;
      for (const def of (meaning.definitions || []).slice(0, 2)) {
        html += `<div class="text-[0.78rem] text-primary leading-relaxed mt-1 pl-2 border-l-2 border-accent/30">${escapeHtml(def.definition)}</div>`;
        if (def.example) html += `<div class="text-[0.72rem] text-dim italic mt-0.5 pl-2">${escapeHtml(def.example)}</div>`;
      }
    }

    html += '</div>';
    panel.innerHTML = html;
  } catch (e) {
    panel.innerHTML = `<div class="px-3 py-2.5"><div class="text-[1rem] font-bold text-primary">${escapeHtml(word)}</div><div class="text-[0.78rem] text-dim mt-1">No definition found.</div></div>`;
  }
}

// Any left-click dismisses the aether panel (capture phase to bypass stopPropagation)
document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  if (_screenshotDragStart || _screenshotCapturing) return;
  const btn = document.getElementById('doc-chat-ask-float');
  if (!btn) return;
  // Pinned panels survive all clicks (drag, inputs, buttons, click-away)
  if (_aetherPinned) return;
  // Clicks inside the panel should not dismiss it
  if (btn.contains(e.target)) return;
  if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
  _savePopupChatToHighlight(btn);
  btn.remove();
  _aetherShowCursor();
}, true);

// Aether panel: tracks cursor + screenshot drag
document.addEventListener('mousemove', function(e) {
  _lastMouseX = e.clientX;
  _lastMouseY = e.clientY;

  // Screenshot drag in progress
  if (_screenshotDragStart && _screenshotSelection && _screenshotDim) {
    const sx = Math.min(e.clientX, _screenshotDragStart.x);
    const sy = Math.min(e.clientY, _screenshotDragStart.y);
    const sw = Math.abs(e.clientX - _screenshotDragStart.x);
    const sh = Math.abs(e.clientY - _screenshotDragStart.y);
    _screenshotSelection.style.display = 'block';
    _screenshotSelection.style.left = sx + 'px';
    _screenshotSelection.style.top = sy + 'px';
    _screenshotSelection.style.width = sw + 'px';
    _screenshotSelection.style.height = sh + 'px';
    const vw = window.innerWidth, vh = window.innerHeight;
    _screenshotDim.style.clipPath = `polygon(0 0,${vw}px 0,${vw}px ${vh}px,0 ${vh}px,0 0,${sx}px ${sy}px,${sx}px ${sy+sh}px,${sx+sw}px ${sy+sh}px,${sx+sw}px ${sy}px,${sx}px ${sy}px)`;
    return;
  }

  // Drag-to-move the aether panel
  if (_aetherDragging) {
    const popup = _aetherDragPopup || document.getElementById('doc-chat-ask-float');
    if (!popup) { _aetherDragging = false; _aetherDragPopup = null; return; }
    const bounds = _popupSafeBounds();
    let left = e.clientX - _aetherDragOffset.x;
    let top = e.clientY - _aetherDragOffset.y;
    if (left < bounds.left) left = bounds.left;
    if (top < bounds.top) top = bounds.top;
    if (left + popup.offsetWidth > bounds.right) left = bounds.right - popup.offsetWidth;
    if (top + popup.offsetHeight > bounds.bottom) top = bounds.bottom - popup.offsetHeight;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup._aetherAnchorX = left;
    popup._aetherAnchorY = top + popup.offsetHeight;
    return;
  }

  if (!_aetherTrackMode) return;
  const popup = document.getElementById('doc-chat-ask-float');
  if (!popup) { _aetherTrackMode = false; return; }

  // Snap to sidebar icon if hovering over one
  const hovered = e.target.closest && e.target.closest('.sidebar-icon');
  if (hovered) {
    const rect = hovered.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.bottom + 6;
    popup._aetherAnchorX = cx;
    popup._aetherAnchorY = cy;
    const pw = popup.offsetWidth;
    popup.style.left = Math.max(4, cx - pw / 2) + 'px';
    popup.style.top = cy + 'px';
    // Inject/remove profile items when hovering the profile icon
    const isProfile = hovered.id === 'sb-user-avatar';
    const hasProfileItems = !!popup.querySelector('.aether-profile-items');
    if (isProfile && !hasProfileItems) {
      _injectProfileItems(popup);
    } else if (!isProfile && hasProfileItems) {
      const pi = popup.querySelector('.aether-profile-items');
      if (pi) pi.remove();
    }
    return;
  }
  // Remove profile items when cursor leaves sidebar icons
  const pi = popup.querySelector('.aether-profile-items');
  if (pi) pi.remove();

  popup._aetherAnchorX = e.clientX;
  popup._aetherAnchorY = e.clientY;
  const preferLeft = (localStorage.getItem('aetherPanelSide') || 'left') === 'left';
  const pos = _positionAtCursor(e.clientX, e.clientY, popup.offsetWidth, popup.offsetHeight, preferLeft);
  popup.style.left = pos.left + 'px';
  popup.style.top = pos.top + 'px';
});

// End drag-to-move
document.addEventListener('mouseup', function(e) {
  if (_aetherDragging) {
    _aetherDragging = false;
    const draggedPopup = _aetherDragPopup;
    _aetherDragPopup = null;
    const topBar = draggedPopup ? draggedPopup.querySelector('.aether-top-actions') : document.querySelector('.aether-top-actions');
    if (topBar) topBar.style.cursor = 'grab';
  }
});

// Escape to dismiss from anywhere
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    // Cancel screenshot drag if active
    if (_screenshotDragStart || _screenshotCapturing) {
      _screenshotDragStart = null;
      _screenshotCapturing = false;
      _screenshotRestoreIframes();
      if (_screenshotSelection) { _screenshotSelection.remove(); _screenshotSelection = null; }
      if (_screenshotDim) { _screenshotDim.remove(); _screenshotDim = null; }
      return;
    }
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) {
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _aetherTrackMode = false;
      _aetherPinned = false;
      _pendingScreenshots = [];
      _pendingNoteContexts = [];
      _pendingTabContexts = [];
      popup.remove();
      _aetherShowCursor();
      _aetherRestoreFocus();
    }
  }
  // Shift clicks the element under cursor and dismisses the panel
  if (e.key === 'Shift') {
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup && _aetherTrackMode) {
      _aetherTrackMode = false;
      const el = document.elementFromPoint(_lastMouseX, _lastMouseY);
      if (el && !popup.contains(el)) el.click();
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _pendingScreenshots = [];
      _pendingNoteContexts = [];
      _pendingTabContexts = [];
      popup.remove();
      _aetherShowCursor();
    }
  }
});

// "/" key opens aether panel with "/" pre-filled
document.addEventListener('keydown', function(e) {
  // Cmd+I or Ctrl+I toggles aether panel
  if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
    e.preventDefault();
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) { if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; } popup.remove(); _aetherTrackMode = false; _aetherPinned = false; _aetherShowCursor(); _aetherRestoreFocus(); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    _showPanel({ anchor: { x: _lastMouseX, y: _lastMouseY } });
    return;
  }
  if (e.key !== '/') return;
  // Skip if typing in an input, textarea, or contentEditable
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  // Skip if aether panel already open
  if (document.getElementById('doc-chat-ask-float')) return;
  e.preventDefault();
  // Open centered horizontally, near top of viewport
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  _showPanel({ anchor: { x, y }, initialValue: '/' });
});

// Right-click anywhere opens aether panel
function _handleContextMenuChat(e) {
  if (localStorage.getItem('clickAether') === 'off') return;
  // Don't intercept on login or onboarding screens
  const loginGate = document.getElementById('login-gate');
  if (loginGate && loginGate.style.display !== 'none') return;
  const onboard = document.getElementById('onboard-view');
  if (onboard && onboard.style.display !== 'none') return;
  // Skip if right-clicking inside an existing popup
  const popup = document.getElementById('doc-chat-ask-float');
  if (popup && popup.contains(e.target)) return;
  // Skip if clicking inside the browse URL bar
  if (e.target.id === 'browse-url-input' || e.target.closest('#browse-bar')) return;
  // For inputs/textareas, show panel with paste support instead of native context menu
  const tag = e.target.tagName;
  const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
  if (isEditable) {
    e.preventDefault();
    if (popup) { popup.remove(); _aetherTrackMode = false; }
    const sel = window.getSelection();
    const selectedText = sel && sel.toString().trim() || '';
    _showPanel({ anchor: { x: e.clientX, y: e.clientY }, editableTarget: e.target, selectionText: selectedText, finalized: true });
    return;
  }
  // Intercept right-click on browse tabs for tab context menu
  const browseTab = e.target.closest('.browse-tab, .browse-vtab');
  if (browseTab) {
    e.preventDefault();
    _showTabContextMenu(e, browseTab);
    return;
  }
  // Skip browse view chrome — iframe/webview handles its own context menu
  if (e.target.closest('#browse-bar, #browse-tab-row, #browse-vtabs, #universal-panel')) return;
  // In browse content, skip only iframes/webviews (they have injected handlers)
  const browseContent = e.target.closest('#browse-content');
  if (browseContent && (e.target.tagName === 'IFRAME' || e.target.tagName === 'WEBVIEW')) return;
  e.preventDefault();
  // Capture the previously focused editable element before panel steals focus
  const active = document.activeElement;
  const priorEditable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) ? active : null;
  if (popup) { popup.remove(); _aetherTrackMode = false; }
  _showPanel({ anchor: { x: e.clientX, y: e.clientY }, priorEditable, trackCursor: true });
}
document.addEventListener('contextmenu', _handleContextMenuChat);

// Convert a rect from inside an iframe/webview to parent viewport coordinates
function _iframeRectToParent(r, frame) {
  const f = frame.getBoundingClientRect();
  return { top: r.top + f.top, bottom: r.bottom + f.top, left: r.left + f.left, right: r.right + f.left, width: r.width, height: r.height };
}

// Inject context-menu, text-selection, and keyboard handlers into same-origin iframes
function _injectIframeChatHandler(iframe) {
  const tryInject = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc || doc._chatHandlerInjected) return;
      doc._chatHandlerInjected = true;

      const isInteractive = (el) => {
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || el.isContentEditable;
      };

      // Right-click → aether panel
      doc.addEventListener('contextmenu', function(e) {
        if (localStorage.getItem('clickAether') === 'off') return;
        const f = iframe.getBoundingClientRect();
        const tag = e.target.tagName;
        const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
        if (isEditable) {
          e.preventDefault();
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); _aetherTrackMode = false; }
          const sel = doc.getSelection();
          const selectedText = sel && sel.toString().trim() || '';
          _showPanel({ anchor: { x: e.clientX + f.left, y: e.clientY + f.top }, editableTarget: e.target, selectionText: selectedText, finalized: true });
          return;
        }
        if (isInteractive(e.target)) return;
        e.preventDefault();
        // Capture focused editable inside iframe before panel steals focus
        const active = doc.activeElement;
        const priorEditable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) ? active : null;
        const popup = document.getElementById('doc-chat-ask-float');
        if (popup) { popup.remove(); _aetherTrackMode = false; }
        // Detect link/image targets for context menu
        const linkEl = e.target.closest('a[href]');
        const imgEl = e.target.tagName === 'IMG' ? e.target : e.target.closest('img');
        const contextMenu = (linkEl || imgEl) ? {
          linkUrl: linkEl ? linkEl.href : '',
          linkText: linkEl ? (linkEl.textContent || '').trim() : '',
          imgUrl: imgEl ? imgEl.src : ''
        } : null;
        _showPanel({ anchor: { x: e.clientX + f.left, y: e.clientY + f.top }, priorEditable, contextMenu, trackCursor: !contextMenu });
      });

      // Text selection → selection popup
      let dragging = false;
      doc.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        const existing = document.getElementById('doc-chat-ask-float');
        if (existing && existing.contains(e.target)) return;
        if (existing && !_aetherTrackMode) {
          if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
          _savePopupChatToHighlight(existing);
          existing.remove();
        }
        if (!isInteractive(e.target)) dragging = true;
      });
      doc.addEventListener('selectionchange', function() {
        if (!dragging) return;
        const sel = doc.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (!text || text.length < 3 || sel.rangeCount === 0) return;
        _aetherTrackMode = false;
        const existing = document.getElementById('doc-chat-ask-float');
        if (existing && existing._isAetherPanel) existing.remove();
        _showPanel({ anchor: { selectionRect: _iframeRectToParent(sel.getRangeAt(0).getBoundingClientRect(), iframe) }, selectionText: text, finalized: false });
      });
      doc.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        const sel = doc.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (text && text.length >= 3 && sel.rangeCount > 0) {
          _aetherTrackMode = false;
          _showPanel({ anchor: { selectionRect: _iframeRectToParent(sel.getRangeAt(0).getBoundingClientRect(), iframe) }, selectionText: text, finalized: true });
          return;
        }
        const existing = document.getElementById('doc-chat-ask-float');
        if (existing) { existing.remove(); _aetherTrackMode = false; _aetherPinned = false; }
      });

      // Cmd+click → open link in new tab
      doc.addEventListener('click', function(e) {
        if (!(e.metaKey || e.ctrlKey)) return;
        const a = e.target.closest('a');
        if (!a || !a.href) return;
        e.preventDefault();
        e.stopPropagation();
        window.top.open(a.href, '_blank');
      }, true);

      // Keyboard shortcuts
      doc.addEventListener('keydown', function(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
          e.preventDefault();
          if (typeof _browseToggleFindBar === 'function') _browseToggleFindBar();
        }
        if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          if (e.key === 'ArrowLeft') { e.preventDefault(); if (typeof _switchTabLeft === 'function') _switchTabLeft(); }
          if (e.key === 'ArrowRight') { e.preventDefault(); if (typeof _switchTabRight === 'function') _switchTabRight(); }
        }
      });
    } catch (e) {
      // Cross-origin — can't inject (webview uses executeJavaScript path instead)
    }
  };
  iframe.addEventListener('load', tryInject);
  tryInject();
}

// ── Screenshot drag-to-capture ──
// State for drag-to-screenshot (active when aether panel is open)
let _screenshotDragStart = null; // {x, y} or null
let _screenshotSelection = null; // DOM element
let _screenshotDim = null; // DOM element
let _screenshotCapturing = false; // true while capture is in progress

function _screenshotRestoreIframes() {
  document.querySelectorAll('iframe, webview').forEach(f => {
    if ('peTrack' in f.dataset) {
      f.style.pointerEvents = f.dataset.peTrack;
      delete f.dataset.peTrack;
    }
  });
}


async function _browserCaptureRect(rect) {
  const { x, y, width, height } = rect;
  const cx = x + width / 2, cy = y + height / 2;
  const el = document.elementFromPoint(cx, cy);
  try {
    // If the center point is over a canvas (PDF page), crop directly
    const canvas = el?.closest('canvas') || (el?.tagName === 'CANVAS' ? el : null);
    if (canvas) {
      const cr = canvas.getBoundingClientRect();
      const scaleX = canvas.width / cr.width, scaleY = canvas.height / cr.height;
      const sx = (x - cr.left) * scaleX, sy = (y - cr.top) * scaleY;
      const sw = width * scaleX, sh = height * scaleY;
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(sw); tmp.height = Math.round(sh);
      tmp.getContext('2d').drawImage(canvas, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, tmp.width, tmp.height);
      return tmp.toDataURL('image/png').split(',')[1];
    }
    // If over an iframe, try to capture its content document
    const iframe = el?.closest('iframe') || (el?.tagName === 'IFRAME' ? el : null);
    if (iframe && iframe.contentDocument) {
      const ir = iframe.getBoundingClientRect();
      const full = await html2canvas(iframe.contentDocument.body, { useCORS: true, scale: window.devicePixelRatio || 1 });
      const scaleX = full.width / ir.width, scaleY = full.height / ir.height;
      const sx = (x - ir.left) * scaleX, sy = (y - ir.top) * scaleY;
      const sw = width * scaleX, sh = height * scaleY;
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(sw); tmp.height = Math.round(sh);
      tmp.getContext('2d').drawImage(full, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, tmp.width, tmp.height);
      return tmp.toDataURL('image/png').split(',')[1];
    }
    // Fallback: capture body and crop
    const full = await html2canvas(document.body, { useCORS: true, scale: window.devicePixelRatio || 1 });
    const scaleX = full.width / window.innerWidth, scaleY = full.height / window.innerHeight;
    const sx = x * scaleX, sy = y * scaleY;
    const sw = width * scaleX, sh = height * scaleY;
    const tmp = document.createElement('canvas');
    tmp.width = Math.round(sw); tmp.height = Math.round(sh);
    tmp.getContext('2d').drawImage(full, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, tmp.width, tmp.height);
    return tmp.toDataURL('image/png').split(',')[1];
  } catch (err) {
    console.error('Browser screenshot capture failed:', err);
    return null;
  }
}

function _addNoteContextToPanel(popup, note) {
  // Don't add duplicate
  if (_pendingNoteContexts.some(n => n.id === note.id)) return;
  _pendingNoteContexts.push({ id: note.id, title: note.title, content: note.content || '' });

  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (!strip) return;
  strip.style.display = 'flex';

  const chip = document.createElement('div');
  chip.className = 'doc-note-context-chip';
  chip.dataset.noteId = note.id;
  chip.innerHTML = `<svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>` +
    `<span class="truncate">${escapeHtml(note.title || 'Untitled')}</span>`;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'doc-note-context-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  removeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    _pendingNoteContexts = _pendingNoteContexts.filter(n => n.id !== note.id);
    chip.remove();
    if (_pendingNoteContexts.length === 0 && _pendingScreenshots.length === 0) strip.style.display = 'none';
  });
  chip.appendChild(removeBtn);
  strip.appendChild(chip);

  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.focus();
  _updateContextBar(popup);
}

function _addTabContextToPanel(popup, tabInfo) {
  if (_pendingTabContexts.some(t => t.tabId === tabInfo.tabId)) return;
  _pendingTabContexts.push({ tabId: tabInfo.tabId, title: tabInfo.title, url: tabInfo.url, content: tabInfo.content || '' });

  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (!strip) return;
  strip.style.display = 'flex';

  const chip = document.createElement('div');
  chip.className = 'doc-tab-context-chip';
  chip.dataset.tabId = tabInfo.tabId;
  const domain = (() => { try { return new URL(tabInfo.url).hostname.replace('www.', ''); } catch { return ''; } })();
  const favUrl = tabInfo.url ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16` : '';
  chip.innerHTML = (favUrl ? `<img src="${favUrl}" class="w-3 h-3 flex-shrink-0 rounded-sm" onerror="this.style.display='none'">` :
    `<svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>`) +
    `<span class="truncate">${escapeHtml(tabInfo.title || domain || 'Tab')}</span>`;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'doc-note-context-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  removeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    _pendingTabContexts = _pendingTabContexts.filter(t => t.tabId !== tabInfo.tabId);
    chip.remove();
    if (_pendingTabContexts.length === 0 && _pendingNoteContexts.length === 0 && _pendingScreenshots.length === 0) strip.style.display = 'none';
  });
  chip.appendChild(removeBtn);
  strip.appendChild(chip);

  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.focus();
  _updateContextBar(popup);
}

function _showTabContextMenu(e, tabEl) {
  const tid = tabEl.dataset.tabId || (() => { const m = (tabEl.getAttribute('onclick') || '').match(/browseSelectTab\((\d+)\)/); return m ? m[1] : null; })();
  if (!tid) return;
  const tabId = parseInt(tid);
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab) return;

  const isActive = win.activeTab === tabId;
  const domain = (() => { try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; } })();
  const items = [];
  const isPinned = !!tab.pinned;
  const inGroup = tab.groupId != null;
  const groups = win.groups || [];

  // Header: title (+ domain for background tabs)
  const headerLabel = (tab.title || 'Tab') + (!isActive && domain ? ' · ' + domain : '');
  const memMB = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB' : '';
  items.push({ label: headerLabel, info: true, subtext: memMB, fn() {} });

  items.push({ sep: true });

  // Add to assistant
  items.push({
    label: 'Add to assistant',
    icon: '<svg class="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"/></svg>',
    fn() {
      (async () => {
        try {
          const resp = await fetch('/api/extract-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: tab.url })
          });
          const data = await resp.json();
          const content = data.text || '';
          let aetherPanel = document.getElementById('doc-chat-ask-float');
          if (!aetherPanel && typeof _showPanel === 'function') {
            _showPanel({ anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 } });
            aetherPanel = document.getElementById('doc-chat-ask-float');
          }
          if (aetherPanel && typeof _addTabContextToPanel === 'function') {
            _addTabContextToPanel(aetherPanel, { tabId: tab.id, title: tab.title, url: tab.url, content });
          }
        } catch (err) {
          console.warn('Failed to extract tab context:', err);
        }
      })();
    }
  });

  items.push({ sep: true });

  // Pin / Unpin
  items.push({ label: isPinned ? 'Unpin tab' : 'Pin tab', fn() { browseTogglePin(tabId); } });

  // Group management
  if (!isPinned) {
    items.push({ label: 'Add to new group', fn() { browseAddTabToNewGroup(tabId); } });
    for (const g of groups) {
      if (g.id === tab.groupId) continue;
      const gc = typeof _BROWSE_GROUP_COLOR_MAP !== 'undefined' ? (_BROWSE_GROUP_COLOR_MAP[g.color] || g.color) : g.color;
      items.push({ label: g.name, colorDot: gc, fn() { browseAddTabToGroup(tabId, g.id); } });
    }
    if (inGroup) {
      items.push({ label: 'Remove from group', fn() { browseRemoveTabFromGroup(tabId); } });
    }
  }

  // Split tab
  items.push({ label: 'Split tab', fn() { browseSplitTab(tabId, 'right'); } });

  // Reload
  items.push({ label: 'Reload tab', fn() { browseSelectTab(tabId); browseReload(); } });

  // Duplicate Tab
  items.push({ label: 'Duplicate tab', fn() { browseNewTab(tab.url); } });

  // Mute/Unmute (only if tab has audio)
  if (_browseAudioTabs.has(tabId)) {
    const audioInfo = _browseAudioTabs.get(tabId);
    const isMuted = audioInfo && audioInfo.muted;
    items.push({ label: isMuted ? 'Unmute tab' : 'Mute tab', fn() { toggleTabMute(tabId); } });
  }

  items.push({ sep: true });

  // Close Tab
  items.push({ label: 'Close tab', fn() { browseCloseTab(tabId); } });

  // Close other tabs
  items.push({ label: 'Close other tabs', fn() { _browseCloseOtherTabs(tabId); } });

  // Position below the tab, merging seamlessly
  _showPanel({ anchor: { tab: tabEl }, contextMenu: { items } });
}

function _addScreenshotToPanel(popup, base64) {
  _pendingScreenshots.push(base64);

  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (!strip) return;
  strip.style.display = 'flex';

  const thumb = document.createElement('div');
  thumb.className = 'doc-screenshot-thumb';
  const img = document.createElement('img');
  img.src = 'data:image/png;base64,' + base64;
  thumb.appendChild(img);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'doc-screenshot-thumb-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  removeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const idx = _pendingScreenshots.indexOf(base64);
    if (idx !== -1) _pendingScreenshots.splice(idx, 1);
    thumb.remove();
    if (_pendingScreenshots.length === 0) strip.style.display = 'none';
  });
  thumb.appendChild(removeBtn);
  strip.appendChild(thumb);

  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.focus();
  _updateContextBar(popup);
}

// Web search from aether panel (Shift+Enter)
async function _doAetherWebSearch(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';

  // Pin panel if tracking
  _aetherTrackMode = false;

  // Show searching state in chat area
  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: q, _display: q, _isSearch: true });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isSearch: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const resp = await fetch('/api/web-search?q=' + encodeURIComponent(q));
    const data = await resp.json();
    const results = data.results || [];
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx]._searchResults = results;
    _popupChatMessages[aiIdx].content = results.length
      ? results.length + ' result' + (results.length !== 1 ? 's' : '')
      : 'No results found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

// ── Slash commands for aether panel ──

const _aetherCommands = [
  { name: 'bookmark', desc: 'Save page to reading list', fn: () => { if (typeof browseSaveToReadingList === 'function') browseSaveToReadingList(); } },
  { name: 'close', desc: 'Close current tab', fn: () => { if (typeof browseCloseTab === 'function' && typeof _browseActiveTab !== 'undefined') browseCloseTab(_browseActiveTab); } },
  { name: 'reload', desc: 'Reload current page', fn: () => { if (typeof browseReload === 'function') browseReload(); } },
  { name: 'back', desc: 'Go back', fn: () => { if (typeof browseBack === 'function') browseBack(); } },
  { name: 'forward', desc: 'Go forward', fn: () => { if (typeof browseForward === 'function') browseForward(); } },
  { name: 'newtab', desc: 'Open a new tab', fn: () => { if (typeof browseNewTab === 'function') browseNewTab(); } },
  { name: 'copy', desc: 'Copy page URL', fn: () => { const t = typeof _browseTabs !== 'undefined' && _browseTabs.find(t => t.id === _browseActiveTab); if (t) navigator.clipboard.writeText(t.url).catch(() => {}); } },
  { name: 'share', desc: 'Share page', fn: () => { if (typeof browseShare === 'function') browseShare(); } },
  { name: 'mute', desc: 'Mute/unmute tab audio', fn: () => { if (typeof toggleTabMute === 'function' && typeof _browseActiveTab !== 'undefined') toggleTabMute(_browseActiveTab); } },
  { name: 'find', desc: 'Find in page', fn: () => { if (typeof _browseToggleFindBar === 'function') _browseToggleFindBar(); } },
  { name: 'zoomin', desc: 'Zoom in', fn: () => { if (typeof browseZoom === 'function') browseZoom(1); } },
  { name: 'zoomout', desc: 'Zoom out', fn: () => { if (typeof browseZoom === 'function') browseZoom(-1); } },
  { name: 'zoomreset', desc: 'Reset zoom to 100%', fn: () => { if (typeof browseZoom === 'function') browseZoom(0); } },
  { name: 'print', desc: 'Print page', fn: () => { if (typeof browsePrintPage === 'function') browsePrintPage(); } },
  { name: 'note', desc: 'Open in note viewer', fn: () => { if (typeof browseOpenNoteView === 'function') browseOpenNoteView(); } },
  { name: 'paper', desc: 'Search for papers', hasArgs: true },
  { name: 'user', desc: 'Search for users', hasArgs: true },
  { name: 'notes', desc: 'Browse your notes', _special: true },
  { name: 'capture', desc: 'Screenshot the page', _special: true },
  { name: 'model', desc: 'Change chat model', _special: true },
  { name: 'search', desc: 'Web search in new tab', hasArgs: true },
  { name: 'links', desc: 'List all links on page', _special: true },
  { name: 'tab', desc: 'Add a tab to context', _special: true },
  { name: 'tabs', desc: 'Switch to an open tab', _special: true },
  { name: 'define', desc: 'Look up a word definition', hasArgs: true },
  { name: 'quote', desc: 'Post selected text as a quote', fn: () => { const p = document.getElementById('doc-chat-ask-float'); if (p && p._capturedText) _postQuoteText(p._capturedText); } },
  { name: 'upload', desc: 'Open a local file', fn: () => { const fi = document.getElementById('browse-pdf-file-input'); if (fi) { fi.click(); return; } const tmp = document.createElement('input'); tmp.type = 'file'; tmp.style.display = 'none'; tmp.onchange = function() { if (tmp.files[0] && typeof openLocalPdf === 'function') openLocalPdf(tmp.files[0]); tmp.remove(); }; document.body.appendChild(tmp); tmp.click(); } },
  { name: 'history', desc: 'Browse visited sites', _special: true },
  { name: 'help', desc: 'Show all commands & features', _special: true },
];

let _aetherCmdIdx = 0; // selected index in autocomplete
let _aetherNoteIdx = 0; // selected index in note search results
let _aetherNoteResults = []; // current note search results
let _aetherNoteQuery = ''; // current note search query (for create-on-enter)
let _aetherTabIdx = 0; // selected index in tab dropdown
let _aetherTabList = []; // current tab list for /tab command
let _aetherTabSwitchMode = false; // true when /tabs (switch mode) vs /tab (context mode)

function _aetherFilterCommands(query) {
  const q = query.toLowerCase();
  return _aetherCommands.filter(c => c.name.startsWith(q) || c.desc.toLowerCase().includes(q));
}

function _aetherRenderCmdDropdown(popup, query) {
  let dropdown = popup.querySelector('.aether-cmd-dropdown');
  const matches = _aetherFilterCommands(query);
  if (!matches.length) {
    if (dropdown) dropdown.remove();
    return;
  }
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'aether-cmd-dropdown';
    dropdown.addEventListener('mousedown', (ev) => ev.stopPropagation());
    // Insert before askWrap
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  _aetherCmdIdx = Math.min(_aetherCmdIdx, matches.length - 1);
  dropdown.innerHTML = matches.map((c, i) =>
    `<div class="aether-cmd-item ${i === _aetherCmdIdx ? 'selected' : ''}" data-idx="${i}">` +
    `<span class="aether-cmd-name">/${c.name}</span>` +
    `<span class="aether-cmd-desc">${escapeHtml(c.desc)}</span></div>`
  ).join('');
  // Click to execute or fill
  dropdown.querySelectorAll('.aether-cmd-item').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const idx = parseInt(el.dataset.idx);
      const cmd = matches[idx];
      if (!cmd) return;
      if (cmd.hasArgs) {
        // Fill input with command name + space so user can type args
        const askInput = popup.querySelector('.doc-ask-inline-input') || popup.querySelector('.doc-ask-inline');
        if (askInput) { askInput.value = '/' + cmd.name + ' '; askInput.focus(); }
        _aetherHideCmdDropdown(popup);
      } else if (cmd._special) {
        _aetherHideCmdDropdown(popup);
        if (cmd.name === 'capture') _doAetherCapture(popup);
        else if (cmd.name === 'model') _doAetherModel(popup);
        else if (cmd.name === 'links') _doAetherLinks(popup);
        else if (cmd.name === 'tab') _doAetherTab(popup);
        else if (cmd.name === 'tabs') _doAetherTabs(popup);
        else if (cmd.name === 'notes') _doAetherNotesBrowse(popup);
        else if (cmd.name === 'history') _doAetherHistory(popup);
        else if (cmd.name === 'help') _doAetherHelp(popup);
      } else {
        cmd.fn();
        _aetherTrackMode = false;
        popup.remove();
      }
    });
  });
  _repositionSelectionPopup();
}

function _aetherHideCmdDropdown(popup) {
  const dropdown = popup.querySelector('.aether-cmd-dropdown');
  if (dropdown) dropdown.remove();
}

function _aetherHideNoteDropdown(popup) {
  const dropdown = popup.querySelector('.aether-note-dropdown');
  if (dropdown) dropdown.remove();
  _aetherNoteResults = [];
  _aetherNoteIdx = 0;
  _aetherNoteQuery = '';
}

function _aetherHideTabDropdown(popup) {
  const dropdown = popup.querySelector('.aether-tab-dropdown');
  if (dropdown) dropdown.remove();
  _aetherTabList = [];
  _aetherTabIdx = 0;
  _aetherTabSwitchMode = false;
}

let _aetherHistoryIdx = 0;
let _aetherHistoryList = [];

function _aetherHideHistoryDropdown(popup) {
  const dropdown = popup.querySelector('.aether-history-dropdown');
  if (dropdown) dropdown.remove();
  _aetherHistoryList = [];
  _aetherHistoryIdx = -1;
}

function _doAetherHistory(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = '/history '; input.style.height = 'auto'; }
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;
  _aetherHistoryIdx = -1;
  _aetherRenderHistoryDropdown(popup, '');
}

function _aetherRenderHistoryDropdown(popup, query) {
  const hist = typeof _getBrowseHistory === 'function' ? _getBrowseHistory() : [];
  const q = (query || '').toLowerCase();
  _aetherHistoryList = q
    ? hist.filter(h => (h.title || '').toLowerCase().includes(q) || (h.url || '').toLowerCase().includes(q)).slice(0, 15)
    : hist.slice(0, 15);

  let dropdown = popup.querySelector('.aether-history-dropdown');

  if (!_aetherHistoryList.length) {
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'aether-history-dropdown aether-note-dropdown';
      dropdown.addEventListener('mousedown', (ev) => ev.stopPropagation());
      const askWrap = popup.querySelector('.doc-ask-inline-wrap');
      if (askWrap) popup.insertBefore(dropdown, askWrap);
      else popup.appendChild(dropdown);
    }
    dropdown.innerHTML = '<div style="padding:10px 12px;font-size:0.8rem;color:var(--text-dim);text-align:center;">No history found</div>';
    _repositionSelectionPopup();
    return;
  }

  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'aether-history-dropdown aether-note-dropdown';
    dropdown.addEventListener('mousedown', (ev) => ev.stopPropagation());
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  if (_aetherHistoryIdx >= _aetherHistoryList.length) _aetherHistoryIdx = _aetherHistoryList.length - 1;

  const fullSelected = _aetherHistoryIdx === -1;
  let html = `<div class="aether-note-item aether-history-full ${fullSelected ? 'selected' : ''}" data-idx="-1" style="padding:6px 10px;font-size:0.75rem;border-bottom:none;">See full history</div>`;
  html += _aetherHistoryList.map((h, i) => {
    let domain = '';
    try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
    const favicon = typeof _browseFaviconUrl === 'function' ? _browseFaviconUrl(h.url) : '';
    const time = typeof _relativeTime === 'function' ? _relativeTime(h.ts) : '';
    return `<div class="aether-note-item ${i === _aetherHistoryIdx ? 'selected' : ''}" data-idx="${i}" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:none;">
      <img src="${escapeHtml(favicon)}" style="width:14px;height:14px;flex-shrink:0;border-radius:2px;" onerror="this.style.display='none'">
      <div style="flex:1;min-width:0;overflow:hidden;">
        <div style="font-size:0.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.title || domain)}</div>
        <div style="font-size:0.68rem;color:var(--text-dimmer);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(domain)}</div>
      </div>
      <span style="font-size:0.68rem;color:var(--text-dimmer);flex-shrink:0;">${escapeHtml(time)}</span>
    </div>`;
  }).join('');
  dropdown.innerHTML = html;

  dropdown.querySelectorAll('.aether-note-item').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const idx = parseInt(el.dataset.idx);
      if (idx === -1) {
        _aetherHideHistoryDropdown(popup);
        popup.remove();
        _aetherTrackMode = false;
        if (typeof openSearchHistoryPage === 'function') openSearchHistoryPage();
        return;
      }
      const entry = _aetherHistoryList[idx];
      if (!entry) return;
      _aetherHideHistoryDropdown(popup);
      popup.remove();
      _aetherTrackMode = false;
      if (typeof browseNavigate === 'function') browseNavigate(entry.url);
    });
  });
  _repositionSelectionPopup();
}

function _aetherSelectHistory(popup) {
  if (_aetherHistoryIdx < 0) {
    // No arrow selection — open full history page
    _aetherHideHistoryDropdown(popup);
    popup.remove();
    _aetherTrackMode = false;
    if (typeof openSearchHistoryPage === 'function') openSearchHistoryPage();
    return true;
  }
  const entry = _aetherHistoryList[_aetherHistoryIdx];
  if (!entry) return false;
  _aetherHideHistoryDropdown(popup);
  popup.remove();
  _aetherTrackMode = false;
  if (typeof browseNavigate === 'function') browseNavigate(entry.url);
  return true;
}

async function _aetherRenderNoteDropdown(popup, query) {
  _aetherNoteQuery = query || '';

  // Get notes (cached or fetch)
  let notes;
  if (typeof _vaultNotes !== 'undefined' && _vaultNotes.length > 0) {
    notes = _vaultNotes;
  } else {
    try {
      const resp = await fetch('/api/vault/notes', { headers: _authHeaders() });
      if (!resp.ok) { _aetherHideNoteDropdown(popup); return; }
      notes = await resp.json();
    } catch { _aetherHideNoteDropdown(popup); return; }
  }

  if (query) {
    const q = query.toLowerCase();
    _aetherNoteResults = notes.filter(n => {
      const title = (n.title || '').toLowerCase();
      const content = (n.content || '').toLowerCase();
      const tags = (n.tags || []).join(' ').toLowerCase();
      return title.includes(q) || content.includes(q) || tags.includes(q);
    }).slice(0, 8);
  } else {
    _aetherNoteResults = notes.slice(0, 12);
  }

  let dropdown = popup.querySelector('.aether-note-dropdown');
  if (!_aetherNoteResults.length) {
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'aether-note-dropdown';
      dropdown.addEventListener('mousedown', (ev) => ev.stopPropagation());
      const askWrap = popup.querySelector('.doc-ask-inline-wrap');
      if (askWrap) popup.insertBefore(dropdown, askWrap);
      else popup.appendChild(dropdown);
    }
    dropdown.innerHTML = `<div class="aether-note-create selected" data-create="1">` +
      `<span class="aether-note-create-icon">+</span> Create "<strong>${escapeHtml(query)}</strong>"</div>`;
    dropdown.querySelector('.aether-note-create').addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _aetherCreateAndOpenNote(popup, query);
    });
    _repositionSelectionPopup();
    return;
  }

  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'aether-note-dropdown';
    dropdown.addEventListener('mousedown', (ev) => ev.stopPropagation());
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  _aetherNoteIdx = Math.min(_aetherNoteIdx, _aetherNoteResults.length - 1);
  dropdown.innerHTML = _aetherNoteResults.map((n, i) => {
    const preview = (n.content || '').replace(/[#*_`>\-\[\]()]/g, '').replace(/\s+/g, ' ').trim();
    const snippet = preview.length > 80 ? preview.slice(0, 77) + '...' : preview;
    const tags = (n.tags || []).slice(0, 3);
    const tagsHtml = tags.length ? tags.map(t => `<span class="aether-note-tag">#${escapeHtml(t)}</span>`).join('') : '';
    return `<div class="aether-note-item ${i === _aetherNoteIdx ? 'selected' : ''}" data-idx="${i}">` +
      `<div class="aether-note-item-title">${escapeHtml(n.title || 'Untitled')}</div>` +
      (snippet ? `<div class="aether-note-item-snippet">${escapeHtml(snippet)}</div>` : '') +
      (tagsHtml ? `<div class="aether-note-item-tags">${tagsHtml}</div>` : '') +
      `</div>`;
  }).join('');

  // Click to open note in side editor
  dropdown.querySelectorAll('.aether-note-item').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const idx = parseInt(el.dataset.idx);
      const note = _aetherNoteResults[idx];
      if (!note) return;
      _aetherOpenNoteEditor(popup, note);
    });
  });
  _repositionSelectionPopup();
}

function _aetherOpenSelectedNote(popup) {
  const note = _aetherNoteResults[_aetherNoteIdx];
  if (!note) return false;
  _aetherOpenNoteEditor(popup, note);
  return true;
}

async function _doAetherNotesBrowse(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;
  _aetherNoteIdx = 0;
  await _aetherRenderNoteDropdown(popup, '');
}

function _aetherOpenNoteEditor(popup, note) {
  // Remove existing note editor if any
  const existing = document.getElementById('aether-note-editor');
  if (existing) existing.remove();

  const popupRect = popup.getBoundingClientRect();

  const editor = document.createElement('div');
  editor.id = 'aether-note-editor';
  editor.className = 'aether-note-editor-panel';
  editor.addEventListener('mousedown', (ev) => ev.stopPropagation());

  // Title bar with note title and close button
  const titleBar = document.createElement('div');
  titleBar.className = 'aether-note-editor-title-bar';

  // Drag support
  let edDragging = false, edDragOff = { x: 0, y: 0 };
  titleBar.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('button')) return;
    ev.preventDefault();
    edDragging = true;
    const r = editor.getBoundingClientRect();
    edDragOff = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  document.addEventListener('mousemove', (ev) => {
    if (!edDragging) return;
    editor.style.left = (ev.clientX - edDragOff.x) + 'px';
    editor.style.top = (ev.clientY - edDragOff.y) + 'px';
  });
  document.addEventListener('mouseup', () => { edDragging = false; });

  const titleSpan = document.createElement('span');
  titleSpan.className = 'aether-note-editor-title';
  titleSpan.textContent = note.title || 'Untitled';
  titleBar.appendChild(titleSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'aether-note-editor-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); editor.remove(); });
  titleBar.appendChild(closeBtn);
  editor.appendChild(titleBar);

  // Textarea for editing
  const textarea = document.createElement('textarea');
  textarea.className = 'aether-note-editor-textarea';
  textarea.value = note.content || '';
  textarea.placeholder = 'Start writing...';
  editor.appendChild(textarea);

  // Auto-save on input (debounced 600ms)
  let saveTimer = null;
  const statusEl = document.createElement('div');
  statusEl.className = 'aether-note-editor-status';
  editor.appendChild(statusEl);

  textarea.addEventListener('input', () => {
    clearTimeout(saveTimer);
    statusEl.textContent = '';
    saveTimer = setTimeout(async () => {
      try {
        const resp = await fetch('/api/vault/notes/' + note.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ..._authHeaders() },
          body: JSON.stringify({ content: textarea.value })
        });
        if (resp.ok) {
          statusEl.textContent = 'Saved';
          setTimeout(() => { if (statusEl.textContent === 'Saved') statusEl.textContent = ''; }, 1500);
          // Update cached vault notes
          if (typeof _vaultNotes !== 'undefined') {
            const cached = _vaultNotes.find(n => n.id === note.id);
            if (cached) cached.content = textarea.value;
          }
        }
      } catch {}
    }, 600);
  });

  // Handle Escape to close
  textarea.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { editor.remove(); }
  });

  document.body.appendChild(editor);

  // Position to the right of the aether panel
  const edRect = editor.getBoundingClientRect();
  let left = popupRect.right + 6;
  let top = popupRect.top;
  // If it would overflow right, put it to the left
  if (left + edRect.width > window.innerWidth - 10) {
    left = popupRect.left - edRect.width - 6;
  }
  // Clamp top
  if (top + edRect.height > window.innerHeight - 10) {
    top = window.innerHeight - edRect.height - 10;
  }
  if (top < 10) top = 10;
  editor.style.left = left + 'px';
  editor.style.top = top + 'px';

  textarea.focus();
}

async function _aetherCreateAndOpenNote(popup, title) {
  _aetherHideNoteDropdown(popup);
  _aetherTrackMode = false;
  popup.remove();
  window.location.hash = '#vault';
  // Wait for vault view to render, then create the note
  setTimeout(async () => {
    if (typeof vaultCreateNoteWithTitle === 'function') {
      await vaultCreateNoteWithTitle(title);
      // Focus the editor so user can start typing immediately
      const editor = document.getElementById('vault-editor');
      if (editor) editor.focus();
    }
  }, 150);
}

async function _doAetherCapture(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = ''; }
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  // Hide the popup temporarily so it's not in the screenshot
  popup.style.visibility = 'hidden';
  await new Promise(r => setTimeout(r, 80));

  // Determine capture region — content area only for browse view, else full window
  let captureRect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const browseView = document.getElementById('browse-view');
  if (browseView && browseView.style.display !== 'none') {
    const el = document.getElementById('browse-content');
    if (el) { const r = el.getBoundingClientRect(); captureRect = { x: r.x, y: r.y, width: r.width, height: r.height }; }
  }

  // Capture screenshot
  let screenshot = null;
  if (window.electronAPI?.captureScreen) {
    try {
      screenshot = await window.electronAPI.captureScreen(captureRect);
    } catch (e) {
      console.error('Screenshot capture failed:', e);
    }
  } else if (typeof html2canvas !== 'undefined') {
    try {
      screenshot = await _browserCaptureRect(captureRect);
    } catch (e) {
      console.error('Browser screenshot capture failed:', e);
    }
  }

  // Show the popup again
  popup.style.visibility = '';

  if (!screenshot) {
    _popupChatMessages.push({ role: 'assistant', content: 'Screenshot capture failed. Make sure html2canvas is loaded.', _thinking: false });
    popup.classList.add('has-chat');
    const chatArea = popup.querySelector('.doc-popup-chat-area');
    if (chatArea) chatArea.classList.add('visible');
    _renderPopupChat(popup, true);
    _repositionSelectionPopup();
    if (input) input.focus();
    return;
  }

  // Add screenshot to attachment strip — user can type a message and send
  _addScreenshotToPanel(popup, screenshot);
  if (input) input.focus();
  _repositionSelectionPopup();
}

// ── /model command ──
let _aetherModelIdx = 0;
let _aetherModelList = [];

async function _doAetherModel(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  // Fetch available models
  _aetherModelList = [];
  _aetherModelIdx = 0;
  try {
    const resp = await fetch('/api/models');
    const data = await resp.json();
    _aetherModelList = data.models || [];
  } catch (e) {
    _aetherModelList = [];
  }

  if (!_aetherModelList.length) {
    // Show error inline
    if (input) { input.value = ''; input.placeholder = 'No models available'; input.focus(); }
    return;
  }

  const currentModel = localStorage.getItem('chatModel') || '';
  // Pre-select current model if found
  const curIdx = _aetherModelList.indexOf(currentModel);
  if (curIdx >= 0) _aetherModelIdx = curIdx;

  _aetherRenderModelDropdown(popup);
}

function _aetherRenderModelDropdown(popup) {
  let dropdown = popup.querySelector('.aether-model-dropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'aether-note-dropdown aether-model-dropdown';
    dropdown.addEventListener('mousedown', ev => ev.stopPropagation());
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  const currentModel = localStorage.getItem('chatModel') || '';
  dropdown.innerHTML = _aetherModelList.map((m, i) => {
    const active = m === currentModel;
    return `<div class="aether-note-item ${i === _aetherModelIdx ? 'selected' : ''}" data-idx="${i}">` +
      `<span class="aether-note-item-title">${escapeHtml(m)}</span>` +
      (active ? `<span class="aether-note-item-tags" style="margin-left:auto;opacity:0.6;">current</span>` : '') +
      `</div>`;
  }).join('');

  dropdown.querySelectorAll('.aether-note-item').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation(); ev.preventDefault();
      const idx = parseInt(el.dataset.idx);
      const model = _aetherModelList[idx];
      if (model) {
        _aetherModelIdx = idx;
        localStorage.setItem('chatModel', model);
        _aetherRenderModelDropdown(popup);
        const label = popup.querySelector('.aether-model-label');
        if (label) label.textContent = model;
        const input = popup.querySelector('.doc-ask-inline-input');
        if (input) { input.value = ''; input.focus(); }
      }
    });
  });
  _repositionSelectionPopup();
}

function _aetherHideModelDropdown(popup) {
  const dd = popup.querySelector('.aether-model-dropdown');
  if (dd) dd.remove();
  _aetherModelList = [];
  _aetherModelIdx = 0;
}

function _aetherSelectModel(popup) {
  const model = _aetherModelList[_aetherModelIdx];
  if (model) {
    localStorage.setItem('chatModel', model);
    _aetherHideModelDropdown(popup);
    const label = popup.querySelector('.aether-model-label');
    if (label) label.textContent = model;
    const input = popup.querySelector('.doc-ask-inline-input');
    if (input) { input.value = ''; input.placeholder = 'Ask anything…'; input.focus(); }
  }
}

// ── /search command — open web search in new tab ──
function _doAetherSearchNewTab(popup, query) {
  const url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
  if (typeof browseNewTab === 'function') browseNewTab(url);
  else window.open(url, '_blank');
  _aetherTrackMode = false;
  popup.remove();
}

// ── /links command — list all links on current page ──
async function _doAetherLinks(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: 'Links on this page', _display: 'Links on this page', _isSearch: true });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  // Get current page URL
  let pageUrl = '';
  const tab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
    ? _browseTabs.find(t => t.id === _browseActiveTab)
    : null;
  if (tab && tab.url) pageUrl = tab.url;

  if (!pageUrl) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'No page open to extract links from.';
    _renderPopupChat(popup, true);
    if (input) input.focus();
    return;
  }

  try {
    const resp = await fetch('/api/extract-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pageUrl })
    });
    const data = await resp.json();
    const links = data.links || [];
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    if (links.length) {
      _popupChatMessages[aiIdx]._searchResults = links.map(l => ({ title: l.text, url: l.url, snippet: '' }));
      _popupChatMessages[aiIdx].content = links.length + ' link' + (links.length !== 1 ? 's' : '') + ' found';
    } else {
      _popupChatMessages[aiIdx].content = 'No links found on this page.';
    }
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Failed to extract links: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

// ── /tab command — add a browser tab to chat context ──
let _aetherTabAutoAdding = false;

async function _doAetherTab(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  // Get all open tabs from all windows
  const allTabs = [];
  if (typeof _browseWindows !== 'undefined') {
    for (const win of _browseWindows) {
      for (const tab of (win.tabs || [])) {
        if (!tab.blank && tab.url) allTabs.push(tab);
      }
    }
  }

  if (!allTabs.length) {
    if (input) input.focus();
    return;
  }

  // Auto-add current tab if on a webpage
  const activeTabId = typeof _browseActiveTab !== 'undefined' ? _browseActiveTab : null;
  const currentTab = activeTabId != null ? allTabs.find(t => t.id === activeTabId) : null;
  if (currentTab && !_pendingTabContexts.some(t => t.tabId === currentTab.id)) {
    _aetherTabAutoAdding = true;
    try {
      const resp = await fetch('/api/extract-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: currentTab.url })
      });
      const data = await resp.json();
      _addTabContextToPanel(popup, { tabId: currentTab.id, title: currentTab.title, url: currentTab.url, content: data.text || '' });
    } catch (e) { /* ignore */ }
    _aetherTabAutoAdding = false;
  }

  // Show remaining tabs (excluding already-added ones) in a dropdown
  const addedIds = new Set(_pendingTabContexts.map(t => t.tabId));
  const otherTabs = allTabs.filter(t => !addedIds.has(t.id));
  if (!otherTabs.length) {
    if (input) input.focus();
    return;
  }

  _aetherTabList = otherTabs;
  _aetherTabIdx = 0;
  _renderTabDropdown(popup);
  if (input) input.focus();
}

function _renderTabDropdown(popup) {
  let dropdown = popup.querySelector('.aether-tab-dropdown');
  if (!_aetherTabList.length) {
    if (dropdown) dropdown.remove();
    return;
  }
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'aether-tab-dropdown';
    dropdown.addEventListener('mousedown', (ev) => ev.stopPropagation());
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  _aetherTabIdx = Math.min(_aetherTabIdx, _aetherTabList.length - 1);
  const activeTabId = _aetherTabSwitchMode && typeof _browseActiveTab !== 'undefined' ? _browseActiveTab : null;
  dropdown.innerHTML = _aetherTabList.map((tab, i) => {
    const domain = (() => { try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; } })();
    const favUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`;
    const activeMarker = activeTabId != null && tab.id === activeTabId ? '<span style="opacity:0.4;font-size:10px;margin-left:auto;flex-shrink:0">current</span>' : '';
    return `<div class="aether-tab-item ${i === _aetherTabIdx ? 'selected' : ''}" data-idx="${i}">` +
      `<img src="${favUrl}" class="aether-tab-item-favicon" onerror="this.style.display='none'">` +
      `<div class="aether-tab-item-info">` +
      `<div class="aether-tab-item-title">${escapeHtml(tab.title || 'Untitled')}</div>` +
      `<div class="aether-tab-item-url">${escapeHtml(domain)}</div>` +
      `</div>${activeMarker}</div>`;
  }).join('');

  dropdown.querySelectorAll('.aether-tab-item').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _aetherTabIdx = parseInt(el.dataset.idx);
      if (_aetherTabSwitchMode) _aetherSwitchToTab(popup);
      else _aetherSelectTab(popup);
    });
  });
  _repositionSelectionPopup();
}

async function _aetherSelectTab(popup) {
  const tab = _aetherTabList[_aetherTabIdx];
  if (!tab) return;

  const dropdown = popup.querySelector('.aether-tab-dropdown');
  const items = dropdown ? dropdown.querySelectorAll('.aether-tab-item') : [];
  const el = items[_aetherTabIdx];
  if (el) {
    el.style.opacity = '0.5';
    el.style.pointerEvents = 'none';
    el.insertAdjacentHTML('beforeend', '<span class="aether-tab-item-loading">extracting...</span>');
  }

  try {
    const resp = await fetch('/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url })
    });
    const data = await resp.json();
    _addTabContextToPanel(popup, { tabId: tab.id, title: tab.title, url: tab.url, content: data.text || '' });
  } catch (e) {
    if (el) {
      el.style.opacity = '1';
      el.style.pointerEvents = '';
      const loading = el.querySelector('.aether-tab-item-loading');
      if (loading) loading.remove();
    }
    return;
  }
  _aetherHideTabDropdown(popup);
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.focus();
}

// ── /tabs command — switch to an open tab ──
function _doAetherTabs(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  const allTabs = [];
  if (typeof _browseWindows !== 'undefined') {
    for (const win of _browseWindows) {
      for (const tab of (win.tabs || [])) {
        if (!tab.blank && tab.url) allTabs.push(tab);
      }
    }
  }

  if (!allTabs.length) {
    if (input) input.focus();
    return;
  }

  _aetherTabSwitchMode = true;
  _aetherTabList = allTabs;
  _aetherTabIdx = 0;

  // Pre-select the currently active tab
  const activeTabId = typeof _browseActiveTab !== 'undefined' ? _browseActiveTab : null;
  if (activeTabId != null) {
    const idx = allTabs.findIndex(t => t.id === activeTabId);
    if (idx >= 0) _aetherTabIdx = idx;
  }

  _renderTabDropdown(popup);
  if (input) input.focus();
}

function _aetherSwitchToTab(popup) {
  const tab = _aetherTabList[_aetherTabIdx];
  if (!tab) return;
  _aetherHideTabDropdown(popup);
  _aetherTrackMode = false;
  popup.remove();

  // Find which window owns this tab and switch if needed
  if (typeof _browseWindows !== 'undefined') {
    for (const win of _browseWindows) {
      if (win.tabs.some(t => t.id === tab.id)) {
        if (win.id !== _browseActiveWindow && typeof browseSelectWindow === 'function') {
          browseSelectWindow(win.id);
        }
        break;
      }
    }
  }

  // Ensure browse view is visible, then select the tab
  if (window.location.hash !== '#browse' && typeof openBrowse === 'function') {
    openBrowse();
  }
  if (typeof browseSelectTab === 'function') browseSelectTab(tab.id);
}

// ── /help command — show all commands & features ──
function _doAetherHelp(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  // Toggle: remove existing help panel if already open
  const existing = document.getElementById('aether-help-panel');
  if (existing) { existing.remove(); if (input) input.focus(); return; }

  const helpMd = `## Instant Answers
Type in the browser URL bar:

| Trigger | Example |
|---|---|
| **word** → definition | \`pug\`, \`ephemeral\` |
| **math** → calculator | \`sqrt(144)\`, \`2^10\`, \`15% of 230\` |
| **#hex / rgb()** → color | \`#ff5733\`, \`rgb(20,120,200)\` |
| **N unit to unit** → convert | \`5km to mi\`, \`100f to c\` |
| **time in city** → clock | \`time in tokyo\` |
| **weather city** → forecast | \`weather boston\` |
| **league / team** → scores | \`nba\`, \`lakers\`, \`premier league\` |
| **$TICKER** → stock | \`$AAPL\`, \`TSLA stock\` |

## Slash Commands
| Command | Action |
|---|---|
| \`/help\` | This help page |
| \`/define word\` | Dictionary lookup |
| \`/search query\` | Web search in new tab |
| \`/paper query\` | Search arXiv papers |
| \`/user query\` | Search for users |
| \`/notes\` | Browse your notes |
| \`/links\` | List links on page |
| \`/tab\` | Add tab to context |
| \`/model\` | Change chat model |
| \`/history\` | Browse visited sites |
| \`/capture\` | Screenshot the page |
| \`/bookmark\` | Save to reading list |
| \`/find\` | Find in page |
| \`/note\` | Open in note viewer |
| \`/upload\` | Open a local file |
| \`/close\` | Close tab |
| \`/copy\` | Copy page URL |
| \`/mute\` | Mute/unmute tab |
| \`/print\` | Print page |

## Keyboard Shortcuts
| Key | Action |
|---|---|
| \`⌘T\` | New browser tab |
| \`⌘W\` | Close browser tab |
| \`⌘Y\` | History page |
| \`⌘⇧\\\\\` | Tab overview |
| \`⌘F\` | Find in page/PDF |
| \`⌘+/-/0\` | Zoom in/out/reset |
| \`Enter\` | Send chat message |
| \`⇧Enter\` | Web search |

## Aether Panel
- **Right-click** anywhere to open
- Type to chat with AI about the page
- Select text → highlight, quote, or define
- Drag to capture a screenshot region`;

  const popupRect = popup.getBoundingClientRect();

  const panel = document.createElement('div');
  panel.id = 'aether-help-panel';
  panel.className = 'aether-help-preview-panel';
  panel.addEventListener('mousedown', (ev) => ev.stopPropagation());

  // Title bar (reuse note editor styles)
  const titleBar = document.createElement('div');
  titleBar.className = 'aether-note-editor-title-bar';

  let hDragging = false, hDragOff = { x: 0, y: 0 };
  titleBar.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('button')) return;
    ev.preventDefault();
    hDragging = true;
    const r = panel.getBoundingClientRect();
    hDragOff = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  const hMove = (ev) => { if (!hDragging) return; panel.style.left = (ev.clientX - hDragOff.x) + 'px'; panel.style.top = (ev.clientY - hDragOff.y) + 'px'; };
  const hUp = () => { hDragging = false; };
  document.addEventListener('mousemove', hMove);
  document.addEventListener('mouseup', hUp);

  const titleSpan = document.createElement('span');
  titleSpan.className = 'aether-note-editor-title';
  titleSpan.textContent = 'Help';
  titleBar.appendChild(titleSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'aether-note-editor-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); panel.remove(); document.removeEventListener('mousemove', hMove); document.removeEventListener('mouseup', hUp); });
  titleBar.appendChild(closeBtn);
  panel.appendChild(titleBar);

  // Rendered markdown content
  const contentDiv = document.createElement('div');
  contentDiv.className = 'aether-help-preview-content nb-rendered-md';
  contentDiv.innerHTML = typeof marked !== 'undefined' ? marked.parse(helpMd) : helpMd.replace(/\n/g, '<br>');
  panel.appendChild(contentDiv);

  document.body.appendChild(panel);

  // Position to the right of the aether panel
  const panelRect = panel.getBoundingClientRect();
  let left = popupRect.right + 6;
  let top = popupRect.top;
  if (left + panelRect.width > window.innerWidth - 10) {
    left = popupRect.left - panelRect.width - 6;
  }
  if (top + panelRect.height > window.innerHeight - 10) {
    top = window.innerHeight - panelRect.height - 10;
  }
  if (top < 10) top = 10;
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';

  if (input) input.focus();
}

// ── /define command — dictionary lookup ──
async function _doAetherDefine(popup, word) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: word, _display: 'Define: ' + word });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const resp = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.trim()));
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    if (!resp.ok) {
      _popupChatMessages[aiIdx].content = 'No definition found for "' + word.trim() + '".';
      _renderPopupChat(popup, true);
      if (input) input.focus();
      _repositionSelectionPopup();
      return;
    }
    const data = await resp.json();
    let md = '';
    const entry = data[0];
    if (entry) {
      const phonetic = entry.phonetics?.find(p => p.text)?.text || '';
      md += '**' + entry.word + '**' + (phonetic ? '  ' + phonetic : '') + '\n\n';
      for (const meaning of (entry.meanings || [])) {
        md += '*' + meaning.partOfSpeech + '*\n';
        for (const def of (meaning.definitions || []).slice(0, 3)) {
          md += '- ' + def.definition + '\n';
          if (def.example) md += '  *"' + def.example + '"*\n';
        }
        const syns = (meaning.synonyms || []).slice(0, 5);
        if (syns.length) md += '  Synonyms: ' + syns.join(', ') + '\n';
        md += '\n';
      }
    }
    _popupChatMessages[aiIdx].content = md.trim() || 'No definitions available.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Failed to look up definition: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

function _aetherExecCommand(popup, text) {
  const raw = text.slice(1).trim();
  // Check for commands with arguments: "/paper transformer attention"
  const spaceIdx = raw.indexOf(' ');
  if (spaceIdx > 0) {
    const cmdName = raw.slice(0, spaceIdx).toLowerCase();
    const args = raw.slice(spaceIdx + 1).trim();
    const cmd = _aetherCommands.find(c => c.name === cmdName);
    if (cmd && cmd.hasArgs && args) {
      _aetherHideCmdDropdown(popup);
      if (cmdName === 'paper') { _doAetherPaperSearch(popup, args); return true; }
      if (cmdName === 'user') { _doAetherUserSearch(popup, args); return true; }
      if (cmdName === 'notes') { _doAetherNoteSearch(popup, args); return true; }
      if (cmdName === 'search') { _doAetherSearchNewTab(popup, args); return true; }
      if (cmdName === 'define') { _doAetherDefine(popup, args); return true; }
    }
    if (cmd && cmd.fn) { cmd.fn(); _aetherTrackMode = false; popup.remove(); return true; }
  }
  const query = raw.toLowerCase();
  const matches = _aetherFilterCommands(query);
  const cmd = matches[_aetherCmdIdx] || matches[0];
  if (cmd) {
    if (cmd.hasArgs) return false; // needs arguments, don't execute bare
    if (cmd._special) {
      _aetherHideCmdDropdown(popup);
      if (cmd.name === 'capture') _doAetherCapture(popup);
      else if (cmd.name === 'model') _doAetherModel(popup);
      else if (cmd.name === 'links') _doAetherLinks(popup);
      else if (cmd.name === 'tab') _doAetherTab(popup);
      else if (cmd.name === 'tabs') _doAetherTabs(popup);
      else if (cmd.name === 'history') _doAetherHistory(popup);
      else if (cmd.name === 'help') _doAetherHelp(popup);
      return true;
    }
    cmd.fn();
    _aetherTrackMode = false;
    popup.remove();
    return true;
  }
  return false;
}

// Paper search from aether panel (/paper query)
async function _doAetherPaperSearch(popup, query) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';

  _aetherTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: query, _display: query, _isPaperSearch: true });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isPaperSearch: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const resp = await fetch('/api/arxiv-search?q=' + encodeURIComponent(query) + '&max_results=8');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const xml = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const entries = doc.querySelectorAll('entry');
    const papers = [];
    entries.forEach(entry => {
      const title = (entry.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim();
      const summary = (entry.querySelector('summary')?.textContent || '').replace(/\s+/g, ' ').trim();
      const authors = Array.from(entry.querySelectorAll('author name')).map(n => n.textContent).join(', ');
      const published = entry.querySelector('published')?.textContent || '';
      const year = published ? new Date(published).getFullYear() : '';
      let link = '';
      entry.querySelectorAll('link').forEach(l => {
        if (l.getAttribute('type') === 'text/html') link = l.getAttribute('href');
      });
      if (!link) {
        const alt = entry.querySelector('link[rel="alternate"]');
        if (alt) link = alt.getAttribute('href');
      }
      if (!link) link = entry.querySelector('id')?.textContent || '';
      papers.push({ title, authors, summary, link, year });
    });

    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx]._paperResults = papers;
    _popupChatMessages[aiIdx].content = papers.length
      ? papers.length + ' paper' + (papers.length !== 1 ? 's' : '') + ' found'
      : 'No papers found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

async function _doAetherNoteSearch(popup, query) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: query, _display: query, _isNoteSearch: true });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isNoteSearch: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    // Use cached _vaultNotes if available, otherwise fetch
    let notes;
    if (typeof _vaultNotes !== 'undefined' && _vaultNotes.length > 0) {
      notes = _vaultNotes;
    } else {
      const resp = await fetch('/api/vault/notes', { headers: _authHeaders() });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      notes = await resp.json();
    }

    const q = query.toLowerCase();
    const matches = notes.filter(n => {
      const title = (n.title || '').toLowerCase();
      const content = (n.content || '').toLowerCase();
      const tags = (n.tags || []).join(' ').toLowerCase();
      return title.includes(q) || content.includes(q) || tags.includes(q);
    }).slice(0, 10);

    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx]._noteResults = matches;
    _popupChatMessages[aiIdx].content = matches.length
      ? matches.length + ' note' + (matches.length !== 1 ? 's' : '') + ' found'
      : 'No notes found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

async function _doAetherUserSearch(popup, query) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: query, _display: query, _isUserSearch: true });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isUserSearch: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const resp = await fetch('/api/users?q=' + encodeURIComponent(query), {
      headers: _authHeaders()
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const users = await resp.json();

    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx]._userResults = users;
    _popupChatMessages[aiIdx].content = users.length
      ? users.length + ' user' + (users.length !== 1 ? 's' : '') + ' found'
      : 'No users found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

// ── Unified Popup Panel ──
// _showPanel(config) replaces both _showAetherPanel and _buildSelectionPopup.
// Config:
//   anchor: { x, y } | { selectionRect: DOMRect } | { tab: HTMLElement }
//   trackCursor: bool         — follow mouse until interaction
//   contextMenu: { items, linkUrl, linkText, imgUrl }
//   selectionText: string     — selected text preview
//   selectionRange: Range     — for highlight creation
//   inTextLayer: bool         — PDF text layer (show highlight dots)
//   initialValue: string      — pre-fill input (e.g. '/')
//   finalized: bool           — false = selection preview only (no buttons/input)
//   editableTarget: HTMLElement — the input/textarea/contentEditable element (for paste)
//   priorEditable: HTMLElement  — editable element that was focused before panel opened

// Focus an element that may be inside an iframe — focuses the iframe first if needed
function _focusCrossFrame(el) {
  const ownerDoc = el.ownerDocument;
  if (ownerDoc && ownerDoc !== document) {
    const iframes = document.querySelectorAll('iframe, webview');
    for (const f of iframes) {
      try {
        if (f.contentDocument === ownerDoc) { f.focus(); break; }
      } catch (e) { /* cross-origin */ }
    }
  }
  el.focus();
}

// Paste text into an element, handling iframe ownership for execCommand
function _pasteIntoElement(el, text) {
  _focusCrossFrame(el);
  if (el.isContentEditable) {
    // execCommand must be called on the element's ownerDocument (matters for iframes)
    const ownerDoc = el.ownerDocument || document;
    ownerDoc.execCommand('insertText', false, text);
  } else {
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const val = el.value || '';
    el.value = val.slice(0, start) + text + val.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function _flashCopyBtn(popup) {
  // Find the right copy button: selection copy or chat copy
  const btn = popup.querySelector('.doc-selection-copy-btn')
    || (popup._copyChatBtn && popup._copyChatBtn.style.display !== 'none' ? popup._copyChatBtn : null);
  if (!btn) return;
  btn.textContent = 'Copied';
  btn.classList.remove('doc-copy-flash');
  // Force reflow so animation restarts if already playing
  void btn.offsetWidth;
  btn.classList.add('doc-copy-flash');
  setTimeout(() => {
    if (btn.isConnected) { btn.textContent = 'Copy'; btn.classList.remove('doc-copy-flash'); }
  }, 1200);
}

// ── Helper: inject profile menu items into the aether panel ──
function _injectProfileItems(popup) {
  if (popup.querySelector('.aether-profile-items')) return;
  const email = (typeof _authUserInfo !== 'undefined' && _authUserInfo?.email) || '';
  const username = (typeof _authUserInfo !== 'undefined' && (_authUserInfo?.username || _authUserInfo?.name)) || '';
  const ctxDiv = document.createElement('div');
  ctxDiv.className = 'doc-aether-context-items aether-profile-items';

  // User info header
  if (username || email) {
    const info = document.createElement('div');
    info.className = 'doc-aether-ctx-item doc-aether-ctx-info';
    info.innerHTML = '<span class="doc-aether-ctx-label">' + escapeHtml(username) + '</span>' +
      (email ? '<span class="doc-aether-ctx-sub">' + escapeHtml(email) + '</span>' : '');
    ctxDiv.appendChild(info);
  }

  const items = [
    { label: 'View Profile', icon: '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.118a7.5 7.5 0 0115 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.5-1.632z"/></svg>', fn: () => openUserProfile(username) },
    { label: 'Settings', icon: '<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg>', fn: () => openSettings() },
    { label: 'Help', icon: '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18h.01"/><circle cx="12" cy="12" r="9"/></svg>', fn: () => { openBrowse(); setTimeout(() => openHelpPage(), 50); } },
    { sep: true },
    { label: 'Sign Out', icon: '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3h-9m9 0l-3-3m3 3l-3 3"/></svg>', danger: true, fn: () => _doLogout() },
  ];

  for (const entry of items) {
    if (entry.sep) {
      const sep = document.createElement('div');
      sep.className = 'doc-aether-ctx-sep';
      ctxDiv.appendChild(sep);
      continue;
    }
    const item = document.createElement('div');
    item.className = 'doc-aether-ctx-item' + (entry.danger ? ' doc-aether-ctx-danger' : '');
    item.innerHTML = entry.icon + ' ' + escapeHtml(entry.label);
    item.addEventListener('mousedown', (ev) => ev.stopPropagation());
    item.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _aetherTrackMode = false;
      popup.remove();
      entry.fn();
    });
    ctxDiv.appendChild(item);
  }

  // Insert before the chat input wrap (or at end)
  const inputWrap = popup.querySelector('.doc-ask-inline-wrap');
  if (inputWrap) popup.insertBefore(ctxDiv, inputWrap);
  else popup.appendChild(ctxDiv);
}

// ── Helper: open aether panel anchored to profile icon ──
function _openProfilePanel() {
  const btn = document.getElementById('sb-settings');
  if (!btn) return;
  // Close existing panel and restore cursor
  _aetherShowCursor();
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) { existing.remove(); _aetherTrackMode = false; _aetherPinned = false; }
  // Close old popover if visible
  const pop = document.getElementById('user-menu-popover');
  if (pop) pop.style.display = 'none';
  const rect = btn.getBoundingClientRect();
  _showPanel({ anchor: { x: rect.left + rect.width / 2, y: rect.bottom + 6 }, trackCursor: false });
  // Inject profile items after panel is built
  const popup = document.getElementById('doc-chat-ask-float');
  if (popup) _injectProfileItems(popup);
}

// ── Helper: build generic context menu items (vault, tab, custom items) ──
function _panelBuildContextItems(popup, config) {
  const contextMenu = config.contextMenu || null;
  if (!(contextMenu && contextMenu.items)) return;
  const ctxDiv = document.createElement('div');
  ctxDiv.className = 'doc-aether-context-items';
  for (const entry of contextMenu.items) {
    if (entry.sep) {
      const sep = document.createElement('div');
      sep.className = 'doc-aether-ctx-sep';
      ctxDiv.appendChild(sep);
      continue;
    }
    const item = document.createElement('div');
    item.className = 'doc-aether-ctx-item' + (entry.danger ? ' doc-aether-ctx-danger' : '') + (entry.info ? ' doc-aether-ctx-info' : '');
    if (entry.icon) {
      item.innerHTML = entry.icon + ' ' + escapeHtml(entry.label);
    } else if (entry.subtext) {
      item.innerHTML = '<span class="doc-aether-ctx-label">' + escapeHtml(entry.label) + '</span><span class="doc-aether-ctx-sub">' + escapeHtml(entry.subtext) + '</span>';
    } else if (entry.colorDot) {
      item.innerHTML = '<span class="browse-ctx-color-dot" style="background:' + escapeAttr(entry.colorDot) + '"></span>' + escapeHtml(entry.label);
    } else {
      item.textContent = entry.label;
    }
    if (!entry.info) {
      item.addEventListener('mousedown', (ev) => ev.stopPropagation());
      item.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        entry.fn();
        _aetherTrackMode = false;
        popup.remove();
      });
    }
    ctxDiv.appendChild(item);
  }
  popup.appendChild(ctxDiv);
}

// ── Helper: build link/image context menu + link preview ──
function _panelBuildLinkContextMenu(popup, config) {
  const contextMenu = config.contextMenu || null;
  if (!contextMenu) return;

  // Link preview (async)
  if (contextMenu.linkUrl) {
    const previewDiv = document.createElement('div');
    previewDiv.className = 'doc-link-preview';
    fetch('/api/link-preview?url=' + encodeURIComponent(contextMenu.linkUrl))
      .then(r => r.json())
      .then(data => {
        if (!popup.isConnected) return;
        if (!data.title && !data.description) return;
        let html = '';
        if (data.image) {
          html += `<img class="doc-link-preview-img" src="${escapeAttr(data.image)}" onerror="this.remove()">`;
        }
        html += '<div class="doc-link-preview-text">';
        html += `<div class="doc-link-preview-site">${escapeHtml(data.site || data.domain || '')}</div>`;
        html += `<div class="doc-link-preview-title">${escapeHtml(data.title)}</div>`;
        if (data.description) {
          html += `<div class="doc-link-preview-desc">${escapeHtml(data.description)}</div>`;
        }
        html += '</div>';
        previewDiv.innerHTML = html;
        previewDiv.style.cursor = 'pointer';
        previewDiv.addEventListener('mousedown', (ev) => ev.stopPropagation());
        previewDiv.addEventListener('click', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          if (typeof browseNewTab === 'function') browseNewTab(contextMenu.linkUrl);
          else window.open(contextMenu.linkUrl, '_blank');
        });
        popup.insertBefore(previewDiv, popup.firstChild);
        _repositionSelectionPopup();
      })
      .catch(() => {});
  }

  // Context menu items (links, images) — only when no custom items
  if ((contextMenu.linkUrl || contextMenu.imgUrl) && !contextMenu.items) {
    const ctxDiv = document.createElement('div');
    ctxDiv.className = 'doc-aether-context-items';
    const linkUrl = contextMenu.linkUrl || '';
    const linkText = contextMenu.linkText || '';
    const imgUrl = contextMenu.imgUrl || '';

    const addItem = (label, fn) => {
      const item = document.createElement('div');
      item.className = 'doc-aether-ctx-item';
      item.textContent = label;
      item.addEventListener('mousedown', (ev) => ev.stopPropagation());
      item.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        fn();
        _aetherTrackMode = false;
        popup.remove();
      });
      ctxDiv.appendChild(item);
    };
    const addSep = () => {
      const sep = document.createElement('div');
      sep.className = 'doc-aether-ctx-sep';
      ctxDiv.appendChild(sep);
    };

    if (linkUrl) {
      addItem('Open Link in New Tab', () => { if (typeof browseNewTab === 'function') browseNewTab(linkUrl); });
      addItem('Open Link Here', () => { if (typeof browseNavigate === 'function') browseNavigate(linkUrl); });
      addSep();
      addItem('Copy Link Address', () => navigator.clipboard.writeText(linkUrl).catch(() => {}));
      if (linkText) addItem('Copy Link Text', () => navigator.clipboard.writeText(linkText).catch(() => {}));
    }
    if (imgUrl) {
      if (linkUrl) addSep();
      addItem('Open Image in New Tab', () => { if (typeof browseNewTab === 'function') browseNewTab(imgUrl); });
      addItem('Copy Image Address', () => navigator.clipboard.writeText(imgUrl).catch(() => {}));
      addItem('Copy Image', () => {
        // Route through our image proxy so it's always same-origin
        const proxyUrl = imgUrl.startsWith('/api/') ? imgUrl : '/api/image-proxy?url=' + encodeURIComponent(imgUrl);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          c.toBlob(b => {
            if (b) navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).catch(() => {});
          }, 'image/png');
        };
        img.src = proxyUrl;
      });
      addItem('Save Image As…', () => {
        const proxyUrl = imgUrl.startsWith('/api/') ? imgUrl : '/api/image-proxy?url=' + encodeURIComponent(imgUrl);
        const a = document.createElement('a');
        a.href = proxyUrl;
        // Extract a filename from the URL, fallback to 'image.png'
        try { a.download = imgUrl.split('/').pop().split('?')[0] || 'image.png'; } catch(_) { a.download = 'image.png'; }
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
      // "Add to Assistant" keeps the panel open and adds the image as chat context
      const assistItem = document.createElement('div');
      assistItem.className = 'doc-aether-ctx-item';
      assistItem.textContent = 'Add to Assistant';
      assistItem.addEventListener('mousedown', (ev) => ev.stopPropagation());
      assistItem.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        _aetherTrackMode = false;
        // Remove context menu items but keep the panel
        const ctxItems = popup.querySelector('.doc-aether-context-items');
        if (ctxItems) ctxItems.remove();
        const preview = popup.querySelector('.doc-link-preview');
        if (preview) preview.remove();
        const proxyUrl = imgUrl.startsWith('/api/') ? imgUrl : '/api/image-proxy?url=' + encodeURIComponent(imgUrl);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          const base64 = c.toDataURL('image/png').split(',')[1];
          if (base64) _addScreenshotToPanel(popup, base64);
        };
        img.src = proxyUrl;
      });
      ctxDiv.appendChild(assistItem);
    }
    if (linkText && linkUrl) {
      const truncated = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
      addSep();
      addItem('Search Google for "' + truncated + '"', () => {
        if (typeof browseNewTab === 'function') browseNewTab('https://www.google.com/search?q=' + encodeURIComponent(linkText));
      });
    }

    popup.appendChild(ctxDiv);
  }
}

// ── Helper: build editable field actions (Cut/Copy/Paste for native + webview + prior editable) ──
function _panelBuildEditableActions(popup, config, capturedText, hasContext) {
  const editableTarget = config.editableTarget || null;
  const webviewEditable = config.webviewEditable || null;

  // Native editable field actions (Cut, Copy, Paste)
  if (editableTarget) {
    const editCtx = document.createElement('div');
    editCtx.className = 'doc-aether-context-items';
    const addEditItem = (label, fn) => {
      const item = document.createElement('div');
      item.className = 'doc-aether-ctx-item';
      item.textContent = label;
      item.addEventListener('mousedown', (ev) => ev.stopPropagation());
      item.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        fn();
        popup.remove();
      });
      editCtx.appendChild(item);
    };
    if (capturedText) {
      addEditItem('Cut', () => {
        navigator.clipboard.writeText(capturedText).catch(() => {});
        _focusCrossFrame(editableTarget);
        if (editableTarget.isContentEditable) {
          (editableTarget.ownerDocument || document).execCommand('delete');
        } else {
          const start = editableTarget.selectionStart;
          const end = editableTarget.selectionEnd;
          const val = editableTarget.value;
          editableTarget.value = val.slice(0, start) + val.slice(end);
          editableTarget.selectionStart = editableTarget.selectionEnd = start;
          editableTarget.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      addEditItem('Copy', () => {
        navigator.clipboard.writeText(capturedText).catch(() => {});
      });
    }
    addEditItem('Paste', () => {
      navigator.clipboard.readText().then(text => {
        if (!text) return;
        _pasteIntoElement(editableTarget, text);
      }).catch(() => {});
    });
    popup.appendChild(editCtx);
  }

  // Webview editable field (cross-origin) — Cut/Copy/Paste via webview API
  if (webviewEditable) {
    const wvCtx = document.createElement('div');
    wvCtx.className = 'doc-aether-context-items';
    const wv = webviewEditable.webview;
    const flags = webviewEditable.editFlags || {};
    const addWvItem = (label, fn) => {
      const item = document.createElement('div');
      item.className = 'doc-aether-ctx-item';
      item.textContent = label;
      item.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
      item.addEventListener('mouseup', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        fn();
      });
      wvCtx.appendChild(item);
    };
    const wvExec = (js) => { popup.remove(); wv.focus(); setTimeout(() => wv.executeJavaScript(js).catch(() => {}), 50); };
    if (flags.canCut) addWvItem('Cut', () => {
      wvExec(`(function(){ var el=window.__aetherLastEditable; if(!el) return; el.focus();
        var text=document.getSelection().toString();
        if(text) navigator.clipboard.writeText(text).catch(function(){});
        if(el.isContentEditable) document.execCommand('delete');
        else if(el.selectionStart!==undefined){ var s=el.selectionStart,e=el.selectionEnd,v=el.value;
          el.value=v.slice(0,s)+v.slice(e); el.selectionStart=el.selectionEnd=s;
          el.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
    });
    if (flags.canCopy) addWvItem('Copy', () => {
      wvExec(`(function(){ var el=window.__aetherLastEditable; if(el) el.focus();
        navigator.clipboard.writeText(document.getSelection().toString()).catch(function(){}); })()`);
    });
    if (flags.canPaste) addWvItem('Paste', () => {
      // Read clipboard BEFORE removing popup (document must be focused for clipboard API)
      navigator.clipboard.readText().then(text => {
        if (!text) return;
        popup.remove();
        wv.focus();
        setTimeout(() => {
          wv.executeJavaScript(`(function(){ var el=window.__aetherLastEditable; if(el) el.focus(); })()`)
            .then(() => wv.insertText(text))
            .catch(() => {});
        }, 50);
      }).catch(() => {});
    });
    if (flags.canSelectAll) addWvItem('Select All', () => {
      wvExec(`(function(){ var el=window.__aetherLastEditable; if(el){el.focus();el.select();}else document.execCommand('selectAll'); })()`);
    });
    if (wvCtx.children.length) popup.appendChild(wvCtx);
  }

  // Paste into nearby editable or chat input (only when near an editable field)
  if (!editableTarget && !hasContext && !capturedText && !webviewEditable && config.priorEditable) {
    const priorEditable = config.priorEditable;
    const pasteCtx = document.createElement('div');
    pasteCtx.className = 'doc-aether-context-items';
    const pasteItem = document.createElement('div');
    pasteItem.className = 'doc-aether-ctx-item';
    pasteItem.textContent = 'Paste text';
    pasteItem.addEventListener('mousedown', (ev) => ev.stopPropagation());
    pasteItem.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (!text) return;
        if (priorEditable && priorEditable.isConnected) {
          _pasteIntoElement(priorEditable, text);
          popup.remove();
        } else {
          const input = popup.querySelector('.doc-ask-inline-input');
          if (input) { input.value = text; input.focus(); }
        }
      }).catch(() => {});
    });
    pasteCtx.appendChild(pasteItem);
    popup.appendChild(pasteCtx);
  }
}

// ── Helper: build selection UI (Copy button + highlight dots) ──
function _panelBuildSelectionUI(popup, config) {
  const capturedText = config.selectionText || '';
  const selectionRange = config.selectionRange || null;
  const inTextLayer = !!config.inTextLayer;
  const editableTarget = config.editableTarget || null;
  const finalized = config.finalized !== false;

  if (!(finalized && capturedText && !editableTarget)) return;

  const btnRow = document.createElement('div');
  btnRow.className = 'doc-selection-popup-btns';

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'doc-selection-copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
  copyBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    navigator.clipboard.writeText(capturedText).then(() => {
      copyBtn.textContent = 'Copied';
      setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = 'Copy'; }, 1200);
    }).catch(() => {});
  });
  btnRow.appendChild(copyBtn);

  // Highlight color dots (only for PDF text layer)
  if (inTextLayer && selectionRange && typeof createHighlight === 'function') {
    popup._inTextLayer = true;
    popup._savedRange = selectionRange.cloneRange();
    const dotsWrap = document.createElement('div');
    dotsWrap.className = 'doc-hl-dots';
    const colors = typeof HIGHLIGHT_COLORS !== 'undefined' ? HIGHLIGHT_COLORS : [
      { name: 'yellow', bg: 'rgba(255,235,59,0.35)', solid: '#ffeb3b' },
      { name: 'green', bg: 'rgba(76,175,80,0.35)', solid: '#4caf50' },
      { name: 'blue', bg: 'rgba(66,165,245,0.35)', solid: '#42a5f5' },
      { name: 'pink', bg: 'rgba(236,64,122,0.35)', solid: '#ec407a' },
    ];
    for (const c of colors) {
      const dot = document.createElement('button');
      dot.className = 'doc-selection-hl-dot';
      dot.style.background = c.solid;
      dot.title = c.name;
      dot.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
      dot.addEventListener('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        popup.remove();
        _pdfSavedRange = selectionRange.cloneRange();
        createHighlight(c);
      });
      dotsWrap.appendChild(dot);
    }
    btnRow.appendChild(dotsWrap);
  }

  popup.appendChild(btnRow);

  // Author / Wikipedia preview (async)
  if (_isAuthorEligible(capturedText)) {
    const authorDiv = document.createElement('div');
    authorDiv.className = 'doc-wiki-preview';
    authorDiv.style.display = 'none';
    popup.appendChild(authorDiv);
    _fetchAuthorPreview(capturedText, authorDiv);
  } else if (_isAetherEligible(capturedText)) {
    const wikiDiv = document.createElement('div');
    wikiDiv.className = 'doc-wiki-preview';
    wikiDiv.style.display = 'none';
    popup.appendChild(wikiDiv);
    _fetchWikipediaPreview(capturedText, wikiDiv);
  }

  // Semantic search preview (async, always shown if text is long enough)
  if (capturedText.length >= 3) {
    const semDiv = document.createElement('div');
    semDiv.className = 'doc-wiki-preview';
    semDiv.style.display = 'none';
    popup.appendChild(semDiv);
    _fetchSemanticPreview(capturedText, semDiv);
  }
}

// ── Helper: build top actions bar (model label, clear, redo, copy, pin, sidebar, drag) ──
function _panelBuildTopBar(popup) {
  const topBar = document.createElement('div');
  topBar.className = 'doc-popup-chat-actions aether-top-actions';
  topBar.style.cursor = 'grab';

  // Model label
  const modelLabel = document.createElement('span');
  modelLabel.className = 'aether-model-label';
  const cm = localStorage.getItem('chatModel') || 'qwen2.5:3b';
  modelLabel.textContent = cm;
  modelLabel.title = 'Current model';
  topBar.appendChild(modelLabel);

  // Spacer
  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  topBar.appendChild(spacer);

  // "Save chat" button — only shown for PDF text layer
  const saveChatBtn = document.createElement('button');
  saveChatBtn.className = 'aether-topbar-btn';
  saveChatBtn.textContent = 'Save';
  saveChatBtn.style.display = 'none';
  saveChatBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  saveChatBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _saveChatAsHighlight(popup);
  });
  topBar.appendChild(saveChatBtn);
  popup._saveChatBtn = saveChatBtn;

  // Stats + context usage — inline in the top bar after model label
  const statsSpan = document.createElement('span');
  statsSpan.className = 'doc-chat-stats';
  topBar.insertBefore(statsSpan, spacer.nextSibling);
  const ctxSpan = document.createElement('span');
  ctxSpan.className = 'aether-context-usage';
  ctxSpan.textContent = '';
  topBar.insertBefore(ctxSpan, statsSpan.nextSibling);

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.className = 'aether-topbar-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  clearBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _popupChatMessages = [];
    _chatStreamStart = 0;
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    const cm = popup.querySelector('.doc-popup-chat-messages');
    if (cm) cm.innerHTML = '';
    const ca = popup.querySelector('.doc-popup-chat-area');
    if (ca) ca.classList.remove('visible');
    popup.classList.remove('has-chat');
    statsSpan.textContent = '';
    _repositionSelectionPopup();
  });
  topBar.appendChild(clearBtn);

  // Redo button — resend last user message
  const redoBtn = document.createElement('button');
  redoBtn.className = 'aether-topbar-btn';
  redoBtn.textContent = 'Redo';
  redoBtn.style.display = 'none';
  redoBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  redoBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    // Find last user message
    let lastUserIdx = -1;
    for (let i = _popupChatMessages.length - 1; i >= 0; i--) {
      if (_popupChatMessages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    // Remove the last user message and everything after it
    const lastUserMsg = _popupChatMessages[lastUserIdx];
    _popupChatMessages = _popupChatMessages.slice(0, lastUserIdx);
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    // Re-insert user message and re-send
    const input = popup.querySelector('.doc-ask-inline-input');
    if (input) input.value = lastUserMsg._display || lastUserMsg.content;
    _sendPopupChatMessage(popup, popup._capturedText || '');
  });
  topBar.appendChild(redoBtn);
  popup._redoBtn = redoBtn;

  // Copy chat button — copy last AI response
  const copyChatBtn = document.createElement('button');
  copyChatBtn.className = 'aether-topbar-btn';
  copyChatBtn.style.display = 'none';
  copyChatBtn.textContent = 'Copy';
  copyChatBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  copyChatBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    // Find last assistant message
    let lastAi = '';
    for (let i = _popupChatMessages.length - 1; i >= 0; i--) {
      if (_popupChatMessages[i].role === 'assistant' && !_popupChatMessages[i]._thinking) {
        lastAi = _popupChatMessages[i].content; break;
      }
    }
    if (!lastAi) return;
    navigator.clipboard.writeText(lastAi).then(() => {
      copyChatBtn.textContent = 'Copied';
      setTimeout(() => { if (copyChatBtn.isConnected) copyChatBtn.textContent = 'Copy'; }, 1200);
    }).catch(() => {});
  });
  topBar.appendChild(copyChatBtn);
  popup._copyChatBtn = copyChatBtn;

  // Right-side icon group (aligns with mic + send below)
  const topRightGroup = document.createElement('span');
  topRightGroup.className = 'aether-topbar-right';

  const openSidebarBtn = document.createElement('button');
  openSidebarBtn.className = 'aether-topbar-icon';
  openSidebarBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="m16.49 12 3.75-3.751m0 0-3.75-3.75m3.75 3.75H3.74V19.5" /></svg>';
  openSidebarBtn.title = 'Open in sidebar';
  openSidebarBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  openSidebarBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _aetherTrackMode = false;
    const sidebar = document.getElementById('browse-sidebar');
    if (sidebar) sidebar.style.display = '';
    _sendPopupChatToSidebar();
  });
  topRightGroup.appendChild(openSidebarBtn);

  topBar.appendChild(topRightGroup);

  // Drag to move
  topBar.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('button')) return;
    ev.stopPropagation();
    ev.preventDefault();
    _aetherDragging = true;
    _aetherDragPopup = popup;
    _aetherTrackMode = false;
    topBar.style.cursor = 'grabbing';
    const r = popup.getBoundingClientRect();
    _aetherDragOffset = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });

  popup.appendChild(topBar);
}

// ── Helper: build chat input area (textarea, model selector, send button, mic, dropdowns) ──
function _panelBuildChatInput(popup, config) {
  const contextMenu = config.contextMenu || null;
  const capturedText = config.selectionText || '';
  const finalized = config.finalized !== false;
  if (!finalized) return;

  // Chat area (messages container)
  const chatArea = document.createElement('div');
  chatArea.className = 'doc-popup-chat-area';
  chatArea.style.borderTop = 'none';
  if (capturedText) {
    const chatContext = document.createElement('div');
    chatContext.className = 'doc-popup-chat-context';
    const contextTrunc = capturedText.length > 120 ? capturedText.slice(0, 120) + '…' : capturedText;
    chatContext.textContent = contextTrunc;
    chatArea.appendChild(chatContext);
  }
  const chatMsgs = document.createElement('div');
  chatMsgs.className = 'doc-popup-chat-messages';
  chatArea.appendChild(chatMsgs);
  popup.appendChild(chatArea);

  // Screenshot / attachment strip
  const attachStrip = document.createElement('div');
  attachStrip.className = 'doc-screenshot-attachments';
  // Add selected text as a context chip in the strip
  if (capturedText) {
    attachStrip.style.display = 'flex';
    const chip = document.createElement('div');
    chip.className = 'doc-tab-context-chip';
    const truncated = capturedText.length > 60 ? capturedText.slice(0, 60) + '…' : capturedText;
    chip.innerHTML = `<svg class="w-3 h-3 flex-shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>` +
      `<span class="truncate">${escapeHtml(truncated)}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'doc-note-context-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    removeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      chip.remove();
      popup._capturedText = '';
      if (!attachStrip.children.length) attachStrip.style.display = 'none';
    });
    chip.appendChild(removeBtn);
    attachStrip.appendChild(chip);
  }
  popup.appendChild(attachStrip);

  // Ask input + send button
  const askWrap = document.createElement('div');
  askWrap.className = 'doc-ask-inline-wrap';
  if (!capturedText) {
    askWrap.style.borderTop = 'none';
    askWrap.style.marginTop = '0';
    askWrap.style.paddingTop = '0';
  }
  const askInput = document.createElement('input');
  askInput.type = 'text';
  askInput.placeholder = capturedText ? 'Ask about this…' : 'Ask anything…';
  askInput.className = 'doc-ask-inline-input';

  const sendBtn = document.createElement('button');
  sendBtn.className = 'doc-ask-inline-send';
  sendBtn.innerHTML = '↑';
  sendBtn.title = 'Send';
  sendBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  sendBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; _renderPopupChat(popup, true); return; }
    _sendPopupChatMessage(popup, capturedText);
  });
  askInput.addEventListener('keydown', (ev) => {
    // Let Cmd+I bubble up to document handler for toggle
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'i') return;
    ev.stopPropagation();
    // Tab accepts AI suggestion
    if (ev.key === 'Tab' && !ev.shiftKey) {
      const suggEl = popup.querySelector('.aether-suggestion');
      if (suggEl) {
        ev.preventDefault();
        const text = suggEl.querySelector('.aether-suggestion-text').textContent;
        _acceptPanelSuggestion(popup, text);
        return;
      }
    }
    const val = askInput.value;
    const isCmd = val.startsWith('/');
    const dropdown = popup.querySelector('.aether-cmd-dropdown');
    const noteDropdown = popup.querySelector('.aether-note-dropdown:not(.aether-model-dropdown):not(.aether-history-dropdown)');
    const modelDropdown = popup.querySelector('.aether-model-dropdown');

    // Arrow keys navigate model dropdown
    if (modelDropdown && _aetherModelList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') _aetherModelIdx = Math.min(_aetherModelIdx + 1, _aetherModelList.length - 1);
      else _aetherModelIdx = Math.max(_aetherModelIdx - 1, 0);
      _aetherRenderModelDropdown(popup);
      const sel = modelDropdown.querySelector('.aether-note-item.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (modelDropdown && _aetherModelList.length && ev.key === 'Enter') {
      ev.preventDefault();
      _aetherSelectModel(popup);
      return;
    }
    if (modelDropdown && ev.key === 'Escape') {
      ev.preventDefault();
      _aetherHideModelDropdown(popup);
      return;
    }

    // Arrow keys navigate tab dropdown
    const tabDropdown = popup.querySelector('.aether-tab-dropdown');
    if (tabDropdown && _aetherTabList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') _aetherTabIdx = Math.min(_aetherTabIdx + 1, _aetherTabList.length - 1);
      else _aetherTabIdx = Math.max(_aetherTabIdx - 1, 0);
      const items = tabDropdown.querySelectorAll('.aether-tab-item');
      items.forEach((el, i) => el.classList.toggle('selected', i === _aetherTabIdx));
      const sel = items[_aetherTabIdx];
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (tabDropdown && _aetherTabList.length && ev.key === 'Enter') {
      ev.preventDefault();
      if (_aetherTabSwitchMode) _aetherSwitchToTab(popup);
      else _aetherSelectTab(popup);
      return;
    }
    if (tabDropdown && ev.key === 'Escape') {
      ev.preventDefault();
      _aetherHideTabDropdown(popup);
      return;
    }

    // Arrow keys navigate note search results
    if (noteDropdown && _aetherNoteResults.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') _aetherNoteIdx = Math.min(_aetherNoteIdx + 1, _aetherNoteResults.length - 1);
      else _aetherNoteIdx = Math.max(_aetherNoteIdx - 1, 0);
      const items = noteDropdown.querySelectorAll('.aether-note-item');
      items.forEach((el, i) => el.classList.toggle('selected', i === _aetherNoteIdx));
      const sel = items[_aetherNoteIdx];
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (noteDropdown && ev.key === 'Enter') {
      ev.preventDefault();
      if (_aetherNoteResults.length) {
        _aetherOpenSelectedNote(popup);
      } else if (_aetherNoteQuery) {
        _aetherCreateAndOpenNote(popup, _aetherNoteQuery);
      }
      return;
    }

    // Arrow keys navigate history dropdown
    const histDropdown = popup.querySelector('.aether-history-dropdown');
    if (histDropdown && _aetherHistoryList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') _aetherHistoryIdx = Math.min(_aetherHistoryIdx + 1, _aetherHistoryList.length - 1);
      else _aetherHistoryIdx = Math.max(_aetherHistoryIdx - 1, -1);
      const items = histDropdown.querySelectorAll('.aether-note-item');
      items.forEach(el => el.classList.toggle('selected', parseInt(el.dataset.idx) === _aetherHistoryIdx));
      const sel = histDropdown.querySelector(`.aether-note-item[data-idx="${_aetherHistoryIdx}"]`);
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (histDropdown && ev.key === 'Enter') {
      ev.preventDefault();
      _aetherSelectHistory(popup);
      return;
    }
    if (histDropdown && ev.key === 'Escape') {
      ev.preventDefault();
      _aetherHideHistoryDropdown(popup);
      return;
    }

    // Arrow keys navigate command autocomplete
    if (isCmd && dropdown && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      const items = dropdown.querySelectorAll('.aether-cmd-item');
      if (ev.key === 'ArrowDown') _aetherCmdIdx = Math.min(_aetherCmdIdx + 1, items.length - 1);
      else _aetherCmdIdx = Math.max(_aetherCmdIdx - 1, 0);
      _aetherRenderCmdDropdown(popup, val.slice(1).trim());
      const dd = popup.querySelector('.aether-cmd-dropdown');
      const sel = dd && dd.querySelector('.aether-cmd-item.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (isCmd && dropdown && ev.key === 'Tab') {
      ev.preventDefault();
      const matches = _aetherFilterCommands(val.slice(1).trim());
      if (matches[_aetherCmdIdx]) askInput.value = '/' + matches[_aetherCmdIdx].name;
      _aetherRenderCmdDropdown(popup, matches[_aetherCmdIdx]?.name || '');
      return;
    }

    if (ev.key === 'Enter' && ev.shiftKey) {
      ev.preventDefault();
      _aetherHideCmdDropdown(popup);
      _doAetherWebSearch(popup);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (isCmd && dropdown) {
        const matches = _aetherFilterCommands(val.slice(1).trim());
        const cmd = matches[_aetherCmdIdx] || matches[0];
        if (cmd) {
          if (cmd.hasArgs) {
            askInput.value = '/' + cmd.name + ' ';
            _aetherHideCmdDropdown(popup);
          } else if (cmd._special) {
            _aetherHideCmdDropdown(popup);
            if (cmd.name === 'capture') _doAetherCapture(popup);
            else if (cmd.name === 'model') _doAetherModel(popup);
            else if (cmd.name === 'links') _doAetherLinks(popup);
            else if (cmd.name === 'tab') _doAetherTab(popup);
            else if (cmd.name === 'tabs') _doAetherTabs(popup);
            else if (cmd.name === 'notes') _doAetherNotesBrowse(popup);
            else if (cmd.name === 'history') _doAetherHistory(popup);
            else if (cmd.name === 'help') _doAetherHelp(popup);
          } else {
            _aetherHideCmdDropdown(popup);
            cmd.fn();
            _aetherTrackMode = false;
            popup.remove();
          }
          return;
        }
      }
      if (isCmd && val.trim().length > 1) {
        _aetherExecCommand(popup, val);
      } else if (!isCmd) {
        _aetherHideCmdDropdown(popup);
        _sendPopupChatMessage(popup, capturedText);
      }
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (modelDropdown) { _aetherHideModelDropdown(popup); return; }
      if (noteDropdown) { _aetherHideNoteDropdown(popup); return; }
      if (dropdown) { _aetherHideCmdDropdown(popup); return; }
      _aetherTrackMode = false;
      _aetherPinned = false;
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _pendingScreenshots = [];
      _pendingNoteContexts = [];
      _pendingTabContexts = [];
      _savePopupChatToHighlight(popup);
      popup.remove();
      _aetherShowCursor();
      _aetherRestoreFocus();
    }
    // Shift clicks the element under cursor and dismisses the panel
    if (ev.key === 'Shift' && _aetherTrackMode) {
      _aetherTrackMode = false;
      const el = document.elementFromPoint(_lastMouseX, _lastMouseY);
      if (el && !popup.contains(el)) el.click();
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _pendingScreenshots = [];
      _pendingNoteContexts = [];
      _pendingTabContexts = [];
      popup.remove();
      _aetherShowCursor();
    }
  });
  askInput.addEventListener('input', () => {
    // Dismiss suggestion when user types
    const suggEl = popup.querySelector('.aether-suggestion');
    if (suggEl) {
      suggEl.remove();
      if (!askInput.value.trim()) askInput.placeholder = popup._capturedText ? 'Ask about this…' : 'Ask anything…';
    }
    const val = askInput.value;
    if (val.startsWith('/')) {
      const notesMatch = val.match(/^\/notes(\s+(.*))?$/i);
      const histMatch = val.match(/^\/history(\s+(.*))?$/i);
      if (notesMatch && notesMatch[1] !== undefined) {
        _aetherHideCmdDropdown(popup);
        _aetherHideHistoryDropdown(popup);
        _aetherNoteIdx = 0;
        _aetherRenderNoteDropdown(popup, (notesMatch[2] || '').trim());
      } else if (histMatch && histMatch[1] !== undefined) {
        _aetherHideCmdDropdown(popup);
        _aetherHideNoteDropdown(popup);
        _aetherHistoryIdx = -1;
        _aetherRenderHistoryDropdown(popup, (histMatch[2] || '').trim());
      } else {
        _aetherHideNoteDropdown(popup);
        _aetherHideHistoryDropdown(popup);
        _aetherCmdIdx = 0;
        _aetherRenderCmdDropdown(popup, val.slice(1).trim());
      }
    } else {
      _aetherHideCmdDropdown(popup);
      _aetherHideNoteDropdown(popup);
      _aetherHideHistoryDropdown(popup);
    }
  });
  askInput.addEventListener('mousedown', (ev) => ev.stopPropagation());
  // Mic button for voice input (MediaRecorder + Whisper)
  const micBtn = document.createElement('button');
  micBtn.className = 'doc-ask-mic-btn';
  micBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  micBtn.title = 'Voice input';
  let micRecorder = null;
  micBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  micBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    if (micRecorder) {
      micRecorder.stop();
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks = [];
      micRecorder = recorder;
      micBtn.classList.add('doc-ask-mic-active');
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        micRecorder = null;
        micBtn.classList.remove('doc-ask-mic-active');
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        // Show transcribing state
        const prevPlaceholder = askInput.placeholder;
        askInput.placeholder = 'Transcribing…';
        fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: blob })
          .then(r => r.json())
          .then(data => {
            askInput.placeholder = prevPlaceholder;
            if (data.text) {
              askInput.value = askInput.value + (askInput.value ? ' ' : '') + data.text;
              askInput.focus();
            }
          })
          .catch(() => { askInput.placeholder = prevPlaceholder; });
      };
      recorder.start();
    }).catch(() => {});
  });

  const inputRightGroup = document.createElement('span');
  inputRightGroup.className = 'aether-topbar-right';
  inputRightGroup.appendChild(micBtn);
  inputRightGroup.appendChild(sendBtn);
  askWrap.appendChild(askInput);
  askWrap.appendChild(inputRightGroup);
  popup.appendChild(askWrap);

  // Fetch AI suggestion when there's any text context
  const suggestText = capturedText
    || (contextMenu && contextMenu.linkText)
    || (contextMenu && contextMenu.linkUrl)
    || (() => {
      // Use current page/tab title + URL as context
      const bt = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
        ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
      if (bt && bt.title) return bt.title + (bt.url ? ' — ' + bt.url : '');
      if (_docText) return _docText.slice(0, 300);
      return '';
    })();
  if (suggestText) {
    _fetchPanelSuggestion(popup, suggestText);
  }
}

// ── Helper: install Cmd+C copy key handler ──
function _panelBuildCopyKeyHandler(popup) {
  function _onCopyKey(e) {
    if (!((e.metaKey || e.ctrlKey) && e.key === 'c')) return;
    if (!popup.isConnected) { document.removeEventListener('keydown', _onCopyKey, true); return; }
    // Only act when the input is empty (user hasn't typed anything)
    const input = popup.querySelector('.doc-ask-inline-input');
    if (input && input.value) return;
    // Copy the captured selection text if available
    const text = popup._capturedText;
    if (text) {
      e.preventDefault();
      navigator.clipboard.writeText(text).catch(() => {});
    }
    _flashCopyBtn(popup);
  }
  document.addEventListener('keydown', _onCopyKey, true);
}

// ── Helper: position panel and auto-focus input ──
function _panelPositionAndFocus(popup, config) {
  const anchor = config.anchor || {};
  const finalized = config.finalized !== false;
  const initialValue = config.initialValue || '';
  const isSelectionAnchor = !!anchor.selectionRect;
  const isTabAnchor = !!anchor.tab;
  const isCursorAnchor = !isSelectionAnchor && !isTabAnchor;

  if (isTabAnchor) {
    // Tab context: position below the tab element
    const tabEl = anchor.tab;
    const tabRect = tabEl.getBoundingClientRect();
    popup.classList.add('tab-context-panel');
    popup.style.maxWidth = '';
    popup._tabContextAnchor = { left: tabRect.left, top: tabRect.bottom, tabWidth: tabRect.width };
    let left = tabRect.left;
    const rect = popup.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    popup.style.left = left + 'px';
    popup.style.top = tabRect.bottom + 'px';
    popup.style.visibility = '';
    popup._aetherAnchorX = left;
    popup._aetherAnchorY = tabRect.bottom + rect.height;
    // Keep panel open while mouse is inside (matches hover tooltip behavior)
    popup.addEventListener('mouseenter', () => { if (typeof _tabHoverDismissTimeout !== 'undefined') clearTimeout(_tabHoverDismissTimeout); });
    popup.addEventListener('mouseleave', () => { if (typeof _tabHoverDismissTimeout !== 'undefined') { clearTimeout(_tabHoverDismissTimeout); _tabHoverDismissTimeout = setTimeout(() => { if (popup.isConnected) popup.remove(); }, 150); } });
  } else if (isSelectionAnchor) {
    // Selection: above or below selection rect
    const selRect = anchor.selectionRect;
    popup._anchorTop = selRect.top;
    popup._anchorBottom = selRect.bottom;
    popup._anchorLeft = selRect.left;
    const popupRect = popup.getBoundingClientRect();
    let top = selRect.top - popupRect.height - 8;
    const fitsAbove = top >= 4;
    if (!fitsAbove) top = selRect.bottom + 8;
    popup._aboveSelection = fitsAbove;
    let left = selRect.left;
    if (left + popupRect.width > window.innerWidth - 8) left = window.innerWidth - popupRect.width - 8;
    if (left < 4) left = 4;
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.style.visibility = '';
  } else {
    // Cursor anchor: position so the input caret is at the click point
    const x = anchor.x || 0;
    const y = anchor.y || 0;
    popup._aetherAnchorX = x;
    popup._aetherAnchorY = y;
    const rect = popup.getBoundingClientRect();
    const askInput = popup.querySelector('.doc-ask-inline-input');
    let inputOffsetX = 0, inputOffsetY = 0;
    if (askInput) {
      const inputRect = askInput.getBoundingClientRect();
      // Offset from panel left to input's text start (left edge + padding)
      const inputPadLeft = parseFloat(getComputedStyle(askInput).paddingLeft) || 0;
      inputOffsetX = (inputRect.left - rect.left) + inputPadLeft;
      // Offset from panel top to input's vertical center
      inputOffsetY = (inputRect.top - rect.top) + inputRect.height / 2;
    }
    const _initLeft = (localStorage.getItem('aetherPanelSide') || 'left') === 'left';
    // Desired panel position: input caret at (x, y)
    let left = x - inputOffsetX;
    let top = y - inputOffsetY;
    // Clamp to viewport
    const bounds = _popupSafeBounds();
    if (left + rect.width > bounds.right) left = bounds.right - rect.width;
    if (left < bounds.left) left = bounds.left;
    if (top + rect.height > bounds.bottom) top = bounds.bottom - rect.height;
    if (top < bounds.top) top = bounds.top;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.visibility = '';
  }

  // Auto-focus input
  if (finalized) {
    const askInput = popup.querySelector('.doc-ask-inline-input');
    if (askInput) {
      if (isSelectionAnchor) {
        setTimeout(() => askInput.focus(), 10);
      } else {
        askInput.focus();
      }
    }
    _updateContextBar(popup);
  }

  // Pre-fill input and trigger command dropdown if initialValue provided
  if (finalized && initialValue) {
    const askInput = popup.querySelector('.doc-ask-inline-input');
    if (askInput) {
      askInput.value = initialValue;
      if (initialValue.startsWith('/')) {
        _aetherCmdIdx = 0;
        _aetherRenderCmdDropdown(popup, initialValue.slice(1).trim());
      }
      // Reposition after dropdown renders
      if (isCursorAnchor) {
        const ax = anchor.x || 0, ay = anchor.y || 0;
        requestAnimationFrame(() => {
          const r2 = popup.getBoundingClientRect();
          let t2 = ay - r2.height;
          if (t2 < 0) t2 = 0;
          popup.style.top = t2 + 'px';
        });
      }
    }
  }
}

function _showPanel(config) {
  config = config || {};
  const anchor = config.anchor || {};
  const contextMenu = config.contextMenu || null;
  const selectionText = config.selectionText || '';
  const editableTarget = config.editableTarget || null;
  const finalized = config.finalized !== false; // default true

  // Save the currently focused element so Escape can restore it
  const ae = document.activeElement;
  if (ae && ae !== document.body && !ae.closest('#doc-chat-ask-float')) {
    _aetherPrevFocus = { el: ae, selStart: ae.selectionStart, selEnd: ae.selectionEnd };
  }

  // Remove any existing active panel
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) {
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    if (!selectionText) _savePopupChatToHighlight(existing);
    existing.remove();
  }
  // Stop any ongoing TTS when panel is recreated
  if (_ttsAudio) { _ttsAudio.pause(); _ttsAudio = null; _ttsStopWaveform(); islandRemove('tts'); }
  // Remove any open note editor or help panel
  const existingEditor = document.getElementById('aether-note-editor');
  if (existingEditor) existingEditor.remove();
  const existingHelp = document.getElementById('aether-help-panel');
  if (existingHelp) existingHelp.remove();

  const popup = document.createElement('div');
  popup.id = 'doc-chat-ask-float';
  popup.className = 'doc-selection-popup';
  const _origRemove = popup.remove.bind(popup);
  popup.remove = function() { if (_ttsAudio) { _ttsAudio.pause(); _ttsAudio = null; _ttsStopWaveform(); islandRemove('tts'); } _origRemove(); };

  // Determine anchor mode
  const isSelectionAnchor = !!anchor.selectionRect;
  const isTabAnchor = !!anchor.tab;
  const isCursorAnchor = !isSelectionAnchor && !isTabAnchor;

  if (isCursorAnchor) popup._isAetherPanel = true;
  if (!finalized) popup.style.visibility = 'hidden';

  const hasContext = contextMenu && (contextMenu.linkUrl || contextMenu.imgUrl || contextMenu.items);
  _aetherPinned = false;
  if (isCursorAnchor) {
    _aetherTrackMode = config.trackCursor !== undefined ? config.trackCursor : false;
  } else {
    _aetherTrackMode = false;
  }

  const capturedText = selectionText;
  popup._capturedText = capturedText || '';

  // Reset shared state for new panel (unless preview)
  if (finalized) {
    _popupChatMessages = [];
    _pendingScreenshots = [];
    _pendingNoteContexts = [];
    _pendingTabContexts = [];
    _aetherDragging = false;
    _aetherDragPopup = null;
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
  }

  // ── Context usage progress bar (very top) ──
  const ctxBar = document.createElement('div');
  ctxBar.className = 'aether-context-bar';
  const ctxFill = document.createElement('div');
  ctxFill.className = 'aether-context-fill';
  ctxBar.appendChild(ctxFill);
  popup.appendChild(ctxBar);

  // ── Build panel sections via helpers ──
  _panelBuildContextItems(popup, config);
  _panelBuildLinkContextMenu(popup, config);
  _panelBuildEditableActions(popup, config, capturedText, hasContext);
  _panelBuildSelectionUI(popup, config);
  if (finalized) _panelBuildTopBar(popup);
  _panelBuildChatInput(popup, config);

  // Show "Save chat" button if in PDF text layer
  if (popup._inTextLayer && popup._saveChatBtn) {
    popup._saveChatBtn.style.display = '';
  }

  popup.addEventListener('mousedown', (ev) => {
    // Don't stop propagation — let clicks dismiss the panel
  });

  document.body.appendChild(popup);

  // Hide cursor while panel is open
  if (isCursorAnchor && finalized && _aetherTrackMode) {
    _aetherHideCursorOverlay();
  }

  // ── Cmd+C handler + positioning ──
  _panelBuildCopyKeyHandler(popup);
  _panelPositionAndFocus(popup, config);

  return popup;
}


function openPaper(index, e) {
  const paper = lastFilteredPapers[index];
  if (!paper) return;
  if (_isNewTabClick(e)) { _openInNewTab(paper.link); return; }
  markPostAsRead(paper.link);
  _browseReturnView = _lastActiveView || 'feed';
  openBrowseWithPaper(paper.link, paper);
}

function openPaperByUrl(url, e) {
  if (_isNewTabClick(e)) { _openInNewTab(url); return; }
  _browseReturnView = typeof _lastActiveView !== 'undefined' ? _lastActiveView : 'feed';
  const paper = (typeof searchResultsCache !== 'undefined' && searchResultsCache || []).find(r => r && r.link === url)
    || (typeof getSavedPosts === 'function' && getSavedPosts()[url]?.paper)
    || (typeof allPapers !== 'undefined' && allPapers.find(p => p.link === url))
    || { title: 'Paper', link: url, description: '', authors: '', categories: [], source: url.includes('arxiv.org') ? 'arxiv' : '' };
  openBrowseWithPaper(url, paper);
}
