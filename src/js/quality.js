// ── AI Quality Filter (local Ollama) ──

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
  return localStorage.getItem('qualityPrompt') || DEFAULT_QUALITY_PROMPT;
}
async function fetchServerPrompt() {
  try {
    const resp = await fetch('/api/quality-prompt');
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.prompt) {
      localStorage.setItem('qualityPrompt', data.prompt);
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
    localStorage.setItem('qualityPrompt', val);
  } else {
    localStorage.removeItem('qualityPrompt');
  }
  try {
    await fetch('/api/quality-prompt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: val === DEFAULT_QUALITY_PROMPT ? '' : val })
    });
  } catch (e) { console.warn('saveQualityPrompt:', e); }
  localStorage.removeItem('qualityCache');
  renderPapers();
  if (isQualityFilterOn() && allPapers.length) qualityFilterPapers();
  const resultsEl = document.getElementById('prompt-test-results');
  if (resultsEl) resultsEl.innerHTML = '<div class="text-green-400 text-[0.75rem]">Prompt saved &amp; cache cleared.</div>';
}
function resetQualityPrompt() {
  localStorage.removeItem('qualityPrompt');
  fetch('/api/quality-prompt', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '' })
  }).catch((e) => { /* fire-and-forget */ });
  const el = document.getElementById('quality-prompt-input');
  if (el) el.value = DEFAULT_QUALITY_PROMPT;
  runPromptTest();
}

