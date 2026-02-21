// core-state.js — Global state for core module
// All state variables used across core modules
//
// State variable conventions:
//   @settings — backed by Settings.get/set; no local var needed (read Settings directly)
//   @signal   — AetherUI window.State() reactive signal; access via .value
//   @runtime  — ephemeral in-memory state; plain var, not persisted
//   @const    — set once at init, never changes

import { State } from '/aether/ui/state.js';
import { icon } from '/js/core/icons.js';

// ── Helper: bridge a local var to window via getter/setter ──
function _bridge(name, get, set) {
  Object.defineProperty(window, name, { get, set, configurable: true, enumerable: true });
}

// ── SVG assets ── @const
export const _ELL_SVG = icon('ell', { size: 16, class: 'ell-favicon' });
window._ELL_SVG = _ELL_SVG;

// ── Link preview ──
let _linkPreviewEl = null;
let _linkPreviewTimer = 0;
export function getLinkPreviewEl() { return _linkPreviewEl; }
export function setLinkPreviewEl(v) { _linkPreviewEl = v; }
export function getLinkPreviewTimer() { return _linkPreviewTimer; }
export function setLinkPreviewTimer(v) { _linkPreviewTimer = v; }
_bridge('_linkPreviewEl', () => _linkPreviewEl, v => { _linkPreviewEl = v; });
_bridge('_linkPreviewTimer', () => _linkPreviewTimer, v => { _linkPreviewTimer = v; });

// ── Pill stack ──
export const _pillStack = [];
export const _PILL_GAP = 8;
export const _PILL_BOTTOM = 20;
window._pillStack = _pillStack;
window._PILL_GAP = _PILL_GAP;
window._PILL_BOTTOM = _PILL_BOTTOM;

// ── Annotations ──
export const _customAnnotationCategories = [];
window._customAnnotationCategories = _customAnnotationCategories;

// ── Dynamic Island ──
export const _islandActivities = Store({});  // @store — { id: { type, label, detail, progress, done, _ts } }
export const _islandDismissTimers = {};  // { id: timeoutId }
export const _islandWaveformBars = '<span class="island-waveform"><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span></span>';
export const _islandAudioBars = '<span class="island-waveform island-waveform-anim"><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span><span class="island-waveform-bar"></span></span>';
let _islandResizeTimer = null;
export function getIslandResizeTimer() { return _islandResizeTimer; }
export function setIslandResizeTimer(v) { _islandResizeTimer = v; }
window._islandActivities = _islandActivities;
window._islandDismissTimers = _islandDismissTimers;
window._islandWaveformBars = _islandWaveformBars;
window._islandAudioBars = _islandAudioBars;
_bridge('_islandResizeTimer', () => _islandResizeTimer, v => { _islandResizeTimer = v; });

// Island stack — collapsed when 3+ non-tabs pills active
let _islandStackExpanded = false;
export function getIslandStackExpanded() { return _islandStackExpanded; }
export function setIslandStackExpanded(v) { _islandStackExpanded = v; }
_bridge('_islandStackExpanded', () => _islandStackExpanded, v => { _islandStackExpanded = v; });

// ── Audio ──
export const _audioUnifiedState = Store({ tab: null, tts: null, cc: null, mic: null });  // @store
export const _ttsSpeeds = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
window._audioUnifiedState = _audioUnifiedState;
window._ttsSpeeds = _ttsSpeeds;

// ── Layout ──
let _boundsCache = null;
export function getBoundsCache() { return _boundsCache; }
export function setBoundsCache(v) { _boundsCache = v; }
_bridge('_boundsCache', () => _boundsCache, v => { _boundsCache = v; });

// ── Spinners ──
let _spinnerData = null;
export const _spinnerNames = [];
let _spinnerInterval = null;
export function getSpinnerData() { return _spinnerData; }
export function setSpinnerData(v) { _spinnerData = v; }
export function getSpinnerInterval() { return _spinnerInterval; }
export function setSpinnerInterval(v) { _spinnerInterval = v; }
_bridge('_spinnerData', () => _spinnerData, v => { _spinnerData = v; });
window._spinnerNames = _spinnerNames;
_bridge('_spinnerInterval', () => _spinnerInterval, v => { _spinnerInterval = v; });

// ── Views ── (@settings — backed by Settings.get('_lastActiveView'))
export const _sidebarToView = { 'sb-home': 'feed', 'sb-dashboard': 'browse', 'sb-browse': 'browse', 'sb-settings': 'settings', 'sb-neuralook': 'neuralook' };
window._sidebarToView = _sidebarToView;

// ── Sidebar navigation ──
let _sidebarFocused = false;
let _sidebarSelectedIndex = -1;
let _sidebarNavClicking = false;
export function getSidebarFocused() { return _sidebarFocused; }
export function setSidebarFocused(v) { _sidebarFocused = v; }
export function getSidebarSelectedIndex() { return _sidebarSelectedIndex; }
export function setSidebarSelectedIndex(v) { _sidebarSelectedIndex = v; }
export function getSidebarNavClicking() { return _sidebarNavClicking; }
export function setSidebarNavClicking(v) { _sidebarNavClicking = v; }
_bridge('_sidebarFocused', () => _sidebarFocused, v => { _sidebarFocused = v; });
_bridge('_sidebarSelectedIndex', () => _sidebarSelectedIndex, v => { _sidebarSelectedIndex = v; });
_bridge('_sidebarNavClicking', () => _sidebarNavClicking, v => { _sidebarNavClicking = v; });

