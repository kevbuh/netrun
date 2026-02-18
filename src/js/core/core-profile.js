// core-profile.js — User profile, greeting
// Extracted from core.js

// ── User Profile ──

async function openUserProfile(username) {
  hideAllViews();
  const view = await ensureView('profile-view');
  view.classList.add('active');
  view.style.display = 'block';
  if (username) {
    window.location.hash = 'profile/' + encodeURIComponent(username);
  } else {
    window.location.hash = 'profile';
  }
  setSidebarActive(username ? '' : 'sb-people');
  renderUserProfile(username);
}

async function renderUserProfile(username) {
  const el = document.getElementById('profile-content');
  if (!el) return;

  // No username → search/browse mode
  if (!username) {
    el.innerHTML = `
      <h2 class="text-[1.3rem] font-semibold text-white_ mb-5">Find a user</h2>
      <input type="text" id="profile-search-input" placeholder="Search by username..." class="w-full bg-input border border-border-input rounded-lg px-4 py-2.5 text-primary text-sm outline-none focus:border-accent mb-4">
      <div id="profile-search-results"></div>
      <div id="profile-all-users"></div>
    `;

    function renderUserGrid(container, users) {
      if (!users.length) { container.innerHTML = '<div class="text-dimmer text-sm">No users yet</div>'; return; }
      container.innerHTML = `<div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">` +
        users.map(u => {
          const joinDate = u.created ? new Date(u.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '';
          return `<a href="#profile/${encodeURIComponent(u.username)}" class="flex flex-col items-center gap-2 px-4 py-4 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            ${u.picture
              ? `<img src="${escapeAttr(u.picture)}" class="w-12 h-12 rounded-full" referrerpolicy="no-referrer" />`
              : `<div class="w-12 h-12 rounded-full bg-accent/20 text-accent flex items-center justify-center text-lg font-bold">${escapeHtml((u.username || '?')[0].toUpperCase())}</div>`
            }
            <span class="text-primary text-sm font-medium">${escapeHtml(u.username)}</span>
            ${joinDate ? `<span class="text-dimmer text-[0.7rem]">Joined ${joinDate}</span>` : ''}
          </a>`;
        }).join('') + '</div>';
    }

    // Load all users immediately
    const allUsersEl = document.getElementById('profile-all-users');
    allUsersEl.innerHTML = '<div class="text-dimmer text-sm">Loading users...</div>';
    try {
      const users = await apiGet('/api/users');
      renderUserGrid(allUsersEl, users);
    } catch (e) {
      allUsersEl.innerHTML = '<div class="text-dimmer text-sm">Failed to load users</div>';
      console.error('Load users error', e);
    }

    const input = document.getElementById('profile-search-input');
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const q = input.value.trim();
        const results = document.getElementById('profile-search-results');
        const allUsers = document.getElementById('profile-all-users');
        if (!q) {
          results.innerHTML = '';
          allUsers.style.display = '';
          return;
        }
        allUsers.style.display = 'none';
        try {
          const users = await apiGet('/api/users?q=' + encodeURIComponent(q));
          if (!users.length) { results.innerHTML = '<div class="text-dimmer text-sm">No users found</div>'; return; }
          results.innerHTML = users.map(u => `
            <a href="#profile/${encodeURIComponent(u.username)}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-hover transition-colors" style="text-decoration:none">
              ${u.picture
                ? `<img src="${escapeAttr(u.picture)}" class="w-8 h-8 rounded-full" referrerpolicy="no-referrer" />`
                : `<div class="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold">${escapeHtml((u.username || '?')[0].toUpperCase())}</div>`
              }
              <span class="text-primary text-sm font-medium">${escapeHtml(u.username)}</span>
            </a>
          `).join('');
        } catch (e) { console.error('User search error', e); }
      }, 300);
    });
    setTimeout(() => input.focus(), 50);
    return;
  }

  // Loading state
  el.innerHTML = '<div class="text-dimmer text-sm mt-8 text-center">Loading profile...</div>';

  try {
    const [profile, comments, experiments, reposts, feeds, blog, achievementsData] = await Promise.all([
      apiGet('/api/users/' + encodeURIComponent(username)),
      apiGet('/api/users/' + encodeURIComponent(username) + '/comments'),
      apiGet('/api/users/' + encodeURIComponent(username) + '/experiments'),
      apiGet('/api/users/' + encodeURIComponent(username) + '/reposts'),
      apiGet('/api/users/' + encodeURIComponent(username) + '/feeds'),
      apiGet('/api/blog/' + encodeURIComponent(username)),
      apiGet('/api/achievements/' + encodeURIComponent(username)),
    ]).catch(err => {
      el.innerHTML = '<div class="text-dimmer text-sm mt-8 text-center">User not found</div>';
      throw err;
    });

    const blogPosts = blog.posts || [];
    const achievements = achievementsData.achievements || [];

    // Handle private profiles
    if (profile.profile_private) {
      el.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16">
          ${profile.picture
            ? `<img src="${escapeAttr(profile.picture)}" class="w-20 h-20 rounded-full mb-4 opacity-60" referrerpolicy="no-referrer" />`
            : `<div class="w-20 h-20 rounded-full bg-accent/10 text-accent/40 flex items-center justify-center text-3xl font-bold mb-4">${escapeHtml((profile.username || '?')[0].toUpperCase())}</div>`
          }
          <div class="flex items-center gap-2 mb-2">
            <h2 class="text-[1.2rem] font-semibold text-white_">${escapeHtml(profile.username)}</h2>
          </div>
          <div class="flex items-center gap-1.5 text-dimmer text-sm">
            ${icon('lock', { size: 14 })}
            This profile is private
          </div>
        </div>`;
      return;
    }

    const joinDate = profile.created ? new Date(profile.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : '';
    const isOwnProfile = _authUserInfo && _authUserInfo.username === profile.username;
    const accentColor = profile.accent_color || '#b4451a';

    let html = `
      <div class="relative rounded-xl overflow-hidden mb-6" style="min-height:120px; ${profile.profile_bg ? `background:url('${escapeAttr(profile.profile_bg)}') center/cover no-repeat` : `background:linear-gradient(135deg, ${accentColor}33, ${accentColor}11)`}">
        <div style="position:absolute;bottom:0;left:0;right:0;height:60px;background:linear-gradient(to top,var(--nr-bg-body),transparent)"></div>
        ${isOwnProfile ? `<button onclick="_uploadProfileBg()" class="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center bg-black/40 text-white/70 hover:text-white border-none cursor-pointer transition-colors" title="Change background">
          ${icon('camera', { size: 14 })}
        </button>` : ''}
      </div>
      <div class="flex items-center gap-4 mb-6 -mt-12 relative z-10 px-2">
        <div class="relative group">
          ${profile.picture
            ? `<img src="${escapeAttr(profile.picture)}" class="w-16 h-16 rounded-full border-[3px]" style="border-color:var(--nr-bg-body)" referrerpolicy="no-referrer" />`
            : `<div class="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold border-[3px]" style="border-color:var(--nr-bg-body);background:${accentColor}33;color:${accentColor}">${escapeHtml((profile.username || '?')[0].toUpperCase())}</div>`
          }
          ${isOwnProfile ? `<button onclick="_uploadProfilePic()" class="absolute inset-0 w-full h-full rounded-full bg-black/0 hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-none" title="Change picture">
            ${icon('camera', { size: 20, stroke: '#fff' })}
          </button>` : ''}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-[1.3rem] font-semibold text-white_">${escapeHtml(profile.username)}</h2>
            ${(() => {
              const isOnline = profile.last_seen && (Date.now() / 1000 - profile.last_seen) < 300;
              const dotColor = isOnline ? '#22c55e' : '#6b7280';
              const dotTitle = isOnline ? 'Online' : 'Offline';
              const shadow = isOnline ? 'box-shadow:0 0 4px #22c55e80' : '';
              return `<div class="w-2.5 h-2.5 rounded-full" style="background:${dotColor};${shadow}" title="${dotTitle}"></div>`;
            })()}
          </div>
          ${profile.status_emoji || profile.status_text ? `<div class="flex items-center gap-1.5 mt-1">
            ${profile.status_emoji ? `<canvas class="profile-status-pet shrink-0" width="18" height="18" data-type="${escapeAttr(profile.status_emoji)}" style="image-rendering:pixelated"></canvas>` : ''}
            ${profile.status_text ? `<span class="text-dim text-[0.78rem]">${escapeHtml(profile.status_text)}</span>` : ''}
          </div>` : ''}
          ${joinDate ? `<div class="text-dimmer text-[0.78rem] mt-0.5">Joined ${joinDate}</div>` : ''}
        </div>
        <div class="ml-auto flex items-center gap-2">
          ${isOwnProfile ? `<button onclick="openSettings()" class="w-8 h-8 rounded-lg flex items-center justify-center bg-transparent border border-border-card text-dim hover:text-primary hover:border-accent/40 cursor-pointer transition-colors" title="Settings">${icon('settings', { size: 16, class: 'fill-current' })}</button>` : `<button onclick="showProfileMessageForm('${escapeAttr(profile.username)}')" class="px-3 py-1 rounded-md text-[0.78rem] bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors">Message</button>`}
        </div>
      </div>
      <div id="profile-message-form" class="hidden mb-6"></div>

      <div class="flex gap-6 mb-8 text-[0.82rem]">
        ${blogPosts.length ? `<a href="#profile-section-posts" onclick="document.getElementById('profile-section-posts')?.scrollIntoView({behavior:'smooth'});return false" class="hover:text-accent cursor-pointer" style="text-decoration:none"><span class="text-white_ font-semibold">${blogPosts.length}</span> <span class="text-dimmer">posts</span></a>` : ''}
        ${comments.length ? `<a href="#profile-section-comments" onclick="document.getElementById('profile-section-comments')?.scrollIntoView({behavior:'smooth'});return false" class="hover:text-accent cursor-pointer" style="text-decoration:none"><span class="text-white_ font-semibold">${comments.length}</span> <span class="text-dimmer">comments</span></a>` : `<div><span class="text-white_ font-semibold">0</span> <span class="text-dimmer">comments</span></div>`}
        ${reposts.length ? `<a href="#profile-section-reposts" onclick="document.getElementById('profile-section-reposts')?.scrollIntoView({behavior:'smooth'});return false" class="hover:text-accent cursor-pointer" style="text-decoration:none"><span class="text-white_ font-semibold">${reposts.length}</span> <span class="text-dimmer">reposts</span></a>` : `<div><span class="text-white_ font-semibold">0</span> <span class="text-dimmer">reposts</span></div>`}
        ${experiments.length ? `<a href="#profile-section-projects" onclick="document.getElementById('profile-section-projects')?.scrollIntoView({behavior:'smooth'});return false" class="hover:text-accent cursor-pointer" style="text-decoration:none"><span class="text-white_ font-semibold">${experiments.length}</span> <span class="text-dimmer">projects</span></a>` : `<div><span class="text-white_ font-semibold">0</span> <span class="text-dimmer">projects</span></div>`}
      </div>
    `;

    // Achievements section
    if (achievements.length) {
      html += `<div class="mb-8" id="profile-section-achievements">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Achievements</h3>
        <div class="flex flex-wrap gap-2">`;
      for (const ach of achievements) {
        const unlockedDate = ach.unlocked_at ? new Date(ach.unlocked_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        html += `
          <div class="inline-flex items-center gap-3 px-4 py-2.5 rounded-lg border border-accent/30 bg-accent/5" title="${escapeAttr(ach.description)}${unlockedDate ? ' · Unlocked ' + unlockedDate : ''}">
            <div class="achievement-icon">
              ${icon('help', { size: 24, strokeWidth: '1.5' })}
            </div>
            <div>
              <div class="text-primary text-sm font-medium">${escapeHtml(ach.name)}</div>
              <div class="text-dimmer text-[0.7rem]">${escapeHtml(ach.description)}</div>
            </div>
          </div>`;
      }
      html += '</div></div>';
    }

    // Blog posts section
    if (blogPosts.length) {
      html += `<div class="mb-8" id="profile-section-posts">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Blog Posts</h3>
        <div class="flex flex-col gap-2">`;
      for (const post of blogPosts) {
        const pubDate = post.published_at ? new Date(post.published_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        html += `
          <a href="#blog/${encodeURIComponent(username)}/${encodeURIComponent(post.slug)}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="flex items-center gap-2">
              ${icon('globe', { size: 16, class: 'text-accent shrink-0', strokeWidth: '1.5' })}
              <div class="text-primary text-sm font-medium">${escapeHtml(post.title)}</div>
            </div>
            ${pubDate ? `<div class="text-dimmer text-[0.7rem] mt-1">${pubDate}</div>` : ''}
          </a>`;
      }
      html += '</div></div>';
    }

    // Shared experiments section
    if (experiments.length) {
      html += `<div class="mb-8" id="profile-section-projects">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Shared Projects</h3>
        <div class="flex flex-col gap-2">`;
      for (const exp of experiments) {
        html += `
          <a href="#experiment/${exp.id}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="text-primary text-sm font-medium">${escapeHtml(exp.title || exp.id)}</div>
            ${exp.desc ? `<div class="text-dimmer text-[0.75rem] mt-1 line-clamp-1">${escapeHtml(exp.desc)}</div>` : ''}
          </a>`;
      }
      html += '</div></div>';
    }

    // Feeds section
    const catalogFeeds = feeds.catalogFeeds || [];
    const customFeeds = feeds.customFeeds || [];
    if (catalogFeeds.length || customFeeds.length) {
      const myFeedSources = typeof getFeedSources === 'function' ? getFeedSources() : {};
      html += `<div class="mb-8">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Feeds</h3>
        <div class="flex flex-wrap gap-2">`;
      for (const key of catalogFeeds) {
        const chip = getSourceChip(key);
        const subscribed = !!myFeedSources[key];
        if (chip) {
          html += `<div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-card bg-card text-sm">${chip}`;
          if (!subscribed) {
            html += ` <button onclick="window._profileSubscribeFeed('${escapeHtml(key)}', this)" class="text-[0.65rem] text-accent hover:underline ml-1">+ Subscribe</button>`;
          }
          html += '</div>';
        } else {
          const entry = FEED_CATALOG.find(f => f.key === key);
          const name = entry ? entry.name : key;
          html += `<div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-card bg-card text-sm text-primary">${escapeHtml(name)}`;
          if (!subscribed) {
            html += ` <button onclick="window._profileSubscribeFeed('${escapeHtml(key)}', this)" class="text-[0.65rem] text-accent hover:underline ml-1">+ Subscribe</button>`;
          }
          html += '</div>';
        }
      }
      for (const cf of customFeeds) {
        html += `<div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-card bg-card text-sm text-primary">${escapeHtml(cf.name || cf.url)}</div>`;
      }
      html += '</div></div>';
    }

    // Recent comments section
    if (comments.length) {
      html += `<div class="mb-8" id="profile-section-comments">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Recent Comments</h3>
        <div class="flex flex-col gap-2">`;
      for (const c of comments) {
        const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(c.timestamp) : '';
        const contentPreview = (c.content || '').length > 120 ? c.content.slice(0, 120) + '...' : c.content;
        html += `
          <a href="#paper/${encodeURIComponent(c.paperLink)}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="text-[0.78rem] text-primary leading-relaxed">${escapeHtml(contentPreview)}</div>
            <div class="text-dimmer text-[0.7rem] mt-1">${timeAgo}</div>
          </a>`;
      }
      html += '</div></div>';
    }

    // Reposts section
    if (reposts.length) {
      html += `<div class="mb-8" id="profile-section-reposts">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Reposts</h3>
        <div class="flex flex-col gap-2">`;
      for (const r of reposts) {
        const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(r.timestamp) : '';
        const hostname = (() => { try { return new URL(r.paperLink).hostname.replace(/^www\./, ''); } catch { return ''; } })();
        html += `
          <a href="#view/${encodeURIComponent(r.paperLink)}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="flex items-center gap-2">
              ${icon('repost', { size: 14, class: 'text-green-400 shrink-0' })}
              <div class="text-[0.78rem] text-primary leading-relaxed truncate">${escapeHtml(r.paperTitle || r.paperLink)}</div>
            </div>
            <div class="text-dimmer text-[0.7rem] mt-1">${hostname ? escapeHtml(hostname) + ' · ' : ''}${timeAgo}</div>
          </a>`;
      }
      html += '</div></div>';
    }

    if (!experiments.length && !comments.length && !reposts.length && !catalogFeeds.length && !customFeeds.length) {
      html += '<div class="text-dimmer text-sm mt-4">No shared activity yet.</div>';
    }

    el.innerHTML = html;

    // Render status pet thumbnails
    if (typeof _renderPetThumb === 'function') {
      el.querySelectorAll('.profile-status-pet').forEach(c => {
        const thumb = _renderPetThumb(c.dataset.type, 18);
        if (thumb) c.getContext('2d').drawImage(thumb, 0, 0);
      });
    }
  } catch (e) {
    console.error('Profile load error', e);
    el.innerHTML = '<div class="text-dimmer text-sm mt-8 text-center">Failed to load profile</div>';
  }
}

