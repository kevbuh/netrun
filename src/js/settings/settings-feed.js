// ─── Feed Settings ──────────────────────────────────────

function _feedTabBtn(key, label) {
  var active = _settingsFeedTab === key;
  var b = new View('button');
  b.el.textContent = label;
  b.el.className = 'px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' +
    (active ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary');
  b.onTap(function() { _setSettingsFeedTab(key); });
  return b;
}

function _renderFeedSettings() {
  var tabs = HStack(
    _feedTabBtn('insights', 'Insights'),
    _feedTabBtn('quality', 'Quality Filter'),
    _feedTabBtn('algorithm', 'Algorithm')
  ).spacing(1).className('mb-6');
  var content;
  if (_settingsFeedTab === 'quality') content = _renderFeedQualityTab();
  else if (_settingsFeedTab === 'algorithm') content = _renderFeedAlgorithmTab();
  else content = _renderFeedInsightsTab();
  return VStack(tabs, content);
}

function _renderFeedInsightsTab() {
  return _settingSection('Paper Insights', [
    _settingToggleLS('Allow heuristics', 'Use regex/keyword matching for repos, hardware, and insight fallback',
      'insightsAllowHeuristics', { defaultOn: true, trueValue: 'true', falseValue: 'false' })
  ], { desc: 'Extracts key insights when viewing a paper. Uses local LLM (qwen2.5:3b).' });
}

function _renderFeedQualityTab() {
  var cache = typeof getQualityCache === 'function' ? getQualityCache() : {};
  var cacheEntries = Object.entries(cache);
  var keptCount = cacheEntries.filter(function(e) { return (e[1]?.v || e[1]) === 'keep'; }).length;
  var skippedCount = cacheEntries.filter(function(e) { return (e[1]?.v || e[1]) === 'skip'; }).length;

  var qfEnabled = typeof isQualityFilterOn === 'function' && isQualityFilterOn();
  var enableToggle = Toggle(null);
  var enableInput = enableToggle.el.querySelector('input[type="checkbox"]');
  if (enableInput) enableInput.checked = qfEnabled;
  enableToggle.on('change', function(e) { if (e.target.type === 'checkbox') setQualityFilter(e.target.checked); });

  var header = HStack(
    Text('Quality Filter').className('text-white_ text-sm font-semibold'),
    Text('qwen3:8b').className('text-dimmer text-[0.62rem]'),
    Spacer(),
    Text('Enable').className('text-primary text-sm'),
    enableToggle
  ).spacing(2).className('mb-1');

  var isEdited = typeof getQualityPrompt === 'function' && typeof DEFAULT_QUALITY_PROMPT !== 'undefined' && getQualityPrompt() !== DEFAULT_QUALITY_PROMPT;
  var editedBadge = isEdited ? '<span class="text-[0.65rem] text-accent bg-accent/10 border border-accent/30 rounded px-1.5 py-0.5">Edited</span>' : '';
  var resetPromptBtn = isEdited ? '<button onclick="resetQualityPrompt(); renderSettingsView()" class="text-dim text-[0.78rem] hover:text-red-400 bg-transparent border border-border-input hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors">Reset</button>' : '';

  var promptHtml = typeof getQualityPrompt === 'function' ? escapeHtml(getQualityPrompt()) : '';
  var threshold = typeof getQualityThreshold === 'function' ? getQualityThreshold() : 30;

  var verdictSection = RawHTML(
    '<div class="mb-5">' +
    '<div class="flex items-center gap-2 mb-2"><span class="text-muted text-[0.78rem] font-medium">Verdict Prompt</span>' + editedBadge + '</div>' +
    '<p class="text-dimmer text-[0.72rem] mb-2">Classifies each post title as KEEP or SKIP.</p>' +
    '<div id="verdict-prompt-readonly" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-dim text-[0.78rem] font-mono leading-relaxed whitespace-pre-wrap mb-2 max-h-[200px] overflow-y-auto">' + promptHtml + '</div>' +
    '<textarea id="quality-prompt-input" rows="6" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-primary text-[0.78rem] font-mono leading-relaxed outline-none focus:border-accent resize-y" spellcheck="false" style="display:none">' + promptHtml + '</textarea>' +
    '<div id="verdict-prompt-actions" class="flex items-center gap-2 justify-end">' +
    '<button onclick="_editVerdictPrompt()" class="text-dim text-[0.78rem] hover:text-primary bg-transparent border border-border-input hover:border-accent rounded-md px-3 py-1 cursor-pointer transition-colors">Edit</button>' + resetPromptBtn + '</div>' +
    '<div id="verdict-prompt-edit-actions" class="flex items-center gap-2 justify-end" style="display:none">' +
    '<button onclick="_cancelEditVerdictPrompt()" class="text-dim text-[0.78rem] hover:text-primary bg-transparent border border-border-input rounded-md px-3 py-1 cursor-pointer transition-colors">Cancel</button>' +
    '<button onclick="saveQualityPrompt().then(function(){ renderSettingsView(); })" class="bg-accent text-white text-[0.78rem] px-3 py-1 rounded-md border-none cursor-pointer hover:bg-accent-hover">Save</button></div></div>'
  );

  var scoringSection = RawHTML(
    '<div class="mb-5 pt-4 border-t border-border-subtle">' +
    '<span class="text-muted text-[0.78rem] font-medium mb-2 block">Scoring Threshold</span>' +
    '<p class="text-dimmer text-[0.72rem] mb-2">Posts passing the verdict are scored 0\u2013100%. Below threshold = hidden.</p>' +
    '<div id="scoring-prompt-display" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-dim text-[0.78rem] font-mono leading-relaxed whitespace-pre-wrap mb-3">Loading\u2026</div>' +
    '<div class="flex items-center gap-3">' +
    '<input type="range" id="quality-threshold-slider" min="0" max="100" value="' + threshold + '" oninput="document.getElementById(\'quality-threshold-value\').textContent=this.value+\'%\'" onchange="setQualityThreshold(parseInt(this.value))" class="flex-1 accent-[var(--nr-accent)]" />' +
    '<span id="quality-threshold-value" class="text-primary text-sm font-mono w-10 text-right">' + threshold + '%</span></div>' +
    '<p class="text-dimmer text-[0.68rem] mt-1">Minimum score to display (0% = show all kept, 100% = strictest)</p></div>'
  );

  var blockedWordsSection = RawHTML(
    '<div class="mb-5 pt-4 border-t border-border-subtle">' +
    '<span class="text-muted text-[0.78rem] font-medium mb-2 block">Blocked Words</span>' +
    '<p class="text-dimmer text-[0.72rem] mb-3">Posts with titles containing any of these words will be automatically hidden.</p>' +
    '<div class="flex gap-2 mb-3">' +
    '<input type="text" id="blocked-word-input" placeholder="e.g. politics, lawsuit, review" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addBlockedWord()}">' +
    '<button onclick="addBlockedWord()" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover">Add</button></div>' +
    '<div id="blocked-words-list" class="flex flex-wrap gap-1.5"></div></div>'
  );

  var blockedPostsBtn = new View('button');
  blockedPostsBtn.el.className = 'flex items-center gap-2 text-muted text-[0.78rem] font-medium bg-transparent border-none cursor-pointer p-0 hover:text-primary transition-colors';
  blockedPostsBtn.el.innerHTML = '<span id="blocked-posts-chevron" class="transition-transform" style="transform:rotate(-90deg)">' + icon('chevronDown', { size: 14, class: 'w-3.5 h-3.5' }) + '</span> Blocked Posts';
  blockedPostsBtn.onTap(function() { _toggleBlockedPostsList(); });
  var blockedPostsSection = VStack(
    blockedPostsBtn,
    RawHTML('<div id="quality-blocked-list" class="text-[0.78rem] text-muted max-h-[300px] overflow-y-auto mt-2" style="display:none"></div>')
  ).className('mb-5 pt-4 border-t border-border-subtle');

  var resetAllBtn = new View('button');
  resetAllBtn.el.textContent = 'Reset all & clear cache';
  resetAllBtn.el.className = 'text-red-400/80 text-[0.75rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors';
  resetAllBtn.onTap(function() { resetEverything(); });
  var footer = HStack(
    Text('Cached: ' + cacheEntries.length + ' \u00b7 Kept: ' + keptCount + ' \u00b7 Skipped: ' + skippedCount).className('text-dim text-[0.75rem]'),
    Spacer(), resetAllBtn
  ).className('pt-4 border-t border-border-subtle');

  return VStack(
    header,
    Text('Uses a local LLM (Ollama) to hide low-quality posts. Two phases: verdict (KEEP/SKIP), then scoring.').className('text-dim text-[0.78rem] mb-5'),
    verdictSection,
    scoringSection,
    blockedWordsSection,
    blockedPostsSection,
    footer
  );
}

function _renderFeedAlgorithmTab() {
  var profile = typeof getInterestProfile === 'function' ? getInterestProfile() : null;
  var readCount = typeof getReadPosts === 'function' ? getReadPosts().length : 0;
  var savedCount = typeof getSavedPosts === 'function' ? Object.keys(getSavedPosts()).length : 0;
  var hiddenCount = typeof getHiddenPosts === 'function' ? getHiddenPosts().length : 0;
  var topTopics = profile?.topTopics || [];
  var topCats = profile?.topCategories || [];

  var wBase = parseFloat(Settings.get('fyWeightBase') || '0.7');
  var wAff = parseFloat(Settings.get('fyWeightAffinity') || '0.3');
  var wRec = parseFloat(Settings.get('fyWeightRecency') || '1.0');
  var maxRun = parseInt(Settings.get('maxPerCategoryRun') || '3', 10);

  var exampleLlm = 72, exampleAffVal = 0.8, exampleAge = 3;
  var exampleRecency = Math.max(0, 10 - exampleAge * 0.5) * wRec;
  var exampleScore = (exampleLlm * (wBase + exampleAffVal * wAff) + exampleRecency).toFixed(1);

  var topicsHtml = topTopics.length ? topTopics.map(function(t) { return '<span class="bg-hover text-dim text-[0.68rem] px-1.5 py-0.5 rounded">' + escapeHtml(t) + '</span>'; }).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>';
  var catsHtml = topCats.length ? topCats.map(function(c) { return '<span class="bg-accent/10 text-accent text-[0.68rem] px-1.5 py-0.5 rounded border border-accent/20">' + escapeHtml(c) + '</span>'; }).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>';

  function _algoSlider(label, value, max, lsKey, idSuffix, format) {
    var valSpan = Text(format(value)).className('text-dim text-[0.68rem] tabular-nums w-8 text-right');
    var slider = new View('input');
    slider.el.type = 'range'; slider.el.min = '0'; slider.el.max = String(max);
    slider.el.value = Math.round(value * 100);
    slider.el.className = 'flex-1 accent-[var(--nr-accent)]';
    slider.el.addEventListener('input', function() { valSpan.el.textContent = format(this.value / 100); });
    slider.el.addEventListener('change', function() {
      Settings.set(lsKey, (this.value / 100).toFixed(2));
      if (typeof renderPapers === 'function') renderPapers();
      renderSettingsView();
    });
    return HStack(
      Text(label).className('text-dim text-[0.72rem] w-16 shrink-0'), slider, valSpan
    ).spacing(2);
  }

  var explanatoryContent = RawHTML(
    '<h3 class="text-white_ text-sm font-semibold mb-1">How the Algorithm Works</h3>' +
    '<p class="text-dim text-[0.78rem] mb-5">Your feed is ranked using a personalized composite score that combines LLM relevance scoring, source affinity from your reading habits, and recency.</p>' +
    '<div class="mb-5"><span class="text-muted text-[0.78rem] font-medium mb-2 block">1. LLM Relevance Score</span>' +
    '<p class="text-dim text-[0.75rem] leading-relaxed mb-1">Every post that passes the verdict filter is scored 0\u2013100 by a local LLM. When you have an interest profile, your top topics and categories are appended to the scoring prompt.</p></div>' +
    '<div class="mb-5 pt-4 border-t border-border-subtle"><span class="text-muted text-[0.78rem] font-medium mb-2 block">2. Interest Profile</span>' +
    '<p class="text-dim text-[0.75rem] leading-relaxed mb-3">Built automatically from your reading behavior. Recomputed every 5 minutes.</p>' +
    '<div class="bg-input border border-border-input rounded-lg p-3 text-[0.75rem] space-y-2 mb-3">' +
    '<div class="flex justify-between"><span class="text-dim">Posts read</span><span class="text-primary font-mono">' + readCount + '</span></div>' +
    '<div class="flex justify-between"><span class="text-dim">Posts saved</span><span class="text-primary font-mono">' + savedCount + '</span></div>' +
    '<div class="flex justify-between"><span class="text-dim">Posts hidden</span><span class="text-primary font-mono">' + hiddenCount + '</span></div></div>' +
    '<div class="space-y-2 text-[0.75rem]"><div><span class="text-dimmer text-[0.68rem]">Signal weights:</span>' +
    '<div class="text-dim mt-1">Read = <span class="text-primary">1x</span> \u00b7 Saved = <span class="text-primary">3x</span> \u00b7 Rated = <span class="text-primary">rating value</span> \u00b7 Hidden = negative</div></div>' +
    '<div><span class="text-dimmer text-[0.68rem]">Top topics:</span><div class="flex flex-wrap gap-1 mt-1">' + topicsHtml + '</div></div>' +
    '<div><span class="text-dimmer text-[0.68rem]">Top categories:</span><div class="flex flex-wrap gap-1 mt-1">' + catsHtml + '</div></div></div></div>' +
    '<div class="mb-5 pt-4 border-t border-border-subtle"><span class="text-muted text-[0.78rem] font-medium mb-2 block">3. Source Affinity</span>' +
    '<p class="text-dim text-[0.75rem] leading-relaxed mb-3">Each feed source gets an affinity score (0.1\u20131.0) based on engagement. Sources you read/save/rate highly get boosted; frequently hidden ones get penalized.</p>' +
    '<div class="bg-input border border-border-input rounded-lg p-3 text-[0.72rem] font-mono mb-3">' +
    '<div class="text-dim mb-1">engagement = (read + saved\u00d72 + rated\u00d73) / total</div>' +
    '<div class="text-dim mb-1">penalty = (hidden / total) \u00d7 0.5</div>' +
    '<div class="text-primary">affinity = clamp(engagement \u2212 penalty, 0.1, 1.0)</div>' +
    '<div class="text-dimmer text-[0.65rem] mt-1">Sources with &lt;3 posts default to 0.5</div></div></div>'
  );

  var compositeContent = RawHTML(
    '<div class="mb-5 pt-4 border-t border-border-subtle"><span class="text-muted text-[0.78rem] font-medium mb-2 block">4. Composite Score</span>' +
    '<p class="text-dim text-[0.75rem] leading-relaxed mb-3">When you use "For You" sort, each post is ranked by a composite score:</p>' +
    '<div class="bg-input border border-border-input rounded-lg p-3 text-[0.78rem] font-mono mb-3">' +
    '<div class="text-accent">score = LLM \u00d7 (base + affinity \u00d7 aff_weight) + recency_boost \u00d7 rec_weight</div></div>' +
    '<div class="space-y-1.5 text-[0.72rem] text-dim mb-4">' +
    '<div><span class="text-dimmer">LLM:</span> Quality score from local model (0\u2013100)</div>' +
    '<div><span class="text-dimmer">base:</span> Baseline multiplier</div>' +
    '<div><span class="text-dimmer">affinity \u00d7 aff_weight:</span> Bonus for sources you engage with</div>' +
    '<div><span class="text-dimmer">recency_boost:</span> max(0, 10 \u2212 age_hours \u00d7 0.5)</div></div>' +
    '<div class="bg-input border border-border-input rounded-lg p-3 mb-4">' +
    '<div class="text-dimmer text-[0.68rem] mb-2">Example: LLM=' + exampleLlm + ', affinity=' + exampleAffVal + ', age=' + exampleAge + 'h</div>' +
    '<div class="text-[0.75rem] font-mono text-dim">' + exampleLlm + ' \u00d7 (' + wBase.toFixed(2) + ' + ' + exampleAffVal + ' \u00d7 ' + wAff.toFixed(2) + ') + ' + exampleRecency.toFixed(1) + ' = <span class="text-accent font-semibold">' + exampleScore + '</span></div></div>' +
    '<div class="text-dimmer text-[0.68rem] mb-2">Current weights</div>'
  );

  var weightSliders = VStack(
    _algoSlider('Base', wBase, 100, 'fyWeightBase', 'base', function(v) { return v.toFixed(2); }),
    _algoSlider('Affinity', wAff, 100, 'fyWeightAffinity', 'aff', function(v) { return v.toFixed(2); }),
    _algoSlider('Recency', wRec, 200, 'fyWeightRecency', 'rec', function(v) { return v.toFixed(2); })
  ).spacing(2);

  var divValSpan = Text(String(maxRun)).className('text-dim text-[0.68rem] tabular-nums w-4 text-right');
  var divSlider = new View('input');
  divSlider.el.type = 'range'; divSlider.el.min = '1'; divSlider.el.max = '10';
  divSlider.el.value = maxRun;
  divSlider.el.className = 'flex-1 accent-[var(--nr-accent)]';
  divSlider.el.addEventListener('input', function() { divValSpan.el.textContent = this.value; });
  divSlider.el.addEventListener('change', function() {
    Settings.set('maxPerCategoryRun', this.value);
    if (typeof renderPapers === 'function') renderPapers();
  });
  var diversitySection = VStack(
    Text('5. Category Diversity').className('text-muted text-[0.78rem] font-medium mb-2'),
    Text('After scoring, posts are reordered to prevent any single category from dominating. If more than ' + maxRun + ' consecutive posts come from the same category, a post from a different category is pulled forward.').className('text-dim text-[0.75rem] leading-relaxed mb-3'),
    HStack(Text('Max same-category run').className('text-dim text-[0.72rem] shrink-0'), divSlider, divValSpan).spacing(2)
  ).className('mb-5 pt-4 border-t border-border-subtle');

  var personalizationContainer = new View('div');
  personalizationContainer.el.id = 'personalization-panel-container';
  personalizationContainer.className('mb-5 pt-4 border-t border-border-subtle');

  var resetBtn = new View('button');
  resetBtn.el.textContent = 'Reset all personalization';
  resetBtn.el.className = 'text-red-400/80 text-[0.75rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors';
  resetBtn.onTap(function() { resetPersonalization(); renderSettingsView(); });
  var resetFooter = HStack(resetBtn, Text('Clears your interest profile, resets all weights to defaults').className('text-dimmer text-[0.68rem]'))
    .spacing(2).className('pt-4 border-t border-border-subtle');

  return VStack(
    explanatoryContent,
    compositeContent,
    weightSliders,
    diversitySection,
    personalizationContainer,
    resetFooter
  );
}
