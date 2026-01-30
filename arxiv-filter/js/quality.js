// ── AI Quality Filter (local Ollama) ──

function clearAllBlockedPosts() {
  localStorage.removeItem('hiddenPosts');
  clearTestTitles();
  renderPapers();
  if (document.getElementById('settings-view').style.display === 'block') renderSettingsView();
}

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
  } catch {}
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
  } catch {}
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
  }).catch(() => {});
  const el = document.getElementById('quality-prompt-input');
  if (el) el.value = DEFAULT_QUALITY_PROMPT;
  runPromptTest();
}
function clearTestTitles() {
  localStorage.removeItem('qualityTestTitles');
  updateTestTitleCount();
  const resultsEl = document.getElementById('prompt-test-results');
  if (resultsEl) resultsEl.innerHTML = '';
  fetch('/api/blocked-titles', { method: 'DELETE' }).catch(() => {});
}
function updateTestTitleCount() {
  const el = document.getElementById('test-title-count');
  if (el) el.textContent = getTestTitles().length;
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
function clearQualityCache() {
  localStorage.removeItem('qualityCache');
  renderPapers();
  if (isQualityFilterOn() && allPapers.length) qualityFilterPapers();
}
function resetEverything() {
  localStorage.removeItem('qualityPrompt');
  localStorage.setItem('qualityThreshold', '70');
  fetch('/api/quality-prompt', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '' })
  }).catch(() => {});
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
      if (document.getElementById('settings-view').style.display === 'block') renderSettingsView();
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
  const items = all.reverse();
  el.innerHTML = items.map(b => `<div class="py-1 border-b border-border-subtle last:border-0 flex items-center gap-2"><a href="https://www.google.com/search?q=${encodeURIComponent(b.title)}" target="_blank" rel="noopener" class="${b.source === 'manual' ? 'text-orange-400/70' : 'text-red-400/70'} flex-1 min-w-0 truncate hover:underline cursor-pointer" title="Search for this post">${escapeHtml(b.title)}</a>${b.source === 'manual' ? '<span class="text-dimmer text-[0.68rem] shrink-0">✕</span>' : ''}${b.score != null ? `<span class="text-dimmer text-[0.68rem] shrink-0">${b.score}</span>` : ''}</div>`).join('');
}
function getQualityCache() {
  try { return JSON.parse(localStorage.getItem('qualityCache') || '{}'); } catch { return {}; }
}
function saveQualityCacheData(cache) {
  localStorage.setItem('qualityCache', JSON.stringify(cache));
}
function isQualityFilterOn() {
  return localStorage.getItem('qualityFilter') !== 'off';
}
function setQualityFilter(on) {
  localStorage.setItem('qualityFilter', on ? 'on' : 'off');
  if (on && allPapers.length) qualityFilterPapers();
  renderPapers();
}
function getQualityThreshold() {
  const v = parseInt(localStorage.getItem('qualityThreshold'), 10);
  return isNaN(v) ? 70 : Math.min(v, 100);
}
function setQualityThreshold(val) {
  localStorage.setItem('qualityThreshold', String(val));
  renderPapers();
}
function getQualityBypass() {
  try { return JSON.parse(localStorage.getItem('qualityBypass') || '{}'); } catch { return {}; }
}
function setQualityBypass(key, bypass) {
  const b = getQualityBypass();
  if (bypass) b[key] = true; else delete b[key];
  localStorage.setItem('qualityBypass', JSON.stringify(b));
  renderPapers();
}
function isSourceBypassed(sourceKey) {
  return !!getQualityBypass()[sourceKey];
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
    for (let i = 0; i < needVerdict.length; i += 10) {
      if (_qfAborted) return;
      const batch = needVerdict.slice(i, i + 10);
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
        }
        saveQualityCacheData(updated);
        renderPapers();
      } catch { /* Ollama may be offline */ }
    }
  }

  // Phase 2: score only for kept papers that lack a score
  const cache = getQualityCache();
  const needScore = allPapers
    .filter(p => cache[p.title]?.v === 'keep' && cache[p.title]?.s == null)
    .map(p => p.title);
  if (needScore.length) {
    for (let i = 0; i < needScore.length; i += 10) {
      if (_qfAborted) return;
      const batch = needScore.slice(i, i + 10);
      try {
        const resp = await fetch('/api/quality-filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titles: batch, mode: 'score' })
        });
        if (_qfAborted) return;
        if (!resp.ok) continue;
        const scores = await resp.json();
        const updated = getQualityCache();
        for (const [title, s] of Object.entries(scores)) {
          if (updated[title]) updated[title].s = s;
        }
        saveQualityCacheData(updated);
        renderPapers();
      } catch { /* Ollama may be offline */ }
    }
  }
}