window._profileSubscribeFeed = function(key, btn) {
  const sources = typeof getFeedSources === 'function' ? getFeedSources() : {};
  sources[key] = true;
  Settings.setJSON('feedSources', sources);
  if (typeof syncToServer === 'function') syncToServer();
  btn.replaceWith(Object.assign(document.createElement('span'), {
    className: 'text-[0.65rem] text-green-400 ml-1',
    textContent: 'Subscribed'
  }));
};

function showProfileMessageForm(username) {
  const el = document.getElementById('profile-message-form');
  if (!el) return;
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="p-4 rounded-lg border border-border-card bg-card">
      <textarea id="profile-msg-textarea" class="w-full text-[0.82rem] bg-input border border-border-input rounded-lg px-3 py-2 text-primary resize-none outline-none focus:border-accent" rows="3" placeholder="Write a message to ${escapeHtml(username)}..."></textarea>
      <div class="flex items-center gap-2 mt-2">
        <button onclick="sendProfileMessage('${escapeAttr(username)}')" class="px-3 py-1 rounded-md text-[0.78rem] bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors">Send</button>
        <button onclick="document.getElementById('profile-message-form').classList.add('hidden')" class="px-3 py-1 rounded-md text-[0.78rem] border border-border-input text-muted bg-transparent cursor-pointer hover:text-primary transition-colors">Cancel</button>
        <span id="profile-msg-status" class="text-[0.75rem] ml-2"></span>
      </div>
    </div>
  `;
  setTimeout(() => document.getElementById('profile-msg-textarea')?.focus(), 50);
}

async function sendProfileMessage(username) {
  const textarea = document.getElementById('profile-msg-textarea');
  const status = document.getElementById('profile-msg-status');
  const content = (textarea?.value || '').trim();
  if (!content) return;
  try {
    const data = await apiPost('/api/messages', { to_username: username, content });
    if (data.error) {
      if (status) { status.style.color = 'var(--nr-text-secondary)'; status.textContent = data.error; }
    } else {
      if (status) { status.style.color = 'var(--nr-accent)'; status.textContent = 'Message sent!'; }
      textarea.value = '';
      setTimeout(() => document.getElementById('profile-message-form')?.classList.add('hidden'), 1500);
    }
  } catch (err) {
    if (status) { status.style.color = 'var(--nr-text-secondary)'; status.textContent = 'Failed to send'; }
  }
}

function _uploadProfilePic() {
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
          if (_authUserInfo) _authUserInfo.picture = data.picture;
          const hash = window.location.hash;
          if (hash.startsWith('#profile')) renderUserProfile(_authUserInfo?.username);
          if (hash === '#settings' && typeof renderSettingsView === 'function') renderSettingsView();
        }
      } catch (e) { console.error('Picture upload error', e); }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function _uploadProfileBg() {
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
          renderUserProfile(_authUserInfo?.username);
        }
      } catch (e) { console.error('Background upload error', e); }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ── Greeting system ──
function getGreeting() {
  const name = (_authUserInfo && (_authUserInfo.name || '').split(' ')[0]) || Settings.get('userName') || '';
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