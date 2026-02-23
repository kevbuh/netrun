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

function _fetchFavicon(domain) {
  return new Promise((resolve) => {
    const url = `https://${domain}/favicon.ico`;
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : `https://${domain}${res.headers.location}`;
        const mod = loc.startsWith('http://') ? http : https;
        mod.get(loc, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 }, (res2) => {
          if (res2.statusCode !== 200) { res2.resume(); return resolve(null); }
          const chunks = [];
          res2.on('data', c => chunks.push(c));
          res2.on('end', () => resolve({ data: Buffer.concat(chunks), contentType: res2.headers['content-type'] || 'image/x-icon' }));
          res2.on('error', () => resolve(null));
        }).on('error', () => resolve(null));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ data: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/x-icon' }));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
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
