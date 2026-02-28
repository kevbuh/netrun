// panel-commands.js — Aether slash commands and preview system
import Settings from '/js/core/core-settings.js';
import { apiPost, apiGet } from '/js/api.js';
import { escapeHtml, truncate } from '/js/core/core-utils.js';
import { showAchievement } from '/js/core/core-ui.js';
import { _openInNewTab } from '/js/core/core-layout.js';
import { _addScreenshotToPanel, _addTabContextToPanel, _browserCaptureRect, _renderPopupChat } from '/js/panel-chat.js';
import { browseNavigate } from '/js/toolbar/toolbar-url.js';
import { _browseFaviconUrl, browseBack, browseForward, browseReload, browseZoom } from '/js/toolbar/toolbar-nav.js';
import { _browseToggleFindBar, browseSaveToReadingList, browseShare } from '/js/browse/browse-features.js';
import { _getBrowseHistory, openSearchHistoryPage } from '/js/browse-urlbar.js';
import { _relativeTime } from '/js/search.js';
import { _repositionSelectionPopup } from '/js/panel.js';
import { browseCloseTab, browseSelectTab } from '/js/browse/browse-passwords.js';
import { browseNewTab, browseSelectWindow, openBrowse, openLocalPdf } from '/js/browse/browse-windows.js';
import { browsePrintPage } from '/js/toolbar/toolbar-menu.js';
import { toggleTabMute } from '/js/browse/browse-audio.js';
import { logger } from '/js/logger.js';
import { openSettings } from '/js/settings/settings-core.js';

export function _aetherHideCursorOverlay() {
  document.body.classList.add('aether-hide-cursor');
}
export function _aetherShowCursor() {
  document.body.classList.remove('aether-hide-cursor');
  // Force browser to recalculate cursor via synthetic mouse move (Electron only)
  if (window.electronAPI?.nudgeCursor) window.electronAPI.nudgeCursor();
}

export function _aetherRestoreFocus() {
  if (!window._aetherPrevFocus) return;
  const { el, selStart, selEnd } = window._aetherPrevFocus;
  window._aetherPrevFocus = null;
  if (!el || !document.body.contains(el)) return;
  el.focus();
  if (selStart != null && typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(selStart, selEnd); } catch (_) {}
  }
}

export function _isAetherEligible(text) {
  if (!text || text.length > 80) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  // Skip if it looks like a sentence (contains sentence-ending punctuation)
  if (/[.!?;]/.test(text)) return false;
  return true;
}

export async function _fetchWikipediaPreview(text, containerDiv) {
  const title = text.trim().replace(/\s+/g, '_');
  try {
    const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (!resp.ok) { containerDiv.style.display = 'none'; return; }
    const data = await resp.json();
    if (data.type === 'disambiguation' || !data.extract) { containerDiv.style.display = 'none'; return; }
    const extract = data.extract.length > 200 ? data.extract.slice(0, 200) + '…' : data.extract;
    const wikiUrl = data.content_urls?.desktop?.page || '#';
    const children = [];
    if (data.thumbnail && data.thumbnail.source) {
      children.push(new window.View('img').className('doc-wiki-thumb').attr('src', data.thumbnail.source).attr('alt', ''));
    }
    const linkView = new window.View('a').className('doc-wiki-link').attr('href', wikiUrl).text('Wikipedia →');
    linkView.on('mousedown', (ev) => ev.stopPropagation());
    linkView.onTap((ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (typeof _openInNewTab === 'function') _openInNewTab(wikiUrl);
      else window.open(wikiUrl, '_blank');
      document.getElementById('doc-chat-ask-float')?.remove();
    });
    children.push(window.VStack(
      window.Text(data.title).className('doc-wiki-title'),
      window.Text(extract).className('doc-wiki-extract'),
      linkView,
    ));
    AetherUI.mount(window.HStack(...children).className('doc-wiki-result'), containerDiv);
    containerDiv.style.display = '';
    _repositionSelectionPopup();
  } catch (e) {
    containerDiv.style.display = 'none';
  }
}

