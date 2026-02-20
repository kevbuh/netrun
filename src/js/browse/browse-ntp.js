// browse-ntp.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
if (window.AetherUI) AetherUI.globals();

// ── NTP File Upload ──

export function handleNtpFileInput(input) {
  if (!input.files) return;
  for (const file of input.files) handleNtpFileUpload(file);
  input.value = '';
}

export async function handleNtpFileUpload(file) {
  let localPath = null;
  try { if (typeof electronAPI !== 'undefined' && electronAPI.getPathForFile) localPath = electronAPI.getPathForFile(file); } catch {}
  const entry = { name: file.name, content: '', file, localPath };
  _ntpUploadedFiles.push(entry);
  _renderNtpFileChips();

  // Extract text
  const lower = file.name.toLowerCase();
  const TEXT_EXTS = ['.txt','.md','.csv','.py','.js','.ts','.json','.html','.css','.xml',
    '.yaml','.yml','.toml','.ini','.cfg','.sh','.r','.sql','.java','.c','.cpp',
    '.h','.go','.rs','.rb','.php','.swift','.kt','.lua'];
  const ext = lower.substring(lower.lastIndexOf('.'));
  if (TEXT_EXTS.includes(ext)) {
    try {
      entry.content = await file.text();
    } catch (e) { /* ignore */ }
  } else if (lower.endsWith('.pdf')) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/api/extract-text', { method: 'POST', body: fd });
      if (resp.ok) {
        const data = await resp.json();
        entry.content = data.text || '';
      }
    } catch (e) { /* ignore */ }
  }
}

export function _renderNtpFileChips() {
  const container = document.getElementById('ntp-file-chips');
  if (!container) return;
  if (!_ntpUploadedFiles.length) { container.innerHTML = ''; return; }

  const fileSvg = '<svg class="ntp-file-card-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>';

  const chips = _ntpUploadedFiles.map(function(f, i) {
    const dotIdx = f.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? f.name.substring(dotIdx + 1).toUpperCase() : 'FILE';
    const baseName = dotIdx >= 0 ? f.name.substring(0, dotIdx) : f.name;

    const icon = RawHTML(fileSvg);
    const info = new View('div').className('ntp-file-card-info')._appendChildren([
      new View('span').className('ntp-file-card-name')._bindText(escapeHtml(baseName)),
      new View('span').className('ntp-file-card-type')._bindText(escapeHtml(ext))
    ]);
    const removeBtn = new View('span').className('ntp-file-card-remove')._bindText('\u00d7')
      .onTap(function(e) { e.stopPropagation(); removeNtpFile(i); });

    return new View('button').className('ntp-file-card').attr('title', escapeHtml(f.name))
      .onTap(function() { openNtpFile(i); })
      ._appendChildren([icon, info, removeBtn]);
  });

  AetherUI.mount(HStack(chips), container);
}

export function removeNtpFile(idx) {
  const f = _ntpUploadedFiles[idx];
  _ntpUploadedFiles.splice(idx, 1);
  _renderNtpFileChips();
}

export function openNtpFile(idx) {
  const f = _ntpUploadedFiles[idx];
  if (!f) return;
  if (f.localPath) {
    const url = 'file://' + f.localPath;
    browseNewTab(url);
    const win = _getCurrentWindow();
    if (win) {
      const tab = win.tabs.find(t => t.url === url);
      if (tab) { tab.title = f.name; _browseRenderTabs(); }
    }
  } else {
    openLocalPdf(f.file);
  }
}

export function openBrowseWithPaper(url, paper) {
  const view = document.getElementById('browse-view');
  const isAlreadyOpen = view && view.style.display !== 'none' && view.style.display !== '';

  if (!isAlreadyOpen) openBrowse();

  // Ensure _browseActiveWindow points to a valid window (use last window as fallback)
  if (!_getCurrentWindow() && _browseWindows.length) {
    browseSelectWindow(_browseWindows[_browseWindows.length - 1].id);
  }

  // Exit split mode when opening a paper from feed — want full-screen view
  if (_browseIsSplitMode()) {
    const win = _getCurrentWindow();
    if (win) { win.splitPanes = []; win.focusedPane = null; }
  }

  // Check for existing tab with this URL across all windows
  for (const w of _browseWindows) {
    const t = w.tabs.find(t => t.url === url);
    if (t) {
      if (w.id !== _browseActiveWindow) browseSelectWindow(w.id);
      browseSelectTab(t.id);
      return;
    }
  }
  const created = browseNewPaperTab(url, paper);
  if (!created) {
    browseNewTab(url);
    return;
  }
  // Close initial blank tab if one was just created by openBrowse
  const win = _getCurrentWindow();
  if (win && win.tabs.length > 1) {
    const blank = win.tabs.find(t => t.blank && t.id !== win.activeTab);
    if (blank) browseCloseTab(blank.id);
  }
}


