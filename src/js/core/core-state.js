// core-state.js — Global state for core module
// All state variables used across core modules
//
// State variable conventions:
//   @settings — backed by Settings.get/set; no local var needed (read Settings directly)
//   @signal   — AetherUI State() reactive signal; access via .value
//   @runtime  — ephemeral in-memory state; plain var, not persisted
//   @const    — set once at init, never changes

// ── SVG assets ──
var _ELL_SVG = null;  // @const — set in _initCoreState()

// ── Link preview ──
var _linkPreviewEl = null;
var _linkPreviewTimer = 0;

// ── Pill stack ──
var _pillStack = [];
var _PILL_GAP = 8;
var _PILL_BOTTOM = 20;

// ── Annotations ──
var _customAnnotationCategories = [];

// ── Dynamic Island ──
var _islandActivities = null;  // @signal — set in _initCoreState()
var _islandDismissTimers = {};  // { id: timeoutId }
var _islandWaveformBars = '<span class="island-waveform"><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span></span>';
var _islandAudioBars = '<span class="island-waveform island-waveform-anim"><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span></span>';
var _islandResizeTimer = null;

// ── Audio ──
var _audioUnifiedState = null;  // @signal — set in _initCoreState()
var _ttsSpeeds = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

// ── Layout ──
let _boundsCache = null;

// ── Spinners ──
let _spinnerData = null;
let _spinnerNames = [];
let _spinnerInterval = null;

// ── Views ── (@settings — backed by Settings.get('_lastActiveView'))
const _sidebarToView = { 'sb-home': 'feed', 'sb-dashboard': 'dashboard', 'sb-browse': 'browse', 'sb-settings': 'settings', 'sb-neuralook': 'neuralook' };
// ── Sidebar navigation ──
let _sidebarFocused = false;
let _sidebarSelectedIndex = -1;
var _sidebarNavClicking = false;

// ── Lazy images ──
let _lazyImageObserver = null;

// ── Feed catalog ──
const ARXIV_LOGO_INLINE = '<img class="h-3.5 w-auto opacity-50 inline-block" src="/arxiv-logomark-small@2x.png" alt="arXiv" />';
const RSS_LOGO_INLINE = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#f90" width="256" height="256" rx="24"/><circle cx="68" cy="189" r="28" fill="#fff"/><path d="M40 120a108 108 0 01108 108h-36a72 72 0 00-72-72v-36z" fill="#fff"/><path d="M40 56a172 172 0 01172 172h-36A136 136 0 0076 92V56h-36z" fill="#fff"/></svg>';
const SUBSTACK_LOGO_INLINE = '<svg class="h-3.5 w-auto inline-block" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.54 6.42H1.46V4.2h21.08v2.22zM1.46 9.26h21.08V7.04H1.46v2.22zM22.54 12.1H1.46v9.52l10.54-5.87 10.54 5.87V12.1z" fill="#FF6719"/></svg>';

// ── Window manager ──
let _wmMode = 'fullscreen';   // 'tiling' | 'fullscreen'
let _wmFocusIndex = 0;
let _wmPreviews = {};          // { viewKey: 'data:image/png;base64,...' }
const _wmDefaultOrder = ['dashboard','feed','browse','neuralook','dev','settings'];
let _wmLastNavTime = 0;

// ── User search ──
let _userSearchDebounce = null;

// ── Navigation ──
let _prevRouteHash = ''; // the hash before the current route
let _currentRouteHash = ''; // the current route hash
let _navHistory = Settings.getJSON('_navHistory', []);
let _navForward = Settings.getJSON('_navForward', []);
let _navNavigating = false; // guard to prevent push while navigating back/forward

// ── Guest mode ──
let _guestMode = sessionStorage.getItem('_guestMode') === 'true';

// ── Auth ──
let _authToken = localStorage.getItem('authToken') || null;
let _authUserInfo = JSON.parse(localStorage.getItem('authUserInfo') || 'null');

// Auth headers helper (used by api.js)
function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_authToken) h['Authorization'] = 'Bearer ' + _authToken;
  return h;
}

// ── Deferred init — no load-order dependency on State/icon ──
function _initCoreState() {
  _ELL_SVG = icon('ell', { size: 16, class: 'ell-favicon' });
  _islandActivities = State({});  // { id: { type, label, detail, progress, done, _ts } }
  _audioUnifiedState = State({ tab: null, tts: null, cc: null, mic: null });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initCoreState);
else _initCoreState();
