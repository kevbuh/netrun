// browse-nerd-panel.js — Lookup panel for Nerd Mode
// Registers panel tabs: Info, References, Authors, Highlights, Code, Files, Terminal
// Depends on: core-nav.js, browse-paper.js, browse-pdf-viewer.js
import { icon } from '/js/core/icons.js';
import { registerPanelTabs, ensurePanelVisible, showPanelForView } from '/js/core/core-nav.js';
import { _paperState, _s2Cache, _s2Fetch, _s2GetAuthor, _s2GetAuthorFull, _extractArxivId, _s2LookupByArxivId, _s2SearchPaper } from '/js/browse/browse-paper.js';
import { _pdfViewerScrollToPage, _pdfViewerGetText } from '/js/browse/browse-pdf-viewer.js';
import { _nerdModeEnabled } from '/js/browse/browse-nerd-mode.js';
import { _startTerminal, _renderFilesTab } from '/js/browse/browse-impl-session.js';

// ── State ──
let _registered = false;
let _currentTab = null;
let _renderGeneration = 0; // incremented each time a tab renders, used to cancel stale retries

// ── Register ──

export function _nerdPanelRegister() {
  if (_registered) return;
  _registered = true;

  registerPanelTabs('browse', {
    tabs: [
      { id: 'nerd-info',       label: 'Info',       icon: icon('fileText', { size: 14 }),  render: _renderInfoTab },
      { id: 'nerd-refs',       label: 'References',  icon: icon('link', { size: 14 }),     render: _renderRefsTab },

      { id: 'nerd-code',       label: 'Code',       icon: icon('code', { size: 14 }),       render: _renderCodeTab },

      { id: 'nerd-terminal',   label: 'Terminal',   icon: icon('code', { size: 14 }),      render: _renderTerminalTab },
    ],
    header: null
  });
}

export function _nerdPanelRefresh(tab) {
  _currentTab = tab;
  // Ensure paper state is fetched if not already
  if (tab && !_paperState.has(tab.id)) {
    _fetchPaperData(tab);
  }
}

// ── Paper data fetching ──

function _fetchPaperData(tab) {
  if (!tab || !tab.url) return;
  const arxivId = _extractArxivId(tab.url);
  if (arxivId) {
    const s2Path = '/paper/ARXIV:' + arxivId + '?fields=title,authors,citationCount,year,venue,references.title,references.authors,references.year,references.venue,references.citationCount';
    _s2LookupByArxivId(arxivId).then(function(data) {
      if (data) {
        _paperState.set(tab.id, {
          url: tab.url,
          meta: { title: data.title, authors: (data.authors || []).map(function(a) { return a.name; }), site: '' },
          refs: data.references || null,
          s2Data: data,
          s2UrlPath: s2Path,
          authorDetails: []
        });
        // Re-render info tab now that we have basic data
        _reRenderInfoIfActive();
        // Show panel now that we have data
        _showPanelIfNerdActive(tab);
        // Fetch author details
        _fetchAuthorDetails(tab, data);
      }
    });
  } else {
    // Try by page title
    const title = tab.title || '';
    if (title && title !== 'New Tab') {
      _s2SearchPaper(title).then(function(data) {
        if (data) {
          // Fetch full data with references
          const paperId = data.paperId;
          if (paperId) {
            const fullPath = '/paper/' + paperId + '?fields=title,authors,citationCount,year,venue,abstract,references.title,references.authors,references.year,references.citationCount,references.venue';
            _s2Fetch(fullPath).then(function(full) {
              if (full) {
                _paperState.set(tab.id, {
                  url: tab.url,
                  meta: { title: full.title, authors: (full.authors || []).map(function(a) { return a.name; }), site: '' },
                  refs: full.references || null,
                  s2Data: full,
                  s2UrlPath: fullPath,
                  authorDetails: []
                });
                // Re-render info tab now that we have basic data
                _reRenderInfoIfActive();
                // Show panel now that we have data
                _showPanelIfNerdActive(tab);
                _fetchAuthorDetails(tab, full);
              }
            });
          }
        }
      });
    }
  }
}

function _showPanelIfNerdActive(tab) {
  if (tab && _nerdModeEnabled.get(tab.id)) {
    ensurePanelVisible();
    showPanelForView('browse');
  }
}

