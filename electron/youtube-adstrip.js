// youtube-adstrip.js — YouTube ad stripping via protocol-level response interception.
// Uses Electron's session.protocol.handle() to intercept and modify YouTube API
// responses BEFORE they reach the page's JS context. This is invisible to YouTube's
// anti-adblock detection since no page-level JS is modified.

const { net } = require('electron');
const https = require('https');
const http = require('http');

/**
 * Follow redirect chain via Node's native http/https (bypasses Electron's
 * protocol handler entirely). Returns the final URL after up to 5 hops.
 * Resolves to the original URL on any error or timeout.
 */
function _resolveRedirectChain(url, maxHops = 5) {
  return new Promise(resolve => {
    let current = url;
    let remaining = maxHops;

    function step() {
      if (remaining-- <= 0) return resolve(current);
      try {
        const parsed = new URL(current);
        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.request({
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: parsed.pathname + parsed.search,
          method: 'HEAD',
          timeout: 2000,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        }, (res) => {
          res.resume();
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            try { current = new URL(res.headers.location, current).href; }
            catch { return resolve(current); }
            step();
          } else {
            resolve(current);
          }
        });
        req.on('error', () => resolve(current));
        req.on('timeout', () => { req.destroy(); resolve(current); });
        req.end();
      } catch { resolve(current); }
    }

    step();
  });
}

function isYouTubeDomain(urlStr) {
  try {
    const h = new URL(urlStr).hostname;
    return h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be';
  } catch { return false; }
}

// Network-level URL patterns to block outright (via onBeforeRequest in main.js)
const YT_AD_URL_PATTERNS = [
  '/api/stats/ads',
  '/pagead/',
  '/get_midroll_',
  'doubleclick.net/pagead/',
  'googlesyndication.com/pagead/',
];

// YouTube API URL patterns whose response bodies should be intercepted and stripped
const YT_API_INTERCEPT_PATTERNS = [
  '/youtubei/v1/player',
  '/youtubei/v1/next',
  '/youtubei/v1/browse',
  '/youtubei/v1/search',
  '/youtubei/v1/reel/reel_watch_sequence',
  '/youtubei/v1/guide',
  '/youtubei/v1/updated_metadata',
];

// YouTube page paths that embed initial data in HTML
const YT_PAGE_PATHS = ['/', '/watch', '/shorts/', '/results', '/feed/', '/channel/', '/@'];

// Top-level keys that contain ad data
const AD_KEYS = [
  'adPlacements', 'playerAds', 'adSlots', 'adBreakParams',
  'adBreakHeartbeatParams', 'adBreakServiceRenderer',
  'linearAdSequenceRenderer', 'instreamAdBreakRenderer',
];

// Renderer keys that indicate an ad element in arrays/objects
const AD_RENDERERS = {
  adSlotRenderer: 1,
  promotedSparklesWebRenderer: 1,
  promotedVideoRenderer: 1,
  promotedSparklesTextSearchRenderer: 1,
  textSearchAdRenderer: 1,
  searchPaidAdRenderer: 1,
  bannerPromoRenderer: 1,
  statementBannerRenderer: 1,
  adSlotAndLayoutRenderer: 1,
  inFeedAdLayoutRenderer: 1,
  reelPlayerOverlayRenderer: 1,
  compactPromotedVideoRenderer: 1,
  mastHeadAdRenderer: 1,
};

function stripAds(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth > 25) return;

  // Remove top-level ad keys
  for (let i = 0; i < AD_KEYS.length; i++) {
    if (obj[AD_KEYS[i]] !== undefined) delete obj[AD_KEYS[i]];
  }

  // Remove ad request config (tells player how to request more ads)
  if (obj.playerConfig) {
    if (obj.playerConfig.adRequestConfig) delete obj.playerConfig.adRequestConfig;
    if (obj.playerConfig.adsRequestConfig) delete obj.playerConfig.adsRequestConfig;
  }

  if (Array.isArray(obj)) {
    for (let j = obj.length - 1; j >= 0; j--) {
      const item = obj[j];
      if (item && typeof item === 'object') {
        const keys = Object.keys(item);
        let isAd = false;
        for (let k = 0; k < keys.length; k++) {
          if (AD_RENDERERS[keys[k]]) { isAd = true; break; }
        }
        if (isAd) {
          obj.splice(j, 1);
        } else {
          stripAds(item, depth + 1);
        }
      }
    }
  } else {
    const okeys = Object.keys(obj);
    for (let m = 0; m < okeys.length; m++) {
      const key = okeys[m];
      if (AD_RENDERERS[key]) { delete obj[key]; continue; }
      if (obj[key] && typeof obj[key] === 'object') stripAds(obj[key], depth + 1);
    }
  }
}

// ── Protocol-level Response Interception ──

/**
 * Check if a URL is a YouTube API endpoint we should intercept.
 */
function _isYtApiUrl(url) {
  return YT_API_INTERCEPT_PATTERNS.some(p => url.includes(p));
}

/**
 * Check if a URL is a YouTube page that may contain embedded ad data.
 */
