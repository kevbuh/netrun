// core-profile.js — User profile, greeting
// Extracted from core.js
import Settings from '/js/core/core-settings.js';
import { apiGet, apiPost, apiPut } from '/js/api.js';
import { escapeHtml, fmtNum } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { syncToServer } from '/js/core/core-auth.js';
import { debounce, setSidebarActive } from '/js/core/core-layout.js';
import { ensureView, FEED_CATALOG, getSourceChip, hideAllViews } from '/js/core/core-views.js';
import { _relativeTime } from '/js/search.js';
import { _renderPetThumb } from '/js/pixel-pet.js';
import { getFeedSources } from '/js/feed.js';
import { openSettings, renderSettingsView } from '/js/settings/settings-core.js';
import { logger } from '/js/logger.js';

// ── Module-level refs for message form (set by renderUserProfile, used by showProfileMessageForm/sendProfileMessage) ──
let _msgFormEl = null;       // raw DOM element for the #profile-message-form container
let _msgTextareaEl = null;   // raw DOM element for the textarea (set when form is rendered)
let _msgStatusState = null;  // State({ text, color }) for status line

// ── User Profile ──

export async function openUserProfile(username) {
  hideAllViews();
  const view = await ensureView('profile-view');
  view.classList.add('active');  // raw DOM node from ensureView — classList manipulation is necessary here
  view.style.display = 'block';  // raw DOM node from ensureView — style manipulation is necessary here
  if (username) {
    window.location.hash = 'profile/' + encodeURIComponent(username);
  } else {
    window.location.hash = 'profile';
  }
  setSidebarActive(username ? '' : 'sb-people');
  renderUserProfile(username);
}