export function _isAuthorEligible(text) {
  if (!text || text.length > 50) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  // All words should start with uppercase (name pattern)
  if (!words.every(w => /^[A-Z\u00C0-\u024F]/.test(w))) return false;
  // No digits, no sentence punctuation
  if (/[\d.!?;:,]/.test(text)) return false;
  return true;
}

export function _findKnownAuthor(text) {
  // Check if this author name matches one already loaded in the sidebar Authors tab
  if (!window._insightAuthors?.length) return null;
  const q = text.trim().toLowerCase();
  return window._insightAuthors.find(a => a.name && a.name.toLowerCase() === q) || null;
}

export function _renderAuthorPreviewHtml(data, containerDiv) {
  const children = [];
  children.push(window.Text(data.name).className('doc-author-name'));
  const affil = data.affiliations?.length ? data.affiliations[0] : data.affiliation;
  if (affil) {
    children.push(window.Text(affil).className('doc-author-affil'));
  }
  const stats = [];
  if (data.hIndex) stats.push(window.Text('h-index: ' + data.hIndex));
  if (data.paperCount) stats.push(window.Text(fmtNum(data.paperCount) + ' papers'));
  if (data.citationCount) stats.push(window.Text(fmtNum(data.citationCount) + ' citations'));
  if (stats.length) children.push(window.HStack(...stats).className('doc-author-stats'));
  if (data.topPapers?.length) {
    const papers = data.topPapers.map(p => {
      let label = p.title;
      if (p.year) label += ' (' + p.year + ')';
      if (p.citationCount) label += ' \u00b7 ' + fmtNum(p.citationCount);
      return window.Text(label).className('doc-author-paper');
    });
    children.push(window.VStack(...papers).className('doc-author-papers'));
  }

  const footerLinks = [];
  const authorId = data.authorId;
  if (authorId) {
    const profileLink = new window.View('a').className('doc-ref-link')
      .attr('href', '#author/' + encodeURIComponent(authorId)).text('Profile \u2192');
    profileLink.on('mousedown', (ev) => ev.stopPropagation());
    profileLink.onTap((ev) => {
      ev.stopPropagation();
      document.getElementById('doc-chat-ask-float')?.remove();
    });
    footerLinks.push(profileLink);
  }
  if (data.url) {
    const extLink = new window.View('a').className('doc-ref-link')
      .attr('href', data.url).text('Semantic Scholar \u2192');
    extLink.on('mousedown', (ev) => ev.stopPropagation());
    extLink.onTap((ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (typeof _openInNewTab === 'function') _openInNewTab(data.url);
      else window.open(data.url, '_blank');
      document.getElementById('doc-chat-ask-float')?.remove();
    });
    footerLinks.push(extLink);
  }
  if (footerLinks.length) children.push(window.HStack(...footerLinks).className('doc-ref-footer'));

  AetherUI.mount(window.VStack(...children).className('doc-author-result'), containerDiv);
  containerDiv.style.display = '';
  _repositionSelectionPopup();
}

