// browse-nerd-panel.js — Lookup panel for Nerd Mode
// Registers panel tabs: Info, References, Authors, Related, Highlights, Search
// Depends on: core-nav.js, browse-paper.js, browse-pdf-viewer.js
import { icon } from '/js/core/icons.js';
import { registerPanelTabs } from '/js/core/core-nav.js';
import { _paperState, _s2Cache, _s2Fetch, _s2GetAuthor, _s2GetAuthorFull, _s2GetCitations, _extractArxivId, _s2LookupByArxivId, _s2SearchPaper } from '/js/browse/browse-paper.js';
import { _pdfViewerScrollToPage, _pdfViewerGetText } from '/js/browse/browse-pdf-viewer.js';
import { _nerdModeEnabled } from '/js/browse/browse-nerd-mode.js';

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
      { id: 'nerd-cited-by',   label: 'Cited By',   icon: icon('blockquote', { size: 14 }), render: _renderCitedByTab },
      { id: 'nerd-authors',    label: 'Authors',    icon: icon('user', { size: 14 }),      render: _renderAuthorsTab },
      { id: 'nerd-related',    label: 'Related',    icon: icon('research', { size: 14 }),  render: _renderRelatedTab },
      { id: 'nerd-highlights', label: 'Highlights', icon: icon('highlighter', { size: 14 }), render: _renderHighlightsTab },
      { id: 'nerd-code',       label: 'Code',       icon: icon('code', { size: 14 }),       render: _renderCodeTab },
      { id: 'nerd-search',     label: 'Search',     icon: icon('search', { size: 14 }),    render: _renderSearchTab },
    ],
    header: function(el) {
      AetherUI.append(Text('Nerd Mode').className('nerd-header-label'), el);
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
          authorDetails: [],
          citedBy: null
        });
        // Fetch author details
        _fetchAuthorDetails(tab, data);
        // Fetch citations
        if (data.paperId) {
          _s2GetCitations(data.paperId).then(function(citData) {
            var state = _paperState.get(tab.id);
            if (state && citData && citData.data) {
              state.citedBy = citData.data.map(function(c) { return c.citingPaper; }).filter(Boolean);
            }
          });
        }
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
                  authorDetails: [],
                  citedBy: null
                });
                _fetchAuthorDetails(tab, full);
                // Fetch citations
                if (full.paperId) {
                  _s2GetCitations(full.paperId).then(function(citData) {
                    var state = _paperState.get(tab.id);
                    if (state && citData && citData.data) {
                      state.citedBy = citData.data.map(function(c) { return c.citingPaper; }).filter(Boolean);
                    }
                  });
                }
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

