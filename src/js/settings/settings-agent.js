// ─── AI Settings (merged from Tools + Lookup Panel + Agent) ──

function _renderAISettings() {
  // ── Models group ──
  function _modelRow(label, desc, lsKey, fallback) {
    var currentVal = Settings.get(lsKey) || fallback;
    var sel = new View('select');
    sel.el.setAttribute('data-key', lsKey);
    sel.el.setAttribute('data-fallback', fallback);
    sel.className('settings-model-select px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary outline-none focus:border-accent cursor-pointer');
    sel.el.innerHTML = '<option value="' + escapeAttr(currentVal) + '" selected>' + escapeHtml(currentVal) + '</option>';
    sel.el.addEventListener('change', function() { Settings.set(lsKey, this.value); });
    return _settingRow(label, desc, sel);
  }

  var modelsGroup = _settingCard('Models', [
    _modelRow('Chat Model', 'Default model for aether panel chat and document Q&A.', 'chatModel', 'qwen2.5:3b'),
    _modelRow('Vision Model', 'Model for chatting with screenshots (drag-to-capture).', 'visionModel', 'qwen3-vl:8b'),
    _modelRow('Summary Model', 'Generates the daily overview summary on the home page.', 'summaryModel', 'qwen3:0.6b'),
    _modelRow('Annotation Model', 'Analyzes pages and highlights key findings.', 'annotateModel', 'qwen3:8b'),
    _modelRow('OCR Model', 'Visual OCR for Insight (extracts text from screenshots).', 'ocrModel', 'glm-ocr'),
  ]);

  // ── Behavior group ──
  var toolsOn = Settings.get('chatTools') !== 'off';
  var chatToolsToggle = _settingToggle('Chat Tools', 'Allow the AI to take actions on your behalf during chat. Upgrades model to one that supports function calling.',
    toolsOn, function(on) { Settings.set('chatTools', on ? 'on' : 'off'); });

  var thinkingToggle = _settingToggleLS('Thinking', 'Let the model reason step-by-step before responding. Uses more tokens but can improve quality.',
    'chatThinking', { defaultOn: false });

  var voiceToggle = _settingToggleLS('Voice Auto-Send', 'Automatically send the message after voice transcription completes.',
    'voiceAutoSend', { defaultOn: false });

  var tabComplete = Settings.get('panelTabComplete') !== 'off';
  var tabCompleteToggle = _settingToggle('Tab Completion', 'Suggest a question when you open the panel or select text. Press Tab to accept.',
    tabComplete, function(on) { Settings.set('panelTabComplete', on ? 'on' : 'off'); });

  var clickAetherToggle = _settingToggleLS('Click Aether', 'Right-click anywhere to open an aether panel with chat and web search.', 'clickAether', { defaultOn: true });

  var cursorToggle = _settingToggle('Custom Cursor', 'Smooth cursor with context-aware styling and inertia.',
    Settings.get('customCursor') !== 'off', function(on) {
      Settings.set('customCursor', on ? 'on' : 'off');
      if (window.AetherCursor) window.AetherCursor[on ? 'enable' : 'disable']();
    });

  var behaviorGroup = _settingCard('Behavior', [
    chatToolsToggle,
    thinkingToggle,
    voiceToggle,
    tabCompleteToggle,
    clickAetherToggle,
    cursorToggle,
  ]);

  // ── Insight group ──
  var insightToggle = _settingToggle('Insight', 'Analyze pages with a local LLM. Produces a short insight and highlights key findings.',
    Settings.get('insightEnabled') !== 'off', function(on) {
      Settings.set('insightEnabled', on ? 'on' : 'off');
      if (window.electronAPI && window.electronAPI.insightSetEnabled) window.electronAPI.insightSetEnabled(on);
    });
  var autoInsightToggle = _settingToggleLS('Auto Insight', 'Automatically run insight on every page you navigate to.', 'autoAnnotate', { defaultOn: false });
  var ocrToggle = _settingToggle('Visual OCR', 'Capture a screenshot and extract visual text before analysis. Adds ~1-2s per page.',
    Settings.get('insightOcr') !== 'off', function(on) { Settings.set('insightOcr', on ? 'on' : 'off'); });

  var insightGroup = _settingCard('Insight', [
    insightToggle,
    autoInsightToggle,
    ocrToggle,
  ]);

  // ── Search group ──
  var semSearch = Settings.get('panelSemanticSearch') !== 'off';
  var semMin = parseInt(Settings.get('panelSemanticMin') || '80', 10);
  var vaultMin = parseInt(Settings.get('vaultChatMinSimilarity') || '70', 10);

  var semToggle = _settingToggle('Semantic Search in Lookup', 'Show related posts when you highlight text. Uses nomic-embed-text.',
    semSearch, function(on) { Settings.set('panelSemanticSearch', on ? 'on' : 'off'); });
  var semSlider = _settingSlider('Min Similarity', 'Only results above this score appear in the highlight popup.', semMin,
    { min: 10, max: 80, format: function(v) { return v + '%'; } },
    null,
    function(v) { Settings.set('panelSemanticMin', v); }
  );
  if (!semSearch) semSlider.styles({ opacity: '0.4', pointerEvents: 'none' });
  var vaultSlider = _settingSlider('Notes RAG Threshold', 'Minimum similarity for vault notes to be included as chat context.', vaultMin,
    { min: 10, max: 80, format: function(v) { return v + '%'; } },
    null,
    function(v) { Settings.set('vaultChatMinSimilarity', v); }
  );

  var searchGroup = _settingCard('Search', [
    semToggle,
    semSlider,
    vaultSlider,
  ]);

  // ── Storage group ──
  var vaultInput = new View('input');
  vaultInput.el.type = 'text'; vaultInput.el.id = 'vault-path-input';
  vaultInput.className('flex-1 px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary placeholder:text-dimmer outline-none focus:border-accent');
  vaultInput.el.placeholder = 'Loading...';
  var saveBtn = new View('button');
  saveBtn.el.textContent = 'Save';
  saveBtn.className('px-3 py-1.5 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-accent hover:text-primary cursor-pointer transition-colors');
  saveBtn.onTap(function() { saveVaultPath(); });
  var resetBtn = new View('button');
  resetBtn.el.textContent = 'Reset';
  resetBtn.className('px-3 py-1.5 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-accent hover:text-primary cursor-pointer transition-colors');
  resetBtn.onTap(function() { resetVaultPath(); });
  var vaultRow = _settingGroupContent([
    Text('Vault Path').className('text-[0.8rem] text-primary mb-2'),
    Text('Set a custom folder for your notes. Uses ~/Documents/Vault by default.').className('text-[0.72rem] text-dimmer mb-3'),
    HStack(vaultInput, saveBtn, resetBtn).spacing(2),
    RawHTML('<div id="vault-path-status" class="text-[0.75rem] mt-2 text-dimmer"></div>'),
  ]);

  var storageGroup = _settingCard('Storage', [vaultRow]);

  // ── Reference content ──
  var toolsRef = RawHTML(
    '<div class="mb-8 pt-5 border-t border-border-subtle">' +
    '<h3 class="text-white_ text-sm font-semibold mb-3">Available Tools</h3>' +
    '<p class="text-dim text-[0.8rem] mb-3">When chat tools are enabled, the AI can call these functions automatically based on your message.</p>' +
    '<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">' +
    '<code class="text-muted">web_search</code><span class="text-dim">Search the web via DuckDuckGo</span>' +
    '<code class="text-muted">search_papers</code><span class="text-dim">Search arXiv for academic papers</span>' +
    '<code class="text-muted">fetch_page</code><span class="text-dim">Fetch and extract text from a URL</span>' +
    '<code class="text-muted">save_to_reading_list</code><span class="text-dim">Bookmark a post to your reading list</span>' +
    '<code class="text-muted">navigate</code><span class="text-dim">Navigate to a specific app view</span>' +
    '<code class="text-muted">create_experiment</code><span class="text-dim">Create a new project in the vault</span>' +
    '<code class="text-muted">create_calendar_event</code><span class="text-dim">Add an event to your calendar</span></div></div>'
  );

  var systemPrompts = RawHTML(
    '<div class="mb-8 pt-5 border-t border-border-subtle">' +
    '<h3 class="text-white_ text-sm font-semibold mb-3">System Prompts</h3>' +
    '<p class="text-dim text-[0.8rem] mb-3">The AI receives different system instructions depending on context. Dynamic values shown in <code class="text-accent">orange</code>.</p>' +
    '<div class="space-y-3">' +
    '<div class="p-3 rounded-lg border border-border-subtle bg-card/50"><div class="text-[0.75rem] font-medium text-muted mb-2">With document + tools</div>' +
    '<pre class="text-dim text-[0.72rem] whitespace-pre-wrap leading-relaxed font-mono">You are a helpful research assistant. The user is reading a document. Answer their questions based on the document text below when relevant. You also have tools available to search the web, find papers, fetch pages, bookmark posts, navigate the app, and create experiments.\\n\\nToday is <span class="text-accent">Wednesday, 2026-02-09</span>. The current time is <span class="text-accent">3:45 PM</span>. The user is currently viewing: &quot;<span class="text-accent">Page Title</span>&quot; (<span class="text-accent">https://...</span>). Use this when they refer to &quot;this page&quot;, &quot;this paper&quot;, etc.\\n\\n--- DOCUMENT TEXT ---\\n<span class="text-accent">[extracted text, up to 12k chars]</span>\\n--- END ---</pre></div>' +
    '<div class="p-3 rounded-lg border border-border-subtle bg-card/50"><div class="text-[0.75rem] font-medium text-muted mb-2">With document, no tools</div>' +
    '<pre class="text-dim text-[0.72rem] whitespace-pre-wrap leading-relaxed font-mono">You are a helpful research assistant. The user is reading a document. Answer their questions based ONLY on the document text below. Do not make up information that is not in the document.\\n\\n--- DOCUMENT TEXT ---\\n<span class="text-accent">[extracted text, up to 12k chars]</span>\\n--- END ---</pre></div>' +
    '<div class="p-3 rounded-lg border border-border-subtle bg-card/50"><div class="text-[0.75rem] font-medium text-muted mb-2">No document + tools</div>' +
    '<pre class="text-dim text-[0.72rem] whitespace-pre-wrap leading-relaxed font-mono">You are a helpful assistant with tools to search the web, find papers, fetch page content, bookmark posts, navigate the app, and create experiments. Use tools when they would help answer the user\'s question.\\n\\nToday is <span class="text-accent">Wednesday, 2026-02-09</span>. The current time is <span class="text-accent">3:45 PM</span>.</pre></div>' +
    '<div class="p-3 rounded-lg border border-border-subtle bg-card/50"><div class="text-[0.75rem] font-medium text-muted mb-2">No document, no tools</div>' +
    '<pre class="text-dim text-[0.72rem] whitespace-pre-wrap leading-relaxed font-mono">You are a helpful assistant.</pre></div>' +
    '<div class="p-3 rounded-lg border border-border-subtle bg-card/50"><div class="text-[0.75rem] font-medium text-muted mb-2">Vision mode (screenshot)</div>' +
    '<pre class="text-dim text-[0.72rem] whitespace-pre-wrap leading-relaxed font-mono">You are a helpful visual analysis assistant. The user has taken a screenshot and wants to ask about it. Describe what you see and answer their questions based on the visual content provided.</pre></div></div></div>'
  );

  var howItWorks = RawHTML(
    '<div class="mb-8 pt-5 border-t border-border-subtle">' +
    '<h3 class="text-white_ text-sm font-semibold mb-3">How It Works</h3>' +
    '<div class="space-y-2 text-[0.8rem] text-dim">' +
    '<p>When tools are enabled, the AI can decide to call one or more tools in a single response. You\'ll see a thinking indicator (e.g. "Searching web\u2026", "Adding to calendar\u2026") while the tool runs.</p>' +
    '<p>Tool results are fed back to the model so it can incorporate them into its reply. Some tools also trigger UI actions \u2014 for example, <code class="text-muted">navigate</code> switches your view and <code class="text-muted">create_calendar_event</code> opens the calendar.</p>' +
    '<p>The model automatically upgrades to <code class="text-muted">qwen3:8b</code> when tools are on, since smaller models don\'t reliably handle function calling. You can override this in the Models group above.</p></div></div>'
  );

  return VStack(
    modelsGroup,
    behaviorGroup,
    insightGroup,
    searchGroup,
    storageGroup,
    toolsRef,
    systemPrompts,
    howItWorks
  );
}
