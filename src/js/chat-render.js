// chat-render.js — Shared message rendering for panel-chat and chat-view
// Renders rich messages: markdown, LaTeX, thinking blocks, context pills, tool confirmations, actions

// ── Render a single message to HTML string ──

function renderMessageHTML(msg, index, total, isFinal) {
  if (msg.role === 'user') {
    return _renderUserMessage(msg, index);
  }
  // Assistant message
  if (msg._thinking) {
    return _renderThinkingMessage(msg);
  }
  // Search results
  if (msg._searchResults?.length) return _renderSearchResults(msg._searchResults, 'doc-search-result');
  if (msg._paperResults?.length) return _renderPaperResults(msg._paperResults);
  if (msg._userResults?.length) return _renderUserResults(msg._userResults);

  const isLast = index === total - 1;
  let content = (isFinal || !isLast) && typeof marked !== 'undefined'
    ? marked.parse(msg.content)
    : escapeHtml(msg.content);
  // Linkify [1], [2] citations if web sources exist
  if (msg._webSources?.length) content = _linkifyCitations(content, msg._webSources);
  const sourcesBlock = _renderWebSources(msg._webSources);
  const followUpsBlock = isLast ? _renderFollowUps(msg._followUps) : '';
  const thinkingBlock = msg._thinkingText ? `<details class="doc-thinking-block"><summary>Thought for a moment</summary><div class="doc-thinking-content">${escapeHtml(msg._thinkingText)}</div></details>` : '';
  const promptBlock = msg._systemPrompt ? `<details class="doc-thinking-block"><summary>System prompt</summary><pre class="doc-ctx-raw">${escapeHtml(msg._systemPrompt)}</pre></details>` : '';
  const ctxBlock = renderCtxPills(msg._ctxSources, msg);
  const copyBtn = `<button class="doc-msg-copy-btn" title="Copy message">${typeof icon === 'function' ? icon('copy', { size: 12 }) : '\u{1F4CB}'}</button>`;
  const speakBtn = `<button class="doc-msg-speak-btn" title="Read aloud">${typeof icon === 'function' ? icon('speaker', { size: 12 }) : '\u{1F50A}'}</button>`;
  const redoBtn = isLast ? `<button class="doc-msg-redo-btn" title="Redo last message">${typeof icon === 'function' ? icon('redo', { size: 12 }) : '\u21BA'}</button>` : '';
  return `<div class="doc-msg-ai">${ctxBlock}${promptBlock}${thinkingBlock}${sourcesBlock}${content}${followUpsBlock}<div class="doc-msg-actions">${copyBtn}${speakBtn}${redoBtn}</div></div>`;
}

function _renderUserMessage(msg, index) {
  const display = msg._display || msg.content;
  let imgsHtml = '';
  if (msg.images?.length) {
    imgsHtml = '<div class="doc-msg-images">' + msg.images.map(b64 =>
      `<img src="data:image/png;base64,${b64}" />`
    ).join('') + '</div>';
  }
  const searchIcon = msg._isSearch ? '<span class="doc-search-badge">search</span>' : '';
  const paperIcon = msg._isPaperSearch ? '<span class="doc-search-badge doc-paper-badge">papers</span>' : '';
  const userIcon = msg._isUserSearch ? '<span class="doc-search-badge doc-user-badge">users</span>' : '';
  const editBtn = `<button class="doc-msg-edit-btn" data-msg-idx="${index}" title="Edit and resend">${typeof icon === 'function' ? icon('edit', { size: 11 }) : '\u270E'}</button>`;
  return `<div class="doc-msg-user" data-msg-idx="${index}">${imgsHtml}${searchIcon}${paperIcon}${userIcon}<span class="doc-msg-user-text">${escapeHtml(display)}</span>${editBtn}</div>`;
}

