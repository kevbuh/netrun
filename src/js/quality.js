// ── AI Quality Filter (local Ollama) ──

if (window.AetherUI) AetherUI.globals();

const DEFAULT_QUALITY_PROMPT =
  'You are a topic filter. Your job is to remove obvious junk from a feed reader.\n\n' +
  'SKIP only if the title is clearly about: product reviews, buyer\'s guides, \'best X\' roundups, ' +
  'deals, discounts, coupons, promo codes, gift guides, price comparisons, sales, ' +
  'VPN/mattress/sleep product reviews, TV/movie recommendations, recipes, fashion, ' +
  'celebrity gossip, rage bait, clickbait, SEO spam.\n\n' +
  'KEEP everything else — science, technology, programming, news, culture, ideas, sports, ' +
  'politics, business, and anything that could be genuinely interesting to read.\n\n' +
  'When in doubt, KEEP.\n\n' +
  'Reply ONLY with KEEP or SKIP.';

function getQualityPrompt() {
  return Settings.get('qualityPrompt') || DEFAULT_QUALITY_PROMPT;
}
async function fetchServerPrompt() {
  try {
    const data = await apiGet('/api/quality-prompt');
    if (data.prompt) {
      Settings.set('qualityPrompt', data.prompt);
      return data.prompt;
    }
  } catch (e) { console.warn('fetchServerPrompt:', e); }
  return null;
}
async function saveQualityPrompt() {
  const testTitles = getTestTitles();
  if (testTitles.length) {
    const failures = await runPromptTestInternal();
    if (failures.length) return;
  }
  const val = document.getElementById('quality-prompt-input').value.trim();
  if (val && val !== DEFAULT_QUALITY_PROMPT) {
    Settings.set('qualityPrompt', val);
  } else {
    Settings.remove('qualityPrompt');
  }
  try {
    await apiPut('/api/quality-prompt', { prompt: val === DEFAULT_QUALITY_PROMPT ? '' : val });
  } catch (e) { console.warn('saveQualityPrompt:', e); }
  Settings.remove('qualityCache');
  renderPapers();
  if (isQualityFilterOn() && allPapers.length) qualityFilterPapers();
  const resultsEl = document.getElementById('prompt-test-results');
  if (resultsEl) AetherUI.mount(Text('Prompt saved & cache cleared.').className('text-green-400 text-[0.75rem]'), resultsEl);
}
function resetQualityPrompt() {
  Settings.remove('qualityPrompt');
  apiPut('/api/quality-prompt', { prompt: '' }).catch(() => { /* fire-and-forget */ });
  const el = document.getElementById('quality-prompt-input');
  if (el) el.value = DEFAULT_QUALITY_PROMPT;
  runPromptTest();
}

