import { ipcMain } from 'electron';
import { toolRegistry } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import { providerRegistry } from '../providers/registry.js';
import { openrouterProvider, setActiveProviderName, getActiveProviderName } from './shared.js';
import * as settingsQueries from '../db/queries/settings.js';

export function registerToolsProvidersIPC(): void {
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

  ipcMain.handle('providers:set-default', (_event, name: string) => {
    if (name !== 'ollama' && name !== 'openrouter') {
      return { error: `Unknown provider: ${name}` };
    }
    setActiveProviderName(name);
    providerRegistry.setDefault(name);
    settingsQueries.setSetting('aiProvider', name);
    return { ok: true, provider: name };
  });

  ipcMain.handle('providers:get-default', () => {
    return { provider: getActiveProviderName() };
  });

  ipcMain.handle('providers:set-api-key', (_event, provider: string, key: string) => {
    if (provider === 'openrouter') {
      openrouterProvider.setApiKey(key || null);
      // Encrypted storage is handled by 'set-api-key-secure' IPC
      // called from the renderer alongside this call
      return { ok: true };
    }
    return { error: `Unknown provider: ${provider}` };
  });

  ipcMain.handle('providers:get-api-key', (_event, provider: string) => {
    if (provider === 'openrouter') {
      return { key: openrouterProvider.getApiKey() ?? '' };
    }
    return { key: '' };
  });
}
