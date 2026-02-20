import Settings from '../core/core-settings.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { _settingSection, _settingToggleLS } from '/js/settings/settings-helpers.js';
import { _settingsFeedTab, renderSettingsView } from '/js/settings/settings-core.js';
import { getHiddenPosts, getReadPosts, getSavedPosts, renderPapers } from '/js/feed.js';

// ─── Feed Settings ──────────────────────────────────────

export function _renderFeedSettings() {
  return window.TabView(_settingsFeedTab, [
    { label: 'Insights', content: _renderFeedInsightsTab },
    { label: 'Algorithm', content: _renderFeedAlgorithmTab }
  ]).underlined().padding(0);
}

export function _renderFeedInsightsTab() {
  return _settingSection('Paper Insights', [
    _settingToggleLS('Allow heuristics', 'Use regex/keyword matching for repos, hardware, and insight fallback',
      'insightsAllowHeuristics', { defaultOn: true, trueValue: 'true', falseValue: 'false' })
  ], { desc: 'Extracts key insights when viewing a paper. Uses local LLM (qwen2.5:3b).' });
}

export function _renderFeedAlgorithmTab() {
  const profile = typeof getInterestProfile === 'function' ? getInterestProfile() : null;
  const readCount = typeof getReadPosts === 'function' ? getReadPosts().length : 0;
  const savedCount = typeof getSavedPosts === 'function' ? Object.keys(getSavedPosts()).length : 0;
  const hiddenCount = typeof getHiddenPosts === 'function' ? getHiddenPosts().length : 0;
  const topTopics = profile?.topTopics || [];
  const topCats = profile?.topCategories || [];

  const wBase = parseFloat(Settings.get('fyWeightBase') || '0.7');
  const wAff = parseFloat(Settings.get('fyWeightAffinity') || '0.3');
  const wRec = parseFloat(Settings.get('fyWeightRecency') || '1.0');
  const maxRun = parseInt(Settings.get('maxPerCategoryRun') || '3', 10);

  const exampleLlm = 72, exampleAffVal = 0.8, exampleAge = 3;
  const exampleRecency = Math.max(0, 10 - exampleAge * 0.5) * wRec;
  const exampleScore = (exampleLlm * (wBase + exampleAffVal * wAff) + exampleRecency).toFixed(1);

  const topicsHtml = topTopics.length ? topTopics.map(function(t) { return '<span class="bg-hover text-dim text-[0.68rem] px-1.5 py-0.5 rounded">' + escapeHtml(t) + '</span>'; }).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>';
  const catsHtml = topCats.length ? topCats.map(function(c) { return '<span class="bg-accent/10 text-accent text-[0.68rem] px-1.5 py-0.5 rounded border border-accent/20">' + escapeHtml(c) + '</span>'; }).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>';

  function _algoSlider(label, value, max, lsKey, idSuffix, format) {
    const valSpan = window.Text(format(value)).className('text-dim text-[0.68rem] tabular-nums w-8 text-right');
    const slider = new window.View('input');
    slider.el.type = 'range'; slider.el.min = '0'; slider.el.max = String(max);
    slider.el.value = Math.round(value * 100);
    slider.className('flex-1 accent-[var(--nr-accent)]');
    slider.el.addEventListener('input', function() { valSpan.el.textContent = format(this.value / 100); });
    slider.el.addEventListener('change', function() {
      Settings.set(lsKey, (this.value / 100).toFixed(2));
      if (typeof renderPapers === 'function') renderPapers();
      renderSettingsView();
    });
    return window.HStack(
      window.Text(label).className('text-dim text-[0.72rem] w-16 shrink-0'), slider, valSpan
    ).spacing(2);
  }

  const explanatoryContent = window.RawHTML(
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

  const compositeContent = window.RawHTML(
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

  const weightSliders = window.VStack(
    _algoSlider('Base', wBase, 100, 'fyWeightBase', 'base', function(v) { return v.toFixed(2); }),
    _algoSlider('Affinity', wAff, 100, 'fyWeightAffinity', 'aff', function(v) { return v.toFixed(2); }),
    _algoSlider('Recency', wRec, 200, 'fyWeightRecency', 'rec', function(v) { return v.toFixed(2); })
  ).spacing(2);

  const divValSpan = window.Text(String(maxRun)).className('text-dim text-[0.68rem] tabular-nums w-4 text-right');
  const divSlider = new window.View('input');
  divSlider.el.type = 'range'; divSlider.el.min = '1'; divSlider.el.max = '10';
  divSlider.el.value = maxRun;
  divSlider.className('flex-1 accent-[var(--nr-accent)]');
  divSlider.el.addEventListener('input', function() { divValSpan.el.textContent = this.value; });
  divSlider.el.addEventListener('change', function() {
    Settings.set('maxPerCategoryRun', this.value);
    if (typeof renderPapers === 'function') renderPapers();
  });
  const diversitySection = window.VStack(
    window.Text('5. Category Diversity').className('text-muted text-[0.78rem] font-medium mb-2'),
    window.Text('After scoring, posts are reordered to prevent any single category from dominating. If more than ' + maxRun + ' consecutive posts come from the same category, a post from a different category is pulled forward.').className('text-dim text-[0.75rem] leading-relaxed mb-3'),
    window.HStack(window.Text('Max same-category run').className('text-dim text-[0.72rem] shrink-0'), divSlider, divValSpan).spacing(2)
  ).className('mb-5 pt-4 border-t border-border-subtle');

  const personalizationContainer = new window.View('div');
  personalizationContainer.el.id = 'personalization-panel-container';
  personalizationContainer.className('mb-5 pt-4 border-t border-border-subtle');

  const resetBtn = new window.View('button');
  resetBtn.el.textContent = 'Reset all personalization';
  resetBtn.className('text-red-400/80 text-[0.75rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors');
  resetBtn.onTap(function() { resetPersonalization(); renderSettingsView(); });
  const resetFooter = window.HStack(resetBtn, window.Text('Clears your interest profile, resets all weights to defaults').className('text-dimmer text-[0.68rem]'))
    .spacing(2).className('pt-4 border-t border-border-subtle');

  return window.VStack(
    explanatoryContent,
    compositeContent,
    weightSliders,
    diversitySection,
    personalizationContainer,
    resetFooter
  );
}

