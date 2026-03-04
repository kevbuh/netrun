// favicon.js — Favicon proxy cache (privacy: fetch directly from sites, never Google)
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const _faviconCache = new Map(); // domain → { data: Buffer, contentType: string } | 'pending' | 'missing'
const _FAVICON_1PX_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualzQAAAABJRU5ErkJggg==', 'base64');

let _cacheDir = null;

function init(userDataPath) {
  _cacheDir = path.join(userDataPath, 'favicons');
}

function _fetchUrl(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('http://') ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        _fetchUrl(loc).then(resolve);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ data: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'application/octet-stream' }));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function _isImageContentType(ct) {
  return ct && (ct.startsWith('image/') || ct === 'application/octet-stream');
}

function _parseIconHref(html, domain) {
  // Match <link rel="icon" ... href="..."> or <link rel="shortcut icon" ... href="...">
  const re = /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["'][^>]*>|<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["'][^>]*>/gi;
  let match;
  const hrefs = [];
  while ((match = re.exec(html)) !== null) {
    hrefs.push(match[1] || match[2]);
  }
  if (!hrefs.length) return null;
  // Prefer 32x32 or smallest reasonable size; fall back to first
  const best = hrefs.find(h => h.includes('32')) || hrefs[0];
  if (best.startsWith('http')) return best;
  if (best.startsWith('//')) return 'https:' + best;
  return `https://${domain}${best.startsWith('/') ? '' : '/'}${best}`;
}

async function _fetchFavicon(domain) {
  // 1. Try /favicon.ico
  const icoResult = await _fetchUrl(`https://${domain}/favicon.ico`);
  if (icoResult && icoResult.data.length > 0 && _isImageContentType(icoResult.contentType)) {
    return { data: icoResult.data, contentType: icoResult.contentType };
  }
  // 2. Fetch HTML and parse <link rel="icon"> tags
  const htmlResult = await _fetchUrl(`https://${domain}/`);
  if (!htmlResult) return null;
  const html = htmlResult.data.toString('utf-8').slice(0, 50000);
  const iconUrl = _parseIconHref(html, domain);
  if (!iconUrl) return null;
  const iconResult = await _fetchUrl(iconUrl);
  if (iconResult && iconResult.data.length > 0 && _isImageContentType(iconResult.contentType)) {
    return { data: iconResult.data, contentType: iconResult.contentType };
  }
  return null;
}

async function serveFavicon(domain, res) {
  const safeDomain = domain.replace(/[^a-zA-Z0-9.\-]/g, '');
  if (!safeDomain || safeDomain.length > 253) {
    res.writeHead(400);
    res.end('Bad domain');
    return;
  }

  // Check memory cache
  const cached = _faviconCache.get(safeDomain);
  if (cached === 'missing') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    res.end(_FAVICON_1PX_PNG);
    return;
  }
  if (cached && cached !== 'pending') {
    res.writeHead(200, { 'Content-Type': cached.contentType, 'Cache-Control': 'public, max-age=86400' });
    res.end(cached.data);
    return;
  }

  // Check disk cache
  const cachePath = path.join(_cacheDir, safeDomain + '.ico');
  if (fs.existsSync(cachePath)) {
    const data = fs.readFileSync(cachePath);
    const entry = { data, contentType: 'image/x-icon' };
    _faviconCache.set(safeDomain, entry);
    res.writeHead(200, { 'Content-Type': entry.contentType, 'Cache-Control': 'public, max-age=86400' });
    res.end(entry.data);
    return;
  }

  // Fetch from site
  _faviconCache.set(safeDomain, 'pending');
  const result = await _fetchFavicon(safeDomain);
  if (result && result.data.length > 0 && result.data.length < 500000) {
    _faviconCache.set(safeDomain, result);
    try {
      if (!fs.existsSync(_cacheDir)) fs.mkdirSync(_cacheDir, { recursive: true });
      fs.writeFileSync(cachePath, result.data);
    } catch {}
    res.writeHead(200, { 'Content-Type': result.contentType, 'Cache-Control': 'public, max-age=86400' });
    res.end(result.data);
  } else {
    _faviconCache.set(safeDomain, 'missing');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
    res.end(_FAVICON_1PX_PNG);
  }
}

module.exports = { init, serveFavicon };
