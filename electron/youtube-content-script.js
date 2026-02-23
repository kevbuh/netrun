// youtube-content-script.js — Minimal DOM-only safety net for YouTube ad blocking.
// All ad data stripping now happens at the network layer via CDP in youtube-adstrip.js.
// This script contains ZERO JS prototype modifications (no JSON.parse, fetch, XHR hooks)
// to avoid triggering YouTube's anti-adblock integrity checks.

function getYouTubeContentScript() {
  return `(function() {
    if (document.getElementById('_nr_yt_safety')) return;
    var marker = document.createElement('meta');
    marker.id = '_nr_yt_safety';
    (document.head || document.documentElement).appendChild(marker);

    // ── 1. Skip button clicker (safety net for any ads that slip through) ──
    var _skipSelectors = [
      '.ytp-skip-ad-button',
      '.ytp-ad-skip-button-modern',
      '.ytp-ad-skip-button-container button',
      '.ytp-ad-skip-button',
      '.ytp-skip-ad-button__next',
      '.ytp-ad-overlay-close-button'
    ].join(',');

    setInterval(function() {
      try {
        var btns = document.querySelectorAll(_skipSelectors);
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].offsetParent !== null) btns[i].click();
        }
      } catch (e) {}
    }, 800);

    // ── 2. Ad overlay hiding via minimal CSS (less detectable than JS manipulation) ──
    var style = document.createElement('style');
    style.textContent =
      '.ytp-ad-module,' +
      '.ytp-ad-overlay-container,' +
      '.ytp-ad-overlay-slot,' +
      '.ytp-ad-image-overlay,' +
      '.ytp-ad-text,' +
      '.ytp-ad-preview-container,' +
      '.ytp-ad-badge,' +
      '.ytp-ad-visit-advertiser-button' +
      '{display:none!important}';
    (document.head || document.documentElement).appendChild(style);

    // ── 3. Anti-adblock enforcement popup dismissal ──
    var _enfObs = new MutationObserver(function() {
      try {
        // Enforcement message overlay
        var enf = document.querySelector('ytd-enforcement-message-view-model');
        if (enf) {
          var btns = enf.querySelectorAll('button, yt-button-shape button, .yt-spec-button-shape-next');
          for (var i = 0; i < btns.length; i++) {
            var txt = (btns[i].textContent || '').toLowerCase();
            if (txt.indexOf('allow') !== -1 || txt.indexOf('dismiss') !== -1) {
              btns[i].click(); break;
            }
          }
          document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function(o) { o.remove(); });
          enf.remove();
        }
        // Paper dialog variant
        var popup = document.querySelector('tp-yt-paper-dialog ytd-enforcement-message-view-model');
        if (popup) {
          var d = popup.closest('tp-yt-paper-dialog');
          var btn = popup.querySelector('button');
          if (btn) btn.click();
          document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function(o) { o.remove(); });
          if (d) d.remove();
        }
        // Generic popup dialog
        var extDialog = document.querySelector('ytd-popup-container tp-yt-paper-dialog');
        if (extDialog) {
          var close = extDialog.querySelector('[aria-label="Close"], .close-button, yt-icon-button');
          if (close) close.click();
          else extDialog.remove();
          document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function(o) { o.remove(); });
        }
        // Resume playback if paused by enforcement
        var video = document.querySelector('.html5-video-player video');
        if (video && video.paused) video.play();
      } catch (e) {}
    });
    if (document.body) {
      _enfObs.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        _enfObs.observe(document.body, { childList: true, subtree: true });
      });
    }
  })();`;
}

module.exports = { getYouTubeContentScript };