function _reRenderInfoIfActive() {
  const activeBtn = document.querySelector('.universal-panel-tab-btn.active[data-tab-id="nerd-info"]');
  const panelContent = document.getElementById('universal-panel-content');
  if (activeBtn && panelContent) {
    _renderInfoTab(panelContent);
  }
}

function _fetchAuthorDetails(tab, s2Data) {
  if (!s2Data || !s2Data.authors) return;
  const authors = s2Data.authors;
  const promises = authors.filter(function(a) { return a.authorId; }).map(function(a) { return _s2GetAuthorFull(a.authorId); });
  Promise.all(promises).then(function(results) {
    const state = _paperState.get(tab.id);
    if (state) {
      state.authorDetails = results.filter(Boolean);
      // Re-render info tab if it's currently visible
      const activeBtn = document.querySelector('.universal-panel-tab-btn.active[data-tab-id="nerd-info"]');
      const panelContent = document.getElementById('universal-panel-content');
      if (activeBtn && panelContent) {
        _renderInfoTab(panelContent);
      }
    }
  });
}

// ── Tab renderers ──

function _clearTerminalOverflow() {
  const panelContent = document.getElementById('universal-panel-content');
  if (panelContent) panelContent.classList.remove('nerd-terminal-active');
}

function _getTab() {
  if (_currentTab) return _currentTab;
  const win = window._getCurrentWindow();
  if (!win) return null;
  return win.tabs.find(function(t) { return t.id === win.activeTab; });
}

function _getState() {
  const tab = _getTab();
  return tab ? _paperState.get(tab.id) : null;
}

