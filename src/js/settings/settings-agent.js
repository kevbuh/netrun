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

  var behaviorGroup = _settingCard('Behavior', [
    chatToolsToggle,
    thinkingToggle,
    voiceToggle,
    tabCompleteToggle,
    clickAetherToggle,
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

  // ── Reference content ──
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
    systemPrompts,
    howItWorks
  );
}
