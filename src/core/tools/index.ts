export { toolRegistry, ToolRegistry } from './registry.js';
export type { Tool, ToolResult, ToolContext, ToolAccess, ToolDefinition } from './types.js';

// Search tools
export { webSearch, paperSearch } from './search/index.js';

// Content tools
export { extractText } from './content/index.js';

// System tools
export {
  navigate, openTab, saveToReadingList, createCalendarEvent,
} from './system/index.js';

// Browser tools
export {
  browserReadPage, browserClick, browserType, browserScroll, browserNavigate, browserScreenshot,
  browserQuerySelector, browserWaitFor, browserGetUrl, browserGetTabs, browserSwitchTab, browserBack, browserForward,
  browserPressKey, browserGetStorage,
} from './browser/index.js';

// Feed tools
export { feedList, feedFetch, feedQualityFilter } from './feed/index.js';

// Social tools
export { socialUserProfile } from './social/index.js';

// Media tools
export { mediaTranscribe, mediaTts } from './media/index.js';

// Calendar tools
export { calendarList, calendarCreate, calendarUpdate, calendarDelete } from './calendar/index.js';

// Context tools
export { contextUpdate } from './context/index.js';

import { toolRegistry } from './registry.js';
import { webSearch, paperSearch } from './search/index.js';
import { extractText } from './content/index.js';
import { navigate, openTab, saveToReadingList, createCalendarEvent } from './system/index.js';
import { browserReadPage, browserClick, browserType, browserScroll, browserNavigate, browserScreenshot, browserQuerySelector, browserWaitFor, browserGetUrl, browserGetTabs, browserSwitchTab, browserBack, browserForward, browserPressKey, browserGetStorage } from './browser/index.js';
import { feedList, feedFetch, feedQualityFilter } from './feed/index.js';
import { socialUserProfile } from './social/index.js';
import { mediaTranscribe, mediaTts } from './media/index.js';
import { calendarList, calendarCreate, calendarUpdate, calendarDelete } from './calendar/index.js';
import { contextUpdate } from './context/index.js';

/** Register all built-in tools with the global registry */
export function registerAllTools(): void {
  // Search (3)
  toolRegistry.register(webSearch);
  toolRegistry.register(paperSearch);

  // Content (1)
  toolRegistry.register(extractText);

  // System (4)
  toolRegistry.register(navigate);
  toolRegistry.register(openTab);
  toolRegistry.register(saveToReadingList);
  toolRegistry.register(createCalendarEvent);

  // Browser (15)
  toolRegistry.register(browserReadPage);
  toolRegistry.register(browserClick);
  toolRegistry.register(browserType);
  toolRegistry.register(browserScroll);
  toolRegistry.register(browserNavigate);
  toolRegistry.register(browserScreenshot);
  toolRegistry.register(browserQuerySelector);
  toolRegistry.register(browserWaitFor);
  toolRegistry.register(browserGetUrl);
  toolRegistry.register(browserGetTabs);
  toolRegistry.register(browserSwitchTab);
  toolRegistry.register(browserBack);
  toolRegistry.register(browserForward);
  toolRegistry.register(browserPressKey);
  toolRegistry.register(browserGetStorage);

  // Feed (3)
  toolRegistry.register(feedList);
  toolRegistry.register(feedFetch);
  toolRegistry.register(feedQualityFilter);

  // Social (1)
  toolRegistry.register(socialUserProfile);

  // Media (2)
  toolRegistry.register(mediaTranscribe);
  toolRegistry.register(mediaTts);

  // Calendar (4)
  toolRegistry.register(calendarList);
  toolRegistry.register(calendarCreate);
  toolRegistry.register(calendarUpdate);
  toolRegistry.register(calendarDelete);

  // Context (1)
  toolRegistry.register(contextUpdate);
}
