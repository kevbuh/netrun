// ─── Agent Settings ──────────────────────────────────────

function _renderAgentSettings() {
  var toolsOn = Settings.get('chatTools') !== 'off';

  var chatToolsToggle = _settingToggle('Chat Tools', 'Allow the AI to take actions on your behalf during chat. When enabled, the model upgrades to one that supports function calling.',
    toolsOn, function(on) { Settings.set('chatTools', on ? 'on' : 'off'); });
  var chatToolsNote = RawHTML('<p class="text-dimmer text-[0.68rem] mt-2">Toggle in-panel via the wrench icon in the top bar. Default model with tools: <code class="text-muted">qwen3:8b</code>. Without tools: <code class="text-muted">qwen2.5:3b</code>.</p>');

  var thinkingToggle = _settingToggleLS('Thinking', 'Let the model reason through problems step-by-step before responding. Uses more tokens but can improve answer quality.',
    'chatThinking', { defaultOn: false });

  var voiceToggle = _settingToggleLS('Voice Auto-Send', 'Automatically send the message after voice transcription completes, without waiting for Enter.',
    'voiceAutoSend', { defaultOn: false });

  // Insight section
  var insightToggle = _settingToggle('Insight', 'Analyze pages in the browser with a local LLM. Produces a short insight and highlights key findings, contradictions, and ads.',
    Settings.get('insightEnabled') !== 'off', function(on) {
      Settings.set('insightEnabled', on ? 'on' : 'off');
      if (window.electronAPI && window.electronAPI.insightSetEnabled) window.electronAPI.insightSetEnabled(on);
    });
  var insightNote = Text('When disabled, pages will not be analyzed and no insight pills will appear. You can still manually trigger insight from the pill menu.').className('text-dimmer text-[0.68rem] mt-2 mb-4');
  var autoInsightToggle = _settingToggleLS('Auto Insight', 'Automatically run insight on every page you navigate to.', 'autoAnnotate', { defaultOn: false });
  var autoInsightNote = Text('Cached results are reused for 5 minutes.').className('text-dimmer text-[0.68rem] mt-1');
  var ocrToggle = _settingToggle('Visual OCR', 'Capture a screenshot and extract visual text (charts, infographics) before analysis.',
    Settings.get('insightOcr') !== 'off', function(on) { Settings.set('insightOcr', on ? 'on' : 'off'); });
  var ocrNote = Text('Adds ~1-2s per page. Requires an OCR model (e.g. glm-ocr) in Ollama.').className('text-dimmer text-[0.68rem] mt-1 mb-3');
  var ocrModel = Settings.get('ocrModel') || 'glm-ocr';
  var ocrSelect = new View('select');
  ocrSelect.el.setAttribute('data-key', 'ocrModel');
  ocrSelect.el.setAttribute('data-fallback', 'glm-ocr');
  ocrSelect.el.className = 'settings-model-select ml-3 px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary outline-none focus:border-accent cursor-pointer';
  ocrSelect.el.innerHTML = '<option value="' + escapeAttr(ocrModel) + '" selected>' + escapeHtml(ocrModel) + '</option>';
  ocrSelect.el.addEventListener('change', function() { Settings.set('ocrModel', this.value); });
  var ocrModelRow = HStack(Text('OCR Model').className('text-primary text-sm'), ocrSelect);

  var cursorToggle = _settingToggle('Custom Cursor', 'Smooth cursor with context-aware styling and inertia.',
    Settings.get('customCursor') !== 'off', function(on) {
      Settings.set('customCursor', on ? 'on' : 'off');
      if (window.AetherCursor) window.AetherCursor[on ? 'enable' : 'disable']();
    });

  // Static reference content
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
    '<p>The model automatically upgrades to <code class="text-muted">qwen3:8b</code> when tools are on, since smaller models don\'t reliably handle function calling. You can override this in Lookup Panel settings.</p></div></div>'
  );

  return VStack(
    _settingSection('Agent', [
      _settingCard('Behavior', [
        chatToolsToggle,
        chatToolsNote,
        thinkingToggle,
        voiceToggle,
      ]),
      _settingCard('Insight', [
        insightToggle,
        insightNote,
        autoInsightToggle,
        autoInsightNote,
        ocrToggle,
        ocrNote,
        ocrModelRow,
      ]),
      _settingCard('Interface', [
        cursorToggle,
      ]),
    ]),
    toolsRef,
    systemPrompts,
    howItWorks
  );
}
