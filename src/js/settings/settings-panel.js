// ─── Panel Settings ──────────────────────────────────────

function _loadSettingsModels() {
  apiGet('/api/models').then(data => {
    const models = data.models || [];
    document.querySelectorAll('.settings-model-select').forEach(sel => {
      const key = sel.dataset.key;
      const fallback = sel.dataset.fallback;
      const current = Settings.get(key) || fallback;
      sel.innerHTML = models.map(m =>
        `<option value="${escapeAttr(m)}" ${m === current ? 'selected' : ''}>${escapeHtml(m)}</option>`
      ).join('');
      if (current && !models.includes(current)) {
        sel.insertAdjacentHTML('afterbegin',
          `<option value="${escapeAttr(current)}" selected>${escapeHtml(current)}</option>`);
      }
    });
  }).catch(() => {
    document.querySelectorAll('.settings-model-select').forEach(sel => {
      const key = sel.dataset.key;
      const fallback = sel.dataset.fallback;
      const current = Settings.get(key) || fallback;
      sel.innerHTML = `<option value="${escapeAttr(current)}" selected>${escapeHtml(current)}</option>`;
    });
  });
}

function _renderPanelSettings() {
  var chatModel = Settings.get('chatModel') || 'qwen2.5:3b';
  var visionModel = Settings.get('visionModel') || 'qwen3-vl:8b';
  var summaryModel = Settings.get('summaryModel') || 'qwen3:0.6b';
  var annotateModel = Settings.get('annotateModel') || 'qwen3:8b';
  var tabComplete = Settings.get('panelTabComplete') !== 'off';
  var semSearch = Settings.get('panelSemanticSearch') !== 'off';
  var semMin = parseInt(Settings.get('panelSemanticMin') || '80', 10);
  var vaultMin = parseInt(Settings.get('vaultChatMinSimilarity') || '70', 10);
  setTimeout(_loadSettingsModels, 0);

  function _modelSelect(key, fallback, lsKey, extraNote) {
    var currentVal = Settings.get(lsKey) || fallback;
    var sel = new View('select');
    sel.el.setAttribute('data-key', lsKey);
    sel.el.setAttribute('data-fallback', fallback);
    sel.className('settings-model-select w-full max-w-[320px] px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary outline-none focus:border-accent cursor-pointer');
    sel.el.innerHTML = '<option value="' + escapeAttr(currentVal) + '" selected>' + escapeHtml(currentVal) + '</option>';
    sel.el.addEventListener('change', function() { Settings.set(lsKey, this.value); });
    var children = [sel];
    if (extraNote) children.push(RawHTML('<p class="text-dimmer text-[0.68rem] mt-1">' + extraNote + '</p>'));
    return children;
  }

  var chatModelSection = _settingSection('Default Chat Model', _modelSelect('chatModel', 'qwen2.5:3b', 'chatModel', 'You can also change this inline via <code class="text-muted">/model</code> in the panel.'), { desc: 'The model used for aether panel chat and document Q&A.' });
  var visionModelSection = _settingSection('Default Vision Model', _modelSelect('visionModel', 'qwen3-vl:8b', 'visionModel'), { borderTop: true, desc: 'The model used when chatting with screenshots (drag-to-capture).' });
  var summaryModelSection = _settingSection('Daily Summary Model', _modelSelect('summaryModel', 'qwen3:0.6b', 'summaryModel', 'A smaller model is recommended for fast summaries. Set to <code class="text-muted">off</code> to disable.'), { borderTop: true, desc: 'The model used to generate the daily overview summary on the home page.' });
  var annotateModelSection = _settingSection('Annotation Model', _modelSelect('annotateModel', 'qwen3:8b', 'annotateModel'), { borderTop: true, desc: 'The model used to analyze pages and highlight key findings.' });

  var tabCompleteSection = _settingSection(null, [
    _settingToggle('Tab Completion', 'Suggest a question when you open the panel or select text. Press Tab to accept. Uses qwen3:0.6b.',
      tabComplete, function(on) { Settings.set('panelTabComplete', on ? 'on' : 'off'); })
  ], { borderTop: true });

  var semToggle = _settingToggle('Semantic Search in Lookup', 'Show related posts when you highlight text. Uses nomic-embed-text.',
    semSearch, function(on) { Settings.set('panelSemanticSearch', on ? 'on' : 'off'); });
  var semSliderRow = _settingSlider('Min similarity', 'Only results above this score appear in the highlight popup.', semMin,
    { min: 10, max: 80, format: function(v) { return v + '%'; } },
    null,
    function(v) { Settings.set('panelSemanticMin', v); }
  );
  if (!semSearch) semSliderRow.className('opacity-40 pointer-events-none mt-4');
  var semSection = _settingSection(null, [semToggle, semSliderRow], { borderTop: true });

  var vaultRagSection = _settingSection('Notes RAG Threshold', [
    _settingSlider('Min similarity', null, vaultMin,
      { min: 10, max: 80, format: function(v) { return v + '%'; } },
      null,
      function(v) { Settings.set('vaultChatMinSimilarity', v); }
    )
  ], { borderTop: true, desc: 'Minimum similarity for vault notes to be included as context when chatting without a document.' });

  return VStack(chatModelSection, visionModelSection, summaryModelSection, annotateModelSection, tabCompleteSection, semSection, vaultRagSection);
}

function _renderPromptsSettings() {
  return RawHTML('<p class="text-dim text-sm">Prompts settings coming soon.</p>');
}