export function _browseProxyUrl(url) {
  // Never proxy data: URLs
  if (url && url.startsWith('data:')) return url;
  // Serve file:// URLs through the local server
  if (url && url.startsWith('file://')) return '/api/local-file?path=' + encodeURIComponent(url.replace(/^file:\/\//, ''));
  // Always proxy in browser mode (not Electron) to enable link context menu and ad blocking
  if (!_browseIsElectron && url) {
    return '/api/browse-proxy?url=' + encodeURIComponent(url);
  }
  return url;
}

// Baseline: every iframe blocks camera, mic, geolocation by default.
// Only _browseSetFrameAllow can selectively open them per user choice.
export const _IFRAME_BLOCKED_POLICY = "camera 'none'; microphone 'none'; geolocation 'none'";

export function _browseCreateFrame(id, url) {
  const el = document.createElement(_browseIsElectron ? 'webview' : 'iframe');
  el.id = 'browse-frame-' + id;
  el.dataset.originalUrl = url;
  el.style.cssText = 'width:100%;height:100%;border:none;position:absolute;top:0;left:0;background:#fff;';
  if (!_browseIsElectron) {
    // Set sandbox + permissions policy BEFORE src so the browser enforces them
    // from the very start of navigation
    el.sandbox = 'allow-scripts allow-same-origin allow-popups allow-forms';
    el.referrerPolicy = 'no-referrer';
    el.allow = _IFRAME_BLOCKED_POLICY;
    _browseSetFrameAllow(el, url);
  }
  // Set src AFTER security attributes are in place
  const proxied = _browseProxyUrl(url);
  el.src = proxied;
  // Fetch blocked count after load
  if (proxied !== url) {
    el.addEventListener('load', () => _browseUpdateAdBlockBadge(url), { once: true });
  }
  // Inject right-click chat handler into iframe
  if (typeof _injectIframeChatHandler === 'function') {
    _injectIframeChatHandler(el);
  }
  return el;
}

export function _browseSetFrameAllow(el, url) {
  if (!url) return;
  let domain = '';
  try { domain = new URL(url).hostname.replace('www.', ''); } catch { return; }
  // If permission helpers haven't loaded yet, the baseline blocks everything — safe
  if (typeof _getEffectivePermissions !== 'function') return;
  const perms = _getEffectivePermissions(domain);

  // Build Permissions Policy: only explicitly user-confirmed permissions get opened.
  // Everything else stays blocked via 'none'.
  const policyParts = [];
  const permToAllow = { camera: 'camera', microphone: 'microphone', location: 'geolocation' };
  for (const [key, allowVal] of Object.entries(permToAllow)) {
    if (perms[key] === 'allow') {
      policyParts.push(allowVal);
    } else {
      policyParts.push(allowVal + " 'none'");
    }
  }
  el.allow = policyParts.join('; ');

  // Sandbox: popups allowed by default, blocked only if user chose "block"
  let sandboxFlags = 'allow-scripts allow-same-origin allow-forms';
  if (perms.popups !== 'block') sandboxFlags += ' allow-popups';
  el.sandbox = sandboxFlags;
}

export function _browseApplyPermissions() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.url || tab.blank) return;
  if (_browseIsElectron) return;
  // Destroy the old iframe completely and create a fresh one so the browser
  // builds a new browsing context with the updated Permissions-Policy.
  // Just changing the allow attribute + src is not reliably enforced.
  const container = document.getElementById('browse-content');
  if (!container) return;
  if (tab.el) tab.el.remove();
  tab.el = _browseCreateFrame(tab.id, tab.url);
  container.appendChild(tab.el);
  _browseBindFrame(tab);
}

window.handleNtpFileInput = handleNtpFileInput;
window.handleNtpFileUpload = handleNtpFileUpload;
window._renderNtpFileChips = _renderNtpFileChips;
window.removeNtpFile = removeNtpFile;
window.openNtpFile = openNtpFile;
window.openBrowseWithPaper = openBrowseWithPaper;
window._browseProxyUrl = _browseProxyUrl;
window._IFRAME_BLOCKED_POLICY = _IFRAME_BLOCKED_POLICY;
window._browseCreateFrame = _browseCreateFrame;
window._browseSetFrameAllow = _browseSetFrameAllow;
window._browseApplyPermissions = _browseApplyPermissions;
