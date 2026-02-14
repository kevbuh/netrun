import { ipcMain, BrowserWindow, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { toolRegistry } from './tools/index.js';
import type { ToolContext } from './tools/types.js';
import { providerRegistry } from './providers/registry.js';
import { OllamaProvider } from './providers/ollama.js';
import { runAgent } from './agents/runtime.js';
import { researchAssistant } from './agents/builtin/research-assistant.js';
import type { AgentContext, AgentMessage, AgentEvent } from './agents/types.js';
import * as calendarQueries from './db/queries/calendar.js';
import * as userQueries from './db/queries/users.js';
import * as feedQueries from './db/queries/feeds.js';
import * as socialQueries from './db/queries/social.js';
import * as embeddingQueries from './db/queries/embeddings.js';
import * as contentQueries from './db/queries/content.js';
import { ambientObserver } from './ambient/index.js';
import * as socialExtQueries from './db/queries/social-extended.js';
import { getDb } from './db/connection.js';

// ── Ollama provider (singleton) ──

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const ollamaProvider = new OllamaProvider({ baseURL: OLLAMA_HOST });

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  ?? '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com';

// ── In-memory fetch cache (TTL-based) ──

const _fetchCache = new Map<string, { data: Buffer; ts: number }>();
const FETCH_CACHE_TTL = 300_000; // 5 min

async function cachedFetch(url: string, timeoutMs = 15_000): Promise<Buffer> {
  const now = Date.now();
  const cached = _fetchCache.get(url);
  if (cached && now - cached.ts < FETCH_CACHE_TTL) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: controller.signal,
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    _fetchCache.set(url, { data: buf, ts: now });
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

// ── Quote snapping (ported from Python _snap_quote_to_text) ──

function _snapQuoteToText(quote: string, text: string): string | null {
  if (!quote || !text) return null;
  const textLower = text.toLowerCase();
  const quoteLower = quote.toLowerCase();

  // Exact match
  const idx = textLower.indexOf(quoteLower);
  if (idx !== -1) return text.slice(idx, idx + quote.length);

  // Progressive prefix trimming
  const quoteWords = quoteLower.split(/\s+/);
  if (quoteWords.length < 3) return null;

  for (let trim = 0; trim < Math.min(Math.floor(quoteWords.length / 2), 8); trim++) {
    const end = quoteWords.length - trim;
    const partial = quoteWords.slice(0, end).join(' ');
    const pIdx = textLower.indexOf(partial);
    if (pIdx !== -1) {
      const grabLen = Math.min(quote.length + 20, text.length - pIdx);
      const candidate = text.slice(pIdx, pIdx + grabLen);
      const words = candidate.split(/\s+/);
      const targetWords = quote.split(/\s+/).length;
      const snapped = words.slice(0, targetWords).join(' ');
      return snapped.length >= 15 ? snapped : null;
    }
  }

  // Bigram sliding window
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const qBigrams = bigrams(quoteLower);
  if (qBigrams.size === 0) return null;

  let bestScore = 0;
  let bestStart = -1;
  const window = quote.length;
  const step = Math.max(1, Math.floor(window / 4));

  for (let start = 0; start <= textLower.length - window; start += step) {
    const candidate = textLower.slice(start, start + window);
    const cBigrams = bigrams(candidate);
    const intersection = [...qBigrams].filter(b => cBigrams.has(b)).length;
    const union = new Set([...qBigrams, ...cBigrams]).size;
    const score = union > 0 ? intersection / union : 0;
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }

  // Refine
  if (bestStart >= 0 && bestScore > 0.4) {
    const searchStart = Math.max(0, bestStart - step);
    const searchEnd = Math.min(textLower.length - window + 1, bestStart + step + 1);
    for (let start = searchStart; start < searchEnd; start++) {
      const candidate = textLower.slice(start, start + window);
      const cBigrams = bigrams(candidate);
      const intersection = [...qBigrams].filter(b => cBigrams.has(b)).length;
      const union = new Set([...qBigrams, ...cBigrams]).size;
      const score = union > 0 ? intersection / union : 0;
      if (score > bestScore) { bestScore = score; bestStart = start; }
    }
  }

  if (bestScore >= 0.55 && bestStart >= 0) {
    while (bestStart > 0 && !' \t\n'.includes(text[bestStart - 1])) bestStart--;
    let end = bestStart + window;
    while (end < text.length && !' \t\n'.includes(text[end])) end++;
    const snapped = text.slice(bestStart, end).trim();
    return snapped.length >= 15 ? snapped : null;
  }

  return null;
}

// ── Saved content cache (disk) ──

const CONTENT_CACHE_DIR = path.join(process.env.HOME ?? '/tmp', '.aether_cache', 'content');
fs.mkdirSync(CONTENT_CACHE_DIR, { recursive: true });

function _contentPath(url: string): string {
  const h = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return path.join(CONTENT_CACHE_DIR, h + '.json');
}

// ── Annotation prompt file ──

const DATA_DIR = path.join(process.env.HOME ?? '/tmp', '.aether_data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const ANNOTATION_PROMPT_FILE = path.join(DATA_DIR, 'annotation_prompt.txt');

// ── Active doc-chat / vault-chat sessions ──

const activeDocChatSessions = new Map<string, AbortController>();

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

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 1: External HTTP Calls
  // ═══════════════════════════════════════════════════════════════════════

  // ── Auth: Google login ──
  ipcMain.handle('db:auth-google', async (_event, credential: string) => {
    if (!credential) return { error: 'Missing credential' };
    try {
      const verifyUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential);
      const resp = await fetch(verifyUrl, { signal: AbortSignal.timeout(10_000) });
      const tokenInfo = await resp.json() as any;
      if (tokenInfo.aud !== GOOGLE_CLIENT_ID) return { error: 'Invalid token audience' };
      // Decode JWT payload
      const parts = credential.split('.');
      const padded = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4);
      const jwtPayload = JSON.parse(Buffer.from(padded, 'base64url').toString());
      const googleId = tokenInfo.sub;
      const email = tokenInfo.email ?? '';
      const name = tokenInfo.name ?? jwtPayload.name ?? '';
      const picture = tokenInfo.picture ?? jwtPayload.picture ?? '';
      if (!googleId) return { error: 'Invalid token' };
      userQueries.upsertUser({ google_id: googleId, email, name, picture });
      const token = userQueries.createSession(googleId);
      const info = userQueries.getUser(googleId);
      const username = info?.username ?? null;
      return { token, email, name, username, picture, google_id: googleId };
    } catch (e: any) {
      return { error: `Token verification failed: ${e.message ?? e}` };
    }
  });

  // ── Semantic Scholar API ──
  ipcMain.handle('db:author-details', async (_event, authorId: string) => {
    if (!authorId) return { error: 'authorId required' };
    try {
      const s2Url = `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}?fields=name,affiliations,homepage,hIndex,citationCount,paperCount,url`;
      const [authorResp, papersResp] = await Promise.all([
        fetch(s2Url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) }),
        fetch(`https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}/papers?fields=title,year,citationCount,url,venue&limit=10`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) }),
      ]);
      const authorData = await authorResp.json() as any;
      const papersData = await papersResp.json() as any;
      const papers = (papersData.data ?? []).sort((a: any, b: any) => (b.citationCount ?? 0) - (a.citationCount ?? 0));
      return {
        name: authorData.name ?? '', affiliations: authorData.affiliations ?? [],
        homepage: authorData.homepage, hIndex: authorData.hIndex,
        citationCount: authorData.citationCount, paperCount: authorData.paperCount,
        url: authorData.url, papers: papers.slice(0, 10),
      };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:citation-lookup', async (_event, query: string) => {
    if (!query) return { error: 'query required' };
    try {
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=1&fields=title,authors,year,abstract,citationCount,url,venue,externalIds`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
      const data = await resp.json() as any;
      const papers = data.data ?? [];
      if (!papers.length) return { error: 'not found' };
      const p = papers[0];
      return {
        title: p.title ?? '', authors: (p.authors ?? []).slice(0, 5).map((a: any) => a.name ?? ''),
        year: p.year, abstract: p.abstract?.slice(0, 500) ?? null,
        citationCount: p.citationCount, venue: p.venue, url: p.url,
        arxivId: p.externalIds?.ArXiv ?? null,
      };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:paper-references', async (_event, arxivId: string, refNum?: number) => {
    if (!arxivId) return { error: 'arxivId required' };
    try {
      let references = contentQueries.getCachedReferences(arxivId) as any[] | null;
      if (references === null) {
        const url = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${encodeURIComponent(arxivId)}?fields=references.title,references.authors,references.year,references.abstract,references.citationCount,references.url,references.venue,references.externalIds`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
        const data = await resp.json() as any;
        references = data.references ?? [];
        contentQueries.setCachedReferences(arxivId, references!);
      }
      if (!references || !references.length) return { error: 'no references found' };
      if (refNum != null && refNum >= 1) {
        const ref = references[refNum - 1];
        if (!ref) return { error: `reference ${refNum} not found (paper has ${references.length} references)` };
        return {
          title: ref.title ?? '', authors: (ref.authors ?? []).slice(0, 5).map((a: any) => a.name ?? ''),
          year: ref.year, abstract: ref.abstract?.slice(0, 500) ?? null,
          citationCount: ref.citationCount, venue: ref.venue, url: ref.url,
          arxivId: ref.externalIds?.ArXiv ?? null,
        };
      }
      const result = references.filter(Boolean).map((ref: any, i: number) => ({
        num: i + 1, title: ref.title ?? '',
        authors: (ref.authors ?? []).slice(0, 3).map((a: any) => a.name ?? ''),
        year: ref.year, citationCount: ref.citationCount,
      }));
      return { references: result, total: references.length };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:author-lookup', async (_event, query: string) => {
    if (!query) return { error: 'query required' };
    try {
      const { data: cached, needsRefresh } = contentQueries.getCachedAuthor(query) as { data: any; needsRefresh: boolean };
      if (cached && !needsRefresh) return cached;
      try {
        const url = `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(query)}&limit=1&fields=name,affiliations,paperCount,citationCount,hIndex,url`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
        const data = await resp.json() as any;
        const authors = data.data ?? [];
        if (!authors.length) return cached ?? { error: 'not found' };
        const author = authors[0];
        let topPapers: any[] = [];
        if (author.authorId) {
          try {
            const pUrl = `https://api.semanticscholar.org/graph/v1/author/${author.authorId}/papers?fields=title,year,citationCount&limit=3&sort=citationCount:desc`;
            const pResp = await fetch(pUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
            const pData = await pResp.json() as any;
            topPapers = (pData.data ?? []).slice(0, 3).map((p: any) => ({ title: p.title ?? '', year: p.year, citationCount: p.citationCount ?? 0 }));
          } catch {
            if (cached?.topPapers) topPapers = cached.topPapers;
          }
        }
        const result = {
          authorId: author.authorId, name: author.name ?? '',
          affiliations: author.affiliations ?? [], paperCount: author.paperCount,
          citationCount: author.citationCount, hIndex: author.hIndex,
          url: author.url, topPapers,
        };
        contentQueries.setCachedAuthor(query, result);
        return result;
      } catch {
        if (cached) return cached;
        throw new Error('API request failed');
      }
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:citations-batch', async (_event, arxivIds: string[]) => {
    if (!arxivIds?.length) return { error: 'ids required' };
    try {
      const paperIds = arxivIds.map(id => `ArXiv:${id}`);
      const resp = await fetch('https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount,externalIds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ ids: paperIds }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await resp.json() as any[];
      const result: Record<string, number> = {};
      for (const item of data) {
        if (item?.externalIds?.ArXiv) {
          result[item.externalIds.ArXiv] = item.citationCount ?? 0;
        }
      }
      return result;
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Browse utilities ──
  ipcMain.handle('db:check-embed', async (_event, url: string) => {
    if (!url) return { embeddable: false };
    try {
      const resp = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
      const xfo = (resp.headers.get('x-frame-options') ?? '').toUpperCase();
      const csp = resp.headers.get('content-security-policy') ?? '';
      return { embeddable: !xfo && !csp.includes('frame-ancestors') };
    } catch { return { embeddable: false }; }
  });

  ipcMain.handle('db:link-preview', async (_event, url: string) => {
    if (!url) return { error: 'url required' };
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(8_000),
      });
      const html = (await resp.text()).slice(0, 200_000);
      const meta = (prop: string): string => {
        for (const attr of ['property', 'name']) {
          const m = html.match(new RegExp(`<meta\\s+${attr}="${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+content="([^"]*)"`, 'i'))
            ?? html.match(new RegExp(`<meta\\s+content="([^"]*)"\\s+${attr}="${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i'));
          if (m) return m[1];
        }
        return '';
      };
      let title = meta('og:title') || meta('twitter:title');
      if (!title) {
        const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        title = m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
      }
      const desc = meta('og:description') || meta('twitter:description') || meta('description');
      let image = meta('og:image') || meta('twitter:image');
      if (image && !image.startsWith('http')) {
        const u = new URL(url);
        if (image.startsWith('//')) image = u.protocol + image;
        else if (image.startsWith('/')) image = u.origin + image;
        else image = url.replace(/\/[^/]*$/, '/') + image;
      }
      const site = meta('og:site_name');
      const u = new URL(url);
      const domain = u.hostname.replace(/^www\./, '');
      const favicon = u.origin + '/favicon.ico';
      return { title: title.slice(0, 200), description: desc.slice(0, 300), image, site: site || domain, favicon, domain };
    } catch (e: any) {
      return { title: '', description: '', image: '', site: '', domain: '', error: e.message ?? String(e) };
    }
  });

  ipcMain.handle('db:stock-quote', async (_event, symbol: string) => {
    if (!symbol) return { error: 'symbol required' };
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?range=1d&interval=1d`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5_000) });
      const data = await resp.json() as any;
      const result = data?.chart?.result?.[0] ?? {};
      const m = result.meta ?? {};
      const price = m.regularMarketPrice ?? 0;
      const prev = m.chartPreviousClose ?? 0;
      const change = prev ? Math.round((price - prev) * 100) / 100 : 0;
      const changePct = prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0;
      const name = m.shortName ?? m.longName ?? symbol;
      return { price, change, changePercent: changePct, name };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:extract-links', async (_event, url: string) => {
    if (!url) return { error: 'url required' };
    try {
      const buf = await cachedFetch(url, 30_000);
      const html = buf.toString('utf-8');
      const linkRegex = /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      const seen = new Set<string>();
      const links: Array<{ text: string; url: string }> = [];
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        let href = match[1];
        const text = match[2].replace(/<[^>]+>/g, '').trim();
        if (!text || !href) continue;
        try {
          href = new URL(href, url).href;
        } catch { continue; }
        if (!href.startsWith('http')) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        links.push({ text, url: href });
      }
      return { links };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── arXiv search (returns raw XML for frontend parsing) ──
  ipcMain.handle('db:arxiv-search-xml', async (_event, query: string, start?: number, maxResults?: number) => {
    try {
      const q = encodeURIComponent(query);
      const s = start ?? 0;
      const m = maxResults ?? 100;
      const url = `https://export.arxiv.org/api/query?search_query=all:${q}&start=${s}&max_results=${m}&sortBy=relevance&sortOrder=descending`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30_000) });
      return { xml: await resp.text() };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Feed proxies ──
  ipcMain.handle('db:feed-arxiv', async () => {
    try {
      const buf = await cachedFetch('https://rss.arxiv.org/rss/cs');
      return { _proxy: true, data: buf.toString('base64'), mime: 'application/xml' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:feed-hn', async () => {
    try {
      const resp = await fetch('https://hacker-news.firebaseio.com/v0/beststories.json', {
        headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000),
      });
      const ids = ((await resp.json()) as number[]).slice(0, 30);
      const items = await Promise.all(ids.map(async (id) => {
        try {
          const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000),
          });
          return await r.json();
        } catch { return null; }
      }));
      return items.filter((it: any) => it && it.type === 'story');
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:feed-polymarket', async () => {
    try {
      const buf = await cachedFetch('https://polymarket.com/breaking', 15_000);
      const html = buf.toString('utf-8');
      const marker = '__NEXT_DATA__" type="application/json" crossorigin="anonymous">';
      const idx = html.indexOf(marker);
      if (idx === -1) return { error: 'Could not find data' };
      const start = idx + marker.length;
      const end = html.indexOf('</script>', start);
      const nextData = JSON.parse(html.slice(start, end));
      const queries = nextData.props.pageProps.dehydratedState.queries;
      let markets: any[] = [];
      for (const q of queries) {
        if ((q.queryKey ?? []).includes('biggest-movers')) {
          markets = q.state.data?.markets ?? [];
          break;
        }
      }
      return markets.map((m: any) => {
        const prices = m.outcomePrices ?? ['0', '0'];
        const yesPct = Math.round(parseFloat(prices[0]) * 100);
        const changePct = Math.round((m.oneDayPriceChange ?? 0) * 100);
        const volume = m.events?.[0] ? Math.round(m.events[0].volume ?? 0) : 0;
        return {
          question: m.question ?? '', slug: m.slug ?? '',
          url: m.events?.[0] ? `https://polymarket.com/event/${m.events[0].slug}` : `https://polymarket.com/event/${m.slug ?? ''}`,
          image: m.image ?? '', yesPct, changePct, volume,
        };
      });
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:rss-proxy', async (_event, feedUrl: string) => {
    if (!feedUrl) return { error: 'url required' };
    try {
      const buf = await cachedFetch(feedUrl);
      return { _proxy: true, data: buf.toString('base64'), mime: 'application/xml' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:feed-items-custom', async (_event, feeds: Array<{ name?: string; url: string }>) => {
    if (!feeds?.length) return [];
    // Fetch each custom feed's RSS and parse items
    const results: any[] = [];
    for (const f of feeds) {
      const name = f.name ?? f.url;
      const sourceKey = `custom:${name}`;
      // Check DB for fresh data
      const existing = feedQueries.getFeedItems([sourceKey], 100);
      if (existing.length > 0) {
        results.push(...existing);
        continue;
      }
      // Fetch and parse RSS
      try {
        const buf = await cachedFetch(f.url, 15_000);
        const xml = buf.toString('utf-8');
        const items: any[] = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
        let match;
        while ((match = itemRegex.exec(xml)) !== null) {
          const block = match[1];
          const tag = (t: string) => { const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''; };
          const title = tag('title');
          const link = tag('link');
          if (!title || !link) continue;
          items.push({
            source: sourceKey, title, link,
            authors: tag('dc:creator') || tag('author'),
            categories: '[]', description: tag('description').slice(0, 500),
            display_date: tag('pubDate') || tag('dc:date'),
            pub_date: tag('pubDate') || tag('dc:date'),
            arxiv_id: null, extra: '{}',
          });
        }
        if (items.length) {
          feedQueries.upsertFeedItems(items);
          results.push(...items.map(it => ({ ...it, categories: [], date: it.display_date, pubDate: it.pub_date })));
        }
      } catch { /* skip failed feeds */ }
    }
    return results;
  });

  // ── File proxies (return base64 for IPC) ──
  ipcMain.handle('db:image-proxy', async (_event, url: string) => {
    if (!url) return { error: 'Missing url' };
    try {
      const buf = await cachedFetch(url, 15_000);
      const ext = url.split('.').pop()?.toLowerCase().split('?')[0] ?? '';
      const ctMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' };
      return { _proxy: true, data: buf.toString('base64'), mime: ctMap[ext] ?? 'image/png' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:arxiv-pdf', async (_event, arxivId: string) => {
    if (!arxivId) return { error: 'id required' };
    try {
      const url = `https://arxiv.org/pdf/${encodeURIComponent(arxivId)}.pdf`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30_000) });
      const buf = Buffer.from(await resp.arrayBuffer());
      return { _proxy: true, data: buf.toString('base64'), mime: 'application/pdf' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:pdf-proxy', async (_event, url: string) => {
    if (!url?.startsWith('http')) return { error: 'url required' };
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30_000) });
      const buf = Buffer.from(await resp.arrayBuffer());
      return { _proxy: true, data: buf.toString('base64'), mime: 'application/pdf' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 2: Simple Ollama Calls
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:panel-suggest', async (_event, text: string) => {
    if (!text || text.length < 3) return { suggestion: '' };
    try {
      const result = await ollamaProvider.chat({
        model: 'qwen3:0.6b',
        messages: [
          { role: 'system', content: 'Given some text the user selected or is looking at, suggest ONE short question (under 12 words) they might want to ask about it. Return ONLY the question, nothing else. No quotes.' },
          { role: 'user', content: text.slice(0, 300) },
        ],
        temperature: 0.7,
        maxTokens: 40,
      });
      let suggestion = (result.message.content ?? '').trim().replace(/^["']|["']$/g, '');
      suggestion = suggestion.split('\n')[0].trim();
      if (suggestion.length > 80) suggestion = suggestion.slice(0, 77) + '\u2026';
      return { suggestion };
    } catch { return { suggestion: '' }; }
  });

  ipcMain.handle('db:search-suggest', async (_event, query: string) => {
    if (!query || query.length < 2) return { suggestions: [] };
    try {
      const result = await ollamaProvider.chat({
        model: 'qwen3:0.6b',
        messages: [
          { role: 'system', content: 'You are a search autocomplete engine. Given a partial search query, suggest 4 completions. Return ONLY a JSON array of strings, nothing else. Example: ["machine learning basics", "machine learning tutorial"]' },
          { role: 'user', content: query },
        ],
        temperature: 0.7,
        maxTokens: 120,
      });
      const raw = (result.message.content ?? '').trim();
      const arrMatch = raw.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        const parsed = JSON.parse(arrMatch[0]);
        return { suggestions: parsed.filter((s: any) => typeof s === 'string' && s.trim()).slice(0, 4) };
      }
      return { suggestions: [] };
    } catch { return { suggestions: [] }; }
  });

  ipcMain.handle('db:quality-filter', async (_event, body: { titles: string[]; mode?: string; prompt?: string; interest_context?: string }) => {
    const { titles, mode = 'verdict', interest_context } = body;
    if (!titles?.length) return { error: 'titles required' };
    try {
      if (mode === 'score') {
        let scoreSystem = 'Rate the following paper/article title on a scale of 0-100 for quality, novelty, and interest. Return ONLY the number, nothing else.';
        if (interest_context) {
          scoreSystem += `\n\nThe reader's interests: ${interest_context.slice(0, 500)}\nBoost scores for content matching these interests, but still score objectively.`;
        }
        const promptHash = createHash('sha256').update(scoreSystem).digest('hex').slice(0, 16);
        const results: Record<string, number> = {};
        const uncached: string[] = [];
        for (const t of titles) {
          const cached = feedQueries.getQualityCache(createHash('sha256').update(t).digest('hex').slice(0, 16), promptHash);
          if (cached?.score != null) results[t] = cached.score;
          else uncached.push(t);
        }
        if (uncached.length) {
          const scored = await Promise.all(uncached.map(async (t) => {
            try {
              const r = await ollamaProvider.chat({
                model: 'qwen3:8b',
                messages: [{ role: 'system', content: scoreSystem }, { role: 'user', content: t }],
                temperature: 0,
                maxTokens: 8,
              });
              const raw = (r.message.content ?? '').trim();
              const m = raw.match(/\d+/);
              return { title: t, score: Math.max(0, Math.min(100, m ? parseInt(m[0]) : 50)) };
            } catch { return { title: t, score: 50 }; }
          }));
          for (const { title, score } of scored) {
            results[title] = score;
            feedQueries.setQualityCache(createHash('sha256').update(title).digest('hex').slice(0, 16), promptHash, 'score', score);
          }
        }
        return results;
      } else {
        // verdict mode
        const systemMsg = body.prompt?.trim() || 'You are a content quality filter. Given a paper/article title, respond with ONLY "keep" or "hide". Keep titles that are interesting, novel, or important. Hide clickbait, low-quality, or boring titles.';
        const promptHash = createHash('sha256').update(systemMsg).digest('hex').slice(0, 16);
        const results: Record<string, string> = {};
        const uncached: string[] = [];
        for (const t of titles) {
          const cached = feedQueries.getQualityCache(createHash('sha256').update(t).digest('hex').slice(0, 16), promptHash);
          if (cached?.verdict) results[t] = cached.verdict;
          else uncached.push(t);
        }
        if (uncached.length) {
          const classified = await Promise.all(uncached.map(async (t) => {
            try {
              const r = await ollamaProvider.chat({
                model: 'qwen3:8b',
                messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: t }],
                temperature: 0,
                maxTokens: 8,
              });
              const raw = (r.message.content ?? '').trim().toLowerCase();
              return { title: t, verdict: raw.includes('hide') ? 'hide' : 'keep' };
            } catch { return { title: t, verdict: 'keep' }; }
          }));
          for (const { title, verdict } of classified) {
            results[title] = verdict;
            feedQueries.setQualityCache(createHash('sha256').update(title).digest('hex').slice(0, 16), promptHash, verdict, 0);
          }
        }
        return results;
      }
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 3: Embedding + Vector Search
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:embed-content', async (_event, body: { title: string; link: string; source?: string; description?: string; type?: string }) => {
    const { title, link, source = '', description = '', type: contentType = 'post' } = body;
    if (!title || !link) return { ok: true };
    // Fire-and-forget
    (async () => {
      try {
        const text = description ? `${title}. ${description.slice(0, 500)}` : title;
        const vec = await ollamaProvider.embed(text);
        if (vec.length) embeddingQueries.storeEmbedding(text, title, link, source, contentType, vec);
      } catch { /* ignore */ }
    })();
    return { ok: true };
  });

  ipcMain.handle('db:semantic-search', async (_event, body: { query: string; type?: string; limit?: number }) => {
    if (!body.query) return { error: 'query required' };
    try {
      const queryVec = await ollamaProvider.embed(body.query);
      if (!queryVec.length) return { error: 'embedding failed' };
      const limit = Math.min(body.limit ?? 20, 50);
      const results = embeddingQueries.searchEmbeddings(queryVec, body.type, limit);
      return { results };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:find-similar', async (_event, body: { title: string; link?: string; description?: string; limit?: number }) => {
    if (!body.title) return { error: 'title required' };
    try {
      const text = body.description ? `${body.title}. ${body.description.slice(0, 500)}` : body.title;
      const queryVec = await ollamaProvider.embed(text);
      if (!queryVec.length) return { error: 'embedding failed' };
      const limit = Math.min(body.limit ?? 20, 50);
      const results = embeddingQueries.searchEmbeddings(queryVec, undefined, limit, body.link);
      return { results };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:reading-connections', async (_event, body: { title: string; description?: string; readLinks: string[] }) => {
    if (!body.title || !body.readLinks?.length) return { results: [] };
    try {
      const text = body.description ? `${body.title}. ${body.description.slice(0, 500)}` : body.title;
      const queryVec = await ollamaProvider.embed(text);
      if (!queryVec.length) return { results: [] };
      const db = getDb();
      const links = body.readLinks.slice(0, 200);
      const placeholders = links.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT title, link, source, embedding, dim FROM embeddings WHERE link IN (${placeholders})`
      ).all(...links) as Array<{ title: string; link: string; source: string; embedding: Buffer; dim: number }>;
      const results = rows.map(row => {
        const vec = embeddingQueries.unpackEmbedding(row.embedding, row.dim);
        const score = embeddingQueries.cosineSimilarity(queryVec, vec);
        return { title: row.title, link: row.link, source: row.source, score: Math.round(score * 10000) / 10000 };
      }).filter(r => r.score > 0.4).sort((a, b) => b.score - a.score).slice(0, 10);
      return { results };
    } catch { return { results: [] }; }
  });


  // ═══════════════════════════════════════════════════════════════════════
  // Phase 4: Complex Ollama / Streaming
  // ═══════════════════════════════════════════════════════════════════════

  // ── Annotate ──
  ipcMain.handle('db:annotate', async (_event, body: {
    text: string; url?: string; otherTabs?: Array<{ title?: string; text?: string }>;
    interest_context?: string; model?: string;
  }) => {
    const text = (body.text ?? '').trim();
    if (!text) return { error: 'text required' };
    try {
      const mainText = text.slice(0, 12_000);
      let tabContext = '';
      for (const tab of (body.otherTabs ?? []).slice(0, 3)) {
        const tTitle = (tab.title ?? '').slice(0, 100);
        const tText = (tab.text ?? '').slice(0, 3000);
        if (tText) tabContext += `\n\n--- OTHER TAB: "${tTitle}" ---\n${tText}\n--- END TAB ---`;
      }

      // Build prompt
      let prompt = _getAnnotationPrompt();
      // Append custom categories
      const customCats = contentQueries.listAnnotationCategories();
      if (customCats.length) {
        prompt += 'Additional annotation types:\n';
        for (const cat of customCats) prompt += `- ${cat.key} — ${cat.description}\n`;
        prompt += '\n';
      }
      // Append feedback examples
      const goodExamples = contentQueries.listAnnotationFeedback('good', 10);
      const badExamples = contentQueries.listAnnotationFeedback('bad', 10);
      if (goodExamples.length) {
        prompt += 'EXAMPLES OF GOOD ANNOTATIONS (produce more like these):\n';
        for (const ex of goodExamples) prompt += `- "${(ex.quote ?? '').slice(0, 200)}"${ex.ann_type ? ` [${ex.ann_type}]` : ''}\n`;
        prompt += '\n';
      }
      if (badExamples.length) {
        prompt += 'EXAMPLES OF BAD ANNOTATIONS (avoid these):\n';
        for (const ex of badExamples) prompt += `- "${(ex.quote ?? '').slice(0, 200)}"${ex.ann_type ? ` [${ex.ann_type}]` : ''}\n`;
        prompt += '\n';
      }
      if (body.interest_context) prompt += 'USER INTERESTS:\n' + body.interest_context + '\n\n';
      prompt += '--- MAIN PAGE TEXT ---\n' + mainText + '\n--- END PAGE TEXT ---';
      if (tabContext) prompt += tabContext;

      const model = body.model ?? 'qwen2.5:3b';
      const result = await ollamaProvider.chat({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        maxTokens: 6000,
      });
      let rawContent = (result.message.content ?? '').trim();
      // Parse JSON
      rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '');
      if (rawContent.includes('```')) {
        rawContent = rawContent.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
      }
      rawContent = rawContent.trim();
      const arrMatch = rawContent.match(/\[[\s\S]*\]/);
      if (arrMatch) rawContent = arrMatch[0];
      const parsed = JSON.parse(rawContent);

      const validTypes = new Set(['ALPHA', 'CONTRADICTION', 'AD', ...customCats.map(c => c.key)]);
      const annotations: any[] = [];
      if (Array.isArray(parsed)) {
        for (const item of parsed.slice(0, 15)) {
          if (!item || typeof item !== 'object') continue;
          const atype = item.type ?? '';
          const quote = (item.quote ?? '').trim();
          const explanation = (item.explanation ?? '').trim();
          if (!validTypes.has(atype) || !quote) continue;
          const snapped = _snapQuoteToText(quote, text);
          if (!snapped) continue;
          let confidence = 70;
          try { confidence = Math.max(0, Math.min(100, parseInt(item.confidence ?? '70'))); } catch {}
          const ann: any = { type: atype, quote: snapped.slice(0, 500), explanation: explanation.slice(0, 300), confidence };
          if (atype === 'CONTRADICTION' && item.conflictsWith) ann.conflictsWith = item.conflictsWith.slice(0, 200);
          annotations.push(ann);
        }
      }

      // Cross-reference search
      try {
        const snippet = text.slice(0, 1500);
        const xrefVec = await ollamaProvider.embed(snippet);
        if (xrefVec.length) {
          const connections: any[] = [];
          const savedResults = embeddingQueries.searchEmbeddings(xrefVec, 'post', 3, body.url);
          for (const r of savedResults) {
            if (r.score > 0.75 && connections.length < 2) {
              connections.push({
                type: 'CONNECTION', explanation: `Related to saved post (similarity ${Math.round(r.score * 100)}%)`,
                confidence: Math.round(r.score * 100), linkedTitle: (r.title ?? '').slice(0, 120), linkedUrl: r.link ?? '',
              });
            }
          }
          const memResults = embeddingQueries.searchChatMemories(xrefVec, 2);
          for (const r of memResults) {
            if (r.score > 0.75 && connections.length < 2) {
              connections.push({
                type: 'CONNECTION', explanation: `Related conversation: ${(r.topics ?? '').slice(0, 80)}`,
                confidence: Math.round(r.score * 100),
                linkedTitle: r.page_title || r.summary.slice(0, 60), linkedUrl: '',
              });
            }
          }
          annotations.push(...connections);
        }
      } catch { /* cross-ref failed, continue */ }

      return { annotations };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Annotation prompt get/set ──
  ipcMain.handle('db:annotation-prompt-get', () => {
    const custom = _readAnnotationPrompt();
    const defaultPrompt = DEFAULT_ANNOTATION_PROMPT;
    let mtime: number | null = null;
    try { if (fs.existsSync(ANNOTATION_PROMPT_FILE)) mtime = fs.statSync(ANNOTATION_PROMPT_FILE).mtimeMs / 1000; } catch {}
    return { prompt: custom ?? defaultPrompt, default: defaultPrompt, isCustom: custom !== null, updatedAt: mtime };
  });

  ipcMain.handle('db:annotation-prompt-set', (_event, prompt: string | null) => {
    if (!prompt?.trim()) {
      try { if (fs.existsSync(ANNOTATION_PROMPT_FILE)) fs.unlinkSync(ANNOTATION_PROMPT_FILE); } catch {}
    } else {
      fs.writeFileSync(ANNOTATION_PROMPT_FILE, prompt.trim());
    }
    return { ok: true };
  });

  // ── Doc-chat (streaming via IPC events) ──
  ipcMain.handle('db:doc-chat-start', async (event, options: {
    sessionId: string; context?: string; messages: any[]; vision?: boolean;
    model?: string; tools?: boolean; think?: boolean;
    pageUrl?: string; pageTitle?: string;
  }) => {
    const { sessionId, context = '', messages, vision = false, tools: toolsEnabled = false, think = true } = options;
    if (!messages?.length) return { error: 'messages required' };

    const abortController = new AbortController();
    activeDocChatSessions.set(sessionId, abortController);
    const webContents = event.sender;

    const sendEvent = (ev: string, data: any) => {
      if (!webContents.isDestroyed()) webContents.send('doc-chat:event', sessionId, { event: ev, data });
    };

    (async () => {
      try {
        let model = options.model ?? '';
        let ollamaMessages: any[];

        if (vision) {
          model = model || 'qwen3-vl:8b';
          ollamaMessages = [
            { role: 'system', content: 'You are a helpful visual analysis assistant. The user has taken a screenshot and wants to ask about it. Describe what you see and answer their questions based on the visual content provided.' },
            ...messages,
          ];
        } else {
          model = model || (toolsEnabled ? 'qwen3:8b' : 'qwen2.5:3b');
          const truncatedCtx = context.slice(0, 12_000);
          const now = new Date();
          const dateStr = `CURRENT DATE AND TIME: ${now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (local time). Always use this date/time for any time-relative requests.\n\n`;
          let systemMsg: string;
          if (truncatedCtx) {
            systemMsg = toolsEnabled
              ? dateStr + 'You are the AI assistant inside Aether, a desktop research app. Answer based on the document text below.\n\n--- DOCUMENT TEXT ---\n' + truncatedCtx + '\n--- END ---'
              : dateStr + 'You are a helpful research assistant. Answer based ONLY on the document text below.\n\n--- DOCUMENT TEXT ---\n' + truncatedCtx + '\n--- END ---';
          } else {
            systemMsg = toolsEnabled
              ? dateStr + 'You are the AI assistant inside Aether, a desktop research app.'
              : dateStr + 'You are a helpful assistant.';
          }
          if (!think) systemMsg += ' /no_think';
          ollamaMessages = [{ role: 'system', content: systemMsg }, ...messages];
        }

        // Stream final response
        for await (const ev of ollamaProvider.chatStream({
          model,
          messages: ollamaMessages,
          signal: abortController.signal,
        })) {
          if (ev.type === 'token') sendEvent('token', ev.content);
          else if (ev.type === 'done') {
            if (ev.usage) sendEvent('usage', ev.usage);
            sendEvent('done', {});
          } else if (ev.type === 'error') sendEvent('error', ev.error);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') sendEvent('error', err.message ?? String(err));
      } finally {
        activeDocChatSessions.delete(sessionId);
      }
    })();

    return { sessionId };
  });

  ipcMain.handle('db:doc-chat-cancel', (_event, sessionId: string) => {
    const controller = activeDocChatSessions.get(sessionId);
    if (controller) {
      controller.abort();
      activeDocChatSessions.delete(sessionId);
      return { cancelled: true };
    }
    return { cancelled: false };
  });

  // ── Vault-chat (streaming via IPC events) ──
  ipcMain.handle('db:vault-chat-start', async (event, options: {
    sessionId: string; googleId: string; messages: any[]; query?: string; min_similarity?: number;
  }) => {
    const { sessionId, googleId, messages, query = '', min_similarity = 0.7 } = options;
    if (!messages?.length) return { error: 'messages required' };

    const abortController = new AbortController();
    activeDocChatSessions.set(sessionId, abortController);
    const webContents = event.sender;

    const sendEvent = (ev: string, data: any) => {
      if (!webContents.isDestroyed()) webContents.send('vault-chat:event', sessionId, { event: ev, data });
    };

    (async () => {
      try {
        // Embed query and search notes
        const sources: any[] = [];
        const contextChunks: string[] = [];
        if (query) {
          const queryVec = await ollamaProvider.embed(query);
          if (queryVec.length) {
            const results = embeddingQueries.searchEmbeddings(queryVec, 'note', 5);
            const userVault = _getUserVaultPath(googleId);
            for (const r of results) {
              if (r.score < min_similarity) continue;
              if (!r.link.startsWith('vault://')) continue;
              const noteId = r.link.slice('vault://'.length);
              // Read note content
              const notePath = path.join(userVault, noteId + '.md');
              if (!fs.existsSync(notePath)) continue;
              const content = fs.readFileSync(notePath, 'utf-8').slice(0, 4096);
              sources.push({ id: noteId, title: r.title, score: r.score });
              contextChunks.push(`--- Note: ${r.title} ---\n${content}`);
            }
          }
        }

        sendEvent('sources', sources);

        let systemMsg: string;
        if (contextChunks.length) {
          const numbered = contextChunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n');
          systemMsg = 'You are a helpful assistant with access to the user\'s personal notes. Answer based on the notes below. Cite sources inline using [1], [2], etc.\n\n--- NOTES ---\n' + numbered + '\n--- END NOTES ---';
        } else {
          systemMsg = 'You are a helpful assistant. No relevant notes were found. Answer as best you can.';
        }

        const ollamaMessages = [{ role: 'system', content: systemMsg }, ...messages];

        for await (const ev of ollamaProvider.chatStream({
          model: 'qwen2.5:3b',
          messages: ollamaMessages,
          signal: abortController.signal,
        })) {
          if (ev.type === 'token') sendEvent('token', ev.content);
          else if (ev.type === 'done') sendEvent('done', {});
          else if (ev.type === 'error') sendEvent('error', ev.error);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') sendEvent('error', err.message ?? String(err));
      } finally {
        activeDocChatSessions.delete(sessionId);
      }
    })();

    return { sessionId };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 5: Filesystem Routes + Client Config
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:read-view', (_event, viewPath: string) => {
    // Read static HTML view templates from disk
    const dataDir = process.env.ARXIV_DATA_DIR ?? process.cwd();
    const filePath = path.join(dataDir, viewPath.replace(/^\//, ''));
    try {
      return { html: fs.readFileSync(filePath, 'utf-8') };
    } catch { return { error: 'View not found: ' + viewPath }; }
  });

  ipcMain.handle('db:client-config', () => {
    return { googleClientId: GOOGLE_CLIENT_ID, ollamaHost: OLLAMA_HOST };
  });

  ipcMain.handle('db:version', () => {
    try {
      const gitRoot = path.resolve(__dirname, '..', '..');
      const count = execSync('git rev-list --count HEAD', { cwd: gitRoot, timeout: 5000 }).toString().trim();
      const sha = execSync('git rev-parse --short HEAD', { cwd: gitRoot, timeout: 5000 }).toString().trim();
      return { version: `0.${count}`, sha };
    } catch { return { version: '0.0', sha: '' }; }
  });

  ipcMain.handle('db:reveal-in-finder', (_event, filePath: string) => {
    if (filePath) shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle('db:saved-content-get', (_event, url: string) => {
    if (!url) return { error: 'url required' };
    const p = _contentPath(url);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
  });

  ipcMain.handle('db:saved-content-set', (_event, url: string, data: { url: string; title: string; text: string; savedAt?: number }) => {
    if (!url) return { error: 'url required' };
    const p = _contentPath(url);
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    return { ok: true };
  });

  ipcMain.handle('db:blog-list', (_event, username: string) => {
    const userInfo = socialExtQueries.getPublicUserInfo(username);
    if (!userInfo) return { error: 'User not found' };
    const userVault = _getUserVaultPath(userInfo.google_id as string);
    const posts: any[] = [];
    if (fs.existsSync(userVault)) {
      for (const fname of fs.readdirSync(userVault)) {
        if (!fname.endsWith('.md')) continue;
        try {
          const content = fs.readFileSync(path.join(userVault, fname), 'utf-8');
          const frontmatter = _parseFrontmatter(content);
          if (frontmatter?.published) {
            posts.push({ title: frontmatter.title ?? 'Untitled', slug: frontmatter.slug, published_at: frontmatter.published_at });
          }
        } catch { /* skip */ }
      }
    }
    posts.sort((a, b) => (b.published_at ?? 0) - (a.published_at ?? 0));
    return { posts, author: username, picture: (userInfo as any).picture };
  });

  ipcMain.handle('db:blog-get', (_event, username: string, slug: string, viewerGoogleId?: string) => {
    const userInfo = socialExtQueries.getPublicUserInfo(username);
    if (!userInfo) return { error: 'User not found' };
    const userVault = _getUserVaultPath(userInfo.google_id as string);
    if (fs.existsSync(userVault)) {
      for (const fname of fs.readdirSync(userVault)) {
        if (!fname.endsWith('.md')) continue;
        try {
          const raw = fs.readFileSync(path.join(userVault, fname), 'utf-8');
          const frontmatter = _parseFrontmatter(raw);
          if (frontmatter?.published && frontmatter.slug === slug) {
            const votes = socialExtQueries.getBlogVotes(username, slug, viewerGoogleId);
            return {
              title: frontmatter.title ?? 'Untitled', content: _stripFrontmatter(raw),
              author: username, published_at: frontmatter.published_at,
              picture: (userInfo as any).picture,
              upvotes: votes.upvotes, downvotes: votes.downvotes, userVote: votes.userVote,
            };
          }
        } catch { /* skip */ }
      }
    }
    return { error: 'Post not found' };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Flask Migration: Vault path/tree
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:vault-path-get', (_event, googleId: string) => {
    const customPath = userQueries.getUserData(googleId, 'vaultPath');
    const defaultPath = path.join(VAULT_DIR, googleId);
    return {
      path: customPath || defaultPath,
      isCustom: !!customPath,
      default: defaultPath,
    };
  });

  ipcMain.handle('db:vault-path-set', (_event, googleId: string, newPath: string | null) => {
    if (!newPath) {
      userQueries.setUserData(googleId, 'vaultPath', '');
      return { ok: true, message: 'Vault path reset to default', path: _getUserVaultPath(googleId) };
    }
    const expanded = newPath.replace(/^~/, process.env.HOME ?? '/tmp');
    if (!fs.existsSync(expanded)) {
      try {
        fs.mkdirSync(expanded, { recursive: true });
      } catch (e: any) {
        return { error: `Cannot create directory: ${e.message}` };
      }
    }
    if (!fs.statSync(expanded).isDirectory()) {
      return { error: 'Path is not a directory' };
    }
    // Test writability
    const testFile = path.join(expanded, '.vault_test');
    try {
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (e: any) {
      return { error: `Directory is not writable: ${e.message}` };
    }
    userQueries.setUserData(googleId, 'vaultPath', expanded);
    return { ok: true, message: `Vault path set to ${expanded}`, path: expanded };
  });

  ipcMain.handle('db:vault-tree', (_event, googleId: string) => {
    const userVault = _getUserVaultPath(googleId);
    const walkDir = (dirpath: string, rel = ''): any[] => {
      const items: any[] = [];
      let entries: string[];
      try { entries = fs.readdirSync(dirpath).sort(); } catch { return items; }
      for (const name of entries) {
        if (name.startsWith('.')) continue;
        const full = path.join(dirpath, name);
        const relPath = rel ? path.join(rel, name) : name;
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            if (SKIP_DIRS.has(name)) continue;
            const children = walkDir(full, relPath);
            items.push({ name, path: relPath, type: 'dir', children });
          } else if (stat.isFile()) {
            if (SKIP_FILES.has(name)) continue;
            items.push({ name, path: relPath, type: 'file', mtime: stat.mtimeMs / 1000 });
          }
        } catch { /* skip unreadable entries */ }
      }
      return items;
    };
    return walkDir(userVault);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Flask Migration: Social uploads + blog unpublish
  // ═══════════════════════════════════════════════════════════════════════

  const UPLOADS_DIR = path.join(DATA_DIR, '..', '.aether_data', 'uploads').replace('/.aether_data/../.aether_data/', '/.aether_data/');
  // Use the same upload dir as Flask: DATA_DIR parent + uploads
  const _uploadsDir = path.join(path.dirname(path.dirname(DATA_DIR)), '.aether_data', 'uploads');
  // Simpler: just put uploads in DATA_DIR
  const uploadsDir = path.join(DATA_DIR, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  ipcMain.handle('db:upload-profile-picture', (_event, googleId: string, imageData: string) => {
    if (!imageData || !imageData.startsWith('data:image/')) {
      return { error: 'Invalid image data' };
    }
    const [header, b64] = imageData.split(',', 2);
    let ext = 'jpg';
    if (header.includes('png')) ext = 'png';
    else if (header.includes('webp')) ext = 'webp';
    const hash = createHash('sha256').update(googleId).digest('hex').slice(0, 16);
    const fname = `${hash}_pic.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, fname), Buffer.from(b64, 'base64'));
    const pictureUrl = '/uploads/' + fname;
    userQueries.updateUserPicture(googleId, pictureUrl);
    return { ok: true, picture: pictureUrl };
  });

  ipcMain.handle('db:upload-profile-background', (_event, googleId: string, imageData: string) => {
    if (!imageData || !imageData.startsWith('data:image/')) {
      return { error: 'Invalid image data' };
    }
    const [header, b64] = imageData.split(',', 2);
    let ext = 'jpg';
    if (header.includes('png')) ext = 'png';
    else if (header.includes('webp')) ext = 'webp';
    const hash = createHash('sha256').update(googleId).digest('hex').slice(0, 16);
    const fname = `${hash}_bg.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, fname), Buffer.from(b64, 'base64'));
    const bgUrl = '/uploads/' + fname;
    userQueries.updateUserProfileBg(googleId, bgUrl);
    return { ok: true, profile_bg: bgUrl };
  });

  ipcMain.handle('db:blog-unpublish', (_event, googleId: string, username: string, slug: string) => {
    const userInfo = userQueries.getUser(googleId) as any;
    if (!userInfo || userInfo.username !== username) {
      return { error: 'Not authorized' };
    }
    const userVault = _getUserVaultPath(googleId);
    if (fs.existsSync(userVault)) {
      for (const fname of fs.readdirSync(userVault)) {
        if (!fname.endsWith('.md')) continue;
        const fpath = path.join(userVault, fname);
        try {
          const content = fs.readFileSync(fpath, 'utf-8');
          const frontmatter = _parseFrontmatter(content);
          if (frontmatter?.published && frontmatter.slug === slug) {
            // Rewrite frontmatter with published: false
            const lines = content.split('\n');
            const newLines: string[] = [];
            let inFrontmatter = false;
            let fmCount = 0;
            for (const line of lines) {
              if (line.trim() === '---') {
                fmCount++;
                inFrontmatter = fmCount === 1;
                newLines.push(line);
                if (fmCount === 2) {
                  // Add updated timestamp before closing ---
                  // Check if 'updated' line was already added
                }
                continue;
              }
              if (inFrontmatter) {
                if (line.startsWith('published:')) {
                  newLines.push('published: false');
                } else if (line.startsWith('published_at:')) {
                  newLines.push('published_at: null');
                } else if (line.startsWith('updated:')) {
                  newLines.push(`updated: ${Math.floor(Date.now() / 1000)}`);
                } else {
                  newLines.push(line);
                }
              } else {
                newLines.push(line);
              }
            }
            fs.writeFileSync(fpath, newLines.join('\n'));
            return { ok: true };
          }
        } catch { /* skip */ }
      }
    }
    return { error: 'Post not found' };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Flask Migration: Dev simple routes
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:settings', () => {
    return { ok: true };
  });

  ipcMain.handle('db:upload-image', (_event, imageB64: string) => {
    if (!imageB64) return { error: 'image required' };
    const { v4: uuidv4 } = require('uuid') as { v4: () => string };
    let filename: string;
    try {
      filename = require('crypto').randomUUID() + '.png';
    } catch {
      filename = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png';
    }
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, Buffer.from(imageB64, 'base64'));
    return { url: '/api/images/' + filename };
  });

  ipcMain.handle('db:serve-image', (_event, filename: string) => {
    const safeName = path.basename(filename);
    const filepath = path.join(uploadsDir, safeName);
    if (!fs.existsSync(filepath)) return { error: 'Not found' };
    const data = fs.readFileSync(filepath).toString('base64');
    return { _proxy: true, data, mime: 'image/png' };
  });

  ipcMain.handle('db:saved-posts', (_event, googleId: string, body: { url: string; title?: string; favicon?: string; hostname?: string }) => {
    const url = (body.url ?? '').trim();
    if (!url) return { error: 'url required' };
    const title = body.title ?? url;
    const favicon = body.favicon ?? '';
    const hostname = body.hostname ?? '';
    const allData = userQueries.getAllUserData(googleId);
    let saved: Record<string, any> = {};
    const savedRaw = allData.savedPosts;
    if (savedRaw) {
      const val = savedRaw.value;
      if (typeof val === 'string') {
        try { saved = JSON.parse(val); } catch { saved = {}; }
      } else if (typeof val === 'object' && val !== null) {
        saved = val as Record<string, any>;
      }
    }
    if (url in saved) return { exists: true };
    saved[url] = {
      paper: { title, link: url, favicon, hostname },
      savedAt: Date.now(),
      read: false,
    };
    userQueries.setUserData(googleId, 'savedPosts', JSON.stringify(saved));
    return { ok: true };
  });

  ipcMain.handle('db:custom-feeds', (_event, googleId: string, body: { url: string; name?: string }) => {
    const url = (body.url ?? '').trim();
    const name = (body.name ?? '').trim();
    if (!url) return { error: 'url required' };
    const allData = userQueries.getAllUserData(googleId);
    let feeds: any[] = [];
    const feedsRaw = allData.customFeeds;
    if (feedsRaw) {
      const val = feedsRaw.value;
      if (typeof val === 'string') {
        try { feeds = JSON.parse(val); } catch { feeds = []; }
      } else if (Array.isArray(val)) {
        feeds = val;
      }
    }
    if (!Array.isArray(feeds)) feeds = [];
    if (feeds.some((f: any) => f.url === url)) return { exists: true };
    feeds.push({ url, name: name || url, enabled: true });
    userQueries.setUserData(googleId, 'customFeeds', JSON.stringify(feeds));
    return { ok: true, name: name || url };
  });

  ipcMain.handle('db:local-file', (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { error: 'File not found' };
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.html': 'text/html', '.htm': 'text/html',
      '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.xml': 'application/xml',
      '.txt': 'text/plain', '.md': 'text/markdown',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.mp4': 'video/mp4', '.webm': 'video/webm',
    };
    const mime = mimeMap[ext] ?? 'application/octet-stream';
    const data = fs.readFileSync(filePath).toString('base64');
    return { _proxy: true, data, mime };
  });

  ipcMain.handle('db:tex-preview', () => {
    return {
      _proxy: true,
      data: Buffer.from(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LaTeX Preview</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:#1a1a1a;font-family:system-ui,sans-serif;color:#aaa}
#pdf-frame{width:100%;height:100%;border:none;display:none}
#placeholder{display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px}
#placeholder .spinner{width:24px;height:24px;border:2px solid #444;border-top-color:#b4451a;border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
<iframe id="pdf-frame"></iframe>
<div id="placeholder"><div class="spinner"></div><span>Waiting for compilation...</span></div>
<script>
const ch = new BroadcastChannel('tex-pdf-preview');
const frame = document.getElementById('pdf-frame');
const ph = document.getElementById('placeholder');
let currentUrl = null;
ch.onmessage = function(e) {
  if (e.data && e.data.type === 'pdf-update') {
    const bytes = new Uint8Array(e.data.pdf);
    const blob = new Blob([bytes], {type:'application/pdf'});
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    frame.src = currentUrl;
    frame.style.display = 'block';
    ph.style.display = 'none';
    document.title = 'LaTeX Preview' + (e.data.fname ? ' - ' + e.data.fname : '');
  }
};
ch.postMessage({type:'preview-ready'});
</script></body></html>`).toString('base64'),
      mime: 'text/html',
    };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Flask Migration: Browse proxy (HTML rewriting)
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:browse-proxy', async (_event, url: string) => {
    if (!url) return { error: 'Missing url parameter' };
    try {
      const buf = await cachedFetch(url, 20_000);
      const htmlStr = buf.toString('utf-8');
      const rewritten = _rewriteProxyHtml(htmlStr, url);
      return { _proxy: true, data: Buffer.from(rewritten).toString('base64'), mime: 'text/html' };
    } catch (e: any) {
      return { error: e.message ?? String(e) };
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Flask Migration Phase 2: Subprocess routes
  // ═══════════════════════════════════════════════════════════════════════

  const { execFileSync, spawn: spawnChild } = require('child_process') as typeof import('child_process');
  const gitRoot = path.resolve(__dirname, '..', '..');

  ipcMain.handle('db:dev-git-log', (_event, offset = 0, limit = 20) => {
    try {
      limit = Math.min(limit, 100);
      const sep = '\x1f';
      const r = execFileSync('git', ['log', `--skip=${offset}`, `-${limit}`, `--format=COMMIT${sep}%H${sep}%an${sep}%ad${sep}%s`, '--date=iso', '--shortstat'], { cwd: gitRoot, timeout: 10_000, encoding: 'utf-8' });
      const gitLog: any[] = [];
      let current: any = null;
      for (const line of r.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('COMMIT' + sep)) {
          const parts = trimmed.split(sep, 5);
          if (parts.length === 5) {
            current = { sha: parts[1].slice(0, 8), author: parts[2], date: parts[3], message: parts[4], ins: 0, del: 0 };
            gitLog.push(current);
          }
        } else if (current && trimmed.includes('changed')) {
          const mIns = trimmed.match(/(\d+) insertion/);
          const mDel = trimmed.match(/(\d+) deletion/);
          current.ins = mIns ? parseInt(mIns[1]) : 0;
          current.del = mDel ? parseInt(mDel[1]) : 0;
          current = null;
        }
      }
      return { git_log: gitLog, has_more: gitLog.length === limit };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:dev-stats', () => {
    try {
      const srcDir = path.resolve(gitRoot, 'src');
      // DB stats
      const db = getDb();
      const users = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
      const activeSess = (db.prepare('SELECT COUNT(*) as c FROM sessions WHERE expires > ?').get(Date.now() / 1000) as any).c;

      // LOC count
      let totalLoc = 0, coreLoc = 0, testLoc = 0, fileCount = 0;
      const walkLoc = (dir: string) => {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (['node_modules', '.git', '__pycache__', 'experiments', 'uploads'].includes(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { walkLoc(full); continue; }
          if (!['.js', '.py', '.css', '.html'].some(e => entry.name.endsWith(e))) continue;
          try {
            const lines = fs.readFileSync(full, 'utf-8').split('\n').length;
            totalLoc += lines; fileCount++;
            const rel = path.relative(srcDir, full);
            if (rel.startsWith('tests') || entry.name.includes('.test.') || entry.name.includes('.spec.') || entry.name.startsWith('test_')) {
              testLoc += lines;
            } else {
              coreLoc += lines;
            }
          } catch { /* skip */ }
        }
      };
      walkLoc(srcDir);

      // Git stats
      let commitsToday = 0, totalCommits = 0, projectAgeDays = 0, firstCommitDate = '';
      try {
        const today = new Date().toISOString().slice(0, 10) + 'T00:00:00';
        commitsToday = parseInt(execFileSync('git', ['rev-list', '--count', `--since=${today}`, 'HEAD'], { cwd: gitRoot, timeout: 5000, encoding: 'utf-8' }).trim()) || 0;
      } catch {}
      try {
        totalCommits = parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: gitRoot, timeout: 5000, encoding: 'utf-8' }).trim()) || 0;
      } catch {}
      try {
        const r = execFileSync('git', ['log', '--reverse', '--format=%ad', '--date=short'], { cwd: gitRoot, timeout: 10000, encoding: 'utf-8' });
        const lines = r.trim().split('\n');
        if (lines[0]) {
          firstCommitDate = lines[0];
          const fd = new Date(firstCommitDate);
          projectAgeDays = Math.max(1, Math.round((Date.now() - fd.getTime()) / 86400000));
        }
      } catch {}

      // Git log (recent 20)
      const gitLog: any[] = [];
      try {
        const sep = '\x1f';
        const r = execFileSync('git', ['log', '-20', `--format=COMMIT${sep}%H${sep}%an${sep}%ad${sep}%s`, '--date=iso', '--shortstat'], { cwd: gitRoot, timeout: 10000, encoding: 'utf-8' });
        let current: any = null;
        for (const line of r.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('COMMIT' + sep)) {
            const parts = trimmed.split(sep, 5);
            if (parts.length === 5) {
              current = { sha: parts[1].slice(0, 8), author: parts[2], date: parts[3], message: parts[4], ins: 0, del: 0 };
              gitLog.push(current);
            }
          } else if (current && trimmed.includes('changed')) {
            const mIns = trimmed.match(/(\d+) insertion/);
            const mDel = trimmed.match(/(\d+) deletion/);
            current.ins = mIns ? parseInt(mIns[1]) : 0;
            current.del = mDel ? parseInt(mDel[1]) : 0;
            current = null;
          }
        }
      } catch {}

      // Commits per day (30 days)
      const commitsPerDay: any[] = [];
      try {
        const r = execFileSync('git', ['log', '--format=%ad', '--date=short', '--since=30 days ago'], { cwd: gitRoot, timeout: 10000, encoding: 'utf-8' });
        const counts: Record<string, number> = {};
        for (const d of r.trim().split('\n')) {
          const date = d.trim();
          if (date) counts[date] = (counts[date] || 0) + 1;
        }
        for (const date of Object.keys(counts).sort()) {
          commitsPerDay.push({ date, count: counts[date] });
        }
      } catch {}

      // RAM & disk
      const ramMb = Math.round(process.memoryUsage().heapUsed / (1024 * 1024) * 10) / 10;
      let diskTotalGb = 0, diskUsedGb = 0, diskFreeGb = 0;
      try {
        const stat = fs.statfsSync('/');
        diskTotalGb = Math.round(stat.bsize * stat.blocks / (1024 ** 3) * 10) / 10;
        diskFreeGb = Math.round(stat.bsize * stat.bavail / (1024 ** 3) * 10) / 10;
        diskUsedGb = Math.round((diskTotalGb - diskFreeGb) * 10) / 10;
      } catch {}

      // Project size
      let projectBytes = 0;
      const walkSize = (dir: string) => {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (['node_modules', '.git', '__pycache__', 'experiments', 'uploads'].includes(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { walkSize(full); }
          else { try { projectBytes += fs.statSync(full).size; } catch {} }
        }
      };
      walkSize(srcDir);
      const projectMb = Math.round(projectBytes / (1024 ** 2) * 10) / 10;

      const avgCommitsDay = projectAgeDays ? Math.round(totalCommits / projectAgeDays * 10) / 10 : 0;

      return {
        users, active_sessions: activeSess,
        total_loc: totalLoc, core_loc: coreLoc, test_loc: testLoc, files: fileCount,
        commits_today: commitsToday, total_commits: totalCommits,
        project_age_days: projectAgeDays, first_commit_date: firstCommitDate,
        avg_commits_day: avgCommitsDay,
        loc_history: [], // Simplified: skip expensive LOC history calculation
        usage_history: {},
        git_log: gitLog, commits_per_day: commitsPerDay,
        ram_mb: ramMb, disk_total_gb: diskTotalGb, disk_used_gb: diskUsedGb, disk_free_gb: diskFreeGb,
        project_mb: projectMb,
      };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:function-registry', () => {
    try {
      execFileSync('node', ['scripts/function-registry.js'], { cwd: gitRoot, timeout: 30_000 });
      const jsonPath = path.join(gitRoot, 'coverage', 'function-registry.json');
      if (!fs.existsSync(jsonPath)) return { error: 'Report file not found' };
      return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } catch (e: any) {
      if (e.killed) return { error: 'Analysis timed out' };
      return { error: e.message ?? String(e) };
    }
  });

  ipcMain.handle('db:validate-feeds', () => {
    try {
      const scriptPath = path.join(gitRoot, 'scripts', 'validate-feeds.js');
      const result = execFileSync('node', [scriptPath, '--json'], { timeout: 10_000, encoding: 'utf-8' });
      return JSON.parse(result);
    } catch (e: any) {
      if (e.killed) return { status: 'error', message: 'Validation timed out' };
      // Try parsing stdout from the error (script may output JSON even on non-zero exit)
      if (e.stdout) try { return JSON.parse(e.stdout); } catch {}
      return { status: 'error', message: e.message ?? String(e) };
    }
  });

  ipcMain.handle('db:validate-load-order', () => {
    try {
      const scriptPath = path.join(gitRoot, 'scripts', 'function-registry.js');
      const result = execFileSync('node', [scriptPath, '--check-load-order', '--json'], { cwd: gitRoot, timeout: 30_000, encoding: 'utf-8' });
      return JSON.parse(result);
    } catch (e: any) {
      if (e.killed) return { status: 'error', message: 'Analysis timed out' };
      return { status: 'error', message: e.message ?? String(e) };
    }
  });

  ipcMain.handle('db:dependency-graph', (_event, level = 'file') => {
    try {
      const scriptPath = path.join(gitRoot, 'scripts', 'function-registry.js');
      // Run function registry analysis
      execFileSync('node', [scriptPath], { cwd: gitRoot, timeout: 30_000 });
      const jsonPath = path.join(gitRoot, 'coverage', 'function-registry.json');
      if (!fs.existsSync(jsonPath)) return { status: 'error', message: 'Report file not found' };
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

      if (level === 'function') {
        // Build function-level graph
        const nodes: any[] = [];
        const functions = data.functions ?? {};
        for (const [funcName, funcData] of Object.entries(functions) as any) {
          const defs = funcData.definitions ?? [];
          if (!defs.length) continue;
          const primaryDef = defs[0];
          nodes.push({
            id: funcName, file: primaryDef.file ?? '', line: primaryDef.line ?? 0,
            callCount: funcData.callCount ?? 0, type: primaryDef.type ?? 'function',
            isGlobal: primaryDef.isGlobal ?? false, definitionCount: defs.length,
          });
        }
        const edgeMap: Record<string, number> = {};
        for (const [funcName, funcData] of Object.entries(functions) as any) {
          for (const site of (funcData.callSites ?? [])) {
            // Find caller function
            let callerFunc: string | null = null;
            let bestDist = Infinity;
            for (const [fn, fd] of Object.entries(functions) as any) {
              for (const defn of (fd.definitions ?? [])) {
                if (defn.file === site.file && defn.line <= site.line) {
                  const dist = site.line - defn.line;
                  if (dist < bestDist) { bestDist = dist; callerFunc = fn; }
                }
              }
            }
            if (callerFunc && callerFunc !== funcName) {
              const key = `${callerFunc}|${funcName}`;
              edgeMap[key] = (edgeMap[key] ?? 0) + 1;
            }
          }
        }
        const edges = Object.entries(edgeMap).map(([key, calls]) => {
          const [source, target] = key.split('|');
          return { source, target, calls };
        });
        return { status: 'ok', level: 'function', nodes, edges };
      }

      // File-level graph
      let loadData: any = {};
      try {
        const loadResult = execFileSync('node', [scriptPath, '--check-load-order', '--json'], { cwd: gitRoot, timeout: 30_000, encoding: 'utf-8' });
        loadData = JSON.parse(loadResult);
      } catch {}

      const nodes: any[] = [];
      const fileStats = data.files ?? {};
      const scriptOrder = loadData.scriptOrder ?? [];
      for (const [filename, stats] of Object.entries(fileStats) as any) {
        nodes.push({
          id: filename, functions: stats.functionCount ?? 0, loc: stats.loc ?? 0,
          order: scriptOrder.indexOf(filename) >= 0 ? scriptOrder.indexOf(filename) : 999,
        });
      }

      const edgeMap2: Record<string, { calls: number; severity: string | null }> = {};
      for (const ref of (loadData.forwardRefs ?? [])) {
        const source = ref.callFile;
        const target = ref.defFile;
        const severity = ref.severity ?? 'INFO';
        if (source && target && source !== target) {
          const key = `${source}|${target}`;
          if (!edgeMap2[key]) edgeMap2[key] = { calls: 0, severity };
          edgeMap2[key].calls++;
          if (severity === 'ERROR' || (severity === 'WARNING' && edgeMap2[key].severity === 'INFO')) {
            edgeMap2[key].severity = severity;
          }
        }
      }
      const functions = data.functions ?? {};
      for (const funcData of Object.values(functions) as any) {
        const defs = funcData.definitions ?? [];
        const callSites = funcData.callSites ?? [];
        if (!defs.length || !callSites.length) continue;
        const defFiles = new Set(defs.map((d: any) => d.file).filter(Boolean));
        for (const site of callSites) {
          if (!site.file) continue;
          for (const target of defFiles) {
            if (site.file !== target) {
              const key = `${site.file}|${target}`;
              if (!edgeMap2[key]) edgeMap2[key] = { calls: 0, severity: null };
              edgeMap2[key].calls++;
            }
          }
        }
      }
      const edges = Object.entries(edgeMap2).map(([key, d]) => {
        const [source, target] = key.split('|');
        return { source, target, calls: d.calls, severity: d.severity };
      });
      return { status: 'ok', level: 'file', nodes, edges };
    } catch (e: any) {
      if (e.killed) return { status: 'error', message: 'Analysis timed out' };
      return { status: 'error', message: e.message ?? String(e) };
    }
  });

  ipcMain.handle('db:vibe-git', (_event, googleId: string, cmd: string, body: Record<string, any>) => {
    const ALLOWED = new Set(['status', 'files', 'branches', 'log', 'stash', 'diff', 'show', 'reflog']);
    if (!ALLOWED.has(cmd)) return { error: 'Command not allowed' };
    const userVault = _getUserVaultPath(googleId);

    // Ensure git repo exists
    if (!fs.existsSync(path.join(userVault, '.git'))) {
      try {
        execFileSync('git', ['init'], { cwd: userVault, timeout: 10_000 });
        execFileSync('git', ['add', '.'], { cwd: userVault, timeout: 10_000 });
        execFileSync('git', ['commit', '-m', 'Initial commit', '--allow-empty'], { cwd: userVault, timeout: 10_000 });
      } catch { /* ignore init errors */ }
    }

    const run = (args: string[], maxOutput = 50000): string | { error: string } => {
      try {
        const out = execFileSync('git', args, { cwd: userVault, timeout: 10_000, encoding: 'utf-8', maxBuffer: maxOutput + 1000 });
        return out.slice(0, maxOutput);
      } catch (e: any) {
        return { error: (e.stderr ?? e.message ?? String(e)).slice(0, 2000) };
      }
    };

    if (cmd === 'status') {
      const out = run(['status', '--porcelain', '-b']);
      if (typeof out !== 'string') return out;
      return { output: out };
    }
    if (cmd === 'files') {
      const changedOut = run(['status', '--porcelain']);
      const changed: Record<string, string> = {};
      if (typeof changedOut === 'string') {
        for (const line of changedOut.trim().split('\n')) {
          if (!line) continue;
          changed[line.slice(3)] = line.slice(0, 2).trim();
        }
      }
      const trackedOut = run(['ls-files']);
      if (typeof trackedOut !== 'string') return trackedOut;
      const files: any[] = [];
      const seen = new Set<string>();
      for (const [p, status] of Object.entries(changed)) {
        files.push({ status, path: p });
        seen.add(p);
      }
      for (const line of trackedOut.trim().split('\n')) {
        if (!line || seen.has(line)) continue;
        files.push({ status: ' ', path: line });
      }
      return { files };
    }
    if (cmd === 'branches') {
      const out = run(['branch', '-a', '--format=%(HEAD)%(refname:short)\t%(upstream:track)\t%(objectname:short)\t%(committerdate:relative)']);
      if (typeof out !== 'string') return out;
      const branches: any[] = [];
      for (const line of out.trim().split('\n')) {
        if (!line) continue;
        const current = line.startsWith('*');
        const parts = line.replace(/^\* ?/, '').split('\t');
        branches.push({ name: parts[0] ?? '', current, track: parts[1] ?? '', hash: parts[2] ?? '', date: parts[3] ?? '' });
      }
      return { branches };
    }
    if (cmd === 'log') {
      const branch = body.branch ?? '';
      const args = ['log', '--oneline', '--graph', '-50', '--format=%h\t%s\t%an\t%ar'];
      if (branch) args.push(branch);
      const out = run(args);
      if (typeof out !== 'string') return out;
      const commits: any[] = [];
      for (const line of out.trim().split('\n')) {
        if (!line) continue;
        const parts = line.split('\t');
        if (parts.length >= 4) {
          commits.push({ hash: parts[0].replace(/[* |/\\]/g, ''), subject: parts[1], author: parts[2], date: parts[3] });
        }
      }
      return { commits };
    }
    if (cmd === 'stash') {
      const out = run(['stash', 'list']);
      if (typeof out !== 'string') return out;
      return { entries: out.trim().split('\n').filter(Boolean) };
    }
    if (cmd === 'diff') {
      const file = body.file ?? '';
      const args = ['diff'];
      if (file) { args.push('--'); args.push(file); }
      const out = run(args);
      if (typeof out !== 'string') return out;
      let staged = run(['diff', '--cached', ...(file ? ['--', file] : [])]);
      if (typeof staged !== 'string') staged = '';
      let combined = '';
      if (staged) combined += '=== Staged ===\n' + staged + '\n';
      if (out) combined += '=== Unstaged ===\n' + out;
      if (!combined) combined = 'No changes';
      return { output: combined };
    }
    if (cmd === 'show') {
      const ref = body.ref ?? 'HEAD';
      if (!/^[a-zA-Z0-9_./@{}\-: ]+$/.test(ref)) return { error: 'Invalid ref' };
      const out = run(['show', '--stat', '--patch', ref]);
      if (typeof out !== 'string') return out;
      return { output: out };
    }
    if (cmd === 'reflog') {
      const out = run(['reflog', '--format=%h\t%gd\t%gs\t%ar', '-50']);
      if (typeof out !== 'string') return out;
      return { entries: out.trim().split('\n').filter(Boolean) };
    }
    return { error: 'Unknown command' };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Flask Migration Phase 2: Marimo start/stop
  // ═══════════════════════════════════════════════════════════════════════

  const _marimoServers = new Map<string, { proc: any; port: number; pyPath: string; notePath: string }>();

  ipcMain.handle('db:marimo-start', (_event, googleId: string, noteId: string) => {
    if (!noteId) return { error: 'note_id required' };
    if (_marimoServers.has(noteId)) return { port: _marimoServers.get(noteId)!.port };
    const userVault = _getUserVaultPath(googleId);
    // Find note by ID
    let notePath = '';
    let noteContent = '';
    let noteType = '';
    for (const fname of fs.readdirSync(userVault).filter((f: string) => f.endsWith('.md'))) {
      try {
        const content = fs.readFileSync(path.join(userVault, fname), 'utf-8');
        const fm = _parseFrontmatter(content);
        if (fm?.id === noteId) {
          notePath = path.join(userVault, fname);
          noteContent = _stripFrontmatter(content);
          noteType = fm.type ?? '';
          break;
        }
      } catch { /* skip */ }
    }
    if (!notePath || noteType !== 'marimo') return { error: 'Marimo note not found' };

    const pyPath = path.join(userVault, `.marimo_${noteId}.py`);
    fs.writeFileSync(pyPath, noteContent);

    // Find free port
    const net = require('net');
    const srv = net.createServer();
    srv.listen(0);
    const port = srv.address().port;
    srv.close();

    try {
      const proc = spawnChild('marimo', ['edit', pyPath, '--headless', '--no-token', '-p', String(port)], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      _marimoServers.set(noteId, { proc, port, pyPath, notePath });
      return { port };
    } catch {
      try { fs.unlinkSync(pyPath); } catch {}
      return { error: 'marimo is not installed. Run: pip install marimo' };
    }
  });

  ipcMain.handle('db:marimo-stop', (_event, googleId: string, noteId: string) => {
    if (!noteId || !_marimoServers.has(noteId)) return { error: 'No marimo server running for this note' };
    const info = _marimoServers.get(noteId)!;
    _marimoServers.delete(noteId);
    let updatedContent = '';
    try { updatedContent = fs.readFileSync(info.pyPath, 'utf-8'); } catch {}
    try { info.proc.kill('SIGTERM'); } catch {}
    try { fs.unlinkSync(info.pyPath); } catch {}
    // Update the vault note
    const userVault = _getUserVaultPath(googleId);
    for (const fname of fs.readdirSync(userVault).filter((f: string) => f.endsWith('.md'))) {
      try {
        const content = fs.readFileSync(path.join(userVault, fname), 'utf-8');
        const fm = _parseFrontmatter(content);
        if (fm?.id === noteId) {
          const fmEnd = content.indexOf('---', 3);
          if (fmEnd !== -1) {
            const headerPart = content.slice(0, fmEnd + 3);
            // Update the 'updated' field in frontmatter
            const newHeader = headerPart.replace(/updated:.*/, `updated: ${Math.floor(Date.now() / 1000)}`);
            fs.writeFileSync(path.join(userVault, fname), newHeader + '\n' + updatedContent);
          }
          break;
        }
      } catch {}
    }
    return { ok: true, content: updatedContent };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Flask Migration Phase 2: Experiments (non-kernel)
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:exp-packages', (_event, googleId: string, expId: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    // Find python path (venv or system)
    const venvPython = path.join(expDir, 'venv', 'bin', 'python3');
    const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python3';
    try {
      const out = execFileSync(pythonPath, ['-m', 'pip', 'list', '--format=json'], { timeout: 15_000, encoding: 'utf-8' });
      return JSON.parse(out);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-venv-info', (_event, googleId: string, expId: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const venvDir = path.join(expDir, 'venv');
    if (!fs.existsSync(venvDir)) return { error: 'No venv' };
    const venvPython = path.join(venvDir, 'bin', 'python3');
    let pythonVersion = '';
    try { pythonVersion = execFileSync(venvPython, ['--version'], { timeout: 5000, encoding: 'utf-8' }).trim(); } catch {}
    let packages: any[] = [];
    try { packages = JSON.parse(execFileSync(venvPython, ['-m', 'pip', 'list', '--format=json'], { timeout: 15_000, encoding: 'utf-8' })); } catch {}
    // Disk usage
    let sizeBytes = 0;
    const walkVenv = (dir: string) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walkVenv(full);
          else try { sizeBytes += fs.statSync(full).size; } catch {}
        }
      } catch {}
    };
    walkVenv(venvDir);
    return { python_version: pythonVersion, packages, size_mb: Math.round(sizeBytes / (1024 * 1024) * 10) / 10, package_count: packages.length };
  });

  ipcMain.handle('db:venvs', (_event, googleId: string) => {
    const vault = _getUserVaultPath(googleId);
    if (!fs.existsSync(vault)) return [];
    const results: any[] = [];
    for (const name of fs.readdirSync(vault)) {
      const full = path.join(vault, name);
      if (!fs.statSync(full).isDirectory()) continue;
      if (fs.existsSync(path.join(full, 'venv', 'bin', 'python3'))) {
        results.push({ id: name, title: name });
      }
    }
    return results;
  });

  ipcMain.handle('db:exp-upload', (_event, googleId: string, expId: string, files: Array<{ name: string; data: string }>) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const uploaded: string[] = [];
    for (const file of files) {
      if (!file.name || file.name.includes('..')) continue;
      const fpath = path.join(expDir, file.name);
      fs.mkdirSync(path.dirname(fpath), { recursive: true });
      fs.writeFileSync(fpath, Buffer.from(file.data, 'base64'));
      uploaded.push(file.name);
    }
    return { ok: true, uploaded };
  });

  ipcMain.handle('db:exp-create-venv', (_event, googleId: string, expId: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const venvDir = path.join(expDir, 'venv');
    if (fs.existsSync(venvDir)) return { error: 'venv already exists' };
    try {
      execFileSync('python3', ['-m', 'venv', venvDir], { timeout: 60_000 });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-install-packages', (_event, googleId: string, expId: string, packages: string[]) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    if (!packages?.length) return { error: 'No packages specified' };
    // Validate package names
    const validPkg = /^[a-zA-Z0-9._-]+([<>=!]+[a-zA-Z0-9._-]*)?$/;
    for (const pkg of packages) {
      if (!validPkg.test(pkg)) return { error: `Invalid package name: ${pkg}` };
    }
    const venvPython = path.join(expDir, 'venv', 'bin', 'python3');
    const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python3';
    try {
      execFileSync(pythonPath, ['-m', 'pip', 'install', ...packages], { timeout: 120_000, encoding: 'utf-8' });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-uninstall-package', (_event, googleId: string, expId: string, pkg: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const venvPython = path.join(expDir, 'venv', 'bin', 'python3');
    const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python3';
    try {
      execFileSync(pythonPath, ['-m', 'pip', 'uninstall', '-y', pkg], { timeout: 30_000, encoding: 'utf-8' });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-clone-repo', (_event, googleId: string, expId: string, url: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (!url || !/^https?:\/\/.+/.test(url)) return { error: 'Invalid URL' };
    try {
      execFileSync('git', ['clone', '--depth', '1', url], { cwd: expDir, timeout: 60_000, encoding: 'utf-8' });
      // Remove .git from cloned repo
      const repoName = url.split('/').pop()?.replace('.git', '') ?? '';
      const gitDir = path.join(expDir, repoName, '.git');
      if (fs.existsSync(gitDir)) fs.rmSync(gitDir, { recursive: true });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-delete-venv', (_event, googleId: string, expId: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const venvDir = path.join(expDir, 'venv');
    if (!fs.existsSync(venvDir)) return { error: 'No venv found' };
    fs.rmSync(venvDir, { recursive: true, force: true });
    return { ok: true };
  });

  ipcMain.handle('db:exp-update', (_event, googleId: string, expId: string, body: { title?: string; pythonPath?: string }) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    // Handle rename
    if (body.title && body.title !== expId) {
      const vault = _getUserVaultPath(googleId);
      const newSlug = _uniqueSlug(vault, _slugify(body.title));
      const newDir = path.join(vault, newSlug);
      fs.renameSync(expDir, newDir);
      return { ok: true, id: newSlug, title: newSlug };
    }
    return { ok: true, id: expId };
  });

  ipcMain.handle('db:exp-compile-tex', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fname || fname.includes('..')) return { error: 'Invalid path' };
    const fpath = path.join(expDir, fname);
    if (!fs.existsSync(fpath)) return { error: 'File not found' };
    const texDir = path.dirname(fpath);
    const baseName = path.basename(fname, '.tex');
    try {
      // Run pdflatex twice (for references) + bibtex
      execFileSync('pdflatex', ['-interaction=nonstopmode', '-output-directory=' + texDir, fpath], { cwd: texDir, timeout: 30_000 });
      try { execFileSync('bibtex', [baseName], { cwd: texDir, timeout: 15_000 }); } catch {}
      execFileSync('pdflatex', ['-interaction=nonstopmode', '-output-directory=' + texDir, fpath], { cwd: texDir, timeout: 30_000 });
      const pdfPath = path.join(texDir, baseName + '.pdf');
      if (!fs.existsSync(pdfPath)) return { error: 'PDF not generated' };
      const pdfData = fs.readFileSync(pdfPath).toString('base64');
      return { _proxy: true, data: pdfData, mime: 'application/pdf' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Flask Migration Phase 3: Jupyter Kernel operations
  // ═══════════════════════════════════════════════════════════════════════

  const { kernelManager } = require('./kernel-manager.js') as typeof import('./kernel-manager.js');

  ipcMain.handle('db:kernel-execute', async (event, googleId: string, expId: string, code: string, stream = false) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };

    if (stream) {
      // Streaming mode: forward kernel outputs to renderer via IPC events
      const webContents = event.sender;
      const sessionId = `ke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const onOutput = (reqId: string, data: any) => {
        if (!webContents.isDestroyed()) {
          webContents.send('kernel:output', sessionId, data);
        }
      };

      kernelManager.on('kernel:output', onOutput);

      (async () => {
        try {
          await kernelManager.execute(expDir, code);
          if (!webContents.isDestroyed()) {
            webContents.send('kernel:done', sessionId);
          }
        } catch (err: any) {
          if (!webContents.isDestroyed()) {
            webContents.send('kernel:error', sessionId, err.message ?? String(err));
          }
        } finally {
          kernelManager.removeListener('kernel:output', onOutput);
        }
      })();

      return { _stream: true, sessionId };
    }

    // Synchronous mode: collect all outputs
    const outputs: any[] = [];
    const onOutput = (_reqId: string, data: any) => { outputs.push(data); };
    kernelManager.on('kernel:output', onOutput);
    try {
      await kernelManager.execute(expDir, code);
      return { outputs };
    } catch (e: any) {
      return { error: e.message ?? String(e) };
    } finally {
      kernelManager.removeListener('kernel:output', onOutput);
    }
  });

  ipcMain.handle('db:kernel-restart', async (_event, googleId: string, expId: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    try {
      await kernelManager.restart(expDir);
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:kernel-interrupt', async (_event, googleId: string, expId: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    try {
      await kernelManager.interrupt(expDir);
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:kernel-kill', async (_event, googleId: string, expId: string) => {
    const expDir = _resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    try {
      await kernelManager.killKernel(expDir);
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // Serve uploaded files (replaces Flask's /uploads/ route)
  ipcMain.handle('db:serve-upload', (_event, filename: string) => {
    const safeName = path.basename(filename);
    const filepath = path.join(uploadsDir, safeName);
    if (!fs.existsSync(filepath)) return { error: 'Not found' };
    const ext = path.extname(safeName).toLowerCase();
    const mime = BINARY_MIME[ext] ?? 'application/octet-stream';
    const data = fs.readFileSync(filepath).toString('base64');
    return { _proxy: true, data, mime };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Flask Migration Phase 4: Neuralook (gaze tracking)
  // ═══════════════════════════════════════════════════════════════════════

  // File I/O endpoints (no Python needed)

  ipcMain.handle('db:neuralook-save-calibration', (_event, body: Record<string, any>) => {
    try {
      const calibPath = path.join(DATA_DIR, 'neuralook_calibration.json');
      fs.writeFileSync(calibPath, JSON.stringify(body, null, 2));
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:neuralook-implicit-samples', (_event, method: string, body?: Record<string, any>) => {
    const implPath = path.join(DATA_DIR, 'neuralook_implicit.json');
    if (!body) {
      // GET — read samples
      try {
        if (!fs.existsSync(implPath)) return [];
        return JSON.parse(fs.readFileSync(implPath, 'utf-8'));
      } catch { return []; }
    }
    // POST — append samples
    try {
      let existing: any[] = [];
      if (fs.existsSync(implPath)) {
        try { existing = JSON.parse(fs.readFileSync(implPath, 'utf-8')); } catch {}
      }
      const newSamples = body.samples ?? [];
      existing.push(...newSamples);
      fs.writeFileSync(implPath, JSON.stringify(existing));
      return { ok: true, count: existing.length };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:neuralook-refine-history', (_event) => {
    try {
      const histPath = path.join(DATA_DIR, 'neuralook_refine_history.json');
      if (!fs.existsSync(histPath)) return [];
      return JSON.parse(fs.readFileSync(histPath, 'utf-8'));
    } catch { return []; }
  });

  // Python subprocess endpoints (via neuralook-manager)

  const { neuralookManager } = require('./neuralook-manager.js') as typeof import('./neuralook-manager.js');

  ipcMain.handle('db:neuralook-train', async (event, body: Record<string, any>, stream = false) => {
    try {
      if (stream) {
        const webContents = event.sender;
        const sessionId = `nl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const onProgress = (_reqId: string, data: any) => {
          if (!webContents.isDestroyed()) {
            webContents.send('neuralook:progress', sessionId, data);
          }
        };

        neuralookManager.on('neuralook:progress', onProgress);

        (async () => {
          try {
            const result = await neuralookManager.train(body);
            if (!webContents.isDestroyed()) {
              webContents.send('neuralook:done', sessionId, result);
            }
          } catch (err: any) {
            if (!webContents.isDestroyed()) {
              webContents.send('neuralook:error', sessionId, err.message ?? String(err));
            }
          } finally {
            neuralookManager.removeListener('neuralook:progress', onProgress);
          }
        })();

        return { _stream: true, sessionId };
      }

      return await neuralookManager.train(body);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:neuralook-predict', async (_event, body: Record<string, any>) => {
    try {
      return await neuralookManager.predict(body);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:neuralook-reset-hidden', async (_event, method: string) => {
    try {
      return await neuralookManager.resetHidden(method);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:neuralook-auto-refine', async (event, body: Record<string, any>, stream = false) => {
    try {
      if (stream) {
        const webContents = event.sender;
        const sessionId = `nlr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const onProgress = (_reqId: string, data: any) => {
          if (!webContents.isDestroyed()) {
            webContents.send('neuralook:progress', sessionId, data);
          }
        };

        neuralookManager.on('neuralook:progress', onProgress);

        (async () => {
          try {
            const result = await neuralookManager.autoRefine(body);
            if (!webContents.isDestroyed()) {
              webContents.send('neuralook:done', sessionId, result);
            }
          } catch (err: any) {
            if (!webContents.isDestroyed()) {
              webContents.send('neuralook:error', sessionId, err.message ?? String(err));
            }
          } finally {
            neuralookManager.removeListener('neuralook:progress', onProgress);
          }
        })();

        return { _stream: true, sessionId };
      }

      return await neuralookManager.autoRefine(body);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Flask Migration Phase 5: Terminal (node-pty) & Captions (whisper.cpp)
  // ═══════════════════════════════════════════════════════════════════════

  const { terminalManager } = require('./terminal-manager.js') as typeof import('./terminal-manager.js');
  const { transcribeChunk } = require('./captions-manager.js') as typeof import('./captions-manager.js');

  ipcMain.handle('terminal:start', (event, cwd?: string) => {
    try {
      const sessionId = terminalManager.start(cwd);
      const webContents = event.sender;

      const onOutput = (id: string, data: string) => {
        if (id === sessionId && !webContents.isDestroyed()) {
          webContents.send('terminal:output', sessionId, data);
        }
      };
      const onExit = (id: string, exitCode: number) => {
        if (id === sessionId && !webContents.isDestroyed()) {
          webContents.send('terminal:exit', sessionId, exitCode);
        }
        terminalManager.removeListener('terminal:output', onOutput);
        terminalManager.removeListener('terminal:exit', onExit);
      };

      terminalManager.on('terminal:output', onOutput);
      terminalManager.on('terminal:exit', onExit);

      return { sessionId };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('terminal:input', (_event, sessionId: string, data: string) => {
    terminalManager.write(sessionId, data);
  });

  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    terminalManager.resize(sessionId, cols, rows);
  });

  ipcMain.handle('terminal:kill', (_event, sessionId: string) => {
    terminalManager.kill(sessionId);
  });

  ipcMain.handle('captions:transcribe', async (_event, pcmBase64: string, sampleRate: number) => {
    try {
      const pcmBuffer = Buffer.from(pcmBase64, 'base64');
      const text = await transcribeChunk(pcmBuffer, sampleRate);
      if (text) return { text };
      return { text: null };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Ambient AI ──

  ipcMain.handle('ambient:page-loaded', (event, data) => {
    ambientObserver.onPageLoaded(data, event.sender);
  });

  ipcMain.handle('ambient:set-enabled', (_event, enabled: boolean) => {
    ambientObserver.setEnabled(enabled);
  });
}

// ── Helpers used by phase 4/5 handlers (outside registerToolIPC) ──

const DEFAULT_ANNOTATION_PROMPT =
  "You are a helpful assistant whose job it is twofold. First, you must point out AI slop and also point out redundant information to protect the user from potentially harmful, fearmongering, or biased sentences. At the same time, you are also in charge of highlighting IMPORTANT sentences and key ideas of the current article, book, paper, or general website page that the user is visiting. Read the page and return ONLY extremely high-signal annotations. Zero fluff. Do not point out anything that is obvious.\n\n" +
  "Annotation types:\n" +
  "- ALPHA — Something lowkey, an uncommon or surprising result or fact. The thing worth remembering. Only use for genuinely informative information.\n" +
  "- CONTRADICTION — a sentence idea, or thought that shows a logical flaw. one that conflicts with previous sentences. You MUST explain the specific contradiction and why the two claims can't both be true.\n" +
  "- AD — sponsored content, affiliate links, product placement, or advertorial disguised as editorial. Flag anything that looks like it's trying to sell you something while pretending to be informational. Do not flag pip installs.\n\n" +
  "For each annotation provide a JSON object with:\n" +
  '- "type": one of the types above\n' +
  '- "quote": a passage copied EXACTLY from the page text (10-40 words). Do NOT paraphrase.\n' +
  '- "explanation": 1-2 sentences. For ALPHA: why this matters. For CONTRADICTION: what it contradicts and why. For AD: what\'s being sold.\n' +
  '- "confidence": 0-100 how confident you are\n' +
  '- "conflictsWith": (only for CONTRADICTION) the sentence of the conflicting claim\n\n' +
  "Rules:\n" +
  "- CRITICAL: Every quote must be a VERBATIM substring of the page text. Do not change ANY words. It must be verbatim from the text.\n" +
  "- Only use CONTRADICTION if there is a real logical flaw.\n" +
  "- Always use AD if the sentence seems to be trying to sell a product or service.\n" +
  "- Return 1-3 annotations for a typical page. 5-8 for longer textbooks and articles.\n" +
  "- If the page has no key results and no ads, return an empty array [].\n" +
  "- Respond ONLY with a JSON array, no other text\n\n";

function _readAnnotationPrompt(): string | null {
  try {
    if (fs.existsSync(ANNOTATION_PROMPT_FILE)) {
      const text = fs.readFileSync(ANNOTATION_PROMPT_FILE, 'utf-8').trim();
      return text || null;
    }
  } catch {}
  return null;
}

function _getAnnotationPrompt(): string {
  return _readAnnotationPrompt() ?? DEFAULT_ANNOTATION_PROMPT;
}

function _parseFrontmatter(content: string): Record<string, any> | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('---', 3);
  if (end === -1) return null;
  const fm = content.slice(3, end).trim();
  const result: Record<string, any> = {};
  for (const line of fm.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val: any = line.slice(colon + 1).trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (val === 'null') val = null;
    else if (/^\d+$/.test(val)) val = parseInt(val);
    result[key] = val;
  }
  return result;
}

function _stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('---', 3);
  if (end === -1) return content;
  return content.slice(end + 3).trim();
}

/**
 * Rewrite relative URLs in proxied HTML for non-Electron browser mode.
 * Port of Python rewrite_proxy_html from utils_persistence.py.
 */
function _rewriteProxyHtml(htmlStr: string, baseUrl: string): string {
  const { URL } = require('url');
  let parsedBase: URL;
  try { parsedBase = new URL(baseUrl); } catch { return htmlStr; }

  function resolveUrl(val: string): string {
    if (!val) return val;
    if (/^(https?:|data:|javascript:|#|mailto:)/i.test(val)) return val;
    try { return new URL(val, baseUrl).href; } catch { return val; }
  }

  // Rewrite src, href, action, poster attributes
  let result = htmlStr.replace(/<((?:img|script|link|a|iframe|video|audio|source|form)[^>]*?)>/gi, (match, inner) => {
    let tag = inner as string;
    for (const attr of ['src', 'href', 'action', 'poster']) {
      const re = new RegExp(`(${attr}\\s*=\\s*")([^"]*)(")`, 'i');
      tag = tag.replace(re, (_m: string, pre: string, val: string, post: string) => {
        const resolved = resolveUrl(val);
        return pre + resolved + post;
      });
      const reSingle = new RegExp(`(${attr}\\s*=\\s*')([^']*)(')`, 'i');
      tag = tag.replace(reSingle, (_m: string, pre: string, val: string, post: string) => {
        const resolved = resolveUrl(val);
        return pre + resolved + post;
      });
    }
    return '<' + tag + '>';
  });

  // Rewrite <img> src through image proxy
  result = result.replace(/<img([^>]*?)>/gi, (_match, attrs) => {
    let tag = attrs as string;
    tag = tag.replace(/src\s*=\s*"(https?:\/\/[^"]+)"/gi, (_m: string, url: string) => {
      if (url.startsWith('http://localhost') || url.startsWith('https://localhost')) return `src="${url}"`;
      return `src="/api/image-proxy?url=${encodeURIComponent(url)}"`;
    });
    // Rewrite srcset
    tag = tag.replace(/srcset\s*=\s*"([^"]+)"/gi, (_m: string, srcset: string) => {
      const rewritten = srcset.replace(/(\S+)(\s+[^,]*)/g, (_sm: string, surl: string, rest: string) => {
        if (surl.startsWith('http://') || surl.startsWith('https://')) {
          if (surl.startsWith('http://localhost') || surl.startsWith('https://localhost')) return surl + rest;
          return '/api/image-proxy?url=' + encodeURIComponent(surl) + rest;
        }
        return surl + rest;
      });
      return `srcset="${rewritten}"`;
    });
    return '<img' + tag + '>';
  });

  // Rewrite same-origin <a> links through browse-proxy
  result = result.replace(/<a([^>]*?)>/gi, (_match, attrs) => {
    let tag = attrs as string;
    tag = tag.replace(/href\s*=\s*"(https?:\/\/[^"]+)"/gi, (_m: string, href: string) => {
      try {
        const parsedHref = new URL(href);
        if (parsedHref.hostname === parsedBase.hostname) {
          return `href="/api/browse-proxy?url=${encodeURIComponent(href)}"`;
        }
      } catch {}
      return `href="${href}"`;
    });
    return '<a' + tag + '>';
  });

  return result;
}