export async function _fetchAuthorPreview(text, containerDiv) {
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

export async function _doAetherWebSearch(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';

  // Pin panel if tracking
  window._aetherTrackMode = false;

  // Show searching state in chat area
  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  window._popupChatMessages.push({ role: 'user', content: q, _display: q, _isSearch: true });
  window._popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isSearch: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const data = await apiGet('/api/web-search?q=' + encodeURIComponent(q));
    const results = data.results || [];
    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    window._popupChatMessages[aiIdx]._searchResults = results;
    window._popupChatMessages[aiIdx].content = results.length
      ? results.length + ' result' + (results.length !== 1 ? 's' : '')
      : 'No results found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    window._popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

export const _aetherCommands = [
  { name: 'bookmark', desc: 'Save page to reading list', fn: () => { if (typeof browseSaveToReadingList === 'function') browseSaveToReadingList(); } },
  { name: 'close', desc: 'Close current tab', fn: () => { if (typeof browseCloseTab === 'function' && typeof _browseActiveTab !== 'undefined') browseCloseTab(_browseActiveTab); } },
  { name: 'reload', desc: 'Reload current page', fn: () => { if (typeof browseReload === 'function') browseReload(); } },
  { name: 'back', desc: 'Go back', fn: () => { if (typeof browseBack === 'function') browseBack(); } },
  { name: 'forward', desc: 'Go forward', fn: () => { if (typeof browseForward === 'function') browseForward(); } },
  { name: 'newtab', desc: 'Open a new tab', fn: () => { if (typeof browseNewTab === 'function') browseNewTab(); } },
  { name: 'copy', desc: 'Copy page URL', fn: () => { const t = typeof _browseTabs !== 'undefined' && _browseTabs.find(t => t.id === _browseActiveTab); if (t) navigator.clipboard.writeText(t.url).then(() => { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(() => {}); } },
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
  { name: 'settings', desc: 'Open settings', hasArgs: true, fn: () => { openSettings(); } },
  { name: 'upload', desc: 'Open a local file', fn: () => { const fi = document.getElementById('browse-pdf-file-input'); if (fi) { fi.click(); return; } const tmpView = new window.View('input').attr('type', 'file').styles({ display: 'none' }); tmpView.el.onchange = function() { if (tmpView.el.files[0] && typeof openLocalPdf === 'function') openLocalPdf(tmpView.el.files[0]); tmpView.el.remove(); }; AetherUI.append(tmpView, document.body); tmpView.el.click(); } },
  { name: 'history', desc: 'Browse visited sites', _special: true },
  { name: 'help', desc: 'Show all commands & features', _special: true },
];

// State variables declared in panel-state.js:
// window._aetherCmdIdx, window._aetherTabIdx, window._aetherTabList, window._aetherTabSwitchMode

export function _aetherFilterCommands(query) {
  const q = query.toLowerCase();
  return _aetherCommands.filter(c => c.name.startsWith(q) || c.desc.toLowerCase().includes(q));
}

export function _aetherRenderCmdDropdown(popup, query) {
  let dropdown = popup.querySelector('.aether-cmd-dropdown');
  const matches = _aetherFilterCommands(query);
  if (!matches.length) {
    if (dropdown) dropdown.remove();
    return;
  }
  if (!dropdown) {
    const ddView = new window.View('div').className('aether-cmd-dropdown');
    ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
    dropdown = ddView.el;
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.append(dropdown);
  }
  window._aetherCmdIdx = Math.min(window._aetherCmdIdx, matches.length - 1);
  const rows = matches.map(function(c, i) {
    const nameSpan = window.Text('/' + c.name).className('aether-cmd-name');
    const descSpan = window.Text(c.desc).className('aether-cmd-desc');
    const row = new window.View('div').className('aether-cmd-item' + (i === window._aetherCmdIdx ? ' selected' : ''))
      .attr('data-idx', String(i))
      .add(nameSpan, descSpan);
    // Click to execute or fill
    (function(cmd) {
      row.on('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (!cmd) return;
        if (cmd.hasArgs) {
          const askInput = popup.querySelector('.doc-ask-inline-input') || popup.querySelector('.doc-ask-inline');
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
          window._aetherTrackMode = false;
          popup.remove();
        }
      });
    })(c);
    return row;
  });
  AetherUI.mount(window.VStack(rows), dropdown);
  _repositionSelectionPopup();
}

export function _aetherHideCmdDropdown(popup) {
  const dropdown = popup.querySelector('.aether-cmd-dropdown');
  if (dropdown) dropdown.remove();
}

export function _aetherHideTabDropdown(popup) {
  const dropdown = popup.querySelector('.aether-tab-dropdown');
  if (dropdown) dropdown.remove();
  window._aetherTabList = [];
  window._aetherTabIdx = 0;
  window._aetherTabSwitchMode = false;
}

// State variables declared in panel-state.js: window._aetherHistoryIdx, window._aetherHistoryList

export function _aetherHideHistoryDropdown(popup) {
  const dropdown = popup.querySelector('.aether-history-dropdown');
  if (dropdown) dropdown.remove();
  window._aetherHistoryList = [];
  window._aetherHistoryIdx = -1;
}

export function _doAetherHistory(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = '/history '; input.style.height = 'auto'; }
  _aetherHideCmdDropdown(popup);
  window._aetherTrackMode = false;
  window._aetherHistoryIdx = -1;
  _aetherRenderHistoryDropdown(popup, '');
}

export function _aetherRenderHistoryDropdown(popup, query) {
  const hist = typeof _getBrowseHistory === 'function' ? _getBrowseHistory() : [];
  const q = (query || '').toLowerCase();
  window._aetherHistoryList = q
    ? hist.filter(h => (h.title || '').toLowerCase().includes(q) || (h.url || '').toLowerCase().includes(q)).slice(0, 15)
    : hist.slice(0, 15);

  let dropdown = popup.querySelector('.aether-history-dropdown');

  if (!window._aetherHistoryList.length) {
    if (!dropdown) {
      var ddView = new window.View('div').className('aether-history-dropdown aether-note-dropdown');
      ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
      dropdown = ddView.el;
      const askWrap = popup.querySelector('.doc-ask-inline-wrap');
      if (askWrap) popup.insertBefore(dropdown, askWrap);
      else popup.append(dropdown);
    }
    const emptyMsg = window.Text('No history found')
      .cssText('padding:10px 12px;font-size:0.8rem;color:var(--nr-text-secondary);text-align:center');
    AetherUI.mount(emptyMsg, dropdown);
    _repositionSelectionPopup();
    return;
  }

  if (!dropdown) {
    var ddView = new window.View('div').className('aether-history-dropdown aether-note-dropdown');
    ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
    dropdown = ddView.el;
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.append(dropdown);
  }
  if (window._aetherHistoryIdx >= window._aetherHistoryList.length) window._aetherHistoryIdx = window._aetherHistoryList.length - 1;

  const fullSelected = window._aetherHistoryIdx === -1;
  const fullRow = window.Text('See full history').className('aether-note-item aether-history-full' + (fullSelected ? ' selected' : ''))
    .attr('data-idx', '-1')
    .cssText('padding:6px 10px;font-size:0.75rem;border-bottom:none')
    .on('click', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      _aetherHideHistoryDropdown(popup);
      popup.remove();
      window._aetherTrackMode = false;
      if (typeof openSearchHistoryPage === 'function') openSearchHistoryPage();
    });

  const historyRows = window._aetherHistoryList.map(function(h, i) {
    let domain = '';
    try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
    const favicon = typeof _browseFaviconUrl === 'function' ? _browseFaviconUrl(h.url) : '';
    const time = typeof _relativeTime === 'function' ? _relativeTime(h.ts) : '';

    const favImg = new window.View('img').attr('src', favicon)
      .cssText('width:14px;height:14px;flex-shrink:0;border-radius:2px')
      .on('error', function() { this.style.display = 'none'; });

    const infoDiv = new window.View('div').cssText('flex:1;min-width:0;overflow:hidden').add(
      window.Text(h.title || domain).cssText('font-size:0.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'),
      window.Text(domain).cssText('font-size:0.68rem;color:var(--nr-text-quaternary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')
    );

    const timeSpan = window.Text(time).cssText('font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0');

    const row = new window.View('div').className('aether-note-item' + (i === window._aetherHistoryIdx ? ' selected' : ''))
      .attr('data-idx', String(i))
      .cssText('display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:none')
      .add(favImg, infoDiv, timeSpan);

    (function(entry) {
      row.on('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (!entry) return;
        _aetherHideHistoryDropdown(popup);
        popup.remove();
        window._aetherTrackMode = false;
        if (typeof browseNavigate === 'function') browseNavigate(entry.url);
      });
    })(h);
    return row;
  });

  AetherUI.mount(window.VStack([fullRow].concat(historyRows)), dropdown);
  _repositionSelectionPopup();
}

