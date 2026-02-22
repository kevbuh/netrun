// browse-nerd-panel.js — Lookup panel for Nerd Mode
// Registers panel tabs: Info, References, Authors, Related, Highlights, Search
// Depends on: core-nav.js, browse-paper.js, browse-pdf-viewer.js
import { icon } from '/js/core/icons.js';
import { registerPanelTabs } from '/js/core/core-nav.js';
import { _paperState, _s2Fetch, _s2GetAuthor, _s2GetAuthorFull, _extractArxivId, _s2LookupByArxivId, _s2SearchPaper } from '/js/browse/browse-paper.js';
import { _pdfViewerScrollToPage, _pdfViewerGetText } from '/js/browse/browse-pdf-viewer.js';
import { _nerdModeEnabled } from '/js/browse/browse-nerd-mode.js';

// ── State ──
var _registered = false;
var _currentTab = null;

// ── Register ──

export function _nerdPanelRegister() {
  if (_registered) return;
  _registered = true;

  registerPanelTabs('browse', {
    tabs: [
      { id: 'nerd-info',       label: 'Info',       icon: icon('fileText', { size: 14 }),  render: _renderInfoTab },
      { id: 'nerd-refs',       label: 'References',  icon: icon('link', { size: 14 }),     render: _renderRefsTab },
      { id: 'nerd-authors',    label: 'Authors',    icon: icon('user', { size: 14 }),      render: _renderAuthorsTab },
      { id: 'nerd-related',    label: 'Related',    icon: icon('research', { size: 14 }),  render: _renderRelatedTab },
      { id: 'nerd-highlights', label: 'Highlights', icon: icon('highlighter', { size: 14 }), render: _renderHighlightsTab },
      { id: 'nerd-code',       label: 'Code',       icon: icon('code', { size: 14 }),       render: _renderCodeTab },
      { id: 'nerd-search',     label: 'Search',     icon: icon('search', { size: 14 }),    render: _renderSearchTab },
    ],
    header: function(el) {
      var h = document.createElement('div');
      h.className = 'nerd-header-label';
      h.textContent = 'Nerd Mode';
      el.appendChild(h);
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
    _s2LookupByArxivId(arxivId).then(function(data) {
      if (data) {
        _paperState.set(tab.id, {
          url: tab.url,
          meta: { title: data.title, authors: (data.authors || []).map(function(a) { return a.name; }), site: '' },
          refs: data.references || null,
          s2Data: data,
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
            _s2Fetch('/paper/' + paperId + '?fields=title,authors,citationCount,year,venue,abstract,references.title,references.authors,references.year,references.citationCount,references.venue').then(function(full) {
              if (full) {
                _paperState.set(tab.id, {
                  url: tab.url,
                  meta: { title: full.title, authors: (full.authors || []).map(function(a) { return a.name; }), site: '' },
                  refs: full.references || null,
                  s2Data: full,
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
  container.innerHTML = '';
  var tab = _getTab();
  var state = _getState();

  var wrap = document.createElement('div');
  wrap.className = 'nerd-tab-wrap';

  if (!state || !state.s2Data) {
    wrap.innerHTML = '<div class="nerd-empty">Loading paper info...</div>';
    container.appendChild(wrap);
    if (tab) {
      setTimeout(function() { _renderInfoTab(container); }, 2000);
    }
    return;
  }

  var s2 = state.s2Data;

  // Title
  var title = document.createElement('div');
  title.className = 'nerd-info-title';
  title.textContent = s2.title || state.meta.title || 'Unknown Title';
  wrap.appendChild(title);

  // Meta line (year, venue, citations)
  var meta = [];
  if (s2.year) meta.push(String(s2.year));
  if (s2.venue) meta.push(s2.venue);
  if (s2.citationCount != null) meta.push(s2.citationCount + ' citations');
  if (meta.length) {
    var metaEl = document.createElement('div');
    metaEl.className = 'nerd-info-meta';
    metaEl.textContent = meta.join(' \u00b7 ');
    wrap.appendChild(metaEl);
  }

  // Authors
  var authors = s2.authors || [];
  if (authors.length) {
    var authorsEl = document.createElement('div');
    authorsEl.className = 'nerd-info-authors';
    authorsEl.textContent = authors.map(function(a) { return a.name; }).join(', ');
    wrap.appendChild(authorsEl);
  }

  // Abstract
  if (s2.abstract) {
    var abstractSection = document.createElement('div');
    abstractSection.className = 'nerd-section';
    var absTitle = document.createElement('div');
    absTitle.className = 'nerd-section-title';
    absTitle.textContent = 'Abstract';
    abstractSection.appendChild(absTitle);
    var absBody = document.createElement('div');
    absBody.className = 'nerd-section-body';
    absBody.textContent = s2.abstract;
    abstractSection.appendChild(absBody);
    wrap.appendChild(abstractSection);
  }

  // Citation formats
  var citeSection = document.createElement('div');
  citeSection.className = 'nerd-section';
  var citeSectionTitle = document.createElement('div');
  citeSectionTitle.className = 'nerd-section-title';
  citeSectionTitle.textContent = 'Cite';
  citeSection.appendChild(citeSectionTitle);

  var citeFormats = _generateCiteFormats(s2);
  Object.keys(citeFormats).forEach(function(fmt) {
    var row = document.createElement('div');
    row.className = 'nerd-cite-row';

    var label = document.createElement('div');
    label.className = 'nerd-cite-label';
    label.textContent = fmt;
    row.appendChild(label);

    var citeBox = document.createElement('div');
    citeBox.className = 'nerd-cite-box';
    citeBox.textContent = citeFormats[fmt];
    citeBox.title = 'Click to copy';
    citeBox.addEventListener('click', function() {
      navigator.clipboard.writeText(citeFormats[fmt]).then(function() {
        var accent = getComputedStyle(document.documentElement).getPropertyValue('--nr-accent').trim();
        if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse(accent || '#3b82f6');
      }).catch(function() {});
      if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Copied ' + fmt);
    });
    row.appendChild(citeBox);
    citeSection.appendChild(row);
  });

  wrap.appendChild(citeSection);
  container.appendChild(wrap);
}

function _renderRefsTab(container) {
  container.innerHTML = '';
  var state = _getState();

  var wrap = document.createElement('div');
  wrap.className = 'nerd-tab-wrap';

  if (!state || !state.refs || !state.refs.length) {
    wrap.innerHTML = '<div class="nerd-empty">No references available</div>';
    container.appendChild(wrap);
    return;
  }

  state.refs.forEach(function(ref) {
    var item = document.createElement('div');
    item.className = 'nerd-paper-item';

    var refTitle = document.createElement('div');
    refTitle.className = 'nerd-paper-item-title line-clamp-2';
    refTitle.textContent = ref.title || 'Untitled';
    item.appendChild(refTitle);

    var refMeta = [];
    if (ref.authors && ref.authors.length) {
      refMeta.push(ref.authors.slice(0, 3).map(function(a) { return a.name; }).join(', ') + (ref.authors.length > 3 ? ' et al.' : ''));
    }
    if (ref.year) refMeta.push(String(ref.year));
    if (ref.citationCount != null) refMeta.push(ref.citationCount + ' cit.');
    if (refMeta.length) {
      var metaDiv = document.createElement('div');
      metaDiv.className = 'nerd-paper-item-meta';
      metaDiv.textContent = refMeta.join(' \u00b7 ');
      item.appendChild(metaDiv);
    }

    item.addEventListener('click', function() {
      var query = encodeURIComponent(ref.title);
      var url = 'https://scholar.google.com/scholar?q=' + query;
      if (typeof window.browseNewTab === 'function') window.browseNewTab(url);
    });

    wrap.appendChild(item);
  });

  container.appendChild(wrap);
}

function _renderAuthorsTab(container) {
  container.innerHTML = '';
  var state = _getState();

  var wrap = document.createElement('div');
  wrap.className = 'nerd-tab-wrap';

  if (!state || !state.s2Data || !state.s2Data.authors || !state.s2Data.authors.length) {
    wrap.innerHTML = '<div class="nerd-empty">No author data available</div>';
    container.appendChild(wrap);
    return;
  }

  var authors = state.s2Data.authors;
  var details = state.authorDetails || [];
  var detailMap = {};
  details.forEach(function(d) { if (d && d.authorId) detailMap[d.authorId] = d; });

  authors.forEach(function(author) {
    var card = document.createElement('div');
    card.className = 'nerd-author-card';
    card.addEventListener('click', function() {
      if (author.authorId) {
        var url = 'https://www.semanticscholar.org/author/' + author.authorId;
        if (typeof window.browseNewTab === 'function') window.browseNewTab(url);
      }
    });

    // Avatar with initials
    var avatar = document.createElement('div');
    avatar.className = 'author-card-avatar';
    var initials = (author.name || '').split(' ').map(function(w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    avatar.textContent = initials;
    card.appendChild(avatar);

    var info = document.createElement('div');
    info.className = 'author-card-info';

    var name = document.createElement('div');
    name.className = 'author-card-name';
    name.textContent = author.name || 'Unknown';
    info.appendChild(name);

    // Detailed stats
    var detail = detailMap[author.authorId];
    if (detail) {
      // Affiliations
      if (detail.affiliations && detail.affiliations.length) {
        var affEl = document.createElement('div');
        affEl.style.cssText = 'font-size:0.68rem;color:var(--nr-text-tertiary);margin-top:1px;';
        affEl.textContent = detail.affiliations.join(', ');
        info.appendChild(affEl);
      }
      var stats = [];
      if (detail.hIndex != null) stats.push('h-index: ' + detail.hIndex);
      if (detail.citationCount != null) stats.push(detail.citationCount.toLocaleString() + ' citations');
      if (detail.paperCount != null) stats.push(detail.paperCount + ' papers');
      if (stats.length) {
        var statsEl = document.createElement('div');
        statsEl.className = 'author-card-stats';
        statsEl.textContent = stats.join(' \u00b7 ');
        info.appendChild(statsEl);
      }

      // h-index badge — unified accent color
      if (detail.hIndex != null) {
        var badge = document.createElement('span');
        badge.className = 'nerd-badge';
        if (detail.hIndex >= 50) badge.textContent = 'Highly cited';
        else if (detail.hIndex >= 20) badge.textContent = 'Established';
        else if (detail.hIndex >= 5) badge.textContent = 'Active';
        else badge.textContent = 'Early career';
        info.appendChild(badge);
      }
    }

    card.appendChild(info);
    wrap.appendChild(card);
  });

  container.appendChild(wrap);
}

function _renderRelatedTab(container) {
  container.innerHTML = '';
  var state = _getState();

  var wrap = document.createElement('div');
  wrap.className = 'nerd-tab-wrap';

  if (!state || !state.s2Data || !state.s2Data.paperId) {
    wrap.innerHTML = '<div class="nerd-empty">No paper identified</div>';
    container.appendChild(wrap);
    return;
  }

  wrap.innerHTML = '<div class="nerd-empty">Loading recommendations...</div>';
  container.appendChild(wrap);

  _s2Fetch('https://api.semanticscholar.org/recommendations/v1/papers/forpaper/' + state.s2Data.paperId + '?limit=10&fields=title,authors,year,citationCount,venue').then(function(data) {
    wrap.innerHTML = '';
    var papers = data && data.recommendedPapers ? data.recommendedPapers : [];
    if (!papers.length) {
      wrap.innerHTML = '<div class="nerd-empty">No recommendations found</div>';
      return;
    }

    papers.forEach(function(paper) {
      var item = document.createElement('div');
      item.className = 'nerd-paper-item';

      var t = document.createElement('div');
      t.className = 'nerd-paper-item-title line-clamp-2';
      t.textContent = paper.title || 'Untitled';
      item.appendChild(t);

      var m = [];
      if (paper.authors && paper.authors.length) {
        m.push(paper.authors.slice(0, 2).map(function(a) { return a.name; }).join(', ') + (paper.authors.length > 2 ? ' et al.' : ''));
      }
      if (paper.year) m.push(String(paper.year));
      if (paper.citationCount != null) m.push(paper.citationCount + ' cit.');
      if (paper.venue) m.push(paper.venue);
      if (m.length) {
        var metaDiv = document.createElement('div');
        metaDiv.className = 'nerd-paper-item-meta';
        metaDiv.textContent = m.join(' \u00b7 ');
        item.appendChild(metaDiv);
      }

      item.addEventListener('click', function() {
        var url = 'https://www.semanticscholar.org/paper/' + paper.paperId;
        if (typeof window.browseNewTab === 'function') window.browseNewTab(url);
      });

      wrap.appendChild(item);
    });
  }).catch(function() {
    wrap.innerHTML = '<div class="nerd-empty">Failed to load recommendations</div>';
  });
}

function _renderHighlightsTab(container) {
  container.innerHTML = '';
  var tab = _getTab();

  var wrap = document.createElement('div');
  wrap.className = 'nerd-tab-wrap';

  if (!tab || !tab._pdfHighlights || !tab._pdfHighlights.length) {
    wrap.innerHTML = '<div class="nerd-empty">No highlights yet. Select text in the PDF to highlight.</div>';
    container.appendChild(wrap);
    return;
  }

  tab._pdfHighlights.forEach(function(hl, idx) {
    var card = document.createElement('div');
    card.className = 'pdf-hl-card';

    var header = document.createElement('div');
    header.className = 'pdf-hl-card-header';
    header.addEventListener('click', function() {
      if (tab && hl.pageNum) _pdfViewerScrollToPage(tab, hl.pageNum);
    });

    var badge = document.createElement('div');
    badge.className = 'pdf-hl-card-badge';
    badge.style.background = hl.color || 'rgba(255,235,59,0.6)';
    badge.textContent = String(idx + 1);
    header.appendChild(badge);

    var text = document.createElement('div');
    text.className = 'pdf-hl-card-text';
    text.textContent = hl.text || '';
    header.appendChild(text);

    var page = document.createElement('div');
    page.className = 'pdf-hl-card-page';
    page.textContent = 'p. ' + hl.pageNum;
    header.appendChild(page);

    var del = document.createElement('button');
    del.className = 'pdf-hl-card-del';
    del.textContent = '\u00d7';
    del.addEventListener('click', function(e) {
      e.stopPropagation();
      if (typeof window._pdfViewerRemoveHighlight === 'function') {
        window._pdfViewerRemoveHighlight(tab, idx);
      }
      _renderHighlightsTab(container);
    });
    header.appendChild(del);

    card.appendChild(header);

    // Reference cross-linking: scan for [n] patterns
    var state = _getState();
    var refPattern = /\[(\d+(?:[,\-]\d+)*)\]/g;
    var match;
    while ((match = refPattern.exec(hl.text)) !== null) {
      var refNums = _parseRefNums(match[1]);
      refNums.forEach(function(num) {
        if (state && state.refs && state.refs[num - 1]) {
          var refLink = document.createElement('div');
          refLink.style.cssText = 'font-size:0.68rem;color:var(--nr-accent);cursor:pointer;padding:2px 0;';
          refLink.textContent = '[' + num + '] ' + state.refs[num - 1].title;
          refLink.addEventListener('click', function(e) {
            e.stopPropagation();
            var query = encodeURIComponent(state.refs[num - 1].title);
            if (typeof window.browseNewTab === 'function') window.browseNewTab('https://scholar.google.com/scholar?q=' + query);
          });
          card.appendChild(refLink);
        }
      });
    }

    // Note textarea
    var note = document.createElement('textarea');
    note.className = 'pdf-hl-card-note';
    note.rows = 1;
    note.placeholder = 'Add a note...';
    note.value = hl.note || '';
    note.addEventListener('input', function() {
      hl.note = note.value;
    });
    card.appendChild(note);

    wrap.appendChild(card);
  });

  container.appendChild(wrap);
}

function _renderSearchTab(container) {
  container.innerHTML = '';
  var tab = _getTab();

  var wrap = document.createElement('div');
  wrap.className = 'nerd-search-wrap';

  // Search input
  var inputRow = document.createElement('div');
  inputRow.className = 'nerd-search-input-row';
  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search document text...';
  input.className = 'nerd-search-input';
  inputRow.appendChild(input);
  wrap.appendChild(inputRow);

  // Results area
  var results = document.createElement('div');
  results.className = 'nerd-search-results';
  results.innerHTML = '<div class="nerd-empty">Type to search the full document</div>';
  wrap.appendChild(results);

  container.appendChild(wrap);

  var searchTimer = null;
  input.addEventListener('input', function() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function() {
      var query = input.value.trim();
      if (!query || !tab || !tab._pdfDoc) {
        results.innerHTML = '<div class="nerd-empty">Type to search the full document</div>';
        return;
      }
      results.innerHTML = '<div class="nerd-empty">Searching...</div>';
      _searchFullText(tab, query, results);
    }, 400);
  });

  setTimeout(function() { input.focus(); }, 100);
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
    results.innerHTML = '';
    if (!matches.length) {
      results.innerHTML = '<div class="nerd-empty">No matches found</div>';
      return;
    }

    var countEl = document.createElement('div');
    countEl.className = 'nerd-search-count';
    countEl.textContent = matches.length + ' match' + (matches.length !== 1 ? 'es' : '') + ' found';
    results.appendChild(countEl);

    matches.forEach(function(m) {
      var item = document.createElement('div');
      item.className = 'nerd-paper-item';

      var page = document.createElement('div');
      page.className = 'nerd-search-page';
      page.textContent = 'Page ' + m.pageNum;
      item.appendChild(page);

      var snippet = document.createElement('div');
      snippet.className = 'nerd-search-snippet';
      snippet.textContent = m.snippet;
      item.appendChild(snippet);

      item.addEventListener('click', function() {
        _pdfViewerScrollToPage(tab, m.pageNum);
      });

      results.appendChild(item);
    });
  });
}

// ── Code Tab (Papers With Code) ──

function _renderCodeTab(container) {
  container.innerHTML = '';
  var state = _getState();
  var wrap = document.createElement('div');
  wrap.className = 'nerd-tab-wrap';

  if (!state || !state.s2Data || !state.s2Data.title) {
    wrap.innerHTML = '<div class="nerd-empty">No paper identified</div>';
    container.appendChild(wrap);
    return;
  }

  wrap.innerHTML = '<div class="nerd-empty">Searching for implementations...</div>';
  container.appendChild(wrap);

  var query = encodeURIComponent(state.s2Data.title);
  fetch('https://paperswithcode.com/api/v1/papers/?q=' + query + '&items_per_page=5')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      wrap.innerHTML = '';
      var results = data && data.results ? data.results : [];
      if (!results.length) {
        wrap.innerHTML = '<div class="nerd-empty">No implementations found</div>';
        return;
      }
      var foundAny = false;
      var pending = results.length;
      results.forEach(function(paper) {
        fetch('https://paperswithcode.com/api/v1/papers/' + paper.id + '/repositories/')
          .then(function(r) { return r.json(); })
          .then(function(repoData) {
            var repos = repoData && repoData.results ? repoData.results : [];
            repos.forEach(function(repo) {
              foundAny = true;
              var card = document.createElement('div');
              card.className = 'nerd-repo-card';

              var name = document.createElement('div');
              name.className = 'nerd-repo-name';
              name.textContent = repo.url ? repo.url.split('/').slice(-2).join('/') : 'Repository';
              card.appendChild(name);

              var meta = document.createElement('div');
              meta.className = 'nerd-repo-meta';
              var parts = [];
              if (repo.stars != null) parts.push(repo.stars + ' stars');
              if (repo.framework) parts.push(repo.framework);
              if (repo.is_official) parts.push('Official');
              meta.textContent = parts.join(' \u00b7 ');
              card.appendChild(meta);

              card.addEventListener('click', function() {
                if (typeof window.browseNewTab === 'function') window.browseNewTab(repo.url);
              });
              wrap.appendChild(card);
            });
            pending--;
            if (pending <= 0 && !foundAny) {
              wrap.innerHTML = '<div class="nerd-empty">No implementations found</div>';
            }
          })
          .catch(function() { pending--; });
      });
    })
    .catch(function() {
      wrap.innerHTML = '<div class="nerd-empty">Failed to search implementations</div>';
    });
}

// ── Helpers ──

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
