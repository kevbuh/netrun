import Settings from '../core/core-settings.js';

if (window.AetherUI) AetherUI.globals();

// ─── Shared Help Data ──────────────────────────────────────
// Used by both _renderHelpSettings() and _renderHelpPage() (in browse-urlbar.js)

export const _HELP_DATA = {
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
    ['/links', 'List links on page'],
    ['/tab', 'Add tab to chat context'],
    ['/model', 'Change chat model'],
    ['/history', 'Browse visited sites'],
    ['/capture', 'Screenshot the page'],
    ['/bookmark', 'Save to reading list'],
    ['/find', 'Find in page'],
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
  ],
  chatTools: [
    ['web_search', 'Search the web via DuckDuckGo'],
    ['search_papers', 'Search arXiv for academic papers'],
    ['fetch_page', 'Fetch and extract text from a URL'],
    ['save_to_reading_list', 'Bookmark a post to your reading list'],
    ['navigate', 'Navigate to a specific app view'],
    ['create_calendar_event', 'Add an event to your calendar'],
  ],
  aiModels: [
    ['qwen2.5:1.5b', 'Quality filter (KEEP/SKIP + scoring)'],
    ['qwen2.5:3b', 'Document chat, paper insights'],
    ['qwen3:8b', 'Chat with tools (autonomous agent mode)'],
    ['qwen3-vl:8b', 'Vision chat (screenshot analysis)'],
    ['glm-ocr', 'Visual OCR for Insight (extracts text from screenshots)'],
  ],
  getBangs: () => typeof _BANGS !== 'undefined' ? Object.keys(_BANGS).map(k => ['!' + k, (typeof _BANG_LABELS !== 'undefined' && _BANG_LABELS[k]) || k]) : [],
};

// ─── AetherUI Settings Helpers ──────────────────────────────

export function _settingRow(label, desc, control) {
  const leftChildren = [];
  if (label) leftChildren.push(Text(label).className('nr-settings-row-label'));
  if (desc) leftChildren.push(Text(desc).className('nr-settings-row-desc'));
  const left = VStack.apply(null, leftChildren).className('nr-settings-row-left');
  const rowChildren = [left];
  if (control) rowChildren.push(control);
  const row = HStack.apply(null, rowChildren).className('nr-settings-group-row');
  return row;
}

export function _settingToggle(label, desc, checked, onChange) {
  const toggle = Toggle(null);
  const input = toggle.el.querySelector('input[type="checkbox"]');
  if (input) input.checked = !!checked;
  if (onChange) toggle.on('change', function(e) {
    if (e.target.type === 'checkbox') onChange(e.target.checked);
  });
  return _settingRow(label, desc, toggle);
}

export function _settingToggleLS(label, desc, lsKey, opts) {
  opts = opts || {};
  const defaultOn = opts.defaultOn !== undefined ? opts.defaultOn : true;
  let checked = defaultOn
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

export function _settingBtnGroup(label, options, currentValue, onSelect) {
  const btns = options.map(function(opt) {
    const value = typeof opt === 'object' ? opt.value : opt;
    const text = typeof opt === 'object' ? opt.label : (value.charAt(0).toUpperCase() + value.slice(1));
    const active = value === currentValue;
    const b = new View('button');
    b.el.textContent = text;
    b.className('px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' +
      (active ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'));
    b.onTap(function() { onSelect(value); });
    return b;
  });
  const right = HStack.apply(null, btns).spacing(1);
  const row = HStack(
    Text(label).className('nr-settings-row-label'),
    right
  ).className('nr-settings-group-row');
  return row;
}

export function _settingPillGroup(label, options, currentValue, onSelect) {
  const btns = options.map(function(opt) {
    const value = typeof opt === 'object' ? opt.value : opt;
    const text = typeof opt === 'object' ? opt.label : value;
    const active = value === currentValue;
    const b = new View('button');
    b.el.textContent = text;
    b.className('px-2 py-0.5 rounded text-[0.7rem] border cursor-pointer transition-colors ' +
      (active ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-dimmer bg-card hover:text-primary'));
    b.onTap(function() { onSelect(value); });
    return b;
  });
  return HStack.apply(null, btns).spacing(0.5);
}

export function _settingSlider(label, desc, value, opts, onInput, onChange) {
  opts = opts || {};
  const valSpan = Text(opts.format ? opts.format(value) : String(value))
    .className('text-muted text-[0.78rem] w-10 text-right font-mono');
  const slider = new View('input');
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
  const right = HStack(slider, valSpan).spacing(2).className('flex-1 max-w-[200px]');

  const leftChildren = [];
  if (label) leftChildren.push(Text(label).className('nr-settings-row-label'));
  if (desc) leftChildren.push(Text(desc).className('nr-settings-row-desc'));
  const left = VStack.apply(null, leftChildren).className('nr-settings-row-left');
  const row = HStack(left, right).className('nr-settings-group-row');
  return row;
}

export function _settingSection(title, children, opts) {
  opts = opts || {};
  let items = [];
  if (title) {
    const titleEl = new View('div');
    titleEl.el.className = 'nr-settings-section-title';
    titleEl.el.textContent = title;
    items.push(titleEl);
  }
  if (opts.desc) {
    const descEl = new View('div');
    descEl.el.className = 'nr-settings-section-desc';
    descEl.el.textContent = opts.desc;
    items.push(descEl);
  }
  const childArr = [].concat(children).filter(Boolean);
  items = items.concat(childArr);
  const section = VStack.apply(null, items);
  section.className('mb-8' + (opts.borderTop ? ' pt-5 border-t border-border-subtle' : ''));
  return section;
}

export function _settingHeadingRow(title, desc, control) {
  const left = VStack(
    Text(title).className('text-white_ text-sm font-semibold'),
    desc ? Text(desc).className('text-dim text-[0.8rem] mt-0.5') : null
  );
  return HStack(left, Spacer(), control).className('flex items-center justify-between mb-3');
}

export function _settingCard(title, children) {
  const items = [];
  if (title) items.push(Text(title).className('nr-settings-group-header'));
  const childArr = [].concat(children).filter(Boolean);
  const group = VStack.apply(null, childArr).className('nr-settings-group');
  items.push(group);
  const wrapper = VStack.apply(null, items).className('mb-4');
  return wrapper;
}

export function _settingGroupContent(children) {
  const block = new View('div');
  block.el.className = 'nr-settings-group-content';
  const childArr = [].concat(children).filter(Boolean);
  for (let i = 0; i < childArr.length; i++) {
    const child = childArr[i];
    const el = child.el || child;
    block.el.appendChild(el);
  }
  return block;
}

window._HELP_DATA = _HELP_DATA;
window._settingRow = _settingRow;
window._settingToggle = _settingToggle;
window._settingToggleLS = _settingToggleLS;
window._settingBtnGroup = _settingBtnGroup;
window._settingPillGroup = _settingPillGroup;
window._settingSlider = _settingSlider;
window._settingSection = _settingSection;
window._settingHeadingRow = _settingHeadingRow;
window._settingCard = _settingCard;
window._settingGroupContent = _settingGroupContent;
