// toolbar-activities.js — Activity pills (island capsule items)
// Replaces island rendering from core-ui.js + core-audio.js
import Settings from '/js/core/core-settings.js';
import { icon } from '/js/core/icons.js';
import { ANN_COLORS, ANN_COLOR_MAP } from '/js/browse/browse-annotations.js';
import { visibleActivities, notifyTabsChanged } from '/js/toolbar/toolbar-state.js';
import { browseSelectTab, browseCloseTab } from '/js/browse/browse-passwords.js';
import { _getCurrentBrowseDomain } from '/js/urlbar/urlbar-permissions.js';

// ── Privacy features definition (shared by tray + stats) ──
var _privFeatures = [
  { key: 'adBlockEnabled',          label: 'Ad Blocker',       ic: 'shield',  fn: function() { if (typeof window.toggleAdBlock === 'function') window.toggleAdBlock(); }, checkOn: function(v) { return v !== 'false'; } },
  { key: 'dohEnabled',              label: 'Encrypted DNS',    ic: 'lock',    fn: function() { if (typeof window.toggleDoH === 'function') window.toggleDoH(); }, checkOn: function(v) { return v !== 'false'; } },
  { key: 'httpsOnlyEnabled',        label: 'HTTPS Only',       ic: 'globe',   fn: function() { if (typeof window.toggleHttpsOnly === 'function') window.toggleHttpsOnly(); }, checkOn: function(v) { return v !== 'false'; } },
  { key: 'trackingStripEnabled',    label: 'Tracking Strip',   ic: 'eye',     fn: function() { if (typeof window.toggleTrackingStrip === 'function') window.toggleTrackingStrip(); }, checkOn: function(v) { return v !== 'false'; } },
  { key: 'thirdPartyCookiesBlocked',label: 'Cookie Blocking',  ic: 'close',   fn: function() { if (typeof window.toggleCookieBlock === 'function') window.toggleCookieBlock(); }, checkOn: function(v) { return v !== 'false'; } },
];

// ── Pulse state provider for unified AI pill ──
let _pulseFlashTimer = null;
let _pulseLastEventTs = 0;
let _pulseIsFlashing = false;

export function _getPulseState() {
  const recent = (typeof Motion !== 'undefined' && Motion.pulse) ? Motion.pulse.recent : [];
  const lastEvent = recent.length ? recent[recent.length - 1] : null;
  if (lastEvent && lastEvent.timestamp > _pulseLastEventTs) {
    _pulseLastEventTs = lastEvent.timestamp;
    _pulseIsFlashing = true;
    if (_pulseFlashTimer) clearTimeout(_pulseFlashTimer);
    _pulseFlashTimer = setTimeout(function() {
      _pulseFlashTimer = null;
      _pulseIsFlashing = false;
      if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
    }, 3000);
  }
  return { recent: recent, lastEvent: lastEvent, isFlashing: _pulseIsFlashing };
}
window._getPulseState = _getPulseState;

// ── Page info state provider ──
export function _getPageInfoState() {
  if (!window._islandActivities) return {};
  const acts = window._islandActivities.value;
  for (const id in acts) {
    const a = acts[id];
    if (a && a.type === 'pageinfo') return { label: a.label, badges: a.badges, meta: a.meta || {} };
  }
  return {};
}
window._getPageInfoState = _getPageInfoState;

// ── Island activity CRUD ──

export function _setIslandActivity(id, data) {
  window._islandActivities.update(id, function(old) {
    return Object.assign({}, old || {}, data, { _ts: Date.now() });
  });
}

export function _clearIslandActivity(id) {
  window._islandActivities.delete(id);
}

export function islandUpdate(id, data) {
  _setIslandActivity(id, data);
  _islandRender();
}

export function islandRemove(id) {
  const sel = '.pill-island[data-island-id="' + id + '"]';
  let el = document.querySelector(sel);
  if (!el) {
    const anchor = document.getElementById('pill-island-tabs-anchor');
    if (anchor) el = anchor.querySelector(sel);
  }
  if (!el) {
    const sl = document.getElementById('pill-satellite-left');
    if (sl) el = sl.querySelector(sel);
  }
  if (!el) {
    const sr = document.getElementById('pill-satellite-right');
    if (sr) el = sr.querySelector(sel);
  }
  if (window._islandDismissTimers && window._islandDismissTimers[id]) {
    clearTimeout(window._islandDismissTimers[id]);
    delete window._islandDismissTimers[id];
  }
  _clearIslandActivity(id);
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
  if (el && !el.classList.contains('island-exiting')) {
    const parentCont = el.parentNode;
    _islandSnapshotRects(parentCont);
    el.classList.add('island-exiting');
    el.addEventListener('animationend', function onExit(ev) {
      if (ev.animationName !== 'pill-exit') return;
      el.removeEventListener('animationend', onExit);
      _islandSnapshotRects(parentCont);
      el.remove();
      _islandFlipNeighbors(parentCont);
    });
  } else if (el) {
    el.remove();
  }
}

// ── Achievement helper ──

export function showAchievement(name, description) {
  islandUpdate('achievement', {
    type: 'achievement',
    label: name || 'Unlocked!',
    detail: description || 'Achievement Unlocked!',
    cssClass: 'nr-glow',
    action: function() { islandRemove('achievement'); }
  });
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#d4a017');
}

// ── FLIP animation helpers ──

function _islandSnapshotRects(container) {
  if (!container) return;
  const pills = container.querySelectorAll('.pill-island');
  for (let i = 0; i < pills.length; i++) {
    pills[i]._flipRect = pills[i].getBoundingClientRect();
  }
}

function _islandFlipNeighbors(container) {
  if (!container) return;
  const pills = container.querySelectorAll('.pill-island');
  for (let i = 0; i < pills.length; i++) {
    const pill = pills[i];
    if (!pill._flipRect) continue;
    const newRect = pill.getBoundingClientRect();
    const dx = pill._flipRect.left - newRect.left;
    if (Math.abs(dx) < 1) continue;
    pill.style.transform = 'translateX(' + dx + 'px)';
    pill.style.transition = 'none';
    requestAnimationFrame(function(p) {
      return function() {
        p.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        p.style.transform = '';
      };
    }(pill));
    delete pill._flipRect;
  }
}

