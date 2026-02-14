import { ipcMain, BrowserWindow } from 'electron';
import { toolRegistry } from './tools/index.js';
import type { ToolContext } from './tools/types.js';
import { providerRegistry } from './providers/registry.js';
import { runAgent } from './agents/runtime.js';
import { researchAssistant } from './agents/builtin/research-assistant.js';
import type { AgentContext, AgentMessage, AgentEvent } from './agents/types.js';

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
}
