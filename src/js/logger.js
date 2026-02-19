// ── Centralized logging utility ──
// Loaded before other modules to provide global logger.
// All logs can be toggled via Settings.get('debugLogs')

import Settings from '/js/core/core-settings.js';

const _DEBUG_ENABLED = Settings.get('debugLogs') === 'true';

const logger = {
  debug(...args) {
    if (_DEBUG_ENABLED) console.log('[DEBUG]', ...args);
  },
  info(...args) {
    console.log('[INFO]', ...args);
  },
  warn(...args) {
    console.warn('[WARN]', ...args);
  },
  error(...args) {
    console.error('[ERROR]', ...args);
  },
  // For IPC messages to Electron (do not prefix)
  ipc(message) {
    console.log(message);
  }
};

// Allow toggling debug logs at runtime
window.enableDebugLogs = () => {
  Settings.set('debugLogs', 'true');
  console.log('Debug logging enabled. Reload to take effect.');
};

window.disableDebugLogs = () => {
  Settings.remove('debugLogs');
  console.log('Debug logging disabled. Reload to take effect.');
};

window.logger = logger;
export { logger };
