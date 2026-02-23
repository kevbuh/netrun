// chat-render.js — Shared message rendering for panel-chat and chat-view
// Renders rich messages: markdown, LaTeX, thinking blocks, context pills, tool confirmations, actions
// Returns AetherUI View trees with handlers directly attached (no separate attachMessageHandlers step)
import { escapeHtml, escapeAttr, truncate } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { browseNewTab } from '/js/browse/browse-windows.js';

// ── Helper: open URL via browseNewTab ──
function _openUrl(url, opts) {
  window.location.hash = '#browse';
  browseNewTab(url);
  if (opts && opts.onNavigate) opts.onNavigate();
}

// ── Render a single message to a View tree ──
// opts: { onNavigate, onFollowUp, onSpeak, onRedo, onEdit }

function renderMessage(msg, index, total, isFinal, opts) {
  opts = opts || {};
  if (msg.role === 'user') {
    return _renderUserMessage(msg, index, opts);
  }
  // Assistant message
  if (msg._thinking) {
    return _renderThinkingMessage(msg);
  }
  // Search results
  if (msg._searchResults?.length) return _renderSearchResults(msg._searchResults, 'doc-search-result', opts);
  if (msg._paperResults?.length) return _renderPaperResults(msg._paperResults, opts);
  if (msg._userResults?.length) return _renderUserResults(msg._userResults, opts);

  const isLast = index === total - 1;
  const children = [];

  // Context pills
  const ctxView = renderCtxPills(msg._ctxSources, msg);
  if (ctxView) children.push(ctxView);

  // System prompt block
  if (msg._systemPrompt) {
    children.push(RawHTML('<details class="doc-thinking-block"><summary>System prompt</summary><pre class="doc-ctx-raw">' + escapeHtml(msg._systemPrompt) + '</pre></details>'));
  }

  // Thinking block (collapsed)
  if (msg._thinkingText) {
    children.push(RawHTML('<details class="doc-thinking-block"><summary>Thought for a moment</summary><div class="doc-thinking-content">' + escapeHtml(msg._thinkingText) + '</div></details>'));
  }

  // Web sources
  const sourcesView = _renderWebSources(msg._webSources, opts);
  if (sourcesView) children.push(sourcesView);

  // Main content (markdown or plain)
  let contentHtml = (isFinal || !isLast) && typeof marked !== 'undefined'
    ? marked.parse(msg.content)
    : escapeHtml(msg.content);

  // Settings button for API key errors
  if (msg.content && msg.content.includes('API key not set')) {
    contentHtml += '<button class="doc-msg-settings-btn" title="Open AI Settings" style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;padding:4px 12px;border-radius:8px;border:1px solid var(--nr-accent,#b4451a);background:rgba(var(--nr-accent-rgb,180,69,26),0.1);color:var(--nr-accent,#b4451a);font-size:0.78rem;cursor:pointer;font-weight:500;">Open Settings</button>';
  }

  // Linkify [1], [2] citations if web sources exist
  if (msg._webSources?.length) contentHtml = _linkifyCitations(contentHtml, msg._webSources);

  const contentView = RawHTML(contentHtml);
  children.push(contentView);

  // Follow-up buttons
  if (isLast && msg._followUps?.length) {
    children.push(_renderFollowUps(msg._followUps, opts));
  }

  // Action buttons row
  children.push(_renderActionButtons(msg, isLast, opts));

  const view = VStack(...children).className('doc-msg-ai');

  // Post-build: attach settings button handler + citation handlers + LaTeX
  view.onAppear(function() {
    var el = view.el;
    // Settings button
    el.querySelectorAll('.doc-msg-settings-btn').forEach(function(btn) {
      btn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
      btn.addEventListener('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (typeof window._openSettingsToAI === 'function') window._openSettingsToAI();
        if (opts.onNavigate) opts.onNavigate();
      });
    });
    // Citation clicks — highlight corresponding source card
    el.querySelectorAll('.nr-citation').forEach(function(cit) {
      cit.addEventListener('click', function(ev) {
        ev.preventDefault(); ev.stopPropagation();
        var n = cit.getAttribute('data-source-n');
        var container = el.closest('.doc-popup-chat-messages') || el.parentElement;
        var card = container && container.querySelector('.nr-source-card[data-source-n="' + n + '"]');
        if (card) {
          card.classList.add('nr-source-highlight');
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          setTimeout(function() { card.classList.remove('nr-source-highlight'); }, 1500);
        }
      });
      cit.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
    });
    // LaTeX
    renderLatexInElement(el);
  });

  return view;
}


