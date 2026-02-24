import Settings from '../core/core-settings.js';
import { apiGet } from '/js/api.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { getSelectedSpinner, setSidebarActive } from '/js/core/core-layout.js';
import { ensureView, hideAllViews } from '/js/core/core-views.js';
import { _loadContextFiles, _renderContextSettings } from '/js/settings/settings-context.js';
import { _loadSettingsModels } from '/js/settings/settings-panel.js';
import { _loadSettingsPasswords, _loadBookmarkImport, _renderBrowserSettings, _urlBarSectionDragSetup } from '/js/settings/settings-browser.js';
import { _renderAISettings } from '/js/settings/settings-agent.js';
import { _renderAccountSettings } from '/js/settings/settings-profile.js';
import { _renderAppearanceSettings } from '/js/settings/settings-appearance.js';
import { _renderFeedSettings } from '/js/settings/settings-feed.js';
import { _renderHelpSettings } from '/js/settings/settings-help.js';
import { _renderDownloadsSettings } from '/js/settings/settings-downloads.js';
import { updateSpinnerPreview } from '/js/settings/settings-colors.js';

// Migrate old section keys
(function() {
  const stored = Settings.get('settingsSection');
  if (stored === 'tools' || stored === 'panel' || stored === 'agent') {
    Settings.set('settingsSection', 'ai');
  } else if (stored === 'prompts') {
    Settings.set('settingsSection', 'help');
  }
})();

export var _settingsSection = State(Settings.get('settingsSection') || 'profile');

export const _SETTINGS_SECTIONS = [
  { type: 'label', text: 'General' },
  { key: 'profile', label: 'Profile', icon: icon('profile', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'appearance', label: 'Appearance', icon: icon('appearance', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { type: 'label', text: 'Features' },
  { key: 'browser', label: 'Browser', icon: icon('browse', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'ai', label: 'AI', icon: icon('star', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'feed', label: 'Feed', icon: icon('feedReading', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'downloads', label: 'Downloads', icon: icon('download', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { type: 'label', text: 'Advanced' },
  { key: 'context', label: 'Context', icon: icon('document', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
  { key: 'help', label: 'Help', icon: icon('help', { size: 16, class: 'w-4 h-4', strokeWidth: '1.5' }) },
];

export var _settingsFeedTab = State(0); // 0=insights, 1=algorithm

export function _setSettingsSection(section) {
  _settingsSection.value = section;
  Settings.set('settingsSection', section);
}

export function _setSettingsFeedTab(tab) {
  _settingsFeedTab.value = tab;
}

export async function openSettings() {
  hideAllViews();
  const view = await ensureView('settings-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'settings';
  setSidebarActive('sb-settings');
  renderSettingsView();
}

var _hooksRegistered = false;

export function renderSettingsView() {
  // ── Sidebar (built once, active state is reactive) ──
  const sidebar = document.getElementById('settings-sidebar');
  if (sidebar && !sidebar.hasChildNodes()) {
    const sbViews = [];

    // Title
    sbViews.push(Text('Settings').font('1.1rem').fontWeight(600).foreground('primary').padding(0, 12, 12, 12));

    const base = 'w-full flex items-center gap-2.5 px-3 py-2 text-left text-[0.8rem] rounded-md transition-colors ';
    _SETTINGS_SECTIONS.forEach(function(s) {
      if (s.type === 'label') {
        sbViews.push(Text(s.text).className('nr-settings-sidebar-label'));
        return;
      }
      var btn = HStack([
        window.RawHTML(s.icon),
        Text(s.label)
      ]).spacing(10).alignment('center')
        .cssText('width:calc(100% - 16px);margin:0 8px;cursor:pointer;');
      btn.el.setAttribute('role', 'button');
      btn.onTap(function() { _setSettingsSection(s.key); });
      Effect(function() {
        var active = _settingsSection.value === s.key;
        btn.el.className = base + (active ? 'bg-accent/10 text-accent' : 'text-muted hover:text-primary hover:bg-hover');
      });
      sbViews.push(btn);
    });

    // Version (pushed to bottom via spacer)
    var versionText = VStack([]).cssText('margin-top:auto;padding:12px 16px;');
    versionText.el.id = 'settings-version';
    versionText.el.style.color = 'var(--nr-text-quaternary)';
    versionText.el.style.fontSize = '0.65rem';
    sbViews.push(versionText);

    AetherUI.mount(VStack(sbViews), sidebar);
  }

  // ── Content pane (reactive title + reactive Switch) ──
  const pane = document.getElementById('settings-content-pane');
  if (pane) {
    const titles = { profile: 'Profile', appearance: 'Appearance', browser: 'Browser', ai: 'AI', feed: 'Feed', downloads: 'Downloads', context: 'Context', help: 'Help' };
    var titleView = Text('').font('1.2rem').fontWeight(600).foreground('primary').cssText('margin-bottom:20px;');
    titleView._bindText(function() { return titles[_settingsSection.value] || 'Settings'; });

    var sectionView = window.Switch(_settingsSection, {
      profile: function() { return VStack([_renderAccountSettings()]); },
      appearance: function() { return _renderAppearanceSettings(); },
      browser: function() { return _renderBrowserSettings(); },
      ai: function() { return _renderAISettings(); },
      feed: function() { return _renderFeedSettings(); },
      downloads: function() { return _renderDownloadsSettings(); },
      context: function() { return _renderContextSettings(); },
      help: function() { return _renderHelpSettings(); },
    }).transition('fade');

    AetherUI.mount(VStack([titleView, sectionView]), pane);
  }

  // One-time setup: version info + reactive post-render hooks
  if (!_hooksRegistered) {
    _hooksRegistered = true;

    apiGet('/api/version').then(v => {
      const el = document.getElementById('settings-version');
      if (el && v.version) el.textContent = 'v' + v.version + (v.sha ? ' (' + v.sha + ')' : '');
    }).catch((e) => { /* fire-and-forget */ });

    // Section-specific post-render hooks (reactive — runs on each section change)
    Effect(function() {
      var section = _settingsSection.value;
      if (section === 'appearance') {
        updateSpinnerPreview(getSelectedSpinner());
      } else if (section === 'ai') {
        _loadSettingsModels();
      } else if (section === 'browser') {
        _urlBarSectionDragSetup();
        _loadSettingsPasswords();
        _loadBookmarkImport();
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
      } else if (section === 'context') {
        _loadContextFiles();
      }
    });
  }
}

// ── Action registry ──
registerActions({
  openSettings: () => openSettings(),
});
window._setSettingsSection = _setSettingsSection;

