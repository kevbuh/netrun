const HOSTS = ['http://localhost:8000', 'http://127.0.0.1:8000'];
let apiBase = null;
let authToken = null;

const titleEl = document.getElementById('page-title');
const urlEl = document.getElementById('page-url');
const faviconEl = document.getElementById('favicon');
const siteNameEl = document.getElementById('site-name');
const saveBtn = document.getElementById('save-btn');
const msgEl = document.getElementById('msg');

let pageUrl = '';
let pageTitle = '';
let pageFavicon = '';
let pageHostname = '';

async function findServer() {
  for (const host of HOSTS) {
    try {
      const resp = await fetch(host + '/api/settings', { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        apiBase = host;
        // Try to get auth token from an open Alpha tab
        try {
          const tabs = await chrome.tabs.query({ url: host + '/*' });
          if (tabs.length) {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              func: () => localStorage.getItem('authToken')
            });
            if (results && results[0] && results[0].result) {
              authToken = results[0].result;
            }
          }
        } catch {}
        return true;
      }
    } catch {}
  }
  return false;
}

function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (authToken) h['Authorization'] = 'Bearer ' + authToken;
  return h;
}

chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  if (tab) {
    pageUrl = tab.url || '';
    pageTitle = tab.title || pageUrl;
    pageFavicon = tab.favIconUrl || '';
    titleEl.textContent = pageTitle;
    urlEl.textContent = pageUrl;
    urlEl.title = pageUrl;
    try {
      const u = new URL(pageUrl);
      pageHostname = u.hostname.replace(/^www\./, '');
      siteNameEl.textContent = pageHostname;
      faviconEl.src = pageFavicon || (u.origin + '/favicon.ico');
    } catch {
      siteNameEl.textContent = pageUrl;
    }
    faviconEl.onerror = () => { faviconEl.style.display = 'none'; };
  }

  const found = await findServer();
  if (!found) {
    msgEl.textContent = 'Server not running at localhost:8000';
    msgEl.className = 'msg err';
    saveBtn.disabled = true;
  }
});

function extractArticleText() {
  const SKIP = new Set(['nav','footer','aside','script','style','noscript','iframe','svg','button','input','select','textarea','form']);
  const BLOCK = new Set(['p','div','section','article','main','blockquote','h1','h2','h3','h4','h5','h6','li','tr','dt','dd','figcaption','pre','header']);

  // Find content root
  let root = document.querySelector('article')
    || document.querySelector('main')
    || document.querySelector('[role="main"]');
  if (!root) {
    let best = null, bestLen = 0;
    document.querySelectorAll('div').forEach(d => {
      const len = (d.innerText || '').length;
      if (len > bestLen) { bestLen = len; best = d; }
    });
    root = best;
  }
  if (!root) root = document.body;

  const parts = [];
  function walk(node) {
    if (node.nodeType === 3) {
      const t = node.textContent;
      if (t.trim()) parts.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (SKIP.has(tag)) return;
    const role = node.getAttribute('role') || '';
    if (['navigation','banner','complementary'].includes(role)) return;
    if (node.getAttribute('aria-hidden') === 'true') return;
    if (node.classList && (node.classList.contains('ad') || node.classList.contains('ads') || node.classList.contains('advertisement'))) return;

    const isBlock = BLOCK.has(tag);
    if (isBlock) parts.push('\n\n');
    if (tag === 'br') { parts.push('\n'); return; }
    for (const child of node.childNodes) walk(child);
    if (isBlock) parts.push('\n\n');
  }
  walk(root);

  // Clean up: collapse whitespace within lines, normalize paragraph breaks
  return parts.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/ \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

saveBtn.addEventListener('click', async () => {
  if (!pageUrl || !apiBase) return;
  saveBtn.disabled = true;
  msgEl.textContent = 'Extracting...';
  msgEl.className = 'msg';

  // Extract article text from the active tab
  let extractedText = '';
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: extractArticleText
      });
      if (results && results[0] && results[0].result) {
        extractedText = results[0].result;
      }
    }
  } catch {}

  msgEl.textContent = 'Saving...';
  try {
    // Save content if we extracted text
    if (extractedText.length > 50) {
      await fetch(apiBase + '/api/saved-content', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          url: pageUrl,
          title: pageTitle,
          text: extractedText,
          savedAt: Date.now()
        })
      });
    }

    // Save to reading list
    const resp = await fetch(apiBase + '/api/saved-posts', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        url: pageUrl,
        title: pageTitle,
        favicon: pageFavicon,
        hostname: pageHostname
      })
    });
    const data = await resp.json();
    if (data.exists) {
      msgEl.textContent = extractedText.length > 50 ? 'Updated content' : 'Already in reading list';
      msgEl.className = 'msg ok';
    } else if (data.ok) {
      msgEl.textContent = extractedText.length > 50 ? 'Saved with reader view' : 'Saved';
      msgEl.className = 'msg ok';
    } else {
      msgEl.textContent = data.error || 'Failed';
      msgEl.className = 'msg err';
    }
  } catch {
    msgEl.textContent = 'Could not reach server';
    msgEl.className = 'msg err';
  }
  saveBtn.disabled = false;
});