// ── Lazy images ──
let _lazyImageObserver = null;
export function getLazyImageObserver() { return _lazyImageObserver; }
export function setLazyImageObserver(v) { _lazyImageObserver = v; }
_bridge('_lazyImageObserver', () => _lazyImageObserver, v => { _lazyImageObserver = v; });

// ── Feed catalog ── @const
export const ARXIV_LOGO_INLINE = '<img class="h-3.5 w-auto opacity-50 inline-block" src="/arxiv-logomark-small@2x.png" alt="arXiv" />';
export const RSS_LOGO_INLINE = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#f90" width="256" height="256" rx="24"/><circle cx="68" cy="189" r="28" fill="#fff"/><path d="M40 120a108 108 0 01108 108h-36a72 72 0 00-72-72v-36z" fill="#fff"/><path d="M40 56a172 172 0 01172 172h-36A136 136 0 0076 92V56h-36z" fill="#fff"/></svg>';
export const SUBSTACK_LOGO_INLINE = '<svg class="h-3.5 w-auto inline-block" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.54 6.42H1.46V4.2h21.08v2.22zM1.46 9.26h21.08V7.04H1.46v2.22zM22.54 12.1H1.46v9.52l10.54-5.87 10.54 5.87V12.1z" fill="#FF6719"/></svg>';
window.ARXIV_LOGO_INLINE = ARXIV_LOGO_INLINE;
window.RSS_LOGO_INLINE = RSS_LOGO_INLINE;
window.SUBSTACK_LOGO_INLINE = SUBSTACK_LOGO_INLINE;

// ── Window manager ──
let _wmMode = 'fullscreen';   // 'tiling' | 'fullscreen'
let _wmFocusIndex = 0;
export const _wmPreviews = {};          // { viewKey: 'data:image/png;base64,...' }
export const _wmDefaultOrder = ['browse','feed','neuralook','dev','docs','settings'];
let _wmLastNavTime = 0;
export function getWmMode() { return _wmMode; }
export function setWmMode(v) { _wmMode = v; }
export function getWmFocusIndex() { return _wmFocusIndex; }
export function setWmFocusIndex(v) { _wmFocusIndex = v; }
export function getWmLastNavTime() { return _wmLastNavTime; }
export function setWmLastNavTime(v) { _wmLastNavTime = v; }
_bridge('_wmMode', () => _wmMode, v => { _wmMode = v; });
_bridge('_wmFocusIndex', () => _wmFocusIndex, v => { _wmFocusIndex = v; });
window._wmPreviews = _wmPreviews;
window._wmDefaultOrder = _wmDefaultOrder;
_bridge('_wmLastNavTime', () => _wmLastNavTime, v => { _wmLastNavTime = v; });

// ── User search ──
let _userSearchDebounce = null;
export function getUserSearchDebounce() { return _userSearchDebounce; }
export function setUserSearchDebounce(v) { _userSearchDebounce = v; }
_bridge('_userSearchDebounce', () => _userSearchDebounce, v => { _userSearchDebounce = v; });

// ── Navigation ──
let _prevRouteHash = ''; // the hash before the current route
let _currentRouteHash = ''; // the current route hash
export const _navHistory = (() => { try { return JSON.parse(localStorage.getItem('_navHistory')) || []; } catch { return []; } })();
export const _navForward = (() => { try { return JSON.parse(localStorage.getItem('_navForward')) || []; } catch { return []; } })();
let _navNavigating = false; // guard to prevent push while navigating back/forward
export function getPrevRouteHash() { return _prevRouteHash; }
export function setPrevRouteHash(v) { _prevRouteHash = v; }
export function getCurrentRouteHash() { return _currentRouteHash; }
export function setCurrentRouteHash(v) { _currentRouteHash = v; }
export function getNavNavigating() { return _navNavigating; }
export function setNavNavigating(v) { _navNavigating = v; }
_bridge('_prevRouteHash', () => _prevRouteHash, v => { _prevRouteHash = v; });
_bridge('_currentRouteHash', () => _currentRouteHash, v => { _currentRouteHash = v; });
window._navHistory = _navHistory;
window._navForward = _navForward;
_bridge('_navNavigating', () => _navNavigating, v => { _navNavigating = v; });

// ── Guest mode ──
let _guestMode = sessionStorage.getItem('_guestMode') === 'true';
export function getGuestMode() { return _guestMode; }
export function setGuestMode(v) { _guestMode = v; }
_bridge('_guestMode', () => _guestMode, v => { _guestMode = v; });

// ── Auth ──
let _authToken = localStorage.getItem('authToken') || null;
let _authUserInfo = JSON.parse(localStorage.getItem('authUserInfo') || 'null');
export function getAuthToken() { return _authToken; }
export function setAuthToken(v) { _authToken = v; }
export function getAuthUserInfo() { return _authUserInfo; }
export function setAuthUserInfo(v) { _authUserInfo = v; }
_bridge('_authToken', () => _authToken, v => { _authToken = v; });
_bridge('_authUserInfo', () => _authUserInfo, v => { _authUserInfo = v; });

// Auth headers helper (used by api.js)
export function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_authToken) h['Authorization'] = 'Bearer ' + _authToken;
  return h;
}
window._authHeaders = _authHeaders;