function _renderNotebookInfoTab(container, tab) {
  const wrap = new View('div').className('nerd-tab-wrap');
  const nbData = tab._nbParsedData;
  if (!nbData) {
    wrap.add(Text('No notebook data').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  // Title
  const name = tab.title || tab.localPath || 'Notebook';
  wrap.add(Text(name).className('nerd-info-title'));

  // Kernel info
  const meta = nbData.metadata || {};
  const kernelspec = meta.kernelspec || {};
  const langInfo = meta.language_info || {};
  const metaParts = [];
  if (kernelspec.display_name) metaParts.push(kernelspec.display_name);
  if (langInfo.version) metaParts.push('v' + langInfo.version);
  if (metaParts.length) {
    wrap.add(Text(metaParts.join(' \u00b7 ')).className('nerd-info-meta'));
  }

  // Cell counts
  const cells = nbData.cells || [];
  const codeCells = cells.filter(function(c) { return c.cell_type === 'code'; });
  const mdCells = cells.filter(function(c) { return c.cell_type === 'markdown'; });
  wrap.add(Text(cells.length + ' cells \u00b7 ' + codeCells.length + ' code \u00b7 ' + mdCells.length + ' markdown').className('nerd-info-meta'));

  // Detected imports
  const imports = new Set();
  codeCells.forEach(function(c) {
    const source = Array.isArray(c.source) ? c.source.join('') : (c.source || '');
    const matches = source.match(/^(?:import|from)\s+(\w+)/gm);
    if (matches) matches.forEach(function(m) {
      const parts = m.split(/\s+/);
      const pkg = parts[parts.length === 2 ? 1 : 1];
      if (pkg) imports.add(pkg);
    });
  });
  if (imports.size) {
    const importSection = new View('div').cssText('margin-top:var(--nr-space-3);');
    importSection.add(Text('Imports').className('nerd-section-title'));
    const importText = Array.from(imports).sort().join(', ');
    importSection.add(Text(importText).className('nerd-section-body').cssText('font-family:var(--nr-font-mono);font-size:0.75rem;'));
    wrap.add(importSection);
  }

  // Table of contents from markdown headings
  const headings = [];
  cells.forEach(function(c, i) {
    if (c.cell_type !== 'markdown') return;
    const source = Array.isArray(c.source) ? c.source.join('') : (c.source || '');
    const lines = source.split('\n');
    lines.forEach(function(line) {
      const m = line.match(/^(#{1,6})\s+(.+)/);
      if (m) headings.push({ level: m[1].length, text: m[2].replace(/[#*_`\[\]]/g, '').trim(), cellIndex: i });
    });
  });
  if (headings.length) {
    const tocSection = new View('div').cssText('margin-top:var(--nr-space-3);');
    tocSection.add(Text('Table of Contents').className('nerd-section-title'));
    headings.forEach(function(h) {
      const item = Text(h.text).className('nerd-section-body').cssText('cursor:pointer;padding:2px 0 2px ' + ((h.level - 1) * 12) + 'px;font-size:0.78rem;');
      item.onTap(function() {
        if (typeof window._notebookViewerScrollToCell === 'function') window._notebookViewerScrollToCell(tab, h.cellIndex);
      });
      tocSection.add(item);
    });
    wrap.add(tocSection);
  }

  AetherUI.mount(wrap, container);
}

function _renderInfoTab(container) {
  _clearTerminalOverflow();
  const tab = _getTab();

  // Notebook branch
  if (tab && typeof window._isNotebookTab === 'function' && window._isNotebookTab(tab)) {
    _renderNotebookInfoTab(container, tab);
    return;
  }

  const state = _getState();
  const gen = ++_renderGeneration;

  const wrap = new View('div').className('nerd-tab-wrap');

  if (!state || !state.s2Data) {
    if (window.Skeleton) {
      wrap.add(window.Skeleton().lines(3));
    } else {
      wrap.add(Text('Loading paper info...').className('nerd-empty'));
    }
    AetherUI.mount(wrap, container);
    return;
  }

  const s2 = state.s2Data;

  // Title
  wrap.add(Text(s2.title || state.meta.title || 'Unknown Title').className('nerd-info-title'));

  // Meta line (year, venue, citations)
  const meta = [];
  if (s2.year) meta.push(String(s2.year));
  if (s2.venue) meta.push(s2.venue);
  if (s2.citationCount != null) meta.push(s2.citationCount + ' citations');
  if (meta.length) {
    wrap.add(Text(meta.join(' \u00b7 ')).className('nerd-info-meta'));
  }

  // Cache age indicator
  let s2Path = state.s2UrlPath;
  if (!s2Path && tab) {
    const _aid = _extractArxivId(tab.url);
    if (_aid) {
      s2Path = '/paper/ARXIV:' + _aid + '?fields=title,authors,citationCount,year,venue,references.title,references.authors,references.year,references.venue,references.citationCount';
    } else if (s2.paperId) {
      s2Path = '/paper/' + s2.paperId + '?fields=title,authors,citationCount,year,venue,abstract,references.title,references.authors,references.year,references.citationCount,references.venue';
    }
    if (s2Path) state.s2UrlPath = s2Path;
  }
  if (s2Path && window.electronAPI && window.electronAPI.dbQuery) {
    const cacheRow = new View('div').className('nerd-cache-row');
    const cacheLabel = Text('').className('nerd-cache-label');
    cacheRow.add(cacheLabel);
    wrap.add(cacheRow);

    window.electronAPI.dbQuery('s2-cache-age', s2Path).then(function(cachedAt) {
      if (!cachedAt) {
        cacheLabel.text('Live data');
        return;
      }
      const ageSec = Date.now() / 1000 - cachedAt;
      cacheLabel.text('Cached ' + _formatCacheAge(ageSec));

      var refetchBtn = Button('Refetch').className('nerd-cache-refetch').onTap(function() {
        refetchBtn.el.disabled = true;
        refetchBtn.text('Refetching...');
        window.electronAPI.dbQuery('s2-cache-clear', s2Path).then(function() {
          _s2Cache.delete(s2Path);
          _paperState.delete(tab.id);
          _fetchPaperData(tab);
          setTimeout(function() { _renderInfoTab(container); }, 2500);
        });
      });
      cacheRow.add(refetchBtn);
    });
  }

  // Authors
  const authors = s2.authors || [];
  if (authors.length) {
    const authSection = new View('div').cssText('margin-bottom:var(--nr-space-3);');
    authSection.add(Text('Authors').className('nerd-section-title').cssText('margin-bottom:var(--nr-space-2);'));
    const details = state.authorDetails || [];
    const detailsLoading = details.length === 0 && authors.some(function(a) { return a.authorId; });
    const detailMap = {};
    details.forEach(function(d) { if (d && d.authorId) detailMap[d.authorId] = d; });
    authors.forEach(function(author) {
      const card = new View('div').className('nerd-author-card').onTap(function() {
        if (author.authorId) {
          const url = 'https://www.semanticscholar.org/author/' + author.authorId;
          if (typeof window.browseNewTab === 'function') window.browseNewTab(url);
        }
      });
      const initials = (author.name || '').split(' ').map(function(w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
      card.add(Text(initials).className('author-card-avatar'));
      const info = new View('div').className('author-card-info');
      info.add(Text(author.name || 'Unknown').className('author-card-name'));
      const detail = detailMap[author.authorId];
      if (detail) {
        if (detail.affiliations && detail.affiliations.length) {
          info.add(Text(detail.affiliations.join(', ')).cssText('font-size:0.68rem;color:var(--nr-text-tertiary);margin-top:1px;'));
        }
        const stats = [];
        if (detail.citationCount != null) stats.push(detail.citationCount.toLocaleString() + ' citations');
        if (detail.paperCount != null) stats.push(detail.paperCount + ' papers');
        if (stats.length) {
          info.add(Text(stats.join(' \u00b7 ')).className('author-card-stats'));
        }
        if (detail.hIndex != null) {
          const badgeText = detail.hIndex >= 50 ? 'Highly cited' : detail.hIndex >= 20 ? 'Established' : detail.hIndex >= 5 ? 'Active' : 'Early career';
          info.add(Text('h-index: ' + detail.hIndex + ' \u00b7 ' + badgeText).className('author-card-stats'));
        }
      } else if (detailsLoading && author.authorId) {
        info.add(Skeleton().lines(1).cssText('margin-top:2px;'));
      }
      card.add(info);
      authSection.add(card);
    });
    wrap.add(authSection);
  }

  // Abstract
  if (s2.abstract) {
    wrap.add(
      new View('div').className('nerd-section').add(
        Text('Abstract').className('nerd-section-title'),
        Text(s2.abstract).className('nerd-section-body')
      )
    );
  }

  AetherUI.mount(wrap, container);
}

function _renderRefsTab(container) {
  _clearTerminalOverflow();
  ++_renderGeneration;
  const state = _getState();

  const wrap = new View('div').className('nerd-tab-wrap');

  if (!state || !state.refs || !state.refs.length) {
    wrap.add(Text('No references available').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  state.refs.forEach(function(ref) {
    const item = new View('div').className('nerd-paper-item');
    item.add(Text(ref.title || 'Untitled').className('nerd-paper-item-title line-clamp-2'));

    const refMeta = [];
    if (ref.authors && ref.authors.length) {
      refMeta.push(ref.authors.slice(0, 3).map(function(a) { return a.name; }).join(', ') + (ref.authors.length > 3 ? ' et al.' : ''));
    }
    if (ref.year) refMeta.push(String(ref.year));
    if (ref.citationCount != null) refMeta.push(ref.citationCount + ' cit.');
    if (refMeta.length) {
      item.add(Text(refMeta.join(' \u00b7 ')).className('nerd-paper-item-meta'));
    }

    item.onTap(function() {
      const query = encodeURIComponent(ref.title);
      const url = 'https://scholar.google.com/scholar?q=' + query;
      if (typeof window.browseNewTab === 'function') window.browseNewTab(url);
    });

    wrap.add(item);
  });

  AetherUI.mount(wrap, container);
}

function _renderHighlightsTab(container) {
  _clearTerminalOverflow();
  ++_renderGeneration;
  const tab = _getTab();

  const wrap = new View('div').className('nerd-tab-wrap');

  if (!tab || !tab._pdfHighlights || !tab._pdfHighlights.length) {
    wrap.add(Text('No highlights yet. Select text in the PDF to highlight.').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  tab._pdfHighlights.forEach(function(hl, idx) {
    const card = new View('div').className('pdf-hl-card');

    const header = new View('div').className('pdf-hl-card-header').onTap(function() {
      if (tab && hl.pageNum) _pdfViewerScrollToPage(tab, hl.pageNum);
    });

    header.add(
      Text(String(idx + 1)).className('pdf-hl-card-badge').styles({ background: hl.color || 'rgba(255,235,59,0.6)' }),
      Text(hl.text || '').className('pdf-hl-card-text'),
      Text('p. ' + hl.pageNum).className('pdf-hl-card-page'),
      new View('button').className('pdf-hl-card-del').text('\u00d7').onTap(function(e) {
        e.stopPropagation();
        if (typeof window._pdfViewerRemoveHighlight === 'function') {
          window._pdfViewerRemoveHighlight(tab, idx);
        }
        _renderHighlightsTab(container);
      })
    );

    card.add(header);

    // Reference cross-linking: scan for [n] patterns
    const state = _getState();
    const refPattern = /\[(\d+(?:[,\-]\d+)*)\]/g;
    let match;
    while ((match = refPattern.exec(hl.text)) !== null) {
      const refNums = _parseRefNums(match[1]);
      refNums.forEach(function(num) {
        if (state && state.refs && state.refs[num - 1]) {
          card.add(
            Text('[' + num + '] ' + state.refs[num - 1].title)
              .cssText('font-size:0.68rem;color:var(--nr-accent);cursor:pointer;padding:2px 0;')
              .onTap(function(e) {
                e.stopPropagation();
                const query = encodeURIComponent(state.refs[num - 1].title);
                if (typeof window.browseNewTab === 'function') window.browseNewTab('https://scholar.google.com/scholar?q=' + query);
              })
          );
        }
      });
    }

    // Note textarea
    const note = new View('textarea').className('pdf-hl-card-note').attr('rows', '1').attr('placeholder', 'Add a note...');
    note.el.value = hl.note || '';
    let _noteTimer = null;
    note.on('input', function() {
      hl.note = note.el.value;
      clearTimeout(_noteTimer);
      _noteTimer = setTimeout(function() {
        if (hl.id && window.electronAPI && window.electronAPI.dbQuery) {
          window.electronAPI.dbQuery('highlight-update', hl.id, hl.note);
        }
      }, 600);
    });
    card.add(note);

    wrap.add(card);
  });

  AetherUI.mount(wrap, container);
}

// ── Code Tab (Papers With Code + GitHub fallback) ──

function _proxyFetch(proxyName, url) {
  if (window.electronAPI && window.electronAPI.dbQuery) {
    return window.electronAPI.dbQuery(proxyName, url);
  }
  return fetch(url).then(function(r) { return r.json(); });
}

function _searchHuggingFace(arxivId) {
  if (!arxivId) return Promise.resolve(null);
  const url = 'https://huggingface.co/api/papers/' + arxivId;
  return _proxyFetch('pwc-proxy', url).then(function(data) {
    if (!data || data.error) return null;
    // HF paper API returns { id, title, upvotes, ... } — the paper page itself links to models/spaces/datasets
    return { id: data.id || arxivId, title: data.title || '', upvotes: data.upvotes || 0 };
  }).catch(function() { return null; });
}

function _searchGithub(title) {
  const query = encodeURIComponent('"' + title + '"');
  const url = 'https://api.github.com/search/repositories?q=' + query + '&sort=stars&per_page=8';
  return _proxyFetch('github-proxy', url).then(function(data) {
    if (!data || !data.items || !data.items.length) return null;
    return data.items.map(function(repo) {
      return {
        name: repo.full_name,
        description: repo.description || '',
        stars: repo.stargazers_count,
        language: repo.language,
        forks: repo.forks_count,
        url: repo.html_url
      };
    });
  }).catch(function() { return null; });
}

function _codeTabLinks(arxivId, title) {
  const links = new HStack().styles({ gap: '12px', marginBottom: '8px' });
  if (arxivId) {
    links.add(
      Text('Hugging Face \u2192').className('nerd-paper-item-meta').styles({ cursor: 'pointer', color: 'var(--nr-accent)' })
        .onTap(function() { if (typeof window.browseNewTab === 'function') window.browseNewTab('https://huggingface.co/papers/' + arxivId); })
    );
  }
  links.add(
    Text('GitHub \u2192').className('nerd-paper-item-meta').styles({ cursor: 'pointer', color: 'var(--nr-accent)' })
      .onTap(function() {
        const ghUrl = 'https://github.com/search?q=' + encodeURIComponent('"' + title + '"') + '&type=repositories&s=stars&o=desc';
        if (typeof window.browseNewTab === 'function') window.browseNewTab(ghUrl);
      }),
    Text('Web \u2192').className('nerd-paper-item-meta').styles({ cursor: 'pointer', color: 'var(--nr-accent)' })
      .onTap(function() {
        const webUrl = 'https://www.google.com/search?q=' + encodeURIComponent('"' + title + '" implementation');
        if (typeof window.browseNewTab === 'function') window.browseNewTab(webUrl);
      })
  );
  return links;
}

function _renderCodeTab(container) {
  _clearTerminalOverflow();
  ++_renderGeneration;
  const state = _getState();
  const tab = _getTab();
  const wrap = new View('div').className('nerd-tab-wrap');

  if (!state || !state.s2Data || !state.s2Data.title) {
    wrap.add(Text('No paper identified').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  wrap.add(Text('Searching for implementations...').className('nerd-empty'));
  AetherUI.mount(wrap, container);

  const title = state.s2Data.title;
  const arxivId = tab ? _extractArxivId(tab.url) : null;

  // Try Hugging Face first (arXiv papers), then GitHub fallback
  _searchHuggingFace(arxivId).then(function(hfPaper) {
    if (hfPaper) {
      const hfWrap = new View('div').className('nerd-tab-wrap');
      hfWrap.add(_codeTabLinks(arxivId, title));

      const hfCard = new View('div').className('nerd-repo-card').add(
        Text(hfPaper.title || title).className('nerd-repo-name'),
        Text('Hugging Face Paper' + (hfPaper.upvotes ? ' \u00b7 ' + hfPaper.upvotes + ' upvotes' : '')).className('nerd-repo-meta')
      ).onTap(function() {
        if (typeof window.browseNewTab === 'function') window.browseNewTab('https://huggingface.co/papers/' + hfPaper.id);
      });
      hfWrap.add(hfCard);

      // Also search GitHub for repos
      _searchGithub(title).then(function(ghRepos) {
        if (ghRepos && ghRepos.length) {
          ghRepos.forEach(function(repo) {
            const meta = [];
            if (repo.stars != null) meta.push(repo.stars + ' stars');
            if (repo.language) meta.push(repo.language);
            if (repo.forks != null) meta.push(repo.forks + ' forks');
            hfWrap.add(new View('div').className('nerd-repo-card').add(
              Text(repo.name).className('nerd-repo-name'),
              Text(repo.description).className('nerd-repo-desc line-clamp-2'),
              Text(meta.join(' \u00b7 ')).className('nerd-repo-meta')
            ).onTap(function() {
              if (typeof window.browseNewTab === 'function') window.browseNewTab(repo.url);
            }));
          });
        }
        AetherUI.mount(hfWrap, container);
      });
      return;
    }

    // No HF paper — try GitHub directly
    _searchGithub(title).then(function(ghRepos) {
      if (!ghRepos || !ghRepos.length) {
        const emptyWrap = new View('div').className('nerd-tab-wrap').add(
          Text('No implementations found').className('nerd-empty'),
          _codeTabLinks(arxivId, title).styles({ justifyContent: 'center', marginTop: '8px' })
        );
        AetherUI.mount(emptyWrap, container);
        return;
      }
      const ghWrap = new View('div').className('nerd-tab-wrap');
      ghWrap.add(_codeTabLinks(arxivId, title));
      ghRepos.forEach(function(repo) {
        const meta = [];
        if (repo.stars != null) meta.push(repo.stars + ' stars');
        if (repo.language) meta.push(repo.language);
        if (repo.forks != null) meta.push(repo.forks + ' forks');
        ghWrap.add(new View('div').className('nerd-repo-card').add(
          Text(repo.name).className('nerd-repo-name'),
          Text(repo.description).className('nerd-repo-desc line-clamp-2'),
          Text(meta.join(' \u00b7 ')).className('nerd-repo-meta')
        ).onTap(function() {
          if (typeof window.browseNewTab === 'function') window.browseNewTab(repo.url);
        }));
      });
      AetherUI.mount(ghWrap, container);
    });
  });
}

// ── Files Tab ──

function _renderFilesTabProxy(container) {
  _clearTerminalOverflow();
  ++_renderGeneration;
  _renderFilesTab(container, _getTab);
}

// ── Terminal Tab ──

function _renderTerminalTab(container) {
  ++_renderGeneration;
  const tab = _getTab();

  // Disable scroll on panel content — xterm needs fixed height
  const panelContent = document.getElementById('universal-panel-content');
  if (panelContent) panelContent.classList.add('nerd-terminal-active');

  if (!tab || !tab._implSessionId) {
    // No impl session active — show empty state
    var wrap = new View('div').className('nerd-terminal-wrap');
    wrap.add(Text('Click Implement in the toolbar to start').className('nerd-terminal-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  var wrap = new View('div').className('nerd-terminal-wrap');
  AetherUI.mount(wrap, container);

  if (tab._implTerm) {
    // Reparent existing xterm element
    const xtermEl = tab._implTerm.element;
    if (xtermEl) {
      wrap.el.appendChild(xtermEl);
      // Refit after reparent
      requestAnimationFrame(function() {
        if (tab._implTerm && tab._implTerm._addonManager) {
          try {
            const fitAddon = new FitAddon.FitAddon();
            tab._implTerm.loadAddon(fitAddon);
            fitAddon.fit();
            if (tab._implTermId) {
              electronAPI.terminalResize(tab._implTermId, tab._implTerm.cols, tab._implTerm.rows);
            }
          } catch (e) { /* ignore */ }
        }
      });
    }
  } else {
    // No terminal yet — start one
    _startTerminal(tab, wrap.el);
  }
}

// ── Helpers ──

function _formatCacheAge(seconds) {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  const days = Math.floor(seconds / 86400);
  return days + 'd ago';
}

function _parseRefNums(str) {
  const nums = [];
  str.split(',').forEach(function(part) {
    part = part.trim();
    if (part.indexOf('-') !== -1) {
      const range = part.split('-');
      const start = parseInt(range[0]);
      const end = parseInt(range[1]);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) nums.push(i);
      }
    } else {
      const n = parseInt(part);
      if (!isNaN(n)) nums.push(n);
    }
  });
  return nums;
}

export function _generateCiteFormats(s2) {
  const formats = {};
  const authors = (s2.authors || []).map(function(a) { return a.name; });
  const year = s2.year || '';
  const title = s2.title || '';
  const venue = s2.venue || '';

  // BibTeX
  const bibKey = authors.length ? authors[0].split(' ').pop().toLowerCase() + year : 'paper' + year;
  let bibtex = '@article{' + bibKey + ',\n';
  bibtex += '  title={' + title + '},\n';
  bibtex += '  author={' + authors.join(' and ') + '},\n';
  if (year) bibtex += '  year={' + year + '},\n';
  if (venue) bibtex += '  journal={' + venue + '},\n';
  bibtex += '}';
  formats['BibTeX'] = bibtex;

  // APA
  let apaAuthors = authors.length ? authors.slice(0, 6).map(function(name) {
    const parts = name.split(' ');
    const last = parts.pop();
    return last + ', ' + parts.map(function(p) { return p.charAt(0) + '.'; }).join(' ');
  }).join(', ') : '';
  if (authors.length > 6) apaAuthors += ', ... ';
  formats['APA'] = apaAuthors + ' (' + year + '). ' + title + '. ' + (venue ? venue + '.' : '');

  // MLA
  let mlaAuthors = authors.length ? authors[0] : '';
  if (authors.length === 2) mlaAuthors += ', and ' + authors[1];
  if (authors.length > 2) mlaAuthors += ', et al.';
  formats['MLA'] = mlaAuthors + '. "' + title + '." ' + (venue ? venue + ', ' : '') + year + '.';

  // Chicago
  formats['Chicago'] = (authors.length ? authors.join(', ') : '') + '. "' + title + '." ' + (venue ? venue + ' ' : '') + '(' + year + ').';

  // IEEE
  const ieeeAuthors = authors.length ? authors.slice(0, 6).map(function(name) {
    const parts = name.split(' ');
    const last = parts.pop();
    return parts.map(function(p) { return p.charAt(0) + '.'; }).join(' ') + ' ' + last;
  }).join(', ') : '';
  formats['IEEE'] = ieeeAuthors + ', "' + title + '," ' + (venue ? venue + ', ' : '') + year + '.';

  // Harvard
  formats['Harvard'] = apaAuthors + ' (' + year + ') \'' + title + '\', ' + (venue ? venue + '.' : '');

  // Vancouver
  const vanAuthors = authors.length ? authors.slice(0, 6).map(function(name) {
    const parts = name.split(' ');
    const last = parts.pop();
    return last + ' ' + parts.map(function(p) { return p.charAt(0); }).join('');
  }).join(', ') : '';
  formats['Vancouver'] = vanAuthors + '. ' + title + '. ' + (venue ? venue + '. ' : '') + year + '.';

  return formats;
}
