/**
 * Global context intake helper — fire-and-forget ingest into the living context.
 * Usage: contextIngest('chat', '## Chat Insights', '- some takeaway', { dedupeKey: 'chat-url' })
 */
function contextIngest(source, section, content, opts) {
  if (!window.electronAPI || !content) return;
  const entry = { source: source, section: section, content: content };
  if (opts && opts.file) entry.file = opts.file;
  if (opts && opts.dedupeKey) entry.dedupeKey = opts.dedupeKey;
  electronAPI.dbQuery('context-ingest', entry).catch(function(e) { logger.warn('[context] Ingest failed:', e); });
}

export { contextIngest };
