// ─── Unified Settings Registry ────────────────────────────────
// Central source of truth for all app settings.
// Layers: memory cache → localStorage (write-through) → SQLite (durable)

var Settings = (function() {
  var _defs = {};      // { key: { default, sync } }
  var _cache = {};     // in-memory cache
  var _listeners = {}; // { key: [fn, ...] }
  var _ready = false;

  function define(key, opts) {
    opts = opts || {};
    _defs[key] = { default: opts.default !== undefined ? opts.default : null, sync: !!opts.sync };
    // Hydrate cache from localStorage immediately
    var stored = localStorage.getItem(key);
    if (stored !== null) {
      _cache[key] = stored;
    }
  }

  function get(key) {
    // Check cache first
    if (key in _cache) return _cache[key];
    // Check localStorage
    var stored = localStorage.getItem(key);
    if (stored !== null) {
      _cache[key] = stored;
      return stored;
    }
    // Return default if defined
    if (key in _defs) return _defs[key].default;
    return null;
  }

  // Get parsed JSON value (replaces getLS pattern)
  function getJSON(key, fallback) {
    var raw = get(key);
    if (raw === null || raw === undefined) return fallback !== undefined ? fallback : null;
    try { return JSON.parse(raw); } catch(e) { return fallback !== undefined ? fallback : null; }
  }

  function set(key, value) {
    var strVal = (typeof value === 'string') ? value : JSON.stringify(value);
    var old = _cache[key];
    _cache[key] = strVal;
    // Write-through to localStorage
    localStorage.setItem(key, strVal);
    // Write-through to SQLite (fire-and-forget)
    if (window.electronAPI && window.electronAPI.dbQuery) {
      window.electronAPI.dbQuery('settings-set', key, strVal).catch(function() {});
    }
    // Notify listeners
    if (_listeners[key]) {
      _listeners[key].forEach(function(fn) { try { fn(strVal, old); } catch(e) { console.error('[Settings] listener error:', e); } });
    }
  }

  // Set parsed JSON value (replaces setLS pattern)
  function setJSON(key, val) {
    set(key, JSON.stringify(val));
  }

  function remove(key) {
    delete _cache[key];
    localStorage.removeItem(key);
    if (window.electronAPI && window.electronAPI.dbQuery) {
      window.electronAPI.dbQuery('settings-delete', key).catch(function() {});
    }
  }

  function on(key, fn) {
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(fn);
    return function() {
      _listeners[key] = _listeners[key].filter(function(f) { return f !== fn; });
    };
  }

  // Async init: hydrate from SQLite, backfill anything not yet in localStorage
  async function init() {
    if (!window.electronAPI || !window.electronAPI.dbQuery) return;
    try {
      var rows = await window.electronAPI.dbQuery('settings-all');
      if (rows && rows.length) {
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          // SQLite is source of truth — only backfill if localStorage is empty
          if (localStorage.getItem(row.key) === null) {
            localStorage.setItem(row.key, row.value);
          }
          if (!(row.key in _cache)) {
            _cache[row.key] = row.value;
          }
        }
      }
      // Push any localStorage-only values into SQLite
      for (var key in _defs) {
        var val = localStorage.getItem(key);
        if (val !== null) {
          window.electronAPI.dbQuery('settings-set', key, val).catch(function() {});
        }
      }
      _ready = true;
    } catch(e) {
      console.warn('[Settings] init failed:', e);
    }
  }

  function getSyncKeys() {
    var keys = [];
    for (var k in _defs) {
      if (_defs[k].sync) keys.push(k);
    }
    return keys;
  }

  function getAll() {
    var result = {};
    for (var k in _defs) {
      result[k] = get(k);
    }
    // Also include any cached keys not in defs (dynamic keys)
    for (var c in _cache) {
      if (!(c in result)) result[c] = _cache[c];
    }
    return result;
  }

  function isDefined(key) {
    return key in _defs;
  }

  function getDefault(key) {
    return _defs[key] ? _defs[key].default : null;
  }

  // ── Setting Definitions ──────────────────────────────────
  // @persisted = sync:true  — synced across devices via the auth system
  // @local     = sync:false — device-local only, never sent to server

  // Appearance
  define('theme',          { default: 'clear',         sync: true  }); // @persisted
  define('accentColor',    { default: '#b4451a',        sync: true  }); // @persisted
  define('editorTheme',    { default: 'auto',           sync: true  }); // @persisted
  define('aetherColor',    { default: 'match',          sync: true  }); // @persisted
  define('iconSize',       { default: 'medium',         sync: true  }); // @persisted
  define('spinner',        { default: 'squareCorners',  sync: true  }); // @persisted
  define('browseTabLayout',{ default: 'island',         sync: false }); // @local
  define('customCursor',   { default: 'on',             sync: false }); // @local

  // Sidebar
  define('sidebarOrder',       { default: null,  sync: true  }); // @persisted
  define('hiddenSidebarIcons', { default: '[]',  sync: true  }); // @persisted
  define('browseBarOrder',     { default: null,  sync: true  }); // @persisted
  define('browseBarOverflow',  { default: '[]',  sync: false }); // @local

  // Sounds
  define('clickSound',         { default: 'off',   sync: true  }); // @persisted
  define('clickSoundType',     { default: 'thud',  sync: true  }); // @persisted
  define('clickAether',        { default: 'on',    sync: true  }); // @persisted
  define('rainNoiseType',      { default: 'rain',  sync: true  }); // @persisted
  define('rainVolume',         { default: '0.3',   sync: true  }); // @persisted
  define('rainFreq',           { default: '0',     sync: true  }); // @persisted
  define('rainOn',             { default: '0',     sync: false }); // @local
  define('rainSidebarVisible', { default: null,    sync: true  }); // @persisted

  // Read Aloud
  define('ttsSpeed',     { default: '1',    sync: false }); // @local
  define('ttsHighlight', { default: 'true', sync: false }); // @local

  // Feed
  define('feedSources',       { default: null,  sync: true }); // @persisted
  define('customFeeds',       { default: '[]',  sync: true }); // @persisted
  define('feedNotifications', { default: '[]',  sync: true }); // @persisted
  define('feedNotifSources',  { default: '[]',  sync: true }); // @persisted
  define('blockedWords',      { default: '[]',  sync: true }); // @persisted
  define('interestProfile',   { default: null,  sync: true }); // @persisted
  define('fyWeightBase',      { default: '0.7', sync: true }); // @persisted
  define('fyWeightAffinity',  { default: '0.3', sync: true }); // @persisted
  define('fyWeightRecency',   { default: '1',   sync: true }); // @persisted
  define('maxPerCategoryRun', { default: '3',   sync: true }); // @persisted

  // Posts
  define('hiddenPosts',   { default: '[]',  sync: true }); // @persisted
  define('savedPosts',    { default: '{}',  sync: true }); // @persisted
  define('readPosts',     { default: '[]',  sync: true }); // @persisted
  define('paperRatings',  { default: '{}',  sync: true }); // @persisted
  define('seenPostLinks', { default: null,  sync: true }); // @persisted
  define('repostedLinks', { default: null,  sync: true }); // @persisted

  // Search & History
  define('searchHistory',    { default: '[]', sync: true }); // @persisted
  define('browseHistory',    { default: '[]', sync: true }); // @persisted
  define('webSearchHistory', { default: '[]', sync: true }); // @persisted

  // AI Models
  define('chatModel',              { default: 'qwen2.5:3b',  sync: true  }); // @persisted
  define('chatTools',              { default: 'on',           sync: true  }); // @persisted
  define('chatThinking',           { default: 'off',          sync: false }); // @local
  define('visionModel',            { default: 'qwen3-vl:8b',  sync: false }); // @local
  define('summaryModel',           { default: 'qwen3:0.6b',   sync: false }); // @local
  define('annotateModel',          { default: 'qwen3:8b',     sync: false }); // @local
  define('ocrModel',               { default: 'glm-ocr',      sync: false }); // @local
  define('insightsAllowHeuristics',{ default: null,           sync: true  }); // @persisted
  define('smartHighlights',        { default: null,           sync: true  }); // @persisted

  // Browser
  define('adBlockEnabled',          { default: 'true', sync: true  }); // @persisted
  define('urlBarSections',          { default: null,   sync: true  }); // @persisted
  define('urlShorten',              { default: 'true', sync: false }); // @local
  define('adaptiveUrlBar',          { default: 'on',   sync: false }); // @local
  define('hideYTShorts',            { default: 'false',sync: false }); // @local
  define('doomScrollEnabled',       { default: 'true', sync: false }); // @local
  define('doomScrollSites',         { default: '[]',   sync: false }); // @local
  define('sitePermissions',         { default: '{}',   sync: false }); // @local
  define('browseClosedTabs',        { default: '[]',   sync: false }); // @local
  define('browseDownloads',         { default: '[]',   sync: false }); // @local
  define('browseDownloadsLastSeen', { default: '0',    sync: false }); // @local

  // Annotations/Insights
  define('insightEnabled', { default: 'on', sync: false }); // @local
  define('insightOcr',     { default: 'on', sync: false }); // @local
  define('insightCache',   { default: '{}', sync: false }); // @local

  // Panel
  define('panelTabComplete', { default: 'on', sync: false }); // @local
  define('voiceAutoSend',    { default: null, sync: false }); // @local
  define('chatThreads',      { default: null, sync: true  }); // @persisted

  // Profile
  define('userName', { default: '', sync: true }); // @persisted

  // Pixel Pet
  define('pixelPet',     { default: 'off',  sync: true }); // @persisted
  define('pixelPetType', { default: 'cat',  sync: true }); // @persisted
  define('pixelPetMode', { default: 'free', sync: true }); // @persisted

  // Navigation state (@local — runtime routing, never synced)
  define('_lastActiveView',     { default: 'feed',    sync: false }); // @local
  define('_navHistory',         { default: '[]',      sync: false }); // @local
  define('_navForward',         { default: '[]',      sync: false }); // @local
  define('_browseReturnView',   { default: null,      sync: false }); // @local
  define('lastHash',            { default: null,      sync: false }); // @local
  define('universalPanelVisible',{ default: 'true',   sync: false }); // @local
  define('universalPanelWidth', { default: '280',     sync: false }); // @local
  define('settingsSection',     { default: 'profile', sync: false }); // @local

  // Layout
  define('downloadBannerDismissed', { default: 'false', sync: false }); // @local

  // Dashboard
  define('daySummaryCache', { default: '{}',       sync: false }); // @local
  define('devPanelSection', { default: 'overview', sync: false }); // @local

  // Experiments
  define('expSidebarWidth',     { default: null, sync: false }); // @local
  define('expSidebarCollapsed', { default: '0',  sync: false }); // @local

  // Terminal
  define('terminalState', { default: null, sync: false }); // @local

  // Whiteboard
  define('whiteboardBoards', { default: '[]', sync: false }); // @local

  // Neuralook
  define('nlRefinementHistory', { default: '[]', sync: false }); // @local

  // Debug
  define('debugLogs', { default: 'false', sync: false }); // @local

  // Achievements (@local — unlocked per-device, not synced)
  define('ach_its_alive',    { default: null, sync: false }); // @local
  define('ach_gaze_master',  { default: null, sync: false }); // @local
  define('ach_curator',      { default: null, sync: false }); // @local
  define('ach_bookworm',     { default: null, sync: false }); // @local
  define('ach_critic',       { default: null, sync: false }); // @local
  define('ach_model_switch', { default: null, sync: false }); // @local
  define('ach_pixel_parent', { default: null, sync: false }); // @local

  return {
    define: define,
    get: get,
    getJSON: getJSON,
    set: set,
    setJSON: setJSON,
    remove: remove,
    on: on,
    init: init,
    getSyncKeys: getSyncKeys,
    getAll: getAll,
    isDefined: isDefined,
    getDefault: getDefault
  };
})();