function _renderUserMessage(msg, index, opts) {
  var children = [];
  var display = msg._display || msg.content;

  // Images
  if (msg.images?.length) {
    var imgs = msg.images.map(function(b64) {
      return new View('img').attr('src', 'data:image/png;base64,' + b64);
    });
    children.push(HStack(...imgs).className('doc-msg-images'));
  }

  // Search badges
  if (msg._isSearch) children.push(Text('search').className('doc-search-badge'));
  if (msg._isPaperSearch) children.push(Text('papers').className('doc-search-badge doc-paper-badge'));
  if (msg._isUserSearch) children.push(Text('users').className('doc-search-badge doc-user-badge'));

  // User text
  children.push(Text(display).className('doc-msg-user-text'));

  // Edit button
  var editBtn = Button(RawHTML(typeof icon === 'function' ? icon('edit', { size: 11 }) : '\u270E'))
    .className('doc-msg-edit-btn')
    .attr('title', 'Edit and resend')
    .on('mousedown', function(ev) { ev.stopPropagation(); })
    .onTap(function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      if (opts.onEdit) opts.onEdit(index);
    });
  children.push(editBtn);

  return HStack(...children).className('doc-msg-user').attr('data-msg-idx', String(index));
}

function _renderThinkingMessage(msg) {
  var children = [];
  var ctxView = renderCtxPills(msg._ctxSources, msg);
  if (ctxView) children.push(ctxView);

  // Rich activity tracker
  if (msg._activity?.length) {
    var now = Date.now();
    var _iconForStep = function(a) {
      if (typeof icon !== 'function') return '';
      if (a.type === 'thinking') return icon('eye', { size: 13 });
      if (a.category === 'search') return icon('search', { size: 13 });
      if (a.category === 'extract') return icon('fileText', { size: 13 });
      if (a.type === 'inference') return icon('chatBubble', { size: 13 });
      return icon('globe', { size: 13 });
    };

    var entries = msg._activity.map(function(a) {
      var done = !!a.endedAt;
      var elapsed = done ? (a.endedAt - a.startedAt) : (now - a.startedAt);
      var timeStr = elapsed >= 100 ? _formatDuration(elapsed) : '';
      var stepIconHtml = done
        ? '<span class="nr-step-icon done">' + (typeof icon === 'function' ? icon('check', { size: 11 }) : '\u2713') + '</span>'
        : '<span class="nr-step-icon active">' + _iconForStep(a) + '</span>';
      var detail = a.detail ? '<span class="nr-step-detail">' + escapeHtml(a.detail.length > 50 ? a.detail.slice(0, 47) + '\u2026' : a.detail) + '</span>' : '';
      var time = timeStr ? '<span class="nr-step-time">' + timeStr + '</span>' : '';
      return '<div class="nr-step' + (done ? ' done' : ' active') + '">' + stepIconHtml + '<span class="nr-step-label">' + escapeHtml(a.label) + '</span>' + detail + time + '</div>';
    }).join('');

    children.push(RawHTML('<div class="nr-steps">' + entries + '</div>'));

    if (msg._thinkingText) {
      var previewText = msg._thinkingText.length > 200 ? '\u2026' + msg._thinkingText.slice(-200) : msg._thinkingText;
      children.push(Text(previewText).className('doc-thinking-preview'));
    }

    return VStack(...children).className('doc-msg-ai');
  }

  // Fallback: simple dots + label
  children.push(RawHTML('<span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>'));
  if (msg._thinkingLabel) children.push(Text(msg._thinkingLabel).className('doc-thinking-label'));
  if (msg._thinkingText) {
    var previewText = msg._thinkingText.length > 200 ? '\u2026' + msg._thinkingText.slice(-200) : msg._thinkingText;
    children.push(Text(previewText).className('doc-thinking-preview'));
  }

  return VStack(...children).className('doc-msg-ai');
}

