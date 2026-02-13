const path = require('path');

let watcher = null;

function initDevReload(mainWindow) {
  const chokidar = require('chokidar');
  const srcDir = path.join(__dirname, '..', 'src');

  let debounceTimer = null;

  watcher = chokidar.watch([
    path.join(srcDir, 'js', '**', '*.js'),
    path.join(srcDir, 'css', '**', '*.css'),
    path.join(srcDir, '*.html'),
  ], {
    ignoreInitial: true,
    ignored: ['**/*.test.js', '**/node_modules/**'],
  });

  watcher.on('change', (filePath) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log(`[dev-reload] Changed: ${path.relative(srcDir, filePath)}`);
        mainWindow.webContents.reloadIgnoringCache();
      }
    }, 300);
  });

  console.log('[dev-reload] Watching for frontend changes');
}

function stopDevReload() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

module.exports = { initDevReload, stopDevReload };