// ── Pill content renderers by type ──

export function _islandRenderPill(a) {
  const V = window.View, T = window.Text, R = window.RawHTML, H = window.HStack;
  if (a.type === 'feed-notif') {
    return H([R(icon('bell', { size: 14, stroke: 'var(--nr-accent)' })), T(a.label || '').foreground('var(--nr-accent)')]);
  } else if (a.done) {
    return H([new V('span').className('island-dot-done'), T(a.label || 'Done').foreground('#22c55e')]);
  } else if (a.type === 'download') {
    const pct = a.progress || 0;
    const circ = 2 * Math.PI * 6;
    const offset = circ * (1 - pct / 100);
    const ringHtml = pct > 0 ? '<svg class="island-ring" viewBox="0 0 16 16"><circle class="island-ring-bg" cx="8" cy="8" r="6"/><circle class="island-ring-fg" cx="8" cy="8" r="6" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" transform="rotate(-90 8 8)"/></svg>' : icon('download', { size: 14 });
    const dismiss = new V('span').className('island-dismiss').attr('data-island-dismiss', 'download')
      .opacity(0.4).padding('0', '2px')
      .styles({ marginLeft: '4px', fontSize: '15px', lineHeight: '1', cursor: 'pointer' });
    dismiss.el.textContent = '\u00d7';
    return H([R(ringHtml), T(a.label || pct + '%'), dismiss]).styles({ whiteSpace: 'nowrap', cursor: 'pointer' });
  } else if (a.type === 'tts') {
    const ttsIconHtml = a.paused ? icon('play', { size: 14 }) : window._islandWaveformBars;
    const spd = parseFloat(Settings.get('ttsSpeed')) || 1;
    const spdBadge = T(spd.toFixed(1).replace(/\.0$/, '') + 'x').className('island-tts-speed').attr('title', 'Click to change speed')
      .onTap(function(e) { e.stopPropagation(); if (typeof window._ttsCycleSpeed === 'function') window._ttsCycleSpeed(); });
    let chunkText = a.chunkText || a.label || '';
    if (chunkText.length > 40) chunkText = chunkText.slice(0, 38) + '\u2026';
    const pauseBtn = R(icon(a.paused ? 'play' : 'pause', { size: 12 })).className('island-tts-ctrl')
      .attr('title', a.paused ? 'Resume' : 'Pause')
      .onTap(function(e) { e.stopPropagation(); if (typeof window._ttsPauseResume === 'function') window._ttsPauseResume(); });
    const stopBtn = R(icon('close', { size: 12 })).className('island-tts-ctrl island-tts-stop')
      .attr('title', 'Stop')
      .onTap(function(e) { e.stopPropagation(); if (typeof window._ttsStopAll === 'function') window._ttsStopAll(); });
    return H([R(ttsIconHtml), T(chunkText).className('island-tts-chunk').truncate(), pauseBtn, stopBtn, spdBadge]);
  } else if (a.type === 'cc') {
    const ccDot = new V('span').frame({ width: 6, height: 6 }).cornerRadius('full').styles({ background: 'var(--nr-accent)', boxShadow: '0 0 6px var(--nr-accent)', flexShrink: '0' });
    return H([ccDot, T(a.label || 'CC Live').foreground('var(--nr-accent)')]);
  } else if (a.type === 'mic') {
    return H([R(icon('microphone', { size: 14, stroke: '#ef4444' })).className('island-mic-icon'), T(a.label || 'Listening\u2026').foreground('#ef4444')]);
  } else if (a.type === 'voice-result') {
    const vText = a.text || '';
    var micIcon = R(icon('microphone', { size: 14 })).className('island-voice-mic').attr('title', 'Voice transcript')
      .onTap(function(e) {
        e.stopPropagation();
        _toggleVoiceResultDropdown(micIcon.el, vText);
      });
    return micIcon;
  } else if (a.type === 'audio') {
    return H([R(window._islandAudioBars), T(a.label || '')]);
  } else if (a.type === 'ai') {
    return H([new V('span').className('island-ai-dot nr-breathe'), T(a.label || '')]);
  } else if (a.type === 'achievement') {
    return R(icon('help', { size: 14, stroke: '#caa12a' }));
  } else if (a.type === 'rss') {
    const rssIconHtml = a.subscribed
      ? icon('check', { size: 14, stroke: '#22c55e' })
      : icon('rssFeed', { size: 14, stroke: '#f97316' });
    return H([R(rssIconHtml), T(a.label || '').className('pill-rss-label').foreground(a.subscribed ? '#22c55e' : 'var(--aether-text)')]);
  } else if (a.type === 'tabs') {
    const tabItems = a.items || [];
    const nonBlank = [];
    for (let si = 0; si < tabItems.length; si++) {
      if (!tabItems[si].blank) nonBlank.push(tabItems[si]);
    }
    nonBlank.sort(function(x, y) { return (y.lastVisited || 0) - (x.lastVisited || 0); });
    if (nonBlank.length === 0) {
      return H([R(icon('windows', { size: 14 })), T('0 tabs').opacity(0.4)]);
    }
    const maxFav = parseInt(Settings.get('islandMaxFavicons'), 10) || 7;
    const visible = nonBlank.slice(0, maxFav);
    const stripChildren = [];
    for (let ti = 0; ti < visible.length; ti++) {
      const t = visible[ti];
      const cls = 'island-strip-fav' + (t.active ? ' island-strip-fav-active' : '');
      if (t.favicon) {
        const favImg = new V('img').className(cls).attr('title', t.title || 'Tab').attr('data-island-tab', t.id);
        favImg.el.src = t.favicon;
        (function(imgEl, tabId, imgCls) {
          imgEl.addEventListener('error', function() {
            const globe = R(icon('globe', { size: 16, strokeWidth: '1.5', class: imgCls }));
            globe.attr('data-island-tab', tabId);
            imgEl.replaceWith(globe.el);
          });
        })(favImg.el, t.id, cls);
        if (t.active) {
          var wrap = new V('span').className('island-strip-fav-wrap').attr('data-island-tab', t.id);
          var closeBtn = new V('button').className('island-strip-fav-close').attr('data-island-tab-close', t.id).attr('title', 'Close tab');
          closeBtn.el.textContent = '\u00d7';
          wrap.add(favImg, closeBtn);
          stripChildren.push(wrap);
        } else {
          stripChildren.push(favImg);
        }
      } else {
        const globeView = R(icon('globe', { size: 16, strokeWidth: '1.5', class: cls })).attr('title', t.title || 'Tab').attr('data-island-tab', t.id);
        if (t.active) {
          var wrap = new V('span').className('island-strip-fav-wrap').attr('data-island-tab', t.id);
          var closeBtn = new V('button').className('island-strip-fav-close').attr('data-island-tab-close', t.id).attr('title', 'Close tab');
          closeBtn.el.textContent = '\u00d7';
          wrap.add(globeView, closeBtn);
          stripChildren.push(wrap);
        } else {
          stripChildren.push(globeView);
        }
      }
    }
    stripChildren.push(T(nonBlank.length + ' tab' + (nonBlank.length !== 1 ? 's' : '')).className('island-strip-overflow'));
    return new V('span').className('island-favicon-strip').add(stripChildren);
  } else if (a.type === 'insight') {
    if (a.offer) {
      return H([R(icon('comment', { size: 14, stroke: 'var(--nr-text-secondary)' })), T(a.label || 'Annotate').foreground('var(--nr-text-secondary)')]);
    }
    if (a.loading) {
      return H([new V('span').className('island-annotate-dot'), T(a.label || 'Analyzing\u2026')]);
    }
    const annColor = ANN_COLORS[a.modeType] || '#4caf50';
    const children = [R(icon('comment', { size: 14, stroke: annColor })), T(a.label || '').foreground('var(--aether-text)')];
    if (a._paper && a._paperState && a._paperState.s2Data) {
      const cc = a._paperState.s2Data.citationCount;
      if (cc != null && window.Badge) children.push(window.Badge(cc + ' cit.').tint('#8b5cf6').styles({ marginLeft: '6px' }));
      else if (cc != null) children.push(T(cc + ' cit.').cornerRadius('sm').padding('1px', '5px')
        .styles({ marginLeft: '6px', fontSize: '10px', background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }));
    }
    return H(children);
  } else if (a.type === 'nerd') {
    return H([R(icon('research', { size: 14 })), T(a.label || 'Nerd Mode?')]).spacing(1).styles({ whiteSpace: 'nowrap' });
  } else if (a.type === 'pageinfo') {
    const infoIcon = R(icon('info', { size: 14, stroke: 'var(--nr-text-secondary)' })).className('island-pageinfo-icon');
    if (a.label) {
      return H([infoIcon, T(a.label).foreground('var(--nr-text-secondary)').className('island-pageinfo-label')]).spacing(1).styles({ whiteSpace: 'nowrap' });
    }
    // Icon hidden by default, shown on hover via CSS
    return infoIcon;
  } else if (a.type === 'calendar') {
    return H([R(icon('calendar', { size: 14, stroke: '#3b82f6' })), T(a.label || '').foreground('#3b82f6')]);
  } else if (a.type === 'bookmark') {
    return R(icon('bookmark', { size: 14, fill: 'var(--nr-accent)', stroke: 'var(--nr-accent)' }));
  } else if (a.type === 'pulse') {
    const pulseIntensity = (typeof Motion !== 'undefined') ? Math.min(Motion.pulse.rate / 5, 1) : 0;
    const pulseClass = pulseIntensity > 0.3 ? 'island-pulse-dot-active' : 'island-pulse-dot-idle';
    return new V('span').className('island-pulse-dot ' + pulseClass).cssVar('--pulse-intensity', pulseIntensity.toFixed(2));
  } else if (a.type === 'context') {
    return H([T('\u25CF').opacity(0.5), T(a.label || '').opacity(0.7)]);
  }
  return H([new V('span').className('island-dot'), T(a.label || '')]);
}

