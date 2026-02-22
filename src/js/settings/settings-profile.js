import Settings from '../core/core-settings.js';
import { escapeHtml, escapeAttr } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { _doDeleteAccount, _doLogout, enterGuestMode, exitGuestMode } from '/js/core/core-auth.js';
import { _uploadProfilePic } from '/js/core/core-profile.js';
import { _settingSection, _settingToggle } from '/js/settings/settings-helpers.js';
import { toggleProfilePrivacy } from '/js/settings/settings-theme.js';
import { apiGet } from '/js/api.js';
import { getSavedPosts, allPapers } from '/js/feed.js';

// ─── Profile Settings ──────────────────────────────────────

export function _renderAccountSettings() {
  if (window._guestMode) {
    const guestCard = window.HStack(
      window.RawHTML('<div style="width:56px;height:56px;border-radius:50%;background:var(--nr-bg-tertiary);display:flex;align-items:center;justify-content:center;"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18a2 2 0 0 0-4 0"/><path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11"/><path d="M2 11h20"/><circle cx="17" cy="18" r="3"/><circle cx="7" cy="18" r="3"/></svg></div>'),
      window.VStack(
        window.Text('Guest Mode').className('text-primary font-semibold text-[0.95rem]'),
        window.Text('Browsing without an account').className('text-dim text-[0.8rem]')
      )
    ).spacing(3).className('mb-4');
    const returnBtn = new window.View('button');
    returnBtn.el.textContent = 'Return to Account';
    returnBtn.className('px-3 py-1 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-accent hover:text-primary cursor-pointer transition-colors');
    returnBtn.onTap(function() { exitGuestMode(); });
    return _settingSection('Profile', [guestCard, returnBtn]);
  }

  // ── Rich profile card (banner + avatar + info) ──
  const profileSlot = window.VStack().className('nr-hub-profile').style('marginBottom', '16px');

  const _uname = window._authUserInfo?.username;
  if (_uname) {
    apiGet('/api/users/' + encodeURIComponent(_uname)).then(function(profile) {
      profile = profile || {};
      const username = profile.username || _uname || '';

      // Banner
      const banner = document.createElement('div');
      banner.className = 'nr-hub-profile-banner';
      if (profile.profile_bg) {
        banner.style.backgroundImage = "url('" + escapeAttr(profile.profile_bg) + "')";
        banner.style.backgroundSize = 'cover';
        banner.style.backgroundPosition = 'center';
      } else {
        banner.classList.add('nr-living-gradient');
      }
      const bannerGrad = document.createElement('div');
      bannerGrad.className = 'nr-hub-profile-banner-grad';
      banner.appendChild(bannerGrad);

      // Avatar
      const avatarHtml = profile.picture
        ? '<img src="' + escapeAttr(profile.picture) + '" referrerpolicy="no-referrer" />'
        : '<div class="nr-hub-profile-avatar-fallback">' + escapeHtml((username || '?')[0].toUpperCase()) + '</div>';

      // Info children
      const infoChildren = [
        window.RawHTML('<span>' + escapeHtml(username) + '<span class="nr-hub-online-dot"></span></span>').className('nr-hub-profile-name'),
      ];
      if (profile.status_text) {
        infoChildren.push(window.Text(profile.status_text).className('nr-hub-profile-status'));
      }
      if (profile.created) {
        infoChildren.push(
          window.Text('Joined ' + new Date(profile.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })).className('nr-hub-profile-join')
        );
      }
      infoChildren.push(
        window.RawHTML(
          '<span><strong>' + (profile.comment_count || 0) + '</strong> comments</span>' +
          '<span><strong>' + (profile.repost_count || 0) + '</strong> reposts</span>'
        ).className('nr-hub-profile-counters')
      );

      const row = window.HStack(
        window.RawHTML(avatarHtml).className('nr-hub-profile-avatar'),
        window.VStack(...infoChildren).className('nr-hub-profile-info'),
      ).className('nr-hub-profile-row');

      profileSlot.el.appendChild(banner);
      window.AetherUI.append(row, profileSlot.el);

      // Stats row
      const readSet = new Set(Settings.getJSON('readPosts', []));
      const papersRead = allPapers.filter(p => readSet.has(p.link)).length;
      const savedCount = Object.keys(getSavedPosts()).length;
      const statsData = [
        { value: papersRead, label: 'Papers Read', sub: 'in feed', color: '#60a5fa' },
        { value: savedCount, label: 'Saved', sub: 'reading list', color: '#34d399' },
        { value: 0, label: 'Projects', sub: 'active', color: '#a78bfa' },
      ];
      const statsRow = window.HStack(
        ...statsData.map(s => window.VStack(
          window.Text(String(s.value)).className('nr-hub-stat-value').style('color', s.color),
          window.Text(s.label).className('nr-hub-stat-label'),
          window.Text(s.sub).className('nr-hub-stat-sub'),
        ).className('nr-hub-stat'))
      ).className('nr-hub-stats');
      window.AetherUI.append(statsRow, profileSlot.el);
    }).catch(function() {});
  }

  // ── Settings controls ──
  const privacyToggle = _settingToggle('Private profile', 'Hide your profile from search and browse.',
    !!window._authUserInfo?.profile_private, function(on) { toggleProfilePrivacy(on); });

  const signOutBtn = new window.View('button');
  signOutBtn.el.textContent = 'Sign Out';
  signOutBtn.className('px-3 py-1 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-red-500 hover:text-red-400 cursor-pointer transition-colors');
  signOutBtn.onTap(function() { _doLogout(); });

  const deleteBtn = new window.View('button');
  deleteBtn.el.textContent = 'Delete Account';
  deleteBtn.className('px-3 py-1 rounded-md text-[0.78rem] border border-red-800/50 text-red-400/70 bg-card hover:border-red-500 hover:text-red-400 cursor-pointer transition-colors');
  deleteBtn.onTap(function() { _doDeleteAccount(); });

  const guestBtn = new window.View('button');
  guestBtn.el.textContent = window._guestMode ? 'Return to Account' : 'Guest Mode';
  guestBtn.className('px-3 py-1 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-accent hover:text-primary cursor-pointer transition-colors');
  guestBtn.onTap(function() {
    if (window._guestMode) exitGuestMode();
    else enterGuestMode();
  });

  return _settingSection('Profile', [
    profileSlot,
    privacyToggle,
    window.HStack(guestBtn, signOutBtn, deleteBtn).spacing(2).className('mt-4')
  ]);
}
