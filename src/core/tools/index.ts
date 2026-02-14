export { toolRegistry, ToolRegistry } from './registry.js';
export type { Tool, ToolResult, ToolContext, ToolAccess, ToolDefinition } from './types.js';
export { webSearch, paperSearch } from './search/index.js';
export { extractText } from './content/index.js';

import { toolRegistry } from './registry.js';
import { webSearch, paperSearch } from './search/index.js';
import { extractText } from './content/index.js';

/** Register all built-in tools with the global registry */
export function registerAllTools(): void {
  toolRegistry.register(webSearch);
  toolRegistry.register(paperSearch);
  toolRegistry.register(extractText);
}
