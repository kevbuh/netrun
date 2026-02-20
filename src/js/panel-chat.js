// panel-chat.js — Chat system, context attachments, and screenshots
// Model context sizes are defined in src/core/agents/context.ts
import Settings from '/js/core/core-settings.js';
import { apiPost } from '/js/api.js';
import { formatDate, escapeHtml, stripHtml, truncate, _normalizeRatingKey, getPaperRatings, getPaperRating, renderTitle, renderStarRating, escapeAttr } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { islandUpdate, islandRemove } from '/js/core/core-ui.js';
import { _clearAudioUnified, _updateAudioUnified } from '/js/core/core-audio.js';
import ChatEngine from '/js/chat-engine.js';
import ChatRender from '/js/chat-render.js';
import { _aetherShowCursor } from '/js/panel-commands.js';
import { _browseCloseOtherTabs, browseAddTabToGroup, browseAddTabToNewGroup, browseNavigate, browseReload, browseRemoveTabFromGroup, browseTogglePin } from '/js/browse/browse-island.js';
import { _currentPaperViewPaper } from '/js/views.js';
import { _docText } from '/js/chat-threads.js';
import { _repositionSelectionPopup, _showPanel } from '/js/panel.js';
import { _ttsStartWaveform, _ttsStopAll, _ttsStopWaveform } from '/js/panel-tts.js';
import { agentBack, agentClick, agentForward, agentGetAccessibleDOM, agentGetSemanticDOM, agentGetStorage, agentGetTabs, agentGetUrl, agentPressKey, agentQuerySelector, agentScroll, agentSwitchTab, agentType, agentWaitFor } from '/js/browse/browse-agent.js';
import { browseCloseTab, browseSelectTab } from '/js/browse/browse-passwords.js';
import { browseNewTab } from '/js/browse/browse-windows.js';
import { browseSplitTab } from '/js/browse/browse-split-panes.js';
import { toggleSavePost } from '/js/feed.js';
import { toggleTabMute } from '/js/browse/browse-audio.js';
import { logger } from '/js/logger.js';

export function _saveChatMemory() {
  if (window._popupChatMessages.length < 2) return;
  // Skip search-only interactions (all user messages start with web search prefix)
  const userMsgs = window._popupChatMessages.filter(m => m.role === 'user');
  if (!userMsgs.length) return;
  const msgs = window._popupChatMessages.filter(m => !m._thinking).map(m => ({ role: m.role, content: m.content || '' }));
  const paper = typeof _currentPaperViewPaper !== 'undefined' ? _currentPaperViewPaper : null;
  const browseTab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
    ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
  const pageUrl = (paper && paper.link) || (browseTab && browseTab.url) || '';
  const pageTitle = (paper && paper.title) || (browseTab && browseTab.title) || '';
  apiPost('/api/chat-memory', { messages: msgs, pageUrl, pageTitle }).catch(e => logger.warn('[chat] Memory save failed:', e));
  // Capture conversation summary into living context
  if (msgs.length >= 4 && typeof contextIngest === 'function') {
    const summary = userMsgs.map(function(m) { return (m.content || '').slice(0, 80); }).join('; ').slice(0, 200);
    contextIngest('chat', '## Chat Insights',
      '- ' + (pageTitle || 'Chat') + ': ' + summary,
      { dedupeKey: 'chat-' + pageUrl });
  }
}

