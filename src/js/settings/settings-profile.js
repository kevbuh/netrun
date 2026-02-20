import Settings from '../core/core-settings.js';
import { escapeHtml, escapeAttr } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { _doDeleteAccount, _doLogout, enterGuestMode, exitGuestMode } from '/js/core/core-auth.js';
import { _uploadProfilePic } from '/js/core/core-profile.js';
import { _settingSection, _settingToggle } from '/js/settings/settings-helpers.js';
import { toggleProfilePrivacy } from '/js/settings/settings-theme.js';

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
  const avatarHtml = window._authUserInfo?.picture
    ? '<img src="' + escapeAttr(window._authUserInfo.picture) + '" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;" />'
    : '<div style="width:56px;height:56px;border-radius:50%;background:var(--nr-accent);display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:600;color:#fff;">' + escapeHtml((window._authUserInfo?.username || '?')[0].toUpperCase()) + '</div>';
  const avatar = window.RawHTML('<div class="relative group cursor-pointer" style="flex-shrink:0">' + avatarHtml +
    '<div class="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">' +
    icon('camera', { size: 20, class: 'w-5 h-5 text-white' }) + '</div></div>');
  avatar.onTap(function() { _uploadProfilePic(); });

  const profileCard = window.HStack(
    avatar,
    window.VStack(
      window.Text(window._authUserInfo?.username || '').className('text-primary font-semibold text-[0.95rem]'),
      window.Text(window._authUserInfo?.name || '').className('text-dim text-[0.8rem]'),
      window.Text(window._authUserInfo?.email || '').className('text-dim text-[0.75rem]')
    )
  ).spacing(3).className('mb-4');

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
    profileCard,
    privacyToggle,
    window.HStack(guestBtn, signOutBtn, deleteBtn).spacing(2).className('mt-4')
  ]);
}

