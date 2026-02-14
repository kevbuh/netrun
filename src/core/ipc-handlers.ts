import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { toolRegistry } from './tools/index.js';
import type { ToolContext } from './tools/types.js';
import { providerRegistry } from './providers/registry.js';
import { runAgent } from './agents/runtime.js';
import { researchAssistant } from './agents/builtin/research-assistant.js';
import type { AgentContext, AgentMessage, AgentEvent } from './agents/types.js';
import * as calendarQueries from './db/queries/calendar.js';
import * as userQueries from './db/queries/users.js';
import * as feedQueries from './db/queries/feeds.js';
import * as socialQueries from './db/queries/social.js';
import * as embeddingQueries from './db/queries/embeddings.js';
import * as contentQueries from './db/queries/content.js';
import * as socialExtQueries from './db/queries/social-extended.js';

// ── Experiment filesystem helpers ──

const VAULT_DIR = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '/tmp', 'Desktop', 'aether');
const SKIP_DIRS = new Set(['venv', '.kernels', '__pycache__', 'node_modules', '.git']);
const SKIP_FILES = new Set(['meta.json', '.DS_Store', 'Thumbs.db']);

function _getUserVaultPath(googleId: string): string {
  const custom = userQueries.getUserData(googleId, 'vaultPath');
  if (custom && fs.existsSync(custom)) return custom;
  const defaultPath = path.join(VAULT_DIR, googleId);
  fs.mkdirSync(defaultPath, { recursive: true });
  return defaultPath;
}

function _resolveExpDir(googleId: string, expId: string): string | null {
  const vault = _getUserVaultPath(googleId);
  if (expId === '_root') return vault;
  const d = path.join(vault, expId);
  if (!path.resolve(d).startsWith(path.resolve(vault) + path.sep)) return null;
  return d;
}

