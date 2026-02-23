// browse-doom-scroll.js — Doom scroll prevention, focus timer, blocked page, nudge overlay
// Extracted from browse-downloads.js
import Settings from '/js/core/core-settings.js';

// ── Doom Scroll Prevention ──
export const _DOOM_SCROLL_DEFAULTS = [
  { domain: 'twitter.com', mode: 'nudge', minutes: 5 },
  { domain: 'x.com', mode: 'nudge', minutes: 5 },
  { domain: 'reddit.com', mode: 'nudge', minutes: 5 },
  { domain: 'tiktok.com', mode: 'block', minutes: 0 },
  { domain: 'instagram.com', mode: 'nudge', minutes: 10 },
  { domain: 'facebook.com', mode: 'nudge', minutes: 10 },
];

export function _getDoomScrollSites() {
  try {
    const saved = Settings.get('doomScrollSites');
    if (saved) return JSON.parse(saved);
  } catch {}
  return _DOOM_SCROLL_DEFAULTS.slice();
}

export function _saveDoomScrollSites(list) {
  Settings.setJSON('doomScrollSites', list);
}

export function _doomScrollMatch(url) {
  if (Settings.get('doomScrollEnabled') === 'false') return null;
  let hostname;
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const sites = _getDoomScrollSites();
  for (const site of sites) {
    const d = site.domain.toLowerCase();
    if (hostname === d || hostname.endsWith('.' + d)) return site;
  }
  return null;
}

// ── Focus Timer (pill-bar timer for doom scroll sites) ──
// Per-domain start times survive tab switches and SPA navigations
export const _focusTimerStarts = {}; // { domain: timestamp }
export let _focusTimerInterval = null;
export let _focusTimerDomain = '';
export let _focusTimerWarnMinutes = 0;

// @signal — reactive focus timer state
const _focusTimerText = State('');
const _focusTimerActive = State(false);
const _focusTimerWarn = State(false);

// Bind reactive state to the pill-focus-timer element once DOM is ready
Effect(function() {
  const text = _focusTimerText.value;
  const active = _focusTimerActive.value;
  const warn = _focusTimerWarn.value;
  const el = document.getElementById('pill-focus-timer');
  if (!el) return;
  el.textContent = text;
  if (active) el.classList.add('active'); else el.classList.remove('active');
  if (warn) el.classList.add('warn'); else el.classList.remove('warn');
});

// Restore persisted start times from sessionStorage (survives reload)
try {
  const saved = JSON.parse(sessionStorage.getItem('focusTimerStarts') || '{}');
  Object.assign(_focusTimerStarts, saved);
} catch {}

export function _persistFocusTimerStarts() {
  try { sessionStorage.setItem('focusTimerStarts', JSON.stringify(_focusTimerStarts)); } catch {}
}

export function _formatFocusTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

export function _focusTimerElapsed() {
  const start = _focusTimerStarts[_focusTimerDomain];
  return start ? Date.now() - start : 0;
}

export function _startFocusTimer(domain, warnMinutes) {
  // Preserve existing start time for this domain (don't reset on SPA nav or tab switch)
  if (!_focusTimerStarts[domain]) {
    _focusTimerStarts[domain] = Date.now();
    _persistFocusTimerStarts();
  }
  _focusTimerDomain = domain;
  _focusTimerWarnMinutes = warnMinutes || 0;
  if (!_focusTimerInterval) {
    _focusTimerInterval = setInterval(_updateFocusTimerPill, 1000);
  }
  _updateFocusTimerPill();
}

export function _hideFocusTimerPill() {
  if (_focusTimerInterval) { clearInterval(_focusTimerInterval); _focusTimerInterval = null; }
  _focusTimerDomain = '';
  batch(function() {
    _focusTimerText.value = '';
    _focusTimerActive.value = false;
    _focusTimerWarn.value = false;
  });
}

export function _updateFocusTimerPill() {
  if (!_focusTimerDomain) return;
  const elapsed = _focusTimerElapsed();
  const isWarn = _focusTimerWarnMinutes > 0 && elapsed >= _focusTimerWarnMinutes * 60 * 1000;
  batch(function() {
    _focusTimerText.value = _formatFocusTime(elapsed);
    _focusTimerActive.value = true;
    _focusTimerWarn.value = isWarn;
  });
}

export function _checkFocusTimer(url) {
  const match = _doomScrollMatch(url);
  if (match && match.mode === 'nudge') {
    _startFocusTimer(match.domain, match.minutes);
  } else {
    _hideFocusTimerPill();
  }
}

// ── Doom Scroll Bypass & Blocked Page ──

// Temporary bypass list for "allow once" on blocked sites (cleared on app restart)
export const _doomScrollBypass = new Set();

