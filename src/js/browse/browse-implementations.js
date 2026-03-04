// browse-implementations.js — Implementations list view (netrun://implementations)
// Lists all implementation sessions across all papers
import { icon } from '/js/core/icons.js';
import { toast } from '/js/core/core-utils.js';
import { _browseRenderTabs } from '/js/toolbar/toolbar-tabs.js';
import { _browseUpdateNewTabPage, browseSelectTab } from '/js/browse/browse-passwords.js';
import { _browseSetUrlDisplay } from '/js/browse-urlbar.js';
import { openBrowse, browseNewTab } from '/js/browse/browse-windows.js';
import { browseNavigate } from '/js/toolbar/toolbar-url.js';

export function _relativeAge(ts) {
  const age = Date.now() / 1000 - ts;
  if (age < 60) return 'just now';
  if (age < 3600) return Math.floor(age / 60) + 'm ago';
  if (age < 86400) return Math.floor(age / 3600) + 'h ago';
  const days = Math.floor(age / 86400);
  if (days < 30) return days + 'd ago';
  return Math.floor(days / 30) + 'mo ago';
}

export function openImplementations() {
  openBrowse();

  // Reuse existing implementations tab
  for (let i = 0; i < window._browseWindows.length; i++) {
    const w = window._browseWindows[i];
    const existing = w.tabs.find(function(t) { return t._implementationsPage; });
    if (existing) {
      if (w.id !== window._browseActiveWindow) {
        if (typeof window.browseSelectWindow === 'function') window.browseSelectWindow(w.id);
      }
      browseSelectTab(existing.id);
      return;
    }
  }

  const win = window._browseWindows.find(function(w) { return w.id === window._browseActiveWindow; });
  if (!win) return;
  const tab = win.tabs.find(function(t) { return t.id === win.activeTab; });
  if (!tab) return;

  // Push current URL onto back stack so browser back goes to previous page
  if (tab.url && !tab.blank) {
    if (!tab.backStack) tab.backStack = [];
    tab.backStack.push(tab.url);
    tab.forwardStack = [];
  }

  tab.blank = false;
  tab.url = 'netrun://implementations';
  tab.title = 'Implementations';
  tab.favicon = '';
  tab._implementationsPage = true;

  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const elView = new View('div').id('browse-implementations-' + tab.id).className('nr-impl-layout')
    .cssText('position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;');
  AetherUI.append(elView, container);
  tab.el = elView.el;

  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();
  window._browseSaveTabs();

  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, 'netrun://implementations');

  if (typeof window._updateIslandNavButtons === 'function') window._updateIslandNavButtons();

  _renderImplementationsView(tab.el);
}

function _renderImplementationsView(container) {
  const searchState = State('');
  const searchBinding = Binding(searchState, function(v) { return v; }, function(v) { return v; });

  const backBtn = new View('button').className('nr-impl-card-action')
    .add(RawHTML(icon('chevronLeft', { size: 14 })))
    .attr('title', 'Back to netrun://')
    .onTap(function() { browseNavigate('netrun://'); });

  const header = HStack([
    backBtn,
    Text('Implementations').className('nr-impl-title'),
    SearchField(searchBinding, 'Search...').className('nr-impl-search')
  ]).className('nr-impl-header');

  const grid = new View('div').className('nr-impl-grid');
  const emptyState = EmptyState({ title: 'No implementations yet', description: 'Start an implementation from the Code tab in Nerd Mode' });

  const wrap = VStack([header, grid, emptyState]);

  AetherUI.mount(wrap, container);

  function loadSessions() {
    if (!window.electronAPI || !window.electronAPI.implList) {
      grid.el.style.display = 'none';
      emptyState.el.style.display = '';
      return;
    }
    electronAPI.implList().then(function(sessions) {
      if (!sessions || sessions.error || !sessions.length) {
        grid.el.style.display = 'none';
        emptyState.el.style.display = '';
        return;
      }
      emptyState.el.style.display = 'none';
      grid.el.style.display = '';

      Effect(function() {
        const filter = searchState.value.toLowerCase();
        const items = [];
        sessions.forEach(function(s) {
          const title = s.paper_title || s.folder_path.split('/').pop() || 'Untitled';
          const folder = s.folder_path.split('/').pop() || '';
          if (filter && title.toLowerCase().indexOf(filter) === -1 && folder.toLowerCase().indexOf(filter) === -1) return;
          items.push(_buildSessionCard(s, function() { loadSessions(); }));
        });
        AetherUI.mount(VStack(items).styles({ display: 'contents' }), grid.el);
      });
    });
  }

  loadSessions();
}

