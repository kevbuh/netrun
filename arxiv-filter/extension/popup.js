const HOSTS = ['http://localhost:8000', 'http://127.0.0.1:8000'];
let apiBase = null;

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
      if (resp.ok) { apiBase = host; return true; }
    } catch {}
  }
  return false;
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

saveBtn.addEventListener('click', async () => {
  if (!pageUrl || !apiBase) return;
  saveBtn.disabled = true;
  msgEl.textContent = '';
  msgEl.className = 'msg';
  try {
    const resp = await fetch(apiBase + '/api/saved-posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: pageUrl,
        title: pageTitle,
        favicon: pageFavicon,
        hostname: pageHostname
      })
    });
    const data = await resp.json();
    if (data.exists) {
      msgEl.textContent = 'Already in reading list';
      msgEl.className = 'msg ok';
    } else if (data.ok) {
      msgEl.textContent = 'Saved';
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