function _isYtPageUrl(url) {
  try {
    const u = new URL(url);
    if (!isYouTubeDomain(url)) return false;
    const path = u.pathname;
    return YT_PAGE_PATHS.some(p => path === p || path.startsWith(p));
  } catch { return false; }
}

/**
 * Register protocol-level HTTPS interceptor on a session.
 * This catches ALL YouTube API responses and HTML pages, including the very
 * first page load, and strips ad data before the page JS ever sees it.
 *
 * For non-YouTube URLs, requests pass through with zero modification via
 * net.fetch with bypassCustomProtocolHandlers.
 */
function registerProtocolInterceptor(ses) {
  ses.protocol.handle('https', async (request) => {
    const url = request.url;

    // Non-YouTube URLs: pass through, but fix redirect-broken base URLs.
    // Electron's net.fetch silently follows 3xx redirects without updating
    // the document URL, so relative paths break on sites like ReadTheDocs.
    // For HTML GET responses, we detect redirects via Node's native https
    // and inject <base href="finalUrl"> when the URL changed.
    if (!isYouTubeDomain(url)) {
      // Start redirect check in parallel for likely-page URLs (skip known asset extensions)
      const checkRedirect = request.method === 'GET'
        && !/\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|webp|avif|mp[34]|webm|json|xml|wasm|map|pdf)(\?|#|$)/i.test(url);
      const redirectP = checkRedirect ? _resolveRedirectChain(url) : null;

      const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });

      // Only inject <base> into successful HTML responses where we checked for redirect
      if (!redirectP || !response.ok) return response;
      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('html')) return response;

      try {
        const finalUrl = await redirectP;
        if (finalUrl === url) return response;
        // Redirect detected — inject <base> so relative URLs resolve correctly
        const html = await response.text();
        if (/<base\s/i.test(html)) {
          // Page already has a <base> tag, don't double up
          return new Response(html, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
        const baseTag = '<base href="' + finalUrl.replace(/"/g, '&quot;') + '">';
        const patched = /<head([^>]*)>/i.test(html)
          ? html.replace(/<head([^>]*)>/i, '<head$1>' + baseTag)
          : baseTag + html;
        return new Response(patched, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch {
        return net.fetch(request, { bypassCustomProtocolHandlers: true });
      }
    }

    const isApi = _isYtApiUrl(url);
    const isPage = !isApi && _isYtPageUrl(url) && (request.method === 'GET' || request.method === 'HEAD');

    // YouTube URL but not one we need to modify (images, video streams, JS, CSS, etc.)
    if (!isApi && !isPage) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    try {
      const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });

      // Only modify successful responses
      if (!response.ok) return response;

      const contentType = response.headers.get('content-type') || '';

      if (isApi) {
        // JSON API response — parse, strip ads, re-serialize
        if (!contentType.includes('json') && !contentType.includes('protobuf')) {
          return response;
        }
        try {
          const body = await response.text();
          const parsed = JSON.parse(body);
          stripAds(parsed, 0);
          const stripped = JSON.stringify(parsed);
          return new Response(stripped, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch (e) {
          // Not valid JSON (could be protobuf), pass through
          // We already consumed the body, so we can't return the original response.
          // Re-fetch as fallback.
          return net.fetch(request, { bypassCustomProtocolHandlers: true });
        }
      } else if (isPage) {
        // HTML page — strip ad data from embedded JSON blobs
        if (!contentType.includes('html')) return response;
        try {
          const html = await response.text();
          const stripped = stripEmbeddedAdData(html);
          return new Response(stripped, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch (e) {
          return net.fetch(request, { bypassCustomProtocolHandlers: true });
        }
      }

      return response;
    } catch (e) {
      // On any error, pass through
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }
  });
}

/**
 * Strip ad data from embedded JSON in YouTube HTML pages.
 * YouTube embeds ytInitialPlayerResponse and ytInitialData as inline JSON
 * in <script> tags.
 */
function stripEmbeddedAdData(html) {
  html = stripInlineJson(html, 'ytInitialPlayerResponse');
  html = stripInlineJson(html, 'ytInitialData');
  return html;
}

function stripInlineJson(html, varName) {
  const marker = varName + ' = ';
  let idx = html.indexOf(marker);
  while (idx !== -1) {
    const jsonStart = idx + marker.length;
    const jsonEnd = findJsonEnd(html, jsonStart);
    if (jsonEnd > jsonStart) {
      try {
        const jsonStr = html.substring(jsonStart, jsonEnd);
        const parsed = JSON.parse(jsonStr);
        stripAds(parsed, 0);
        const cleaned = JSON.stringify(parsed);
        html = html.substring(0, jsonStart) + cleaned + html.substring(jsonEnd);
      } catch (e) {
        // Malformed JSON, skip
      }
    }
    idx = html.indexOf(marker, jsonStart + 1);
  }
  return html;
}

function findJsonEnd(str, start) {
  if (str[start] !== '{') return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

module.exports = {
  isYouTubeDomain,
  YT_AD_URL_PATTERNS,
  registerProtocolInterceptor,
  stripAds,
};
