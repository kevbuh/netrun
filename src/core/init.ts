import { registerAllTools, toolRegistry } from './tools/index.js';
import { registerAllAgents, agentRegistry } from './agents/index.js';
import { providerRegistry } from './providers/registry.js';
import { registerToolIPC } from './ipc-handlers.js';
import { initInsight } from './ambient/index.js';
import { contextManager } from './context/manager.js';
import { contextIntake } from './context/intake.js';
import { parakeetManager } from './parakeet-manager.js';
import { loggingMiddleware, timeoutMiddleware } from './tools/middleware/index.js';
import { ollamaProvider, openrouterProvider, setActiveProviderName } from './ipc/shared.js';
import * as settingsQueries from './db/queries/settings.js';

/**
 * Initialize the core system: tools, providers, agents, IPC handlers.
 * Call this from the Electron main process before creating windows.
 */
export function initCore(): void {
  // Register all built-in tools
  registerAllTools();

  // Register middleware (logging outermost, timeout inner)
  toolRegistry.use(loggingMiddleware);
  toolRegistry.use(timeoutMiddleware);

  // Register all built-in agents
  registerAllAgents();

  // Register LLM providers
  providerRegistry.register(ollamaProvider);
  providerRegistry.register(openrouterProvider);

  // Restore active provider and API key from settings DB
  try {
    const providerSetting = settingsQueries.getSetting('aiProvider');
    if (providerSetting?.value === 'openrouter') {
      setActiveProviderName('openrouter');
      providerRegistry.setDefault('openrouter');
    }
    const apiKeySetting = settingsQueries.getSetting('openrouterApiKey');
    if (apiKeySetting?.value) {
      openrouterProvider.setApiKey(apiKeySetting.value);
    }
  } catch { /* DB may not be ready yet */ }

  // Set up IPC handlers
  registerToolIPC();

  // Initialize insight pipeline
  initInsight();

  // Ensure context directory exists and intake is ready
  contextManager.getContextDir();
  void contextIntake;

  console.log(
    `[core] Initialized: ${toolRegistry.names().length} tools, ` +
    `${providerRegistry.names().length} providers, ` +
    `${agentRegistry.names().length} agents`
  );
}

export { toolRegistry } from './tools/index.js';
export { agentRegistry } from './agents/index.js';
export { providerRegistry } from './providers/registry.js';
export { getDb, closeDb } from './db/connection.js';
export { contextIntake } from './context/intake.js';
export { parakeetManager } from './parakeet-manager.js';
