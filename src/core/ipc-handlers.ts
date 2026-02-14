import { ipcMain } from 'electron';
import { toolRegistry } from './tools/index.js';
import type { ToolContext } from './tools/types.js';
import { providerRegistry } from './providers/registry.js';

/**
 * Register all IPC handlers for the tool system.
 * These handlers bridge the renderer process to the core tool/provider layer.
 */
export function registerToolIPC(): void {
  // ── Tool system ──

  /** Execute a tool by name */
  ipcMain.handle('tools:execute', async (_event, name: string, input: unknown, contextData?: Partial<ToolContext>) => {
    const context: ToolContext = {
      googleId: contextData?.googleId,
    };
    return toolRegistry.execute(name, input, context);
  });

  /** List all available tools */
  ipcMain.handle('tools:list', () => {
    return toolRegistry.all().map(t => ({
      name: t.name,
      description: t.description,
      category: t.category,
      access: t.access,
    }));
  });

  /** Get tool definitions for LLM tool calling */
  ipcMain.handle('tools:definitions', (_event, access?: string) => {
    return toolRegistry.toToolDefinitions((access as any) ?? 'agent');
  });

  // ── Provider system ──

  /** List available LLM providers */
  ipcMain.handle('providers:list', () => {
    return providerRegistry.names();
  });

  /** List models for a provider */
  ipcMain.handle('providers:models', async (_event, providerName?: string) => {
    const provider = providerName
      ? providerRegistry.get(providerName)
      : providerRegistry.getDefault();
    if (!provider) return [];
    return provider.listModels();
  });
}