export function _aetherSelectHistory(popup) {
  if (window._aetherHistoryIdx < 0) {
    // No arrow selection — open full history page
    _aetherHideHistoryDropdown(popup);
    popup.remove();
    window._aetherTrackMode = false;
    if (typeof openSearchHistoryPage === 'function') openSearchHistoryPage();
    return true;
  }
  const entry = window._aetherHistoryList[window._aetherHistoryIdx];
  if (!entry) return false;
  _aetherHideHistoryDropdown(popup);
  popup.remove();
  window._aetherTrackMode = false;
  if (typeof browseNavigate === 'function') browseNavigate(entry.url);
  return true;
}

export async function _doAetherCapture(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = ''; }
  _aetherHideCmdDropdown(popup);
  window._aetherTrackMode = false;

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
      logger.error('Screenshot capture failed:', e);
    }
  } else if (typeof html2canvas !== 'undefined') {
    try {
      screenshot = await _browserCaptureRect(captureRect);
    } catch (e) {
      logger.error('Browser screenshot capture failed:', e);
    }
  }

  // Show the popup again
  popup.style.visibility = '';

  if (!screenshot) {
    window._popupChatMessages.push({ role: 'assistant', content: 'Screenshot capture failed. Make sure html2canvas is loaded.', _thinking: false });
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
// State variables declared in panel-state.js: window._aetherModelIdx, window._aetherModelList

export async function _doAetherModel(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  window._aetherTrackMode = false;

  // Fetch available models
  window._aetherModelList = [];
  window._aetherModelIdx = 0;
  try {
    const data = await apiGet('/api/models');
    window._aetherModelList = data.models || [];
  } catch (e) {
    window._aetherModelList = [];
  }

  if (!window._aetherModelList.length) {
    // Show error inline
    if (input) { input.value = ''; input.placeholder = 'No models available'; input.focus(); }
    return;
  }

  const currentModel = Settings.get('chatModel') || '';
  // Pre-select current model if found
  const curIdx = window._aetherModelList.indexOf(currentModel);
  if (curIdx >= 0) window._aetherModelIdx = curIdx;

  _aetherRenderModelDropdown(popup);
}

export function _aetherRenderModelDropdown(popup) {
  let dropdown = popup.querySelector('.aether-model-dropdown');
  if (!dropdown) {
    const ddView = new window.View('div').className('aether-note-dropdown aether-model-dropdown');
    ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
    dropdown = ddView.el;
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.append(dropdown);
  }
  const currentModel = Settings.get('chatModel') || '';
  const modelRows = window._aetherModelList.map(function(m, i) {
    const active = m === currentModel;
    const row = new window.View('div').className('aether-note-item' + (i === window._aetherModelIdx ? ' selected' : ''))
      .attr('data-idx', String(i))
      .add(window.Text(m).className('aether-note-item-title'));

    if (active) {
      row.add(window.Text('current').className('aether-note-item-tags'));
    }

    (function(model, idx) {
      row.on('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (model) {
          window._aetherModelIdx = idx;
          Settings.set('chatModel', model);
          _aetherHideModelDropdown(popup);
          const label = popup.querySelector('.aether-model-label');
          if (label) label.textContent = model;
          const input = popup.querySelector('.doc-ask-inline-input');
          if (input) { input.value = ''; input.placeholder = 'Ask anything…'; input.focus(); }
          if (!Settings.get('ach_model_switch')) {
            Settings.set('ach_model_switch', '1');
            if (typeof showAchievement === 'function') showAchievement('Model Swapper', 'Switched your AI model for the first time');
          }
        }
      });
    })(m, i);
    return row;
  });
  AetherUI.mount(window.VStack(modelRows), dropdown);
  _repositionSelectionPopup();
}