/** Handle a single agent event from IPC streaming */
export function _handleAgentEvent(agentEvent, aiIdx, aiText, _inThinkTag, setAiText, setInThinkTag) {
  if (!window._popupChatMessages[aiIdx]) return; // guard: message was cleared
  const labels = { 'web-search': 'Searching web…', 'paper-search': 'Searching papers…', 'extract-text': 'Fetching page…', 'save-to-reading-list': 'Bookmarking…', navigate: 'Navigating…', 'create-calendar-event': 'Adding to calendar…', 'open-tab': 'Opening tab…', 'browser-read-page': 'Reading page…', 'browser-click': 'Clicking…', 'browser-type': 'Typing…', 'browser-scroll': 'Scrolling…', 'browser-navigate': 'Navigating…', 'browser-screenshot': 'Taking screenshot…', 'browser-query-selector': 'Querying page…', 'browser-wait-for': 'Waiting for element…', 'browser-get-url': 'Getting URL…', 'browser-get-tabs': 'Listing tabs…', 'browser-switch-tab': 'Switching tab…', 'browser-back': 'Going back…', 'browser-forward': 'Going forward…', 'browser-press-key': 'Pressing key…', 'browser-get-storage': 'Reading storage…' };

  if (agentEvent.type === 'thinking') {
    if (!window._popupChatMessages[aiIdx]._thinkingText) window._popupChatMessages[aiIdx]._thinkingText = '';
    window._popupChatMessages[aiIdx]._thinkingText += (agentEvent.content || agentEvent.text || agentEvent.token || '');
    window._popupChatMessages[aiIdx]._thinking = true;
    window._popupChatMessages[aiIdx]._thinkingLabel = 'Thinking…';
    _renderPopupChatLive(false);
  } else if (agentEvent.type === 'token') {
    const token = agentEvent.content || agentEvent.text || agentEvent.token || '';
    let _visibleToken = token;
    // Handle <think> tags in token stream
    if (_inThinkTag) {
      const endIdx = _visibleToken.indexOf('</think>');
      if (endIdx !== -1) {
        if (!window._popupChatMessages[aiIdx]._thinkingText) window._popupChatMessages[aiIdx]._thinkingText = '';
        window._popupChatMessages[aiIdx]._thinkingText += _visibleToken.slice(0, endIdx);
        _visibleToken = _visibleToken.slice(endIdx + 8);
        setInThinkTag(false);
      } else {
        if (!window._popupChatMessages[aiIdx]._thinkingText) window._popupChatMessages[aiIdx]._thinkingText = '';
        window._popupChatMessages[aiIdx]._thinkingText += _visibleToken;
        window._popupChatMessages[aiIdx]._thinking = true;
        window._popupChatMessages[aiIdx]._thinkingLabel = 'Thinking…';
        _renderPopupChatLive(false);
        return;
      }
    }
    if (!_inThinkTag && _visibleToken.includes('<think>')) {
      const startIdx = _visibleToken.indexOf('<think>');
      const before = _visibleToken.slice(0, startIdx);
      const after = _visibleToken.slice(startIdx + 7);
      setInThinkTag(true);
      const endIdx2 = after.indexOf('</think>');
      if (endIdx2 !== -1) {
        if (!window._popupChatMessages[aiIdx]._thinkingText) window._popupChatMessages[aiIdx]._thinkingText = '';
        window._popupChatMessages[aiIdx]._thinkingText += after.slice(0, endIdx2);
        _visibleToken = before + after.slice(endIdx2 + 8);
        setInThinkTag(false);
      } else {
        if (!window._popupChatMessages[aiIdx]._thinkingText) window._popupChatMessages[aiIdx]._thinkingText = '';
        window._popupChatMessages[aiIdx]._thinkingText += after;
        _visibleToken = before;
      }
    }
    if (_visibleToken) {
      window._popupChatMessages[aiIdx]._thinking = false;
      setAiText(aiText + _visibleToken);
      window._popupChatMessages[aiIdx].content = aiText + _visibleToken;
      _renderPopupChatLive(false);
    }
  } else if (agentEvent.type === 'tool_result') {
    // After a tool completes, show a confirmation — format rich data for info tools
    let confirmation = null;
    const r = agentEvent.result;
    const data = (typeof r === 'object' && r !== null) ? r : {};
    switch (agentEvent.name) {
      case 'browser-scroll': confirmation = 'Scrolled.'; break;
      case 'browser-click': confirmation = 'Clicked.'; break;
      case 'browser-type': confirmation = 'Typed.'; break;
      case 'browser-navigate': confirmation = 'Navigating…'; break;
      case 'browser-screenshot': confirmation = 'Took screenshot.'; break;
      case 'browser-back': confirmation = data.url ? 'Back → ' + data.url : 'Went back.'; break;
      case 'browser-forward': confirmation = data.url ? 'Forward → ' + data.url : 'Went forward.'; break;
      case 'browser-get-url':
        confirmation = data.url ? '**' + (data.title || 'Untitled') + '**\n' + data.url : 'Got URL.';
        break;
      case 'browser-get-tabs':
        if (data.tabs && data.tabs.length) {
          confirmation = data.tabs.map(function(t) {
            return (t.active ? '→ ' : '  ') + '**' + (t.title || 'Untitled') + '** (tab ' + t.id + ')\n  ' + (t.url || '');
          }).join('\n');
        } else { confirmation = 'No tabs open.'; }
        break;
      case 'browser-switch-tab':
        confirmation = data.url ? 'Switched → **' + (data.title || 'Tab') + '**\n' + data.url : 'Switched tab.';
        break;
      case 'browser-query-selector':
        if (data.elements) {
          confirmation = 'Found ' + (data.count || '?') + ' element(s):\n```\n' + data.elements + '\n```';
        } else { confirmation = data.error || 'No elements found.'; }
        break;
      case 'browser-wait-for':
        if (data.found) {
          confirmation = 'Found: `<' + (data.tag || '?') + '>` ' + (data.text ? '"' + data.text.slice(0, 100) + '"' : '');
        } else { confirmation = data.timeout ? 'Timed out waiting.' : 'Not found.'; }
        break;
      case 'browser-press-key': confirmation = 'Pressed key.'; break;
      case 'browser-get-storage':
        if (data.entries && data.entries.length) {
          confirmation = '**' + (data.type || 'Storage') + '** (' + data.count + ' entries):\n```\n' +
            data.entries.map(function(e) { return e.key + '=' + e.value; }).join('\n') + '\n```';
        } else { confirmation = data.error || 'No entries found.'; }
        break;
      default: break;
    }
    if (confirmation) {
      window._popupChatMessages[aiIdx].content = confirmation;
      window._popupChatMessages[aiIdx]._thinking = false;
      _renderPopupChatLive(false);
    }
  } else if (agentEvent.type === 'tool_call') {
    if (!window._popupChatMessages[aiIdx]._toolsCalled) window._popupChatMessages[aiIdx]._toolsCalled = [];
    const tc = agentEvent;
    const _tcLabel = tc.name + (tc.args ? '(' + Object.values(tc.args).map(v => JSON.stringify(v)).join(', ') + ')' : '()');
    window._popupChatMessages[aiIdx]._toolsCalled.push(_tcLabel);
    setAiText(''); // Reset accumulated text so tool_result can set confirmation
    window._popupChatMessages[aiIdx].content = '';
    window._popupChatMessages[aiIdx]._thinking = true;
    window._popupChatMessages[aiIdx]._thinkingLabel = labels[tc.name] || 'Using tool…';
    _renderPopupChatLive(false);
  } else if (agentEvent.type === 'action') {
    _handleAgentAction(agentEvent.action || agentEvent);
  } else if (agentEvent.type === 'usage') {
    window._popupChatMessages[aiIdx]._usage = agentEvent.usage || agentEvent;
  } else if (agentEvent.type === 'error') {
    window._popupChatMessages[aiIdx].content = aiText || ('Error: ' + (agentEvent.error || 'Unknown error'));
    window._popupChatMessages[aiIdx]._thinking = false;
    _renderPopupChatLive(false);
  }
}