function _renderThinkingMessage(msg) {
  const ctxBlock = renderCtxPills(msg._ctxSources, msg);

  // Rich activity tracker
  if (msg._activity?.length) {
    const now = Date.now();
    const _iconForStep = (a) => {
      if (typeof icon !== 'function') return '';
      if (a.type === 'thinking') return icon('eye', { size: 13 });
      if (a.category === 'search') return icon('search', { size: 13 });
      if (a.category === 'extract') return icon('fileText', { size: 13 });
      if (a.type === 'inference') return icon('chatBubble', { size: 13 });
      return icon('globe', { size: 13 });
    };

    const entries = msg._activity.map(a => {
      const done = !!a.endedAt;
      const elapsed = done ? (a.endedAt - a.startedAt) : (now - a.startedAt);
      const timeStr = elapsed >= 100 ? _formatDuration(elapsed) : '';
      const stepIcon = done
        ? `<span class="nr-step-icon done">${typeof icon === 'function' ? icon('check', { size: 11 }) : '\u2713'}</span>`
        : `<span class="nr-step-icon active">${_iconForStep(a)}</span>`;
      const detail = a.detail ? `<span class="nr-step-detail">${escapeHtml(a.detail.length > 50 ? a.detail.slice(0, 47) + '\u2026' : a.detail)}</span>` : '';
      const time = timeStr ? `<span class="nr-step-time">${timeStr}</span>` : '';
      return `<div class="nr-step${done ? ' done' : ' active'}">${stepIcon}<span class="nr-step-label">${escapeHtml(a.label)}</span>${detail}${time}</div>`;
    }).join('');

    const preview = msg._thinkingText ? `<div class="doc-thinking-preview">${escapeHtml(msg._thinkingText.length > 200 ? '\u2026' + msg._thinkingText.slice(-200) : msg._thinkingText)}</div>` : '';
    return `<div class="doc-msg-ai">${ctxBlock}<div class="nr-steps">${entries}</div>${preview}</div>`;
  }

  // Fallback: simple dots + label
  const label = msg._thinkingLabel ? `<span class="doc-thinking-label">${escapeHtml(msg._thinkingLabel)}</span>` : '';
  const preview = msg._thinkingText ? `<div class="doc-thinking-preview">${escapeHtml(msg._thinkingText.length > 200 ? '\u2026' + msg._thinkingText.slice(-200) : msg._thinkingText)}</div>` : '';
  return `<div class="doc-msg-ai">${ctxBlock}<span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>${label}${preview}</div>`;
}

function _formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function _renderSearchResults(results, className) {
  const resultsHtml = results.map(r =>
    `<div class="${className}" data-href="${escapeAttr(r.url)}">` +
    `<div class="doc-search-result-title">${escapeHtml(r.title)}</div>` +
    (r.snippet ? `<div class="doc-search-result-snippet">${escapeHtml(r.snippet)}</div>` : '') +
    `<div class="doc-search-result-url">${escapeHtml(r.url.length > 60 ? r.url.slice(0, 57) + '...' : r.url)}</div>` +
    `</div>`
  ).join('');
  return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
}

function _renderPaperResults(results) {
  const resultsHtml = results.map(r =>
    `<div class="doc-paper-result" data-href="${escapeAttr(r.link)}">` +
    `<div class="doc-paper-result-title">${escapeHtml(r.title)}</div>` +
    `<div class="doc-paper-result-meta">${escapeHtml(r.authors)}${r.year ? ' \u00B7 ' + r.year : ''}</div>` +
    (r.summary ? `<div class="doc-paper-result-summary">${escapeHtml(r.summary.length > 150 ? r.summary.slice(0, 147) + '...' : r.summary)}</div>` : '') +
    `</div>`
  ).join('');
  return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
}

function _renderUserResults(results) {
  const resultsHtml = results.map(u =>
    `<div class="doc-user-result" data-username="${escapeAttr(u.username)}">` +
    (u.picture ? `<img class="doc-user-result-avatar" src="${escapeAttr(u.picture)}" />` :
      `<div class="doc-user-result-avatar doc-user-result-avatar-fallback">${escapeHtml(u.username.charAt(0).toUpperCase())}</div>`) +
    `<span class="doc-user-result-name">${escapeHtml(u.username)}</span>` +
    `</div>`
  ).join('');
  return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
}

// ── Web source cards (Perplexity-style) ──

function _renderWebSources(sources) {
  if (!sources?.length) return '';
  return '<div class="nr-source-cards">' + sources.map(s => {
    const domain = _extractDomain(s.url);
    const favicon = 'https://www.google.com/s2/favicons?sz=16&domain=' + encodeURIComponent(domain);
    return '<a class="nr-source-card" data-source-n="' + s.n + '" href="' + escapeAttr(s.url) + '" title="' + escapeAttr(s.title) + '">' +
      '<span class="nr-source-badge">' + s.n + '</span>' +
      '<img class="nr-source-favicon" src="' + escapeAttr(favicon) + '" width="14" height="14" />' +
      '<span class="nr-source-title">' + escapeHtml(s.title.length > 40 ? s.title.slice(0, 37) + '...' : s.title) + '</span>' +
      '<span class="nr-source-domain">' + escapeHtml(domain) + '</span>' +
      '</a>';
  }).join('') + '</div>';
}

