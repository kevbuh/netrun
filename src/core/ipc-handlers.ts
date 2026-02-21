import { registerToolsProvidersIPC } from './ipc/tools-providers.js';
import { registerAgentIPC } from './ipc/agent.js';
import { registerDbQueriesIPC } from './ipc/db-queries.js';
import { registerBrowseIPC } from './ipc/browse.js';
import { registerFeedsIPC } from './ipc/feeds.js';
import { registerContextIPC } from './ipc/context.js';
import { registerChatIPC } from './ipc/chat.js';
import { registerSystemIPC } from './ipc/system.js';
import { registerDevIPC } from './ipc/dev.js';
import { registerNeuralookIPC } from './ipc/neuralook.js';
import { registerTerminalIPC } from './ipc/terminal.js';
import { registerSettingsIPC } from './ipc/settings.js';
import { registerPdfConvertIPC } from './ipc/pdf-convert.js';
import { registerBookmarkImportIPC } from './ipc/bookmark-import.js';

/**
 * Register all IPC handlers for the tool system and agent runtime.
 */
export function registerToolIPC(): void {
  registerToolsProvidersIPC();
  registerAgentIPC();
  registerDbQueriesIPC();
  registerBrowseIPC();
  registerFeedsIPC();
  registerContextIPC();
  registerChatIPC();
  registerSystemIPC();
  registerDevIPC();
  registerNeuralookIPC();
  registerTerminalIPC();
  registerSettingsIPC();
  registerPdfConvertIPC();
  registerBookmarkImportIPC();
}
