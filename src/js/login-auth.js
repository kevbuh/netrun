// login-auth.js — Auth logic for standalone login page
// Stub _showLoginGate so api.js:10 doesn't error on 401
window._showLoginGate = function() {};
function _showLoginGate() {}
import { apiPost, apiGet } from '/js/api.js';

let GOOGLE_CLIENT_ID = '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com';
fetch('/api/client-config').then(r => {
  if (!r.ok) return;
  return r.json();
}).then(c => {
  if (c && c.googleClientId) GOOGLE_CLIENT_ID = c.googleClientId;
}).catch(() => {});

// ── Reactive state ──

const _authError = State('');

Effect(() => {
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.textContent = _authError.value;
});

// ── Google Sign-In button ──

let _gisRetries = 0;
function _renderGoogleButton() {
  const container = document.getElementById('google-signin-btn');
  if (!container) return;
  if (typeof google === 'undefined' || !google.accounts) {
    _gisRetries++;
    if (_gisRetries < 50) {
      setTimeout(_renderGoogleButton, 200);
    } else {
      const msg = Text('Google Sign-In failed to load. Check that accounts.google.com is reachable.')
        .styles({ color: '#999', fontSize: '13px' });
      AetherUI.mount(msg, container);
    }
    return;
  }
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: _handleGoogleCredential,
    });
    const btnWrapper = new View('div').attr('id', 'google-btn-real');
    AetherUI.mount(btnWrapper, container);
    google.accounts.id.renderButton(btnWrapper.el, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      width: 280,
    });
  } catch (e) {
    const errMsg = Text('Google Sign-In error: ' + e.message)
      .styles({ color: '#999', fontSize: '13px' });
    AetherUI.mount(errMsg, container);
  }
}

// ── Handle credential response ──

async function _handleGoogleCredential(response) {
  _authError.value = '';
  try {
    const data = await apiPost('/api/auth/google', { credential: response.credential });
    localStorage.setItem('authToken', data.token);
    if (window.electronAPI && window.electronAPI.saveAuthToken) {
      window.electronAPI.saveAuthToken(data.token);
    }
    localStorage.setItem('authUser', (data.name || data.email || '').split(' ')[0]);
    localStorage.setItem('authUserInfo', JSON.stringify({
      email: data.email, name: data.name, username: data.username || null,
      picture: data.picture || null, google_id: data.google_id || null
    }));
    if (!data.username) {
      window.location.href = '/onboarding.html';
    } else {
      window.location.href = '/';
    }
  } catch (e) {
    _authError.value = e.message;
  }
}

// ── Init: check for existing token ──

(function _initLoginPage() {
  const token = localStorage.getItem('authToken');
  if (token) {
    // Verify session is still valid
    window._authToken = token;
    apiGet('/api/auth/me')
      .then(data => {
        if (data && data.email) {
          // Valid session
          if (!data.username) {
            window.location.href = '/onboarding.html';
          } else {
            window.location.href = '/';
          }
        } else {
          // Invalid
          _clearAndShowLogin();
        }
      })
      .catch(() => {
        _clearAndShowLogin();
      });
  } else {
    _renderGoogleButton();
  }
})();

function _clearAndShowLogin() {
  localStorage.removeItem('authToken');
  if (window.electronAPI && window.electronAPI.deleteAuthToken) {
    window.electronAPI.deleteAuthToken();
  }
  localStorage.removeItem('authUser');
  localStorage.removeItem('authUserInfo');
  window._authToken = null;
  _renderGoogleButton();
}
