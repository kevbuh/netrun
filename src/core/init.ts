import { registerAllTools, toolRegistry } from './tools/index.js';
import { providerRegistry } from './providers/registry.js';
import { OllamaProvider } from './providers/ollama.js';
import { registerToolIPC } from './ipc-handlers.js';
import { initInsight } from './ambient/index.js';
import { contextManager } from './context/manager.js';
import { contextIntake } from './context/intake.js';
import { parakeetManager } from './parakeet-manager.js';

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

  // Initialize insight pipeline
  initInsight();

  // Ensure context directory exists and intake is ready
  contextManager.getContextDir();
  void contextIntake;

  console.log(
    `[core] Initialized: ${toolRegistry.names().length} tools, ` +
    `${providerRegistry.names().length} providers`
  );
}

export { toolRegistry } from './tools/index.js';
export { providerRegistry } from './providers/registry.js';
export { getDb, closeDb } from './db/connection.js';
export { contextIntake } from './context/intake.js';
export { parakeetManager } from './parakeet-manager.js';
