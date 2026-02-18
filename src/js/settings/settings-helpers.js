if (window.AetherUI) AetherUI.globals();

// ─── Shared Help Data ──────────────────────────────────────
// Used by both _renderHelpSettings() and _renderHelpPage() (in browse-urlbar.js)

const _HELP_DATA = {
  instantAnswers: [
    ['Definition', 'pug, ephemeral'],
    ['Math', 'sqrt(144), 2^10, 15% of 230'],
    ['Color', '#ff5733, rgb(20,120,200)'],
    ['Convert', '5km to mi, 100f to c'],
    ['Time zone', 'time in tokyo'],
    ['Weather', 'weather boston'],
    ['Sports', 'nba, lakers, premier league'],
    ['Stocks', '$AAPL, TSLA stock'],
  ],
  searchSyntax: [
    ['"exact phrase"', 'Match exact phrase'],
    ['title:word', 'Search in title only'],
    ['title:"exact phrase"', 'Exact phrase in title only'],
    ['by:author name', 'Search by author'],
    ['source:arxiv', 'Filter by source'],
    ['user:username', 'Search for a user'],
    ['~neural networks', 'Semantic search over read posts'],
  ],
  slashCommands: [
    ['/help', 'This help page'],
    ['/define word', 'Dictionary lookup'],
    ['/search query', 'Web search in new tab'],
    ['/paper query', 'Search arXiv papers'],
    ['/user query', 'Search for users'],
    ['/notes', 'Browse your notes'],
    ['/links', 'List links on page'],
    ['/tab', 'Add tab to chat context'],
    ['/model', 'Change chat model'],
    ['/history', 'Browse visited sites'],
    ['/capture', 'Screenshot the page'],
    ['/bookmark', 'Save to reading list'],
    ['/find', 'Find in page'],
    ['/note', 'Open in note viewer'],
    ['/upload', 'Open a local file'],
    ['/close', 'Close tab'],
    ['/copy', 'Copy page URL'],
    ['/mute', 'Mute/unmute tab'],
    ['/print', 'Print page'],
  ],
  shortcuts: [
    ['', '<strong style="color:var(--nr-text-quaternary);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">Global</strong>'],
    ['Esc', 'Close panel / Go home'],
    ['\u2318T', 'New browser tab'],
    ['\u2318W', 'Close browser tab'],
    ['\u2318Y', 'History page'],
    ['\u2318L', 'Focus URL bar'],
    ['\u2318\u21e7T', 'Reopen closed tab'],
    ['Enter', 'Send chat message'],
    ['\u21e7Enter', 'Web search from panel'],
    ['', '<strong style="color:var(--nr-text-quaternary);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">Tab Overview</strong>'],
    ['\u2190\u2192', 'Switch windows'],
    ['\u2191\u2193', 'Switch tabs'],
    ['Enter', 'Select tab'],
    ['N', 'New window'],
    ['T', 'New tab'],
    ['', '<strong style="color:var(--nr-text-quaternary);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">Browser</strong>'],
    ['\u2318+', 'Zoom in'],
    ['\u2318-', 'Zoom out'],
    ['\u23180', 'Reset zoom'],
    ['\u2318F', 'Find in page'],
    ['', '<strong style="color:var(--nr-text-quaternary);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">PDF Viewer</strong>'],
    ['\u2190', 'Previous page'],
    ['\u2192', 'Next page'],
    ['\u2318F', 'Find in document'],
    ['H', 'Highlight mode'],
    ['P', 'Pen mode'],
    ['', '<strong style="color:var(--nr-text-quaternary);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">Editors</strong>'],
    ['\u2318S', 'Save'],
    ['\u2318Z', 'Undo'],
    ['\u2318\u21e7Z', 'Redo'],
    ['\u21e7Enter', 'Run cell (notebook)'],
  ],
  chatTools: [
    ['Web Search', 'Searches DuckDuckGo for current info'],
    ['Paper Search', 'Finds papers on arXiv'],
    ['Fetch Page', 'Reads content from any URL'],
    ['Bookmark', 'Saves posts to your reading list'],
    ['Navigate', 'Opens views (home, experiments, etc.)'],
    ['New Experiment', 'Creates a project from chat'],
  ],
  semanticSearch: [
    ['Setup', 'Run <code class="text-muted">ollama pull nomic-embed-text</code> once (~274MB)'],
    ['Search', 'Type <code class="text-muted">~query</code> in Research > Papers search'],
    ['Find similar', 'Click the three-dot menu on any card > "Find similar"'],
    ['Notes', 'Vault notes are embedded when saved, searchable via <code class="text-muted">~</code>'],
    ['Offline', 'Fully local \u2014 no data leaves your machine'],
  ],
  aiModels: [
    ['qwen2.5:1.5b', 'Quality filter (KEEP/SKIP + scoring)'],
    ['qwen2.5:3b', 'Document chat, paper insights'],
    ['nomic-embed-text', 'Semantic search embeddings (768-dim)'],
    ['qwen3:8b', 'Chat with tools (autonomous agent mode)'],
    ['qwen3-vl:8b', 'Vision chat (screenshot analysis)'],
    ['glm-ocr', 'Visual OCR for Insight (extracts text from screenshots)'],
  ],
  getBangs: () => typeof _BANGS !== 'undefined' ? Object.keys(_BANGS).map(k => ['!' + k, (typeof _BANG_LABELS !== 'undefined' && _BANG_LABELS[k]) || k]) : [],
};