export function _aetherHideModelDropdown(popup) {
  const dd = popup.querySelector('.aether-model-dropdown');
  if (dd) dd.remove();
  window._aetherModelList = [];
  window._aetherModelIdx = 0;
}

export function _aetherSelectModel(popup) {
  const model = window._aetherModelList[window._aetherModelIdx];
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
// State variables declared in panel-state.js: window._aetherAgentIdx, window._aetherAgentList

export async function _doAetherAgent(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  window._aetherTrackMode = false;

  // Fetch available agents
  window._aetherAgentList = [];
  window._aetherAgentIdx = 0;
  try {
    if (window.electronAPI?.agentList) {
      window._aetherAgentList = await window.electronAPI.agentList();
    }
  } catch (e) {
    window._aetherAgentList = [];
  }

  if (!window._aetherAgentList.length) {
    if (input) { input.value = ''; input.placeholder = 'No agents available'; input.focus(); }
    return;
  }

  const currentAgent = Settings.get('chatAgent') || 'research-assistant';
  const curIdx = window._aetherAgentList.findIndex(a => a.id === currentAgent);
  if (curIdx >= 0) window._aetherAgentIdx = curIdx;

  _aetherRenderAgentDropdown(popup);
}

export function _aetherRenderAgentDropdown(popup) {
  let dropdown = popup.querySelector('.aether-agent-dropdown');
  if (!dropdown) {
    const ddView = new window.View('div').className('aether-note-dropdown aether-agent-dropdown');
    ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
    dropdown = ddView.el;
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.append(dropdown);
  }
  const currentAgent = Settings.get('chatAgent') || 'research-assistant';
  const agentRows = window._aetherAgentList.map(function(a, i) {
    const active = a.id === currentAgent;
    const row = new window.View('div').className('aether-note-item' + (i === window._aetherAgentIdx ? ' selected' : ''))
      .attr('data-idx', String(i))
      .add(
        window.Text(a.name).className('aether-note-item-title'),
        window.Text(a.description).className('aether-note-item-snippet')
      );

    if (active) {
      row.add(window.Text('current').className('aether-note-item-tags'));
    }

    (function(agent, idx) {
      row.on('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (agent) {
          window._aetherAgentIdx = idx;
          Settings.set('chatAgent', agent.id);
          _aetherHideAgentDropdown(popup);
          const chip = popup.querySelector('.aether-agent-chip-label');
          if (chip) chip.textContent = agent.name;
          const input = popup.querySelector('.doc-ask-inline-input');
          if (input) { input.value = ''; input.placeholder = 'Ask anything…'; input.focus(); }
        }
      });
    })(a, i);
    return row;
  });
  AetherUI.mount(window.VStack(agentRows), dropdown);
  _repositionSelectionPopup();
}

