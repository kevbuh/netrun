// browse-core.js — Core browse functionality (tabs, navigation)  
// Depends on: browse-state.js

import Settings from '/js/core/core-settings.js';
import { _browseBindFrame } from '/js/browse/browse-downloads.js';
import { _browseCreateFrame } from '/js/browse/browse-ntp.js';
import { _browseFaviconUrl, _browseTitleFromUrl } from '/js/browse/browse-island.js';
import { _browseRebuildSplitLayout } from '/js/browse/browse-split-panes.js';
import { browseSelectTab } from '/js/browse/browse-passwords.js';
import { openChatPage } from '/js/chat-view.js';
export function _browseRestoreTabs() {
  try {
    // Try new multi-window format first (user-specific key)
    const raw = Settings.get(window._getBrowseStorageKey('browseWindows'));
    if (raw) {
      const { windows, activeWindow, nextWindowId, nextTabId, nextGroupId, nextPaneId } = JSON.parse(raw);
      if (!windows || !windows.length) return false;
      window._browseNextWindowId = nextWindowId || 1;
      window._browseNextTabId = nextTabId || 1;
      window._browseNextGroupId = nextGroupId || 1;
      window._browseNextPaneId = nextPaneId || 1;
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
          // Chat tab — restore as special tab (content renders on select via openChatPage)
          if (saved._chatPage) {
            const tab = { id: saved.id, url: saved.url || ('chat://' + (saved._chatThreadId || '')), title: saved.title || 'Chat', favicon: '', el: null, blank: false, _chatPage: true, _chatThreadId: saved._chatThreadId || null, lastVisited: saved.lastVisited || 0, backStack: saved.backStack || [], forwardStack: saved.forwardStack || [] };
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
          // Lazy load: only create frame for the active tab, defer all others
          const isActiveTab = saved.id === savedWin.activeTab && savedWin.id === activeWindow;
          const shouldDefer = !isActiveTab;

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
        window._browseWindows.push(win);
      }
      if (!window._browseWindows.length) return false;
      window._browseActiveWindow = window._browseWindows.find(w => w.id === activeWindow) ? activeWindow : window._browseWindows[0].id;
      const win = window._getCurrentWindow();
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