function _extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function _linkifyCitations(html, sources) {
  if (!sources?.length) return html;
  return html.replace(/\[(\d+)\]/g, (match, num) => {
    const n = parseInt(num);
    const src = sources.find(s => s.n === n);
    if (!src) return match;
    return '<a class="nr-citation" data-source-n="' + n + '" href="' + escapeAttr(src.url) + '" title="' + escapeAttr(src.title) + '">[' + n + ']</a>';
  });
}

function _renderFollowUps(followUps) {
  if (!followUps?.length) return '';
  return '<div class="nr-followup-strip">' + followUps.map(q =>
    '<button class="nr-followup-btn">' + escapeHtml(q) + '</button>'
  ).join('') + '</div>';
}

// ── Context pills ──

function renderCtxPills(sources, msg) {
  if (!sources?.length) return '';
  return '<div class="doc-msg-context-sources">' + sources.map(s => {
    const label = typeof s === 'string' ? s : s.label;
    let content = typeof s === 'object' ? s.content : null;
    if (label === 'tools' && msg?._toolsCalled?.length) {
      content = msg._toolsCalled.join('\n');
    }
    if (content) {
      const truncated = content.length > 4000 ? content.slice(0, 4000) + '\n\u2026truncated' : content;
      return '<details class="doc-ctx-details"><summary><span class="doc-ctx-pill">' +
        escapeHtml(label) + '</span></summary><pre class="doc-ctx-raw">' +
        escapeHtml(truncated) + '</pre></details>';
    }
    return '<span class="doc-ctx-pill">' + escapeHtml(label) + '</span>';
  }).join('') + '</div>';
}

// ── LaTeX rendering ──

function renderLatexInElement(element) {
  if (typeof katex === 'undefined') return;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  const nodesToProcess = [];
  let node;
  while (node = walker.nextNode()) {
    if (node.parentElement && !node.parentElement.closest('code, pre, .katex')) {
      nodesToProcess.push(node);
    }
  }

  nodesToProcess.forEach(textNode => {
    const text = textNode.textContent;
    const regex = /(\$\$[^$]+?\$\$|\$[^$]+?\$)/g;
    const matches = text.match(regex);
    if (!matches) return;

    const parts = text.split(regex);
    const fragment = document.createDocumentFragment();

    parts.forEach(part => {
      if (part.startsWith('$$') && part.endsWith('$$')) {
        const math = part.slice(2, -2);
        const span = document.createElement('span');
        try {
          katex.render(math, span, { displayMode: true, throwOnError: false });
          fragment.appendChild(span);
        } catch { fragment.appendChild(document.createTextNode(part)); }
      } else if (part.startsWith('$') && part.endsWith('$')) {
        const math = part.slice(1, -1);
        const span = document.createElement('span');
        try {
          katex.render(math, span, { displayMode: false, throwOnError: false });
          fragment.appendChild(span);
        } catch { fragment.appendChild(document.createTextNode(part)); }
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    });

    textNode.parentNode.replaceChild(fragment, textNode);
  });
}

// ── Attach click handlers to rendered messages ──

function attachMessageHandlers(container, opts) {
  opts = opts || {};

  // Search result clicks
  container.querySelectorAll('.doc-search-result[data-href]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const url = el.getAttribute('data-href');
      window.location.hash = '#browse';
      if (typeof browseNewTab === 'function') browseNewTab(url);
      else window.open(url, '_blank');
      if (opts.onNavigate) opts.onNavigate();
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });

  // Paper result clicks
  container.querySelectorAll('.doc-paper-result[data-href]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const url = el.getAttribute('data-href');
      window.location.hash = '#browse';
      if (typeof browseNewTab === 'function') browseNewTab(url);
      else window.open(url, '_blank');
      if (opts.onNavigate) opts.onNavigate();
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });

  // User result clicks
  container.querySelectorAll('.doc-user-result[data-username]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const username = el.getAttribute('data-username');
      window.location.hash = '#profile/' + encodeURIComponent(username);
      if (opts.onNavigate) opts.onNavigate();
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });

  // Note result clicks
  container.querySelectorAll('.doc-note-result[data-note-id]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (opts.onNavigate) opts.onNavigate();
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });

  // Source card clicks — open URL in new tab
  container.querySelectorAll('.nr-source-card').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const url = el.getAttribute('href');
      window.location.hash = '#browse';
      if (typeof browseNewTab === 'function') browseNewTab(url);
      else window.open(url, '_blank');
      if (opts.onNavigate) opts.onNavigate();
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });

  // Citation clicks — highlight corresponding source card
  container.querySelectorAll('.nr-citation').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const n = el.getAttribute('data-source-n');
      const card = container.querySelector('.nr-source-card[data-source-n="' + n + '"]');
      if (card) {
        card.classList.add('nr-source-highlight');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        setTimeout(() => card.classList.remove('nr-source-highlight'), 1500);
      }
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });

  // Follow-up button clicks
  container.querySelectorAll('.nr-followup-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (opts.onFollowUp) opts.onFollowUp(btn.textContent);
    });
    btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });

  // Copy button handlers
  container.querySelectorAll('.doc-msg-copy-btn').forEach(btn => {
    btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const msgEl = btn.closest('.doc-msg-ai');
      if (!msgEl) return;
      const text = msgEl.textContent.replace(/Copy message|Read aloud|Redo last message/g, '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = typeof icon === 'function' ? icon('check', { size: 12 }) : '\u2713';
        setTimeout(() => { btn.innerHTML = typeof icon === 'function' ? icon('copy', { size: 12 }) : '\u{1F4CB}'; }, 1000);
      }).catch(() => {});
    });
  });

  // Speak button handlers (delegates to panel TTS)
  container.querySelectorAll('.doc-msg-speak-btn').forEach(btn => {
    btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (opts.onSpeak) {
        opts.onSpeak(btn);
      }
    });
  });

  // Redo button handlers
  container.querySelectorAll('.doc-msg-redo-btn').forEach(btn => {
    btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (opts.onRedo) opts.onRedo();
    });
  });

  // Edit button handlers
  container.querySelectorAll('.doc-msg-edit-btn').forEach(btn => {
    btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const msgIdx = parseInt(btn.getAttribute('data-msg-idx'));
      if (opts.onEdit && !isNaN(msgIdx)) opts.onEdit(msgIdx);
    });
  });

  // Render LaTeX in AI messages
  container.querySelectorAll('.doc-msg-ai').forEach(msgEl => {
    renderLatexInElement(msgEl);
  });
}

