// browse-nerd-panel.js — Lookup panel for Nerd Mode
// Registers panel tabs: Info, References, Authors, Highlights, Search
// Depends on: core-nav.js, browse-paper.js, browse-pdf-viewer.js
import { icon } from '/js/core/icons.js';
import { registerPanelTabs, togglePanel } from '/js/core/core-nav.js';
import { _paperState, _s2Cache, _s2Fetch, _s2GetAuthor, _s2GetAuthorFull, _extractArxivId, _s2LookupByArxivId, _s2SearchPaper } from '/js/browse/browse-paper.js';
import { _pdfViewerScrollToPage, _pdfViewerGetText } from '/js/browse/browse-pdf-viewer.js';
import { _nerdModeEnabled } from '/js/browse/browse-nerd-mode.js';
import { _startTerminal } from '/js/browse/browse-impl-session.js';

// ── State ──
var _registered = false;
var _currentTab = null;
var _renderGeneration = 0; // incremented each time a tab renders, used to cancel stale retries

// ── Register ──

export function _nerdPanelRegister() {
  if (_registered) return;
  _registered = true;

  registerPanelTabs('browse', {
    tabs: [
      { id: 'nerd-info',       label: 'Info',       icon: icon('fileText', { size: 14 }),  render: _renderInfoTab },
      { id: 'nerd-refs',       label: 'References',  icon: icon('link', { size: 14 }),     render: _renderRefsTab },
      { id: 'nerd-authors',    label: 'Authors',    icon: icon('user', { size: 14 }),      render: _renderAuthorsTab },
      { id: 'nerd-highlights', label: 'Highlights', icon: icon('highlighter', { size: 14 }), render: _renderHighlightsTab },
      { id: 'nerd-code',       label: 'Code',       icon: icon('code', { size: 14 }),       render: _renderCodeTab },
      { id: 'nerd-search',     label: 'Search',     icon: icon('search', { size: 14 }),    render: _renderSearchTab },
      { id: 'nerd-terminal',   label: 'Terminal',   icon: icon('code', { size: 14 }),      render: _renderTerminalTab },
    ],
    header: function(el) {
      var row = new HStack().styles({ width: '100%', alignItems: 'center', justifyContent: 'space-between' });
      row.add(Text('Nerd Mode').className('nerd-header-label'));
      var closeBtn = new View('button').className('nerd-panel-close-btn')
        .attr('title', 'Hide panel')
        .add(RawHTML(icon('x', { size: 14 })))
        .onTap(function() { togglePanel(); });
      row.add(closeBtn);
      AetherUI.append(row, el);
    }
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
  var arxivId = _extractArxivId(tab.url);
  if (arxivId) {
    var s2Path = '/paper/ARXIV:' + arxivId + '?fields=title,authors,citationCount,year,venue,references.title,references.authors,references.year,references.venue,references.citationCount';
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
        // Fetch author details
        _fetchAuthorDetails(tab, data);
      }
    });
  } else {
    // Try by page title
    var title = tab.title || '';
    if (title && title !== 'New Tab') {
      _s2SearchPaper(title).then(function(data) {
        if (data) {
          // Fetch full data with references
          var paperId = data.paperId;
          if (paperId) {
            var fullPath = '/paper/' + paperId + '?fields=title,authors,citationCount,year,venue,abstract,references.title,references.authors,references.year,references.citationCount,references.venue';
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
                _fetchAuthorDetails(tab, full);
              }
            });
          }
        }
      });
    }
  }
}

function _fetchAuthorDetails(tab, s2Data) {
  if (!s2Data || !s2Data.authors) return;
  var authors = s2Data.authors.slice(0, 8);
  var promises = authors.filter(function(a) { return a.authorId; }).map(function(a) { return _s2GetAuthorFull(a.authorId); });
  Promise.all(promises).then(function(results) {
    var state = _paperState.get(tab.id);
    if (state) {
      state.authorDetails = results.filter(Boolean);
    }
  });
}

// ── Tab renderers ──

function _clearTerminalOverflow() {
  var panelContent = document.getElementById('universal-panel-content');
  if (panelContent) panelContent.classList.remove('nerd-terminal-active');
}