// ── Tray content builder ──

export function _islandBuildTray(a, isBrowse) {
  const V = window.View, T = window.Text, R = window.RawHTML, H = window.HStack, VS = window.VStack;

  function _divider() { return new V('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '4px 0' }); }
  function _borderDivider() { return new V('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '2px 0' }); }
  function _favImg(src) {
    const img = new V('img').frame({ width: 14, height: 14 }).cornerRadius('xs').styles({ flexShrink: '0' });
    img.el.src = src;
    img.on('error', function() { img.el.style.display = 'none'; });
    return img;
  }
  function _tabRow(item, showClose) {
    let title = item.title || 'New Tab';
    if (title.length > 36) title = title.slice(0, 34) + '\u2026';
    const children = [];
    if (item.favicon) children.push(_favImg(item.favicon));
    children.push(T(title).flex(1).truncate());
    if (showClose) {
      const cb = new V('button').className('island-tab-item-close').attr('data-island-tab-close', item.id).attr('title', 'Close');
      cb.el.textContent = '\u00d7';
      children.push(cb);
    }
    return H(children).className('island-ctx-item' + (item.active ? ' active' : '')).attr('data-island-tab', item.id);
  }

  if (a.type === 'context' && a.items && a.items.length) {
    var rows = [];
    if (isBrowse) {
      rows.push(H([R(icon('plus', { size: 12 })), T('New tab')]).className('island-tab-newtab').attr('data-island-tab-new', '1'));
      rows.push(_divider());
    }
    for (var ti = 0; ti < a.items.length; ti++) {
      rows.push(_tabRow(a.items[ti], isBrowse));
    }
    return VS(rows);
  } else if (a.type === 'download' && a.items && a.items.length) {
    var rows = [];
    rows.push(H([T('Downloads'), T('Clear all').className('island-dl-clear').attr('data-island-dl-clear', '1')]).className('island-dl-header'));
    for (var ti = 0; ti < a.items.length; ti++) {
      const item = a.items[ti];
      let fname = item.filename || 'Download';
      if (fname.length > 40) fname = fname.slice(0, 38) + '\u2026';
      const dlIconHtml = item.state === 'completed'
        ? icon('fileCheckmark', { size: 14, fill: '#22c55e', stroke: 'none' })
        : icon('filePlain', { size: 14 });
      const dlStatus = item.state === 'completed' ? 'Done' + (item.size ? ' \u00b7 ' + item.size : '')
        : item.state === 'cancelled' ? 'Cancelled'
        : item.pct + '% \u00b7 ' + item.received + (item.size ? ' / ' + item.size : '');
      const infoView = new V('div').className('island-dl-info').add(
        T(fname).className('island-dl-name'),
        T(dlStatus).className('island-dl-status')
      );
      if (item.state === 'progressing') {
        const bar = new V('div').className('island-dl-progress-bar').styles({ width: item.pct + '%' });
        infoView.add(new V('div').className('island-dl-progress').add(bar));
      }
      const removeBtn = new V('button').className('island-dl-remove').attr('data-island-dl-remove', item.id).attr('title', 'Remove');
      removeBtn.el.textContent = '\u00d7';
      rows.push(H([R(dlIconHtml).className('island-dl-icon'), infoView, removeBtn]).className('island-dl-item').attr('data-island-dl', item.id));
    }
    return VS(rows);
  } else if (a.type === 'pageinfo') {
    var rows = [];
    const meta = a.meta || {};
    const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
    const activeTab = win ? win.tabs.find(function(t) { return t.id === win.activeTab; }) : null;

    // Title
    const title = (activeTab && activeTab.title) ? activeTab.title : '';
    if (title) {
      rows.push(T(title).styles({ fontSize: '0.82rem', fontWeight: '600', color: 'var(--nr-text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }));
    }

    // URL / domain
    const url = (activeTab && activeTab.url) ? activeTab.url : '';
    if (url && url !== 'about:blank') {
      let domain = '';
      try { domain = new URL(url).hostname; } catch(e) {}
      if (domain) {
        rows.push(T(domain).styles({ fontSize: '0.7rem', color: 'var(--nr-text-tertiary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }));
      }
    }

    // Meta info pills (badges row)
    const badges = [];
    if (meta.author) badges.push(meta.author);
    if (a.label) badges.push(a.label);
    else if (meta.wordCount > 0) {
      const mins = Math.max(1, Math.round(meta.wordCount / 238));
      badges.push(mins + ' min read');
    }
    if (a.badges) badges.push(a.badges);

    if (badges.length) {
      const badgeViews = badges.map(function(p) {
        return T(p).styles({ fontSize: '0.65rem', color: 'var(--nr-text-tertiary)',
          background: 'var(--nr-bg-raised)', borderRadius: '6px', padding: '2px 6px',
          whiteSpace: 'nowrap' });
      });
      rows.push(H(badgeViews).styles({ gap: '4px', flexWrap: 'wrap', marginTop: '4px' }));
    }

    // Detailed info rows
    const _infoStyle = { fontSize: '0.68rem', color: 'var(--nr-text-tertiary)' };
    const _labelStyle = { fontSize: '0.68rem', color: 'var(--nr-text-quaternary)', minWidth: '70px', flexShrink: '0' };
    function _infoRow(label, value) {
      return H([T(label).styles(_labelStyle), T(value).styles(_infoStyle)]).styles({ gap: '8px', marginTop: '2px', whiteSpace: 'nowrap' });
    }
    if (meta.ip) rows.push(_infoRow('Server IP', meta.ip));
    if (meta.location) rows.push(_infoRow('Location', meta.location));
    if (meta.org) rows.push(_infoRow('Server', meta.org));
    if (meta.wordCount > 0) {
      const readMins = Math.max(1, Math.round(meta.wordCount / 238));
      rows.push(_infoRow('Reading time', readMins + ' min (' + meta.wordCount.toLocaleString() + ' words)'));
    }

    // Description
    if (meta.description) {
      const desc = meta.description.length > 120 ? meta.description.slice(0, 118) + '\u2026' : meta.description;
      rows.push(T(desc).styles({ fontSize: '0.68rem', color: 'var(--nr-text-quaternary)',
        lineHeight: '1.35', marginTop: '4px', display: '-webkit-box',
        WebkitLineClamp: '3', WebkitBoxOrient: 'vertical', overflow: 'hidden' }));
    }

    // ── Per-site ad block toggle ──
    rows.push(new V('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '6px 0 4px' }));
    var _siteDomain = _getCurrentBrowseDomain();
    if (_siteDomain) {
      var _siteExceptions = Settings.getJSON('adblockSiteExceptions', {});
      var _siteAdsBlocked = !_siteExceptions[_siteDomain];
      var _siteToggle = H([
        R(icon('shield', { size: 15, strokeWidth: '1.5' })).styles({ color: _siteAdsBlocked ? 'var(--nr-accent)' : 'var(--nr-text-tertiary)', flexShrink: '0' }),
        T(_siteDomain).font('caption2').foreground(_siteAdsBlocked ? 'primary' : 'tertiary').flex(1).truncate(),
        T(_siteAdsBlocked ? 'Shielded' : 'Unshielded').font('caption2').foreground(_siteAdsBlocked ? 'accent' : 'quaternary')
      ]).spacing(2).styles({
        padding: '5px 6px', cursor: 'pointer', borderRadius: '6px', transition: 'background 0.12s',
        background: _siteAdsBlocked ? 'color-mix(in srgb, var(--nr-accent) 8%, transparent)' : 'transparent'
      }).onTap(function() {
        var excs = Settings.getJSON('adblockSiteExceptions', {});
        if (_siteAdsBlocked) excs[_siteDomain] = true;
        else delete excs[_siteDomain];
        Settings.setJSON('adblockSiteExceptions', excs);
        if (window.electronAPI && window.electronAPI.adblockSetSiteException) {
          window.electronAPI.adblockSetSiteException(_siteDomain, !_siteAdsBlocked);
        }
        // Reload the active tab
        var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
        var tab = win ? win.tabs.find(function(t) { return t.id === win.activeTab; }) : null;
        if (tab && tab.el && tab.el.reload) tab.el.reload();
        _refreshPageInfoDropdown();
      });
      rows.push(_siteToggle);
    }

    // ── Privacy toggles ──
    rows.push(new V('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '6px 0 4px' }));
    const _privActive = _privFeatures.filter(function(f) { return f.checkOn(Settings.get(f.key)); }).length;
    rows.push(H([
      T('PRIVACY').font('caption2').foreground('quaternary').styles({ letterSpacing: '0.05em' }),
      T(_privActive + '/' + _privFeatures.length + ' active').font('caption2').foreground('quaternary').styles({ marginLeft: 'auto' })
    ]).styles({ padding: '0 2px' }));

    for (var pi = 0; pi < _privFeatures.length; pi++) {
      (function(pf) {
        var on = pf.checkOn(Settings.get(pf.key));
        var toggleRow = H([
          R(icon(pf.ic, { size: 14, strokeWidth: '1.5' })).styles({ color: on ? 'var(--nr-accent)' : 'var(--nr-text-tertiary)', flexShrink: '0' }),
          T(pf.label).font('caption2').foreground(on ? 'primary' : 'tertiary').flex(1),
          T(on ? 'On' : 'Off').font('caption2').foreground('quaternary')
        ]).className('island-priv-toggle').spacing(2).styles({
          padding: '4px 2px', cursor: 'pointer', borderRadius: '4px', transition: 'background 0.12s'
        }).onTap(function() { pf.fn(); _refreshPageInfoDropdown(); });
        rows.push(toggleRow);
      })(_privFeatures[pi]);
    }

    // Stats container (populated async)
    rows.push(new V('div').id('pageinfo-priv-stats').styles({
      padding: '4px 2px', minHeight: '18px'
    }));

    if (rows.length === 0) return null;
    return VS(rows).styles({ gap: '2px', padding: '8px 10px', minWidth: '200px' });
  } else if (a.type === 'insight' && a.items && a.items.length) {
    const annColors = Object.assign({}, ANN_COLORS);
    const annLabels = Object.fromEntries(Object.entries(ANN_COLOR_MAP).map(([k, v]) => [k, v.label]));
    if (typeof window._customAnnotationCategories !== 'undefined') {
      for (const cc of window._customAnnotationCategories) { annColors[cc.key] = cc.color; annLabels[cc.key] = cc.name; }
    }
    var rows = [];
    for (var ti = 0; ti < a.items.length; ti++) {
      const ann = a.items[ti];
      const color = annColors[ann.modeType] || '#4caf50';
      const label = annLabels[ann.modeType] || ann.modeType || '';
      let text = ann.text || '';
      if (text.length > 80) text = text.slice(0, 77) + '\u2026';
      const annRow = H([
        new V('span').frame({ width: 6, height: 6 }).cornerRadius('full').styles({ background: color, flexShrink: '0' }),
        T(text).flex(1).truncate()
      ]).className('island-ctx-item').spacing(2);
      if (ann.nodeId) annRow.attr('data-ann-node', ann.nodeId);
      rows.push(annRow);
    }
    return VS(rows);
  }
  return null;
}

// ── Main island render (DOM patching) ──

export function _islandRender() {
  const container = document.getElementById('pill-island');
  if (!container) return;

  const satLeft = document.getElementById('pill-satellite-left');
  const satRight = document.getElementById('pill-satellite-right');

  const activities = window._islandActivities ? window._islandActivities.value : {};
  const isBrowse = false;
  const keys = Object.keys(activities);

  // Filter out ai/insight types — they render in the AI pill
  const filtered = [];
  for (var i = 0; i < keys.length; i++) {
    const a = activities[keys[i]];
    if (!a) continue;
    if (a.type === 'ai' || a.type === 'insight') continue;
    filtered.push({ id: keys[i], data: a });
  }

  // Sort by priority then timestamp
  const priority = { achievement: 5, download: 4, 'voice-result': 4, mic: 3.8, calendar: 3.5, cc: 3, tts: 3, rss: 2.6, bookmark: 2.55, 'feed-notif': 2, audio: 2, qf: 2, pageinfo: 1.5, feed: 1, context: 0, tabs: 10, nowplaying: 9 };
  filtered.sort(function(a, b) {
    const pa = priority[a.data.type] || 0;
    const pb = priority[b.data.type] || 0;
    return pb - pa || (b.data._ts || 0) - (a.data._ts || 0);
  });

  // Determine if we're in island mode (satellites only apply there)
  const nav = document.getElementById('sidebar-nav');
  const isIslandMode = nav && nav.classList.contains('island-mode');

  // Partition pills: only tabs go inline, everything else becomes satellites
  const leftTypes = { rss: 1, bookmark: 1, 'feed-notif': 1, context: 1, achievement: 1 };
  const rightTypes = { pageinfo: 1 };
  const inlinePills = [], leftPills = [], rightPills = [];
  for (var i = 0; i < filtered.length; i++) {
    const f = filtered[i];
    if (f.data.type === 'tabs') {
      inlinePills.push(f);
    } else if (isIslandMode && satLeft && satRight) {
      if (leftTypes[f.data.type]) leftPills.push(f);
      else if (rightTypes[f.data.type]) rightPills.push(f);
      else rightPills.push(f);
    }
    // Non-tabs pills are dropped when not in island mode (no satellites available)
  }

  // Collect all containers for stale-pill cleanup
  const allContainers = [container];
  if (satLeft) allContainers.push(satLeft);
  if (satRight) allContainers.push(satRight);

  // Reconcile existing DOM pills across all containers
  const existingById = {};
  for (let ci = 0; ci < allContainers.length; ci++) {
    const pills = allContainers[ci].querySelectorAll('.pill-island');
    for (let pi = 0; pi < pills.length; pi++) {
      existingById[pills[pi].dataset.islandId] = pills[pi];
    }
  }
  // Also check tabs anchor
  const tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  if (tabsAnchor) {
    const tabsPills = tabsAnchor.querySelectorAll('.pill-island');
    for (var i = 0; i < tabsPills.length; i++) {
      existingById[tabsPills[i].dataset.islandId] = tabsPills[i];
    }
  }

  const activeIds = {};

  // Render helper: place pill in target container, create if needed
  function _renderPillInto(f, target) {
    activeIds[f.id] = true;
    let pillEl = existingById[f.id];
    if (pillEl && pillEl.parentNode !== target) {
      // Pill exists but in wrong container — move it
      target.appendChild(pillEl);
    }
    if (!pillEl) {
      const pillView = new window.View('div').className('pill-island' + (f.data.cssClass ? ' ' + f.data.cssClass : ''))
        .attr('data-island-id', f.id);
      AetherUI.append(pillView, target);
      pillEl = pillView.el;
    }
    const existingTray = pillEl.querySelector('.island-ctx-tray');
    const hadTrayOpen = pillEl.classList.contains('island-tray-open');
    if (existingTray) existingTray.remove();
    const contentView = _islandRenderPill(f.data);
    if (contentView) {
      contentView.font('caption2');
      AetherUI.mount(contentView, pillEl);
    }
    if (existingTray && hadTrayOpen) {
      pillEl.appendChild(existingTray);
      pillEl.classList.add('island-tray-open');
    }
    pillEl.classList.toggle('island-active', true);
    pillEl.classList.toggle('island-has-items', !!(f.data.items && f.data.items.length));
  }

  for (var i = 0; i < inlinePills.length; i++) _renderPillInto(inlinePills[i], container);
  for (var i = 0; i < leftPills.length; i++) _renderPillInto(leftPills[i], satLeft);
  for (var i = 0; i < rightPills.length; i++) _renderPillInto(rightPills[i], satRight);

  // Remove stale pills from all containers
  for (const id in existingById) {
    if (!activeIds[id] && id !== 'tabs') {
      const stale = existingById[id];
      if (!stale.classList.contains('island-exiting')) {
        stale.remove();
      }
    }
  }

  container.classList.toggle('island-has-items', inlinePills.length > 0);

  // Update unified AI pill
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();

  // CC subtitle beneath collapsed island
  _renderCCSubtitle();
}

// ── CC subtitle beneath collapsed island ──

function _renderCCSubtitle() {
  const wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  const isExpanded = !!window._urlPopupEl;
  const ccAct = window._islandActivities ? window._islandActivities.value.cc : null;
  const micAct = window._islandActivities ? window._islandActivities.value.mic : null;
  let subEl = document.getElementById('island-cc-subtitle');

  // Pick whichever is active (mic takes priority if both)
  const activeAct = (micAct && micAct.lines && micAct.lines.length > 0) ? micAct : ccAct;

  // Show only when collapsed + active with lines
  if (isExpanded || !activeAct || !activeAct.lines || activeAct.lines.length === 0) {
    if (subEl) subEl.remove();
    wrap.classList.remove('island-cc-collapsed');
    return;
  }

  const lines = activeAct.lines;
  const visible = lines.slice(Math.max(0, lines.length - 2));

  if (!subEl) {
    subEl = document.createElement('div');
    subEl.id = 'island-cc-subtitle';
    subEl.className = 'island-cc-subtitle';
    wrap.appendChild(subEl);
  }
  wrap.classList.add('island-cc-collapsed');

  let html = '';
  for (let i = 0; i < visible.length; i++) {
    const op = i === visible.length - 1 ? '1' : '0.5';
    html += '<div class="island-cc-subtitle-line" style="opacity:' + op + '">' + _escapeHtml(visible[i]) + '</div>';
  }
  subEl.innerHTML = html;
}

function _escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Click handler for island pills ──

export function _islandAttachHandlers() {
  const container = document.getElementById('pill-island');
  if (!container || container._islandHandlersBound) return;
  container._islandHandlersBound = true;

  // Also bind satellite containers
  const satContainers = [document.getElementById('pill-satellite-left'), document.getElementById('pill-satellite-right')];
  for (let si = 0; si < satContainers.length; si++) {
    if (satContainers[si] && !satContainers[si]._islandHandlersBound) {
      satContainers[si]._islandHandlersBound = true;
      satContainers[si].addEventListener('click', _islandPillClickHandler);
    }
  }

  container.addEventListener('click', _islandPillClickHandler);
}

function _islandPillClickHandler(e) {
    // Tab click — if popup not open, open it in tabs mode instead of switching
    const tabEl = e.target.closest('[data-island-tab]');
    if (tabEl) {
      if (!window._urlPopupEl) {
        if (typeof window._expandIsland === 'function') window._expandIsland('tabs');
        return;
      }
      const tabId = parseInt(tabEl.dataset.islandTab, 10);
      if (e.target.closest('[data-island-tab-close]')) {
        browseCloseTab(tabId);
        return;
      }
      browseSelectTab(tabId);
      return;
    }
    // New tab
    if (e.target.closest('[data-island-tab-new]')) {
      if (typeof window.browseNewTab === 'function') window.browseNewTab();
      return;
    }
    // Download clear
    if (e.target.closest('[data-island-dl-clear]')) {
      if (typeof window.clearBrowseDownloads === 'function') window.clearBrowseDownloads();
      return;
    }
    // Download remove
    const dlRemove = e.target.closest('[data-island-dl-remove]');
    if (dlRemove) {
      if (typeof window.removeBrowseDownload === 'function') window.removeBrowseDownload(dlRemove.dataset.islandDlRemove);
      return;
    }
    // Download open
    const dlItem = e.target.closest('[data-island-dl]');
    if (dlItem) {
      if (typeof window.openDownloadFile === 'function') window.openDownloadFile(dlItem.dataset.islandDl);
      return;
    }
    // Dismiss
    const dismissEl = e.target.closest('[data-island-dismiss]');
    if (dismissEl) {
      islandRemove(dismissEl.dataset.islandDismiss);
      return;
    }
    // Annotation node
    const annNode = e.target.closest('[data-ann-node]');
    if (annNode) {
      if (typeof window.scrollToAnnotation === 'function') window.scrollToAnnotation(annNode.dataset.annNode);
      return;
    }
    // Generic pill click — toggle tray or fire action
    const pill = e.target.closest('.pill-island');
    if (pill) {
      const id = pill.dataset.islandId;
      // Tabs pill click → open popup in tabs mode
      if (id === 'tabs' && !window._urlPopupEl) {
        e.stopPropagation();
        if (typeof window._expandIsland === 'function') window._expandIsland('tabs');
        return;
      }
      const act = window._islandActivities ? window._islandActivities.value[id] : null;
      if (act && act.action) {
        e.stopPropagation();
        act.action();
      } else if (act && act.type === 'pageinfo') {
        e.stopPropagation();
        _togglePageInfoDropdown(pill, act);
      } else if (act && (act.items || act.type === 'download' || act.type === 'insight')) {
        e.stopPropagation();
        _togglePillTray(pill, act);
      }
    }
}

// ── Tray toggle ──

function _togglePillTray(pillEl, act) {
  const isOpen = pillEl.classList.contains('island-tray-open');
  // Close all other trays
  const allPills = document.querySelectorAll('.pill-island.island-tray-open');
  for (let i = 0; i < allPills.length; i++) {
    allPills[i].classList.remove('island-tray-open');
    allPills[i]._trayUserClosed = true;
    const tray = allPills[i].querySelector('.island-ctx-tray');
    if (tray) tray.remove();
  }
  if (isOpen) return;

  const isBrowse = false;
  const trayContent = _islandBuildTray(act, isBrowse);
  if (!trayContent) return;

  const trayView = new window.View('div').className('island-ctx-tray');
  AetherUI.mount(trayContent, trayView.el);
  AetherUI.append(trayView, pillEl);
  pillEl.classList.add('island-tray-open');
  pillEl._trayUserClosed = false;

  // Position tray below pill
  const pillRect = pillEl.getBoundingClientRect();
  trayView.el.style.top = pillRect.height + 'px';

  // Close on outside click
  setTimeout(function() {
    const handler = function(e) {
      if (!pillEl.contains(e.target)) {
        pillEl.classList.remove('island-tray-open');
        pillEl._trayUserClosed = true;
        trayView.el.remove();
        document.removeEventListener('mousedown', handler, true);
      }
    };
    document.addEventListener('mousedown', handler, true);
  }, 0);
}

// ── Page info dropdown (fixed-position, avoids overflow clipping) ──

let _pageInfoDropdownEl = null;
let _pageInfoOutsideHandler = null;

function _togglePageInfoDropdown(pillEl, act) {
  if (_pageInfoDropdownEl) {
    _closePageInfoDropdown();
    return;
  }
  const V = window.View, T = window.Text, H = window.HStack, VS = window.VStack;
  const trayContent = _islandBuildTray(act, false);
  if (!trayContent) return;

  const pillRect = pillEl.getBoundingClientRect();
  const panel = new V('div').className('island-pageinfo-dropdown')
    .position('fixed')
    .background('overlay')
    .cornerRadius('lg')
    .shadow('popup')
    .border('border-default')
    .colorScheme('dark')
    .frame({ maxHeight: 480, minWidth: 240, maxWidth: 360 })
    .overflow('auto')
    .zIndex('modal')
    .padding('8px', '0')
    .styles({
      right: Math.round(window.innerWidth - pillRect.right) + 'px',
      top: Math.round(pillRect.bottom + 6) + 'px'
    });
  AetherUI.mount(trayContent, panel.el);
  document.body.appendChild(panel.el);
  _pageInfoDropdownEl = panel.el;
  _pageInfoDropdownPill = pillEl;
  _pageInfoDropdownAct = act;

  _fetchPrivacyStatsForDropdown();

  setTimeout(function() {
    _pageInfoOutsideHandler = function(e) {
      if (_pageInfoDropdownEl && _pageInfoDropdownEl.contains(e.target)) return;
      if (pillEl.contains(e.target)) return;
      _closePageInfoDropdown();
    };
    document.addEventListener('mousedown', _pageInfoOutsideHandler, true);
    window.addEventListener('blur', _closePageInfoDropdown);
  }, 0);
}

var _pageInfoDropdownPill = null;
var _pageInfoDropdownAct = null;

function _closePageInfoDropdown() {
  if (_pageInfoDropdownEl) {
    _pageInfoDropdownEl.remove();
    _pageInfoDropdownEl = null;
  }
  _pageInfoDropdownPill = null;
  _pageInfoDropdownAct = null;
  if (_pageInfoOutsideHandler) {
    document.removeEventListener('mousedown', _pageInfoOutsideHandler, true);
    _pageInfoOutsideHandler = null;
  }
  window.removeEventListener('blur', _closePageInfoDropdown);
}

// ── Refresh page info dropdown (after toggle) ──

function _refreshPageInfoDropdown() {
  if (!_pageInfoDropdownEl || !_pageInfoDropdownPill || !_pageInfoDropdownAct) return;
  var act = _pageInfoDropdownAct;
  var trayContent = _islandBuildTray(act, false);
  if (trayContent) AetherUI.mount(trayContent, _pageInfoDropdownEl);
  _fetchPrivacyStatsForDropdown();
}

// ── Fetch privacy stats into dropdown ──

function _fetchPrivacyStatsForDropdown() {
  var dropdownRef = _pageInfoDropdownEl;
  if (!dropdownRef) return;
  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  var activeTab = win ? win.tabs.find(function(t) { return t.id === win.activeTab; }) : null;
  if (!activeTab || !activeTab.el || typeof activeTab.el.getWebContentsId !== 'function') return;
  if (!window.electronAPI) return;

  var statsEl = dropdownRef.querySelector('#pageinfo-priv-stats');
  if (!statsEl) return;

  try {
    var wc = activeTab.el.getWebContentsId();
    var detailsP = window.electronAPI.privacyDetails ? window.electronAPI.privacyDetails(wc) : Promise.resolve({});
    Promise.all([
      window.electronAPI.adblockGetCount(wc),
      window.electronAPI.trackingStripGetCount ? window.electronAPI.trackingStripGetCount(wc) : Promise.resolve(0),
      window.electronAPI.httpsOnlyGetCount ? window.electronAPI.httpsOnlyGetCount(wc) : Promise.resolve(0),
      window.electronAPI.cookieBlockGetCount ? window.electronAPI.cookieBlockGetCount(wc) : Promise.resolve(0),
      detailsP,
    ]).then(function(c) {
      // Guard: dropdown may have closed
      if (!_pageInfoDropdownEl) return;
      var target = _pageInfoDropdownEl.querySelector('#pageinfo-priv-stats');
      if (!target) return;

      var details = c[4] || {};
      var rows = [];
      var parts = [];
      if (c[0] > 0) parts.push(c[0] + ' ad' + (c[0] !== 1 ? 's' : '') + ' blocked');
      if (c[1] > 0) parts.push(c[1] + ' tracker' + (c[1] !== 1 ? 's' : '') + ' stripped');
      if (c[2] > 0) parts.push(c[2] + ' HTTPS upgrade' + (c[2] !== 1 ? 's' : ''));
      if (c[3] > 0) parts.push(c[3] + ' cookie' + (c[3] !== 1 ? 's' : '') + ' blocked');
      var summaryText = parts.length > 0 ? parts.join(' \u00b7 ') : 'No threats detected';
      rows.push(window.Text(summaryText).font('caption2').styles({ color: 'var(--nr-accent)', fontWeight: '500', lineHeight: '1.4' }));

      function _domainRows(map, label) {
        var entries = Object.entries(map || {}).sort(function(a, b) { return b[1] - a[1]; });
        if (!entries.length) return;
        rows.push(window.Text(label).font('caption2').foreground('quaternary').styles({ marginTop: '4px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }));
        var shown = entries.slice(0, 5);
        for (var i = 0; i < shown.length; i++) {
          rows.push(window.HStack([
            window.Text(shown[i][0]).font('caption2').foreground('secondary').flex(1).truncate(),
            window.Text(String(shown[i][1])).font('caption2').foreground('quaternary')
          ]).spacing(2));
        }
        if (entries.length > 5) {
          rows.push(window.Text('+ ' + (entries.length - 5) + ' more').font('caption2').foreground('quaternary'));
        }
      }

      _domainRows(details.ads, 'Blocked domains');
      _domainRows(details.trackers, 'Stripped params');
      _domainRows(details.cookies, 'Cookies blocked from');

      AetherUI.mount(window.VStack(rows).spacing(1), target);
    }).catch(function() {});
  } catch(e) {}
}

// ── Live tray update for CC/mic ──

export function _updateLiveTray(id) {
  const pill = document.querySelector('.pill-island[data-island-id="' + id + '"]');
  if (!pill) return;
  const act = window._islandActivities ? window._islandActivities.value[id] : null;
  if (!act) return;
  // Auto-open tray when _autoTray flag set and tray not yet open (and user hasn't manually closed it)
  if (act._autoTray && !pill.classList.contains('island-tray-open') && !pill._trayUserClosed) {
    _togglePillTray(pill, act);
    return;
  }
  // If tray is open, re-render content
  if (pill.classList.contains('island-tray-open')) {
    const trayEl = pill.querySelector('.island-ctx-tray');
    if (trayEl) {
      const trayContent = _islandBuildTray(act, false);
      if (trayContent) AetherUI.mount(trayContent, trayEl);
    }
  }
}

// ── Voice result dropdown ──
let _voiceDropdownEl = null;
let _voiceDropdownOutside = null;

function _closeVoiceDropdown() {
  if (_voiceDropdownEl) { _voiceDropdownEl.remove(); _voiceDropdownEl = null; }
  if (_voiceDropdownOutside) { document.removeEventListener('mousedown', _voiceDropdownOutside, true); _voiceDropdownOutside = null; }
  window.removeEventListener('blur', _closeVoiceDropdown);
}

function _toggleVoiceResultDropdown(pillEl, vText) {
  if (_voiceDropdownEl) { _closeVoiceDropdown(); return; }
  const V = window.View, T = window.Text, H = window.HStack, VS = window.VStack, R = window.RawHTML;
  const vLabel = vText.length > 120 ? vText.slice(0, 118) + '\u2026' : vText;

  const pillRect = pillEl.getBoundingClientRect();
  const panel = new V('div').className('island-voice-dropdown')
    .position('fixed')
    .background('overlay')
    .cornerRadius('lg')
    .shadow('popup')
    .border('border-default')
    .colorScheme('dark')
    .frame({ minWidth: 200, maxWidth: 300 })
    .zIndex('modal')
    .padding('6px', '0')
    .styles({
      right: Math.round(window.innerWidth - pillRect.right) + 'px',
      top: Math.round(pillRect.bottom + 6) + 'px'
    });

  // Transcript text
  const transcript = T('\u201c' + vLabel + '\u201d').className('island-voice-transcript');

  // Action rows
  function _row(iconName, label, handler) {
    return H([R(icon(iconName, { size: 14 })).opacity(0.5), T(label)])
      .className('island-voice-action')
      .onTap(function(e) { e.stopPropagation(); _closeVoiceDropdown(); handler(); });
  }

  const copyRow = _row('copy', 'Copy', function() {
    if (window.electronAPI && window.electronAPI.clipboardWriteText) window.electronAPI.clipboardWriteText(vText);
    islandRemove('voice-result');
  });
  const chatRow = _row('sparkles', 'Send to Chat', function() {
    if (typeof window._voiceResultToChat === 'function') window._voiceResultToChat(vText);
    islandRemove('voice-result');
  });
  const dismissRow = _row('close', 'Dismiss', function() {
    islandRemove('voice-result');
  });

  const sep1 = new V('div').className('island-voice-sep');
  const sep2 = new V('div').className('island-voice-sep');

  panel.add(transcript, sep1, copyRow, chatRow, sep2, dismissRow);
  document.body.appendChild(panel.el);
  _voiceDropdownEl = panel.el;

  setTimeout(function() {
    _voiceDropdownOutside = function(e) {
      if (_voiceDropdownEl && _voiceDropdownEl.contains(e.target)) return;
      if (pillEl.contains(e.target)) return;
      _closeVoiceDropdown();
    };
    document.addEventListener('mousedown', _voiceDropdownOutside, true);
    window.addEventListener('blur', _closeVoiceDropdown);
  }, 0);
}

// ── Webview pointer guard ──

let _islandGuardObserver = null;
export function _islandInitGuard() {
  if (_islandGuardObserver) return;
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  _islandGuardObserver = new MutationObserver(function() {
    const anyOpen = !!nav.querySelector('.island-tray-open, .dropdown-open');
    document.body.classList.toggle('island-dropdown-guard', anyOpen);
  });
  _islandGuardObserver.observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });
}

// ── Resize handler for island pill max width ──

window.addEventListener('resize', function() {
  const cont = document.getElementById('pill-island');
  const wrap = document.getElementById('pill-url-wrap');
  const nav = document.getElementById('sidebar-nav');
  if (!cont || !wrap || !nav || !nav.classList.contains('island-mode')) {
    if (cont) cont.style.removeProperty('--island-pills-max-w');
    return;
  }
  const ur = wrap.getBoundingClientRect();
  const cr = cont.getBoundingClientRect();
  const avail = ur.left - cr.left - 12;
  if (avail > 0) cont.style.setProperty('--island-pills-max-w', Math.floor(avail) + 'px');
});
