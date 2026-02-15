// ── arXiv category labels ──
const ARXIV_CAT_NAMES = {
  'cs.AI':'Artificial Intelligence','cs.AR':'Hardware Architecture','cs.CC':'Computational Complexity',
  'cs.CE':'Computational Engineering','cs.CG':'Computational Geometry','cs.CL':'Computation and Language',
  'cs.CR':'Cryptography and Security','cs.CV':'Computer Vision and Pattern Recognition',
  'cs.CY':'Computers and Society','cs.DB':'Databases','cs.DC':'Distributed Computing',
  'cs.DL':'Digital Libraries','cs.DM':'Discrete Mathematics','cs.DS':'Data Structures and Algorithms',
  'cs.ET':'Emerging Technologies','cs.FL':'Formal Languages and Automata Theory',
  'cs.GL':'General Literature','cs.GR':'Graphics','cs.GT':'Computer Science and Game Theory',
  'cs.HC':'Human-Computer Interaction','cs.IR':'Information Retrieval','cs.IT':'Information Theory',
  'cs.LG':'Machine Learning','cs.LO':'Logic in Computer Science','cs.MA':'Multiagent Systems',
  'cs.MM':'Multimedia','cs.MS':'Mathematical Software','cs.NA':'Numerical Analysis',
  'cs.NE':'Neural and Evolutionary Computing','cs.NI':'Networking and Internet Architecture',
  'cs.OH':'Other Computer Science','cs.OS':'Operating Systems','cs.PF':'Performance',
  'cs.PL':'Programming Languages','cs.RO':'Robotics','cs.SC':'Symbolic Computation',
  'cs.SD':'Sound','cs.SE':'Software Engineering','cs.SI':'Social and Information Networks',
  'cs.SY':'Systems and Control',
  'stat.ML':'Machine Learning (Statistics)','stat.TH':'Statistics Theory',
  'stat.ME':'Methodology','stat.AP':'Applications','stat.CO':'Computation',
  'math.OC':'Optimization and Control','math.ST':'Statistics Theory',
  'eess.IV':'Image and Video Processing','eess.AS':'Audio and Speech Processing',
  'eess.SP':'Signal Processing','eess.SY':'Systems and Control',
  'q-bio.QM':'Quantitative Methods','q-bio.NC':'Neurons and Cognition',
  'physics.comp-ph':'Computational Physics','cond-mat.dis-nn':'Disordered Systems and Neural Networks',
};

// ── Reader View (saved content) ──
function _insertIframeWithOverlay(container, url) {
  const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);
  if (isElectron) {
    // Use webview in Electron — raw iframes are blocked by most sites' X-Frame-Options / CSP
    const wv = document.createElement('webview');
    wv.src = url;
    wv.style.cssText = 'width:100%;height:100%;border:none;';
    container.innerHTML = '';
    container.appendChild(wv);
    if (typeof _injectIframeChatHandler === 'function') _injectIframeChatHandler(wv);
  } else {
    const proxied = typeof _browseProxyUrl === 'function' ? _browseProxyUrl(url) : url;
    container.innerHTML = `<iframe src="${proxied}" style="width:100%;height:100%;border:none;background:#fff" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerpolicy="no-referrer"></iframe>`;
    const iframe = container.querySelector('iframe');
    if (iframe) _injectIframeChatHandler(iframe);
  }
}

function _tryRenderSavedContent(container, paper) {
  const url = paper.link;
  apiGet(`/api/saved-content?url=${encodeURIComponent(url)}`)
    .then(data => {
      if (data && data.text && data.text.length > 50) {
        _renderReaderView(container, data);
      } else {
        _insertIframeWithOverlay(container, paper.link);
      }
    })
    .catch(() => {
      _insertIframeWithOverlay(container, paper.link);
    });
}

function _isTwitterUrl(url) {
  try { const h = new URL(url).hostname; return h === 'x.com' || h === 'twitter.com' || h.endsWith('.x.com') || h.endsWith('.twitter.com'); } catch { return false; }
}

function _parseTwitterAuthor(title) {
  // Title format: "Name on X: \"text\"" or "Name (@handle) on X: ..."
  const m = title.match(/^(.+?)\s+on\s+X:/i) || title.match(/^(.+?)\s+on\s+Twitter:/i);
  if (!m) return { name: '', handle: '' };
  const raw = m[1].trim();
  const hm = raw.match(/^(.+?)\s*\((@\w+)\)$/);
  if (hm) return { name: hm[1].trim(), handle: hm[2] };
  return { name: raw, handle: '' };
}