/** Handle an agent action (bookmark, navigate, browser automation, etc.) */
export function _handleAgentAction(act) {
  if (act.type === 'bookmark' && act.url) {
    const paper = { link: act.url, title: act.title || act.url };
    if (typeof toggleSavePost === 'function') {
      const saved = Settings.getJSON('savedPosts', {});
      if (!saved[act.url]) toggleSavePost(paper);
    }
  } else if (act.type === 'navigate' && act.view) {
    const routes = { home: '#', browse: '#browse', saved: '#saved', calendar: '#calendar', settings: '#settings' };
    location.hash = routes[act.view] || '#';
  } else if (act.type === 'open_tab') {
    if (typeof browseNewTab === 'function') {
      location.hash = '#browse';
      if (act.url) setTimeout(() => browseNewTab(act.url), 100);
      else setTimeout(() => browseNewTab(), 100);
    }
  } else if (act.type === 'agent_click') {
    const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
    if (_tab) agentClick(_tab, act.element_id);
  } else if (act.type === 'agent_type') {
    const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
    if (_tab) agentType(_tab, act.element_id, act.text);
  } else if (act.type === 'agent_scroll') {
    const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
    if (_tab) agentScroll(_tab, act.direction);
  } else if (act.type === 'agent_navigate') {
    if (typeof browseNavigate === 'function') {
      location.hash = '#browse';
      setTimeout(() => browseNavigate(act.url), 100);
    }
  } else if (act.type === 'agent_query_selector') {
    const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
    if (_tab && act.requestId) {
      agentQuerySelector(_tab, act.selector, act.max_results).then(result => {
        if (window.electronAPI && window.electronAPI.agentActionResult) {
          window.electronAPI.agentActionResult(act.requestId, result);
        }
      });
    }
  } else if (act.type === 'agent_wait_for') {
    const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
    if (_tab && act.requestId) {
      agentWaitFor(_tab, act.selector, act.timeout_ms).then(result => {
        if (window.electronAPI && window.electronAPI.agentActionResult) {
          window.electronAPI.agentActionResult(act.requestId, result);
        }
      });
    }
  } else if (act.type === 'agent_get_url') {
    const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
    if (_tab && act.requestId) {
      agentGetUrl(_tab).then(result => {
        if (window.electronAPI && window.electronAPI.agentActionResult) {
          window.electronAPI.agentActionResult(act.requestId, result);
        }
      });
    }
  } else if (act.type === 'agent_get_tabs') {
    if (act.requestId && window.electronAPI && window.electronAPI.agentActionResult) {
      const result = agentGetTabs();
      window.electronAPI.agentActionResult(act.requestId, result);
    }
  } else if (act.type === 'agent_switch_tab') {
    if (act.requestId && window.electronAPI && window.electronAPI.agentActionResult) {
      const result = agentSwitchTab(act.tab_id);
      window.electronAPI.agentActionResult(act.requestId, result);
    }
  } else if (act.type === 'agent_back') {
    if (act.requestId && window.electronAPI && window.electronAPI.agentActionResult) {
      const result = agentBack();
      window.electronAPI.agentActionResult(act.requestId, result);
    }
  } else if (act.type === 'agent_forward') {
    if (act.requestId && window.electronAPI && window.electronAPI.agentActionResult) {
      const result = agentForward();
      window.electronAPI.agentActionResult(act.requestId, result);
    }
  } else if (act.type === 'agent_press_key') {
    const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
    if (_tab) agentPressKey(_tab, act.key, act.modifiers, act.element_id);
  } else if (act.type === 'agent_get_storage') {
    const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
    if (_tab && act.requestId) {
      agentGetStorage(_tab, act.storage_type, act.key_filter).then(result => {
        if (window.electronAPI && window.electronAPI.agentActionResult) {
          window.electronAPI.agentActionResult(act.requestId, result);
        }
      });
    }
  }
}

