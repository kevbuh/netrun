// adblock.js — Ad blocker engine: filter list download, engine init/serialize/deserialize
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { FilterSet, Engine } = require('adblock-rs');

const ADBLOCK_FILTER_LISTS = [
  ['EasyList', 'https://easylist.to/easylist/easylist.txt'],
  ['EasyPrivacy', 'https://easylist.to/easylist/easyprivacy.txt'],
  ['uBlock Filters', 'https://ublockorigin.github.io/uAssets/filters/filters.txt'],
  ['uBlock Badware', 'https://ublockorigin.github.io/uAssets/filters/badware.txt'],
  ['uBlock Privacy', 'https://ublockorigin.github.io/uAssets/filters/privacy.txt'],
  ['uBlock Annoyances', 'https://ublockorigin.github.io/uAssets/filters/annoyances-others.txt'],
  ['Peter Lowe\'s', 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext'],
  ['Fanboy Annoyances', 'https://secure.fanboy.co.nz/fanboy-annoyance.txt'],
  ['HideYTShorts', 'https://raw.githubusercontent.com/i5heu/ublock-hide-yt-shorts/master/list.txt'],
];
const ADBLOCK_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let _adblockEngine = null;
let _adblockEnabled = true;
const _blockedCounts = {};
const _blockedDetails = {}; // wcId → { domain: count }

function _fetchText(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http://') ? http : https;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return _fetchText(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function _enginePath(app) { return path.join(app.getPath('userData'), 'adblock_engine.dat'); }
function _metaPath(app) { return path.join(app.getPath('userData'), 'adblock_meta.json'); }

async function _downloadAndBuildEngine(app) {
  const filterSet = new FilterSet();
  let totalRules = 0;
  const listNames = [];

  for (const [name, url] of ADBLOCK_FILTER_LISTS) {
    try {
      const text = await _fetchText(url);
      const rules = text.split('\n').filter(l => l.trim() && !l.startsWith('!'));
      filterSet.addFilters(rules);
      totalRules += rules.length;
      listNames.push(name);
      console.log(`[adblock] Loaded ${name}: ~${rules.length} rules`);
    } catch (e) {
      console.error(`[adblock] Failed to download ${name} (${url}):`, e.message);
    }
  }

  _adblockEngine = new Engine(filterSet);
  try {
    const buf = _adblockEngine.serialize();
    fs.writeFileSync(_enginePath(app), Buffer.from(buf));
    console.log('[adblock] Serialized engine to disk');
  } catch (e) {
    console.error('[adblock] Failed to serialize engine:', e.message);
  }

  const meta = { lists: listNames, ruleCount: totalRules, updatedAt: Date.now() };
  try { fs.writeFileSync(_metaPath(app), JSON.stringify(meta, null, 2)); } catch {}
  return meta;
}

function _getEngineStats(app) {
  try {
    const data = fs.readFileSync(_metaPath(app), 'utf8');
    return JSON.parse(data);
  } catch {
    return { lists: [], ruleCount: 0, updatedAt: null };
  }
}

async function initAdblock(app) {
  const enginePath = _enginePath(app);
  let needsRefresh = true;
  if (fs.existsSync(enginePath)) {
    try {
      const buf = fs.readFileSync(enginePath);
      _adblockEngine = new Engine(new FilterSet());
      _adblockEngine.deserialize(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      console.log('[adblock] Loaded engine from disk');
      const stats = _getEngineStats(app);
      if (stats.updatedAt && (Date.now() - stats.updatedAt) < ADBLOCK_REFRESH_INTERVAL_MS) {
        needsRefresh = false;
      }
    } catch (e) {
      console.error('[adblock] Failed to deserialize engine:', e.message);
    }
  }
  if (needsRefresh) {
    if (_adblockEngine) {
      setTimeout(async () => {
        try {
          await _downloadAndBuildEngine(app);
          console.log('[adblock] Background refresh complete');
        } catch (e) {
          console.error('[adblock] Background refresh failed:', e.message);
        }
      }, 5000);
    } else {
      try {
        await _downloadAndBuildEngine(app);
      } catch (e) {
        console.error('[adblock] Failed to build engine:', e.message);
      }
    }
  }
  setInterval(async () => {
    try {
      await _downloadAndBuildEngine(app);
      console.log('[adblock] Scheduled refresh complete');
    } catch (e) {
      console.error('[adblock] Scheduled refresh failed:', e.message);
    }
  }, ADBLOCK_REFRESH_INTERVAL_MS);
}

function _mapResourceType(rt) {
  const map = {
    mainFrame: 'document', subFrame: 'subdocument', stylesheet: 'stylesheet',
    script: 'script', image: 'image', font: 'font', object: 'object',
    xhr: 'xmlhttprequest', ping: 'ping', media: 'media',
  };
  return map[rt] || 'other';
}

function getEngine() { return _adblockEngine; }
function isEnabled() { return _adblockEnabled; }
function setEnabled(on) { _adblockEnabled = !!on; }
function getBlockedCounts() { return _blockedCounts; }
function getBlockedDetails() { return _blockedDetails; }

module.exports = {
  initAdblock,
  getEngine,
  isEnabled,
  setEnabled,
  getBlockedCounts,
  getBlockedDetails,
  _getEngineStats,
  _downloadAndBuildEngine,
  _mapResourceType,
  _trackDetail: function(map, wcId, key) {
    if (!map[wcId]) map[wcId] = {};
    map[wcId][key] = (map[wcId][key] || 0) + 1;
  },
};