export function _browseShowBlockedPage(tab, frame, url, domain) {
  const isDark = document.documentElement.classList.contains('dark') || Settings.get('theme') === 'dark';
  const bg = isDark ? '#0a0a0a' : '#f5f5f5';
  const card = isDark ? '#151515' : '#fff';
  const text = isDark ? '#e0e0e0' : '#333';
  const dim = isDark ? '#777' : '#666';
  const dimmer = isDark ? '#555' : '#999';
  const border = isDark ? '#222' : '#e0e0e0';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';
  const safeUrl = url.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:${bg};color:${text};display:flex;align-items:center;justify-content:center;min-height:100vh}
    .c{text-align:center;max-width:400px;padding:40px}
    .icon{font-size:48px;margin-bottom:20px;opacity:.6}
    h1{font-size:18px;font-weight:600;margin-bottom:8px}
    p{font-size:13px;color:${dim};margin-bottom:24px;line-height:1.5}
    .domain{color:${text};font-weight:500}
    .actions{display:flex;gap:8px;justify-content:center;margin-bottom:16px}
    button{padding:8px 20px;border-radius:8px;border:1px solid ${border};background:${card};color:${text};font-size:13px;cursor:pointer;font-family:inherit;transition:border-color .15s}
    button:hover{border-color:${accent};color:${accent}}
    .bypass{font-size:11px;color:${dimmer};cursor:pointer;background:none;border:none;padding:4px 8px}
    .bypass:hover{color:${dim}}
    .bypass.waiting{pointer-events:none}
  </style></head><body><div class="c">
    <div class="icon">\u26D4</div>
    <h1>Site blocked</h1>
    <p><span class="domain">${domain}</span> is blocked by Focus Mode to help you stay on track.</p>
    <div class="actions"><button onclick="history.back()">Go back</button></div>
    <button class="bypass" id="__bypass" onclick="__doBypass()">Continue anyway</button>
    <script>
      var _countdown=3,_started=false;
      var btn=document.getElementById('__bypass');
      function __doBypass(){
        if(!_started){_started=true;btn.classList.add('waiting');tick();return;}
        console.log('__AETHER_BYPASS_BLOCK__${safeUrl}');
      }
      function tick(){
        if(_countdown>0){btn.textContent='Continue anyway ('+_countdown+'s)';_countdown--;setTimeout(tick,1000);}
        else{btn.textContent='Continue anyway';btn.classList.remove('waiting');}
      }
    </script>
  </div></body></html>`;
  try { frame.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); } catch {}
  tab.title = 'Blocked \u2014 ' + domain;
  tab.blank = false;
  if (typeof _browseRenderTabs !== 'undefined') _browseRenderTabs();
}

export function _injectDoomScrollNudge(tab, el, config) {
  const domain = config.domain;
  // Compute delay from persisted start time so nudge survives reload/SPA nav
  const startTime = _focusTimerStarts[domain] || Date.now();
  const elapsedMs = Date.now() - startTime;
  const thresholdMs = (config.minutes || 5) * 60 * 1000;
  const remainingMs = Math.max(0, thresholdMs - elapsedMs);
  // Read theme colors from parent frame (webview content can't access parent CSS vars)
  const isDark = document.documentElement.classList.contains('dark') || Settings.get('theme') === 'dark';
  const cardBg = isDark ? '#181818' : '#fff';
  const cardBorder = isDark ? '#333' : '#ddd';
  const cardText = isDark ? '#e0e0e0' : '#333';
  const cardDim = isDark ? '#999' : '#666';
  const btnBorder = isDark ? '#444' : '#ccc';
  const btnText = isDark ? '#ccc' : '#555';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';

  el.executeJavaScript(`(function(){
    if(window.__aetherDoomScrollInjected) return;
    window.__aetherDoomScrollInjected=true;
    var domain=${JSON.stringify(domain)};
    var remainingMs=${remainingMs};
    var thresholdMin=${config.minutes || 5};
    function showOverlay(elapsedMin){
      if(document.getElementById('__aether-doom-overlay')) return;
      var ov=document.createElement('div');
      ov.id='__aether-doom-overlay';
      ov.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
      var card=document.createElement('div');
      card.style.cssText='background:${cardBg};border:1px solid ${cardBorder};border-radius:16px;padding:32px 40px;text-align:center;max-width:380px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:${cardText};';
      card.innerHTML='<div style="font-size:36px;margin-bottom:16px;opacity:.7">\\u23F1</div>'
        +'<div style="font-size:16px;font-weight:600;margin-bottom:8px">Time check</div>'
        +'<div style="font-size:13px;color:${cardDim};margin-bottom:24px;line-height:1.5">You\\u2019ve been on <strong style="color:${cardText}">'+domain+'</strong> for <strong style="color:${cardText}">'+elapsedMin+'</strong> minutes.</div>'
        +'<div style="display:flex;gap:10px;justify-content:center">'
        +'<button id="__aether-ds-close" style="padding:8px 18px;border-radius:8px;background:${accent};color:#fff;border:none;font-size:13px;cursor:pointer;font-family:inherit">Close tab</button>'
        +'<button id="__aether-ds-more" style="padding:8px 18px;border-radius:8px;background:transparent;color:${btnText};border:1px solid ${btnBorder};font-size:13px;cursor:pointer;font-family:inherit">5 more minutes</button>'
        +'</div>';
      ov.appendChild(card);
      document.body.appendChild(ov);
      document.getElementById('__aether-ds-close').onclick=function(){console.log('__AETHER_CLOSE_TAB__');};
      document.getElementById('__aether-ds-more').onclick=function(){
        ov.remove();
        window.__aetherDoomScrollInjected=false;
        console.log('__AETHER_DOOM_SNOOZE__');
        setTimeout(function(){
          if(!window.__aetherDoomScrollInjected){
            window.__aetherDoomScrollInjected=true;
            showOverlay(elapsedMin+5);
          }
        },5*60*1000);
      };
    }
    if(remainingMs<=0){showOverlay(thresholdMin);}
    else{setTimeout(function(){showOverlay(thresholdMin);},remainingMs);}
  })();`).catch(() => {});
}
