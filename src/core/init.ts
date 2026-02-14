import { registerAllTools, toolRegistry } from './tools/index.js';
import { providerRegistry } from './providers/registry.js';
import { OllamaProvider } from './providers/ollama.js';
import { registerToolIPC } from './ipc-handlers.js';

/**
 * Initialize the core system: tools, providers, IPC handlers.
 * Call this from the Electron main process before creating windows.
 */
export function initCore(): void {
  // Register all built-in tools
  registerAllTools();

  // Register default LLM provider (Ollama)
  const ollama = new OllamaProvider();
  providerRegistry.register(ollama);

  // Set up IPC handlers
  registerToolIPC();

  console.log(
    `[core] Initialized: ${toolRegistry.names().length} tools, ` +
    `${providerRegistry.names().length} providers`
  );
}

export { toolRegistry } from './tools/index.js';
export { providerRegistry } from './providers/registry.js';
export { getDb, closeDb } from './db/connection.js';