function _formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function _renderSearchResults(results, className, opts) {
  var items = results.map(function(r) {
    var children = [
      Text(r.title).className('doc-search-result-title'),
    ];
    if (r.snippet) children.push(Text(r.snippet).className('doc-search-result-snippet'));
    children.push(Text(r.url.length > 60 ? r.url.slice(0, 57) + '...' : r.url).className('doc-search-result-url'));
    var row = VStack(...children).className(className).attr('data-href', r.url);
    (function(url) {
      row.on('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); _openUrl(url, opts); });
      row.on('mousedown', function(ev) { ev.stopPropagation(); });
    })(r.url);
    return row;
  });
  return VStack(...items).className('doc-msg-ai doc-msg-search-results');
}

function _renderPaperResults(results, opts) {
  var items = results.map(function(r) {
    var children = [
      Text(r.title).className('doc-paper-result-title'),
      Text(r.authors + (r.year ? ' \u00B7 ' + r.year : '')).className('doc-paper-result-meta'),
    ];
    if (r.summary) {
      children.push(Text(r.summary.length > 150 ? r.summary.slice(0, 147) + '...' : r.summary).className('doc-paper-result-summary'));
    }
    var row = VStack(...children).className('doc-paper-result').attr('data-href', r.link);
    (function(url) {
      row.on('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); _openUrl(url, opts); });
      row.on('mousedown', function(ev) { ev.stopPropagation(); });
    })(r.link);
    return row;
  });
  return VStack(...items).className('doc-msg-ai doc-msg-search-results');
}

function _renderUserResults(results, opts) {
  var items = results.map(function(u) {
    var avatarView = u.picture
      ? new View('img').className('doc-user-result-avatar').attr('src', u.picture)
      : Text(u.username.charAt(0).toUpperCase()).className('doc-user-result-avatar doc-user-result-avatar-fallback');
    var nameView = Text(u.username).className('doc-user-result-name');
    var row = HStack(avatarView, nameView).className('doc-user-result').attr('data-username', u.username);
    (function(username) {
      row.on('click', function(ev) {
        ev.preventDefault(); ev.stopPropagation();
        window.location.hash = '#profile/' + encodeURIComponent(username);
        if (opts.onNavigate) opts.onNavigate();
      });
      row.on('mousedown', function(ev) { ev.stopPropagation(); });
    })(u.username);
    return row;
  });
  return VStack(...items).className('doc-msg-ai doc-msg-search-results');
}

// ── Web source cards (Perplexity-style) ──

function _renderWebSources(sources, opts) {
  if (!sources?.length) return null;
  var cards = sources.map(function(s) {
    var domain = _extractDomain(s.url);
    var favicon = '/api/favicon?domain=' + encodeURIComponent(domain);
    var card = HStack(
      Text(String(s.n)).className('nr-source-badge'),
      new View('img').className('nr-source-favicon').attr('src', favicon).attr('width', '14').attr('height', '14'),
      Text(s.title.length > 40 ? s.title.slice(0, 37) + '...' : s.title).className('nr-source-title'),
      Text(domain).className('nr-source-domain')
    ).className('nr-source-card')
      .attr('data-source-n', String(s.n))
      .attr('href', s.url)
      .attr('title', s.title);
    (function(url) {
      card.on('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); _openUrl(url, opts); });
      card.on('mousedown', function(ev) { ev.stopPropagation(); });
    })(s.url);
    return card;
  });
  return HStack(...cards).className('nr-source-cards');
}

function _extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function _linkifyCitations(html, sources) {
  if (!sources?.length) return html;
  return html.replace(/\[(\d+)\]/g, function(match, num) {
    var n = parseInt(num);
    var src = sources.find(function(s) { return s.n === n; });
    if (!src) return match;
    return '<a class="nr-citation" data-source-n="' + n + '" href="' + escapeAttr(src.url) + '" title="' + escapeAttr(src.title) + '">[' + n + ']</a>';
  });
}

function _renderFollowUps(followUps, opts) {
  if (!followUps?.length) return null;
  var btns = followUps.map(function(q) {
    return Button(q).className('nr-followup-btn')
      .on('mousedown', function(ev) { ev.stopPropagation(); })
      .onTap(function(ev) {
        ev.preventDefault(); ev.stopPropagation();
        if (opts.onFollowUp) opts.onFollowUp(q);
      });
  });
  return HStack(...btns).className('nr-followup-strip');
}

// ── Action buttons (copy, speak, redo) ──

function _renderActionButtons(msg, isLast, opts) {
  var buttons = [];

  // Copy button
  var copyBtn = Button(RawHTML(typeof icon === 'function' ? icon('copy', { size: 12 }) : '\u{1F4CB}'))
    .className('doc-msg-copy-btn')
    .attr('title', 'Copy message')
    .on('mousedown', function(ev) { ev.stopPropagation(); })
    .onTap(function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      var msgEl = copyBtn.el.closest('.doc-msg-ai');
      if (!msgEl) return;
      var text = msgEl.textContent.replace(/Copy message|Read aloud|Redo last message/g, '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      navigator.clipboard.writeText(text).then(function() {
        AetherUI.mount(RawHTML(typeof icon === 'function' ? icon('check', { size: 12 }) : '\u2713'), copyBtn.el);
        setTimeout(function() { if (copyBtn.el.isConnected) AetherUI.mount(RawHTML(typeof icon === 'function' ? icon('copy', { size: 12 }) : '\u{1F4CB}'), copyBtn.el); }, 1000);
        if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6');
      }).catch(function() {});
    });
  buttons.push(copyBtn);

  // Speak button
  var speakBtn = Button(RawHTML(typeof icon === 'function' ? icon('speaker', { size: 12 }) : '\u{1F50A}'))
    .className('doc-msg-speak-btn')
    .attr('title', 'Read aloud')
    .on('mousedown', function(ev) { ev.stopPropagation(); })
    .onTap(function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      if (opts.onSpeak) opts.onSpeak(speakBtn.el);
    });
  buttons.push(speakBtn);

  // Redo button (only on last message)
  if (isLast) {
    var redoBtn = Button(RawHTML(typeof icon === 'function' ? icon('redo', { size: 12 }) : '\u21BA'))
      .className('doc-msg-redo-btn')
      .attr('title', 'Redo last message')
      .on('mousedown', function(ev) { ev.stopPropagation(); })
      .onTap(function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (opts.onRedo) opts.onRedo();
      });
    buttons.push(redoBtn);
  }

  return HStack(...buttons).className('doc-msg-actions');
}