function _buildSessionCard(session, onRefresh) {
  const title = session.paper_title || 'Untitled';
  const folder = session.folder_path.split('/').pop() || '';
  const age = _relativeAge(session.created_at);

  const card = new View('div').className('nr-impl-card');

  // Top row: title + date
  const titleView = Text(title).className('nr-impl-card-title');
  const dateView = Text(age).className('nr-impl-card-date');
  const topRow = new View('div').className('nr-impl-card-top').add(titleView, dateView);
  card.add(topRow);

  // Folder name beneath title
  card.add(Text(folder).className('nr-impl-card-folder'));

  // Paper pills
  const papers = session.papers || [];
  if (papers.length) {
    const pillsView = new View('div').className('nr-impl-card-papers');
    papers.forEach(function(p) {
      let pillTitle = p.paper_title || p.paper_url;
      if (pillTitle.length > 40) pillTitle = pillTitle.slice(0, 38) + '\u2026';
      pillsView.add(Text(pillTitle).className('nr-impl-card-paper-pill').attr('title', p.paper_url));
    });
    card.add(pillsView);
  } else if (session.paper_url) {
    const pillsView2 = new View('div').className('nr-impl-card-papers');
    let pillTitle = session.paper_title || session.paper_url;
    if (pillTitle.length > 40) pillTitle = pillTitle.slice(0, 38) + '\u2026';
    pillsView2.add(Text(pillTitle).className('nr-impl-card-paper-pill').attr('title', session.paper_url));
    card.add(pillsView2);
  }

  // Actions — always visible
  const openFolderBtn = new View('button').className('nr-impl-card-action')
    .add(RawHTML(icon('folder', { size: 12 })), Text('Open'))
    .onTap(function(e) {
      e.stopPropagation();
      if (electronAPI.showItemInFolder) electronAPI.showItemInFolder(session.folder_path);
    });

  const addPaperBtn = new View('button').className('nr-impl-card-action')
    .add(RawHTML(icon('link', { size: 12 })), Text('Link paper'))
    .onTap(function(e) {
      e.stopPropagation();
      const url = prompt('Paper URL:');
      if (!url) return;
      const paperTitle = prompt('Paper title (optional):') || '';
      electronAPI.implLinkPaper(session.id, url, paperTitle).then(function() {
        toast('Paper linked');
        if (onRefresh) onRefresh();
      });
    });

  const deleteBtn = new View('button').className('nr-impl-card-action danger')
    .add(RawHTML(icon('trash', { size: 12 })), Text('Delete'))
    .onTap(function(e) {
      e.stopPropagation();
      if (!confirm('Delete this implementation session and its files?')) return;
      electronAPI.implDelete(session.id, true).then(function() {
        toast('Session deleted');
        if (onRefresh) onRefresh();
      });
    });

  const actions = new View('div').className('nr-impl-card-actions')
    .add(openFolderBtn, addPaperBtn, deleteBtn);
  card.add(actions);

  // Click card → open the first linked paper in browse, or open folder
  card.onTap(function() {
    const paperUrl = (papers.length && papers[0].paper_url) || session.paper_url;
    if (paperUrl) {
      browseNewTab(paperUrl);
    } else if (electronAPI.showItemInFolder) {
      electronAPI.showItemInFolder(session.folder_path);
    }
  });

  return card;
}

window.openImplementations = openImplementations;
