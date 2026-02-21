// browse-ntp.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { _browseBindFrame } from '/js/browse/browse-downloads.js';
import { _browseIsSplitMode } from '/js/browse/browse-split-panes.js';
import { _browseRenderTabs } from '/js/browse/browse-island.js';
import { _browseUpdateAdBlockBadge, _getEffectivePermissions } from '/js/browse-urlbar.js';
import { _injectIframeChatHandler } from '/js/panel.js';
import { browseCloseTab, browseSelectTab } from '/js/browse/browse-passwords.js';
import { browseNewPaperTab, browseNewTab, browseSelectWindow, openBrowse, openLocalPdf } from '/js/browse/browse-windows.js';

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
  window._ntpUploadedFiles.push(entry);

  // Image files: read as base64 for vision
  const lower = file.name.toLowerCase();
  if (file.type && file.type.startsWith('image/')) {
    entry.isImage = true;
    try {
      const dataUrl = await new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      entry.base64 = dataUrl.split(',')[1] || '';
    } catch (e) { /* ignore */ }
    _renderNtpFileChips();
    return;
  }

  _renderNtpFileChips();

  // Extract text
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
  if (!window._ntpUploadedFiles.length) { container.innerHTML = ''; return; }

  const fileSvg = icon('document', {class: 'ntp-file-card-icon', strokeWidth: '1.5'});

  const chips = window._ntpUploadedFiles.map(function(f, i) {
    const dotIdx = f.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? f.name.substring(dotIdx + 1).toUpperCase() : 'FILE';
    const baseName = dotIdx >= 0 ? f.name.substring(0, dotIdx) : f.name;

    const removeBtn = new window.View('span').className('ntp-file-card-remove')._bindText('\u00d7')
      .onTap(function(e) { e.stopPropagation(); removeNtpFile(i); });

    if (f.isImage && f.base64) {
      // Image thumbnail
      const thumb = new window.View('img').className('ntp-file-card-thumb');
      thumb.el.src = 'data:image/png;base64,' + f.base64;
      return new window.View('button').className('ntp-file-card ntp-file-card-image').attr('title', escapeHtml(f.name))
        .add(thumb, removeBtn);
    }

    const iconEl = window.RawHTML(fileSvg);
    const info = new window.View('div').className('ntp-file-card-info').add(
      new window.View('span').className('ntp-file-card-name')._bindText(escapeHtml(baseName)),
      new window.View('span').className('ntp-file-card-type')._bindText(escapeHtml(ext))
    );

    return new window.View('button').className('ntp-file-card').attr('title', escapeHtml(f.name))
      .onTap(function() { openNtpFile(i); })
      .add(iconEl, info, removeBtn);
  });

  AetherUI.mount(window.HStack(chips), container);
}

export function removeNtpFile(idx) {
  const f = window._ntpUploadedFiles[idx];
  window._ntpUploadedFiles.splice(idx, 1);
  _renderNtpFileChips();
}

export function openNtpFile(idx) {
  const f = window._ntpUploadedFiles[idx];
  if (!f) return;
  if (f.localPath) {
    const url = 'file://' + f.localPath;
    browseNewTab(url);
    const win = window._getCurrentWindow();
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

  // Ensure window._browseActiveWindow points to a valid window (use last window as fallback)
  if (!window._getCurrentWindow() && window._browseWindows.length) {
    browseSelectWindow(window._browseWindows[window._browseWindows.length - 1].id);
  }

  // Exit split mode when opening a paper from feed — want full-screen view
  if (_browseIsSplitMode()) {
    const win = window._getCurrentWindow();
    if (win) { win.splitPanes = []; win.focusedPane = null; }
  }

  // Check for existing tab with this URL across all windows
  for (const w of window._browseWindows) {
    const t = w.tabs.find(t => t.url === url);
    if (t) {
      if (w.id !== window._browseActiveWindow) browseSelectWindow(w.id);
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
  const win = window._getCurrentWindow();
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
  if (!window._browseIsElectron && url) {
    return '/api/browse-proxy?url=' + encodeURIComponent(url);
  }
  return url;
}

// Baseline: every iframe blocks camera, mic, geolocation by default.
// Only _browseSetFrameAllow can selectively open them per user choice.
export const _IFRAME_BLOCKED_POLICY = "camera 'none'; microphone 'none'; geolocation 'none'";

export function _browseCreateFrame(id, url) {
  const el = document.createElement(window._browseIsElectron ? 'webview' : 'iframe');
  el.id = 'browse-frame-' + id;
  el.dataset.originalUrl = url;
  el.style.cssText = 'width:100%;height:100%;border:none;position:absolute;top:0;left:0;background:#fff;';
  if (!window._browseIsElectron) {
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
  if (window._browseIsElectron) return;
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

