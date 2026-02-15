export { toolRegistry, ToolRegistry } from './registry.js';
export type { Tool, ToolResult, ToolContext, ToolAccess, ToolDefinition } from './types.js';

// Search tools
export { webSearch, paperSearch } from './search/index.js';

// Content tools
export { extractText } from './content/index.js';

// System tools
export {
  navigate, openTab, saveToReadingList, createExperiment, createCalendarEvent,
} from './system/index.js';

// Browser tools
export {
  browserReadPage, browserClick, browserType, browserScroll, browserNavigate, browserScreenshot,
  browserQuerySelector, browserWaitFor, browserGetUrl, browserGetTabs, browserSwitchTab, browserBack, browserForward,
} from './browser/index.js';

// Vault tools
export {
  vaultListNotes, vaultGetNote, vaultCreateNote, vaultUpdateNote, vaultDeleteNote, vaultSearch,
} from './vault/index.js';

// Experiment tools
export {
  experimentList, experimentCreate, experimentListFiles, experimentGetFile,
  experimentWriteFile, experimentDelete, experimentExecuteCode,
} from './experiment/index.js';

// Feed tools
export { feedList, feedFetch, feedQualityFilter } from './feed/index.js';

// Social tools
export { socialListTeams, socialSendMessage, socialGetMessages, socialUserProfile } from './social/index.js';

// Media tools
export { mediaTranscribe, mediaTts } from './media/index.js';

// Calendar tools
export { calendarList, calendarCreate, calendarUpdate, calendarDelete } from './calendar/index.js';

// Memory tools
export { memoryEmbedContent, memorySemanticSearch, memorySaveChatMemory, memoryRecallChat } from './memory/index.js';

import { toolRegistry } from './registry.js';
import { webSearch, paperSearch } from './search/index.js';
import { extractText } from './content/index.js';
import { navigate, openTab, saveToReadingList, createExperiment, createCalendarEvent } from './system/index.js';
import { browserReadPage, browserClick, browserType, browserScroll, browserNavigate, browserScreenshot, browserQuerySelector, browserWaitFor, browserGetUrl, browserGetTabs, browserSwitchTab, browserBack, browserForward } from './browser/index.js';
import { vaultListNotes, vaultGetNote, vaultCreateNote, vaultUpdateNote, vaultDeleteNote, vaultSearch } from './vault/index.js';
import { experimentList, experimentCreate, experimentListFiles, experimentGetFile, experimentWriteFile, experimentDelete, experimentExecuteCode } from './experiment/index.js';
import { feedList, feedFetch, feedQualityFilter } from './feed/index.js';
import { socialListTeams, socialSendMessage, socialGetMessages, socialUserProfile } from './social/index.js';
import { mediaTranscribe, mediaTts } from './media/index.js';
import { calendarList, calendarCreate, calendarUpdate, calendarDelete } from './calendar/index.js';
import { memoryEmbedContent, memorySemanticSearch, memorySaveChatMemory, memoryRecallChat } from './memory/index.js';

/** Register all built-in tools with the global registry */
export function registerAllTools(): void {
  // Search (3)
  toolRegistry.register(webSearch);
  toolRegistry.register(paperSearch);

  // Content (1)
  toolRegistry.register(extractText);

  // System (5)
  toolRegistry.register(navigate);
  toolRegistry.register(openTab);
  toolRegistry.register(saveToReadingList);
  toolRegistry.register(createExperiment);
  toolRegistry.register(createCalendarEvent);

  // Browser (13)
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

  // Vault (6)
  toolRegistry.register(vaultListNotes);
  toolRegistry.register(vaultGetNote);
  toolRegistry.register(vaultCreateNote);
  toolRegistry.register(vaultUpdateNote);
  toolRegistry.register(vaultDeleteNote);
  toolRegistry.register(vaultSearch);

  // Experiment (7)
  toolRegistry.register(experimentList);
  toolRegistry.register(experimentCreate);
  toolRegistry.register(experimentListFiles);
  toolRegistry.register(experimentGetFile);
  toolRegistry.register(experimentWriteFile);
  toolRegistry.register(experimentDelete);
  toolRegistry.register(experimentExecuteCode);

  // Feed (3)
  toolRegistry.register(feedList);
  toolRegistry.register(feedFetch);
  toolRegistry.register(feedQualityFilter);

  // Social (4)
  toolRegistry.register(socialListTeams);
  toolRegistry.register(socialSendMessage);
  toolRegistry.register(socialGetMessages);
  toolRegistry.register(socialUserProfile);

  // Media (2)
  toolRegistry.register(mediaTranscribe);
  toolRegistry.register(mediaTts);

  // Calendar (4)
  toolRegistry.register(calendarList);
  toolRegistry.register(calendarCreate);
  toolRegistry.register(calendarUpdate);
  toolRegistry.register(calendarDelete);

  // Memory (4)
  toolRegistry.register(memoryEmbedContent);
  toolRegistry.register(memorySemanticSearch);
  toolRegistry.register(memorySaveChatMemory);
  toolRegistry.register(memoryRecallChat);
}
