// browse-download-mgr.js — Download state, IPC listeners, download UI
// Extracted from browse-downloads.js
import Settings from '/js/core/core-settings.js';
import { apiPost } from '/js/api.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { islandUpdate, islandRemove } from '/js/core/core-ui.js';

// ── Download Manager ──
export const DOWNLOAD_RETENTION_MS = 60 * 60 * 1000; // 1 hour

export let _browseDownloads = []; // { id, filename, url, state: 'progressing'|'completed'|'cancelled', receivedBytes, totalBytes, startTime }
export let _browseDownloadIdCounter = 0;
export let _browseDownloadsLastSeenCount = 0;

export function _loadBrowseDownloads() {
  try {
    const saved = Settings.getJSON('browseDownloads', []);
    const oneHourAgo = Date.now() - DOWNLOAD_RETENTION_MS;
    _browseDownloads = saved.filter(d => d.startTime > oneHourAgo);
    // Find max ID
    _browseDownloads.forEach(d => {
      const num = parseInt(d.id.replace('dl-', ''));
      if (num > _browseDownloadIdCounter) _browseDownloadIdCounter = num;
    });
    // Load last seen count
    const lastSeen = parseInt(Settings.get('browseDownloadsLastSeen') || '0');
    _browseDownloadsLastSeenCount = Math.min(lastSeen, _browseDownloads.length);
  } catch (e) {
    _browseDownloads = [];
  }
}

export function _saveBrowseDownloads() {
  try {
    const oneHourAgo = Date.now() - DOWNLOAD_RETENTION_MS;
    const toSave = _browseDownloads.filter(d => d.startTime > oneHourAgo);
    Settings.setJSON('browseDownloads', toSave);
    // Save last seen count
    Settings.set('browseDownloadsLastSeen', _browseDownloadsLastSeenCount.toString());
  } catch (e) {}
}

// Initialize downloads on load
_loadBrowseDownloads();
// Update UI after a short delay (DOM may not be ready)
setTimeout(() => {
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
}, 100);