export function _aetherHideAgentDropdown(popup) {
  const dd = popup.querySelector('.aether-agent-dropdown');
  if (dd) dd.remove();
  window._aetherAgentList = [];
  window._aetherAgentIdx = 0;
}

export function _aetherSelectAgent(popup) {
  const agent = window._aetherAgentList[window._aetherAgentIdx];
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
export function _doAetherSearchNewTab(popup, query) {
  const url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
  if (typeof browseNewTab === 'function') browseNewTab(url);
  else window.open(url, '_blank');
  window._aetherTrackMode = false;
  popup.remove();
}

// ── /links command — list all links on current page ──
export async function _doAetherLinks(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  window._aetherTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  window._popupChatMessages.push({ role: 'user', content: 'Links on this page', _display: 'Links on this page', _isSearch: true });
  window._popupChatMessages.push({ role: 'assistant', content: '', _thinking: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  // Get current page URL
  let pageUrl = '';
  const tab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
    ? _browseTabs.find(t => t.id === _browseActiveTab)
    : null;
  if (tab && tab.url) pageUrl = tab.url;

  if (!pageUrl) {
    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    window._popupChatMessages[aiIdx].content = 'No page open to extract links from.';
    _renderPopupChat(popup, true);
    if (input) input.focus();
    return;
  }

  try {
    const data = await apiPost('/api/extract-links', { url: pageUrl });
    const links = data.links || [];
    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    if (links.length) {
      window._popupChatMessages[aiIdx]._searchResults = links.map(l => ({ title: l.text, url: l.url, snippet: '' }));
      window._popupChatMessages[aiIdx].content = links.length + ' link' + (links.length !== 1 ? 's' : '') + ' found';
    } else {
      window._popupChatMessages[aiIdx].content = 'No links found on this page.';
    }
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    window._popupChatMessages[aiIdx].content = 'Failed to extract links: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

// ── /tab command — add a browser tab to chat context ──
// State variable declared in panel-state.js: window._aetherTabAutoAdding

export async function _doAetherTab(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  window._aetherTrackMode = false;

  // Get all open tabs from all windows
  const allTabs = [];
  if (typeof window._browseWindows !== 'undefined') {
    for (const win of window._browseWindows) {
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
  if (currentTab && !window._pendingTabContexts.some(t => t.tabId === currentTab.id)) {
    window._aetherTabAutoAdding = true;
    try {
      const data = await apiPost('/api/extract-text', { url: currentTab.url });
      _addTabContextToPanel(popup, { tabId: currentTab.id, title: currentTab.title, url: currentTab.url, content: data.text || '' });
    } catch (e) { /* ignore */ }
    window._aetherTabAutoAdding = false;
  }

  // Show remaining tabs (excluding already-added ones) in a dropdown
  const addedIds = new Set(window._pendingTabContexts.map(t => t.tabId));
  const otherTabs = allTabs.filter(t => !addedIds.has(t.id));
  if (!otherTabs.length) {
    if (input) input.focus();
    return;
  }

  window._aetherTabList = otherTabs;
  window._aetherTabIdx = 0;
  _renderTabDropdown(popup);
  if (input) input.focus();
}

export function _renderTabDropdown(popup) {
  let dropdown = popup.querySelector('.aether-tab-dropdown');
  if (!window._aetherTabList.length) {
    if (dropdown) dropdown.remove();
    return;
  }
  if (!dropdown) {
    const ddView = new window.View('div').className('aether-tab-dropdown');
    ddView.on('mousedown', function(ev) { ev.stopPropagation(); });
    dropdown = ddView.el;
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.append(dropdown);
  }
  window._aetherTabIdx = Math.min(window._aetherTabIdx, window._aetherTabList.length - 1);
  const activeTabId = window._aetherTabSwitchMode && typeof _browseActiveTab !== 'undefined' ? _browseActiveTab : null;
  const tabRows = window._aetherTabList.map(function(tab, i) {
    const domain = (function() { try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; } })();
    const favUrl = '/api/favicon?domain=' + encodeURIComponent(domain);

    const favImg = new window.View('img').className('aether-tab-item-favicon')
      .attr('src', favUrl)
      .on('error', function() { this.style.display = 'none'; });

    const infoDiv = new window.View('div').className('aether-tab-item-info').add(
      window.Text(tab.title || 'Untitled').className('aether-tab-item-title'),
      window.Text(domain).className('aether-tab-item-url')
    );

    const row = new window.View('div').className('aether-tab-item' + (i === window._aetherTabIdx ? ' selected' : ''))
      .attr('data-idx', String(i))
      .add(favImg, infoDiv);

    if (activeTabId != null && tab.id === activeTabId) {
      row.add(window.Text('current').cssText('opacity:0.4;font-size:10px;margin-left:auto;flex-shrink:0'));
    }

    (function(idx) {
      row.on('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        window._aetherTabIdx = idx;
        if (window._aetherTabSwitchMode) _aetherSwitchToTab(popup);
        else _aetherSelectTab(popup);
      });
    })(i);
    return row;
  });
  AetherUI.mount(window.VStack(tabRows), dropdown);
  _repositionSelectionPopup();
}

export async function _aetherSelectTab(popup) {
  const tab = window._aetherTabList[window._aetherTabIdx];
  if (!tab) return;

  const dropdown = popup.querySelector('.aether-tab-dropdown');
  const items = dropdown ? dropdown.querySelectorAll('.aether-tab-item') : [];
  const el = items[window._aetherTabIdx];
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
export function _doAetherTabs(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  window._aetherTrackMode = false;

  const allTabs = [];
  if (typeof window._browseWindows !== 'undefined') {
    for (const win of window._browseWindows) {
      for (const tab of (win.tabs || [])) {
        if (!tab.blank && tab.url) allTabs.push(tab);
      }
    }
  }

  if (!allTabs.length) {
    if (input) input.focus();
    return;
  }

  window._aetherTabSwitchMode = true;
  window._aetherTabList = allTabs;
  window._aetherTabIdx = 0;

  // Pre-select the currently active tab
  const activeTabId = typeof _browseActiveTab !== 'undefined' ? _browseActiveTab : null;
  if (activeTabId != null) {
    const idx = allTabs.findIndex(t => t.id === activeTabId);
    if (idx >= 0) window._aetherTabIdx = idx;
  }

  _renderTabDropdown(popup);
  if (input) input.focus();
}

export function _aetherSwitchToTab(popup) {
  const tab = window._aetherTabList[window._aetherTabIdx];
  if (!tab) return;
  _aetherHideTabDropdown(popup);
  window._aetherTrackMode = false;
  popup.remove();

  // Find which window owns this tab and switch if needed
  if (typeof window._browseWindows !== 'undefined') {
    for (const win of window._browseWindows) {
      if (win.tabs.some(t => t.id === tab.id)) {
        if (win.id !== window._browseActiveWindow && typeof browseSelectWindow === 'function') {
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
export function _doAetherHelp(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  window._aetherTrackMode = false;

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

  const panelView = new window.View('div').id('aether-help-panel').className('aether-help-preview-panel')
    .on('mousedown', (ev) => ev.stopPropagation());
  const panel = panelView.el;

  // Title bar (reuse note editor styles)
  const titleBarView = new window.View('div').className('aether-note-editor-title-bar');
  const titleBar = titleBarView.el;

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

  const titleSpanView = window.Text('Help').className('aether-note-editor-title');

  const closeBtnView = new window.View('button').className('aether-note-editor-close').attr('title', 'Close')
    .text('\u00d7')
    .onTap((ev) => { ev.stopPropagation(); panel.remove(); document.removeEventListener('mousemove', hMove); document.removeEventListener('mouseup', hUp); });

  titleBarView.add(titleSpanView, closeBtnView);

  // Rendered markdown content
  const contentView = window.RawHTML(typeof marked !== 'undefined' ? marked.parse(helpMd) : helpMd.replace(/\n/g, '<br>'))
    .className('aether-help-preview-content nb-rendered-md');

  panelView.add(titleBarView, contentView);
  AetherUI.append(panelView, document.body);

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
export async function _doAetherDefine(popup, word) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _aetherHideCmdDropdown(popup);
  window._aetherTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  window._popupChatMessages.push({ role: 'user', content: word, _display: 'Define: ' + word });
  window._popupChatMessages.push({ role: 'assistant', content: '', _thinking: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const resp = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.trim()));
    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    if (!resp.ok) {
      window._popupChatMessages[aiIdx].content = 'No definition found for "' + word.trim() + '".';
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
    window._popupChatMessages[aiIdx].content = md.trim() || 'No definitions available.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    window._popupChatMessages[aiIdx].content = 'Failed to look up definition: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

export function _aetherExecCommand(popup, text) {
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
      if (cmdName === 'settings') { openSettings(args); window._aetherTrackMode = false; popup.remove(); return true; }
    }
    if (cmd && cmd.fn) { cmd.fn(); window._aetherTrackMode = false; popup.remove(); return true; }
  }
  const query = raw.toLowerCase();
  const matches = _aetherFilterCommands(query);
  const cmd = matches[window._aetherCmdIdx] || matches[0];
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
    window._aetherTrackMode = false;
    popup.remove();
    return true;
  }
  return false;
}

// Paper search from aether panel (/paper query)
export async function _doAetherPaperSearch(popup, query) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';

  window._aetherTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  window._popupChatMessages.push({ role: 'user', content: query, _display: query, _isPaperSearch: true });
  window._popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isPaperSearch: true });
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

    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    window._popupChatMessages[aiIdx]._paperResults = papers;
    window._popupChatMessages[aiIdx].content = papers.length
      ? papers.length + ' paper' + (papers.length !== 1 ? 's' : '') + ' found'
      : 'No papers found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    window._popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

export async function _doAetherUserSearch(popup, query) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  _aetherHideCmdDropdown(popup);
  window._aetherTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  window._popupChatMessages.push({ role: 'user', content: query, _display: query, _isUserSearch: true });
  window._popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isUserSearch: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const users = await apiGet('/api/users?q=' + encodeURIComponent(query));

    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    window._popupChatMessages[aiIdx]._userResults = users;
    window._popupChatMessages[aiIdx].content = users.length
      ? users.length + ' user' + (users.length !== 1 ? 's' : '') + ' found'
      : 'No users found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = window._popupChatMessages.length - 1;
    window._popupChatMessages[aiIdx]._thinking = false;
    window._popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

