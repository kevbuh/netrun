// Migrate old section keys
(function() {
  var stored = Settings.get('settingsSection');
  if (stored === 'tools' || stored === 'panel' || stored === 'agent') {
    Settings.set('settingsSection', 'ai');
  } else if (stored === 'prompts') {
    Settings.set('settingsSection', 'help');
  }
})();

let _settingsSection = Settings.get('settingsSection') || 'profile';

const _SETTINGS_SECTIONS = [
  { type: 'label', text: 'General' },
  { key: 'profile', label: 'Profile', icon: icon('profile', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'appearance', label: 'Appearance', icon: icon('appearance', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { type: 'label', text: 'Features' },
  { key: 'browser', label: 'Browser', icon: icon('browse', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'ai', label: 'AI', icon: icon('star', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'feed', label: 'Feed', icon: icon('feedReading', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { type: 'label', text: 'Advanced' },
  { key: 'context', label: 'Context', icon: icon('document', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'help', label: 'Help', icon: icon('help', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
];

let _settingsFeedTab = 'insights';

function _setSettingsSection(section) {
  _settingsSection = section;
  Settings.set('settingsSection', section);
  renderSettingsView();
}

function _setSettingsFeedTab(tab) {
  _settingsFeedTab = tab;
  renderSettingsView();
}

async function openSettings() {
  hideAllViews();
  const view = await ensureView('settings-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'settings';
  setSidebarActive('sb-settings');
  renderSettingsView();
}

function renderSettingsView() {
  // Render sidebar
  const sidebar = document.getElementById('settings-sidebar');
  if (sidebar) {
    var sbViews = [
      RawHTML('<div style="padding:0 12px 12px;"><span class="text-[1.1rem] font-semibold text-primary">Settings</span></div>')
    ];
    _SETTINGS_SECTIONS.forEach(function(s) {
      if (s.type === 'label') {
        sbViews.push(RawHTML('<div class="nr-settings-sidebar-label">' + escapeHtml(s.text) + '</div>'));
        return;
      }
      var active = _settingsSection === s.key;
      var btn = new (window._AetherUIView || View)('button');
      btn.el.className = 'w-full flex items-center gap-2.5 px-3 py-2 text-left text-[0.8rem] rounded-md transition-colors ' + (active ? 'bg-accent/10 text-accent' : 'text-muted hover:text-primary hover:bg-hover');
      btn.cssText('width:calc(100% - 16px);margin:0 8px;');
      btn.el.innerHTML = s.icon + ' ' + s.label;
      btn.el.addEventListener('click', function() { _setSettingsSection(s.key); });
      sbViews.push(btn);
    });
    sbViews.push(RawHTML('<div style="margin-top:auto;padding:12px 16px;"><div id="settings-version" style="color:var(--nr-text-quaternary);font-size:0.65rem;"></div></div>'));
    AetherUI.mount(VStack(sbViews), sidebar);
  }

  // Render content pane
  const pane = document.getElementById('settings-content-pane');
  if (pane) {
    const titles = { profile: 'Profile', appearance: 'Appearance', browser: 'Browser', ai: 'AI', feed: 'Feed', context: 'Context', help: 'Help' };
    var titleView = RawHTML('<h2 class="text-[1.2rem] font-semibold text-primary mb-5">' + (titles[_settingsSection] || 'Settings') + '</h2>');
    var sectionView;

    if (_settingsSection === 'profile') {
      var helpTip = RawHTML('<div class="mt-6 p-3 rounded-lg border border-border-subtle bg-card/50"><div class="flex items-center gap-2 text-[0.8rem]">' + icon('helpCircle', { size: 15, stroke: 'var(--nr-accent)' }) + '<span class="text-primary">Right-click anywhere and type <kbd class="kbd-key" style="font-size:0.7rem">/help</kbd> to see all commands, instant answers & shortcuts.</span></div></div>');
      sectionView = VStack([_renderAccountSettings(), helpTip]);
    } else if (_settingsSection === 'appearance') {
      sectionView = _renderAppearanceSettings();
    } else if (_settingsSection === 'browser') {
      sectionView = _renderBrowserSettings();
    } else if (_settingsSection === 'ai') {
      sectionView = _renderAISettings();
    } else if (_settingsSection === 'feed') {
      sectionView = _renderFeedSettings();
    } else if (_settingsSection === 'context') {
      sectionView = _renderContextSettings();
    } else if (_settingsSection === 'help') {
      sectionView = _renderHelpSettings();
    }

    AetherUI.mount(VStack([titleView, sectionView]), pane);
  }

  // Load version
  apiGet('/api/version').then(v => {
    const el = document.getElementById('settings-version');
    if (el && v.version) el.textContent = 'v' + v.version + (v.sha ? ' (' + v.sha + ')' : '');
  }).catch((e) => { /* fire-and-forget */ });

  // Section-specific post-render hooks
  if (_settingsSection === 'appearance') {
    updateSpinnerPreview(getSelectedSpinner());
  } else if (_settingsSection === 'feed') {
    if (_settingsFeedTab === 'quality') {
      if (typeof renderBlockedWordsList === 'function') renderBlockedWordsList();
      apiGet('/api/quality-prompt').then(function(data) {
        if (data.prompt) {
          Settings.set('qualityPrompt', data.prompt);
          const el = document.getElementById('quality-prompt-input');
          if (el) el.value = data.prompt;
        }
        const scoringEl = document.getElementById('scoring-prompt-display');
        if (scoringEl && data.scoringPrompt) scoringEl.textContent = data.scoringPrompt;
      }).catch(function(e){ console.warn('loadQualityPrompt:', e); });
    } else if (_settingsFeedTab === 'algorithm') {
      if (typeof _renderPersonalizationPanel === 'function') _renderPersonalizationPanel();
    }
  } else if (_settingsSection === 'ai') {
    loadVaultPath();
    _loadSettingsModels();
  } else if (_settingsSection === 'browser') {
    _urlBarSectionDragSetup();
    _loadSettingsPasswords();
    if (window.electronAPI && window.electronAPI.adblockStats) {
      window.electronAPI.adblockStats().then(stats => {
        const el = document.getElementById('adblock-rules-info');
        if (!el) return;
        if (stats.lists && stats.lists.length > 0) {
          const count = (stats.ruleCount || 0).toLocaleString();
          el.textContent = `${stats.lists.join(' + ')}: ${count} rules loaded.`;
        } else {
          el.textContent = 'No filter lists loaded yet. Click "Update filter lists" to download.';
        }
      }).catch((e) => { /* fire-and-forget */ });
    }
  } else if (_settingsSection === 'context') {
    _loadContextFiles();
  }
}
