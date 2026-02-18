// ─── Help Settings ──────────────────────────────────────

function _renderHelpSettings() {
  var h = '';

  // Search
  h += '<div class="mb-8"><h3 class="text-white_ text-sm font-semibold mb-3">Search</h3>';
  h += '<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">';
  _HELP_DATA.searchSyntax.forEach(function(row) {
    h += '<code class="text-muted">' + row[0] + '</code><span class="text-dim">' + row[1] + '</span>';
  });
  h += '</div></div>';

  // Bangs
  var bangs = _HELP_DATA.getBangs();
  if (bangs.length) {
    h += '<div class="mb-8 pt-5 border-t border-border-subtle"><h3 class="text-white_ text-sm font-semibold mb-3">Bangs</h3>';
    h += '<p class="text-dim text-[0.8rem] mb-3">Type <code class="text-muted">!</code> followed by a shortcut and your query to search a specific site. Works at the start or end of input.</p>';
    h += '<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">';
    bangs.forEach(function(row) {
      h += '<code class="text-muted">' + row[0] + '</code><span class="text-dim">' + row[1] + '</span>';
    });
    h += '</div></div>';
  }

  // Semantic Search
  h += '<div class="mb-8 pt-5 border-t border-border-subtle"><h3 class="text-white_ text-sm font-semibold mb-3">Semantic Search</h3>';
  h += '<p class="text-dim text-[0.8rem] mb-3">Posts you read or bookmark are automatically embedded using a local AI model. You can then search by meaning instead of keywords.</p>';
  h += '<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">';
  _HELP_DATA.semanticSearch.forEach(function(row) {
    h += '<span class="text-muted font-medium">' + row[0] + '</span><span class="text-dim">' + row[1] + '</span>';
  });
  h += '</div></div>';

  // Keyboard Shortcuts
  h += '<div class="mb-8 pt-5 border-t border-border-subtle"><h3 class="text-white_ text-sm font-semibold mb-3">Keyboard Shortcuts</h3>';
  h += '<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">';
  _HELP_DATA.shortcuts.forEach(function(row) {
    if (!row[0]) return;
    h += '<kbd class="kbd-key text-[0.7rem]">' + row[0] + '</kbd><span class="text-dim">' + row[1] + '</span>';
  });
  h += '</div></div>';

  // Aether Panel
  h += '<div class="mb-8 pt-5 border-t border-border-subtle"><h3 class="text-white_ text-sm font-semibold mb-3">Aether Panel</h3>';
  h += '<p class="text-dim text-[0.8rem] mb-2">Right-click anywhere to open an inline chat panel. Type <code class="text-muted">/help</code> in the panel for available commands.</p>';
  h += '<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">';
  h += '<span class="text-muted font-medium">Chat</span><span class="text-dim">Ask questions about the current page or anything</span>';
  h += '<span class="text-muted font-medium">Screenshot</span><span class="text-dim">Drag to capture a region and chat about it (Electron only)</span>';
  h += '<span class="text-muted font-medium">Web search</span><span class="text-dim">Shift+Enter to search the web inline</span>';
  h += '<span class="text-muted font-medium">Context</span><span class="text-dim">Right-click on links/images for contextual actions</span>';
  h += '</div></div>';

  // AI Models
  h += '<div class="mb-8 pt-5 border-t border-border-subtle"><h3 class="text-white_ text-sm font-semibold mb-3">AI Models (Ollama)</h3>';
  h += '<p class="text-dim text-[0.8rem] mb-3">The app uses local Ollama models. All are optional \u2014 features degrade gracefully without them.</p>';
  h += '<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.8rem]">';
  _HELP_DATA.aiModels.forEach(function(row) {
    h += '<code class="text-muted">' + row[0] + '</code><span class="text-dim">' + row[1] + '</span>';
  });
  h += '</div></div>';

  return RawHTML(h);
}
