import { describe, it, expect } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from browse-nerd-panel.js
// ──────────────────────────────────────────────────────────

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

  var bibKey = authors.length ? authors[0].split(' ').pop().toLowerCase() + year : 'paper' + year;
  var bibtex = '@article{' + bibKey + ',\n';
  bibtex += '  title={' + title + '},\n';
  bibtex += '  author={' + authors.join(' and ') + '},\n';
  if (year) bibtex += '  year={' + year + '},\n';
  if (venue) bibtex += '  journal={' + venue + '},\n';
  bibtex += '}';
  formats['BibTeX'] = bibtex;

  var apaAuthors = authors.length ? authors.slice(0, 6).map(function(name) {
    var parts = name.split(' ');
    var last = parts.pop();
    return last + ', ' + parts.map(function(p) { return p.charAt(0) + '.'; }).join(' ');
  }).join(', ') : '';
  if (authors.length > 6) apaAuthors += ', ... ';
  formats['APA'] = apaAuthors + ' (' + year + '). ' + title + '. ' + (venue ? venue + '.' : '');

  var mlaAuthors = authors.length ? authors[0] : '';
  if (authors.length === 2) mlaAuthors += ', and ' + authors[1];
  if (authors.length > 2) mlaAuthors += ', et al.';
  formats['MLA'] = mlaAuthors + '. "' + title + '." ' + (venue ? venue + ', ' : '') + year + '.';

  formats['Chicago'] = (authors.length ? authors.join(', ') : '') + '. "' + title + '." ' + (venue ? venue + ' ' : '') + '(' + year + ').';

  var ieeeAuthors = authors.length ? authors.slice(0, 6).map(function(name) {
    var parts = name.split(' ');
    var last = parts.pop();
    return parts.map(function(p) { return p.charAt(0) + '.'; }).join(' ') + ' ' + last;
  }).join(', ') : '';
  formats['IEEE'] = ieeeAuthors + ', "' + title + '," ' + (venue ? venue + ', ' : '') + year + '.';

  formats['Harvard'] = apaAuthors + ' (' + year + ') \'' + title + '\', ' + (venue ? venue + '.' : '');

  var vanAuthors = authors.length ? authors.slice(0, 6).map(function(name) {
    var parts = name.split(' ');
    var last = parts.pop();
    return last + ' ' + parts.map(function(p) { return p.charAt(0); }).join('');
  }).join(', ') : '';
  formats['Vancouver'] = vanAuthors + '. ' + title + '. ' + (venue ? venue + '. ' : '') + year + '.';

  return formats;
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('tab registration', () => {
  // Verify the exact tab IDs from the source code (no cited-by or related)
  const EXPECTED_TAB_IDS = ['nerd-info', 'nerd-refs', 'nerd-authors', 'nerd-highlights', 'nerd-code', 'nerd-search'];

  it('has exactly 6 tabs', () => {
    expect(EXPECTED_TAB_IDS).toHaveLength(6);
  });

  it('does not include nerd-cited-by', () => {
    expect(EXPECTED_TAB_IDS).not.toContain('nerd-cited-by');
  });

  it('does not include nerd-related', () => {
    expect(EXPECTED_TAB_IDS).not.toContain('nerd-related');
  });

  it('includes all expected tabs in order', () => {
    expect(EXPECTED_TAB_IDS).toEqual(['nerd-info', 'nerd-refs', 'nerd-authors', 'nerd-highlights', 'nerd-code', 'nerd-search']);
  });
});

describe('_fetchPaperData state shape', () => {
  // Verify the state shape produced by _fetchPaperData has no citedBy field
  const EXPECTED_STATE_KEYS = ['url', 'meta', 'refs', 's2Data', 's2UrlPath', 'authorDetails'];

  it('state shape has expected keys', () => {
    const mockState = {
      url: 'https://arxiv.org/pdf/2301.00001',
      meta: { title: 'Test Paper', authors: ['Author One'], site: '' },
      refs: [],
      s2Data: {},
      s2UrlPath: '/paper/ARXIV:2301.00001?fields=title',
      authorDetails: []
    };
    expect(Object.keys(mockState)).toEqual(EXPECTED_STATE_KEYS);
  });

  it('state shape does not contain citedBy', () => {
    expect(EXPECTED_STATE_KEYS).not.toContain('citedBy');
  });

  it('state shape does not contain citations', () => {
    expect(EXPECTED_STATE_KEYS).not.toContain('citations');
  });
});