export function _formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export function _browseUpdateDownloadBadge() {
  const btn = document.getElementById('browse-downloads-btn');
  const badge = document.getElementById('browse-download-badge');
  const ring = document.getElementById('browse-download-progress-ring');

  const count = _browseDownloads.length;
  const newDownloads = count - _browseDownloadsLastSeenCount;

  // Show/hide download button
  if (btn) btn.style.display = count > 0 ? 'block' : 'none';

  // Show badge only for new downloads
  if (badge) {
    if (newDownloads > 0) {
      badge.textContent = newDownloads > 99 ? '99+' : newDownloads;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Show progress ring only for new active downloads
  if (ring) {
    const hasNewActive = newDownloads > 0 && _browseDownloads.some(d => d.state === 'progressing');
    ring.style.display = hasNewActive ? 'block' : 'none';
  }

  // Dynamic Island: show download progress (persists until dismissed)
  if (typeof islandUpdate === 'function') {
    const active = _browseDownloads.filter(d => d.state === 'progressing');
    const completed = _browseDownloads.filter(d => d.state === 'completed');
    const total = _browseDownloads.length;
    if (total > 0) {
      const items = _browseDownloads.map(d => ({
        id: d.id,
        filename: d.filename || 'Download',
        state: d.state,
        pct: d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0,
        size: d.totalBytes > 0 ? _formatBytes(d.totalBytes) : '',
        received: _formatBytes(d.receivedBytes || 0)
      }));
      const dlData = { type: 'download', items: items, dismiss: function() { islandRemove('download'); } };
      if (active.length > 0) {
        const dl = active[0];
        const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
        const name = dl.filename || 'Download';
        dlData.label = active.length > 1 ? active.length + ' downloading' : pct + '%';
        dlData.detail = active.length > 1 ? active.length + ' downloading · ' + completed.length + ' done' : name + ' · ' + pct + '%';
        dlData.progress = pct;
      } else {
        dlData.label = total === 1 ? '1 download' : total + ' downloads';
        dlData.detail = total === 1 ? completed[0].filename : total + ' downloads complete';
      }
      islandUpdate('download', dlData);
    } else {
      islandRemove('download');
    }
  }
}

export function _browseRenderDownloads() {
  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (!dropdown) return;

  if (_browseDownloads.length === 0) {
    AetherUI.mount(
      new window.View('div').className('browse-downloads-empty')._bindText('No downloads'),
      dropdown
    );
    return;
  }

  const completedSvg = icon('fileCheckmark', {size: 16});
  const fileSvg = icon('filePlain', {size: 16});
  const folderSvg = icon('folder', {size: 14});
  const closeSvg = icon('close', {size: 14});

  const clearBtn = new window.View('button').className('browse-downloads-clear')._bindText('Clear all')
    .onTap(function(e) { e.stopPropagation(); clearBrowseDownloads(); });
  const header = window.HStack([
    new window.View('span').className('browse-downloads-title')._bindText('Downloads'),
    clearBtn
  ]).className('browse-downloads-header');

  const items = [header];
  for (let i = 0; i < _browseDownloads.length; i++) {
    (function(dl) {
      const iconEl = window.RawHTML(dl.state === 'completed' ? completedSvg : fileSvg).className('browse-download-item-icon');

      const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
      const size = dl.totalBytes > 0 ? _formatBytes(dl.totalBytes) : '';
      const status = dl.state === 'completed' ? 'Completed' + (size ? ' \u00b7 ' + size : '')
        : dl.state === 'cancelled' ? 'Cancelled'
        : pct + '% \u00b7 ' + _formatBytes(dl.receivedBytes) + (dl.totalBytes > 0 ? ' / ' + size : '');

      const infoChildren = [
        new window.View('div').className('browse-download-item-name')._bindText(escapeHtml(dl.filename)),
        new window.View('div').className('browse-download-item-status')._bindText(status)
      ];
      if (dl.state === 'progressing') {
        const bar = new window.View('div').className('browse-download-item-progress-bar').styles({ width: pct + '%' });
        infoChildren.push(new window.View('div').className('browse-download-item-progress').add(bar));
      }
      const info = window.VStack(infoChildren).className('browse-download-item-info');

      const actionChildren = [];
      if (dl.state === 'completed') {
        actionChildren.push(
          new window.View('button').className('nr-btn nr-btn-ghost nr-btn-sm').attr('title', 'Show in folder')
            .onTap(function(e) { e.stopPropagation(); showDownloadInFolder(dl.id); })
            .add(window.RawHTML(folderSvg))
        );
      }
      actionChildren.push(
        new window.View('button').className('nr-btn nr-btn-ghost nr-btn-sm').attr('title', 'Remove')
          .onTap(function(e) { e.stopPropagation(); removeBrowseDownload(dl.id); })
          .add(window.RawHTML(closeSvg))
      );
      const actions = window.HStack(actionChildren).className('browse-download-item-actions');

      const row = window.HStack([iconEl, info, actions]).className('browse-download-item')
        .onTap(function() { openDownloadFile(dl.id); });
      items.push(row);
    })(_browseDownloads[i]);
  }

  AetherUI.mount(window.VStack(items), dropdown);
  dropdown.onclick = function(e) { e.stopPropagation(); };
}

export function _closeBrowseDownloadsDropdown() {
  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  document.removeEventListener('click', _closeBrowseDownloadsOnClick);
  window.removeEventListener('blur', _closeBrowseDownloadsOnBlur);
}

export function toggleBrowseDownloads(event) {
  if (event) event.stopPropagation();

  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (!dropdown) return;

  if (dropdown.style.display === 'none') {
    _browseRenderDownloads();
    dropdown.style.display = 'block';

    // Mark all downloads as seen
    _browseDownloadsLastSeenCount = _browseDownloads.length;
    _saveBrowseDownloads();

    const badge = document.getElementById('browse-download-badge');
    if (badge) badge.style.display = 'none';

    // Add close listeners
    requestAnimationFrame(() => {
      document.addEventListener('click', _closeBrowseDownloadsOnClick);
    });
    window.addEventListener('blur', _closeBrowseDownloadsOnBlur);
  } else {
    _closeBrowseDownloadsDropdown();
  }
}

export function _closeBrowseDownloadsOnClick(e) {
  const btn = document.getElementById('browse-downloads-btn');
  if (btn && !btn.contains(e.target)) {
    _closeBrowseDownloadsDropdown();
  }
}

export function _closeBrowseDownloadsOnBlur() {
  _closeBrowseDownloadsDropdown();
}

export function clearBrowseDownloads() {
  _browseDownloads = [];
  _browseDownloadsLastSeenCount = 0;
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
  _saveBrowseDownloads();
}

export function removeBrowseDownload(id) {
  _browseDownloads = _browseDownloads.filter(d => d.id !== id);
  // Adjust seen count if we're below it
  if (_browseDownloads.length < _browseDownloadsLastSeenCount) {
    _browseDownloadsLastSeenCount = _browseDownloads.length;
  }
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
  _saveBrowseDownloads();
}

export function openDownloadFile(id) {
  const dl = _browseDownloads.find(d => d.id === id);
  if (dl && dl.state === 'completed' && dl.savePath && window.electronAPI) {
    window.electronAPI.openPath(dl.savePath);
  }
}

export function showDownloadInFolder(id) {
  const dl = _browseDownloads.find(d => d.id === id);
  if (!dl) return;
  if (dl.savePath && window.electronAPI) {
    window.electronAPI.showItemInFolder(dl.savePath);
  } else if (dl.filename) {
    apiPost('/api/reveal-in-finder', { filename: dl.filename }).catch(() => {});
  }
}

// Initialize download event listeners from Electron main process
export let _downloadsInitialized = false;

export function _initBrowseDownloads() {
  if (!window.electronAPI) return;
  if (_downloadsInitialized) return;
  _downloadsInitialized = true;

  // Listen for download-started event
  if (window.electronAPI.onDownloadStarted) {
    window.electronAPI.onDownloadStarted((event, data) => {
      const dl = {
        id: data.id,
        filename: data.filename || 'download',
        url: data.url || '',
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: data.totalBytes || 0,
        startTime: Date.now(),
        savePath: data.savePath || ''
      };
      _browseDownloads.unshift(dl);
      _browseUpdateDownloadBadge();
      _browseRenderDownloads();
      _saveBrowseDownloads();
      if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#22c55e');
    });
  }

  // Listen for download-progress event
  if (window.electronAPI.onDownloadProgress) {
    window.electronAPI.onDownloadProgress((event, data) => {
      const dl = _browseDownloads.find(d => d.id === data.id);
      if (dl) {
        dl.receivedBytes = data.receivedBytes || 0;
        dl.totalBytes = data.totalBytes || dl.totalBytes;
        _browseUpdateDownloadBadge();
        _browseRenderDownloads();
      }
    });
  }

  // Listen for download-completed event
  if (window.electronAPI.onDownloadCompleted) {
    window.electronAPI.onDownloadCompleted((event, data) => {
      const dl = _browseDownloads.find(d => d.id === data.id);
      if (dl) {
        dl.state = data.state || 'completed';
        dl.savePath = data.savePath || dl.savePath;
        dl.receivedBytes = dl.totalBytes;
        _browseUpdateDownloadBadge();
        _browseRenderDownloads();
      }
    });
  }
}

// Initialize downloads on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { _initBrowseDownloads(); });
} else {
  _initBrowseDownloads();
}

// ── Action registry ──
registerActions({
  toggleBrowseDownloads: (e) => toggleBrowseDownloads(e),
});
window.toggleBrowseDownloads = toggleBrowseDownloads;