export function _sendPopupChatMessage(popup, capturedText) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q && window._pendingScreenshots.length === 0 && !capturedText) return;
  input.value = '';

  // Pin the panel in place and restore the cursor
  window._aetherTrackMode = false;
  window._aetherPinned = true;
  _aetherShowCursor();

  // Grab pending screenshots and contexts, clear strip
  const images = window._pendingScreenshots.slice();
  window._pendingScreenshots = [];
  const tabContexts = window._pendingTabContexts.slice();
  window._pendingTabContexts = [];
  const fileContexts = window._pendingFileContexts.slice();
  window._pendingFileContexts = [];
  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (strip) { strip.innerHTML = ''; strip.style.display = 'none'; }

  // Show chat area, add has-chat class
  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  input.disabled = true;
  const sendBtn = popup.querySelector('.doc-ask-inline-send');
  if (sendBtn) sendBtn.disabled = true;

  (async () => {
    try {
      // Get or create session
      let session = window._panelSession;
      if (!session) {
        session = await ChatEngine.createSession();
        if (!session) return;
        window._panelSession = session;
        window._panelThreadId = session.threadId;
        // Register update listener for live rendering
        session.onUpdate((type) => {
          window._popupChatMessages = session.messages;
          if (type === 'stream') _renderPopupChatLive(false);
          else if (type === 'done') _renderPopupChatLive(true);
          else if (type === 'message') _renderPopupChatLive(true);
        });
      }

      // Gather page info
      let pageUrl = '', pageTitle = '';
      const paper = typeof _currentPaperViewPaper !== 'undefined' ? _currentPaperViewPaper : null;
      const browseTab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
        ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
      if (paper) {
        pageUrl = paper.link || paper.url || '';
        pageTitle = paper.title || '';
      } else if (browseTab && browseTab.url) {
        pageUrl = browseTab.url;
        pageTitle = browseTab.title || '';
      }

      // Auto-inject semantic DOM from active browse tab for agent tools
      let domTree = null;
      const toolsOn = Settings.get('chatTools') !== 'off';
      if (toolsOn && (typeof agentGetSemanticDOM === 'function' || typeof agentGetAccessibleDOM === 'function')) {
        const _agentTab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
          ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
        if (_agentTab && _agentTab.el) {
          try {
            domTree = typeof agentGetSemanticDOM === 'function'
              ? await agentGetSemanticDOM(_agentTab)
              : await agentGetAccessibleDOM(_agentTab);
            if (domTree && domTree.error) {
              logger.warn('[agent] DOM extraction error:', domTree.error);
              domTree = null;
            }
          } catch (_e) { logger.warn('[agent] DOM extraction failed:', _e); }
        }
      }

      window._popupChatAbort = session.abortController;
      window._chatStreamStart = Date.now();
      window._popupChatMessages = session.messages;
      _renderPopupChatLive(false);
      _repositionSelectionPopup();

      await session.send(q, {
        capturedText,
        images,
        tabContexts,
        fileContexts,
        documentText: _docText || '',
        pageUrl,
        pageTitle,
        domTree: domTree?.elements ? domTree : null,
      });
    } catch (e) {
      if (e.name !== 'AbortError') {
        window._popupChatMessages.push({ role: 'assistant', content: 'Error: ' + e.message });
        _renderPopupChatLive(true);
      }
    }

    window._popupChatAbort = null;
    if (window._aetherBackgroundStreaming) {
      islandUpdate('aether', {
        type: 'ai', label: 'Response ready \u2713',
        detail: 'Response ready \u2713',
        action: function() { _reopenAetherPanel(); }
      });
      setTimeout(function() { if (window._aetherBackgroundStreaming) { window._aetherBackgroundStreaming = false; islandRemove('aether'); } }, 8000);
    } else {
      islandRemove('aether');
    }
    // Re-enable input
    const _p = document.getElementById('doc-chat-ask-float');
    if (_p) {
      const _inp = _p.querySelector('.doc-ask-inline-input');
      const _sb = _p.querySelector('.doc-ask-inline-send');
      if (_inp) { _inp.disabled = false; _inp.focus(); }
      if (_sb) _sb.disabled = false;
    }
    _repositionSelectionPopup();
  })();
}