// ── Context pills ──

function renderCtxPills(sources, msg) {
  if (!sources?.length) return null;
  var pills = sources.map(function(s) {
    var label = typeof s === 'string' ? s : s.label;
    var content = typeof s === 'object' ? s.content : null;
    if (label === 'tools' && msg?._toolsCalled?.length) {
      content = msg._toolsCalled.join('\n');
    }
    if (content) {
      var truncated = content.length > 4000 ? content.slice(0, 4000) + '\n\u2026truncated' : content;
      return RawHTML('<details class="doc-ctx-details"><summary><span class="doc-ctx-pill">' +
        escapeHtml(label) + '</span></summary><pre class="doc-ctx-raw">' +
        escapeHtml(truncated) + '</pre></details>');
    }
    return Text(label).className('doc-ctx-pill');
  });
  return HStack(...pills).className('doc-msg-context-sources');
}

// ── LaTeX rendering ──

function renderLatexInElement(element) {
  if (typeof katex === 'undefined') return;
  var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  var nodesToProcess = [];
  var node;
  while (node = walker.nextNode()) {
    if (node.parentElement && !node.parentElement.closest('code, pre, .katex')) {
      nodesToProcess.push(node);
    }
  }

  nodesToProcess.forEach(function(textNode) {
    var text = textNode.textContent;
    var regex = /(\$\$[^$]+?\$\$|\$[^$]+?\$)/g;
    var matches = text.match(regex);
    if (!matches) return;

    var parts = text.split(regex);
    var fragment = document.createDocumentFragment();

    parts.forEach(function(part) {
      if (part.startsWith('$$') && part.endsWith('$$')) {
        var math = part.slice(2, -2);
        var span = document.createElement('span');
        try {
          katex.render(math, span, { displayMode: true, throwOnError: false });
          fragment.appendChild(span);
        } catch (e) { fragment.appendChild(document.createTextNode(part)); }
      } else if (part.startsWith('$') && part.endsWith('$')) {
        var math = part.slice(1, -1);
        var span = document.createElement('span');
        try {
          katex.render(math, span, { displayMode: false, throwOnError: false });
          fragment.appendChild(span);
        } catch (e) { fragment.appendChild(document.createTextNode(part)); }
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    });

    textNode.parentNode.replaceChild(fragment, textNode);
  });
}

// ── Render all messages to a single View ──

function renderMessages(messages, isFinal, opts) {
  opts = opts || {};
  var total = messages.length;
  var views = messages.map(function(m, i) {
    return renderMessage(m, i, total, isFinal, opts);
  });
  return VStack(...views);
}

// ── Chat stats (token count, timing, model) — returns a View ──

function renderChatStats(messages, streamStart) {
  if (!messages.length) return null;
  var lastAi = null;
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && !messages[i]._thinking) { lastAi = messages[i]; break; }
  }
  if (!lastAi) return null;
  var parts = [];
  if (lastAi._usage) {
    var u = lastAi._usage;
    var total = (u.prompt_tokens || 0) + (u.completion_tokens || 0);
    if (total) parts.push(total >= 1000 ? (total / 1000).toFixed(1) + 'k tokens' : total + ' tokens');
  } else if (lastAi.content) {
    var est = Math.round(lastAi.content.length / 4);
    if (est > 0) parts.push('~' + (est >= 1000 ? (est / 1000).toFixed(1) + 'k' : est) + ' tokens');
  }
  if (lastAi._usage?.duration_ms) {
    var ms = lastAi._usage.duration_ms;
    parts.push(ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms');
  } else if (lastAi._timings?.total) {
    parts.push(_formatDuration(lastAi._timings.total));
  } else if (streamStart) {
    var elapsed = Date.now() - streamStart;
    parts.push(elapsed >= 1000 ? (elapsed / 1000).toFixed(1) + 's' : elapsed + 'ms');
  }
  if (lastAi._usage?.model) parts.push(lastAi._usage.model);

  // Per-phase timing breakdown
  if (lastAi._timings) {
    var t = lastAi._timings;
    var phases = [];
    if (t.search) phases.push('search ' + _formatDuration(t.search));
    if (t.extract) phases.push('extract ' + _formatDuration(t.extract));
    if (t.inference) phases.push('generate ' + _formatDuration(t.inference));
    if (phases.length) {
      var mainText = parts.join(' \u00B7 ');
      var breakdownText = phases.join(' \u00B7 ');
      return HStack(
        Text(mainText),
        Text(breakdownText).className('nr-timing-breakdown')
      );
    }
  }

  if (!parts.length) return null;
  return Text(parts.join(' \u00B7 '));
}

