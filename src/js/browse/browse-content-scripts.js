// browse-content-scripts.js — Content script injection, console-message routing
// Extracted from browse-downloads.js
import Settings from '/js/core/core-settings.js';
import { _showLinkPreview, _hideLinkPreview } from '/js/core/core-ui.js';
import { _annotationsEnabled, _hideAnnotationTooltip, _showAnnotationTooltip, _pickerEnabled } from '/js/browse/browse-annotations.js';
import { _browseToggleFindBar, _swipeCommit, _switchTabLeft, _switchTabRight, _magnifyFromWebview, _magnifyFromWebviewGestureStart, _magnifyFromWebviewGestureChange, _magnifyFromWebviewGestureEnd } from '/js/browse/browse-features.js';
import { _pageInfoUpdateScroll, _pageInfoUpdateTokens } from '/js/browse/browse-pageinfo.js';
import { _iframeRectToParent, _positionAtCursor, _showPanel } from '/js/panel.js';
import { _paperHandleMeta, _paperHideRefTooltip, _paperShowRefTooltip } from '/js/browse/browse-paper.js';
import { browseNewTab } from '/js/browse/browse-windows.js';
import { _getDoomScrollSites, _doomScrollBypass, _focusTimerDomain, _focusTimerStarts, _persistFocusTimerStarts, _updateFocusTimerPill } from '/js/browse/browse-doom-scroll.js';

// YouTube ad blocking is handled at the network layer via CDP in electron/youtube-adstrip.js.
// No page-level JS hooks are used to avoid triggering YouTube's anti-adblock detection.

export function _browseInjectYouTubeCSS(frame, url) {
  // Disabled: all YouTube ad blocking is now at the network layer via CDP.
  return;
}

// ── Auto Remove CSS ──

export function toggleAutoRemoveCSS() {
  const on = Settings.get('autoRemoveCSS') === 'true';
  const newState = !on;
  Settings.set('autoRemoveCSS', newState ? 'true' : 'false');
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-secondary)');
  // Apply/remove on current tab
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.el && !tab.blank) {
    if (newState) {
      _browseInjectRemoveCSS(tab.el);
    } else if (tab.el.reload) {
      tab.el.reload();
    }
  }
}

export function _browseInjectRemoveCSS(frame) {
  if (Settings.get('autoRemoveCSS') !== 'true') return;
  frame.executeJavaScript(`(function(){
    if(window.__aetherCSSRemoved) return;
    window.__aetherCSSRemoved=true;
    // Remove all stylesheets
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(function(el){ el.remove(); });
    // Remove inline styles
    document.querySelectorAll('[style]').forEach(function(el){ el.removeAttribute('style'); });
    // Block future stylesheet additions
    var obs=new MutationObserver(function(muts){
      muts.forEach(function(m){
        m.addedNodes.forEach(function(n){
          if(n.nodeType===1){
            if(n.tagName==='LINK'&&n.rel==='stylesheet') n.remove();
            if(n.tagName==='STYLE') n.remove();
          }
        });
      });
    });
    obs.observe(document.documentElement,{childList:true,subtree:true});
  })();`).catch(function(){});
}

export function _browseInjectYouTubeAdBlock(frame, url) {
  // Disabled: all YouTube ad blocking is now at the network layer via CDP.
  return;
}

