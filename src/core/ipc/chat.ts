import { ipcMain } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, activeDocChatSessions, ollamaProvider } from './shared.js';
import * as chatDb from '../db/queries/chat.js';

const CHAT_MEMORY_DIR = path.join(DATA_DIR, 'chat-memories');
fs.mkdirSync(CHAT_MEMORY_DIR, { recursive: true });

export function registerChatIPC(): void {
  ipcMain.handle('db:chat-memory-save', (_event, data: { messages: any[]; pageUrl?: string; pageTitle?: string }) => {
    if (!data.messages?.length) return { ok: false };
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const summary = data.messages
      .filter((m: any) => m.role === 'user')
      .map((m: any) => (m.content || '').slice(0, 100))
      .join('; ')
      .slice(0, 300);
    const entry = {
      id,
      summary,
      pageUrl: data.pageUrl || '',
      pageTitle: data.pageTitle || '',
      messageCount: data.messages.length,
      createdAt: Date.now(),
    };
    try {
      fs.writeFileSync(path.join(CHAT_MEMORY_DIR, id + '.json'), JSON.stringify(entry));
    } catch { /* best effort */ }
    return { ok: true, id };
  });

  ipcMain.handle('db:chat-memory-list', (_event, query?: string) => {
    try {
      const files = fs.readdirSync(CHAT_MEMORY_DIR).filter(f => f.endsWith('.json'));
      let memories = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(CHAT_MEMORY_DIR, f), 'utf-8')); } catch { return null; }
      }).filter(Boolean);
      memories.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
      if (query) {
        const q = query.toLowerCase();
        memories = memories.filter((m: any) =>
          (m.summary || '').toLowerCase().includes(q) ||
          (m.pageTitle || '').toLowerCase().includes(q)
        );
      }
      return { memories: memories.slice(0, 20) };
    } catch { return { memories: [] }; }
  });

  ipcMain.handle('db:chat-memory-stats', () => {
    try {
      const files = fs.readdirSync(CHAT_MEMORY_DIR).filter(f => f.endsWith('.json'));
      return { count: files.length };
    } catch { return { count: 0 }; }
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
              ? dateStr + 'You are the AI assistant inside Netrun, a desktop research app. Answer based on the document text below.\n\n--- DOCUMENT TEXT ---\n' + truncatedCtx + '\n--- END ---'
              : dateStr + 'You are a helpful research assistant. Answer based ONLY on the document text below.\n\n--- DOCUMENT TEXT ---\n' + truncatedCtx + '\n--- END ---';
          } else {
            systemMsg = toolsEnabled
              ? dateStr + 'You are the AI assistant inside Netrun, a desktop research app.'
              : dateStr + 'You are a helpful assistant.';
          }
          if (!think) systemMsg += ' /no_think';
          ollamaMessages = [{ role: 'system', content: systemMsg }, ...messages];
        }

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

  // ── Chat thread CRUD ──

  ipcMain.handle('db:chat-thread-create', (_event, title?: string, model?: string) => {
    const id = crypto.randomUUID();
    return chatDb.createThread(id, title || 'New Chat', model || '');
  });

  ipcMain.handle('db:chat-thread-get', (_event, id: string) => {
    return chatDb.getThread(id) || null;
  });

  ipcMain.handle('db:chat-thread-list', (_event, limit?: number, archived?: number) => {
    return chatDb.listThreads(limit ?? 50, archived ?? 0);
  });

  ipcMain.handle('db:chat-thread-update', (_event, id: string, updates: { title?: string; model?: string; metadata?: string }) => {
    chatDb.updateThread(id, updates);
    return chatDb.getThread(id) || null;
  });

  ipcMain.handle('db:chat-thread-archive', (_event, id: string) => {
    chatDb.archiveThread(id);
    return { ok: true };
  });

  ipcMain.handle('db:chat-thread-delete', (_event, id: string) => {
    chatDb.deleteThread(id);
    return { ok: true };
  });

  ipcMain.handle('db:chat-thread-search', (_event, query: string) => {
    return chatDb.searchThreads(query);
  });

  // ── Chat message CRUD ──

  ipcMain.handle('db:chat-message-add', (_event, threadId: string, role: string, content: string, metadata?: string, parentId?: string) => {
    const id = crypto.randomUUID();
    return chatDb.addMessage(id, threadId, role, content, metadata, parentId);
  });

  ipcMain.handle('db:chat-message-list', (_event, threadId: string, limit?: number, offset?: number) => {
    return chatDb.getMessages(threadId, limit ?? 200, offset ?? 0);
  });

  ipcMain.handle('db:chat-message-update', (_event, id: string, updates: { content?: string; metadata?: string }) => {
    chatDb.updateMessage(id, updates);
    return { ok: true };
  });

  ipcMain.handle('db:chat-message-delete', (_event, id: string) => {
    chatDb.deleteMessage(id);
    return { ok: true };
  });

  // ── Conversation tree queries ──

  ipcMain.handle('db:chat-message-tree', (_event, threadId: string) => {
    return chatDb.getMessageTree(threadId);
  });

  ipcMain.handle('db:chat-message-path', (_event, leafId: string) => {
    return chatDb.getMessagePath(leafId);
  });

  ipcMain.handle('db:chat-message-children', (_event, messageId: string) => {
    return chatDb.getChildren(messageId);
  });

  ipcMain.handle('db:chat-message-migrate-parents', (_event, threadId: string) => {
    chatDb.migrateThreadParentIds(threadId);
    return { ok: true };
  });
}
