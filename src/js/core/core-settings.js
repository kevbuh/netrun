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
  // Sync = true means synced across devices via the auth system

  // Appearance
  define('theme', { default: 'clear', sync: true });
  define('accentColor', { default: '#b4451a', sync: true });
  define('editorTheme', { default: 'auto', sync: true });
  define('aetherColor', { default: 'match', sync: true });
  define('iconSize', { default: 'medium', sync: true });
  define('spinner', { default: 'squareCorners', sync: true });
  define('browseTabLayout', { default: 'island', sync: false });
  define('customCursor', { default: 'on', sync: false });

  // Sidebar
  define('sidebarOrder', { default: null, sync: true });
  define('hiddenSidebarIcons', { default: '[]', sync: true });
  define('browseBarOrder', { default: null, sync: true });
  define('browseBarOverflow', { default: '[]', sync: false });

  // Sounds
  define('clickSound', { default: 'off', sync: true });
  define('clickSoundType', { default: 'thud', sync: true });
  define('clickAether', { default: 'on', sync: true });
  define('rainNoiseType', { default: 'rain', sync: true });
  define('rainVolume', { default: '0.3', sync: true });
  define('rainFreq', { default: '0', sync: true });
  define('rainOn', { default: '0', sync: false });
  define('rainSidebarVisible', { default: null, sync: true });

  // Read Aloud
  define('ttsSpeed', { default: '1', sync: false });
  define('ttsHighlight', { default: 'true', sync: false });

  // Feed & Quality
  define('feedSources', { default: null, sync: true });
  define('customFeeds', { default: '[]', sync: true });
  define('feedNotifications', { default: '[]', sync: true });
  define('feedNotifSources', { default: '[]', sync: true });
  define('qualityFilter', { default: 'on', sync: true });
  define('qualityPrompt', { default: null, sync: true });
  define('qualityThreshold', { default: '30', sync: true });
  define('qualityCache', { default: '{}', sync: true });
  define('qualityTestTitles', { default: '[]', sync: true });
  define('qualityBypass', { default: '[]', sync: true });
  define('blockedWords', { default: '[]', sync: true });
  define('interestProfile', { default: null, sync: true });
  define('fyWeightBase', { default: '0.7', sync: true });
  define('fyWeightAffinity', { default: '0.3', sync: true });
  define('fyWeightRecency', { default: '1', sync: true });
  define('maxPerCategoryRun', { default: '3', sync: true });

  // Posts
  define('hiddenPosts', { default: '[]', sync: true });
  define('savedPosts', { default: '{}', sync: true });
  define('readPosts', { default: '[]', sync: true });
  define('paperRatings', { default: '{}', sync: true });
  define('seenPostLinks', { default: null, sync: true });
  define('repostedLinks', { default: null, sync: true });

  // Search & History
  define('searchHistory', { default: '[]', sync: true });
  define('browseHistory', { default: '[]', sync: true });
  define('webSearchHistory', { default: '[]', sync: true });

  // AI Models
  define('chatModel', { default: 'qwen2.5:3b', sync: true });
  define('chatTools', { default: 'on', sync: true });
  define('chatThinking', { default: 'off', sync: false });
  define('visionModel', { default: 'qwen3-vl:8b', sync: false });
  define('summaryModel', { default: 'qwen3:0.6b', sync: false });
  define('annotateModel', { default: 'qwen3:8b', sync: false });
  define('ocrModel', { default: 'glm-ocr', sync: false });
  define('insightsAllowHeuristics', { default: null, sync: true });
  define('smartHighlights', { default: null, sync: true });

  // Browser
  define('adBlockEnabled', { default: 'true', sync: true });
  define('urlBarSections', { default: null, sync: true });
  define('urlShorten', { default: 'true', sync: false });
  define('adaptiveUrlBar', { default: 'on', sync: false });
  define('hideYTShorts', { default: 'false', sync: false });
  define('doomScrollEnabled', { default: 'true', sync: false });
  define('doomScrollSites', { default: '[]', sync: false });
  define('sitePermissions', { default: '{}', sync: false });
  define('browseClosedTabs', { default: '[]', sync: false });
  define('browseDownloads', { default: '[]', sync: false });
  define('browseDownloadsLastSeen', { default: '0', sync: false });

  // Annotations/Insights
  define('insightEnabled', { default: 'on', sync: false });
  define('insightOcr', { default: 'on', sync: false });
  define('insightCache', { default: '{}', sync: false });

  // Panel
  define('panelTabComplete', { default: 'on', sync: false });
  define('voiceAutoSend', { default: null, sync: false });
  define('chatThreads', { default: null, sync: true });

  // Profile
  define('userName', { default: '', sync: true });

  // Pixel Pet
  define('pixelPet', { default: 'off', sync: true });
  define('pixelPetType', { default: 'cat', sync: true });
  define('pixelPetMode', { default: 'free', sync: true });

  // Navigation state (local only)
  define('_lastActiveView', { default: 'feed', sync: false });
  define('_navHistory', { default: '[]', sync: false });
  define('_navForward', { default: '[]', sync: false });
  define('_browseReturnView', { default: null, sync: false });
  define('lastHash', { default: null, sync: false });
  define('universalPanelVisible', { default: 'true', sync: false });
  define('universalPanelWidth', { default: '280', sync: false });
  define('settingsSection', { default: 'profile', sync: false });

  // Layout
  define('downloadBannerDismissed', { default: 'false', sync: false });


  // Dashboard
  define('daySummaryCache', { default: '{}', sync: false });
  define('devPanelSection', { default: 'overview', sync: false });

  // Experiments
  define('expSidebarWidth', { default: null, sync: false });
  define('expSidebarCollapsed', { default: '0', sync: false });

  // Terminal
  define('terminalState', { default: null, sync: false });

  // Whiteboard
  define('whiteboardBoards', { default: '[]', sync: false });

  // Neuralook
  define('nlRefinementHistory', { default: '[]', sync: false });

  // Debug
  define('debugLogs', { default: 'false', sync: false });

  // Achievements
  define('ach_its_alive', { default: null, sync: false });
  define('ach_gaze_master', { default: null, sync: false });
  define('ach_curator', { default: null, sync: false });
  define('ach_bookworm', { default: null, sync: false });
  define('ach_critic', { default: null, sync: false });
  define('ach_model_switch', { default: null, sync: false });
  define('ach_pixel_parent', { default: null, sync: false });

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
