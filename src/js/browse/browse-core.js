// browse-core.js — Core browse functionality (tabs, navigation)  
// Depends on: browse-state.js

// Check if URL is a heavy video site that should be lazy-loaded
function _isHeavyVideoSite(url) {
  if (!url) return false;
  const heavyDomains = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'netflix.com', 'dailymotion.com'];
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return heavyDomains.some(d => hostname.includes(d));
  } catch { return false; }
}

function _browseRestoreTabs() {
  try {
    // Try new multi-window format first (user-specific key)
    const raw = Settings.get(_getBrowseStorageKey('browseWindows'));
    if (raw) {
      const { windows, activeWindow, nextWindowId, nextTabId, nextGroupId, nextPaneId } = JSON.parse(raw);
      if (!windows || !windows.length) return false;
      _browseNextWindowId = nextWindowId || 1;
      _browseNextTabId = nextTabId || 1;
      _browseNextGroupId = nextGroupId || 1;
      _browseNextPaneId = nextPaneId || 1;
      const container = document.getElementById('browse-content');

      for (const savedWin of windows) {
        if (!savedWin.tabs.length) continue;
        const win = { id: savedWin.id, name: savedWin.name, tabs: [], activeTab: savedWin.activeTab, groups: savedWin.groups || [], splitPanes: savedWin.splitPanes || [], focusedPane: savedWin.focusedPane || null };
        for (const saved of savedWin.tabs) {
          if (saved.blank) {
            const tab = { id: saved.id, url: '', title: 'New Tab', favicon: '', el: null, blank: true, lastVisited: saved.lastVisited || 0, backStack: saved.backStack || [], forwardStack: saved.forwardStack || [] };
            if (saved.pinned) tab.pinned = true;
            if (saved.groupId != null) tab.groupId = saved.groupId;
            win.tabs.push(tab);
            continue;
          }
          // History page tab — restore as special tab (content renders on select)
          if (saved._historyPage) {
            const tab = { id: saved.id, url: 'netrun://history', title: 'History', favicon: '', el: null, blank: false, _historyPage: true, lastVisited: saved.lastVisited || 0, backStack: saved.backStack || [], forwardStack: saved.forwardStack || [] };
            if (saved.pinned) tab.pinned = true;
            if (saved.groupId != null) tab.groupId = saved.groupId;
            win.tabs.push(tab);
            continue;
          }
          // Help page tab
          if (saved._helpPage) {
            const tab = { id: saved.id, url: 'netrun://help', title: 'Help', favicon: '', el: null, blank: false, _helpPage: true, lastVisited: saved.lastVisited || 0, backStack: saved.backStack || [], forwardStack: saved.forwardStack || [] };
            if (saved.pinned) tab.pinned = true;
            if (saved.groupId != null) tab.groupId = saved.groupId;
            win.tabs.push(tab);
            continue;
          }
          // Paper tab — create container div (content renders lazily on select)
          if (saved.paper && saved.contentType) {
            const el = document.createElement('div');
            el.id = 'browse-paper-' + saved.id;
            el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:none;overflow:hidden;';
            container.appendChild(el);
            const tab = { id: saved.id, url: saved.url, title: saved.title || _browseTitleFromUrl(saved.url), favicon: _browseFaviconUrl(saved.url), el, blank: false,
                          paper: saved.paper, contentType: saved.contentType, arxivId: saved.arxivId || null, lastVisited: saved.lastVisited || 0, backStack: saved.backStack || [], forwardStack: saved.forwardStack || [] };
            if (saved.localPath) { tab.localPath = saved.localPath; tab.pdfUrl = '/api/local-file?path=' + encodeURIComponent(saved.localPath); }
            else if (saved.paper && saved.paper.localPath) { tab.localPath = saved.paper.localPath; tab.pdfUrl = '/api/local-file?path=' + encodeURIComponent(saved.paper.localPath); }
            else if (saved.paper && saved.paper.pdfUrl) { tab.pdfUrl = saved.paper.pdfUrl; }
            if (saved.pinned) tab.pinned = true;
            if (saved.groupId != null) tab.groupId = saved.groupId;
            win.tabs.push(tab);
            continue;
          }
          // Lazy load: don't create frame for heavy video sites in background tabs
          const isActiveTab = saved.id === savedWin.activeTab && savedWin.id === activeWindow;
          const shouldDefer = !isActiveTab && _isHeavyVideoSite(saved.url);

          let el = null;
          if (!shouldDefer) {
            el = _browseCreateFrame(saved.id, saved.url);
            el.style.display = 'none';
            container.appendChild(el);
          }
          const tab = { id: saved.id, url: saved.url, title: saved.title || _browseTitleFromUrl(saved.url), favicon: _browseFaviconUrl(saved.url), el, blank: false, deferred: shouldDefer, lastVisited: saved.lastVisited || 0, backStack: saved.backStack || [], forwardStack: saved.forwardStack || [] };
          if (saved.pinned) tab.pinned = true;
          if (saved.groupId != null) tab.groupId = saved.groupId;
          win.tabs.push(tab);
          if (el) _browseBindFrame(tab);
        }
        _browseWindows.push(win);
      }
      if (!_browseWindows.length) return false;
      _browseActiveWindow = _browseWindows.find(w => w.id === activeWindow) ? activeWindow : _browseWindows[0].id;
      const win = _getCurrentWindow();
      if (win && win.tabs.length) {
        const target = win.tabs.find(t => t.id === win.activeTab) ? win.activeTab : win.tabs[0].id;
        browseSelectTab(target);
        // Restore split layout if saved
        if (win.splitPanes && win.splitPanes.length >= 2) {
          _browseRebuildSplitLayout();
        }
      }
      return true;
    }

    return false;
  } catch (e) { console.error('[browse] restore tabs failed:', e); return false; }
}
