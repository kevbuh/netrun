// ── Feed filtering, sorting, view modes, source bubbles, trends, algorithm view ──

import Settings from '/js/core/core-settings.js';
import { escapeHtml, stripHtml, getPaperRatings, getPaperRating, _normalizeRatingKey, renderStarRating } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { FEED_CAT_MAP, FEED_CATALOG, getSourceChip, SOURCE_NAMES, SOURCE_LOGO_INLINE } from '/js/core/core-views.js';
import { allPapers, allCategories, hiddenSourceFilters, PAGE_SIZE, getHiddenPosts, getReadPosts, getBlockedWords, getSourceAffinity, getInterestProfile, _computeContentScore } from '/js/feed/feed-data.js';

// ── Sort / View state ──

export let currentSort = 'foryou';
export let visibleCount = PAGE_SIZE;
export function setVisibleCount(n) { visibleCount = n; }
export let feedViewMode = 'block'; // 'block', 'verbose', 'twitter', or 'compact'
export const _viewModes = ['block', 'verbose', 'twitter', 'compact'];
export const _viewModeIcons = {
  block: '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>',
  verbose: '<path d="M4 5h16v2H4zm0 4h16v2H4zm0 4h10v2H4zm0 4h16v2H4z"/>',
  twitter: '<path d="M22.46 6c-.77.35-1.6.58-2.46.69a4.3 4.3 0 001.88-2.38 8.59 8.59 0 01-2.72 1.04A4.28 4.28 0 0015.86 4c-2.37 0-4.29 1.92-4.29 4.29 0 .34.04.67.1.98C8.28 9.09 5.11 7.38 3 4.79a4.28 4.28 0 001.33 5.72A4.26 4.26 0 012.8 10v.05a4.29 4.29 0 003.44 4.2 4.27 4.27 0 01-1.93.07 4.29 4.29 0 004 2.98A8.6 8.6 0 012 19.54a12.13 12.13 0 006.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.72 0 0024 6.56a8.49 8.49 0 01-2.54.7z"/>',
  compact: '<path d="M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z"/>',
};

export function toggleViewMode() {
  const idx = _viewModes.indexOf(feedViewMode);
  feedViewMode = _viewModes[(idx + 1) % _viewModes.length];
  const iconEl = document.getElementById('view-mode-icon');
  if (iconEl) {
    const svg = RawHTML('<svg id="view-mode-icon" class="w-4 h-4 fill-current" viewBox="0 0 24 24">' + _viewModeIcons[feedViewMode] + '</svg>');
    iconEl.replaceWith(svg.el);
  }
  window.renderPapers();
}

// ── Source bubbles ──

export function toggleSourceBubble(key) {
  if (hiddenSourceFilters.has(key)) hiddenSourceFilters.delete(key);
  else hiddenSourceFilters.add(key);
  renderSourceBubbles();
  window.renderPapers();
}