async function runPromptTestInternal() {
  const titles = getTestTitles();
  const resultsEl = document.getElementById('prompt-test-results');
  if (!titles.length) {
    resultsEl.innerHTML = '<div class="text-dim text-[0.75rem]">No test titles collected yet. Hide posts with ✕ to add them.</div>';
    return [];
  }
  resultsEl.innerHTML = '<div class="text-dim text-[0.75rem]">Testing…</div>';
  const prompt = document.getElementById('quality-prompt-input').value.trim();
  const failures = [];
  try {
    for (let i = 0; i < titles.length; i += 10) {
      const batch = titles.slice(i, i + 10);
      const resp = await fetch('/api/quality-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titles: batch, prompt, mode: 'verdict' })
      });
      if (!resp.ok) { resultsEl.innerHTML = '<div class="text-red-400 text-[0.75rem]">API error — is Ollama running?</div>'; return []; }
      const results = await resp.json();
      for (const t of batch) {
        const verdict = results[t] || 'unknown';
        if (verdict !== 'skip') failures.push(t);
      }
    }
  } catch {
    resultsEl.innerHTML = '<div class="text-red-400 text-[0.75rem]">Network error — is Ollama running?</div>';
    return [];
  }
  const passed = titles.length - failures.length;
  let html = `<div class="text-[0.75rem] mb-1 ${failures.length ? 'text-red-400' : 'text-green-400'}">${passed}/${titles.length} passed</div>`;
  if (failures.length) {
    html += failures.map(t => `<div class="text-red-400/80 text-[0.73rem] py-0.5 border-b border-border-subtle last:border-0">✗ ${escapeHtml(t)}</div>`).join('');
  }
  resultsEl.innerHTML = html;
  return failures;
}
async function runPromptTest() {
  await runPromptTestInternal();
}
function resetEverything() {
  localStorage.removeItem('qualityPrompt');
  localStorage.setItem('qualityThreshold', '30');
  fetch('/api/quality-prompt', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '' })
  }).catch((e) => { /* fire-and-forget */ });
  localStorage.removeItem('qualityCache');
  renderPapers();
  if (isQualityFilterOn() && allPapers.length) qualityFilterPapers();
  const btn = document.querySelector('[onclick="resetEverything()"]');
  if (btn) {
    const orig = btn.innerHTML;
    btn.textContent = 'Cleared';
    btn.classList.remove('text-red-400/80');
    btn.classList.add('text-green-400');
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.classList.remove('text-green-400');
      btn.classList.add('text-red-400/80');
      const qView = document.getElementById('quality-view');
      if (qView && !qView.classList.contains('hidden')) renderQualityView();
    }, 1500);
  }
}
function renderBlockedList() {
  const cache = getQualityCache();
  const aiBlocked = Object.entries(cache).filter(([, v]) => (v?.v || v) === 'skip').map(([t, v]) => ({ title: t, score: v?.s, source: 'ai' }));
  const manualBlocked = getTestTitles().map(t => ({ title: t, score: null, source: 'manual' }));
  const seen = new Set();
  const all = [];
  for (const b of aiBlocked) { seen.add(b.title); all.push(b); }
  for (const b of manualBlocked) { if (!seen.has(b.title)) all.push(b); }
  const el = document.getElementById('quality-blocked-list');
  if (!el) return;
  if (!all.length) {
    el.innerHTML = '<div class="text-dim text-[0.75rem]">No posts blocked yet.</div>';
    return;
  }
  // Build title → link map from loaded papers + hidden posts
  const titleToLink = {};
  if (typeof allPapers !== 'undefined') {
    for (const p of allPapers) titleToLink[p.title] = p.link;
  }
  const items = all.reverse();
  el.innerHTML = items.map(b => {
    const link = titleToLink[b.title];
    const href = link || `https://www.google.com/search?q=${encodeURIComponent(b.title)}`;
    const title = link ? 'Open post' : 'Search for this post';
    return `<div class="py-1 border-b border-border-subtle last:border-0 flex items-center gap-2"><a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="${b.source === 'manual' ? 'text-orange-400/70' : 'text-red-400/70'} flex-1 min-w-0 truncate hover:underline cursor-pointer" title="${title}">${escapeHtml(b.title)}</a>${b.source === 'manual' ? '<span class="text-dimmer text-[0.68rem] shrink-0">✕</span>' : ''}${b.score != null ? `<span class="text-dimmer text-[0.68rem] shrink-0">${b.score}</span>` : ''}</div>`;
  }).join('');
}
function getQualityCache() {
  return getLS('qualityCache', {});
}
function saveQualityCacheData(cache) {
  setLS('qualityCache', cache);
}
function isQualityFilterOn() {
  return localStorage.getItem('qualityFilter') !== 'off';
}
function setQualityFilter(on) {
  localStorage.setItem('qualityFilter', on ? 'on' : 'off');
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
  const v = parseInt(localStorage.getItem('qualityThreshold'), 10);
  return isNaN(v) ? 30 : Math.min(v, 100);
}
function setQualityThreshold(val) {
  localStorage.setItem('qualityThreshold', String(val));
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
        const resp = await fetch('/api/quality-filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titles: batch, prompt: getQualityPrompt(), mode: 'verdict' })
        });
        if (_qfAborted) return;
        if (!resp.ok) continue;
        const verdicts = await resp.json();
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
        const resp = await fetch('/api/quality-filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scoreBody)
        });
        if (_qfAborted) return;
        if (!resp.ok) continue;
        const scores = await resp.json();
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
  // Update the inline progress indicator in the quality panel popup
  const el = document.getElementById('qf-progress');
  if (!el) return;
  if (_qfRunning && _qfRemaining > 0) {
    const label = _qfPhase === 'verdict' ? 'Filtering' : 'Scoring';
    el.innerHTML = `<span class="inline-flex items-center gap-1.5 text-accent text-[0.65rem]"><span class="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></span>${label} ${_qfRemaining}</span>`;
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
  localStorage.removeItem('interestProfile');
  localStorage.removeItem('fyWeightBase');
  localStorage.removeItem('fyWeightAffinity');
  localStorage.removeItem('fyWeightRecency');
  localStorage.removeItem('maxPerCategoryRun');
  computeInterestProfile();
  const qView = document.getElementById('quality-view');
  if (qView && !qView.classList.contains('hidden')) renderQualityView();
}
