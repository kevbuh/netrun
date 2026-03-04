// urlbar-permissions.js — Site permissions, ad blocker, DoH, privacy toggles
import Settings from '/js/core/core-settings.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { _browseApplyPermissions, _browseProxyUrl } from '/js/browse/browse-ntp.js';

// ── Ad Blocker toggle & badge ──

export function toggleAdBlock() {
  const on = Settings.get('adBlockEnabled') !== 'false';
  const newState = !on;
  Settings.set('adBlockEnabled', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.adblockSetEnabled) {
    window.electronAPI.adblockSetEnabled(newState);
  }
  _browseUpdateAdBlockBtn();
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
  // Reload current tab to apply/remove blocking
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.url && !tab.blank && tab.el) {
    if (window._browseIsElectron) {
      // Electron: just reload the webview — main process handles blocking
      if (tab.el.reload) tab.el.reload();
    } else {
      const proxied = _browseProxyUrl(tab.url);
      tab.el.dataset.originalUrl = tab.url;
      tab.el.src = proxied;
    }
  }
}

export function _browseUpdateAdBlockBtn() {
  const btn = document.getElementById('browse-adblock-btn');
  if (!btn) return;
  const on = Settings.get('adBlockEnabled') !== 'false';
  btn.style.color = on ? 'var(--nr-accent)' : '';
  btn.title = on ? 'Ad Blocker (on)' : 'Ad Blocker (off)';
  btn.classList.toggle('text-dimmer', !on);
}

export function toggleDoH() {
  const on = Settings.get('dohEnabled') !== 'false';
  const newState = !on;
  Settings.set('dohEnabled', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.dohSetConfig) {
    window.electronAPI.dohSetConfig(newState, Settings.get('dohProvider') || 'cloudflare');
  }
  _browseUpdateDohBtn();
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
}

export function _browseUpdateDohBtn() {
  const btn = document.getElementById('browse-doh-btn');
  if (!btn) return;
  const on = Settings.get('dohEnabled') !== 'false';
  btn.style.color = on ? 'var(--nr-accent)' : '';
  btn.title = on ? 'Encrypted DNS (on)' : 'Encrypted DNS (off)';
  btn.classList.toggle('text-dimmer', !on);
}

export function _browseUpdateAdBlockBadge(url) {
  const badge = document.getElementById('browse-adblock-badge');
  if (!badge) return;
  if (Settings.get('adBlockEnabled') !== 'true') {
    badge.style.display = 'none';
    return;
  }
  if (window._browseIsElectron && window.electronAPI && window.electronAPI.adblockGetCount) {
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    if (tab && tab.el && typeof tab.el.getWebContentsId === 'function') {
      try {
        const wcId = tab.el.getWebContentsId();
        window.electronAPI.adblockGetCount(wcId).then(count => {
          if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'flex';
          } else {
            badge.style.display = 'none';
          }
        }).catch(() => { badge.style.display = 'none'; });
      } catch { badge.style.display = 'none'; }
    } else {
      badge.style.display = 'none';
    }
    return;
  }
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.el) {
    try {
      const doc = tab.el.contentDocument;
      if (doc) {
        const meta = doc.querySelector('meta[name="adblock-count"]');
        if (meta) {
          const count = parseInt(meta.getAttribute('content') || '0', 10);
          if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'flex';
          } else {
            badge.style.display = 'none';
          }
          return;
        }
      }
    } catch (e) { /* cross-origin */ }
  }
  badge.style.display = 'none';
}

// ── Site Permissions ──