export function _renderPopupChatLive(final) {
  const p = document.getElementById('doc-chat-ask-float');
  if (p) _renderPopupChat(p, final);
}

export function _maybeDismissToIsland(popup) {
  if (window._popupChatAbort) {
    window._aetherBackgroundStreaming = true;
    islandUpdate('aether', {
      type: 'ai', label: 'Generating response\u2026',
      detail: 'Generating response\u2026',
      action: function() { _reopenAetherPanel(); }
    });
    // Don't abort — let stream continue in background
  }
}

export function _reopenAetherPanel() {
  window._aetherBackgroundStreaming = false;
  islandRemove('aether');

  // Preserve session, messages, and abort state across panel rebuild
  const savedSession = window._panelSession;
  const savedMsgs = window._popupChatMessages.slice();
  const savedAbort = window._popupChatAbort;
  window._popupChatAbort = null; // prevent _showPanel from aborting the stream

  _showPanel({ anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, trackCursor: false });

  // Restore the stream, messages, and session
  window._panelSession = savedSession;
  window._popupChatMessages = savedMsgs;
  window._popupChatAbort = savedAbort;
  window._aetherPinned = true;
  window._aetherTrackMode = false;

  const popup = document.getElementById('doc-chat-ask-float');
  if (popup) {
    popup.classList.add('has-chat');
    const chatArea = popup.querySelector('.doc-popup-chat-area');
    if (chatArea) chatArea.classList.add('visible');
    const isStreaming = !!window._popupChatAbort;
    _renderPopupChat(popup, !isStreaming);
    if (isStreaming) {
      const input = popup.querySelector('.doc-ask-inline-input');
      const sendBtn = popup.querySelector('.doc-ask-inline-send');
      if (input) input.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
    }
  }
}

export function _updateContextBar(popup) {
  // Removed — context bar no longer shown
}

