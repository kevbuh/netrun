export { toolRegistry, ToolRegistry } from './registry.js';
export type { Tool, ToolResult, ToolContext, ToolAccess, ToolDefinition } from './types.js';

// Search tools
export { webSearch, paperSearch } from './search/index.js';

// Content tools
export { extractText } from './content/index.js';

// System tools
export {
  navigate,
  openTab,
  saveToReadingList,
  createExperiment,
  createCalendarEvent,
} from './system/index.js';

// Browser tools
export {
  browserReadPage,
  browserClick,
  browserType,
  browserScroll,
  browserNavigate,
  browserScreenshot,
} from './browser/index.js';

import { toolRegistry } from './registry.js';
import { webSearch, paperSearch } from './search/index.js';
import { extractText } from './content/index.js';
import {
  navigate,
  openTab,
  saveToReadingList,
  createExperiment,
  createCalendarEvent,
} from './system/index.js';
import {
  browserReadPage,
  browserClick,
  browserType,
  browserScroll,
  browserNavigate,
  browserScreenshot,
} from './browser/index.js';

/** Register all built-in tools with the global registry */
export function registerAllTools(): void {
  // Search
  toolRegistry.register(webSearch);
  toolRegistry.register(paperSearch);

  // Content
  toolRegistry.register(extractText);

  // System
  toolRegistry.register(navigate);
  toolRegistry.register(openTab);
  toolRegistry.register(saveToReadingList);
  toolRegistry.register(createExperiment);
  toolRegistry.register(createCalendarEvent);

  // Browser
  toolRegistry.register(browserReadPage);
  toolRegistry.register(browserClick);
  toolRegistry.register(browserType);
  toolRegistry.register(browserScroll);
  toolRegistry.register(browserNavigate);
  toolRegistry.register(browserScreenshot);
}