function _slugify(text: string): string {
  let s = text.toLowerCase().trim();
  s = s.replace(/[^\w\s-]/g, '');
  s = s.replace(/[\s_]+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'experiment';
}

function _uniqueSlug(vaultPath: string, base: string): string {
  let slug = base;
  let i = 2;
  while (fs.existsSync(path.join(vaultPath, slug))) {
    slug = `${base}-${i}`;
    i++;
  }
  return slug;
}

const BINARY_MIME: Record<string, string> = {
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.zip': 'application/zip', '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
};

/** Active agent sessions, keyed by session ID */
const activeSessions = new Map<string, AbortController>();

/**
 * Register all IPC handlers for the tool system and agent runtime.
 */
export function registerToolIPC(): void {
  // ── Tool system ──

  ipcMain.handle('tools:execute', async (_event, name: string, input: unknown, contextData?: Partial<ToolContext>) => {
    const context: ToolContext = { googleId: contextData?.googleId };
    return toolRegistry.execute(name, input, context);
  });

  ipcMain.handle('tools:list', () => {
    return toolRegistry.all().map(t => ({
      name: t.name,
      description: t.description,
      category: t.category,
      access: t.access,
    }));
  });

  ipcMain.handle('tools:definitions', (_event, access?: string) => {
    return toolRegistry.toToolDefinitions((access as any) ?? 'agent');
  });

  // ── Provider system ──

  ipcMain.handle('providers:list', () => {
    return providerRegistry.names();
  });

  ipcMain.handle('providers:models', async (_event, providerName?: string) => {
    const provider = providerName
      ? providerRegistry.get(providerName)
      : providerRegistry.getDefault();
    if (!provider) return [];
    return provider.listModels();
  });

  // ── Agent system ──

  /**
   * Start an agent session. Events are streamed back to the renderer
   * via webContents.send('agent:event', sessionId, event).
   */
  ipcMain.handle('agent:start', async (event, options: {
    sessionId: string;
    agentId?: string;
    messages: AgentMessage[];
    context: AgentContext;
  }) => {
    const { sessionId, messages, context } = options;

    // Look up agent definition (default: research-assistant)
    const agent = researchAssistant; // TODO: agent registry for multiple agents

    // Set up abort controller
    const abortController = new AbortController();
    activeSessions.set(sessionId, abortController);

    // Get the sender's webContents for streaming events back
    const webContents = event.sender;

    // Run agent in background, streaming events
    (async () => {
      try {
        const eventStream = runAgent({
          agent,
          messages,
          context,
          signal: abortController.signal,
          onAction: (action) => {
            if (!webContents.isDestroyed()) {
              webContents.send('agent:event', sessionId, { type: 'action', action });
            }
          },
        });

        for await (const agentEvent of eventStream) {
          if (webContents.isDestroyed()) break;
          webContents.send('agent:event', sessionId, agentEvent);
        }
      } catch (err) {
        if (!webContents.isDestroyed()) {
          webContents.send('agent:event', sessionId, {
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        activeSessions.delete(sessionId);
      }
    })();

    return { sessionId };
  });

  /** Cancel a running agent session */
  ipcMain.handle('agent:cancel', (_event, sessionId: string) => {
    const controller = activeSessions.get(sessionId);
    if (controller) {
      controller.abort();
      activeSessions.delete(sessionId);
      return { cancelled: true };
    }
    return { cancelled: false };
  });

  /** List active agent sessions */
  ipcMain.handle('agent:sessions', () => {
    return [...activeSessions.keys()];
  });

  // ── DB query handlers (direct data access, no Flask) ──

  // Calendar
  ipcMain.handle('db:calendar-list', (_event, googleId: string) => {
    return calendarQueries.getCalendarEvents(googleId);
  });
  ipcMain.handle('db:calendar-create', (_event, googleId: string, data: { title: string; date: string; description?: string; color?: string }) => {
    return calendarQueries.createCalendarEvent(googleId, data);
  });
  ipcMain.handle('db:calendar-update', (_event, googleId: string, eventId: string, updates: any) => {
    return calendarQueries.updateCalendarEvent(googleId, eventId, updates);
  });
  ipcMain.handle('db:calendar-delete', (_event, googleId: string, eventId: string) => {
    return calendarQueries.deleteCalendarEvent(googleId, eventId);
  });

  // Users
  ipcMain.handle('db:user-get', (_event, googleId: string) => {
    return userQueries.getUser(googleId);
  });
  ipcMain.handle('db:user-by-username', (_event, username: string) => {
    return userQueries.getUserByUsername(username);
  });
  ipcMain.handle('db:user-upsert', (_event, data: { google_id: string; email: string; name: string; picture?: string }) => {
    return userQueries.upsertUser(data);
  });
  ipcMain.handle('db:session-create', (_event, googleId: string) => {
    return userQueries.createSession(googleId);
  });
  ipcMain.handle('db:session-get', (_event, token: string) => {
    return userQueries.getSession(token);
  });
  ipcMain.handle('db:session-delete', (_event, token: string) => {
    userQueries.deleteSession(token);
  });
  ipcMain.handle('db:user-data-get', (_event, googleId: string, key: string) => {
    return userQueries.getUserData(googleId, key);
  });
  ipcMain.handle('db:user-data-set', (_event, googleId: string, key: string, value: string) => {
    userQueries.setUserData(googleId, key, value);
  });
  ipcMain.handle('db:users-list', (_event, limit?: number) => {
    return userQueries.listUsers(limit);
  });
  ipcMain.handle('db:users-search', (_event, query: string) => {
    return userQueries.searchUsers(query);
  });

  // Feeds
  ipcMain.handle('db:feed-items', (_event, sources: string[], limit?: number) => {
    return feedQueries.getFeedItems(sources, limit);
  });
  ipcMain.handle('db:feed-items-upsert', (_event, items: any[]) => {
    return feedQueries.upsertFeedItems(items);
  });
  ipcMain.handle('db:quality-cache-get', (_event, titleHash: string, promptHash: string) => {
    return feedQueries.getQualityCache(titleHash, promptHash);
  });
  ipcMain.handle('db:quality-cache-set', (_event, titleHash: string, promptHash: string, verdict: string, score: number) => {
    feedQueries.setQualityCache(titleHash, promptHash, verdict, score);
  });

  // Social
  ipcMain.handle('db:teams-list', (_event, googleId: string) => {
    return socialQueries.getUserTeams(googleId);
  });
  ipcMain.handle('db:team-get', (_event, teamId: number) => {
    return socialQueries.getTeam(teamId);
  });
  ipcMain.handle('db:team-create', (_event, name: string, ownerGoogleId: string, options?: { private?: boolean; parentId?: number }) => {
    return socialQueries.createTeam(name, ownerGoogleId, options);
  });
  ipcMain.handle('db:team-delete', (_event, teamId: number, ownerGoogleId: string) => {
    return socialQueries.deleteTeam(teamId, ownerGoogleId);
  });
  ipcMain.handle('db:team-members', (_event, teamId: number) => {
    return socialQueries.getTeamMembers(teamId);
  });
  ipcMain.handle('db:team-is-member', (_event, teamId: number, googleId: string) => {
    return socialQueries.isTeamMember(teamId, googleId);
  });
  ipcMain.handle('db:team-messages', (_event, teamId: number, limit?: number) => {
    return socialQueries.getTeamMessages(teamId, limit);
  });
  ipcMain.handle('db:team-message-send', (_event, teamId: number, googleId: string, content: string) => {
    return socialQueries.sendTeamMessage(teamId, googleId, content);
  });
  ipcMain.handle('db:team-message-delete', (_event, messageId: string, googleId: string) => {
    return socialQueries.deleteTeamMessage(messageId, googleId);
  });
  ipcMain.handle('db:direct-messages', (_event, googleId: string) => {
    return socialQueries.getDirectMessages(googleId);
  });
  ipcMain.handle('db:direct-message-send', (_event, fromGoogleId: string, toGoogleId: string, content: string) => {
    return socialQueries.sendDirectMessage(fromGoogleId, toGoogleId, content);
  });
  ipcMain.handle('db:team-todos', (_event, teamId: number) => {
    return socialQueries.getTeamTodos(teamId);
  });
  ipcMain.handle('db:team-todo-create', (_event, teamId: number, googleId: string, data: any) => {
    return socialQueries.createTeamTodo(teamId, googleId, data);
  });
  ipcMain.handle('db:reaction-toggle', (_event, messageId: string, googleId: string, emoji: string) => {
    return socialQueries.toggleReaction(messageId, googleId, emoji);
  });

  // Embeddings
  ipcMain.handle('db:embed', (_event, text: string, model?: string) => {
    return embeddingQueries.embeddingHash(text);
  });
  ipcMain.handle('db:embedding-store', (_event, hash: string, embedding: number[]) => {
    const packed = embeddingQueries.packEmbedding(embedding);
    // Store via getDb - handled by tools, this is a lower-level util
    return { hash, size: packed.length };
  });

  // ── Auth extensions ──
  ipcMain.handle('db:user-set-username', (_event, googleId: string, username: string) => {
    return userQueries.setUsername(googleId, username);
  });
  ipcMain.handle('db:user-delete', (_event, googleId: string) => {
    userQueries.deleteUser(googleId);
  });
  ipcMain.handle('db:user-set-status', (_event, googleId: string, emoji: string | null, text: string | null) => {
    userQueries.setUserStatus(googleId, emoji, text);
  });
  ipcMain.handle('db:user-set-privacy', (_event, googleId: string, isPrivate: boolean) => {
    userQueries.setUserPrivacy(googleId, isPrivate);
  });
  ipcMain.handle('db:user-update-picture', (_event, googleId: string, pictureUrl: string) => {
    userQueries.updateUserPicture(googleId, pictureUrl);
  });
  ipcMain.handle('db:user-update-bg', (_event, googleId: string, bgUrl: string) => {
    userQueries.updateUserProfileBg(googleId, bgUrl);
  });
  ipcMain.handle('db:user-sync', (_event, googleId: string, clientData: Record<string, any>) => {
    return userQueries.syncUserData(googleId, clientData);
  });
  ipcMain.handle('db:user-data-all', (_event, googleId: string) => {
    return userQueries.getAllUserData(googleId);
  });

  // ── Content: reference/author cache ──
  ipcMain.handle('db:ref-cache-get', (_event, arxivId: string) => {
    return contentQueries.getCachedReferences(arxivId);
  });
  ipcMain.handle('db:ref-cache-set', (_event, arxivId: string, refs: unknown[]) => {
    contentQueries.setCachedReferences(arxivId, refs);
  });
  ipcMain.handle('db:author-cache-get', (_event, query: string) => {
    return contentQueries.getCachedAuthor(query);
  });
  ipcMain.handle('db:author-cache-set', (_event, query: string, data: unknown) => {
    contentQueries.setCachedAuthor(query, data);
  });

  // ── Annotation feedback ──
  ipcMain.handle('db:ann-feedback-create', (_event, data: { url: string; pageTitle: string; quote: string; explanation: string; annType: string; rating: string }) => {
    contentQueries.storeAnnotationFeedback(data.url, data.pageTitle, data.quote, data.explanation, data.annType, data.rating);
  });
  ipcMain.handle('db:ann-feedback-list', (_event, rating?: string, limit?: number, offset?: number) => {
    return contentQueries.listAnnotationFeedback(rating, limit, offset);
  });
  ipcMain.handle('db:ann-feedback-update', (_event, feedbackId: number, rating: string) => {
    contentQueries.updateAnnotationFeedbackRating(feedbackId, rating);
  });
  ipcMain.handle('db:ann-feedback-delete', (_event, feedbackId: number) => {
    contentQueries.deleteAnnotationFeedback(feedbackId);
  });
  ipcMain.handle('db:ann-feedback-stats', () => {
    return contentQueries.getAnnotationFeedbackStats();
  });

  // ── Annotation categories ──
  ipcMain.handle('db:ann-categories-list', () => {
    return contentQueries.listAnnotationCategories();
  });
  ipcMain.handle('db:ann-category-add', (_event, key: string, name: string, description: string, color: string) => {
    contentQueries.addAnnotationCategory(key, name, description, color);
  });
  ipcMain.handle('db:ann-category-delete', (_event, key: string) => {
    contentQueries.deleteAnnotationCategory(key);
  });

  // ── Chat memory (list/delete/stats) ──
  ipcMain.handle('db:chat-memories-list', (_event, limit?: number, offset?: number) => {
    return embeddingQueries.listChatMemories(limit, offset);
  });
  ipcMain.handle('db:chat-memory-delete', (_event, memoryId: number) => {
    embeddingQueries.deleteChatMemory(memoryId);
  });
  ipcMain.handle('db:chat-memory-stats', () => {
    return contentQueries.getChatMemoryStats();
  });

  // ── Social extended: team invites ──
  ipcMain.handle('db:team-invite', (_event, teamId: number, fromGoogleId: string, toUsername: string) => {
    return socialExtQueries.inviteToTeam(teamId, fromGoogleId, toUsername);
  });
  ipcMain.handle('db:pending-invites', (_event, googleId: string) => {
    return socialExtQueries.getPendingInvites(googleId);
  });
  ipcMain.handle('db:invite-respond', (_event, inviteId: number, googleId: string, accept: boolean) => {
    return socialExtQueries.respondToInvite(inviteId, googleId, accept);
  });

  // ── Social extended: team management ──
  ipcMain.handle('db:team-detail', (_event, teamId: number) => {
    return socialExtQueries.getTeamDetail(teamId);
  });
  ipcMain.handle('db:team-remove-member', (_event, teamId: number, ownerGoogleId: string, targetGoogleId: string) => {
    return socialExtQueries.removeTeamMember(teamId, ownerGoogleId, targetGoogleId);
  });
  ipcMain.handle('db:team-rename', (_event, teamId: number, newName: string, googleId: string) => {
    return socialExtQueries.renameTeam(teamId, newName, googleId);
  });
  ipcMain.handle('db:team-set-private', (_event, teamId: number, isPrivate: boolean, googleId: string) => {
    return socialExtQueries.setTeamPrivate(teamId, isPrivate, googleId);
  });
  ipcMain.handle('db:team-set-parent', (_event, teamId: number, parentId: number | null, googleId: string) => {
    return socialExtQueries.setTeamParent(teamId, parentId, googleId);
  });
  ipcMain.handle('db:team-children', (_event, teamId: number) => {
    return socialExtQueries.getTeamChildren(teamId);
  });
  ipcMain.handle('db:team-ancestors', (_event, teamId: number) => {
    return socialExtQueries.getTeamAncestors(teamId);
  });

  // ── Social extended: message edit ──
  ipcMain.handle('db:team-message-edit', (_event, teamId: number, messageId: string, googleId: string, content: string) => {
    return socialExtQueries.updateTeamMessage(teamId, messageId, googleId, content);
  });

  // ── Social extended: chat read ──
  ipcMain.handle('db:team-chat-mark-read', (_event, teamId: number, googleId: string) => {
    socialExtQueries.markTeamChatRead(teamId, googleId);
  });
  ipcMain.handle('db:unread-team-chats', (_event, googleId: string) => {
    return socialExtQueries.getUnreadTeamChats(googleId);
  });
  ipcMain.handle('db:unread-counts', (_event, googleId: string) => {
    return socialExtQueries.getUnreadCounts(googleId);
  });

  // ── Social extended: todo update/delete ──
  ipcMain.handle('db:team-todo-update', (_event, teamId: number, todoId: string, updates: Record<string, unknown>) => {
    return socialExtQueries.updateTeamTodo(teamId, todoId, updates);
  });
  ipcMain.handle('db:team-todo-delete', (_event, teamId: number, todoId: string) => {
    return socialExtQueries.deleteTeamTodo(teamId, todoId);
  });
  ipcMain.handle('db:my-tasks', (_event, googleId: string) => {
    return socialExtQueries.getMyAssignedTodos(googleId);
  });

  // ── Social extended: DM operations ──
  ipcMain.handle('db:dm-mark-read', (_event, googleId: string, messageId: string) => {
    socialExtQueries.markMessageRead(googleId, messageId);
  });
  ipcMain.handle('db:dm-delete', (_event, googleId: string, messageId: string) => {
    return socialExtQueries.deleteDirectMessage(googleId, messageId);
  });

  // ── Social extended: comments ──
  ipcMain.handle('db:comments-get', (_event, paperLink?: string) => {
    return socialExtQueries.getComments(paperLink);
  });
  ipcMain.handle('db:comment-create', (_event, googleId: string, data: { paperLink: string; content: string; author?: string; parentId?: string }) => {
    return socialExtQueries.createComment(googleId, data);
  });
  ipcMain.handle('db:comment-delete', (_event, googleId: string, commentId: string) => {
    return socialExtQueries.deleteComment(googleId, commentId);
  });

  // ── Social extended: reposts ──
  ipcMain.handle('db:repost-create', (_event, googleId: string, username: string, paperLink: string, paperTitle: string) => {
    return socialExtQueries.createRepost(googleId, username, paperLink, paperTitle);
  });
  ipcMain.handle('db:repost-delete', (_event, googleId: string, paperLink: string) => {
    socialExtQueries.deleteRepost(googleId, paperLink);
  });
  ipcMain.handle('db:user-reposts', (_event, googleId: string, limit?: number) => {
    return socialExtQueries.getUserReposts(googleId, limit);
  });

  // ── Social extended: blog votes ──
  ipcMain.handle('db:blog-vote', (_event, blogAuthor: string, blogSlug: string, voterGoogleId: string, vote: number) => {
    return socialExtQueries.setBlogVote(blogAuthor, blogSlug, voterGoogleId, vote);
  });
  ipcMain.handle('db:blog-votes', (_event, blogAuthor: string, blogSlug: string, viewerGoogleId?: string) => {
    return socialExtQueries.getBlogVotes(blogAuthor, blogSlug, viewerGoogleId);
  });

  // ── Social extended: achievements ──
  ipcMain.handle('db:achievements', (_event, googleId: string) => {
    return socialExtQueries.getUserAchievements(googleId);
  });
  ipcMain.handle('db:achievement-grant', (_event, googleId: string, achievementId: string) => {
    return socialExtQueries.grantAchievement(googleId, achievementId);
  });

  // ── Social extended: user profiles ──
  ipcMain.handle('db:public-user-info', (_event, username: string) => {
    return socialExtQueries.getPublicUserInfo(username);
  });
  ipcMain.handle('db:user-public-stats', (_event, googleId: string) => {
    return socialExtQueries.getUserPublicStats(googleId);
  });
  ipcMain.handle('db:user-recent-comments', (_event, googleId: string, limit?: number) => {
    return socialExtQueries.getUserRecentComments(googleId, limit);
  });
  ipcMain.handle('db:user-public-teams', (_event, googleId: string, viewerGoogleId?: string) => {
    return socialExtQueries.getUserPublicTeams(googleId, viewerGoogleId);
  });
  ipcMain.handle('db:user-feed-sources', (_event, googleId: string) => {
    return socialExtQueries.getUserFeedSources(googleId);
  });
  ipcMain.handle('db:user-accent-color', (_event, googleId: string) => {
    return socialExtQueries.getUserAccentColor(googleId);
  });
  ipcMain.handle('db:are-teammates', (_event, gidA: string, gidB: string) => {
    return socialExtQueries.areTeammates(gidA, gidB);
  });

  // ── Feed extensions ──
  ipcMain.handle('db:blocked-titles-get', () => {
    return feedQueries.getBlockedTitles();
  });
  ipcMain.handle('db:blocked-titles-set', (_event, titles: string[]) => {
    feedQueries.setBlockedTitles(titles);
  });
  ipcMain.handle('db:quality-prompt-get', () => {
    return feedQueries.getQualityPrompt();
  });
  ipcMain.handle('db:quality-prompt-set', (_event, prompt: string | null) => {
    feedQueries.setQualityPrompt(prompt);
  });

  // ── Experiment file operations ──

  ipcMain.handle('db:exp-list', (_event, googleId: string) => {
    const vault = _getUserVaultPath(googleId);
    if (!fs.existsSync(vault)) return [];
    const experiments: any[] = [];
    for (const name of fs.readdirSync(vault).sort()) {
      const full = path.join(vault, name);
      if (!fs.statSync(full).isDirectory() || name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      // Walk for last-modified timestamp
      let maxTs = 0;
      const walk = (dir: string) => {
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(fullPath); }
            else { try { const mt = fs.statSync(fullPath).mtimeMs / 1000; if (mt > maxTs) maxTs = mt; } catch {} }
          }
        } catch {}
      };
      walk(full);
      experiments.push({ id: name, title: name, desc: '', lastUpdated: maxTs, runCount: 0, runs: [] });
    }
    experiments.sort((a, b) => b.lastUpdated - a.lastUpdated);
    return experiments;
  });

  ipcMain.handle('db:exp-get', (_event, googleId: string, expId: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return null;
    const title = expId === '_root' ? 'Vault' : expId;
    return { id: expId, title, desc: '', runs: [] };
  });

  ipcMain.handle('db:exp-create', (_event, googleId: string, title: string) => {
    const vault = _getUserVaultPath(googleId);
    const slug = _uniqueSlug(vault, _slugify(title));
    fs.mkdirSync(path.join(vault, slug), { recursive: true });
    return { id: slug, title: slug, desc: '', runs: [] };
  });

  ipcMain.handle('db:exp-delete', (_event, googleId: string, expId: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    fs.rmSync(expDir, { recursive: true, force: true });
    return { ok: true };
  });

  ipcMain.handle('db:exp-files', (_event, googleId: string, expId: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const files: string[] = [];
    const dirsWithFiles = new Set<string>();
    const allDirs = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(expDir, fullPath);
        if (entry.isDirectory()) {
          const top = rel.split(path.sep)[0];
          allDirs.add(top);
          walk(fullPath);
        } else if (!SKIP_FILES.has(entry.name) && !entry.name.startsWith('.')) {
          files.push(rel);
          const parts = rel.split(path.sep);
          if (parts.length > 1) dirsWithFiles.add(parts[0]);
        }
      }
    };
    walk(expDir);
    // Also gather top-level dirs
    for (const d of fs.readdirSync(expDir)) {
      if (!SKIP_DIRS.has(d) && fs.statSync(path.join(expDir, d)).isDirectory()) allDirs.add(d);
    }
    files.sort();
    const emptyDirs = [...allDirs].filter(d => !dirsWithFiles.has(d)).sort();
    return { files, emptyDirs };
  });

  ipcMain.handle('db:exp-file-get', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || fname.includes('..')) return { error: 'Invalid path' };
    const fpath = path.join(expDir, fname);
    if (!fs.existsSync(fpath) || !fs.statSync(fpath).isFile()) return { error: 'Not found' };
    const ext = path.extname(fname).toLowerCase();
    if (ext in BINARY_MIME) {
      const data = fs.readFileSync(fpath).toString('base64');
      const mime = BINARY_MIME[ext];
      return { name: fname, content: `data:${mime};base64,${data}`, binary: true, mime };
    }
    try {
      const content = fs.readFileSync(fpath, 'utf-8');
      return { name: fname, content };
    } catch {
      const data = fs.readFileSync(fpath).toString('base64');
      return { name: fname, content: `data:application/octet-stream;base64,${data}`, binary: true, mime: 'application/octet-stream' };
    }
  });

  ipcMain.handle('db:exp-file-create', (_event, googleId: string, expId: string, name: string, content?: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const ALLOWED = ['.md', '.ipynb', '.py', '.tex', '.png', '.svg', '.mermaid', '.draw', '.slides'];
    if (!name || !ALLOWED.some(e => name.endsWith(e))) return { error: `Name must end with ${ALLOWED.join(', ')}` };
    const fpath = path.join(expDir, name);
    if (fs.existsSync(fpath)) return { error: 'File already exists' };
    if (name.endsWith('.png') || name.endsWith('.svg')) {
      if (content) {
        const b64 = content.includes(',') ? content.split(',')[1] : content;
        fs.writeFileSync(fpath, Buffer.from(b64, 'base64'));
      } else {
        fs.writeFileSync(fpath, '');
      }
    } else if (content != null) {
      fs.writeFileSync(fpath, content);
    } else if (name.endsWith('.ipynb')) {
      fs.writeFileSync(fpath, JSON.stringify({ cells: [{ cell_type: 'code', source: '', outputs: [] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }, null, 2));
    } else if (name.endsWith('.draw')) {
      fs.writeFileSync(fpath, JSON.stringify({ version: 1, objects: [] }));
    } else if (name.endsWith('.slides')) {
      fs.writeFileSync(fpath, JSON.stringify({ version: 1, slides: [{ id: 'slide-1', objects: [], background: null }] }));
    } else {
      fs.writeFileSync(fpath, '');
    }
    return { name };
  });

  ipcMain.handle('db:exp-file-update', (_event, googleId: string, expId: string, fname: string, body: { content?: string; rename?: string }) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || fname.includes('..')) return { error: 'Invalid path' };
    const fpath = path.join(expDir, fname);
    if (body.rename) {
      if (!fs.existsSync(fpath)) return { error: 'Not found' };
      const newPath = path.join(expDir, body.rename);
      if (fs.existsSync(newPath)) return { error: 'File already exists' };
      fs.renameSync(fpath, newPath);
      return { ok: true, name: body.rename };
    }
    const parentDir = path.dirname(fpath);
    fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(fpath, body.content ?? '');
    return { ok: true };
  });

  ipcMain.handle('db:exp-file-delete', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || fname.includes('..')) return { error: 'Invalid path' };
    const fpath = path.join(expDir, fname);
    if (!fs.existsSync(fpath) || !fs.statSync(fpath).isFile()) return { error: 'Not found' };
    fs.unlinkSync(fpath);
    return { ok: true };
  });

  ipcMain.handle('db:exp-create-folder', (_event, googleId: string, expId: string, name: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (!name || name.includes('..') || name.includes('/')) return { error: 'Invalid folder name' };
    const folderPath = path.join(expDir, name);
    if (fs.existsSync(folderPath)) return { error: 'Folder already exists' };
    fs.mkdirSync(folderPath);
    return { ok: true, name };
  });

  ipcMain.handle('db:exp-delete-folder', (_event, googleId: string, expId: string, folder: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (!folder || folder.includes('..') || folder.includes('/')) return { error: 'Invalid folder name' };
    const folderPath = path.join(expDir, folder);
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return { error: 'Folder not found' };
    fs.rmSync(folderPath, { recursive: true });
    return { ok: true };
  });

  ipcMain.handle('db:exp-rename-folder', (_event, googleId: string, expId: string, oldName: string, newName: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (!oldName || oldName.includes('..') || oldName.includes('/')) return { error: 'Invalid old folder name' };
    if (!newName || newName.includes('..') || newName.includes('/')) return { error: 'Invalid new folder name' };
    const oldPath = path.join(expDir, oldName);
    const newPath = path.join(expDir, newName);
    if (!fs.existsSync(oldPath) || !fs.statSync(oldPath).isDirectory()) return { error: 'Folder not found' };
    if (fs.existsSync(newPath)) return { error: 'A folder with that name already exists' };
    fs.renameSync(oldPath, newPath);
    return { ok: true, name: newName };
  });

  ipcMain.handle('db:exp-move-file', (_event, googleId: string, expId: string, oldPath: string, newFilePath: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (!oldPath || oldPath.includes('..') || !newFilePath || newFilePath.includes('..')) return { error: 'Invalid path' };
    const src = path.join(expDir, oldPath);
    const dst = path.join(expDir, newFilePath);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return { error: 'Source file not found' };
    if (fs.existsSync(dst)) return { error: 'Destination already exists' };
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return { ok: true, name: newFilePath };
  });

  ipcMain.handle('db:exp-raw-file', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || fname.includes('..')) return null;
    const fpath = path.join(expDir, fname);
    if (!fs.existsSync(fpath) || !fs.statSync(fpath).isFile()) return null;
    const ext = path.extname(fname).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
      '.pdf': 'application/pdf',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const data = fs.readFileSync(fpath).toString('base64');
    return { data, mime, size: Buffer.byteLength(data, 'base64') };
  });
}
