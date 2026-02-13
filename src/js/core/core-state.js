// core-state.js — Global state for core module
// All state variables used across core modules

// ── SVG assets ──
var _ELL_SVG = '<svg class="ell-favicon" viewBox="0 0 961 1259" width="16" height="16" fill="none"><path d="M334.385 761.105L286.951 798.06C278.902 804.874 272.865 808.281 268.84 808.281C264.815 808.281 260.503 805.398 255.903 799.632C251.304 793.866 249.004 789.673 249.004 787.052C249.004 783.907 253.029 778.927 261.078 772.113C266.828 767.395 278.902 757.829 297.3 743.414C315.699 728.999 326.336 720.743 329.21 718.646C329.21 665.704 339.416 607.782 359.827 544.88C380.238 481.978 409.273 426.808 446.933 379.37C484.593 331.931 524.121 308.212 565.518 308.212C583.916 308.212 599.584 314.109 612.521 325.903C625.457 337.697 631.925 357.223 631.925 384.48C631.925 462.059 570.98 555.364 449.089 664.393C447.364 666.49 442.477 670.946 434.428 677.76C426.378 684.574 421.204 689.03 418.904 691.127C413.729 719.433 411.142 741.972 411.142 758.746C411.142 813.785 428.391 841.305 462.888 841.305C496.81 841.305 539.357 822.172 590.528 783.907C596.278 778.665 600.878 776.044 604.327 776.044C608.927 776.044 613.527 778.796 618.126 784.3C622.726 789.804 625.026 794.128 625.026 797.274C625.026 799.894 624.02 802.253 622.007 804.35C619.995 806.447 614.102 811.164 604.327 818.503C553.731 852.575 506.01 869.611 461.163 869.611C430.115 869.611 403.236 860.569 380.525 842.484C357.815 824.4 342.434 797.274 334.385 761.105ZM433.565 629.011C462.313 604.899 491.923 573.71 522.396 535.445C569.543 477.261 593.116 424.58 593.116 377.404C593.116 350.146 583.629 336.518 564.655 336.518C539.932 336.518 514.634 371.638 488.761 441.878C478.412 470.708 460.013 533.086 433.565 629.011Z" fill="currentColor"/></svg>';

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
let _boundsCache = null;

// ── Spinners ──
let _spinnerData = null;
let _spinnerNames = [];
let _spinnerInterval = null;

// ── Views ──
let _lastActiveView = localStorage.getItem('_lastActiveView') || 'feed';
const _sidebarToView = { 'sb-home': 'feed', 'sb-dashboard': 'dashboard', 'sb-vault': 'vault', 'sb-browse': 'browse', 'sb-settings': 'settings', 'sb-neuralook': 'neuralook' };
let _researchActiveTab = null;

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
const _wmDefaultOrder = ['dashboard','feed','vault','browse','neuralook','dev','settings'];
let _wmLastNavTime = 0;

// ── User search ──
let _userSearchDebounce = null;

// ── Navigation ──
let _expBackAction = null; // stores {fn, label} for context-aware back button
let _prevRouteHash = ''; // the hash before the current route
let _currentRouteHash = ''; // the current route hash
let _navHistory = JSON.parse(localStorage.getItem('_navHistory') || '[]');
let _navForward = JSON.parse(localStorage.getItem('_navForward') || '[]');
let _navNavigating = false; // guard to prevent push while navigating back/forward

// ── Auth ──
let _authToken = localStorage.getItem('authToken') || null;
let _authUserInfo = JSON.parse(localStorage.getItem('authUserInfo') || 'null');

// Auth headers helper (used by api.js)
function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_authToken) h['Authorization'] = 'Bearer ' + _authToken;
  return h;
}