function _profileUserCard(u, size) {
  const joinDate = u.created ? new Date(u.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '';
  const imgSize = size === 'grid' ? 'w-12 h-12' : 'w-8 h-8';
  const textSize = size === 'grid' ? 'text-lg' : 'text-sm';

  let avatar;
  if (u.picture) {
    avatar = window.Image(u.picture).className(imgSize + ' rounded-full').attr('referrerpolicy', 'no-referrer');
  } else {
    avatar = window.Text((u.username || '?')[0].toUpperCase())
      .className(imgSize + ' rounded-full bg-accent/20 text-accent flex items-center justify-center ' + textSize + ' font-bold');
  }

  if (size === 'grid') {
    const card = window.VStack(avatar, window.Text(u.username).className('text-primary text-sm font-medium'));
    if (joinDate) card.add(window.Text('Joined ' + joinDate).className('text-dimmer text-[0.7rem]'));
    card.spacing(2).className('flex items-center px-4 py-4 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors cursor-pointer');
    card.onTap(function() { location.hash = '#profile/' + encodeURIComponent(u.username); });
    return card;
  }
  // list mode
  const row = window.HStack(avatar, window.Text(u.username).className('text-primary text-sm font-medium')).spacing(3);
  row.className('px-3 py-2.5 rounded-lg hover:bg-hover transition-colors cursor-pointer');
  row.onTap(function() { location.hash = '#profile/' + encodeURIComponent(u.username); });
  return row;
}

export async function renderUserProfile(username) {
  const el = document.getElementById('profile-content');
  if (!el) return;

  // No username → search/browse mode
  if (!username) {
    const searchInput = window.TextField('Search by username...')
      .className('w-full bg-input border border-border-input rounded-lg px-4 py-2.5 text-primary text-sm outline-none focus:border-accent mb-4');
    const searchResultsView = new window.View('div');
    const allUsersView = new window.View('div');
    AetherUI.mount(window.VStack(
      window.Text('Find a user').className('text-[1.3rem] font-semibold text-white_ mb-5'),
      searchInput,
      searchResultsView,
      allUsersView
    ), el);

    // Load all users immediately
    AetherUI.mount(window.Text('Loading users...').className('text-dimmer text-sm'), allUsersView.el);
    try {
      const users = await apiGet('/api/users');
      if (!users.length) {
        AetherUI.mount(window.Text('No users yet').className('text-dimmer text-sm'), allUsersView.el);
      } else {
        const grid = new window.View('div');
        grid.el.className = 'grid gap-3';
        grid.styles({ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' });
        users.forEach(function(u) { AetherUI.append(_profileUserCard(u, 'grid'), grid.el); });
        AetherUI.mount(grid, allUsersView.el);
      }
    } catch (e) {
      AetherUI.mount(window.Text('Failed to load users').className('text-dimmer text-sm'), allUsersView.el);
      logger.error('Load users error', e);
    }

    let debounceTimer = null;
    searchInput.el.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const q = searchInput.el.value.trim();
        if (!q) {
          AetherUI.mount(new window.View('div'), searchResultsView.el);
          allUsersView.el.style.display = '';
          return;
        }
        allUsersView.el.style.display = 'none';
        try {
          const users = await apiGet('/api/users?q=' + encodeURIComponent(q));
          if (!users.length) {
            AetherUI.mount(window.Text('No users found').className('text-dimmer text-sm'), searchResultsView.el);
            return;
          }
          AetherUI.mount(new window.View('div'), searchResultsView.el);
          users.forEach(function(u) { AetherUI.append(_profileUserCard(u, 'list'), searchResultsView.el); });
        } catch (e) { logger.error('User search error', e); }
      }, 300);
    });
    setTimeout(() => searchInput.el.focus(), 50);
    return;
  }

  // Loading state
  AetherUI.mount(window.Text('Loading profile...').className('text-dimmer text-sm mt-8 text-center'), el);

  try {
    const [profile, comments, reposts, feeds, achievementsData] = await Promise.all([
      apiGet('/api/users/' + encodeURIComponent(username)),
      apiGet('/api/users/' + encodeURIComponent(username) + '/comments'),
      apiGet('/api/users/' + encodeURIComponent(username) + '/reposts'),
      apiGet('/api/users/' + encodeURIComponent(username) + '/feeds'),
      apiGet('/api/achievements/' + encodeURIComponent(username)),
    ]).catch(err => {
      AetherUI.mount(window.Text('User not found').className('text-dimmer text-sm mt-8 text-center'), el);
      throw err;
    });
    const achievements = achievementsData.achievements || [];

    // Handle private profiles
    if (profile.profile_private) {
      const privAvatar = window.Show(profile.picture, function() {
        return window.Image(profile.picture).className('w-20 h-20 rounded-full mb-4 opacity-60').attr('referrerpolicy', 'no-referrer');
      }, function() {
        return window.Text((profile.username || '?')[0].toUpperCase())
          .className('w-20 h-20 rounded-full bg-accent/10 text-accent/40 flex items-center justify-center text-3xl font-bold mb-4');
      });
      AetherUI.mount(window.VStack(
        privAvatar,
        window.HStack(window.Text(profile.username).className('text-[1.2rem] font-semibold text-white_')).spacing(2).className('mb-2'),
        window.HStack(window.RawHTML(icon('lock', { size: 14 })), window.Text('This profile is private').className('text-sm')).spacing(1.5).className('text-dimmer')
      ).className('flex flex-col items-center justify-center py-16'), el);
      return;
    }

    const joinDate = profile.created ? new Date(profile.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : '';
    const isOwnProfile = window._authUserInfo && window._authUserInfo.username === profile.username;
    const accentColor = profile.accent_color || '#b4451a';

    const sections = [];

    // ── Header banner ──
    const banner = new window.View('div');
    banner.className('relative rounded-xl overflow-hidden mb-6');
    banner.cssText('min-height:120px;' + (profile.profile_bg
      ? "background:url('" + profile.profile_bg.replace(/'/g, "\\'") + "') center/cover no-repeat"
      : 'background:linear-gradient(135deg, ' + accentColor + '33, ' + accentColor + '11)'));
    const bannerGrad = new window.View('div');
    bannerGrad.cssText('position:absolute;bottom:0;left:0;right:0;height:60px;background:linear-gradient(to top,var(--nr-bg-body),transparent)');
    banner.add(bannerGrad);
    if (isOwnProfile) {
      const bgBtn = new window.View('button');
      bgBtn.className('absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center bg-black/40 text-white/70 hover:text-white border-none cursor-pointer transition-colors');
      bgBtn.attr('title', 'Change background');
      bgBtn.add(window.RawHTML(icon('camera', { size: 14 })));
      bgBtn.onTap(function() { _uploadProfileBg(); });
      banner.add(bgBtn);
    }
    sections.push(banner);

    // ── Avatar + name row ──
    const avatar = window.Show(profile.picture, function() {
      return window.Image(profile.picture).className('w-16 h-16 rounded-full border-[3px]').attr('referrerpolicy', 'no-referrer')
        .styles({ borderColor: 'var(--nr-bg-body)' });
    }, function() {
      return window.Text((profile.username || '?')[0].toUpperCase())
        .className('w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold border-[3px]')
        .cssText('border-color:var(--nr-bg-body);background:' + accentColor + '33;color:' + accentColor);
    });
    const avatarWrap = new window.View('div');
    avatarWrap.className('relative group');
    avatarWrap.add(avatar);
    if (isOwnProfile) {
      const picBtn = new window.View('button');
      picBtn.className('absolute inset-0 w-full h-full rounded-full bg-black/0 hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-none');
      picBtn.attr('title', 'Change picture');
      picBtn.add(window.RawHTML(icon('camera', { size: 20, stroke: '#fff' })));
      picBtn.onTap(function() { _uploadProfilePic(); });
      avatarWrap.add(picBtn);
    }

    // Name + status
    const isOnline = profile.last_seen && (Date.now() / 1000 - profile.last_seen) < 300;
    const statusDot = new window.View('div');
    statusDot.className('w-2.5 h-2.5 rounded-full');
    statusDot.styles(isOnline
      ? { background: '#22c55e', boxShadow: '0 0 4px #22c55e80' }
      : { background: '#6b7280' });
    statusDot.el.title = isOnline ? 'Online' : 'Offline';

    const nameCol = window.VStack(
      window.HStack(window.Text(profile.username).className('text-[1.3rem] font-semibold text-white_'), statusDot).spacing(2)
    );
    if (profile.status_emoji || profile.status_text) {
      const statusRow = window.HStack();
      statusRow.spacing(1.5).className('mt-1');
      if (profile.status_emoji) {
        const petCanvas = new window.View('canvas');
        petCanvas.className('profile-status-pet shrink-0');
        petCanvas.el.width = 18; petCanvas.el.height = 18;
        petCanvas.attr('data-type', profile.status_emoji);
        petCanvas.styles({ imageRendering: 'pixelated' });
        statusRow.add(petCanvas);
      }
      if (profile.status_text) statusRow.add(window.Text(profile.status_text).className('text-dim text-[0.78rem]'));
      nameCol.add(statusRow);
    }
    if (joinDate) nameCol.add(window.Text('Joined ' + joinDate).className('text-dimmer text-[0.78rem] mt-0.5'));

    let actionBtn;
    if (isOwnProfile) {
      actionBtn = new window.View('button');
      actionBtn.className('w-8 h-8 rounded-lg flex items-center justify-center bg-transparent border border-border-card text-dim hover:text-primary hover:border-accent/40 cursor-pointer transition-colors');
      actionBtn.attr('title', 'Settings');
      actionBtn.add(window.RawHTML(icon('settings', { size: 16, class: 'fill-current' })));
      actionBtn.onTap(function() { openSettings(); });
    } else {
      actionBtn = window.Button('Message').className('px-3 py-1 rounded-md text-[0.78rem] bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors');
      actionBtn.onTap(function() { showProfileMessageForm(profile.username); });
    }

    sections.push(window.HStack(avatarWrap, nameCol, window.Spacer(), actionBtn).spacing(4).className('mb-6 -mt-12 relative z-10 px-2'));
    const msgFormView = new window.View('div').className('hidden mb-6');
    _msgFormEl = msgFormView.el;
    _msgStatusState = null; // reset on each profile render
    sections.push(msgFormView);

    // ── Stats row ──
    const statsItems = [];
    function _statLink(count, label, sectionId) {
      if (!count) {
        return window.HStack(window.Text('0').className('text-white_ font-semibold'), window.Text(label).className('text-dimmer')).spacing(0.5);
      }
      const link = window.HStack(window.Text(String(count)).className('text-white_ font-semibold'), window.Text(label).className('text-dimmer')).spacing(0.5);
      link.className('hover:text-accent cursor-pointer');
      link.onTap(function() {
        const s = document.getElementById(sectionId);
        if (s) s.scrollIntoView({ behavior: 'smooth' });
      });
      return link;
    }
    statsItems.push(_statLink(comments.length, 'comments', 'profile-section-comments'));
    statsItems.push(_statLink(reposts.length, 'reposts', 'profile-section-reposts'));
    sections.push(window.HStack(statsItems).spacing(6).className('mb-8 text-[0.82rem]'));

    // ── Achievements section ──
    if (achievements.length) {
      const achItems = achievements.map(function(ach) {
        const unlockedDate = ach.unlocked_at ? new Date(ach.unlocked_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        const achCard = window.HStack(
          window.RawHTML(icon('help', { size: 24, strokeWidth: '1.5' })).className('achievement-icon'),
          window.VStack(
            window.Text(ach.name).className('text-primary text-sm font-medium'),
            window.Text(ach.description).className('text-dimmer text-[0.7rem]')
          )
        ).spacing(3).className('inline-flex items-center px-4 py-2.5 rounded-lg border border-accent/30 bg-accent/5');
        achCard.el.title = ach.description + (unlockedDate ? ' \u00b7 Unlocked ' + unlockedDate : '');
        return achCard;
      });
      sections.push(_profileSection('Achievements', 'profile-section-achievements',
        window.HStack(achItems).className('flex flex-wrap gap-2')));
    }

    // ── Feeds section ──
    const catalogFeeds = feeds.catalogFeeds || [];
    const customFeeds = feeds.customFeeds || [];
    if (catalogFeeds.length || customFeeds.length) {
      const myFeedSources = typeof getFeedSources === 'function' ? getFeedSources() : {};
      const feedChips = [];
      for (const key of catalogFeeds) {
        const chip = getSourceChip(key);
        const subscribed = !!myFeedSources[key];
        var feedEl;
        if (chip) {
          feedEl = window.HStack(window.RawHTML(chip));
        } else {
          const entry = FEED_CATALOG.find(f => f.key === key);
          feedEl = window.HStack(window.Text(entry ? entry.name : key).className('text-primary'));
        }
        if (!subscribed) {
          const subBtn = window.Button('+ Subscribe').className('text-[0.65rem] text-accent hover:underline ml-1 bg-transparent border-none cursor-pointer');
          (function(k, btn) {
            btn.onTap(function() {
              window._profileSubscribeFeed(k, btn.el);
            });
          })(key, subBtn);
          feedEl.add(subBtn);
        }
        feedEl.className('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-card bg-card text-sm');
        feedChips.push(feedEl);
      }
      for (const cf of customFeeds) {
        feedChips.push(window.Text(cf.name || cf.url).className('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-card bg-card text-sm text-primary'));
      }
      sections.push(_profileSection('Feeds', null, window.HStack(feedChips).className('flex flex-wrap gap-2')));
    }

    // ── Recent comments section ──
    if (comments.length) {
      const commentCards = comments.map(function(c) {
        const tAgo = typeof _relativeTime === 'function' ? _relativeTime(c.timestamp) : '';
        const contentPreview = (c.content || '').length > 120 ? c.content.slice(0, 120) + '...' : c.content;
        const card = window.VStack(
          window.Text(contentPreview).className('text-[0.78rem] text-primary leading-relaxed'),
          window.Text(tAgo).className('text-dimmer text-[0.7rem] mt-1')
        );
        card.className('block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors cursor-pointer');
        card.onTap(function() { location.hash = '#paper/' + encodeURIComponent(c.paperLink); });
        return card;
      });
      sections.push(_profileSection('Recent Comments', 'profile-section-comments', window.VStack(commentCards).spacing(2)));
    }

    // ── Reposts section ──
    if (reposts.length) {
      const repostCards = reposts.map(function(r) {
        const tAgo = typeof _relativeTime === 'function' ? _relativeTime(r.timestamp) : '';
        let hostname = '';
        try { hostname = new URL(r.paperLink).hostname.replace(/^www\./, ''); } catch (e) {}
        const card = window.VStack(
          window.HStack(window.RawHTML(icon('repost', { size: 14 })).className('text-green-400 shrink-0'), window.Text(r.paperTitle || r.paperLink).className('text-[0.78rem] text-primary leading-relaxed truncate')).spacing(2),
          window.Text((hostname ? hostname + ' \u00b7 ' : '') + tAgo).className('text-dimmer text-[0.7rem] mt-1')
        );
        card.className('block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors cursor-pointer');
        card.onTap(function() { location.hash = '#view/' + encodeURIComponent(r.paperLink); });
        return card;
      });
      sections.push(_profileSection('Reposts', 'profile-section-reposts', window.VStack(repostCards).spacing(2)));
    }

    if (!comments.length && !reposts.length && !catalogFeeds.length && !customFeeds.length) {
      sections.push(window.Text('No shared activity yet.').className('text-dimmer text-sm mt-4'));
    }

    AetherUI.mount(window.VStack(sections), el);

    // Render status pet thumbnails
    if (typeof _renderPetThumb === 'function') {
      el.querySelectorAll('.profile-status-pet').forEach(c => {
        const thumb = _renderPetThumb(c.dataset.type, 18);
        if (thumb) c.getContext('2d').drawImage(thumb, 0, 0);
      });
    }
  } catch (e) {
    logger.error('Profile load error', e);
    AetherUI.mount(window.Text('Failed to load profile').className('text-dimmer text-sm mt-8 text-center'), el);
  }
}

function _profileSection(title, sectionId, content) {
  const section = window.VStack(
    window.Text(title).className('text-muted text-xs font-semibold mb-3 uppercase tracking-wide'),
    content
  ).className('mb-8');
  if (sectionId) section.id(sectionId);
  return section;
}

export function _profileSubscribeFeed(key, btn) {
  const sources = getFeedSources();
  sources[key] = true;
  Settings.setJSON('feedSources', sources);
  syncToServer();
  btn.replaceWith(window.Text('Subscribed').className('text-[0.65rem] text-green-400 ml-1').el);
}

export function showProfileMessageForm(username) {
  const el = _msgFormEl;
  if (!el) return;
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');

  const textarea = new window.View('textarea');
  textarea.className('w-full text-[0.82rem] bg-input border border-border-input rounded-lg px-3 py-2 text-primary resize-none outline-none focus:border-accent');
  textarea.el.rows = 3;
  textarea.el.placeholder = 'Write a message to ' + username + '...';
  _msgTextareaEl = textarea.el;

  _msgStatusState = window.State({ text: '', color: '' });
  const statusText = window.Text('').className('text-[0.75rem] ml-2');
  window.Effect(function() {
    const s = _msgStatusState.value;
    statusText.el.textContent = s.text;
    statusText.el.style.color = s.color;
  });

  AetherUI.mount(window.VStack(
    textarea,
    window.HStack(
      window.Button('Send').className('px-3 py-1 rounded-md text-[0.78rem] bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors')
        .onTap(function() { sendProfileMessage(username); }),
      window.Button('Cancel').className('px-3 py-1 rounded-md text-[0.78rem] border border-border-input text-muted bg-transparent cursor-pointer hover:text-primary transition-colors')
        .onTap(function() { if (_msgFormEl) _msgFormEl.classList.add('hidden'); }),
      statusText
    ).spacing(2).className('mt-2')
  ).className('p-4 rounded-lg border border-border-card bg-card'), el);

  setTimeout(function() { if (_msgTextareaEl) _msgTextareaEl.focus(); }, 50);
}

export async function sendProfileMessage(username) {
  const textarea = _msgTextareaEl;
  const content = (textarea ? textarea.value : '').trim();
  if (!content) return;
  try {
    const data = await apiPost('/api/messages', { to_username: username, content });
    if (data.error) {
      if (_msgStatusState) _msgStatusState.value = { text: data.error, color: 'var(--nr-text-secondary)' };
    } else {
      if (_msgStatusState) _msgStatusState.value = { text: 'Message sent!', color: 'var(--nr-accent)' };
      textarea.value = '';
      setTimeout(function() { if (_msgFormEl) _msgFormEl.classList.add('hidden'); }, 1500);
    }
  } catch (err) {
    if (_msgStatusState) _msgStatusState.value = { text: 'Failed to send', color: 'var(--nr-text-secondary)' };
  }
}

export function _uploadProfilePic() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = await apiPut('/api/users/me/picture', { image: reader.result });
        if (data.picture) {
          if (window._authUserInfo) window._authUserInfo.picture = data.picture;
          const hash = window.location.hash;
          if (hash.startsWith('#profile')) renderUserProfile(window._authUserInfo?.username);
          if (hash === '#settings' && typeof renderSettingsView === 'function') renderSettingsView();
        }
      } catch (e) { logger.error('Picture upload error', e); }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

export function _uploadProfileBg() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = await apiPut('/api/users/me/background', { image: reader.result });
        if (data.profile_bg) {
          renderUserProfile(window._authUserInfo?.username);
        }
      } catch (e) { logger.error('Background upload error', e); }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ── Greeting system ──
