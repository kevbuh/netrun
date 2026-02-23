// privacy.js — Tracking parameter stripping, HTTPS-only, third-party cookie blocking, DoH

let _trackingStripEnabled = true;
const _strippedCounts = {};
const _strippedDetails = {}; // wcId → { param: count }

let _httpsOnlyEnabled = true;
const _httpsUpgradeCounts = {};

let _cookieBlockEnabled = true;
const _cookieBlockedCounts = {};
const _cookieBlockedDetails = {}; // wcId → { domain: count }

function _trackDetail(map, wcId, key) {
  if (!map[wcId]) map[wcId] = {};
  map[wcId][key] = (map[wcId][key] || 0) + 1;
}

const _TRACKING_PARAMS = new Set([
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id',
  'fbclid','gclid','gclsrc','dclid','gbraid','wbraid',
  'mc_eid','mc_cid','twclid','msclkid',
  '_hsenc','_hsmi','igshid',
  'si','feature',
  'oly_enc_id','oly_anon_id','__s','vero_id',
  '_bta_tid','_bta_c','wickedid','mkt_tok',
]);
const _TRACKING_PARAM_PREFIXES = ['hsa_', 'ref_'];

const _MULTI_PART_TLDS = new Set(['co.uk','co.jp','co.kr','com.au','com.br','co.nz','co.in','org.uk','net.au']);
function extractRootDomain(hostname) {
  const h = (hostname || '').toLowerCase().replace(/^\.+/, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  return (_MULTI_PART_TLDS.has(last2) && parts.length >= 3) ? parts.slice(-3).join('.') : last2;
}

const DOH_PROVIDERS = {
  cloudflare: 'https://1.1.1.1/dns-query',
  quad9:      'https://9.9.9.9/dns-query',
  mullvad:    'https://194.242.2.4/dns-query',
};

function applyDoH(app, enabled, provider) {
  const server = DOH_PROVIDERS[provider] || DOH_PROVIDERS.cloudflare;
  app.configureHostResolver({
    secureDnsMode: enabled ? 'secure' : 'off',
    secureDnsServers: enabled ? [server] : [],
  });
}

// ── Request interceptor: HTTPS upgrade + tracking param strip ──
function handleBeforeRequest(details) {
  const url = details.url;
  const wcId = details.webContentsId;

  // 1. HTTPS-Only: upgrade http → https for main-frame navigations
  if (_httpsOnlyEnabled && details.resourceType === 'mainFrame' && url.startsWith('http://')) {
    try {
      const u = new URL(url);
      const host = u.hostname;
      if (host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.local')) {
        u.protocol = 'https:';
        _httpsUpgradeCounts[wcId] = (_httpsUpgradeCounts[wcId] || 0) + 1;
        return { redirectURL: u.toString() };
      }
    } catch {}
  }

  // 2. Tracking param strip: remove tracking params from main-frame URLs
  if (_trackingStripEnabled && details.resourceType === 'mainFrame') {
    try {
      const u = new URL(url);
      if (u.search) {
        const params = u.searchParams;
        const toDelete = [];
        for (const key of params.keys()) {
          if (_TRACKING_PARAMS.has(key)) { toDelete.push(key); continue; }
          for (const prefix of _TRACKING_PARAM_PREFIXES) {
            if (key.startsWith(prefix)) { toDelete.push(key); break; }
          }
        }
        if (toDelete.length > 0) {
          for (const k of toDelete) params.delete(k);
          const clean = u.toString();
          if (clean !== url) {
            _strippedCounts[wcId] = (_strippedCounts[wcId] || 0) + toDelete.length;
            for (const k of toDelete) _trackDetail(_strippedDetails, wcId, k);
            return { redirectURL: clean };
          }
        }
      }
    } catch {}
  }

  return null; // no action
}

// ── Response interceptor: third-party cookie blocking ──
function handleHeadersReceived(details) {
  if (!_cookieBlockEnabled || !details.responseHeaders) return null;
  const wcId = details.webContentsId;
  let pageDomain = '';
  try {
    const ref = details.referrer || details.frame?.url || '';
    if (ref) pageDomain = extractRootDomain(new URL(ref).hostname);
  } catch {}
  if (!pageDomain) return null;

  let cookieDomain = '';
  try { cookieDomain = extractRootDomain(new URL(details.url).hostname); } catch {}
  if (!cookieDomain || cookieDomain === pageDomain) return null;

  const headers = Object.assign({}, details.responseHeaders);
  const cookieKeys = Object.keys(headers).filter(k => k.toLowerCase() === 'set-cookie');
  if (cookieKeys.length === 0) return null;

  let blocked = 0;
  for (const key of cookieKeys) {
    blocked += (headers[key] || []).length;
    delete headers[key];
  }
  if (blocked > 0) {
    _cookieBlockedCounts[wcId] = (_cookieBlockedCounts[wcId] || 0) + blocked;
    _trackDetail(_cookieBlockedDetails, wcId, cookieDomain);
  }
  return { responseHeaders: headers };
}

// ── Accessors ──
function isTrackingStripEnabled() { return _trackingStripEnabled; }
function setTrackingStripEnabled(on) { _trackingStripEnabled = !!on; }
function getStrippedCount(wcId) { return _strippedCounts[wcId] || 0; }
function resetStrippedCount(wcId) { _strippedCounts[wcId] = 0; delete _strippedDetails[wcId]; }

function isHttpsOnlyEnabled() { return _httpsOnlyEnabled; }
function setHttpsOnlyEnabled(on) { _httpsOnlyEnabled = !!on; }
function getHttpsUpgradeCount(wcId) { return _httpsUpgradeCounts[wcId] || 0; }
function resetHttpsUpgradeCount(wcId) { _httpsUpgradeCounts[wcId] = 0; }

function isCookieBlockEnabled() { return _cookieBlockEnabled; }
function setCookieBlockEnabled(on) { _cookieBlockEnabled = !!on; }
function getCookieBlockedCount(wcId) { return _cookieBlockedCounts[wcId] || 0; }
function resetCookieBlockedCount(wcId) { _cookieBlockedCounts[wcId] = 0; delete _cookieBlockedDetails[wcId]; }

function getPrivacyDetails(wcId) {
  return {
    trackers: _strippedDetails[wcId] || {},
    cookies: _cookieBlockedDetails[wcId] || {},
  };
}

function getPrivacyStats() {
  let stripped = 0, upgraded = 0, cookies = 0;
  for (const k in _strippedCounts) stripped += _strippedCounts[k] || 0;
  for (const k in _httpsUpgradeCounts) upgraded += _httpsUpgradeCounts[k] || 0;
  for (const k in _cookieBlockedCounts) cookies += _cookieBlockedCounts[k] || 0;
  return { stripped, upgraded, cookies };
}

module.exports = {
  applyDoH,
  extractRootDomain,
  handleBeforeRequest,
  handleHeadersReceived,
  isTrackingStripEnabled, setTrackingStripEnabled,
  getStrippedCount, resetStrippedCount,
  isHttpsOnlyEnabled, setHttpsOnlyEnabled,
  getHttpsUpgradeCount, resetHttpsUpgradeCount,
  isCookieBlockEnabled, setCookieBlockEnabled,
  getCookieBlockedCount, resetCookieBlockedCount,
  getPrivacyDetails, getPrivacyStats,
  _trackDetail,
};