function _mountTestResult(el, text, cls) {
  AetherUI.mount(Text(text).className(cls + ' text-[0.75rem]'), el);
}
async function runPromptTestInternal() {
  const titles = getTestTitles();
  const resultsEl = document.getElementById('prompt-test-results');
  if (!titles.length) {
    _mountTestResult(resultsEl, 'No test titles collected yet. Hide posts with \u2715 to add them.', 'text-dim');
    return [];
  }
  _mountTestResult(resultsEl, 'Testing\u2026', 'text-dim');
  const prompt = document.getElementById('quality-prompt-input').value.trim();
  const failures = [];
  try {
    for (let i = 0; i < titles.length; i += 10) {
      const batch = titles.slice(i, i + 10);
      let results;
      try { results = await apiPost('/api/quality-filter', { titles: batch, prompt, mode: 'verdict' }); }
      catch { _mountTestResult(resultsEl, 'API error \u2014 is Ollama running?', 'text-red-400'); return []; }
      for (const t of batch) {
        const verdict = results[t] || 'unknown';
        if (verdict !== 'skip') failures.push(t);
      }
    }
  } catch {
    _mountTestResult(resultsEl, 'Network error \u2014 is Ollama running?', 'text-red-400');
    return [];
  }
  const passed = titles.length - failures.length;
  var views = [
    Text(passed + '/' + titles.length + ' passed').className('text-[0.75rem] mb-1 ' + (failures.length ? 'text-red-400' : 'text-green-400'))
  ];
  if (failures.length) {
    failures.forEach(function(t) {
      views.push(Text('\u2717 ' + t).className('text-red-400/80 text-[0.73rem] py-0.5 border-b border-border-subtle last:border-0'));
    });
  }
  AetherUI.mount(VStack(views), resultsEl);
  return failures;
}
async function runPromptTest() {
  await runPromptTestInternal();
}
function resetEverything() {
  Settings.remove('qualityPrompt');
  Settings.set('qualityThreshold', '30');
  apiPut('/api/quality-prompt', { prompt: '' }).catch(() => { /* fire-and-forget */ });
  Settings.remove('qualityCache');
  renderPapers();
  if (isQualityFilterOn() && allPapers.length) qualityFilterPapers();
  var btn = document.getElementById('reset-everything-btn');
  if (btn) {
    btn.textContent = 'Cleared';
    btn.className = 'text-green-400 text-[0.78rem] bg-transparent border border-green-400/30 rounded-md px-3 py-1 cursor-default transition-colors';
    setTimeout(function() {
      btn.textContent = 'Reset all & clear cache';
      btn.className = 'text-red-400/80 text-[0.78rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors';
      var qView = document.getElementById('quality-view');
      if (qView && !qView.classList.contains('hidden')) renderQualityView();
    }, 1500);
  }
}
function renderBlockedList() {
  var cache = getQualityCache();
  var aiBlocked = Object.entries(cache).filter(function(e) { return (e[1]?.v || e[1]) === 'skip'; }).map(function(e) { return { title: e[0], score: e[1]?.s, source: 'ai' }; });
  var manualBlocked = getTestTitles().map(function(t) { return { title: t, score: null, source: 'manual' }; });
  var seen = new Set();
  var all = [];
  for (var b of aiBlocked) { seen.add(b.title); all.push(b); }
  for (var b of manualBlocked) { if (!seen.has(b.title)) all.push(b); }
  var el = document.getElementById('quality-blocked-list');
  if (!el) return;
  if (!all.length) {
    AetherUI.mount(Text('No posts blocked yet.').className('text-dim text-[0.75rem]'), el);
    return;
  }
  var titleToLink = {};
  if (typeof allPapers !== 'undefined') {
    for (var p of allPapers) titleToLink[p.title] = p.link;
  }
  var items = all.reverse();
  var rows = items.map(function(b) {
    var link = titleToLink[b.title];
    var href = link || 'https://www.google.com/search?q=' + encodeURIComponent(b.title);
    var linkTitle = link ? 'Open post' : 'Search for this post';
    var a = new View('a');
    a.el.href = href;
    a.el.target = '_blank';
    a.el.rel = 'noopener';
    a.el.title = linkTitle;
    a.el.textContent = b.title;
    a.el.className = (b.source === 'manual' ? 'text-orange-400/70' : 'text-red-400/70') + ' flex-1 min-w-0 truncate hover:underline cursor-pointer';
    var badges = [a];
    if (b.source === 'manual') badges.push(Text('\u2715').className('text-dimmer text-[0.68rem] shrink-0'));
    if (b.score != null) badges.push(Text(String(b.score)).className('text-dimmer text-[0.68rem] shrink-0'));
    return HStack(badges).spacing(2).className('py-1 border-b border-border-subtle last:border-0 items-center');
  });
  AetherUI.mount(VStack(rows), el);
}
function getQualityCache() {
  return getLS('qualityCache', {});
}
function saveQualityCacheData(cache) {
  setLS('qualityCache', cache);
}
function isQualityFilterOn() {
  return Settings.get('qualityFilter') !== 'off';
}
function setQualityFilter(on) {
  Settings.set('qualityFilter', on ? 'on' : 'off');
  _updateQualityFilterIcon();
  if (on && allPapers.length) qualityFilterPapers();
  renderPapers();
}
function _updateQualityFilterIcon() {
  const btn = document.getElementById('quality-filter-btn');
  if (!btn) return;
  const svg = btn.querySelector('svg');
  if (!svg) return;
  if (isQualityFilterOn()) {
    svg.innerHTML = '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>';
  } else {
    svg.innerHTML = '<path d="m2 2 20 20"/><path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71"/><path d="M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264"/>';
  }
}
setTimeout(_updateQualityFilterIcon, 0);
function getQualityThreshold() {
  const v = parseInt(Settings.get('qualityThreshold'), 10);
  return isNaN(v) ? 30 : Math.min(v, 100);
}
function setQualityThreshold(val) {
  Settings.set('qualityThreshold', String(val));
  renderPapers();
}
function getQualityBypass() {
  return getLS('qualityBypass', {});
}
function getPapersNeedingVerdict() {
  const search = document.getElementById('search').value.toLowerCase();
  const category = document.getElementById('category').value;
  const hidden = new Set(getHiddenPosts());
  const cache = getQualityCache();
  const bypass = getQualityBypass();
  return allPapers.filter(p => {
    if (hidden.has(p.link)) return false;
    if (bypass[p.source]) return false;
    if (p.title in cache) return false;
    if (category && !p.categories.includes(category)) return false;
    if (search) {
      const h = `${p.title} ${p.authors} ${p.description}`.toLowerCase();
      return search.split(/\s+/).filter(Boolean).every(t => h.includes(t));
    }
    return true;
  });
}