export const _SITE_PERM_KEYS = ['camera', 'microphone', 'location', 'notifications', 'popups'];
export const _SITE_PERM_LABELS = { camera: 'Camera', microphone: 'Microphone', location: 'Location', notifications: 'Notifications', popups: 'Pop-ups' };
export const _SITE_PERM_PROMPTS = {
  camera: 'Use your camera',
  microphone: 'Use your microphone',
  location: 'Know your location',
  notifications: 'Send you notifications',
  popups: 'Open pop-up windows'
};
export const _SITE_PERM_ICONS = {
  camera: icon('videoCamera', {size: 14}),
  microphone: icon('microphone', {size: 14}),
  location: icon('location', {size: 14}),
  notifications: icon('bell', {size: 14}),
  popups: icon('popups', {size: 14})
};
export const _SITE_PERM_ICONS_LG = {
  camera: icon('videoCamera', {size: 22, strokeWidth: '1.5'}),
  microphone: icon('microphone', {size: 22, strokeWidth: '1.5'}),
  location: icon('location', {size: 22, strokeWidth: '1.5'}),
  notifications: icon('bell', {size: 22, strokeWidth: '1.5'}),
  popups: icon('popups', {size: 22, strokeWidth: '1.5'})
};

export function _getSitePermissions(domain) {
  try {
    const all = Settings.getJSON('sitePermissions', {});
    return all[domain] || {};
  } catch { return {}; }
}

export function _setSitePermission(domain, perm, value) {
  try {
    const all = Settings.getJSON('sitePermissions', {});
    if (!all[domain]) all[domain] = {};
    if (value === 'ask') {
      delete all[domain][perm];
      if (!Object.keys(all[domain]).length) delete all[domain];
    } else {
      all[domain][perm] = value;
    }
    Settings.setJSON('sitePermissions', all);
  } catch {}
}

export function _getAllSitePermissions() {
  try { return Settings.getJSON('sitePermissions', {}); } catch { return {}; }
}

export function _clearSitePermissions(domain) {
  try {
    const all = Settings.getJSON('sitePermissions', {});
    delete all[domain];
    Settings.setJSON('sitePermissions', all);
  } catch {}
}

export function _getCurrentBrowseDomain() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.url || tab.blank) return '';
  try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; }
}

// ── Permission Confirmation Prompt ──

export function _showPermissionPrompt(domain, permKey) {
  // Remove any existing prompt
  const existing = document.getElementById('site-permission-prompt');
  if (existing) existing.remove();

  const label = _SITE_PERM_PROMPTS[permKey] || permKey;
  const permIcon = _SITE_PERM_ICONS_LG[permKey] || '';

  const overlayView = new window.View('div').attr('id', 'site-permission-prompt');
  overlayView.cssText('position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px;background:rgba(0,0,0,0.45);');
  const overlay = overlayView.el;

  // Build select element for remember decision
  const selectView = new window.View('select');
  selectView.cssText('padding:4px 8px;border-radius:6px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.75rem;cursor:pointer;');
  const optSession = new window.View('option').attr('value', 'session');
  optSession.el.textContent = 'Until I close this site';
  const optAlways = new window.View('option').attr('value', 'always');
  optAlways.el.textContent = 'Always';
  optAlways.el.selected = true;
  selectView.el.appendChild(optSession.el);
  selectView.el.appendChild(optAlways.el);

  function _getRememberVal() { return selectView.el.value; }
  function _dismissPrompt() { overlay.remove(); }

  const closeSvg = icon('close', {size: 18});

  const card = window.VStack(
    // Header row
    window.HStack(
      window.VStack(
        window.RawHTML('<div style="font-size:0.92rem;font-weight:600;color:var(--nr-text-primary);line-height:1.4;"><strong>' + escapeHtml(domain) + '</strong> wants to</div>'),
        window.HStack(
          window.RawHTML('<span style="color:var(--nr-text-quaternary);flex-shrink:0;">' + permIcon + '</span>'),
          window.Text(label).cssText('font-size:0.84rem;color:var(--nr-text-primary);')
        ).cssText('display:flex;align-items:center;gap:8px;margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--nr-bg-raised);')
      ).cssText('flex:1;'),
      window.Button(window.RawHTML(closeSvg)).cssText('background:none;border:none;cursor:pointer;color:var(--nr-text-quaternary);padding:2px;flex-shrink:0;').attr('title', 'Dismiss').onTap(function() { _dismissPrompt(); })
    ).cssText('padding:20px 20px 12px;display:flex;align-items:flex-start;gap:12px;'),
    // Remember + action buttons
    window.VStack(
      window.HStack(
        window.Text('Remember my decision').cssText('font-size:0.75rem;color:var(--nr-text-secondary);')
      ).cssText('display:flex;align-items:center;gap:8px;margin-bottom:16px;'),
      window.HStack(
        window.Button('Block').cssText('padding:6px 20px;border-radius:8px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.82rem;font-weight:500;cursor:pointer;').onTap(function() {
          if (_getRememberVal() === 'always') _setSitePermission(domain, permKey, 'block');
          if (typeof _resolvePendingPermissionRequest === 'function') _resolvePendingPermissionRequest(domain, permKey, false);
          _browseApplyPermissions();
          _dismissPrompt();
          _renderSitePermissionsDropdown();
        }),
        window.Button('Allow').cssText('padding:6px 20px;border-radius:8px;border:1px solid var(--nr-accent);background:var(--nr-accent);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;').onTap(function() {
          if (_getRememberVal() === 'always') {
            _setSitePermission(domain, permKey, 'allow');
          } else {
            _sessionPermissions[domain] = _sessionPermissions[domain] || {};
            _sessionPermissions[domain][permKey] = 'allow';
          }
          if (typeof _resolvePendingPermissionRequest === 'function') _resolvePendingPermissionRequest(domain, permKey, true);
          _browseApplyPermissions();
          _dismissPrompt();
          _renderSitePermissionsDropdown();
        })
      ).cssText('display:flex;gap:8px;justify-content:flex-end;')
    ).cssText('padding:0 20px 16px;'),
    // Footer
    window.Text('You can change your site permissions at any time from the more menu in the toolbar.').cssText('padding:8px 20px;border-top:1px solid var(--nr-border-subtle);font-size:0.68rem;color:var(--nr-text-quaternary);')
  ).cssText('background:var(--nr-bg-overlay);border:1px solid var(--nr-border-default);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);width:380px;overflow:hidden;');

  // Insert select into the remember row
  const rememberRow = card.el.querySelector('.nr-hstack');
  // The remember row is the first HStack inside the second VStack child
  const actionSection = card.el.children[1]; // second window.VStack(padding:0 20px 16px)
  const rememberHStack = actionSection && actionSection.children[0];
  if (rememberHStack) rememberHStack.appendChild(selectView.el);

  AetherUI.mount(card, overlay);

  document.body.appendChild(overlay);

  // Close on overlay background click
  overlayView.on('mousedown', function(e) {
    if (e.target === overlay) _dismissPrompt();
  });
}

