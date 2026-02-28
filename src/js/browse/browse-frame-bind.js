// browse-frame-bind.js — _browseBindFrame orchestrator, cosmetic injection, YT shorts hiding
// Extracted from browse-downloads.js
import Settings from '/js/core/core-settings.js';
import { _browseUpdateAdBlockBadge } from '/js/browse-urlbar.js';
import { _browseHandleNavigation } from '/js/browse/browse-navigation.js';
import { _browseInjectContentScripts } from '/js/browse/browse-content-scripts.js';
import { _doomScrollMatch, _injectDoomScrollNudge } from '/js/browse/browse-doom-scroll.js';

// ── Webview Dark Mode ──

const _darkModeCSS = 'html { filter: invert(0.88) hue-rotate(180deg); background: #fff !important; } img, video, canvas, svg, [style*="background-image"] { filter: invert(1) hue-rotate(180deg); }';

export function _browseInjectDarkMode(tab) {
  var el = tab && tab.el;
  if (!el || typeof el.executeJavaScript !== 'function') return;
  el.executeJavaScript(`(function(){
    var id = '__aether_dark_mode__';
    if (document.getElementById(id)) return;
    var s = document.createElement('style');
    s.id = id;
    s.textContent = ${JSON.stringify(_darkModeCSS)};
    (document.head || document.documentElement).appendChild(s);
  })();`).catch(function(e) { console.warn('[DarkMode] inject failed:', e); });
}

export function _browseRemoveDarkMode(tab) {
  var el = tab && tab.el;
  if (!el || typeof el.executeJavaScript !== 'function') return;
  el.executeJavaScript(`(function(){
    var s = document.getElementById('__aether_dark_mode__');
    if (s) s.remove();
  })();`).catch(function(e) { console.warn('[DarkMode] remove failed:', e); });
}

export function _browseToggleWebviewDarkMode(tab) {
  if (!tab) return;
  tab._webviewDarkMode = !tab._webviewDarkMode;
  if (tab._webviewDarkMode) {
    _browseInjectDarkMode(tab);
  } else {
    _browseRemoveDarkMode(tab);
  }
}

