let _settingsSection = sessionStorage.getItem('settingsSection') || 'profile';

const _SETTINGS_SECTIONS = [
  { key: 'profile', label: 'Profile', icon: icon('profile', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'appearance', label: 'Appearance', icon: icon('appearance', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'feed', label: 'Feed & Reading', icon: icon('feedReading', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'tools', label: 'Tools', icon: icon('tools', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'browser', label: 'Browser', icon: icon('browse', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'panel', label: 'Lookup Panel', icon: icon('chatBubble', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'agent', label: 'Agent', icon: icon('star', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'prompts', label: 'Prompts', icon: icon('prompts', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'context', label: 'Context', icon: icon('document', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'help', label: 'Help', icon: icon('help', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
];

let _settingsFeedTab = 'insights';

function _setSettingsSection(section) {
  _settingsSection = section;
  sessionStorage.setItem('settingsSection', section);
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
    let sbHtml = '<div style="padding:0 12px 12px;"><span class="text-[1.1rem] font-semibold text-primary">Settings</span></div>';
    for (const s of _SETTINGS_SECTIONS) {
      const active = _settingsSection === s.key;
      sbHtml += '<button onclick="_setSettingsSection(\'' + s.key + '\')" class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[0.8rem] rounded-md transition-colors ' + (active ? 'bg-accent/10 text-accent' : 'text-muted hover:text-primary hover:bg-hover') + '" style="width:calc(100% - 16px);margin:0 8px;">' + s.icon + ' ' + s.label + '</button>';
    }
    sbHtml += '<div style="margin-top:auto;padding:12px 16px;"><div id="settings-version" style="color:var(--nr-text-quaternary);font-size:0.65rem;"></div></div>';
    sidebar.innerHTML = sbHtml;
  }

  // Render content pane
  const pane = document.getElementById('settings-content-pane');
  if (pane) {
    const titles = { profile: 'Profile', appearance: 'Appearance', feed: 'Feed & Reading', tools: 'Tools', browser: 'Browser', panel: 'Lookup Panel', agent: 'Agent', prompts: 'Prompts', context: 'Context', help: 'Help' };
    let content = '<h2 class="text-[1.2rem] font-semibold text-primary mb-5">' + (titles[_settingsSection] || 'Settings') + '</h2>';

    if (_settingsSection === 'profile') {
      content += _renderAccountSettings();
      content += '<div class="mt-6 p-3 rounded-lg border border-border-subtle bg-card/50"><div class="flex items-center gap-2 text-[0.8rem]">' + icon('helpCircle', { size: 15, stroke: 'var(--nr-accent)' }) + '<span class="text-primary">Right-click anywhere and type <kbd class="kbd-key" style="font-size:0.7rem">/help</kbd> to see all commands, instant answers & shortcuts.</span></div></div>';
    } else if (_settingsSection === 'appearance') {
      content += _renderAppearanceSettings();
    } else if (_settingsSection === 'feed') {
      content += _renderFeedSettings();
    } else if (_settingsSection === 'tools') {
      content += _renderToolsSettings();
    } else if (_settingsSection === 'browser') {
      content += _renderBrowserSettings();
    } else if (_settingsSection === 'panel') {
      content += _renderPanelSettings();
    } else if (_settingsSection === 'agent') {
      content += _renderAgentSettings();
    } else if (_settingsSection === 'prompts') {
      content += _renderPromptsSettings();
    } else if (_settingsSection === 'context') {
      content += _renderContextSettings();
    } else if (_settingsSection === 'help') {
      content += _renderHelpSettings();
    }

    pane.innerHTML = content;
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
          localStorage.setItem('qualityPrompt', data.prompt);
          const el = document.getElementById('quality-prompt-input');
          if (el) el.value = data.prompt;
        }
        const scoringEl = document.getElementById('scoring-prompt-display');
        if (scoringEl && data.scoringPrompt) scoringEl.textContent = data.scoringPrompt;
      }).catch(function(e){ console.warn('loadQualityPrompt:', e); });
    } else if (_settingsFeedTab === 'algorithm') {
      if (typeof _renderPersonalizationPanel === 'function') _renderPersonalizationPanel();
    }
  } else if (_settingsSection === 'tools') {
    loadVaultPath();
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
  } else if (_settingsSection === 'prompts') {
    _loadPromptsData();
  } else if (_settingsSection === 'context') {
    _loadContextFiles();
  }
}