export function renderSourceBubbles() {
  const el = document.getElementById('source-bubbles');
  if (!el) return;
  const sourceCounts = {};
  for (let _i = 0; _i < allPapers.length; _i++) {
    const _p = allPapers[_i];
    sourceCounts[_p.source] = (sourceCounts[_p.source] || 0) + 1;
  }
  const sources = Object.keys(sourceCounts);
  const catSelect = document.getElementById('category');
  const currentCat = catSelect ? catSelect.value : '';
  const bubbleViews = [];

  sources.forEach(function(key) {
    const entry = FEED_CATALOG.find(function(f) { return f.key === key; });
    const name = entry ? entry.name : (key.startsWith('custom:') ? key.slice(7) : key);
    const logo = SOURCE_LOGO_INLINE[key] || '';
    const count = sourceCounts[key];
    const dimmed = hiddenSourceFilters.has(key);

    if (key === 'arxiv' && catSelect) {
      const opts = Array.from(catSelect.options);
      const selectOpts = opts.map(function(o) {
        const label = o.value ? o.textContent : 'arXiv (' + count + ')';
        return '<option value="' + escapeHtml(o.value) + '"' + (o.value === currentCat ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
      }).join('');
      const arxivBubble = window.RawHTML('<span class="inline-flex items-center rounded-full border ' + (dimmed ? 'border-border-subtle bg-card opacity-40' : 'border-accent bg-accent/15') + ' text-[0.78rem] transition-all duration-150 whitespace-nowrap select-none"><span class="inline-flex items-center pl-2.5 pointer-events-none">' + logo + '</span><select class="arxiv-cat-select bg-transparent border-none text-[0.78rem] ' + (dimmed ? 'text-dim' : 'text-primary') + ' cursor-pointer outline-none appearance-none py-1 pl-1 pr-5" onchange="document.getElementById(\'category\').value=this.value; renderPapers(); renderSourceBubbles(); _fitArxivSelect(this)">' + selectOpts + '</select></span>');
      bubbleViews.push(arxivBubble);
    } else {
      const bubble = window.HStack(
        logo ? window.RawHTML(logo) : null,
        window.Text(name).className(dimmed ? 'text-dim' : 'text-primary'),
        window.Text(String(count)).className('text-[0.68rem] ' + (dimmed ? 'text-dimmer' : 'text-dim'))
      ).spacing(1).className('inline-flex items-center px-2.5 py-1 rounded-full border ' + (dimmed ? 'border-border-subtle bg-card opacity-40' : 'border-accent bg-accent/15') + ' text-[0.78rem] cursor-pointer transition-all duration-150 whitespace-nowrap select-none')
        .onTap(function() { toggleSourceBubble(key); });
      bubbleViews.push(bubble);
    }
  });

  const wrap = HStack(bubbleViews).className('flex-wrap gap-1.5');
  AetherUI.mount(wrap, el);
  // Auto-size the arxiv select after rendering
  const arxivSel = el.querySelector('.arxiv-cat-select');
  if (arxivSel) _fitArxivSelect(arxivSel);
}

export function _fitArxivSelect(sel) {
  const span = new View('span').styles({ position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', fontSize: '0.78rem' });
  span.el.textContent = sel.options[sel.selectedIndex].text;
  AetherUI.append(span, document.body);
  sel.style.width = (span.el.offsetWidth + 24) + 'px'; // 24px for chevron padding
  span.el.remove();
}

// ── Sort mode ──

export function setSortMode(mode) {
  currentSort = mode;
  const citBtn = document.getElementById('sort-citations');
  if (citBtn) citBtn.classList.toggle('active', mode === 'citations');
  const fyBtn = document.getElementById('sort-foryou');
  if (fyBtn) fyBtn.classList.toggle('active', mode === 'foryou');
  visibleCount = PAGE_SIZE;
  window.renderPapers();
}

// ── Algorithm view ──

export function renderAlgorithmView() {
  const container = document.getElementById('algorithm-view-content');
  if (!container) return;

  const profile = getInterestProfile();
  const readCount = getReadPosts().length;
  const savedCount = Object.keys(window.getSavedPosts()).length;
  const hiddenCount = getHiddenPosts().length;
  const topTopics = profile ? (profile.topTopics || []) : [];
  const topCats = profile ? (profile.topCategories || []) : [];
  const affinityMap = getSourceAffinity();

  const wBase = parseFloat(Settings.get('fyWeightBase') || '0.7');
  const wAff = parseFloat(Settings.get('fyWeightAffinity') || '0.3');
  const wRec = parseFloat(Settings.get('fyWeightRecency') || '1.0');
  const wExplore = parseFloat(Settings.get('fyWeightExploration') || '0.10');
  const maxRun = parseInt(Settings.get('maxPerCategoryRun') || '3', 10);

  const exampleContent = 65, exampleAff = 0.8, exampleAge = 3;
  const exampleRecency = Math.max(0, 10 - exampleAge * 0.5) * wRec;
  const exampleScore = (exampleContent * (wBase + exampleAff * wAff) + exampleRecency).toFixed(1);

  const topicsHtml = topTopics.length ? topTopics.map(function(t) { return '<span class="bg-hover text-dim text-[0.68rem] px-1.5 py-0.5 rounded">' + escapeHtml(t) + '</span>'; }).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>';
  const catsHtml = topCats.length ? topCats.map(function(c) { return '<span class="bg-accent/10 text-accent text-[0.68rem] px-1.5 py-0.5 rounded border border-accent/20">' + escapeHtml(c) + '</span>'; }).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>';

  // Build affinity table rows
  const affinityRows = Object.keys(affinityMap).sort(function(a, b) { return affinityMap[b] - affinityMap[a]; }).map(function(src) {
    const name = SOURCE_NAMES[src] || src;
    const val = affinityMap[src];
    return '<div class="flex justify-between"><span class="text-dim">' + escapeHtml(name) + '</span><span class="text-primary font-mono">' + val.toFixed(2) + '</span></div>';
  }).join('');

  function _algoSlider(label, id, min, max, value, onInput, onChange) {
    const slider = new window.View('input');
    slider.el.type = 'range'; slider.el.min = min; slider.el.max = max; slider.el.value = value;
    slider.el.className = 'flex-1 accent-[var(--nr-accent)]';
    slider.el.addEventListener('input', onInput);
    slider.el.addEventListener('change', onChange);
    return window.HStack(
      window.Text(label).className('text-dim text-[0.72rem] w-16 shrink-0'),
      slider,
      window.Text(String(typeof value === 'number' && max <= 10 ? value : (value / 100).toFixed(2))).id(id).className('text-dim text-[0.68rem] tabular-nums w-8 text-right')
    ).spacing(3);
  }

  const resetBtn = new window.View('button').className('text-red-400/80 text-[0.78rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors');
  resetBtn.el.textContent = 'Reset all personalization';
  resetBtn.onTap(function() { window.resetPersonalization(); renderAlgorithmView(); });

  const view = window.VStack(
    window.RawHTML('<h2 class="text-[1.3rem] font-semibold text-white_ mb-1">How the Algorithm Works</h2>'),
    window.Text('Your feed is ranked using a personalized composite score that combines content relevance scoring from your interest profile, source affinity from your reading habits, recency, and exploration.').className('text-dim text-[0.8rem] mb-6'),

    // 1. Interest Profile
    window.RawHTML('<div class="mb-6"><h3 class="text-muted text-[0.85rem] font-medium mb-2">1. Interest Profile</h3><p class="text-dim text-[0.78rem] leading-relaxed mb-3">Built automatically from your reading behavior. Keyword matching scores each post 0\u2013100 based on topic and category overlap with your interests.</p><div class="bg-input border border-border-input rounded-lg p-3 text-[0.75rem] space-y-2 mb-3"><div class="flex justify-between"><span class="text-dim">Posts read</span><span class="text-primary font-mono">' + readCount + '</span></div><div class="flex justify-between"><span class="text-dim">Posts saved</span><span class="text-primary font-mono">' + savedCount + '</span></div><div class="flex justify-between"><span class="text-dim">Posts hidden</span><span class="text-primary font-mono">' + hiddenCount + '</span></div></div><div class="space-y-2 text-[0.75rem]"><div><span class="text-dimmer text-[0.68rem]">Signal weights for topic extraction:</span><div class="text-dim mt-1">Read = <span class="text-primary">1x</span> &middot; Saved = <span class="text-primary">3x</span> &middot; Rated = <span class="text-primary">rating value</span> &middot; Hidden = negative signal</div></div><div><span class="text-dimmer text-[0.68rem]">Content score:</span><div class="text-dim mt-1">baseline(30) + topic_match(up to 40) + category_match(up to 30) = <span class="text-primary">0\u2013100</span></div></div><div><span class="text-dimmer text-[0.68rem]">Your top topics:</span><div class="flex flex-wrap gap-1 mt-1">' + topicsHtml + '</div></div><div><span class="text-dimmer text-[0.68rem]">Your top categories:</span><div class="flex flex-wrap gap-1 mt-1">' + catsHtml + '</div></div></div></div>'),

    // 2. Source Affinity
    window.RawHTML('<div class="mb-6 pt-5 border-t border-border-subtle"><h3 class="text-muted text-[0.85rem] font-medium mb-2">2. Source Affinity</h3><p class="text-dim text-[0.78rem] leading-relaxed mb-3">Each feed source gets an affinity score (0.1\u20131.0) based on how often you engage with its posts. Sources you read, save, and rate highly get boosted. Sources you frequently hide get penalized.</p><div class="bg-input border border-border-input rounded-lg p-3 text-[0.72rem] font-mono mb-3"><div class="text-dim mb-1">engagement = (read + saved\u00d72 + rated\u00d73) / total</div><div class="text-dim mb-1">penalty = (hidden / total) \u00d7 0.5</div><div class="text-primary">affinity = clamp(engagement \u2212 penalty, 0.1, 1.0)</div><div class="text-dimmer text-[0.65rem] mt-1">Sources with &lt;3 posts default to 0.5</div></div>' + (affinityRows ? '<div class="bg-input border border-border-input rounded-lg p-3 text-[0.72rem] space-y-1">' + affinityRows + '</div>' : '') + '</div>'),

    // 3. Composite Score
    window.RawHTML('<div class="mb-6 pt-5 border-t border-border-subtle"><h3 class="text-muted text-[0.85rem] font-medium mb-2">3. Composite Score</h3><p class="text-dim text-[0.78rem] leading-relaxed mb-3">When you use the &quot;For You&quot; sort, each post is ranked by a composite score combining all signals:</p><div class="bg-input border border-border-input rounded-lg p-3 text-[0.78rem] font-mono mb-3"><div class="text-accent">score = content \u00d7 (base + affinity \u00d7 aff_weight) + recency + exploration</div></div><div class="space-y-1.5 text-[0.75rem] text-dim mb-4"><div><span class="text-dimmer">content:</span> Interest-based relevance score (0\u2013100)</div><div><span class="text-dimmer">base:</span> Baseline multiplier</div><div><span class="text-dimmer">affinity \u00d7 aff_weight:</span> Bonus for sources you engage with</div><div><span class="text-dimmer">recency:</span> max(0, 10 \u2212 age_hours \u00d7 0.5) \u00d7 rec_weight</div><div><span class="text-dimmer">exploration:</span> Bonus for low-affinity sources to surface new content</div></div><div class="bg-input border border-border-input rounded-lg p-3 mb-4"><div class="text-dimmer text-[0.68rem] mb-2">Example: content=' + exampleContent + ', affinity=' + exampleAff + ', age=' + exampleAge + 'h</div><div class="text-[0.75rem] font-mono text-dim">' + exampleContent + ' \u00d7 (' + wBase.toFixed(2) + ' + ' + exampleAff + ' \u00d7 ' + wAff.toFixed(2) + ') + ' + exampleRecency.toFixed(1) + ' = <span class="text-accent font-semibold">' + exampleScore + '</span></div></div></div>'),

    // Weight sliders
    window.VStack(
      window.Text('Current weights').className('text-dimmer text-[0.68rem] mb-2'),
      _algoSlider('Base', 'algo-base-val', 0, 100, Math.round(wBase * 100),
        function() { document.getElementById('algo-base-val').textContent = (this.value / 100).toFixed(2); },
        function() { Settings.set('fyWeightBase', (this.value / 100).toFixed(2)); window.renderPapers(); renderAlgorithmView(); }),
      _algoSlider('Affinity', 'algo-aff-val', 0, 100, Math.round(wAff * 100),
        function() { document.getElementById('algo-aff-val').textContent = (this.value / 100).toFixed(2); },
        function() { Settings.set('fyWeightAffinity', (this.value / 100).toFixed(2)); window.renderPapers(); renderAlgorithmView(); }),
      _algoSlider('Recency', 'algo-rec-val', 0, 200, Math.round(wRec * 100),
        function() { document.getElementById('algo-rec-val').textContent = (this.value / 100).toFixed(2); },
        function() { Settings.set('fyWeightRecency', (this.value / 100).toFixed(2)); window.renderPapers(); renderAlgorithmView(); }),
      _algoSlider('Explore', 'algo-exp-val', 0, 100, Math.round(wExplore * 100),
        function() { document.getElementById('algo-exp-val').textContent = (this.value / 100).toFixed(2); },
        function() { Settings.set('fyWeightExploration', (this.value / 100).toFixed(2)); window.renderPapers(); renderAlgorithmView(); })
    ).spacing(2),

    // 4. Category Diversity
    window.VStack(
      window.RawHTML('<h3 class="text-muted text-[0.85rem] font-medium mb-2">4. Category Diversity</h3>'),
      window.RawHTML('<p class="text-dim text-[0.78rem] leading-relaxed mb-3">After scoring, posts are reordered to prevent any single category from dominating a run. If more than <span class="text-primary">' + maxRun + '</span> consecutive posts come from the same category, a post from a different category is pulled forward.</p>'),
      (function() {
        const s = new window.View('input');
        s.el.type = 'range'; s.el.min = '1'; s.el.max = '10'; s.el.value = maxRun;
        s.el.className = 'flex-1 accent-[var(--nr-accent)]';
        s.el.addEventListener('input', function() { document.getElementById('algo-div-val').textContent = this.value; });
        s.el.addEventListener('change', function() { Settings.set('maxPerCategoryRun', this.value); window.renderPapers(); renderAlgorithmView(); });
        return window.HStack(
          window.Text('Max same-category run').className('text-dim text-[0.72rem] shrink-0'),
          s,
          window.Text(String(maxRun)).id('algo-div-val').className('text-dim text-[0.68rem] tabular-nums w-4 text-right')
        ).spacing(3);
      })()
    ).className('mb-6 pt-5 border-t border-border-subtle'),

    // Reset
    window.HStack(
      resetBtn,
      window.Text('Clears your interest profile, resets all weights to defaults').className('text-dimmer text-[0.68rem]')
    ).spacing(3).className('pt-5 border-t border-border-subtle')
  );
  AetherUI.mount(view, container);
}

// ── Trends ──

export function renderTrends() {
  const panel = document.getElementById('trends-panel');
  if (!allPapers.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'flex';
  populateCategories();
  renderSourceBubbles();
}

export function populateCategories() {
  const select = document.getElementById('category');
  const current = select.value;
  const freq = {};
  allPapers.forEach(p => { const cats = Array.isArray(p.categories) ? p.categories : []; cats.forEach(c => { freq[c] = (freq[c] || 0) + 1; }); });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  AetherUI.mount(new View('option').attr('value', '').text('All'), select);
  sorted.forEach(([cat, count]) => {
    const opt = new View('option').attr('value', cat).text(`${cat} (${count})`);
    AetherUI.append(opt, select);
  });
  select.value = current;
}

// ── Search & Filtering ──

/**
 * Parse a search query string into structured parts:
 * - "quoted phrases" -> exact phrase match (across title+authors+desc)
 * - title:"quoted" or title:word -> match in title only
 * - by:name -> author filter
 * - source:key -> source filter
 * - sort:mode -> sort override
 * - bare words -> loose token match (across title+authors+desc)
 */
export function parseSearchQuery(raw) {
  let authorFilter = null, sourceFilter = null, sortOverride = null;
  const textTokens = [], exactPhrases = [], titleTokens = [], titlePhrases = [];

  // Extract by: — everything after by: is the author name
  const byMatch = raw.match(/\bby:(.+)/);
  if (byMatch) {
    authorFilter = byMatch[1].trim().toLowerCase();
    raw = raw.slice(0, byMatch.index).trim();
  }

  // Extract title:"quoted phrases" first
  let s = raw.replace(/title:"([^"]+)"/g, (_, ph) => { titlePhrases.push(ph.toLowerCase()); return ''; });
  // Extract generic "quoted phrases"
  s = s.replace(/"([^"]+)"/g, (_, ph) => { exactPhrases.push(ph.toLowerCase()); return ''; });

  const tokens = s.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (t.startsWith('source:')) sourceFilter = t.slice(7).toLowerCase();
    else if (t.startsWith('sort:')) sortOverride = t.slice(5).toLowerCase();
    else if (t.startsWith('title:')) titleTokens.push(t.slice(6).toLowerCase());
    else textTokens.push(t);
  }
  return { authorFilter, sourceFilter, sortOverride, textTokens, exactPhrases, titleTokens, titlePhrases };
}

export function getFilteredPapers(ctx) {
  if (!ctx) ctx = window._buildRenderCtx();
  const rawSearch = (document.getElementById('search')?.value || '').toLowerCase();
  const category = document.getElementById('category').value;
  const { hiddenSet: hidden, blockedWords: _blockedWordsSet } = ctx;

  // Parse structured search prefixes, quoted phrases, and title: prefix
  const parsed = parseSearchQuery(rawSearch);
  const authorFilter = parsed.authorFilter, sourceFilter = parsed.sourceFilter, sortOverride = parsed.sortOverride;
  const textTokens = parsed.textTokens, exactPhrases = parsed.exactPhrases, titleTokens = parsed.titleTokens, titlePhrases = parsed.titlePhrases;

  let filtered = allPapers.filter(p => {
    if (hiddenSourceFilters.has(p.source)) return false;
    if (hidden.has(p.link)) return false;
    if (_blockedWordsSet.size > 0) {
      const titleLower = p.title.toLowerCase();
      for (const w of _blockedWordsSet) {
        if (titleLower.includes(w)) return false;
      }
    }
    if (category && !(Array.isArray(p.categories) ? p.categories : []).includes(category)) return false;
    if (authorFilter && !(p.authors || '').toLowerCase().includes(authorFilter)) return false;
    if (sourceFilter && !p.source.toLowerCase().includes(sourceFilter) && !(SOURCE_NAMES[p.source] || '').toLowerCase().includes(sourceFilter)) return false;
    const allPhrases = exactPhrases.slice();
    if (textTokens.length) allPhrases.push(textTokens.join(' '));
    if (allPhrases.length || titleTokens.length || titlePhrases.length) {
      const titleLow = p.title.toLowerCase();
      const h = `${p.title} ${p.authors} ${p.description}`.toLowerCase();
      if (!allPhrases.every(ph => h.includes(ph))) return false;
      if (!titlePhrases.every(ph => titleLow.includes(ph))) return false;
      if (!titleTokens.every(t => titleLow.includes(t))) return false;
      return true;
    }
    return true;
  });

  const effectiveSort = sortOverride === 'cited' || sortOverride === 'popular' ? 'citations' : sortOverride === 'latest' ? 'latest' : currentSort;
  if (effectiveSort === 'foryou') {
    const affinity = getSourceAffinity();
    const profile = getInterestProfile();
    const now = Date.now();
    const wBase = parseFloat(Settings.get('fyWeightBase') || '0.7');
    const wAff = parseFloat(Settings.get('fyWeightAffinity') || '0.3');
    const wRecency = parseFloat(Settings.get('fyWeightRecency') || '1.0');
    const wExplore = parseFloat(Settings.get('fyWeightExploration') || '0.10');
    filtered = [...filtered].sort((a, b) => {
      const aContent = _computeContentScore(a, profile);
      const bContent = _computeContentScore(b, profile);
      const aAff = affinity[a.source] ?? 0.5;
      const bAff = affinity[b.source] ?? 0.5;
      const aAge = a.pubDate ? Math.max(0, (now - new Date(a.pubDate).getTime()) / 3600000) : 24;
      const bAge = b.pubDate ? Math.max(0, (now - new Date(b.pubDate).getTime()) / 3600000) : 24;
      const aRecency = Math.max(0, 10 - aAge * 0.5) * wRecency;
      const bRecency = Math.max(0, 10 - bAge * 0.5) * wRecency;
      const aExplore = (aAff <= 0.5 ? 1 : 0) * wExplore * 10;
      const bExplore = (bAff <= 0.5 ? 1 : 0) * wExplore * 10;
      a._compositeScore = aContent * (wBase + aAff * wAff) + aRecency + aExplore;
      b._compositeScore = bContent * (wBase + bAff * wAff) + bRecency + bExplore;
      return b._compositeScore - a._compositeScore;
    });
  } else if (effectiveSort === 'citations') {
    filtered = [...filtered].sort((a, b) => {
      const aScore = a.source === 'hn' ? (a.hnScore || 0) : (a.citations || 0);
      const bScore = b.source === 'hn' ? (b.hnScore || 0) : (b.citations || 0);
      return bScore - aScore;
    });
  } else {
    filtered = [...filtered].sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });
  }
  // Category-aware interleaving: limit same-category runs (O(n) bucket algorithm)
  const maxRun = parseInt(Settings.get('maxPerCategoryRun') || '3', 10) || 3;
  if (filtered.length > 1) {
    // Group items into per-category queues, preserving sort order within each
    const buckets = new Map(); // cat -> array of items
    const catOrder = []; // insertion order of categories
    for (const p of filtered) {
      const cat = FEED_CAT_MAP[p.source] || p.source;
      if (!buckets.has(cat)) { buckets.set(cat, []); catOrder.push(cat); }
      buckets.get(cat).push(p);
    }
    // Round-robin across categories, taking up to maxRun from each before moving on
    if (buckets.size > 1) {
      const result = [];
      const cursors = new Map(); // cat -> index into its bucket
      for (const cat of catOrder) cursors.set(cat, 0);
      let remaining = filtered.length;
      while (remaining > 0) {
        for (const cat of catOrder) {
          const arr = buckets.get(cat);
          const cur = cursors.get(cat);
          if (cur >= arr.length) continue;
          const take = Math.min(maxRun, arr.length - cur);
          for (let j = 0; j < take; j++) result.push(arr[cur + j]);
          cursors.set(cat, cur + take);
          remaining -= take;
        }
      }
      filtered = result;
    }
  }
  return filtered;
}
