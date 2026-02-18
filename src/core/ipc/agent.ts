import { ipcMain } from 'electron';
import { runAgent, resolveActionResult } from '../agents/runtime.js';
import { agentRegistry } from '../agents/registry.js';
import type { AgentContext, AgentMessage } from '../agents/types.js';
import { activeSessions } from './shared.js';

export function registerAgentIPC(): void {
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

    // Look up agent definition from registry (default: research-assistant)
    const agent = agentRegistry.get(options.agentId ?? 'research-assistant')
      ?? agentRegistry.get('research-assistant');

    if (!agent) {
      const webContents = event.sender;
      if (!webContents.isDestroyed()) {
        webContents.send('agent:event', sessionId, {
          type: 'error',
          error: `Unknown agent: ${options.agentId}`,
        });
      }
      return { sessionId };
    }

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

  /** List all registered agents (lightweight metadata) */
  ipcMain.handle('agent:list', () => {
    return agentRegistry.list();
  });

  /** Receive async action results from the renderer */
  ipcMain.handle('agent:action-result', (_event, requestId: string, result: unknown) => {
    resolveActionResult(requestId, result);
    return { ok: true };
  });
}