let _memoryStatsCache = null;
let _memoryStatsFetchedAt = 0;

let _qfRunning = false;
let _qfQueued = false;
let _qfAborted = false;
let _qfRemaining = 0;
let _qfPhase = ''; // 'verdict' or 'score'

function stopFeedLoading() {
  // Abort in-flight feed fetches
  if (typeof _feedAbort !== 'undefined' && _feedAbort) { _feedAbort.abort(); _feedAbort = null; }
  // Stop quality filter
  _qfAborted = true;
  _qfQueued = false;
}

async function qualityFilterPapers() {
  if (_qfRunning) { _qfQueued = true; return; }
  _qfRunning = true;
  _qfAborted = false;
  try { await _qualityFilterPapersInner(); }
  finally {
    _qfRunning = false;
    if (!_qfAborted && _qfQueued) { _qfQueued = false; qualityFilterPapers(); }
  }
}
async function _qualityFilterPapersInner() {
  // Phase 1: verdict (KEEP/SKIP) for papers needing it
  const needVerdict = getPapersNeedingVerdict().map(p => p.title);
  if (needVerdict.length) {
    _qfPhase = 'verdict';
    _qfRemaining = needVerdict.length;
    _updateQfProgress();
    for (let i = 0; i < needVerdict.length; i += 40) {
      if (_qfAborted) return;
      const batch = needVerdict.slice(i, i + 40);
      try {
        const verdicts = await apiPost('/api/quality-filter', { titles: batch, prompt: getQualityPrompt(), mode: 'verdict' });
        if (_qfAborted) return;
        const updated = getQualityCache();
        for (const [title, v] of Object.entries(verdicts)) {
          updated[title] = { v };
          if (typeof Motion !== 'undefined') Motion.pulse.emit('quality', { label: v === 'keep' ? 'KEEP' : 'SKIP', detail: title.slice(0, 60) });
        }
        saveQualityCacheData(updated);
        _qfRemaining = Math.max(0, needVerdict.length - i - batch.length);
        _updateQfProgress();
      } catch { /* Ollama may be offline */ }
    }
    renderPapers();
  }

  // Phase 2: score only for kept papers that lack a score
  const cache = getQualityCache();
  const needScore = allPapers
    .filter(p => cache[p.title]?.v === 'keep' && cache[p.title]?.s == null)
    .map(p => p.title);
  if (needScore.length) {
    _qfPhase = 'score';
    _qfRemaining = needScore.length;
    _updateQfProgress();
    const interestCtx = buildInterestContext();
    for (let i = 0; i < needScore.length; i += 40) {
      if (_qfAborted) return;
      const batch = needScore.slice(i, i + 40);
      try {
        const scoreBody = { titles: batch, mode: 'score' };
        if (interestCtx) scoreBody.interest_context = interestCtx;
        const scores = await apiPost('/api/quality-filter', scoreBody);
        if (_qfAborted) return;
        const updated = getQualityCache();
        for (const [title, s] of Object.entries(scores)) {
          if (updated[title]) updated[title].s = s;
        }
        saveQualityCacheData(updated);
        _qfRemaining = Math.max(0, needScore.length - i - batch.length);
        _updateQfProgress();
      } catch { /* Ollama may be offline */ }
    }
    renderPapers();
  }
  _qfPhase = '';
  _qfRemaining = 0;
  _updateQfProgress();
  if (typeof islandUpdate === 'function') islandUpdate('qf', { type: 'ai', label: 'qwen2.5:1.5b', detail: 'Quality filter complete', done: true });
}

function _updateQfProgress() {
  var el = document.getElementById('qf-progress');
  if (!el) return;
  if (_qfRunning && _qfRemaining > 0) {
    var label = _qfPhase === 'verdict' ? 'Filtering' : 'Scoring';
    var dot = new View('span').className('inline-block w-1.5 h-1.5 rounded-full bg-accent nr-breathe');
    AetherUI.mount(HStack(dot, Text(label + ' ' + _qfRemaining)).spacing(1.5).className('inline-flex items-center text-accent text-[0.65rem]'), el);
    if (typeof islandUpdate === 'function') islandUpdate('qf', { type: 'ai', label: 'qwen2.5:1.5b', detail: label + ' ' + _qfRemaining + ' \u00B7 qwen2.5:1.5b' });
  } else {
    el.innerHTML = '';
    if (!_qfRunning && typeof islandRemove === 'function') islandRemove('qf');
  }
}

// ── Personalized Feed Ranking ──

const _STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','it','as','be','was','are','this','that','which','what','how',
  'has','had','have','not','no','do','does','did','will','would','can','could',
  'should','may','might','its','they','their','them','we','our','you','your',
  'he','she','his','her','i','my','me','new','than','more','most','also','just',
  'about','into','over','after','before','between','under','using','via','all',
  'been','being','each','few','some','such','only','other','so','if','then',
  'when','where','why','up','out','who'
]);