// ── Chat stats (token count, timing, model) ──

function renderChatStats(messages, streamStart) {
  if (!messages.length) return '';
  const lastAi = [...messages].reverse().find(m => m.role === 'assistant' && !m._thinking);
  if (!lastAi) return '';
  const parts = [];
  if (lastAi._usage) {
    const u = lastAi._usage;
    const total = (u.prompt_tokens || 0) + (u.completion_tokens || 0);
    if (total) parts.push(total >= 1000 ? (total / 1000).toFixed(1) + 'k tokens' : total + ' tokens');
  } else if (lastAi.content) {
    const est = Math.round(lastAi.content.length / 4);
    if (est > 0) parts.push('~' + (est >= 1000 ? (est / 1000).toFixed(1) + 'k' : est) + ' tokens');
  }
  if (lastAi._usage?.duration_ms) {
    const ms = lastAi._usage.duration_ms;
    parts.push(ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms');
  } else if (lastAi._timings?.total) {
    parts.push(_formatDuration(lastAi._timings.total));
  } else if (streamStart) {
    const elapsed = Date.now() - streamStart;
    parts.push(elapsed >= 1000 ? (elapsed / 1000).toFixed(1) + 's' : elapsed + 'ms');
  }
  if (lastAi._usage?.model) parts.push(lastAi._usage.model);

  // Per-phase timing breakdown
  if (lastAi._timings) {
    const t = lastAi._timings;
    const phases = [];
    if (t.search) phases.push('search ' + _formatDuration(t.search));
    if (t.extract) phases.push('extract ' + _formatDuration(t.extract));
    if (t.inference) phases.push('generate ' + _formatDuration(t.inference));
    if (phases.length) {
      return parts.join(' \u00B7 ') +
        '<span class="nr-timing-breakdown">' + phases.join(' \u00B7 ') + '</span>';
    }
  }

  return parts.join(' \u00B7 ');
}

// ── Public API ──

const ChatRender = { renderMessageHTML, renderCtxPills, renderLatexInElement, attachMessageHandlers, renderChatStats };
window.ChatRender = ChatRender;
export default ChatRender;
