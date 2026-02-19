// panel-commands.js — Aether slash commands and preview system

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
        const href = a.getAttribute('href');
        if (href && typeof _openInNewTab === 'function') _openInNewTab(href);
        else window.open(href, '_blank');
        document.getElementById('doc-chat-ask-float')?.remove();
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
      const href = a.getAttribute('href');
      if (href && typeof _openInNewTab === 'function') _openInNewTab(href);
      else window.open(href, '_blank');
      document.getElementById('doc-chat-ask-float')?.remove();
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
    const data = await apiPost('/api/author-lookup', { query: text.trim() });
    if (data.error || !data.name) { containerDiv.style.display = 'none'; return; }
    _renderAuthorPreviewHtml(data, containerDiv);
  } catch (e) {
    containerDiv.style.display = 'none';
  }
}


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
    const data = await apiGet('/api/web-search?q=' + encodeURIComponent(q));
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
  { name: 'paper', desc: 'Search for papers', hasArgs: true },
  { name: 'user', desc: 'Search for users', hasArgs: true },
  { name: 'capture', desc: 'Screenshot the page', _special: true },
  { name: 'agent', desc: 'Switch AI agent', _special: true },
  { name: 'model', desc: 'Change chat model', _special: true },
  { name: 'search', desc: 'Web search in new tab', hasArgs: true },
  { name: 'links', desc: 'List all links on page', _special: true },
  { name: 'tab', desc: 'Add a tab to context', _special: true },
  { name: 'tabs', desc: 'Switch to an open tab', _special: true },
  { name: 'define', desc: 'Look up a word definition', hasArgs: true },
  { name: 'upload', desc: 'Open a local file', fn: () => { const fi = document.getElementById('browse-pdf-file-input'); if (fi) { fi.click(); return; } const tmp = document.createElement('input'); tmp.type = 'file'; tmp.style.display = 'none'; tmp.onchange = function() { if (tmp.files[0] && typeof openLocalPdf === 'function') openLocalPdf(tmp.files[0]); tmp.remove(); }; document.body.appendChild(tmp); tmp.click(); } },
  { name: 'history', desc: 'Browse visited sites', _special: true },
  { name: 'help', desc: 'Show all commands & features', _special: true },
];

// State variables declared in panel-state.js:
// _aetherCmdIdx, _aetherTabIdx, _aetherTabList, _aetherTabSwitchMode

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
    var ddView = new View('div').className('aether-cmd-dropdown');
    ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
    dropdown = ddView.el;
    var askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  _aetherCmdIdx = Math.min(_aetherCmdIdx, matches.length - 1);
  dropdown.innerHTML = '';
  matches.forEach(function(c, i) {
    var row = new View('div').className('aether-cmd-item' + (i === _aetherCmdIdx ? ' selected' : ''));
    row.el.dataset.idx = String(i);
    var nameSpan = new View('span').className('aether-cmd-name');
    nameSpan.el.textContent = '/' + c.name;
    var descSpan = new View('span').className('aether-cmd-desc');
    descSpan.el.textContent = c.desc;
    row.el.appendChild(nameSpan.el);
    row.el.appendChild(descSpan.el);
    // Click to execute or fill
    (function(cmd) {
      row.el.addEventListener('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (!cmd) return;
        if (cmd.hasArgs) {
          var askInput = popup.querySelector('.doc-ask-inline-input') || popup.querySelector('.doc-ask-inline');
          if (askInput) { askInput.value = '/' + cmd.name + ' '; askInput.focus(); }
          _aetherHideCmdDropdown(popup);
        } else if (cmd._special) {
          _aetherHideCmdDropdown(popup);
          if (cmd.name === 'capture') _doAetherCapture(popup);
          else if (cmd.name === 'agent') _doAetherAgent(popup);
          else if (cmd.name === 'model') _doAetherModel(popup);
          else if (cmd.name === 'links') _doAetherLinks(popup);
          else if (cmd.name === 'tab') _doAetherTab(popup);
          else if (cmd.name === 'tabs') _doAetherTabs(popup);
          else if (cmd.name === 'history') _doAetherHistory(popup);
          else if (cmd.name === 'help') _doAetherHelp(popup);
        } else {
          cmd.fn();
          _aetherTrackMode = false;
          popup.remove();
        }
      });
    })(c);
    dropdown.appendChild(row.el);
  });
  _repositionSelectionPopup();
}

function _aetherHideCmdDropdown(popup) {
  const dropdown = popup.querySelector('.aether-cmd-dropdown');
  if (dropdown) dropdown.remove();
}