// ── Backward compat: attachMessageHandlers (no-op for already-handled Views, still works for RawHTML) ──

function attachMessageHandlers(container, opts) {
  opts = opts || {};

  // Search result clicks (for any RawHTML content that wasn't built as Views)
  container.querySelectorAll('.doc-search-result[data-href]').forEach(function(el) {
    if (el._chatHandlersBound) return;
    el._chatHandlersBound = true;
    el.addEventListener('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); _openUrl(el.getAttribute('data-href'), opts); });
    el.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  });
  container.querySelectorAll('.doc-paper-result[data-href]').forEach(function(el) {
    if (el._chatHandlersBound) return;
    el._chatHandlersBound = true;
    el.addEventListener('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); _openUrl(el.getAttribute('data-href'), opts); });
    el.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  });
  container.querySelectorAll('.doc-user-result[data-username]').forEach(function(el) {
    if (el._chatHandlersBound) return;
    el._chatHandlersBound = true;
    el.addEventListener('click', function(ev) {
      ev.preventDefault(); ev.stopPropagation();
      window.location.hash = '#profile/' + encodeURIComponent(el.getAttribute('data-username'));
      if (opts.onNavigate) opts.onNavigate();
    });
    el.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  });
  container.querySelectorAll('.doc-note-result[data-note-id]').forEach(function(el) {
    if (el._chatHandlersBound) return;
    el._chatHandlersBound = true;
    el.addEventListener('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); if (opts.onNavigate) opts.onNavigate(); });
    el.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  });
  container.querySelectorAll('.nr-source-card').forEach(function(el) {
    if (el._chatHandlersBound) return;
    el._chatHandlersBound = true;
    el.addEventListener('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); _openUrl(el.getAttribute('href'), opts); });
    el.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  });
  container.querySelectorAll('.nr-citation').forEach(function(el) {
    if (el._chatHandlersBound) return;
    el._chatHandlersBound = true;
    el.addEventListener('click', function(ev) {
      ev.preventDefault(); ev.stopPropagation();
      var n = el.getAttribute('data-source-n');
      var card = container.querySelector('.nr-source-card[data-source-n="' + n + '"]');
      if (card) {
        card.classList.add('nr-source-highlight');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        setTimeout(function() { card.classList.remove('nr-source-highlight'); }, 1500);
      }
    });
    el.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  });
  container.querySelectorAll('.nr-followup-btn').forEach(function(btn) {
    if (btn._chatHandlersBound) return;
    btn._chatHandlersBound = true;
    btn.addEventListener('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); if (opts.onFollowUp) opts.onFollowUp(btn.textContent); });
    btn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  });
  container.querySelectorAll('.doc-msg-settings-btn').forEach(function(btn) {
    if (btn._chatHandlersBound) return;
    btn._chatHandlersBound = true;
    btn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
    btn.addEventListener('click', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      if (typeof window._openSettingsToAI === 'function') window._openSettingsToAI();
      if (opts.onNavigate) opts.onNavigate();
    });
  });
  container.querySelectorAll('.doc-msg-copy-btn').forEach(function(btn) {
    if (btn._chatHandlersBound) return;
    btn._chatHandlersBound = true;
    btn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
    btn.addEventListener('click', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      var msgEl = btn.closest('.doc-msg-ai');
      if (!msgEl) return;
      var text = msgEl.textContent.replace(/Copy message|Read aloud|Redo last message/g, '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      navigator.clipboard.writeText(text).then(function() {
        btn.innerHTML = typeof icon === 'function' ? icon('check', { size: 12 }) : '\u2713';
        setTimeout(function() { btn.innerHTML = typeof icon === 'function' ? icon('copy', { size: 12 }) : '\u{1F4CB}'; }, 1000);
        if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6');
      }).catch(function() {});
    });
  });
  container.querySelectorAll('.doc-msg-speak-btn').forEach(function(btn) {
    if (btn._chatHandlersBound) return;
    btn._chatHandlersBound = true;
    btn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
    btn.addEventListener('click', function(ev) { ev.stopPropagation(); ev.preventDefault(); if (opts.onSpeak) opts.onSpeak(btn); });
  });
  container.querySelectorAll('.doc-msg-redo-btn').forEach(function(btn) {
    if (btn._chatHandlersBound) return;
    btn._chatHandlersBound = true;
    btn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
    btn.addEventListener('click', function(ev) { ev.stopPropagation(); ev.preventDefault(); if (opts.onRedo) opts.onRedo(); });
  });
  container.querySelectorAll('.doc-msg-edit-btn').forEach(function(btn) {
    if (btn._chatHandlersBound) return;
    btn._chatHandlersBound = true;
    btn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
    btn.addEventListener('click', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      var msgIdx = parseInt(btn.getAttribute('data-msg-idx'));
      if (opts.onEdit && !isNaN(msgIdx)) opts.onEdit(msgIdx);
    });
  });
  // LaTeX
  container.querySelectorAll('.doc-msg-ai').forEach(function(msgEl) {
    renderLatexInElement(msgEl);
  });
}

// ── Public API ──

const ChatRender = {
  renderMessage,
  renderMessages,
  renderCtxPills,
  renderLatexInElement,
  attachMessageHandlers,
  renderChatStats,
};
export default ChatRender;