function _renderRelatedTab(container) {
  ++_renderGeneration;
  var state = _getState();

  var wrap = new View('div').className('nerd-tab-wrap');

  if (!state || !state.s2Data || !state.s2Data.paperId) {
    wrap.add(Text('No paper identified').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  if (window.Skeleton) {
    wrap.add(window.Skeleton().lines(3));
  } else {
    wrap.add(Text('Loading recommendations...').className('nerd-empty'));
  }
  AetherUI.mount(wrap, container);

  _s2Fetch('https://api.semanticscholar.org/recommendations/v1/papers/forpaper/' + state.s2Data.paperId + '?limit=10&fields=title,authors,year,citationCount,venue').then(function(data) {
    var papers = data && data.recommendedPapers ? data.recommendedPapers : [];
    if (!papers.length) {
      AetherUI.mount(Text('No recommendations found').className('nerd-empty'), container);
      return;
    }

    var resultWrap = new View('div').className('nerd-tab-wrap');
    papers.forEach(function(paper) {
      var item = new View('div').className('nerd-paper-item');
      item.add(Text(paper.title || 'Untitled').className('nerd-paper-item-title line-clamp-2'));

      var m = [];
      if (paper.authors && paper.authors.length) {
        m.push(paper.authors.slice(0, 2).map(function(a) { return a.name; }).join(', ') + (paper.authors.length > 2 ? ' et al.' : ''));
      }
      if (paper.year) m.push(String(paper.year));
      if (paper.citationCount != null) m.push(paper.citationCount + ' cit.');
      if (paper.venue) m.push(paper.venue);
      if (m.length) {
        item.add(Text(m.join(' \u00b7 ')).className('nerd-paper-item-meta'));
      }

      item.onTap(function() {
        var url = 'https://www.semanticscholar.org/paper/' + paper.paperId;
        if (typeof window.browseNewTab === 'function') window.browseNewTab(url);
      });

      resultWrap.add(item);
    });
    AetherUI.mount(resultWrap, container);
  }).catch(function() {
    AetherUI.mount(Text('Failed to load recommendations').className('nerd-empty'), container);
  });
}

function _renderHighlightsTab(container) {
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

// ── Cited By Tab ──

function _renderCitedByTab(container) {
  var state = _getState();
  var gen = ++_renderGeneration;
  var wrap = new View('div').className('nerd-tab-wrap');

  if (!state || !state.s2Data || !state.s2Data.paperId) {
    wrap.add(Text('No paper identified').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  if (state.citedBy === null || state.citedBy === undefined) {
    // Still loading
    if (window.Skeleton) {
      wrap.add(window.Skeleton().lines(3));
    } else {
      wrap.add(Text('Loading citing papers...').className('nerd-empty'));
    }
    AetherUI.mount(wrap, container);
    setTimeout(function() { if (gen === _renderGeneration) _renderCitedByTab(container); }, 2000);
    return;
  }

  if (!state.citedBy.length) {
    wrap.add(Text('No citing papers found').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  wrap.add(Text(state.citedBy.length + ' citing paper' + (state.citedBy.length !== 1 ? 's' : '')).className('nerd-search-count'));

  state.citedBy.forEach(function(paper) {
    var item = new View('div').className('nerd-paper-item');
    item.add(Text(paper.title || 'Untitled').className('nerd-paper-item-title line-clamp-2'));

    var m = [];
    if (paper.authors && paper.authors.length) {
      m.push(paper.authors.slice(0, 3).map(function(a) { return a.name; }).join(', ') + (paper.authors.length > 3 ? ' et al.' : ''));
    }
    if (paper.year) m.push(String(paper.year));
    if (paper.citationCount != null) m.push(paper.citationCount + ' cit.');
    if (paper.venue) m.push(paper.venue);
    if (m.length) {
      item.add(Text(m.join(' \u00b7 ')).className('nerd-paper-item-meta'));
    }

    item.onTap(function() {
      var query = encodeURIComponent(paper.title);
      var url = 'https://scholar.google.com/scholar?q=' + query;
      if (typeof window.browseNewTab === 'function') window.browseNewTab(url);
    });

    wrap.add(item);
  });

  AetherUI.mount(wrap, container);
}

// ── Code Tab (Papers With Code + GitHub fallback) ──

function _searchPwc(title) {
  var query = encodeURIComponent(title);
  var _pwcFetch = function(url) {
    if (window.electronAPI && window.electronAPI.dbQuery) {
      return window.electronAPI.dbQuery('pwc-proxy', url);
    }
    return fetch(url).then(function(r) { return r.json(); });
  };
  return _pwcFetch('https://paperswithcode.com/api/v1/papers/?q=' + query + '&items_per_page=5')
    .then(function(data) {
      var results = data && data.results ? data.results : [];
      if (!results.length) return null;
      var cards = [];
      var pending = results.length;
      return new Promise(function(resolve) {
        results.forEach(function(paper) {
          _pwcFetch('https://paperswithcode.com/api/v1/papers/' + paper.id + '/repositories/')
            .then(function(repoData) {
              var repos = repoData && repoData.results ? repoData.results : [];
              repos.forEach(function(repo) {
                var repoName = repo.url ? repo.url.split('/').slice(-2).join('/') : 'Repository';
                var parts = [];
                if (repo.stars != null) parts.push(repo.stars + ' stars');
                if (repo.framework) parts.push(repo.framework);
                if (repo.is_official) parts.push('Official');
                cards.push({ name: repoName, meta: parts.join(' \u00b7 '), url: repo.url });
              });
              pending--;
              if (pending <= 0) resolve(cards.length ? cards : null);
            })
            .catch(function() {
              pending--;
              if (pending <= 0) resolve(cards.length ? cards : null);
            });
        });
      });
    })
    .catch(function() { return null; });
}

function _searchGithub(title) {
  var query = encodeURIComponent('"' + title + '"');
  var url = 'https://api.github.com/search/repositories?q=' + query + '&sort=stars&per_page=8';
  var _ghFetch = function(u) {
    if (window.electronAPI && window.electronAPI.dbQuery) {
      return window.electronAPI.dbQuery('github-proxy', u);
    }
    return fetch(u, { headers: { 'Accept': 'application/vnd.github.v3+json' } }).then(function(r) { return r.json(); });
  };
  return _ghFetch(url).then(function(data) {
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

function _renderCodeTab(container) {
  ++_renderGeneration;
  var state = _getState();
  var wrap = new View('div').className('nerd-tab-wrap');

  if (!state || !state.s2Data || !state.s2Data.title) {
    wrap.add(Text('No paper identified').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  wrap.add(Text('Searching for implementations...').className('nerd-empty'));
  AetherUI.mount(wrap, container);

  var title = state.s2Data.title;
  _searchPwc(title).then(function(pwcCards) {
    if (pwcCards && pwcCards.length) {
      var repoWrap = new View('div').className('nerd-tab-wrap');
      pwcCards.forEach(function(c) {
        var card = new View('div').className('nerd-repo-card').add(
          Text(c.name).className('nerd-repo-name'),
          Text(c.meta).className('nerd-repo-meta')
        ).onTap(function() {
          if (typeof window.browseNewTab === 'function') window.browseNewTab(c.url);
        });
        repoWrap.add(card);
      });
      AetherUI.mount(repoWrap, container);
      return;
    }
    // Fallback to GitHub
    _searchGithub(title).then(function(ghRepos) {
      if (!ghRepos || !ghRepos.length) {
        AetherUI.mount(Text('No implementations found').className('nerd-empty'), container);
        return;
      }
      var ghWrap = new View('div').className('nerd-tab-wrap');
      ghRepos.forEach(function(repo) {
        var meta = [];
        if (repo.stars != null) meta.push(repo.stars + ' stars');
        if (repo.language) meta.push(repo.language);
        if (repo.forks != null) meta.push(repo.forks + ' forks');
        var card = new View('div').className('nerd-repo-card').add(
          Text(repo.name).className('nerd-repo-name'),
          Text(repo.description).className('nerd-repo-desc line-clamp-2'),
          Text(meta.join(' \u00b7 ')).className('nerd-repo-meta')
        ).onTap(function() {
          if (typeof window.browseNewTab === 'function') window.browseNewTab(repo.url);
        });
        ghWrap.add(card);
      });
      AetherUI.mount(ghWrap, container);
    });
  });
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