export function _renderLatexInElement(element) {
  // Process LaTeX in text nodes, handling both inline ($...$) and display ($$...$$) math
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  const nodesToProcess = [];
  let node;
  while (node = walker.nextNode()) {
    // Skip if parent is code, pre, or already processed
    if (node.parentElement && !node.parentElement.closest('code, pre, .katex')) {
      nodesToProcess.push(node);
    }
  }

  nodesToProcess.forEach(textNode => {
    const text = textNode.textContent;
    // Match both display ($$...$$) and inline ($...$) LaTeX
    const regex = /(\$\$[^$]+?\$\$|\$[^$]+?\$)/g;
    const matches = text.match(regex);
    if (!matches) return;

    const parts = text.split(regex);
    const fragment = document.createDocumentFragment();

    parts.forEach(part => {
      if (part.startsWith('$$') && part.endsWith('$$')) {
        // Display math
        const math = part.slice(2, -2);
        const span = document.createElement('span');
        try {
          katex.render(math, span, { displayMode: true, throwOnError: false });
          fragment.appendChild(span);
        } catch (e) {
          fragment.appendChild(document.createTextNode(part));
        }
      } else if (part.startsWith('$') && part.endsWith('$')) {
        // Inline math
        const math = part.slice(1, -1);
        const span = document.createElement('span');
        try {
          katex.render(math, span, { displayMode: false, throwOnError: false });
          fragment.appendChild(span);
        } catch (e) {
          fragment.appendChild(document.createTextNode(part));
        }
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    });

    textNode.parentNode.replaceChild(fragment, textNode);
  });
}

export function _renderCtxPills(sources, msg) {
  if (!sources || !sources.length) return '';
  return '<div class="doc-msg-context-sources">' + sources.map(s => {
    const label = typeof s === 'string' ? s : s.label;
    let content = typeof s === 'object' ? s.content : null;
    // "tools" pill shows tools that were actually called
    if (label === 'tools' && msg && msg._toolsCalled && msg._toolsCalled.length) {
      content = msg._toolsCalled.join('\n');
    }
    if (content) {
      const truncated = content.length > 4000 ? content.slice(0, 4000) + '\n…truncated' : content;
      return '<details class="doc-ctx-details"><summary><span class="doc-ctx-pill">' +
        escapeHtml(label) + '</span></summary><pre class="doc-ctx-raw">' +
        escapeHtml(truncated) + '</pre></details>';
    }
    return '<span class="doc-ctx-pill">' + escapeHtml(label) + '</span>';
  }).join('') + '</div>';
}

export function _renderPopupChat(popup, final) {
  const container = popup.querySelector('.doc-popup-chat-messages');
  if (!container) return;
  const total = window._popupChatMessages.length;
  container.innerHTML = window._popupChatMessages.map((m, i) =>
    ChatRender.renderMessageHTML(m, i, total, final)
  ).join('');

  // Attach all handlers via ChatRender
  ChatRender.attachMessageHandlers(container, {
    onNavigate() {
      const p = document.getElementById('doc-chat-ask-float');
      if (p) { window._aetherTrackMode = false; p.remove(); }
    },
    onSpeak(btn) {
      if (window._ttsAudio || window._ttsChunks.length > 0) {
        const wasToggling = btn.classList.contains('doc-msg-speaking');
        _ttsStopAll();
        container.querySelectorAll('.doc-msg-speak-btn').forEach(b => b.classList.remove('doc-msg-speaking'));
        if (wasToggling) return;
      }
      const msgEl = btn.closest('.doc-msg-ai');
      if (!msgEl) return;
      const text = msgEl.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return;
      btn.classList.add('doc-msg-speaking');
      _updateAudioUnified('tts', { label: 'Generating\u2026', detail: 'Generating speech audio' });
      apiPost('/api/tts', { text }).then(data => {
        if (!data || !data.audioPath) throw new Error('No audio generated');
        const audio = new Audio('file://' + data.audioPath);
        audio.playbackRate = parseFloat(Settings.get('ttsSpeed')) || 1;
        window._ttsAudio = audio;
        _updateAudioUnified('tts', { label: 'Speaking', detail: 'Playing speech audio' });
        _ttsStartWaveform(audio);
        audio.onended = () => { btn.classList.remove('doc-msg-speaking'); window._ttsAudio = null; _ttsStopWaveform(); _clearAudioUnified('tts'); };
        audio.onerror = () => { btn.classList.remove('doc-msg-speaking'); window._ttsAudio = null; _ttsStopWaveform(); _clearAudioUnified('tts'); };
        audio.play();
      }).catch(() => { btn.classList.remove('doc-msg-speaking'); _clearAudioUnified('tts'); });
    },
    onRedo() {
      if (window._panelSession) {
        window._panelSession.redo().then(text => {
          if (text) {
            const input = popup.querySelector('.doc-ask-inline-input');
            if (input) input.value = text;
            window._popupChatMessages = window._panelSession.messages;
            if (window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
            _sendPopupChatMessage(popup, popup._capturedText || '');
          }
        });
      } else {
        // Legacy fallback
        let lastUserIdx = -1;
        for (let i = window._popupChatMessages.length - 1; i >= 0; i--) {
          if (window._popupChatMessages[i].role === 'user') { lastUserIdx = i; break; }
        }
        if (lastUserIdx < 0) return;
        const lastUserMsg = window._popupChatMessages[lastUserIdx];
        window._popupChatMessages = window._popupChatMessages.slice(0, lastUserIdx);
        if (window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
        const input = popup.querySelector('.doc-ask-inline-input');
        if (input) input.value = lastUserMsg._display || lastUserMsg.content;
        _sendPopupChatMessage(popup, popup._capturedText || '');
      }
    },
    onEdit(msgIdx) {
      if (window._panelSession) {
        window._panelSession.editFrom(msgIdx).then(text => {
          if (text != null) {
            window._popupChatMessages = window._panelSession.messages;
            const input = popup.querySelector('.doc-ask-inline-input');
            if (input) { input.value = text; input.focus(); }
            _renderPopupChat(popup, true);
          }
        });
      } else {
        if (msgIdx < 0 || msgIdx >= window._popupChatMessages.length) return;
        const msg = window._popupChatMessages[msgIdx];
        if (msg.role !== 'user') return;
        const input = popup.querySelector('.doc-ask-inline-input');
        if (!input) return;
        input.value = msg.content;
        input.focus();
        window._popupChatMessages.splice(msgIdx);
        _renderPopupChat(popup, true);
      }
    },
  });

  // Update send/stop button state
  const sendBtn = popup.querySelector('.doc-ask-inline-send');
  if (sendBtn) {
    if (window._popupChatAbort && !final) {
      sendBtn.innerHTML = icon('stopCircle', { size: 14 });
      sendBtn.title = 'Stop';
      sendBtn.disabled = false;
      sendBtn.classList.add('doc-ask-inline-stop');
    } else {
      sendBtn.innerHTML = '\u2191';
      sendBtn.title = 'Send';
      sendBtn.classList.remove('doc-ask-inline-stop');
    }
  }

  // Scroll
  const lastMsg = window._popupChatMessages[window._popupChatMessages.length - 1];
  if (lastMsg && ((lastMsg._searchResults?.length) || (lastMsg._paperResults?.length) || (lastMsg._userResults?.length))) {
    const msgs = container.querySelectorAll('.doc-msg-user, .doc-msg-ai');
    const searchUserMsg = msgs.length >= 2 ? msgs[msgs.length - 2] : null;
    if (searchUserMsg) searchUserMsg.scrollIntoView({ block: 'start' });
    else container.scrollTop = 0;
  } else {
    container.scrollTop = container.scrollHeight;
  }
  _updateContextBar(popup);
  _updateChatStats(popup, final);
  const hasAiMsg = window._popupChatMessages.some(m => m.role === 'assistant' && !m._thinking && m.content);
  if (popup._redoBtn) popup._redoBtn.style.display = hasAiMsg ? '' : 'none';
  if (popup._copyChatBtn) popup._copyChatBtn.style.display = hasAiMsg ? '' : 'none';
  if (popup._openInTabBtn) popup._openInTabBtn.style.display = (window._panelThreadId && hasAiMsg) ? '' : 'none';
}

export function _updateContextUsage(popup) {
  // Removed — context usage no longer shown
}

export function _updateChatStats(popup, final) {
  const statsEl = popup.querySelector('.doc-chat-stats');
  if (!statsEl) return;
  _updateContextUsage(popup);
  if (window._popupChatMessages.length === 0) { statsEl.textContent = ''; return; }
  const lastAi = [...window._popupChatMessages].reverse().find(m => m.role === 'assistant' && !m._thinking);
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
  } else if (window._chatStreamStart) {
    const elapsed = Date.now() - window._chatStreamStart;
    parts.push(elapsed >= 1000 ? (elapsed / 1000).toFixed(1) + 's' : elapsed + 'ms');
  }
  // Model name
  if (lastAi._usage && lastAi._usage.model) parts.push(lastAi._usage.model);
  statsEl.textContent = parts.join(' \u00B7 ');
}

export function _savePopupChatToHighlight(popup) {
  window._popupChatMessages = [];
}

// Position a popup so one of its four corners is at (cx, cy), picking the best
// corner that keeps it within bounds. preferLeft = bottom-right corner at cursor.

export function _screenshotRestoreIframes() {
  document.querySelectorAll('iframe, webview').forEach(f => {
    if ('peTrack' in f.dataset) {
      f.style.pointerEvents = f.dataset.peTrack;
      delete f.dataset.peTrack;
    }
  });
}

export async function _browserCaptureRect(rect) {
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
    logger.error('Browser screenshot capture failed:', err);
    return null;
  }
}

export function _addTabContextToPanel(popup, tabInfo) {
  if (window._pendingTabContexts.some(t => t.tabId === tabInfo.tabId)) return;
  window._pendingTabContexts.push({ tabId: tabInfo.tabId, title: tabInfo.title, url: tabInfo.url, content: tabInfo.content || '' });

  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (!strip) return;
  strip.style.display = 'flex';

  const chipView = new window.View('div').className('doc-tab-context-chip');
  chipView.attr('data-tab-id', tabInfo.tabId);
  const chip = chipView.el;
  const domain = (() => { try { return new URL(tabInfo.url).hostname.replace('www.', ''); } catch { return ''; } })();
  const favUrl = tabInfo.url ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=16' : '';
  const favHtml = favUrl ? '<img src="' + favUrl + '" class="w-3 h-3 flex-shrink-0 rounded-sm" onerror="this.style.display=\'none\'">' :
    icon('browserTab', { size: 12, class: 'w-3 h-3 flex-shrink-0' });
  chip.appendChild(window.RawHTML(favHtml).el);
  chip.appendChild(window.Text(tabInfo.title || domain || 'Tab').className('truncate').el);

  const removeBtn = window.Button('\u00d7').className('doc-note-context-remove');
  removeBtn.on('mousedown', function(ev) { ev.stopPropagation(); });
  removeBtn.onTap(function(ev) {
    ev.stopPropagation();
    window._pendingTabContexts = window._pendingTabContexts.filter(t => t.tabId !== tabInfo.tabId);
    chip.remove();
    if (window._pendingTabContexts.length === 0 && window._pendingScreenshots.length === 0) strip.style.display = 'none';
  });
  chip.appendChild(removeBtn.el);
  strip.appendChild(chip);

  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.focus();
  _updateContextBar(popup);
}

export function _showTabContextMenu(e, tabEl) {
  const tid = tabEl.dataset.tabId || (() => { const m = (tabEl.getAttribute('onclick') || '').match(/browseSelectTab\((\d+)\)/); return m ? m[1] : null; })();
  if (!tid) return;
  const tabId = parseInt(tid);
  const win = window._getCurrentWindow();
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
    icon: icon('chatContext', { size: 14, class: 'w-3.5 h-3.5 inline', strokeWidth: '1.5' }),
    fn() {
      (async () => {
        try {
          const data = await apiPost('/api/extract-text', { url: tab.url });
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
          logger.warn('Failed to extract tab context:', err);
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
      const gc = typeof window._BROWSE_GROUP_COLOR_MAP !== 'undefined' ? (window._BROWSE_GROUP_COLOR_MAP[g.color] || g.color) : g.color;
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
  if (window._browseAudioTabs.has(tabId)) {
    const audioInfo = window._browseAudioTabs.get(tabId);
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

export function _addScreenshotToPanel(popup, base64) {
  window._pendingScreenshots.push(base64);

  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (!strip) return;
  strip.style.display = 'flex';

  const thumbView = new window.View('div').className('doc-screenshot-thumb');
  const thumb = thumbView.el;
  const imgView = new window.View('img');
  imgView.el.src = 'data:image/png;base64,' + base64;
  thumb.appendChild(imgView.el);

  const removeBtn = window.Button('\u00d7').className('doc-screenshot-thumb-remove');
  removeBtn.on('mousedown', function(ev) { ev.stopPropagation(); });
  removeBtn.onTap(function(ev) {
    ev.stopPropagation();
    const idx = window._pendingScreenshots.indexOf(base64);
    if (idx !== -1) window._pendingScreenshots.splice(idx, 1);
    thumb.remove();
    if (window._pendingScreenshots.length === 0) strip.style.display = 'none';
  });
  thumb.appendChild(removeBtn.el);
  strip.appendChild(thumb);

  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.focus();
  _updateContextBar(popup);
}

// Web search from aether panel (Shift+Enter)