function _aetherHideTabDropdown(popup) {
  const dropdown = popup.querySelector('.aether-tab-dropdown');
  if (dropdown) dropdown.remove();
  _aetherTabList = [];
  _aetherTabIdx = 0;
  _aetherTabSwitchMode = false;
}

// State variables declared in panel-state.js: _aetherHistoryIdx, _aetherHistoryList

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
      var ddView = new View('div').className('aether-history-dropdown aether-note-dropdown');
      ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
      dropdown = ddView.el;
      const askWrap = popup.querySelector('.doc-ask-inline-wrap');
      if (askWrap) popup.insertBefore(dropdown, askWrap);
      else popup.appendChild(dropdown);
    }
    var emptyMsg = new View('div');
    emptyMsg.cssText('padding:10px 12px;font-size:0.8rem;color:var(--nr-text-secondary);text-align:center');
    emptyMsg.el.textContent = 'No history found';
    dropdown.innerHTML = '';
    dropdown.appendChild(emptyMsg.el);
    _repositionSelectionPopup();
    return;
  }

  if (!dropdown) {
    var ddView = new View('div').className('aether-history-dropdown aether-note-dropdown');
    ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
    dropdown = ddView.el;
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  if (_aetherHistoryIdx >= _aetherHistoryList.length) _aetherHistoryIdx = _aetherHistoryList.length - 1;

  dropdown.innerHTML = '';
  const fullSelected = _aetherHistoryIdx === -1;
  var fullRow = new View('div').className('aether-note-item aether-history-full' + (fullSelected ? ' selected' : ''));
  fullRow.el.dataset.idx = '-1';
  fullRow.cssText('padding:6px 10px;font-size:0.75rem;border-bottom:none');
  fullRow.el.textContent = 'See full history';
  fullRow.el.addEventListener('click', function(ev) {
    ev.stopPropagation(); ev.preventDefault();
    _aetherHideHistoryDropdown(popup);
    popup.remove();
    _aetherTrackMode = false;
    if (typeof openSearchHistoryPage === 'function') openSearchHistoryPage();
  });
  dropdown.appendChild(fullRow.el);

  _aetherHistoryList.forEach(function(h, i) {
    var domain = '';
    try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
    const favicon = typeof _browseFaviconUrl === 'function' ? _browseFaviconUrl(h.url) : '';
    const time = typeof _relativeTime === 'function' ? _relativeTime(h.ts) : '';

    var favImg = new View('img');
    favImg.el.src = favicon;
    favImg.cssText('width:14px;height:14px;flex-shrink:0;border-radius:2px');
    favImg.el.onerror = function() { this.style.display = 'none'; };

    var titleDiv = new View('div');
    titleDiv.cssText('font-size:0.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
    titleDiv.el.textContent = h.title || domain;

    var domainDiv = new View('div');
    domainDiv.cssText('font-size:0.68rem;color:var(--nr-text-quaternary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
    domainDiv.el.textContent = domain;

    var infoDiv = new View('div');
    infoDiv.cssText('flex:1;min-width:0;overflow:hidden');
    infoDiv.el.appendChild(titleDiv.el);
    infoDiv.el.appendChild(domainDiv.el);

    var timeSpan = new View('span');
    timeSpan.cssText('font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0');
    timeSpan.el.textContent = time;

    var row = new View('div').className('aether-note-item' + (i === _aetherHistoryIdx ? ' selected' : ''));
    row.el.dataset.idx = String(i);
    row.cssText('display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:none');
    row.el.appendChild(favImg.el);
    row.el.appendChild(infoDiv.el);
    row.el.appendChild(timeSpan.el);

    (function(entry) {
      row.el.addEventListener('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (!entry) return;
        _aetherHideHistoryDropdown(popup);
        popup.remove();
        _aetherTrackMode = false;
        if (typeof browseNavigate === 'function') browseNavigate(entry.url);
      });
    })(h);
    dropdown.appendChild(row.el);
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
// State variables declared in panel-state.js: _aetherModelIdx, _aetherModelList

async function _doAetherModel(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  // Fetch available models
  _aetherModelList = [];
  _aetherModelIdx = 0;
  try {
    const data = await apiGet('/api/models');
    _aetherModelList = data.models || [];
  } catch (e) {
    _aetherModelList = [];
  }

  if (!_aetherModelList.length) {
    // Show error inline
    if (input) { input.value = ''; input.placeholder = 'No models available'; input.focus(); }
    return;
  }

  const currentModel = Settings.get('chatModel') || '';
  // Pre-select current model if found
  const curIdx = _aetherModelList.indexOf(currentModel);
  if (curIdx >= 0) _aetherModelIdx = curIdx;

  _aetherRenderModelDropdown(popup);
}

function _aetherRenderModelDropdown(popup) {
  let dropdown = popup.querySelector('.aether-model-dropdown');
  if (!dropdown) {
    var ddView = new View('div').className('aether-note-dropdown aether-model-dropdown');
    ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
    dropdown = ddView.el;
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  const currentModel = Settings.get('chatModel') || '';
  dropdown.innerHTML = '';
  _aetherModelList.forEach(function(m, i) {
    const active = m === currentModel;
    var row = new View('div').className('aether-note-item' + (i === _aetherModelIdx ? ' selected' : ''));
    row.el.dataset.idx = String(i);

    var nameSpan = new View('span').className('aether-note-item-title');
    nameSpan.el.textContent = m;
    row.el.appendChild(nameSpan.el);

    if (active) {
      var curSpan = new View('span').className('aether-note-item-tags');
      curSpan.cssText('margin-left:auto;opacity:0.6');
      curSpan.el.textContent = 'current';
      row.el.appendChild(curSpan.el);
    }

    (function(model, idx) {
      row.el.addEventListener('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (model) {
          _aetherModelIdx = idx;
          Settings.set('chatModel', model);
          _aetherRenderModelDropdown(popup);
          const label = popup.querySelector('.aether-model-label');
          if (label) label.textContent = model;
          const input = popup.querySelector('.doc-ask-inline-input');
          if (input) { input.value = ''; input.focus(); }
          if (!Settings.get('ach_model_switch')) {
            Settings.set('ach_model_switch', '1');
            if (typeof showAchievement === 'function') showAchievement('Model Swapper', 'Switched your AI model for the first time');
          }
        }
      });
    })(m, i);
    dropdown.appendChild(row.el);
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
    Settings.set('chatModel', model);
    _aetherHideModelDropdown(popup);
    const label = popup.querySelector('.aether-model-label');
    if (label) label.textContent = model;
    const input = popup.querySelector('.doc-ask-inline-input');
    if (input) { input.value = ''; input.placeholder = 'Ask anything…'; input.focus(); }
  }
}

// ── /agent command — switch AI agent ──
// State variables declared in panel-state.js: _aetherAgentIdx, _aetherAgentList

async function _doAetherAgent(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  _aetherTrackMode = false;

  // Fetch available agents
  _aetherAgentList = [];
  _aetherAgentIdx = 0;
  try {
    if (window.electronAPI?.agentList) {
      _aetherAgentList = await window.electronAPI.agentList();
    }
  } catch (e) {
    _aetherAgentList = [];
  }

  if (!_aetherAgentList.length) {
    if (input) { input.value = ''; input.placeholder = 'No agents available'; input.focus(); }
    return;
  }

  const currentAgent = Settings.get('chatAgent') || 'research-assistant';
  const curIdx = _aetherAgentList.findIndex(a => a.id === currentAgent);
  if (curIdx >= 0) _aetherAgentIdx = curIdx;

  _aetherRenderAgentDropdown(popup);
}

function _aetherRenderAgentDropdown(popup) {
  let dropdown = popup.querySelector('.aether-agent-dropdown');
  if (!dropdown) {
    var ddView = new View('div').className('aether-note-dropdown aether-agent-dropdown');
    ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
    dropdown = ddView.el;
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  const currentAgent = Settings.get('chatAgent') || 'research-assistant';
  dropdown.innerHTML = '';
  _aetherAgentList.forEach(function(a, i) {
    const active = a.id === currentAgent;
    var row = new View('div').className('aether-note-item' + (i === _aetherAgentIdx ? ' selected' : ''));
    row.el.dataset.idx = String(i);

    var nameDiv = new View('div').className('aether-note-item-title');
    nameDiv.el.textContent = a.name;
    row.el.appendChild(nameDiv.el);

    var descDiv = new View('div').className('aether-note-item-snippet');
    descDiv.el.textContent = a.description;
    row.el.appendChild(descDiv.el);

    if (active) {
      var curSpan = new View('span').className('aether-note-item-tags');
      curSpan.cssText('margin-left:auto;opacity:0.6');
      curSpan.el.textContent = 'current';
      row.el.appendChild(curSpan.el);
    }

    (function(agent, idx) {
      row.el.addEventListener('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (agent) {
          _aetherAgentIdx = idx;
          Settings.set('chatAgent', agent.id);
          _aetherRenderAgentDropdown(popup);
          const chip = popup.querySelector('.aether-agent-chip-label');
          if (chip) chip.textContent = agent.name;
          const input = popup.querySelector('.doc-ask-inline-input');
          if (input) { input.value = ''; input.focus(); }
        }
      });
    })(a, i);
    dropdown.appendChild(row.el);
  });
  _repositionSelectionPopup();
}

function _aetherHideAgentDropdown(popup) {
  const dd = popup.querySelector('.aether-agent-dropdown');
  if (dd) dd.remove();
  _aetherAgentList = [];
  _aetherAgentIdx = 0;
}

function _aetherSelectAgent(popup) {
  const agent = _aetherAgentList[_aetherAgentIdx];
  if (agent) {
    Settings.set('chatAgent', agent.id);
    _aetherHideAgentDropdown(popup);
    const chip = popup.querySelector('.aether-agent-chip-label');
    if (chip) chip.textContent = agent.name;
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
    const data = await apiPost('/api/extract-links', { url: pageUrl });
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
// State variable declared in panel-state.js: _aetherTabAutoAdding

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
      const data = await apiPost('/api/extract-text', { url: currentTab.url });
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
    var ddView = new View('div').className('aether-tab-dropdown');
    ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
    dropdown = ddView.el;
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  _aetherTabIdx = Math.min(_aetherTabIdx, _aetherTabList.length - 1);
  const activeTabId = _aetherTabSwitchMode && typeof _browseActiveTab !== 'undefined' ? _browseActiveTab : null;
  dropdown.innerHTML = '';
  _aetherTabList.forEach(function(tab, i) {
    const domain = (function() { try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; } })();
    const favUrl = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=16';

    var favImg = new View('img').className('aether-tab-item-favicon');
    favImg.el.src = favUrl;
    favImg.el.onerror = function() { this.style.display = 'none'; };

    var tabTitle = new View('div').className('aether-tab-item-title');
    tabTitle.el.textContent = tab.title || 'Untitled';

    var tabUrl = new View('div').className('aether-tab-item-url');
    tabUrl.el.textContent = domain;

    var infoDiv = new View('div').className('aether-tab-item-info');
    infoDiv.el.appendChild(tabTitle.el);
    infoDiv.el.appendChild(tabUrl.el);

    var row = new View('div').className('aether-tab-item' + (i === _aetherTabIdx ? ' selected' : ''));
    row.el.dataset.idx = String(i);
    row.el.appendChild(favImg.el);
    row.el.appendChild(infoDiv.el);

    if (activeTabId != null && tab.id === activeTabId) {
      var curSpan = new View('span');
      curSpan.cssText('opacity:0.4;font-size:10px;margin-left:auto;flex-shrink:0');
      curSpan.el.textContent = 'current';
      row.el.appendChild(curSpan.el);
    }

    (function(idx) {
      row.el.addEventListener('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        _aetherTabIdx = idx;
        if (_aetherTabSwitchMode) _aetherSwitchToTab(popup);
        else _aetherSelectTab(popup);
      });
    })(i);
    dropdown.appendChild(row.el);
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
    const data = await apiPost('/api/extract-text', { url: tab.url });
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

  var panelView = new View('div').id('aether-help-panel').className('aether-help-preview-panel');
  panelView.on('mousedown', (ev) => ev.stopPropagation());
  const panel = panelView.build();

  // Title bar (reuse note editor styles)
  var titleBarView = new View('div').className('aether-note-editor-title-bar');
  const titleBar = titleBarView.build();

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

  var titleSpanView = new View('span').className('aether-note-editor-title')._bindText('Help');
  titleBar.appendChild(titleSpanView.build());

  var closeBtnView = new View('button').className('aether-note-editor-close').attr('title', 'Close');
  closeBtnView.el.textContent = '\u00d7';
  closeBtnView.onTap((ev) => { ev.stopPropagation(); panel.remove(); document.removeEventListener('mousemove', hMove); document.removeEventListener('mouseup', hUp); });
  titleBar.appendChild(closeBtnView.build());
  panel.appendChild(titleBar);

  // Rendered markdown content
  var contentView = new View('div').className('aether-help-preview-content nb-rendered-md');
  contentView.el.innerHTML = typeof marked !== 'undefined' ? marked.parse(helpMd) : helpMd.replace(/\n/g, '<br>');
  panel.appendChild(contentView.build());

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
      else if (cmd.name === 'agent') _doAetherAgent(popup);
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
    const result = await apiGet('/api/arxiv-search?q=' + encodeURIComponent(query) + '&max_results=8');
    const parser = new DOMParser();
    const doc = parser.parseFromString(result.xml, 'text/xml');
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
    const users = await apiGet('/api/users?q=' + encodeURIComponent(query));

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