// ─── AetherUI Settings Helpers ──────────────────────────────

function _settingRow(label, desc, control) {
  var left = VStack(
    Text(label).className('text-primary text-sm'),
    desc ? Text(desc).className('text-dimmer text-[0.72rem] mt-0.5') : null
  );
  return HStack(left, Spacer(), control).className('flex items-center justify-between mt-4');
}

function _settingToggle(label, desc, checked, onChange) {
  var toggle = Toggle(null);
  var input = toggle.el.querySelector('input[type="checkbox"]');
  if (input) input.checked = !!checked;
  if (onChange) toggle.on('change', function(e) {
    if (e.target.type === 'checkbox') onChange(e.target.checked);
  });
  return _settingRow(label, desc, toggle);
}

function _settingToggleLS(label, desc, lsKey, opts) {
  opts = opts || {};
  var defaultOn = opts.defaultOn !== undefined ? opts.defaultOn : true;
  var checked = defaultOn
    ? Settings.get(lsKey) !== (opts.offValue || 'off')
    : Settings.get(lsKey) === (opts.onValue || 'on');
  if (opts.checkedFn) checked = opts.checkedFn();
  return _settingToggle(label, desc, checked, function(on) {
    if (opts.trueValue !== undefined) {
      Settings.set(lsKey, on ? opts.trueValue : opts.falseValue);
    } else {
      Settings.set(lsKey, on ? (opts.onValue || 'on') : (opts.offValue || 'off'));
    }
    if (opts.onChange) opts.onChange(on);
  });
}

function _settingBtnGroup(label, options, currentValue, onSelect) {
  var btns = options.map(function(opt) {
    var value = typeof opt === 'object' ? opt.value : opt;
    var text = typeof opt === 'object' ? opt.label : (value.charAt(0).toUpperCase() + value.slice(1));
    var active = value === currentValue;
    var b = new View('button');
    b.el.textContent = text;
    b.className('px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' +
      (active ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'));
    b.onTap(function() { onSelect(value); });
    return b;
  });
  var right = HStack.apply(null, btns).spacing(1);
  return HStack(Text(label).className('text-primary text-sm'), Spacer(), right).className('flex items-center justify-between mt-4');
}

function _settingPillGroup(label, options, currentValue, onSelect) {
  var btns = options.map(function(opt) {
    var value = typeof opt === 'object' ? opt.value : opt;
    var text = typeof opt === 'object' ? opt.label : value;
    var active = value === currentValue;
    var b = new View('button');
    b.el.textContent = text;
    b.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
      (active ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
    b.onTap(function() { onSelect(value); });
    return b;
  });
  return HStack.apply(null, btns).spacing(0.5);
}

function _settingSlider(label, desc, value, opts, onInput, onChange) {
  opts = opts || {};
  var valSpan = Text(opts.format ? opts.format(value) : String(value))
    .className('text-muted text-[0.78rem] w-10 text-right font-mono');
  var slider = new View('input');
  slider.el.type = 'range';
  slider.className('flex-1 accent-accent');
  if (opts.min != null) slider.el.min = opts.min;
  if (opts.max != null) slider.el.max = opts.max;
  if (opts.step != null) slider.el.step = opts.step;
  slider.el.value = value;
  slider.el.addEventListener('input', function() {
    valSpan.el.textContent = opts.format ? opts.format(slider.el.value) : slider.el.value;
    if (onInput) onInput(slider.el.value);
  });
  if (onChange) slider.el.addEventListener('change', function() { onChange(slider.el.value); });
  var right = HStack(slider, valSpan).spacing(2).className('flex-1 max-w-[200px]');
  var left = VStack(
    Text(label).className('text-primary text-sm'),
    desc ? Text(desc).className('text-dimmer text-[0.72rem] mt-0.5') : null
  );
  return HStack(left, Spacer(), right).className('flex items-center justify-between mt-4');
}

function _settingSection(title, children, opts) {
  opts = opts || {};
  var items = [].concat(children).filter(Boolean);
  if (title) items.unshift(Text(title).className('text-white_ text-sm font-semibold mb-3'));
  if (opts.desc) items.splice(title ? 1 : 0, 0, Text(opts.desc).className('text-dim text-[0.8rem] mb-3'));
  var section = VStack.apply(null, items);
  section.className('mb-8' + (opts.borderTop ? ' pt-5 border-t border-border-subtle' : ''));
  return section;
}

function _settingHeadingRow(title, desc, control) {
  var left = VStack(
    Text(title).className('text-white_ text-sm font-semibold'),
    desc ? Text(desc).className('text-dim text-[0.8rem] mt-0.5') : null
  );
  return HStack(left, Spacer(), control).className('flex items-center justify-between mb-3');
}

function _settingCard(title, children) {
  var items = [].concat(children).filter(Boolean);
  if (title) items.unshift(Text(title).className('text-dimmer text-[0.68rem] uppercase tracking-wider font-semibold'));
  var card = VStack.apply(null, items);
  card.className('nr-settings-card p-4 rounded-xl border border-border-subtle bg-card/30 mb-3');
  return card;
}
