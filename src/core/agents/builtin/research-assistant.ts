import type { AgentDefinition, AgentContext } from '../types.js';

function getCurrentDateString(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  return now.toLocaleDateString('en-US', options);
}

function buildBrowserToolsDescription(hasDom: boolean): string {
  if (hasDom) {
    return (
      'You have browser automation tools: ' +
      'browser-click(element_id), browser-type(element_id, text), browser-scroll(direction), ' +
      'browser-navigate(url). The BROWSER TAB DOM section below shows the page elements with [N] IDs. ' +
      'Use these IDs directly with browser-click/browser-type. ' +
      'When the user says "scroll down" or "scroll up", call browser-scroll. ' +
      'Do NOT call browser-read-page — the DOM is already provided.'
    );
  }
  return (
    'You have browser automation tools: browser-read-page (read current page DOM), ' +
    'browser-click(element_id), browser-type(element_id, text), browser-scroll(direction), ' +
    'browser-navigate(url). Each page element has a numeric ID like [1], [2]. ' +
    'When the user says "scroll down" or "scroll up", call browser-scroll.'
  );
}

/**
 * The general research assistant agent.
 * Replaces the doc_chat endpoint with an equivalent system prompt and tool set.
 */
export const researchAssistant: AgentDefinition = {
  id: 'research-assistant',
  name: 'Research Assistant',
  description: 'General-purpose AI assistant for research, browsing, and app control',

  tools: [
    'web-search',
    'paper-search',
    'extract-text',
    'navigate',
    'open-tab',
    'save-to-reading-list',
    'create-experiment',
    'create-calendar-event',
    'browser-read-page',
    'browser-click',
    'browser-type',
    'browser-scroll',
    'browser-navigate',
    'browser-screenshot',
  ],

  model: 'qwen3:8b',

  buildSystemPrompt(context: AgentContext): string {
    const dateStr = `CURRENT DATE AND TIME: ${getCurrentDateString()} (local time). Always use this date/time for any time-relative requests.\n\n`;
    const hasDom = !!context.browserDom;
    const browserDesc = buildBrowserToolsDescription(hasDom);

    let pageCtx = '';
    if (context.toolsEnabled !== false && context.pageUrl) {
      pageCtx = `\n\nThe user is currently viewing: "${context.pageTitle ?? ''}" (${context.pageUrl}). Use this when they refer to "this page", "this paper", etc.`;
    }

    // Build document context section
    const truncatedDoc = context.documentText
      ? context.documentText.slice(0, 12000)
      : '';

    if (truncatedDoc && context.toolsEnabled !== false) {
      // With document + tools
      return (
        dateStr +
        'You are the AI assistant inside Aether, a desktop research app with a built-in ' +
        'browser, feed reader, calendar, and experiment workspace. The user is reading a ' +
        'document. Answer their questions based on the document text below when relevant. ' +
        'You have tools that perform real actions in the app. IMPORTANT: You MUST actually ' +
        'call the tools to perform actions — never pretend you performed an action or describe ' +
        'the result without calling the tool first. Never say you ' +
        'cannot open tabs or navigate — you can, using your tools. ' +
        browserDesc + pageCtx + '\n\n' +
        '--- DOCUMENT TEXT ---\n' + truncatedDoc + '\n--- END ---'
      );
    }

    if (truncatedDoc) {
      // With document, no tools
      return (
        dateStr +
        'You are a helpful research assistant. The user is reading a document. ' +
        'Answer their questions based ONLY on the document text below. ' +
        'Do not make up information that is not in the document.\n\n' +
        '--- DOCUMENT TEXT ---\n' + truncatedDoc + '\n--- END ---'
      );
    }

    if (context.toolsEnabled !== false) {
      // No document, with tools
      return (
        dateStr +
        'You are the AI assistant inside Aether, a desktop research app with a built-in ' +
        'browser, feed reader, calendar, and experiment workspace. You have tools that ' +
        'perform real actions in the app. IMPORTANT: You MUST actually call the tools to ' +
        'perform actions — never pretend you performed an action or describe the result ' +
        'without calling the tool first. Never say you cannot open tabs or ' +
        'navigate — you can, using your tools. Available tools: web-search, paper-search, ' +
        'extract-text, save-to-reading-list, navigate, create-experiment, ' +
        'create-calendar-event, open-tab. ' +
        browserDesc + pageCtx
      );
    }

    // No document, no tools
    return dateStr + 'You are a helpful assistant.';
  },
};