export function getGreeting() {
  const name = (window._authUserInfo && (window._authUserInfo.name || '').split(' ')[0]) || Settings.get('userName') || '';
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  const n = (s) => name ? `${s}, ${name}` : s;
  const nQ = (s) => name ? `${s}, ${name}?` : `${s}?`;

  const timeGreetings = hour < 5
    ? [n('Hello, night owl')]
    : hour < 12
    ? [n('Good morning')]
    : hour < 17
    ? [n('Good afternoon')]
    : hour < 21
    ? [n('Good evening')]
    : [n('Evening')];

  const dayGreetings = [];
  if (day === 0) { dayGreetings.push(n('Happy Sunday')); dayGreetings.push(name ? `Sunday session, ${name}?` : 'Sunday session'); }
  if (day === 1) dayGreetings.push(n('Happy Monday'));
  if (day === 2) dayGreetings.push(n('Happy Tuesday'));
  if (day === 3) dayGreetings.push(n('Happy Wednesday'));
  if (day === 4) dayGreetings.push(n('Happy Thursday'));
  if (day === 5) { dayGreetings.push(n('Happy Friday')); dayGreetings.push(n('That Friday feeling')); }
  if (day === 6) { dayGreetings.push(n('Happy Saturday')); dayGreetings.push(n('Welcome to the weekend')); }

  const casual = [
    n('Hey there'), nQ("How's it going"), n('Back at it'),
    nQ("What's new"), n('Welcome'),
  ];
  if (name) casual.push(`${name} returns!`);

  const all = [...timeGreetings, ...dayGreetings, ...casual];
  return all[Math.floor(Math.random() * all.length)];
}

// ── Utilities ──