// Session-only permissions (not persisted to localStorage, cleared on tab close/navigate)
export const _sessionPermissions = {};

// Get effective permissions: localStorage merged with session overrides
export function _getEffectivePermissions(domain) {
  const stored = _getSitePermissions(domain);
  const session = _sessionPermissions[domain] || {};
  return { ...stored, ...session };
}

export function _renderSitePermissionsDropdown(container) {
  const dd = container || document.getElementById('browse-menu-perms-panel');
  if (!dd) return;
  const domain = _getCurrentBrowseDomain();

  if (!domain) {
    AetherUI.mount(
      Text('Navigate to a site first').cssText('padding:12px;text-align:center;font-size:0.78rem;color:var(--aether-text-dim);'),
      dd
    );
    return;
  }

  const perms = _getSitePermissions(domain);
  const effective = _getEffectivePermissions(domain);

  const root = VStack(
    Text(domain).cssText('padding:6px 8px 4px;font-size:0.72rem;color:var(--aether-text-dimmer);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
    Text('Blocked by default. Click Allow to grant access.').cssText('padding:0 8px 4px;font-size:0.65rem;color:var(--aether-text-dimmest);line-height:1.3;')
  );

  for (const key of _SITE_PERM_KEYS) {
    const current = effective[key] || 'ask';
    const label = _SITE_PERM_LABELS[key];
    const permIcon = _SITE_PERM_ICONS[key];
    const isSession = !perms[key] && (_sessionPermissions[domain] || {})[key];

    const btnGroup = HStack().cssText('display:flex;border-radius:6px;overflow:hidden;border:1px solid var(--aether-border);');
    for (const val of ['ask', 'allow', 'block']) {
      const active = current === val;
      const bg = active ? (val === 'allow' ? 'color-mix(in srgb, #22c55e 20%, var(--aether-dropdown-bg, var(--nr-bg-overlay)))' : val === 'block' ? 'color-mix(in srgb, #ef4444 20%, var(--aether-dropdown-bg, var(--nr-bg-overlay)))' : 'color-mix(in srgb, var(--nr-accent) 20%, var(--aether-dropdown-bg, var(--nr-bg-overlay)))') : 'var(--aether-dropdown-bg, var(--nr-bg-overlay))';
      const fg = active ? (val === 'allow' ? '#22c55e' : val === 'block' ? '#ef4444' : 'var(--nr-accent)') : 'var(--aether-text-dimmer)';
      const btn = Button(val).cssText('padding:2px 7px;font-size:0.65rem;border:none;cursor:pointer;background:' + bg + ';color:' + fg + ';font-weight:' + (active ? '600' : '400') + ';text-transform:capitalize;');
      btn.onTap(function() {
        if (val === 'allow') {
          _showPermissionPrompt(domain, key);
        } else {
          _setSitePermission(domain, key, val);
          if (_sessionPermissions[domain]) delete _sessionPermissions[domain][key];
          _renderSitePermissionsDropdown();
          _browseApplyPermissions();
        }
      });
      btnGroup.add(btn);
    }

    const row = HStack(
      RawHTML('<span style="color:var(--aether-text-dimmer);flex-shrink:0;">' + permIcon + '</span>'),
      Text(label).cssText('flex:1;font-size:0.75rem;color:var(--aether-text);')
    ).cssText('display:flex;align-items:center;gap:6px;padding:4px 8px;');
    if (isSession) row.add(Text('session').cssText('font-size:0.58rem;color:var(--aether-text-dimmest);margin-right:2px;'));
    row.add(btnGroup);
    root.add(row);
  }

  // Reset button
  const resetWrap = new View('div').cssText('padding:4px 8px 6px;border-top:1px solid var(--aether-border);margin-top:2px;');
  const resetBtn = Button('Reset all to default').cssText('width:100%;padding:4px;border-radius:6px;border:1px solid var(--aether-border);background:var(--aether-dropdown-bg, var(--nr-bg-overlay));color:var(--aether-text-dim);font-size:0.72rem;cursor:pointer;');
  resetBtn.onTap(function() {
    _clearSitePermissions(domain);
    delete _sessionPermissions[domain];
    _renderSitePermissionsDropdown();
    _browseApplyPermissions();
  });
  resetWrap.add(resetBtn);
  root.add(resetWrap);

  AetherUI.mount(root, dd);
}

// ── Privacy toggles ──

export function toggleTrackingStrip() {
  const on = Settings.get('trackingStripEnabled') !== 'false';
  const newState = !on;
  Settings.set('trackingStripEnabled', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.trackingStripSetEnabled) {
    window.electronAPI.trackingStripSetEnabled(newState);
  }
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
}

export function toggleHttpsOnly() {
  const on = Settings.get('httpsOnlyEnabled') !== 'false';
  const newState = !on;
  Settings.set('httpsOnlyEnabled', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.httpsOnlySetEnabled) {
    window.electronAPI.httpsOnlySetEnabled(newState);
  }
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
}

export function toggleCookieBlock() {
  const on = Settings.get('thirdPartyCookiesBlocked') !== 'false';
  const newState = !on;
  Settings.set('thirdPartyCookiesBlocked', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.cookieBlockSetEnabled) {
    window.electronAPI.cookieBlockSetEnabled(newState);
  }
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
}

// ── Initialize button state on load ──
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', _browseUpdateAdBlockBtn);
  document.addEventListener('DOMContentLoaded', _browseUpdateDohBtn);
}

// ── Action registry ──
registerActions({
  toggleAdBlock: () => toggleAdBlock(),
  toggleDoH: () => toggleDoH(),
  toggleTrackingStrip: () => toggleTrackingStrip(),
  toggleHttpsOnly: () => toggleHttpsOnly(),
  toggleCookieBlock: () => toggleCookieBlock(),
  openSearchHistoryPage: () => window.openSearchHistoryPage(),
});