export function _browseInjectContentScripts(tab, frame) {
  // Context menu — always show aether panel (with context items for links/images)
  // Debounce: the injected script also fires __AETHER_CONTEXT__ for the same right-click
  let _ctxMenuHandledAt = 0;
  frame.addEventListener('context-menu', (ev) => {
    ev.preventDefault();
    _ctxMenuHandledAt = Date.now();
    if (typeof _showPanel !== 'function') return;
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) { popup.remove(); window._aetherTrackMode = false; }
    const ctxData = (ev.linkURL || ev.srcURL) ? {
      linkUrl: ev.linkURL || '', linkText: ev.linkText || '',
      imgUrl: ev.srcURL || '', mediaType: ev.mediaType || ''
    } : null;
    _showPanel({ anchor: { x: ev.x, y: ev.y }, contextMenu: ctxData, trackCursor: !ctxData });
  });

  // Inject right-click handler after page loads
  frame.addEventListener('dom-ready', () => {
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherContextMenuInjected)return;
        window.__aetherContextMenuInjected=true;
        // Override window.open to relay to parent as new tab
        var _origOpen=window.open;
        window.open=function(url){
          if(url&&url.indexOf('javascript:')!==0){
            try{var resolved=new URL(url,location.href).href;console.log('__AETHER_OPEN_TAB__'+resolved);}catch(e){console.log('__AETHER_OPEN_TAB__'+url);}
          }
          return null;
        };
        document.addEventListener('contextmenu',function(e){
          var tag = e.target.tagName;
          if(tag==='INPUT'||tag==='TEXTAREA'||e.target.isContentEditable){
            e.preventDefault();e.stopPropagation();
            window.__aetherLastEditable=e.target;
            console.log('__AETHER_EDITABLE__'+JSON.stringify({x:e.screenX,y:e.screenY}));
            return false;
          }
          var data = {x:e.screenX,y:e.screenY};
          var a=e.target.closest('a[href]');
          if(a){
            var h=a.getAttribute('href');
            if(h&&h.indexOf('javascript:')!==0&&h.charAt(0)!=='#'){
              data.linkUrl=h;
              data.linkText=a.textContent.trim().slice(0,100);
            }
          }
          var img=e.target.closest('img');
          if(img && img.src){
            data.imgUrl=img.src;
            data.imgAlt=img.alt||'';
          }
          e.preventDefault();
          e.stopPropagation();
          if(data.linkUrl||data.imgUrl){
            console.log('__AETHER_CONTEXT__'+JSON.stringify(data));
          } else {
            console.log('__AETHER_CHAT__'+JSON.stringify(data));
          }
          return false;
        },true);
        // Text selection inside webview → relay to parent
        var _wvSelDragging=false;
        document.addEventListener('mousedown',function(e){
          if(e.button!==0) return;
          console.log('__AETHER_CLOSE_MENU__'); console.log('__AETHER_DISMISS_CHAT__');
          var tag=e.target.tagName;
          if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||tag==='BUTTON') return;
          if(e.target.isContentEditable) return;
          _wvSelDragging=true;
        },true);
        document.addEventListener('selectionchange',function(){
          if(!_wvSelDragging) return;
          var sel=document.getSelection();
          var text=sel?sel.toString().trim():'';
          if(!text||text.length<3||sel.rangeCount===0) return;
          var r=sel.getRangeAt(0).getBoundingClientRect();
          console.log('__AETHER_SEL_PREVIEW__'+JSON.stringify({text:text,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}));
        });
        document.addEventListener('mouseup',function(e){
          if(!_wvSelDragging) return;
          _wvSelDragging=false;
          var sel=document.getSelection();
          var text=sel?sel.toString().trim():'';
          if(text&&text.length>=3&&sel.rangeCount>0){
            var r=sel.getRangeAt(0).getBoundingClientRect();
            console.log('__AETHER_SEL_FINAL__'+JSON.stringify({text:text,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}));
          } else {
            console.log('__AETHER_SEL_CLEAR__');
          }
        },true);
        document.addEventListener('keydown',function(e){
          if(e.key==='Escape') console.log('__AETHER_DISMISS_CHAT__');
          if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();console.log('__AETHER_FIND__');}
          if(e.altKey&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){if(e.key==='ArrowLeft'){e.preventDefault();console.log('__AETHER_TAB_LEFT__');}if(e.key==='ArrowRight'){e.preventDefault();console.log('__AETHER_TAB_RIGHT__');}}
        },true);
        // Link hover preview — relay to parent
        var _lastHoveredHref='';
        document.addEventListener('mouseover',function(e){
          var a=e.target.closest('a[href]');
          if(a){
            var h=a.href;
            if(h&&h!=='#'&&h.indexOf('javascript:')!==0&&h!==_lastHoveredHref){
              _lastHoveredHref=h;
              console.log('__AETHER_LINK_HOVER__'+h);
            }
          } else if(_lastHoveredHref){
            _lastHoveredHref='';
            console.log('__AETHER_LINK_LEAVE__');
          }
        },true);
        // Throttled mousemove for aether panel
        var _lastMove=0;
        document.addEventListener('mousemove',function(e){
          var now=Date.now();
          if(now-_lastMove<16) return;
          _lastMove=now;
          console.log('__AETHER_MOUSE__'+e.screenX+','+e.screenY);
        });
        // Relay clicks for neuralook implicit tracking
        document.addEventListener('click',function(e){
          console.log('__NEURALOOK_CLICK__'+e.screenX+','+e.screenY);
          // Intercept target="_blank" links and Cmd/Ctrl+click to open in new tab
          var a=e.target.closest('a[href]');
          if(a){
            var href=a.href;
            if(!href||href.indexOf('javascript:')===0||href.charAt(0)==='#') return;
            if(a.target==='_blank'||e.metaKey||e.ctrlKey){
              e.preventDefault();
              e.stopPropagation();
              console.log('__AETHER_OPEN_TAB__'+href);
            }
          }
        },true);
      })();
    `).catch(()=>{});

    // RSS feed detection
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherRssDetected)return;
        window.__aetherRssDetected=true;
        var links=document.querySelectorAll('link[type="application/rss+xml"],link[type="application/atom+xml"],link[type="application/feed+json"]');
        if(links.length){
          var feeds=[];
          for(var i=0;i<links.length;i++){
            feeds.push({url:links[i].href||links[i].getAttribute('href'),title:links[i].title||''});
          }
          console.log('__AETHER_RSS_FEEDS__'+JSON.stringify(feeds));
        }
      })();
    `).catch(()=>{});

    // Scroll percentage tracking — relay to parent for pill island
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherScrollInjected)return;
        window.__aetherScrollInjected=true;
        var _lastPct=-1;
        function reportScroll(){
          var h=document.documentElement.scrollHeight-window.innerHeight;
          var pct=h>0?Math.round((window.scrollY/h)*100):0;
          if(pct<0)pct=0;if(pct>100)pct=100;
          if(pct!==_lastPct){_lastPct=pct;console.log('__AETHER_SCROLL__'+pct);}
        }
        document.addEventListener('scroll',reportScroll,{passive:true});
        window.addEventListener('resize',reportScroll,{passive:true});
        setTimeout(reportScroll,500);
      })();
    `).catch(()=>{});

    // Token count estimation — report DOM text size as approximate token count
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherTokenInjected)return;
        window.__aetherTokenInjected=true;
        function reportTokens(){
          var text=document.body?document.body.innerText:'';
          var tokens=Math.round(text.length/4);
          console.log('__AETHER_TOKENS__'+tokens);
        }
        setTimeout(reportTokens,1500);
        var _mo=new MutationObserver(function(){clearTimeout(_mo._t);_mo._t=setTimeout(reportTokens,2000);});
        if(document.body)_mo.observe(document.body,{childList:true,subtree:true});
        else document.addEventListener('DOMContentLoaded',function(){_mo.observe(document.body,{childList:true,subtree:true});});
      })();
    `).catch(()=>{});

    // Pinch-to-magnify — relay raw gesture data + cursor position to parent
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherPinchInjected)return;
        window.__aetherPinchInjected=true;
        var mx=0,my=0;
        document.addEventListener('mousemove',function(e){mx=e.clientX;my=e.clientY;},{passive:true});
        document.addEventListener('wheel',function(e){
          if(!e.ctrlKey)return;
          e.preventDefault();
          console.log('__AETHER_MAGNIFY_WHEEL__'+e.deltaY+','+e.clientX+','+e.clientY);
        },{passive:false});
        document.addEventListener('gesturestart',function(e){
          e.preventDefault();
          console.log('__AETHER_MAGNIFY_GSTART__'+mx+','+my);
        },{passive:false});
        document.addEventListener('gesturechange',function(e){
          e.preventDefault();
          console.log('__AETHER_MAGNIFY_GCHANGE__'+e.scale);
        },{passive:false});
        document.addEventListener('gestureend',function(e){
          e.preventDefault();
          console.log('__AETHER_MAGNIFY_GEND__');
        },{passive:false});
      })();
    `).catch(()=>{});

    // Two-finger horizontal swipe detection — relay to parent for back/forward nav
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherSwipeInjected)return;
        window.__aetherSwipeInjected=true;
        var accum=0,dir=null,decay=null,cooldown=0;
        var THRESHOLD=80;
        function reset(){accum=0;dir=null;clearTimeout(decay);}
        document.addEventListener('wheel',function(e){
          if(e.ctrlKey||Date.now()<cooldown)return;
          var dx=e.deltaX,dy=e.deltaY;
          if(Math.abs(dx)<2||Math.abs(dy)>Math.abs(dx)*1.2){
            if(dir){clearTimeout(decay);decay=setTimeout(reset,200);}
            return;
          }
          var d=dx<0?'back':'forward';
          if(dir&&dir!==d)reset();
          dir=d;accum+=Math.abs(dx);
          clearTimeout(decay);
          if(accum>=THRESHOLD){
            console.log('__AETHER_SWIPE__'+d);
            reset();cooldown=Date.now()+500;
          }else{
            decay=setTimeout(reset,300);
          }
        },{passive:true});
      })();
    `).catch(()=>{});

    // Password field detection + form submit interception
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherPwInjected)return;
        window.__aetherPwInjected=true;
        function findPwFields(){return Array.from(document.querySelectorAll('input[type="password"]'));}
        function findUsernameField(pwField){
          var form=pwField.closest('form');
          var scope=form||document;
          var candidates=scope.querySelectorAll('input[type="text"],input[type="email"],input:not([type])');
          for(var i=candidates.length-1;i>=0;i--){
            var c=candidates[i];
            var n=(c.name||'').toLowerCase()+(c.id||'').toLowerCase()+(c.autocomplete||'').toLowerCase()+(c.placeholder||'').toLowerCase();
            if(n.match(/user|email|login|account|name/)) return c;
          }
          return candidates.length?candidates[candidates.length-1]:null;
        }
        function notifyFields(){
          if(findPwFields().length>0) console.log('__AETHER_PW_FIELDS__');
        }
        notifyFields();
        var obs=new MutationObserver(function(){notifyFields();});
        obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
        function captureSubmit(e){
          var pwFields=findPwFields();
          if(!pwFields.length) return;
          var pw=null,un=null;
          for(var i=0;i<pwFields.length;i++){
            if(pwFields[i].value){pw=pwFields[i].value;var uf=findUsernameField(pwFields[i]);if(uf)un=uf.value;break;}
          }
          if(!pw) return;
          console.log('__AETHER_PW_SUBMIT__'+JSON.stringify({origin:location.origin,username:un||'',password:pw}));
        }
        document.addEventListener('submit',function(e){
          if(e.target.querySelector('input[type="password"]')) captureSubmit(e);
        },true);
        document.addEventListener('click',function(e){
          var btn=e.target.closest('button,input[type="submit"],a[role="button"]');
          if(!btn) return;
          var form=btn.closest('form');
          if(form&&form.querySelector('input[type="password"]')) setTimeout(function(){captureSubmit();},100);
        },true);
      })();
    `).catch(()=>{});

    // YouTube ad blocking injection
    _browseInjectYouTubeAdBlock(frame, frame.getURL());
  });

  frame.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) _browseInjectYouTubeAdBlock(frame, e.url);
  });

  // Listen for context menu via console message
  frame.addEventListener('console-message', (e) => {
    if (e.message === '__AETHER_CLOSE_TAB__') {
      // Access browseCloseTab via window to avoid circular dep with browse-passwords
      if (typeof window.browseCloseTab === 'function') window.browseCloseTab(tab.id);
      return;
    } else if (e.message && e.message.startsWith('__AETHER_BYPASS_BLOCK__')) {
      const bypassUrl = e.message.slice('__AETHER_BYPASS_BLOCK__'.length);
      try {
        const host = new URL(bypassUrl).hostname.toLowerCase();
        // Add all matching domains to bypass set
        const sites = _getDoomScrollSites();
        for (const s of sites) {
          if (host === s.domain || host.endsWith('.' + s.domain)) _doomScrollBypass.add(s.domain);
        }
      } catch {}
      frame.loadURL(bypassUrl);
      return;
    } else if (e.message === '__AETHER_DOOM_SNOOZE__') {
      // "5 more minutes" — reset the persisted start time so pill restarts from 0
      if (_focusTimerDomain && _focusTimerStarts[_focusTimerDomain]) {
        _focusTimerStarts[_focusTimerDomain] = Date.now();
        _persistFocusTimerStarts();
        _updateFocusTimerPill();
      }
      return;
    } else if (e.message && e.message.startsWith('__AETHER_LINK_HOVER__')) {
      _showLinkPreview(e.message.slice('__AETHER_LINK_HOVER__'.length));
      return;
    } else if (e.message === '__AETHER_LINK_LEAVE__') {
      _hideLinkPreview();
      return;
    } else if (e.message === '__AETHER_DISMISS_CHAT__') {
      const popup = document.getElementById('doc-chat-ask-float');
      if (popup) {
        if (window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
        window._aetherTrackMode = false;
        popup.remove();
      }
    } else if (e.message && e.message.startsWith('__AETHER_MOUSE__')) {
      if (!window._aetherTrackMode) return;
      const parts = e.message.slice('__AETHER_MOUSE__'.length).split(',');
      const x = parseInt(parts[0]) - window.screenX;
      const y = parseInt(parts[1]) - window.screenY;
      window._lastMouseX = x;
      window._lastMouseY = y;
      const popup = document.getElementById('doc-chat-ask-float');
      if (!popup) { window._aetherTrackMode = false; return; }
      const pos = _positionAtCursor(x, y, popup.offsetWidth, popup.offsetHeight, false);
      popup.style.left = pos.left + 'px';
      popup.style.top = pos.top + 'px';
    } else if (e.message === '__AETHER_CLOSE_MENU__') {
      // Access _hideBrowseContextMenu via window to avoid circular dep with browse-passwords
      if (typeof window._hideBrowseContextMenu === 'function') window._hideBrowseContextMenu();
    } else if (e.message && e.message.startsWith('__AETHER_CONTEXT__')) {
      // Skip if the Electron context-menu event already handled this right-click
      if (Date.now() - _ctxMenuHandledAt < 300) return;
      try {
        const data = JSON.parse(e.message.slice('__AETHER_CONTEXT__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); window._aetherTrackMode = false; }
          _showPanel({ anchor: { x, y }, contextMenu: data });
        }
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_CHAT__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_CHAT__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); window._aetherTrackMode = false; }
          _showPanel({ anchor: { x, y }, trackCursor: true });
        }
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_EDITABLE__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_EDITABLE__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); window._aetherTrackMode = false; }
          _showPanel({ anchor: { x, y }, trackCursor: false, webviewEditable: { webview: frame, editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } } });
        }
      } catch (err) {}
    } else if (e.message === '__AETHER_FIND__') {
      _browseToggleFindBar();
    } else if (e.message === '__AETHER_TAB_LEFT__') {
      _switchTabLeft();
    } else if (e.message === '__AETHER_TAB_RIGHT__') {
      _switchTabRight();
    } else if (e.message && (e.message.startsWith('__AETHER_SEL_PREVIEW__') || e.message.startsWith('__AETHER_SEL_FINAL__'))) {
      try {
        const isFinal = e.message.startsWith('__AETHER_SEL_FINAL__');
        const prefix = isFinal ? '__AETHER_SEL_FINAL__' : '__AETHER_SEL_PREVIEW__';
        const data = JSON.parse(e.message.slice(prefix.length));
        const selectionRect = _iframeRectToParent(data, frame);
        window._aetherTrackMode = false;
        if (!isFinal) {
          const existing = document.getElementById('doc-chat-ask-float');
          if (existing && existing._isAetherPanel) existing.remove();
        }
        _showPanel({ anchor: { selectionRect }, selectionText: data.text, finalized: isFinal });
      } catch (err) {}
    } else if (e.message === '__AETHER_SEL_CLEAR__') {
      const existing = document.getElementById('doc-chat-ask-float');
      if (existing) { existing.remove(); window._aetherTrackMode = false; }
    } else if (e.message && e.message.startsWith('__AETHER_LINK__')) {
      // Legacy support
      try {
        const data = JSON.parse(e.message.slice('__AETHER_LINK__'.length));
        if (data.href) {
          const x = data.x - window.screenX;
          const y = data.y - window.screenY;
          // Access _showBrowseContextMenu via window to avoid circular dep
          if (typeof window._showBrowseContextMenu === 'function') window._showBrowseContextMenu(x, y, { linkUrl: data.href, linkText: data.text || '' });
        }
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_OPEN_TAB__')) {
      const url = e.message.slice('__AETHER_OPEN_TAB__'.length);
      if (url) browseNewTab(url);
    } else if (e.message && e.message.startsWith('__AETHER_SCROLL__')) {
      if (tab.id === _browseActiveTab) {
        _pageInfoUpdateScroll(parseInt(e.message.slice('__AETHER_SCROLL__'.length)));
      }
    } else if (e.message && e.message.startsWith('__AETHER_TOKENS__')) {
      if (tab.id === _browseActiveTab) {
        _pageInfoUpdateTokens(parseInt(e.message.slice('__AETHER_TOKENS__'.length)));
      }
    } else if (e.message && e.message.startsWith('__AETHER_MAGNIFY_WHEEL__')) {
      if (tab.id === _browseActiveTab && tab.el) {
        var wp = e.message.slice('__AETHER_MAGNIFY_WHEEL__'.length).split(',');
        var container = document.getElementById('browse-content');
        var cr = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
        _magnifyFromWebview(tab.el, parseFloat(wp[0]), cr.left + parseFloat(wp[1]), cr.top + parseFloat(wp[2]));
      }
    } else if (e.message && e.message.startsWith('__AETHER_MAGNIFY_GSTART__')) {
      if (tab.id === _browseActiveTab && tab.el) {
        var gp = e.message.slice('__AETHER_MAGNIFY_GSTART__'.length).split(',');
        var gc = document.getElementById('browse-content');
        var gcr = gc ? gc.getBoundingClientRect() : { left: 0, top: 0 };
        _magnifyFromWebviewGestureStart(tab.el, gcr.left + parseFloat(gp[0]), gcr.top + parseFloat(gp[1]));
      }
    } else if (e.message && e.message.startsWith('__AETHER_MAGNIFY_GCHANGE__')) {
      if (tab.id === _browseActiveTab && tab.el) {
        _magnifyFromWebviewGestureChange(tab.el, parseFloat(e.message.slice('__AETHER_MAGNIFY_GCHANGE__'.length)));
      }
    } else if (e.message === '__AETHER_MAGNIFY_GEND__') {
      if (tab.id === _browseActiveTab && tab.el) {
        _magnifyFromWebviewGestureEnd();
      }
    } else if (e.message && e.message.startsWith('__AETHER_SWIPE__')) {
      if (tab.id === _browseActiveTab && typeof _swipeCommit === 'function') {
        _swipeCommit(e.message.slice('__AETHER_SWIPE__'.length));
      }
    } else if (e.message && e.message.startsWith('__NEURALOOK_CLICK__')) {
      if (typeof _nlHandleIframeClick === 'function') {
        const parts = e.message.slice('__NEURALOOK_CLICK__'.length).split(',');
        const x = parseInt(parts[0]) - window.screenX;
        const y = parseInt(parts[1]) - window.screenY;
        _nlHandleIframeClick(x, y);
      }
    } else if (e.message && e.message.startsWith('__AETHER_RSS_FEEDS__')) {
      try {
        const feeds = JSON.parse(e.message.slice('__AETHER_RSS_FEEDS__'.length));
        // Resolve relative URLs against tab.url
        tab.rssFeeds = feeds.map(f => {
          try { return { url: new URL(f.url, tab.url).href, title: f.title }; }
          catch { return f; }
        });
        // Access _browseUpdateRssPill via window to avoid circular dep with browse-navigation
        if (typeof window._browseUpdateRssPill === 'function') window._browseUpdateRssPill(tab);
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_ANN_CLICK__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_ANN_CLICK__'.length));
        _showAnnotationTooltip(data, frame, true);
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_ANN_MOVE__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_ANN_MOVE__'.length));
        _showAnnotationTooltip(data, frame);
      } catch (err) {}
    } else if (e.message === '__AETHER_ANN_DISMISS__') {
      _hideAnnotationTooltip(true);
    } else if (e.message === '__AETHER_ANN_LEAVE__') {
      _hideAnnotationTooltip();
    } else if (e.message && e.message.startsWith('__AETHER_PICKER_SELECT__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_PICKER_SELECT__'.length));
        _pickerEnabled.set(tab.id, false);
        // Open chat panel and add element context
        let aetherPanel = document.getElementById('doc-chat-ask-float');
        if (!aetherPanel) {
          _showPanel({ anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 } });
          aetherPanel = document.getElementById('doc-chat-ask-float');
        }
        if (aetherPanel && typeof window._addElementContextToPanel === 'function') {
          window._addElementContextToPanel(aetherPanel, data);
        }
      } catch (err) {}
    } else if (e.message === '__AETHER_PICKER_CANCEL__') {
      _pickerEnabled.set(tab.id, false);
    } else if (e.message === '__AETHER_PW_FIELDS__') {
      // Access _pwCheckAutofill via window to avoid circular dep with browse-passwords
      if (typeof window._pwCheckAutofill === 'function') window._pwCheckAutofill(tab, frame);
    } else if (e.message && e.message.startsWith('__AETHER_PW_SUBMIT__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_PW_SUBMIT__'.length));
        window._pwPendingPrompt = { tab, data, ts: Date.now() };
        // Access _pwShowSavePrompt via window to avoid circular dep with browse-passwords
        if (typeof window._pwShowSavePrompt === 'function') window._pwShowSavePrompt(tab, data);
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_PAPER_META__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_PAPER_META__'.length));
        if (typeof _paperHandleMeta === 'function') _paperHandleMeta(tab, data);
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_REF_HOVER__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_REF_HOVER__'.length));
        if (typeof _paperShowRefTooltip === 'function') _paperShowRefTooltip(data, frame);
      } catch (err) {}
    } else if (e.message === '__AETHER_REF_LEAVE__') {
      if (typeof _paperHideRefTooltip === 'function') _paperHideRefTooltip();
    }
  });
}