export function _browseBindFrame(tab) {
  if (tab.contentType === 'reader') return;
  const el = tab.el;
  if (!el || !window._browseIsElectron) return;

  _browseHandleNavigation(tab, el);
  _browseInjectContentScripts(tab, el);

  // Adblock: generic ad placeholder CSS (covers common ad frameworks)
  const _adPlaceholderCSS =
    'ins.adsbygoogle,' +
    'ins.adsbygoogle[data-ad-status],' +
    '[id^="google_ads_"],' +
    '[id^="div-gpt-ad"],' +
    '[data-google-query-id],' +
    'iframe[src*="doubleclick.net"],' +
    'iframe[src*="googlesyndication.com"],' +
    'iframe[id^="google_ads_"],' +
    'iframe[src=""],' +
    '.ad-container,' +
    '.ad-wrapper,' +
    '.ad-slot,' +
    '.ad-banner,' +
    '.adunit,' +
    '#ad-container,' +
    '#ad-wrapper,' +
    '#ad-slot,' +
    '[data-ad-slot],' +
    '[data-ad],' +
    'amp-ad,' +
    'amp-embed[type="ad"],' +
    '.ad-placeholder,' +
    '.ad-loading,' +
    '.sponsored-content' +
    '{display:none!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important}';

  // Adblock: inject cosmetic CSS early + remove elements + update badge
  if (window.electronAPI && window.electronAPI.adblockCosmetic) {
    // Inject generic ad placeholder CSS on every navigation
    const _injectPlaceholderCSS = (url) => {
      if (Settings.get('adBlockEnabled') !== 'true') return;
      if (!url || url.startsWith('about:') || url.startsWith('data:')) return;
      // Skip YouTube — hiding ad elements via CSS triggers anti-adblock detection
      if (url.includes('youtube.com') || url.includes('youtu.be')) return;
      try { el.insertCSS(_adPlaceholderCSS); } catch {}
    };

    // Inject EasyList cosmetic selectors + remove elements from DOM
    const _injectCosmetic = (url) => {
      if (Settings.get('adBlockEnabled') !== 'true') return;
      if (!url || url.startsWith('about:') || url.startsWith('data:')) return;
      // Skip YouTube — cosmetic filtering triggers its anti-adblock detection
      if (url.includes('youtube.com') || url.includes('youtu.be')) return;
      window.electronAPI.adblockCosmetic(url).then(res => {
        const extraSel = (res && res.selectors && res.selectors.length) ? res.selectors.join(', ') : '';
        // Hide via CSS (both EasyList selectors and generic placeholders)
        if (extraSel) {
          try { el.insertCSS(extraSel + ' { display: none !important; }'); } catch {}
        }
        // Remove elements from DOM (EasyList + generic ad containers)
        el.executeJavaScript(`(function(){
          if(window.__aetherAdCleanInjected) return;
          window.__aetherAdCleanInjected=true;
          var extra = ${JSON.stringify(extraSel)};
          var generic = 'ins.adsbygoogle, [id^="google_ads_"], [id^="div-gpt-ad"], [data-google-query-id], iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"], iframe[id^="google_ads_"], [data-ad-slot], amp-ad, amp-embed[type="ad"]';
          var sel = extra ? (generic + ', ' + extra) : generic;
          function removeAds(){
            try{document.querySelectorAll(sel).forEach(function(el){el.remove();});}catch(e){}
            // Also remove iframes that failed to load (blocked by network filter)
            document.querySelectorAll('iframe').forEach(function(f){
              try{
                var s=f.src||f.getAttribute('src')||'';
                if(!s||s==='about:blank'||(f.offsetWidth<=1&&f.offsetHeight<=1)) return;
                if(s.includes('ad')||s.includes('sponsor')||s.includes('doubleclick')||s.includes('googlesyndication')) f.remove();
              }catch(e){}
            });
            // Collapse empty ad containers (divs with specific ad classes but no visible content)
            document.querySelectorAll('.ad-container,.ad-wrapper,.ad-slot,.ad-banner,.adunit,.ad-placeholder,#ad-container,#ad-wrapper,#ad-slot').forEach(function(el){
              if(el.children.length===0&&el.textContent.trim()==='') el.remove();
            });
          }
          removeAds();
          var obs=new MutationObserver(function(){removeAds();});
          obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
          setTimeout(function(){obs.disconnect();},30000);
        })();`).catch(() => {});
      }).catch(() => {});
    };

    // JS-based YouTube Shorts hiding (implements uBlock :has-text / :matches-path rules)
    const _hideYTShorts = (url) => {
      if (Settings.get('hideYTShorts') !== 'true') return;
      if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) return;
      el.executeJavaScript(`(function(){
        if(window.__ytShortsHideInjected) return;
        window.__ytShortsHideInjected=true;
        var isHistory = location.pathname.startsWith('/feed/history');
        function hideShorts(){
          // Sidebar: hide Shorts button (desktop + tablet mini-guide)
          document.querySelectorAll('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer').forEach(function(el){
            var txt = el.textContent.trim();
            if(/^Shorts$/i.test(txt)) el.style.display='none';
          });
          // Shorts tab on channel pages
          document.querySelectorAll('yt-tab-shape').forEach(function(el){
            if(/^Shorts$/i.test(el.textContent.trim())) el.style.display='none';
          });
          // Shorts sections (not on history page)
          if(!isHistory){
            document.querySelectorAll('ytd-rich-section-renderer, ytd-reel-shelf-renderer').forEach(function(el){
              var title = el.querySelector('#title');
              if(title && /(^| )Shorts( |$)/i.test(title.textContent)) el.style.display='none';
            });
          }
          // Short remixes in descriptions/suggestions
          document.querySelectorAll('ytd-reel-shelf-renderer').forEach(function(el){
            var title = el.querySelector('#title');
            if(title && /(^| )Shorts.?Remix/i.test(title.textContent)) el.style.display='none';
          });
          // Mobile: bottom nav Shorts button
          document.querySelectorAll('ytm-pivot-bar-item-renderer').forEach(function(el){
            if(el.querySelector('.pivot-shorts')) el.style.display='none';
          });
          // Mobile: Shorts chip on homepage
          document.querySelectorAll('ytm-chip-cloud-chip-renderer').forEach(function(el){
            if(/^Shorts$/i.test(el.textContent.trim())) el.style.display='none';
          });
          // Mobile: shorts sections (not on history)
          if(!isHistory){
            document.querySelectorAll('ytm-rich-section-renderer, ytm-reel-shelf-renderer').forEach(function(el){
              var str = el.querySelector('.yt-core-attributed-string');
              if(str && /(^| )Shorts( |$)/i.test(str.textContent)) el.style.display='none';
            });
          }
          // Mobile: shorts remixes
          document.querySelectorAll('ytm-reel-shelf-renderer').forEach(function(el){
            var str = el.querySelector('.reel-shelf-title-wrapper .yt-core-attributed-string');
            if(str && /(^| )Shorts.?Remix/i.test(str.textContent)) el.style.display='none';
          });
        }
        hideShorts();
        var obs=new MutationObserver(function(){hideShorts();});
        obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
        setTimeout(function(){obs.disconnect();},60000);
      })();`).catch(() => {});
    };

    // Doom scroll nudge injection
    const _injectDoomNudge = (url) => {
      const match = _doomScrollMatch(url);
      if (match && match.mode === 'nudge') _injectDoomScrollNudge(tab, el, match);
    };

    el.addEventListener('dom-ready', () => {
      _injectPlaceholderCSS(tab.url || '');
      _injectCosmetic(tab.url || '');
      _hideYTShorts(tab.url || '');
      _injectDoomNudge(tab.url || '');
    });
    el.addEventListener('did-navigate', (e) => {
      _injectPlaceholderCSS(e.url || '');
      _injectCosmetic(e.url || '');
      _hideYTShorts(e.url || '');
      _injectDoomNudge(e.url || '');
    });
    el.addEventListener('did-finish-load', () => {
      // Update badge count after requests finish
      setTimeout(() => {
        if (_browseActiveTab === tab.id && typeof _browseUpdateAdBlockBadge === 'function') {
          _browseUpdateAdBlockBadge(tab.url || '');
        }
      }, 500);
    });
  }

  // Dark mode: re-inject on navigation (outside adblock conditional)
  el.addEventListener('dom-ready', () => {
    if (tab._webviewDarkMode) _browseInjectDarkMode(tab);
  });
  el.addEventListener('did-navigate', () => {
    if (tab._webviewDarkMode) _browseInjectDarkMode(tab);
  });
}
