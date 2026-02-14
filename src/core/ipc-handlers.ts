import { ipcMain, BrowserWindow } from 'electron';
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
}