function _extractTitleWords(title, wordMap, weight) {
  const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  for (const w of words) {
    if (w.length < 3 || _STOP_WORDS.has(w)) continue;
    wordMap[w] = (wordMap[w] || 0) + weight;
  }
}

function computeInterestProfile() {
  const existing = getInterestProfile();
  if (existing && existing.updatedAt && Date.now() - existing.updatedAt < 5 * 60 * 1000) return existing;

  const readSet = new Set(getReadPosts());
  const saved = getSavedPosts();
  const savedSet = new Set(Object.keys(saved));
  const hiddenSet = new Set(getHiddenPosts());
  const ratings = getPaperRatings();

  // Build source → category map from FEED_CATALOG
  const sourceCatMap = {};
  for (const f of FEED_CATALOG) sourceCatMap[f.key] = f.cat;

  const sourceCounts = {};
  const catCounts = {};
  const wordMap = {};

  for (const p of allPapers) {
    if (p.source === 'quote') continue;
    const src = p.source;
    if (!sourceCounts[src]) sourceCounts[src] = { read: 0, saved: 0, rated: 0, hidden: 0, total: 0 };
    sourceCounts[src].total++;

    const cat = sourceCatMap[src] || (src.startsWith('custom:') ? 'Custom' : 'Other');
    if (!catCounts[cat]) catCounts[cat] = { read: 0, saved: 0, hidden: 0 };

    const isRead = readSet.has(p.link);
    const isSaved = savedSet.has(p.link);
    const isHidden = hiddenSet.has(p.link);
    const rating = ratings[p.link] || 0;

    if (isRead) { sourceCounts[src].read++; catCounts[cat].read++; _extractTitleWords(p.title, wordMap, 1); }
    if (isSaved) { sourceCounts[src].saved++; catCounts[cat].saved++; _extractTitleWords(p.title, wordMap, 3); }
    if (rating > 0) { sourceCounts[src].rated++; _extractTitleWords(p.title, wordMap, rating); }
    if (isHidden) { sourceCounts[src].hidden++; catCounts[cat].hidden++; }
  }

  // Inject memory topics with weight 2
  if (_memoryStatsCache && _memoryStatsCache.top_topics) {
    for (const t of _memoryStatsCache.top_topics) {
      const parts = t.topic.split(',');
      for (const p of parts) {
        const w = p.trim().toLowerCase();
        if (w && w.length >= 3) wordMap[w] = (wordMap[w] || 0) + 2;
      }
    }
  }
  // Fire-and-forget fetch for next call (5min TTL same as profile)
  if (Date.now() - _memoryStatsFetchedAt > 5 * 60 * 1000) {
    _memoryStatsFetchedAt = Date.now();
    apiGet('/api/chat-memories/stats')
      .then(function(data) { _memoryStatsCache = data; })
      .catch(function() {});
  }

  const topTopics = Object.entries(wordMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([w]) => w);

  const topCategories = Object.entries(catCounts)
    .map(([cat, c]) => ({ cat, score: c.read + c.saved * 3 - c.hidden }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(e => e.cat);

  const profile = { sourceCounts, catCounts, topTopics, topCategories, updatedAt: Date.now() };
  setLS('interestProfile', profile);
  return profile;
}

function getInterestProfile() {
  return getLS('interestProfile', null);
}

function buildInterestContext() {
  const profile = getInterestProfile();
  if (!profile || !profile.topTopics || !profile.topTopics.length) return '';
  const parts = [];
  if (profile.topTopics.length) parts.push('topics=[' + profile.topTopics.join(', ') + ']');
  if (profile.topCategories && profile.topCategories.length) parts.push('categories=[' + profile.topCategories.join(', ') + ']');
  return parts.join(', ');
}

function getSourceAffinity() {
  const profile = getInterestProfile();
  if (!profile || !profile.sourceCounts) return {};
  const affinity = {};
  for (const [src, c] of Object.entries(profile.sourceCounts)) {
    if (c.total < 3) { affinity[src] = 0.5; continue; }
    const engagement = (c.read + c.saved * 2 + c.rated * 3) / c.total;
    const penalty = (c.hidden / c.total) * 0.5;
    affinity[src] = Math.max(0.1, Math.min(1.0, engagement - penalty));
  }
  return affinity;
}

function resetPersonalization() {
  Settings.remove('interestProfile');
  Settings.remove('fyWeightBase');
  Settings.remove('fyWeightAffinity');
  Settings.remove('fyWeightRecency');
  Settings.remove('maxPerCategoryRun');
  computeInterestProfile();
  const qView = document.getElementById('quality-view');
  if (qView && !qView.classList.contains('hidden')) renderQualityView();
}