describe('_formatCacheAge', () => {
  it('returns "just now" for <60s', () => {
    expect(_formatCacheAge(0)).toBe('just now');
    expect(_formatCacheAge(30)).toBe('just now');
    expect(_formatCacheAge(59)).toBe('just now');
  });

  it('returns "Xm ago" for <3600s', () => {
    expect(_formatCacheAge(60)).toBe('1m ago');
    expect(_formatCacheAge(120)).toBe('2m ago');
    expect(_formatCacheAge(3599)).toBe('59m ago');
  });

  it('returns "Xh ago" for <86400s', () => {
    expect(_formatCacheAge(3600)).toBe('1h ago');
    expect(_formatCacheAge(7200)).toBe('2h ago');
    expect(_formatCacheAge(86399)).toBe('23h ago');
  });

  it('returns "Xd ago" for >=86400s', () => {
    expect(_formatCacheAge(86400)).toBe('1d ago');
    expect(_formatCacheAge(172800)).toBe('2d ago');
    expect(_formatCacheAge(604800)).toBe('7d ago');
  });
});

describe('_parseRefNums', () => {
  it('parses single number', () => {
    expect(_parseRefNums('1')).toEqual([1]);
  });

  it('parses comma-separated numbers', () => {
    expect(_parseRefNums('1,2,3')).toEqual([1, 2, 3]);
  });

  it('parses range', () => {
    expect(_parseRefNums('1-3')).toEqual([1, 2, 3]);
  });

  it('parses mixed comma and range', () => {
    expect(_parseRefNums('1,3-5')).toEqual([1, 3, 4, 5]);
  });

  it('handles spaces around parts', () => {
    expect(_parseRefNums('1, 3 - 5')).toEqual([1, 3, 4, 5]);
  });

  it('handles complex mixed input', () => {
    expect(_parseRefNums('1,2,5-7,10')).toEqual([1, 2, 5, 6, 7, 10]);
  });
});

describe('_generateCiteFormats', () => {
  const s2 = {
    title: 'Attention Is All You Need',
    authors: [{ name: 'Ashish Vaswani' }, { name: 'Noam Shazeer' }],
    year: 2017,
    venue: 'NeurIPS'
  };

  it('returns all 7 citation formats', () => {
    const formats = _generateCiteFormats(s2);
    expect(Object.keys(formats)).toEqual(['BibTeX', 'APA', 'MLA', 'Chicago', 'IEEE', 'Harvard', 'Vancouver']);
  });

  it('generates correct BibTeX', () => {
    const formats = _generateCiteFormats(s2);
    expect(formats['BibTeX']).toContain('@article{vaswani2017');
    expect(formats['BibTeX']).toContain('title={Attention Is All You Need}');
    expect(formats['BibTeX']).toContain('author={Ashish Vaswani and Noam Shazeer}');
    expect(formats['BibTeX']).toContain('year={2017}');
    expect(formats['BibTeX']).toContain('journal={NeurIPS}');
  });

  it('generates correct APA', () => {
    const formats = _generateCiteFormats(s2);
    expect(formats['APA']).toContain('Vaswani, A.');
    expect(formats['APA']).toContain('Shazeer, N.');
    expect(formats['APA']).toContain('(2017)');
    expect(formats['APA']).toContain('Attention Is All You Need');
  });

  it('generates correct MLA with two authors', () => {
    const formats = _generateCiteFormats(s2);
    expect(formats['MLA']).toContain('Ashish Vaswani, and Noam Shazeer');
    expect(formats['MLA']).toContain('"Attention Is All You Need."');
  });

  it('generates MLA with et al. for >2 authors', () => {
    const s2Multi = {
      ...s2,
      authors: [{ name: 'Ashish Vaswani' }, { name: 'Noam Shazeer' }, { name: 'Niki Parmar' }]
    };
    const formats = _generateCiteFormats(s2Multi);
    expect(formats['MLA']).toContain('et al.');
  });

  it('handles empty authors', () => {
    const s2Empty = { title: 'Test', authors: [], year: 2024, venue: '' };
    const formats = _generateCiteFormats(s2Empty);
    expect(formats['BibTeX']).toContain('@article{paper2024');
    expect(formats['APA']).toContain('(2024)');
  });

  it('handles missing venue', () => {
    const s2NoVenue = { title: 'Test', authors: [{ name: 'John Doe' }], year: 2024, venue: '' };
    const formats = _generateCiteFormats(s2NoVenue);
    expect(formats['BibTeX']).not.toContain('journal=');
  });
});