function _getTab() {
  if (_currentTab) return _currentTab;
  var win = window._getCurrentWindow();
  if (!win) return null;
  return win.tabs.find(function(t) { return t.id === win.activeTab; });
}

function _getState() {
  var tab = _getTab();
  return tab ? _paperState.get(tab.id) : null;
}

function _renderInfoTab(container) {
  _clearTerminalOverflow();
  var tab = _getTab();
  var state = _getState();
  var gen = ++_renderGeneration;

  var wrap = new View('div').className('nerd-tab-wrap');

  if (!state || !state.s2Data) {
    if (window.Skeleton) {
      wrap.add(window.Skeleton().lines(3));
    } else {
      wrap.add(Text('Loading paper info...').className('nerd-empty'));
    }
    AetherUI.mount(wrap, container);
    if (tab) {
      setTimeout(function() { if (gen === _renderGeneration) _renderInfoTab(container); }, 2000);
    }
    return;
  }

  var s2 = state.s2Data;

  // Title
  wrap.add(Text(s2.title || state.meta.title || 'Unknown Title').className('nerd-info-title'));

  // Meta line (year, venue, citations)
  var meta = [];
  if (s2.year) meta.push(String(s2.year));
  if (s2.venue) meta.push(s2.venue);
  if (s2.citationCount != null) meta.push(s2.citationCount + ' citations');
  if (meta.length) {
    wrap.add(Text(meta.join(' \u00b7 ')).className('nerd-info-meta'));
  }

  // Cache age indicator
  var s2Path = state.s2UrlPath;
  if (!s2Path && tab) {
    var _aid = _extractArxivId(tab.url);
    if (_aid) {
      s2Path = '/paper/ARXIV:' + _aid + '?fields=title,authors,citationCount,year,venue,references.title,references.authors,references.year,references.venue,references.citationCount';
    } else if (s2.paperId) {
      s2Path = '/paper/' + s2.paperId + '?fields=title,authors,citationCount,year,venue,abstract,references.title,references.authors,references.year,references.citationCount,references.venue';
    }
    if (s2Path) state.s2UrlPath = s2Path;
  }
  if (s2Path && window.electronAPI && window.electronAPI.dbQuery) {
    var cacheRow = new View('div').className('nerd-cache-row');
    var cacheLabel = Text('').className('nerd-cache-label');
    cacheRow.add(cacheLabel);
    wrap.add(cacheRow);

    window.electronAPI.dbQuery('s2-cache-age', s2Path).then(function(cachedAt) {
      if (!cachedAt) {
        cacheLabel.text('Live data');
        return;
      }
      var ageSec = Date.now() / 1000 - cachedAt;
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
  var authors = s2.authors || [];
  if (authors.length) {
    wrap.add(Text(authors.map(function(a) { return a.name; }).join(', ')).className('nerd-info-authors'));
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

  // Citation formats
  var citeSectionView = new View('div').className('nerd-section').add(
    Text('Cite').className('nerd-section-title')
  );

  var citeFormats = _generateCiteFormats(s2);
  Object.keys(citeFormats).forEach(function(fmt) {
    var row = new View('div').className('nerd-cite-row').add(
      Text(fmt).className('nerd-cite-label'),
      Text(citeFormats[fmt]).className('nerd-cite-box').attr('title', 'Click to copy').onTap(function() {
        navigator.clipboard.writeText(citeFormats[fmt]).then(function() {
          var accent = getComputedStyle(document.documentElement).getPropertyValue('--nr-accent').trim();
          if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse(accent || '#3b82f6');
        }).catch(function() {});
        if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Copied ' + fmt);
      })
    );
    citeSectionView.add(row);
  });

  wrap.add(citeSectionView);
  AetherUI.mount(wrap, container);
}

function _renderRefsTab(container) {
  _clearTerminalOverflow();
  ++_renderGeneration;
  var state = _getState();

  var wrap = new View('div').className('nerd-tab-wrap');

  if (!state || !state.refs || !state.refs.length) {
    wrap.add(Text('No references available').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  state.refs.forEach(function(ref) {
    var item = new View('div').className('nerd-paper-item');
    item.add(Text(ref.title || 'Untitled').className('nerd-paper-item-title line-clamp-2'));

    var refMeta = [];
    if (ref.authors && ref.authors.length) {
      refMeta.push(ref.authors.slice(0, 3).map(function(a) { return a.name; }).join(', ') + (ref.authors.length > 3 ? ' et al.' : ''));
    }
    if (ref.year) refMeta.push(String(ref.year));
    if (ref.citationCount != null) refMeta.push(ref.citationCount + ' cit.');
    if (refMeta.length) {
      item.add(Text(refMeta.join(' \u00b7 ')).className('nerd-paper-item-meta'));
    }

    item.onTap(function() {
      var query = encodeURIComponent(ref.title);
      var url = 'https://scholar.google.com/scholar?q=' + query;
      if (typeof window.browseNewTab === 'function') window.browseNewTab(url);
    });

    wrap.add(item);
  });

  AetherUI.mount(wrap, container);
}

function _renderAuthorsTab(container) {
  _clearTerminalOverflow();
  ++_renderGeneration;
  var state = _getState();

  var wrap = new View('div').className('nerd-tab-wrap');

  if (!state || !state.s2Data || !state.s2Data.authors || !state.s2Data.authors.length) {
    wrap.add(Text('No author data available').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  var authors = state.s2Data.authors;
  var details = state.authorDetails || [];
  var detailMap = {};
  details.forEach(function(d) { if (d && d.authorId) detailMap[d.authorId] = d; });

  authors.forEach(function(author) {
    var card = new View('div').className('nerd-author-card').onTap(function() {
      if (author.authorId) {
        var url = 'https://www.semanticscholar.org/author/' + author.authorId;
        if (typeof window.browseNewTab === 'function') window.browseNewTab(url);
      }
    });

    // Avatar with initials
    var initials = (author.name || '').split(' ').map(function(w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    card.add(Text(initials).className('author-card-avatar'));

    var info = new View('div').className('author-card-info');
    info.add(Text(author.name || 'Unknown').className('author-card-name'));

    // Detailed stats
    var detail = detailMap[author.authorId];
    if (detail) {
      // Affiliations
      if (detail.affiliations && detail.affiliations.length) {
        info.add(Text(detail.affiliations.join(', ')).cssText('font-size:0.68rem;color:var(--nr-text-tertiary);margin-top:1px;'));
      }
      var stats = [];
      if (detail.hIndex != null) stats.push('h-index: ' + detail.hIndex);
      if (detail.citationCount != null) stats.push(detail.citationCount.toLocaleString() + ' citations');
      if (detail.paperCount != null) stats.push(detail.paperCount + ' papers');
      if (stats.length) {
        info.add(Text(stats.join(' \u00b7 ')).className('author-card-stats'));
      }

      // h-index badge — unified accent color
      if (detail.hIndex != null) {
        var badgeText = detail.hIndex >= 50 ? 'Highly cited' : detail.hIndex >= 20 ? 'Established' : detail.hIndex >= 5 ? 'Active' : 'Early career';
        info.add(new View('span').className('nerd-badge').text(badgeText));
      }
    }

    card.add(info);
    wrap.add(card);
  });

  AetherUI.mount(wrap, container);
}

function _renderHighlightsTab(container) {
  _clearTerminalOverflow();
  ++_renderGeneration;
  var tab = _getTab();

  var wrap = new View('div').className('nerd-tab-wrap');

  if (!tab || !tab._pdfHighlights || !tab._pdfHighlights.length) {
    wrap.add(Text('No highlights yet. Select text in the PDF to highlight.').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  tab._pdfHighlights.forEach(function(hl, idx) {
    var card = new View('div').className('pdf-hl-card');

    var header = new View('div').className('pdf-hl-card-header').onTap(function() {
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
    var state = _getState();
    var refPattern = /\[(\d+(?:[,\-]\d+)*)\]/g;
    var match;
    while ((match = refPattern.exec(hl.text)) !== null) {
      var refNums = _parseRefNums(match[1]);
      refNums.forEach(function(num) {
        if (state && state.refs && state.refs[num - 1]) {
          card.add(
            Text('[' + num + '] ' + state.refs[num - 1].title)
              .cssText('font-size:0.68rem;color:var(--nr-accent);cursor:pointer;padding:2px 0;')
              .onTap(function(e) {
                e.stopPropagation();
                var query = encodeURIComponent(state.refs[num - 1].title);
                if (typeof window.browseNewTab === 'function') window.browseNewTab('https://scholar.google.com/scholar?q=' + query);
              })
          );
        }
      });
    }

    // Note textarea
    var note = new View('textarea').className('pdf-hl-card-note').attr('rows', '1').attr('placeholder', 'Add a note...');
    note.el.value = hl.note || '';
    var _noteTimer = null;
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

function _renderSearchTab(container) {
  _clearTerminalOverflow();
  ++_renderGeneration;
  var tab = _getTab();

  var wrap = new View('div').className('nerd-search-wrap');

  // Search input
  var input = new View('input').className('nerd-search-input').attr('type', 'text').attr('placeholder', 'Search document text...');
  var inputRow = new View('div').className('nerd-search-input-row').add(input);
  wrap.add(inputRow);

  // Results area
  var resultsView = new View('div').className('nerd-search-results');
  resultsView.add(Text('Type to search the full document').className('nerd-empty'));
  wrap.add(resultsView);
  var resultsEl = resultsView.el;

  AetherUI.mount(wrap, container);

  var searchTimer = null;
  input.on('input', function() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function() {
      var query = input.el.value.trim();
      if (!query || !tab || !tab._pdfDoc) {
        AetherUI.mount(Text('Type to search the full document').className('nerd-empty'), resultsEl);
        return;
      }
      AetherUI.mount(Text('Searching...').className('nerd-empty'), resultsEl);
      _searchFullText(tab, query, resultsEl);
    }, 400);
  });

  setTimeout(function() { input.el.focus(); }, 100);
}

function _searchFullText(tab, query, results) {
  if (!tab._pdfDoc) return;
  var queryLower = query.toLowerCase();
  var matches = [];
  var promises = [];

  for (var i = 1; i <= tab._pdfPageCount; i++) {
    (function(pageNum) {
      promises.push(
        tab._pdfDoc.getPage(pageNum).then(function(page) {
          return page.getTextContent().then(function(tc) {
            var text = tc.items.map(function(it) { return it.str; }).join(' ');
            var idx = text.toLowerCase().indexOf(queryLower);
            while (idx !== -1) {
              var start = Math.max(0, idx - 40);
              var end = Math.min(text.length, idx + query.length + 40);
              var snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
              matches.push({ pageNum: pageNum, snippet: snippet, idx: idx });
              idx = text.toLowerCase().indexOf(queryLower, idx + 1);
            }
          });
        })
      );
    })(i);
  }

  Promise.all(promises).then(function() {
    if (!matches.length) {
      AetherUI.mount(Text('No matches found').className('nerd-empty'), results);
      return;
    }

    var resultsWrap = new View('div').className('nerd-search-results-inner');
    resultsWrap.add(Text(matches.length + ' match' + (matches.length !== 1 ? 'es' : '') + ' found').className('nerd-search-count'));

    matches.forEach(function(m) {
      var item = new View('div').className('nerd-paper-item').add(
        Text('Page ' + m.pageNum).className('nerd-search-page'),
        Text(m.snippet).className('nerd-search-snippet')
      ).onTap(function() {
        _pdfViewerScrollToPage(tab, m.pageNum);
      });

      resultsWrap.add(item);
    });

    AetherUI.mount(resultsWrap, results);
  });
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
  var url = 'https://huggingface.co/api/papers/' + arxivId;
  return _proxyFetch('pwc-proxy', url).then(function(data) {
    if (!data || data.error) return null;
    // HF paper API returns { id, title, upvotes, ... } — the paper page itself links to models/spaces/datasets
    return { id: data.id || arxivId, title: data.title || '', upvotes: data.upvotes || 0 };
  }).catch(function() { return null; });
}

function _searchGithub(title) {
  var query = encodeURIComponent('"' + title + '"');
  var url = 'https://api.github.com/search/repositories?q=' + query + '&sort=stars&per_page=8';
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
  var links = new HStack().styles({ gap: '12px', marginBottom: '8px' });
  if (arxivId) {
    links.add(
      Text('Hugging Face \u2192').className('nerd-paper-item-meta').styles({ cursor: 'pointer', color: 'var(--nr-accent)' })
        .onTap(function() { if (typeof window.browseNewTab === 'function') window.browseNewTab('https://huggingface.co/papers/' + arxivId); })
    );
  }
  links.add(
    Text('GitHub \u2192').className('nerd-paper-item-meta').styles({ cursor: 'pointer', color: 'var(--nr-accent)' })
      .onTap(function() {
        var ghUrl = 'https://github.com/search?q=' + encodeURIComponent('"' + title + '"') + '&type=repositories&s=stars&o=desc';
        if (typeof window.browseNewTab === 'function') window.browseNewTab(ghUrl);
      }),
    Text('Web \u2192').className('nerd-paper-item-meta').styles({ cursor: 'pointer', color: 'var(--nr-accent)' })
      .onTap(function() {
        var webUrl = 'https://www.google.com/search?q=' + encodeURIComponent('"' + title + '" implementation');
        if (typeof window.browseNewTab === 'function') window.browseNewTab(webUrl);
      })
  );
  return links;
}

function _renderCodeTab(container) {
  _clearTerminalOverflow();
  ++_renderGeneration;
  var state = _getState();
  var tab = _getTab();
  var wrap = new View('div').className('nerd-tab-wrap');

  if (!state || !state.s2Data || !state.s2Data.title) {
    wrap.add(Text('No paper identified').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  // Previous sessions
  if (window.electronAPI && window.electronAPI.implList && tab) {
    electronAPI.implList({ paperUrl: tab.url }).then(function(sessions) {
      if (sessions && !sessions.error && sessions.length) {
        var sessView = new View('div').className('nerd-section').add(
          Text('Previous Sessions').className('nerd-section-title')
        );
        sessions.forEach(function(s) {
          var age = (Date.now() / 1000 - s.created_at);
          var ageStr = age < 3600 ? Math.floor(age / 60) + 'm ago' : age < 86400 ? Math.floor(age / 3600) + 'h ago' : Math.floor(age / 86400) + 'd ago';
          sessView.add(new View('div').className('impl-session-card').add(
            Text(s.folder_path.split('/').pop()).className('impl-session-card-title'),
            Text(ageStr).className('impl-session-card-meta')
          ).onTap(function() {
            if (window._implSessionEnable) window._implSessionEnable(tab, s.id);
          }));
        });
        // Prepend sessions into wrap
        if (wrap.el.firstChild) {
          wrap.el.insertBefore(sessView.el, wrap.el.firstChild);
        } else {
          wrap.el.appendChild(sessView.el);
        }
      }
    });
  }

  wrap.add(Text('Searching for implementations...').className('nerd-empty'));
  AetherUI.mount(wrap, container);

  var title = state.s2Data.title;
  var arxivId = tab ? _extractArxivId(tab.url) : null;

  // Try Hugging Face first (arXiv papers), then GitHub fallback
  _searchHuggingFace(arxivId).then(function(hfPaper) {
    if (hfPaper) {
      var hfWrap = new View('div').className('nerd-tab-wrap');
      hfWrap.add(_codeTabLinks(arxivId, title));

      var hfCard = new View('div').className('nerd-repo-card').add(
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
            var meta = [];
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
        var emptyWrap = new View('div').className('nerd-tab-wrap').add(
          Text('No implementations found').className('nerd-empty'),
          _codeTabLinks(arxivId, title).styles({ justifyContent: 'center', marginTop: '8px' })
        );
        AetherUI.mount(emptyWrap, container);
        return;
      }
      var ghWrap = new View('div').className('nerd-tab-wrap');
      ghWrap.add(_codeTabLinks(arxivId, title));
      ghRepos.forEach(function(repo) {
        var meta = [];
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

// ── Terminal Tab ──

function _renderTerminalTab(container) {
  ++_renderGeneration;
  var tab = _getTab();

  // Disable scroll on panel content — xterm needs fixed height
  var panelContent = document.getElementById('universal-panel-content');
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
    var xtermEl = tab._implTerm.element;
    if (xtermEl) {
      wrap.el.appendChild(xtermEl);
      // Refit after reparent
      requestAnimationFrame(function() {
        if (tab._implTerm && tab._implTerm._addonManager) {
          try {
            var fitAddon = new FitAddon.FitAddon();
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
  var days = Math.floor(seconds / 86400);
  return days + 'd ago';
}

function _parseRefNums(str) {
  var nums = [];
  str.split(',').forEach(function(part) {
    part = part.trim();
    if (part.indexOf('-') !== -1) {
      var range = part.split('-');
      var start = parseInt(range[0]);
      var end = parseInt(range[1]);
      if (!isNaN(start) && !isNaN(end)) {
        for (var i = start; i <= end; i++) nums.push(i);
      }
    } else {
      var n = parseInt(part);
      if (!isNaN(n)) nums.push(n);
    }
  });
  return nums;
}

function _generateCiteFormats(s2) {
  var formats = {};
  var authors = (s2.authors || []).map(function(a) { return a.name; });
  var year = s2.year || '';
  var title = s2.title || '';
  var venue = s2.venue || '';

  // BibTeX
  var bibKey = authors.length ? authors[0].split(' ').pop().toLowerCase() + year : 'paper' + year;
  var bibtex = '@article{' + bibKey + ',\n';
  bibtex += '  title={' + title + '},\n';
  bibtex += '  author={' + authors.join(' and ') + '},\n';
  if (year) bibtex += '  year={' + year + '},\n';
  if (venue) bibtex += '  journal={' + venue + '},\n';
  bibtex += '}';
  formats['BibTeX'] = bibtex;

  // APA
  var apaAuthors = authors.length ? authors.slice(0, 6).map(function(name) {
    var parts = name.split(' ');
    var last = parts.pop();
    return last + ', ' + parts.map(function(p) { return p.charAt(0) + '.'; }).join(' ');
  }).join(', ') : '';
  if (authors.length > 6) apaAuthors += ', ... ';
  formats['APA'] = apaAuthors + ' (' + year + '). ' + title + '. ' + (venue ? venue + '.' : '');

  // MLA
  var mlaAuthors = authors.length ? authors[0] : '';
  if (authors.length === 2) mlaAuthors += ', and ' + authors[1];
  if (authors.length > 2) mlaAuthors += ', et al.';
  formats['MLA'] = mlaAuthors + '. "' + title + '." ' + (venue ? venue + ', ' : '') + year + '.';

  // Chicago
  formats['Chicago'] = (authors.length ? authors.join(', ') : '') + '. "' + title + '." ' + (venue ? venue + ' ' : '') + '(' + year + ').';

  // IEEE
  var ieeeAuthors = authors.length ? authors.slice(0, 6).map(function(name) {
    var parts = name.split(' ');
    var last = parts.pop();
    return parts.map(function(p) { return p.charAt(0) + '.'; }).join(' ') + ' ' + last;
  }).join(', ') : '';
  formats['IEEE'] = ieeeAuthors + ', "' + title + '," ' + (venue ? venue + ', ' : '') + year + '.';

  // Harvard
  formats['Harvard'] = apaAuthors + ' (' + year + ') \'' + title + '\', ' + (venue ? venue + '.' : '');

  // Vancouver
  var vanAuthors = authors.length ? authors.slice(0, 6).map(function(name) {
    var parts = name.split(' ');
    var last = parts.pop();
    return last + ' ' + parts.map(function(p) { return p.charAt(0); }).join('');
  }).join(', ') : '';
  formats['Vancouver'] = vanAuthors + '. ' + title + '. ' + (venue ? venue + '. ' : '') + year + '.';

  return formats;
}