function _renderTwitterThread(container, data) {
  const div = document.createElement('div');
  div.className = 'reader-view reader-view--twitter';

  const author = _parseTwitterAuthor(data.title || '');

  // Author header
  const header = document.createElement('div');
  header.className = 'tweet-thread-header';
  header.innerHTML = `
    <div class="tweet-avatar">${(author.name || '?')[0].toUpperCase()}</div>
    <div>
      <div class="tweet-author-name">${escapeHtml(author.name || 'Thread')}</div>
      ${author.handle ? `<div class="tweet-author-handle">${escapeHtml(author.handle)}</div>` : ''}
    </div>
  `;
  div.appendChild(header);

  // Source link
  if (data.url) {
    const link = document.createElement('a');
    link.href = data.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'reader-view-source';
    link.textContent = 'View on X';
    div.appendChild(link);
  }

  // Parse text into tweets — split on double newlines, then group short consecutive paragraphs as one tweet
  const rawParas = (data.text || '').split('\n\n').map(s => s.trim()).filter(Boolean);
  // Filter out noise lines (metadata, follow buttons, timestamps, etc.)
  const noise = /^(follow|click to follow|©|terms of service|privacy policy|cookie policy|accessibility|ads info|more|post|repost|reply|like|bookmark|share|\d+$|\d+:\d+|show more|sign up|log in)/i;
  const paras = rawParas.filter(p => !noise.test(p) && p.length > 2);

  // Group into tweets: each paragraph that's >=80 chars is its own tweet, shorter ones merge with next
  const tweets = [];
  let buf = [];
  for (const p of paras) {
    buf.push(p);
    if (p.length >= 80 || p.endsWith('.') || p.endsWith('!') || p.endsWith('?') || p.endsWith(':')) {
      tweets.push(buf.join('\n'));
      buf = [];
    }
  }
  if (buf.length) tweets.push(buf.join('\n'));

  const thread = document.createElement('div');
  thread.className = 'tweet-thread';
  tweets.forEach((text, i) => {
    const card = document.createElement('div');
    card.className = 'nr-card';
    // Thread line
    if (i < tweets.length - 1) card.classList.add('nr-card--continued');
    const counter = document.createElement('div');
    counter.className = 'tweet-counter';
    counter.textContent = `${i + 1}/${tweets.length}`;
    const body = document.createElement('div');
    body.className = 'tweet-body';
    text.split('\n').forEach(line => {
      const p = document.createElement('p');
      p.textContent = line;
      body.appendChild(p);
    });
    card.appendChild(counter);
    card.appendChild(body);
    thread.appendChild(card);
  });
  div.appendChild(thread);

  container.innerHTML = '';
  container.appendChild(div);
}

function _renderReaderView(container, data) {
  if (_isTwitterUrl(data.url || '')) {
    return _renderTwitterThread(container, data);
  }
  const div = document.createElement('div');
  div.className = 'reader-view';
  const h1 = document.createElement('h1');
  h1.textContent = data.title || '';
  div.appendChild(h1);
  if (data.url) {
    const link = document.createElement('a');
    link.href = data.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'reader-view-source';
    link.textContent = data.url;
    div.appendChild(link);
  }
  const body = document.createElement('div');
  body.className = 'reader-view-body';
  (data.text || '').split('\n\n').forEach(para => {
    if (!para.trim()) return;
    const p = document.createElement('p');
    p.textContent = para.trim();
    body.appendChild(p);
  });
  div.appendChild(body);
  container.innerHTML = '';
  container.appendChild(div);
}

// ── Topbar overflow (three-dots menu) ──
const _topbarOverflowRO = null;


function _closeTopbarOverflow() {
  const menu = document.getElementById('topbar-overflow-menu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('click', _topbarOverflowOutside);
}

function _topbarOverflowOutside(e) {
  const wrap = document.getElementById('topbar-overflow-wrap');
  if (wrap && !wrap.contains(e.target)) _closeTopbarOverflow();
}

// ── Paper Viewer (shared) ──
const paperViewOrigin = 'arxiv';

let _currentPaperViewPaper = null;
const _paperOriginExpId = null;
const _paperInsightsLoaded = false;
function togglePaperViewBookmark() {
  if (!_currentPaperViewPaper) return;
  toggleSavePost(_currentPaperViewPaper);
  const saved = isPostSaved(_currentPaperViewPaper.link);
  // Update browse bar bookmark button
  const browseBtn = document.getElementById('browse-paper-bookmark-btn');
  if (browseBtn) {
    browseBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center ' + (saved ? 'text-accent' : 'text-dimmer hover:text-primary');
    browseBtn.title = saved ? 'Saved' : 'Save';
    browseBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="' + (saved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.5"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
  }
}

function toggleBrowseSidebar() {
  togglePanel();
}

// ── Paper sidebar moved to paper-sidebar.js ──

// ── Document chat moved to chat-threads.js ──

// ── Panel system moved to panel.js ──


// ── Mobile Paper Sidebar ──


