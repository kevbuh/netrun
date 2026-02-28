// toolbar-activities.js — Activity pills (island capsule items)
// Replaces island rendering from core-ui.js + core-audio.js
import Settings from '/js/core/core-settings.js';
import { icon } from '/js/core/icons.js';
import { visibleActivities, notifyTabsChanged } from '/js/toolbar/toolbar-state.js';
import { browseSelectTab, browseCloseTab } from '/js/browse/browse-passwords.js';

// ── Pulse state provider for unified AI pill ──
var _pulseFlashTimer = null;
var _pulseLastEventTs = 0;
var _pulseIsFlashing = false;

export function _getPulseState() {
  var recent = (typeof Motion !== 'undefined' && Motion.pulse) ? Motion.pulse.recent : [];
  var lastEvent = recent.length ? recent[recent.length - 1] : null;
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
  var acts = window._islandActivities.value;
  for (var id in acts) {
    var a = acts[id];
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
  var sel = '.pill-island[data-island-id="' + id + '"]';
  var el = document.querySelector(sel);
  if (!el) {
    var anchor = document.getElementById('pill-island-tabs-anchor');
    if (anchor) el = anchor.querySelector(sel);
  }
  if (!el) {
    var sl = document.getElementById('pill-satellite-left');
    if (sl) el = sl.querySelector(sel);
  }
  if (!el) {
    var sr = document.getElementById('pill-satellite-right');
    if (sr) el = sr.querySelector(sel);
  }
  if (window._islandDismissTimers && window._islandDismissTimers[id]) {
    clearTimeout(window._islandDismissTimers[id]);
    delete window._islandDismissTimers[id];
  }
  _clearIslandActivity(id);
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
  if (el && !el.classList.contains('island-exiting')) {
    var parentCont = el.parentNode;
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
  var pills = container.querySelectorAll('.pill-island');
  for (var i = 0; i < pills.length; i++) {
    pills[i]._flipRect = pills[i].getBoundingClientRect();
  }
}

function _islandFlipNeighbors(container) {
  if (!container) return;
  var pills = container.querySelectorAll('.pill-island');
  for (var i = 0; i < pills.length; i++) {
    var pill = pills[i];
    if (!pill._flipRect) continue;
    var newRect = pill.getBoundingClientRect();
    var dx = pill._flipRect.left - newRect.left;
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
  var V = window.View, T = window.Text, R = window.RawHTML, H = window.HStack;
  if (a.type === 'feed-notif') {
    return H([R(icon('bell', { size: 14, stroke: 'var(--nr-accent)' })), T(a.label || '').foreground('var(--nr-accent)')]);
  } else if (a.done) {
    return H([new V('span').className('island-dot-done'), T(a.label || 'Done').foreground('#22c55e')]);
  } else if (a.type === 'download') {
    var pct = a.progress || 0;
    var circ = 2 * Math.PI * 6;
    var offset = circ * (1 - pct / 100);
    var ringHtml = pct > 0 ? '<svg class="island-ring" viewBox="0 0 16 16"><circle class="island-ring-bg" cx="8" cy="8" r="6"/><circle class="island-ring-fg" cx="8" cy="8" r="6" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" transform="rotate(-90 8 8)"/></svg>' : icon('download', { size: 14 });
    var dismiss = new V('span').className('island-dismiss').attr('data-island-dismiss', 'download')
      .opacity(0.4).padding('0', '2px')
      .styles({ marginLeft: '4px', fontSize: '15px', lineHeight: '1', cursor: 'pointer' });
    dismiss.el.textContent = '\u00d7';
    return H([R(ringHtml), T(a.label || pct + '%'), dismiss]).styles({ whiteSpace: 'nowrap', cursor: 'pointer' });
  } else if (a.type === 'tts') {
    var ttsIconHtml = a.paused ? icon('play', { size: 14 }) : window._islandWaveformBars;
    var spd = parseFloat(Settings.get('ttsSpeed')) || 1;
    var spdBadge = T(spd.toFixed(1).replace(/\.0$/, '') + 'x').className('island-tts-speed').attr('title', 'Click to change speed')
      .onTap(function(e) { e.stopPropagation(); if (typeof window._ttsCycleSpeed === 'function') window._ttsCycleSpeed(); });
    var chunkText = a.chunkText || a.label || '';
    if (chunkText.length > 40) chunkText = chunkText.slice(0, 38) + '\u2026';
    var pauseBtn = R(icon(a.paused ? 'play' : 'pause', { size: 12 })).className('island-tts-ctrl')
      .attr('title', a.paused ? 'Resume' : 'Pause')
      .onTap(function(e) { e.stopPropagation(); if (typeof window._ttsPauseResume === 'function') window._ttsPauseResume(); });
    var stopBtn = R(icon('close', { size: 12 })).className('island-tts-ctrl island-tts-stop')
      .attr('title', 'Stop')
      .onTap(function(e) { e.stopPropagation(); if (typeof window._ttsStopAll === 'function') window._ttsStopAll(); });
    return H([R(ttsIconHtml), T(chunkText).className('island-tts-chunk').truncate(), pauseBtn, stopBtn, spdBadge]);
  } else if (a.type === 'cc') {
    var ccDot = new V('span').frame({ width: 6, height: 6 }).cornerRadius('full').styles({ background: 'var(--nr-accent)', boxShadow: '0 0 6px var(--nr-accent)', flexShrink: '0' });
    return H([ccDot, T(a.label || 'CC Live').foreground('var(--nr-accent)')]);
  } else if (a.type === 'mic') {
    return H([R(icon('microphone', { size: 14, stroke: '#ef4444' })).className('island-mic-icon'), T(a.label || 'Listening\u2026').foreground('#ef4444')]);
  } else if (a.type === 'voice-result') {
    var vText = a.text || '';
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
    var rssIconHtml = a.subscribed
      ? icon('check', { size: 14, stroke: '#22c55e' })
      : icon('rssFeed', { size: 14, stroke: '#f97316' });
    return H([R(rssIconHtml), T(a.label || '').className('pill-rss-label').foreground(a.subscribed ? '#22c55e' : 'var(--aether-text)')]);
  } else if (a.type === 'tabs') {
    var tabItems = a.items || [];
    var nonBlank = [];
    for (var si = 0; si < tabItems.length; si++) {
      if (!tabItems[si].blank) nonBlank.push(tabItems[si]);
    }
    nonBlank.sort(function(x, y) { return (y.lastVisited || 0) - (x.lastVisited || 0); });
    if (nonBlank.length === 0) {
      return H([R(icon('windows', { size: 14 })), T('0 tabs').opacity(0.4)]);
    }
    var visible = nonBlank.slice(0, 3);
    var stripChildren = [];
    for (var ti = 0; ti < visible.length; ti++) {
      var t = visible[ti];
      var cls = 'island-strip-fav' + (t.active ? ' island-strip-fav-active' : '');
      if (t.favicon) {
        var favImg = new V('img').className(cls).attr('title', t.title || 'Tab').attr('data-island-tab', t.id);
        favImg.el.src = t.favicon;
        var _cls = cls;
        favImg.on('error', function() {
          var globe = R(icon('globe', { size: 16, strokeWidth: '1.5', class: _cls }));
          globe.attr('data-island-tab', t.id);
          favImg.el.replaceWith(globe.el);
        });
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
        var globeView = R(icon('globe', { size: 16, strokeWidth: '1.5', class: cls })).attr('title', t.title || 'Tab').attr('data-island-tab', t.id);
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
    var _annModeColors = { INSIGHT: '#4caf50', CONTRADICTION: '#ef5350', EXAGGERATION: '#ffc107', AD: '#ff9800', FACTCHECK: '#ec407a', EVIDENCE: '#26a69a', CONNECTION: '#2196f3' };
    var annColor = _annModeColors[a.modeType] || '#4caf50';
    var children = [R(icon('comment', { size: 14, stroke: annColor })), T(a.label || '').foreground('var(--aether-text)')];
    if (a._paper && a._paperState && a._paperState.s2Data) {
      var cc = a._paperState.s2Data.citationCount;
      if (cc != null && window.Badge) children.push(window.Badge(cc + ' cit.').tint('#8b5cf6').styles({ marginLeft: '6px' }));
      else if (cc != null) children.push(T(cc + ' cit.').cornerRadius('sm').padding('1px', '5px')
        .styles({ marginLeft: '6px', fontSize: '10px', background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }));
    }
    return H(children);
  } else if (a.type === 'nerd') {
    return H([R(icon('research', { size: 14 })), T(a.label || 'Nerd Mode?')]).spacing(1).styles({ whiteSpace: 'nowrap' });
  } else if (a.type === 'pageinfo') {
    var infoIcon = R(icon('info', { size: 14, stroke: 'var(--nr-text-secondary)' })).className('island-pageinfo-icon');
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
    var pulseIntensity = (typeof Motion !== 'undefined') ? Math.min(Motion.pulse.rate / 5, 1) : 0;
    var pulseClass = pulseIntensity > 0.3 ? 'island-pulse-dot-active' : 'island-pulse-dot-idle';
    return new V('span').className('island-pulse-dot ' + pulseClass).cssVar('--pulse-intensity', pulseIntensity.toFixed(2));
  } else if (a.type === 'context') {
    return H([T('\u25CF').opacity(0.5), T(a.label || '').opacity(0.7)]);
  }
  return H([new V('span').className('island-dot'), T(a.label || '')]);
}

// ── Tray content builder ──

export function _islandBuildTray(a, isBrowse) {
  var V = window.View, T = window.Text, R = window.RawHTML, H = window.HStack, VS = window.VStack;

  function _divider() { return new V('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '4px 0' }); }
  function _borderDivider() { return new V('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '2px 0' }); }
  function _favImg(src) {
    var img = new V('img').frame({ width: 14, height: 14 }).cornerRadius('xs').styles({ flexShrink: '0' });
    img.el.src = src;
    img.on('error', function() { img.el.style.display = 'none'; });
    return img;
  }
  function _tabRow(item, showClose) {
    var title = item.title || 'New Tab';
    if (title.length > 36) title = title.slice(0, 34) + '\u2026';
    var children = [];
    if (item.favicon) children.push(_favImg(item.favicon));
    children.push(T(title).flex(1).truncate());
    if (showClose) {
      var cb = new V('button').className('island-tab-item-close').attr('data-island-tab-close', item.id).attr('title', 'Close');
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
      var item = a.items[ti];
      var fname = item.filename || 'Download';
      if (fname.length > 40) fname = fname.slice(0, 38) + '\u2026';
      var dlIconHtml = item.state === 'completed'
        ? icon('fileCheckmark', { size: 14, fill: '#22c55e', stroke: 'none' })
        : icon('filePlain', { size: 14 });
      var dlStatus = item.state === 'completed' ? 'Done' + (item.size ? ' \u00b7 ' + item.size : '')
        : item.state === 'cancelled' ? 'Cancelled'
        : item.pct + '% \u00b7 ' + item.received + (item.size ? ' / ' + item.size : '');
      var infoView = new V('div').className('island-dl-info').add(
        T(fname).className('island-dl-name'),
        T(dlStatus).className('island-dl-status')
      );
      if (item.state === 'progressing') {
        var bar = new V('div').className('island-dl-progress-bar').styles({ width: item.pct + '%' });
        infoView.add(new V('div').className('island-dl-progress').add(bar));
      }
      var removeBtn = new V('button').className('island-dl-remove').attr('data-island-dl-remove', item.id).attr('title', 'Remove');
      removeBtn.el.textContent = '\u00d7';
      rows.push(H([R(dlIconHtml).className('island-dl-icon'), infoView, removeBtn]).className('island-dl-item').attr('data-island-dl', item.id));
    }
    return VS(rows);
  } else if (a.type === 'pageinfo') {
    var rows = [];
    var meta = a.meta || {};
    var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
    var activeTab = win ? win.tabs.find(function(t) { return t.id === win.activeTab; }) : null;

    // Title
    var title = (activeTab && activeTab.title) ? activeTab.title : '';
    if (title) {
      rows.push(T(title).styles({ fontSize: '0.82rem', fontWeight: '600', color: 'var(--nr-text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }));
    }

    // URL / domain
    var url = (activeTab && activeTab.url) ? activeTab.url : '';
    if (url && url !== 'about:blank') {
      var domain = '';
      try { domain = new URL(url).hostname; } catch(e) {}
      if (domain) {
        rows.push(T(domain).styles({ fontSize: '0.7rem', color: 'var(--nr-text-tertiary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }));
      }
    }

    // Meta info pills (badges row)
    var badges = [];
    if (meta.author) badges.push(meta.author);
    if (a.label) badges.push(a.label);
    else if (meta.wordCount > 0) {
      var mins = Math.max(1, Math.round(meta.wordCount / 238));
      badges.push(mins + ' min read');
    }
    if (a.badges) badges.push(a.badges);

    if (badges.length) {
      var badgeViews = badges.map(function(p) {
        return T(p).styles({ fontSize: '0.65rem', color: 'var(--nr-text-tertiary)',
          background: 'var(--nr-bg-raised)', borderRadius: '6px', padding: '2px 6px',
          whiteSpace: 'nowrap' });
      });
      rows.push(H(badgeViews).styles({ gap: '4px', flexWrap: 'wrap', marginTop: '4px' }));
    }

    // Detailed info rows
    var _infoStyle = { fontSize: '0.68rem', color: 'var(--nr-text-tertiary)' };
    var _labelStyle = { fontSize: '0.68rem', color: 'var(--nr-text-quaternary)', minWidth: '70px', flexShrink: '0' };
    function _infoRow(label, value) {
      return H([T(label).styles(_labelStyle), T(value).styles(_infoStyle)]).styles({ gap: '8px', marginTop: '2px', whiteSpace: 'nowrap' });
    }
    if (meta.ip) rows.push(_infoRow('Server IP', meta.ip));
    if (meta.location) rows.push(_infoRow('Location', meta.location));
    if (meta.org) rows.push(_infoRow('Server', meta.org));
    if (meta.wordCount > 0) {
      var readMins = Math.max(1, Math.round(meta.wordCount / 238));
      rows.push(_infoRow('Reading time', readMins + ' min (' + meta.wordCount.toLocaleString() + ' words)'));
    }

    // Description
    if (meta.description) {
      var desc = meta.description.length > 120 ? meta.description.slice(0, 118) + '\u2026' : meta.description;
      rows.push(T(desc).styles({ fontSize: '0.68rem', color: 'var(--nr-text-quaternary)',
        lineHeight: '1.35', marginTop: '4px', display: '-webkit-box',
        WebkitLineClamp: '3', WebkitBoxOrient: 'vertical', overflow: 'hidden' }));
    }

    if (rows.length === 0) return null;
    return VS(rows).styles({ gap: '2px', padding: '8px 10px', minWidth: '200px' });
  } else if (a.type === 'insight' && a.items && a.items.length) {
    var annColors = { INSIGHT: '#4caf50', CONTRADICTION: '#ef5350', AD: '#ff9800', FACTCHECK: '#ec407a', EVIDENCE: '#26a69a', CONNECTION: '#2196f3' };
    var annLabels = { INSIGHT: 'Insight', CONTRADICTION: 'Contradiction', AD: 'Ad', FACTCHECK: 'Fact Check', EVIDENCE: 'Evidence', CONNECTION: 'Connection' };
    if (typeof window._customAnnotationCategories !== 'undefined') {
      for (var ci = 0; ci < window._customAnnotationCategories.length; ci++) {
        var cc = window._customAnnotationCategories[ci];
        annColors[cc.key] = cc.color;
        annLabels[cc.key] = cc.name;
      }
    }
    var rows = [];
    for (var ti = 0; ti < a.items.length; ti++) {
      var ann = a.items[ti];
      var color = annColors[ann.modeType] || '#4caf50';
      var label = annLabels[ann.modeType] || ann.modeType || '';
      var text = ann.text || '';
      if (text.length > 80) text = text.slice(0, 77) + '\u2026';
      var annRow = H([
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
  var container = document.getElementById('pill-island');
  if (!container) return;

  var satLeft = document.getElementById('pill-satellite-left');
  var satRight = document.getElementById('pill-satellite-right');

  var activities = window._islandActivities ? window._islandActivities.value : {};
  var isBrowse = false;
  var keys = Object.keys(activities);

  // Filter out ai/insight types — they render in the AI pill
  var filtered = [];
  for (var i = 0; i < keys.length; i++) {
    var a = activities[keys[i]];
    if (!a) continue;
    if (a.type === 'ai' || a.type === 'insight') continue;
    filtered.push({ id: keys[i], data: a });
  }

  // Sort by priority then timestamp
  var priority = { achievement: 5, download: 4, 'voice-result': 4, mic: 3.8, calendar: 3.5, cc: 3, tts: 3, rss: 2.6, bookmark: 2.55, 'feed-notif': 2, audio: 2, qf: 2, pageinfo: 1.5, feed: 1, context: 0, tabs: 10, nowplaying: 9 };
  filtered.sort(function(a, b) {
    var pa = priority[a.data.type] || 0;
    var pb = priority[b.data.type] || 0;
    return pb - pa || (b.data._ts || 0) - (a.data._ts || 0);
  });

  // Determine if we're in island mode (satellites only apply there)
  var nav = document.getElementById('sidebar-nav');
  var isIslandMode = nav && nav.classList.contains('island-mode');

  // Partition pills: only tabs go inline, everything else becomes satellites
  var leftTypes = { rss: 1, bookmark: 1, 'feed-notif': 1, context: 1, achievement: 1 };
  var rightTypes = { pageinfo: 1 };
  var inlinePills = [], leftPills = [], rightPills = [];
  for (var i = 0; i < filtered.length; i++) {
    var f = filtered[i];
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
  var allContainers = [container];
  if (satLeft) allContainers.push(satLeft);
  if (satRight) allContainers.push(satRight);

  // Reconcile existing DOM pills across all containers
  var existingById = {};
  for (var ci = 0; ci < allContainers.length; ci++) {
    var pills = allContainers[ci].querySelectorAll('.pill-island');
    for (var pi = 0; pi < pills.length; pi++) {
      existingById[pills[pi].dataset.islandId] = pills[pi];
    }
  }
  // Also check tabs anchor
  var tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  if (tabsAnchor) {
    var tabsPills = tabsAnchor.querySelectorAll('.pill-island');
    for (var i = 0; i < tabsPills.length; i++) {
      existingById[tabsPills[i].dataset.islandId] = tabsPills[i];
    }
  }

  var activeIds = {};

  // Render helper: place pill in target container, create if needed
  function _renderPillInto(f, target) {
    activeIds[f.id] = true;
    var pillEl = existingById[f.id];
    if (pillEl && pillEl.parentNode !== target) {
      // Pill exists but in wrong container — move it
      target.appendChild(pillEl);
    }
    if (!pillEl) {
      var pillView = new window.View('div').className('pill-island' + (f.data.cssClass ? ' ' + f.data.cssClass : ''))
        .attr('data-island-id', f.id);
      AetherUI.append(pillView, target);
      pillEl = pillView.el;
    }
    var existingTray = pillEl.querySelector('.island-ctx-tray');
    var hadTrayOpen = pillEl.classList.contains('island-tray-open');
    if (existingTray) existingTray.remove();
    var contentView = _islandRenderPill(f.data);
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
  for (var id in existingById) {
    if (!activeIds[id] && id !== 'tabs') {
      var stale = existingById[id];
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
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  var isExpanded = wrap.classList.contains('island-expanded');
  var ccAct = window._islandActivities ? window._islandActivities.value.cc : null;
  var micAct = window._islandActivities ? window._islandActivities.value.mic : null;
  var subEl = document.getElementById('island-cc-subtitle');

  // Pick whichever is active (mic takes priority if both)
  var activeAct = (micAct && micAct.lines && micAct.lines.length > 0) ? micAct : ccAct;

  // Show only when collapsed + active with lines
  if (isExpanded || !activeAct || !activeAct.lines || activeAct.lines.length === 0) {
    if (subEl) subEl.remove();
    wrap.classList.remove('island-cc-collapsed');
    return;
  }

  var lines = activeAct.lines;
  var visible = lines.slice(Math.max(0, lines.length - 2));

  if (!subEl) {
    subEl = document.createElement('div');
    subEl.id = 'island-cc-subtitle';
    subEl.className = 'island-cc-subtitle';
    wrap.appendChild(subEl);
  }
  wrap.classList.add('island-cc-collapsed');

  var html = '';
  for (var i = 0; i < visible.length; i++) {
    var op = i === visible.length - 1 ? '1' : '0.5';
    html += '<div class="island-cc-subtitle-line" style="opacity:' + op + '">' + _escapeHtml(visible[i]) + '</div>';
  }
  subEl.innerHTML = html;
}

function _escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Click handler for island pills ──

export function _islandAttachHandlers() {
  var container = document.getElementById('pill-island');
  if (!container || container._islandHandlersBound) return;
  container._islandHandlersBound = true;

  // Also bind satellite containers
  var satContainers = [document.getElementById('pill-satellite-left'), document.getElementById('pill-satellite-right')];
  for (var si = 0; si < satContainers.length; si++) {
    if (satContainers[si] && !satContainers[si]._islandHandlersBound) {
      satContainers[si]._islandHandlersBound = true;
      satContainers[si].addEventListener('click', _islandPillClickHandler);
    }
  }

  container.addEventListener('click', _islandPillClickHandler);
}

function _islandPillClickHandler(e) {
    // Tab click
    var tabEl = e.target.closest('[data-island-tab]');
    if (tabEl) {
      var tabId = parseInt(tabEl.dataset.islandTab, 10);
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
    var dlRemove = e.target.closest('[data-island-dl-remove]');
    if (dlRemove) {
      if (typeof window.removeBrowseDownload === 'function') window.removeBrowseDownload(dlRemove.dataset.islandDlRemove);
      return;
    }
    // Download open
    var dlItem = e.target.closest('[data-island-dl]');
    if (dlItem) {
      if (typeof window.openDownloadFile === 'function') window.openDownloadFile(dlItem.dataset.islandDl);
      return;
    }
    // Dismiss
    var dismissEl = e.target.closest('[data-island-dismiss]');
    if (dismissEl) {
      islandRemove(dismissEl.dataset.islandDismiss);
      return;
    }
    // Annotation node
    var annNode = e.target.closest('[data-ann-node]');
    if (annNode) {
      if (typeof window.scrollToAnnotation === 'function') window.scrollToAnnotation(annNode.dataset.annNode);
      return;
    }
    // Generic pill click — toggle tray or fire action
    var pill = e.target.closest('.pill-island');
    if (pill) {
      var id = pill.dataset.islandId;
      var act = window._islandActivities ? window._islandActivities.value[id] : null;
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
  var isOpen = pillEl.classList.contains('island-tray-open');
  // Close all other trays
  var allPills = document.querySelectorAll('.pill-island.island-tray-open');
  for (var i = 0; i < allPills.length; i++) {
    allPills[i].classList.remove('island-tray-open');
    allPills[i]._trayUserClosed = true;
    var tray = allPills[i].querySelector('.island-ctx-tray');
    if (tray) tray.remove();
  }
  if (isOpen) return;

  var isBrowse = false;
  var trayContent = _islandBuildTray(act, isBrowse);
  if (!trayContent) return;

  var trayView = new window.View('div').className('island-ctx-tray');
  AetherUI.mount(trayContent, trayView.el);
  AetherUI.append(trayView, pillEl);
  pillEl.classList.add('island-tray-open');
  pillEl._trayUserClosed = false;

  // Position tray below pill
  var pillRect = pillEl.getBoundingClientRect();
  trayView.el.style.top = pillRect.height + 'px';

  // Close on outside click
  setTimeout(function() {
    var handler = function(e) {
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

var _pageInfoDropdownEl = null;
var _pageInfoOutsideHandler = null;

function _togglePageInfoDropdown(pillEl, act) {
  if (_pageInfoDropdownEl) {
    _closePageInfoDropdown();
    return;
  }
  var V = window.View, T = window.Text, H = window.HStack, VS = window.VStack;
  var trayContent = _islandBuildTray(act, false);
  if (!trayContent) return;

  var pillRect = pillEl.getBoundingClientRect();
  var panel = new V('div').className('island-pageinfo-dropdown')
    .position('fixed')
    .background('overlay')
    .cornerRadius('lg')
    .shadow('popup')
    .border('border-default')
    .colorScheme('dark')
    .frame({ maxHeight: 320, minWidth: 220, maxWidth: 340 })
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

function _closePageInfoDropdown() {
  if (_pageInfoDropdownEl) {
    _pageInfoDropdownEl.remove();
    _pageInfoDropdownEl = null;
  }
  if (_pageInfoOutsideHandler) {
    document.removeEventListener('mousedown', _pageInfoOutsideHandler, true);
    _pageInfoOutsideHandler = null;
  }
  window.removeEventListener('blur', _closePageInfoDropdown);
}

// ── Live tray update for CC/mic ──

export function _updateLiveTray(id) {
  var pill = document.querySelector('.pill-island[data-island-id="' + id + '"]');
  if (!pill) return;
  var act = window._islandActivities ? window._islandActivities.value[id] : null;
  if (!act) return;
  // Auto-open tray when _autoTray flag set and tray not yet open (and user hasn't manually closed it)
  if (act._autoTray && !pill.classList.contains('island-tray-open') && !pill._trayUserClosed) {
    _togglePillTray(pill, act);
    return;
  }
  // If tray is open, re-render content
  if (pill.classList.contains('island-tray-open')) {
    var trayEl = pill.querySelector('.island-ctx-tray');
    if (trayEl) {
      var trayContent = _islandBuildTray(act, false);
      if (trayContent) AetherUI.mount(trayContent, trayEl);
    }
  }
}

// ── Voice result dropdown ──
var _voiceDropdownEl = null;
var _voiceDropdownOutside = null;

function _closeVoiceDropdown() {
  if (_voiceDropdownEl) { _voiceDropdownEl.remove(); _voiceDropdownEl = null; }
  if (_voiceDropdownOutside) { document.removeEventListener('mousedown', _voiceDropdownOutside, true); _voiceDropdownOutside = null; }
  window.removeEventListener('blur', _closeVoiceDropdown);
}

function _toggleVoiceResultDropdown(pillEl, vText) {
  if (_voiceDropdownEl) { _closeVoiceDropdown(); return; }
  var V = window.View, T = window.Text, H = window.HStack, VS = window.VStack, R = window.RawHTML;
  var vLabel = vText.length > 120 ? vText.slice(0, 118) + '\u2026' : vText;

  var pillRect = pillEl.getBoundingClientRect();
  var panel = new V('div').className('island-voice-dropdown')
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
  var transcript = T('\u201c' + vLabel + '\u201d').className('island-voice-transcript');

  // Action rows
  function _row(iconName, label, handler) {
    return H([R(icon(iconName, { size: 14 })).opacity(0.5), T(label)])
      .className('island-voice-action')
      .onTap(function(e) { e.stopPropagation(); _closeVoiceDropdown(); handler(); });
  }

  var copyRow = _row('copy', 'Copy', function() {
    if (window.electronAPI && window.electronAPI.clipboardWriteText) window.electronAPI.clipboardWriteText(vText);
    islandRemove('voice-result');
  });
  var chatRow = _row('sparkles', 'Send to Chat', function() {
    if (typeof window._voiceResultToChat === 'function') window._voiceResultToChat(vText);
    islandRemove('voice-result');
  });
  var dismissRow = _row('close', 'Dismiss', function() {
    islandRemove('voice-result');
  });

  var sep1 = new V('div').className('island-voice-sep');
  var sep2 = new V('div').className('island-voice-sep');

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

var _islandGuardObserver = null;
export function _islandInitGuard() {
  if (_islandGuardObserver) return;
  var nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  _islandGuardObserver = new MutationObserver(function() {
    var anyOpen = !!nav.querySelector('.island-tray-open, .dropdown-open');
    document.body.classList.toggle('island-dropdown-guard', anyOpen);
  });
  _islandGuardObserver.observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });
}

// ── Resize handler for island pill max width ──

window.addEventListener('resize', function() {
  var cont = document.getElementById('pill-island');
  var wrap = document.getElementById('pill-url-wrap');
  var nav = document.getElementById('sidebar-nav');
  if (!cont || !wrap || !nav || !nav.classList.contains('island-mode')) {
    if (cont) cont.style.removeProperty('--island-pills-max-w');
    return;
  }
  var ur = wrap.getBoundingClientRect();
  var cr = cont.getBoundingClientRect();
  var avail = ur.left - cr.left - 12;
  if (avail > 0) cont.style.setProperty('--island-pills-max-w', Math.floor(avail) + 'px');
});
