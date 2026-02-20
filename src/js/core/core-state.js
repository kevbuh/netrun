// core-state.js — Global state for core module
// All state variables used across core modules
//
// State variable conventions:
//   @settings — backed by Settings.get/set; no local var needed (read Settings directly)
//   @signal   — AetherUI State() reactive signal; access via .value
//   @runtime  — ephemeral in-memory state; plain var, not persisted
//   @const    — set once at init, never changes

import { State } from '/aether/ui/state.js';
import { icon } from '/js/core/icons.js';

// ── SVG assets ──
window._ELL_SVG = icon('ell', { size: 16, class: 'ell-favicon' });  // @const

// ── Link preview ──
window._linkPreviewEl = null;
window._linkPreviewTimer = 0;

// ── Pill stack ──
window._pillStack = [];
window._PILL_GAP = 8;
window._PILL_BOTTOM = 20;

// ── Annotations ──
window._customAnnotationCategories = [];

// ── Dynamic Island ──
window._islandActivities = Store({});  // @store — { id: { type, label, detail, progress, done, _ts } }
window._islandDismissTimers = {};  // { id: timeoutId }
window._islandWaveformBars = '<span class="island-waveform"><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span></span>';
window._islandAudioBars = '<span class="island-waveform island-waveform-anim"><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span></span>';
window._islandResizeTimer = null;

// ── Audio ──
window._audioUnifiedState = Store({ tab: null, tts: null, cc: null, mic: null });  // @store
window._ttsSpeeds = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

// ── Layout ──
window._boundsCache = null;

// ── Spinners ──
window._spinnerData = null;
window._spinnerNames = [];
window._spinnerInterval = null;

// ── Views ── (@settings — backed by Settings.get('_lastActiveView'))
window._sidebarToView = { 'sb-home': 'feed', 'sb-dashboard': 'dashboard', 'sb-browse': 'browse', 'sb-settings': 'settings', 'sb-neuralook': 'neuralook' };
// ── Sidebar navigation ──
window._sidebarFocused = false;
window._sidebarSelectedIndex = -1;
window._sidebarNavClicking = false;

// ── Lazy images ──
window._lazyImageObserver = null;

// ── Feed catalog ──
window.ARXIV_LOGO_INLINE = '<img class="h-3.5 w-auto opacity-50 inline-block" src="/arxiv-logomark-small@2x.png" alt="arXiv" />';
window.RSS_LOGO_INLINE = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#f90" width="256" height="256" rx="24"/><circle cx="68" cy="189" r="28" fill="#fff"/><path d="M40 120a108 108 0 01108 108h-36a72 72 0 00-72-72v-36z" fill="#fff"/><path d="M40 56a172 172 0 01172 172h-36A136 136 0 0076 92V56h-36z" fill="#fff"/></svg>';
window.SUBSTACK_LOGO_INLINE = '<svg class="h-3.5 w-auto inline-block" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.54 6.42H1.46V4.2h21.08v2.22zM1.46 9.26h21.08V7.04H1.46v2.22zM22.54 12.1H1.46v9.52l10.54-5.87 10.54 5.87V12.1z" fill="#FF6719"/></svg>';

// ── Window manager ──
window._wmMode = 'fullscreen';   // 'tiling' | 'fullscreen'
window._wmFocusIndex = 0;
window._wmPreviews = {};          // { viewKey: 'data:image/png;base64,...' }
window._wmDefaultOrder = ['dashboard','feed','browse','neuralook','dev','settings'];
window._wmLastNavTime = 0;

// ── User search ──
window._userSearchDebounce = null;

// ── Navigation ──
window._prevRouteHash = ''; // the hash before the current route
window._currentRouteHash = ''; // the current route hash
window._navHistory = Settings.getJSON('_navHistory', []);
window._navForward = Settings.getJSON('_navForward', []);
window._navNavigating = false; // guard to prevent push while navigating back/forward

// ── Guest mode ──
window._guestMode = sessionStorage.getItem('_guestMode') === 'true';

// ── Auth ──
window._authToken = localStorage.getItem('authToken') || null;
window._authUserInfo = JSON.parse(localStorage.getItem('authUserInfo') || 'null');

// Auth headers helper (used by api.js)
function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (window._authToken) h['Authorization'] = 'Bearer ' + window._authToken;
  return h;
}
window._authHeaders = _authHeaders;
