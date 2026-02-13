// core-state.js — Global state for core module
// All state variables used across core modules

// ── SVG assets ──
var _ELL_SVG = '<svg class="ell-favicon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22 2 2 0 1 1 3.16 2.44"/></svg>';

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
var _islandActivities = {};  // { id: { type, label, detail, progress, done, _ts } }
var _islandDismissTimers = {};  // { id: timeoutId }
var _islandWaveformBars = '<span class="island-waveform"><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span></span>';
var _islandAudioBars = '<span class="island-waveform island-waveform-anim"><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span></span>';
var _islandResizeTimer = null;

// ── Audio ──
var _audioUnifiedState = { tab: null, tts: null, cc: null, mic: null };
var _ttsSpeeds = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

// ── Layout ──
const _boundsCache = null;

// ── Spinners ──
const _spinnerData = null;
const _spinnerNames = [];
const _spinnerInterval = null;

// ── Views ──
const _lastActiveView = localStorage.getItem('_lastActiveView') || 'feed';
const _sidebarToView = { 'sb-home': 'feed', 'sb-dashboard': 'dashboard', 'sb-vault': 'vault', 'sb-browse': 'browse', 'sb-settings': 'settings', 'sb-neuralook': 'neuralook' };
const _researchActiveTab = null;

// ── Sidebar navigation ──
const _sidebarFocused = false;
const _sidebarSelectedIndex = -1;
var _sidebarNavClicking = false;

// ── Lazy images ──
const _lazyImageObserver = null;

// ── Feed catalog ──
const ARXIV_LOGO_INLINE = '<img class="h-3.5 w-auto opacity-50 inline-block" src="/arxiv-logomark-small@2x.png" alt="arXiv" />';
const RSS_LOGO_INLINE = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#f90" width="256" height="256" rx="24"/><circle cx="68" cy="189" r="28" fill="#fff"/><path d="M40 120a108 108 0 01108 108h-36a72 72 0 00-72-72v-36z" fill="#fff"/><path d="M40 56a172 172 0 01172 172h-36A136 136 0 0076 92V56h-36z" fill="#fff"/></svg>';
const SUBSTACK_LOGO_INLINE = '<svg class="h-3.5 w-auto inline-block" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.54 6.42H1.46V4.2h21.08v2.22zM1.46 9.26h21.08V7.04H1.46v2.22zM22.54 12.1H1.46v9.52l10.54-5.87 10.54 5.87V12.1z" fill="#FF6719"/></svg>';

// ── Window manager ──
const _wmMode = 'fullscreen';   // 'tiling' | 'fullscreen'
const _wmFocusIndex = 0;
const _wmPreviews = {};          // { viewKey: 'data:image/png;base64,...' }
const _wmDefaultOrder = ['dashboard','feed','vault','browse','neuralook','dev','settings'];
const _wmLastNavTime = 0;

// ── User search ──
const _userSearchDebounce = null;

// ── Navigation ──
const _expBackAction = null; // stores {fn, label} for context-aware back button
const _prevRouteHash = ''; // the hash before the current route
const _currentRouteHash = ''; // the current route hash
const _navHistory = JSON.parse(localStorage.getItem('_navHistory') || '[]');
const _navForward = JSON.parse(localStorage.getItem('_navForward') || '[]');
const _navNavigating = false; // guard to prevent push while navigating back/forward

// ── Auth ──
const _authToken = localStorage.getItem('authToken') || null;
const _authUserInfo = JSON.parse(localStorage.getItem('authUserInfo') || 'null');

// Auth headers helper (used by api.js)
function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_authToken) h['Authorization'] = 'Bearer ' + _authToken;
  return h;
}
