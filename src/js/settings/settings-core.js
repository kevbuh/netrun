let _settingsSection = sessionStorage.getItem('settingsSection') || 'profile';

const _SETTINGS_SECTIONS = [
  { key: 'profile', label: 'Profile', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"/></svg>' },
  { key: 'appearance', label: 'Appearance', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z"/></svg>' },
  { key: 'feed', label: 'Feed & Reading', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z"/></svg>' },
  { key: 'tools', label: 'Tools', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17l-5.1 5.1a2.121 2.121 0 01-3-3l5.1-5.1m0 0L4.16 7.91a2.13 2.13 0 010-3.01l.7-.7a2.13 2.13 0 013.01 0l4.26 4.26m-1.71 6.71l6.71-6.71m0 0l4.26 4.26a2.13 2.13 0 010 3.01l-.7.7a2.13 2.13 0 01-3.01 0l-4.26-4.26m1.71-6.71L16.42 3a2.121 2.121 0 013 3l-5.17 5.17"/></svg>' },
  { key: 'browser', label: 'Browser', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"/></svg>' },
  { key: 'panel', label: 'Lookup Panel', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"/></svg>' },
  { key: 'agent', label: 'Agent', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"/></svg>' },
  { key: 'prompts', label: 'Prompts', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>' },
  { key: 'memory', label: 'Memory', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"/></svg>' },
  { key: 'help', label: 'Help', icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"/></svg>' },
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
    sbHtml += '<div style="margin-top:auto;padding:12px 16px;"><div id="settings-version" style="color:var(--text-dimmer);font-size:0.65rem;"></div></div>';
    sidebar.innerHTML = sbHtml;
  }

  // Render content pane
  const pane = document.getElementById('settings-content-pane');
  if (pane) {
    const titles = { profile: 'Profile', appearance: 'Appearance', feed: 'Feed & Reading', tools: 'Tools', browser: 'Browser', panel: 'Lookup Panel', agent: 'Agent', prompts: 'Prompts', memory: 'Memory', help: 'Help' };
    let content = '<h2 class="text-[1.2rem] font-semibold text-primary mb-5">' + (titles[_settingsSection] || 'Settings') + '</h2>';

    if (_settingsSection === 'profile') {
      content += _renderAccountSettings();
      content += '<div class="mt-6 p-3 rounded-lg border border-border-subtle bg-card/50"><div class="flex items-center gap-2 text-[0.8rem]"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span class="text-primary">Right-click anywhere and type <kbd class="kbd-key" style="font-size:0.7rem">/help</kbd> to see all commands, instant answers & shortcuts.</span></div></div>';
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
    } else if (_settingsSection === 'memory') {
      content += _renderMemorySettings();
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
  } else if (_settingsSection === 'memory') {
    _loadMemoryList(0);
  }
}
