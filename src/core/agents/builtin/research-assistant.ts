import type { AgentDefinition, AgentContext } from '../types.js';
import { getContextBudget } from '../context.js';
import { contextManager } from '../../context/manager.js';
import { selectTopicFiles } from '../../context/selector.js';

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
  const commonTools =
    'browser-press-key(key, modifiers?, element_id?) to press keyboard keys like Enter/Tab/Escape or combos like Ctrl+A, ' +
    'browser-query-selector(selector) to find elements by CSS selector, ' +
    'browser-wait-for(selector, timeout_ms) to wait for an element to appear, ' +
    'browser-get-url() to check current URL/title, ' +
    'browser-get-tabs() to list open tabs, browser-switch-tab(tab_id) to switch tabs, ' +
    'browser-back() and browser-forward() for history navigation, ' +
    'browser-get-storage(type, key_filter?) to read cookies/localStorage/sessionStorage. ';

  if (hasDom) {
    return (
      'You have browser automation tools: ' +
      'browser-click(element_id), browser-type(element_id, text), browser-scroll(direction), ' +
      'browser-navigate(url), ' + commonTools +
      'The BROWSER TAB DOM section below shows a semantic component tree of the page. ' +
      'The tree uses indentation to show hierarchy. Types include: Header, Nav, Main, Sidebar, Footer, ' +
      'Form, Dialog, VStack, HStack, Grid, List, Heading, Text, Image, etc. ' +
      'Only interactive elements have [N] IDs: Button, Link, TextField, Checkbox, Slider, Picker, Textarea, Disclosure. ' +
      'Use these numeric IDs with browser-click(element_id) and browser-type(element_id, text). ' +
      'Use the tree structure to understand page layout and find the right interactive element. ' +
      'Use browser-query-selector to find specific elements by CSS selector. ' +
      'When the user says "scroll down" or "scroll up", call browser-scroll. ' +
      'Do NOT call browser-read-page — the DOM is already provided.'
    );
  }
  return (
    'You have browser automation tools: browser-read-page (read current page DOM), ' +
    'browser-click(element_id), browser-type(element_id, text), browser-scroll(direction), ' +
    'browser-navigate(url), ' + commonTools +
    'Each page element has a numeric ID like [1], [2]. ' +
    'Use browser-query-selector to find specific elements by CSS selector. ' +
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
    'create-calendar-event',
    'browser-read-page',
    'browser-click',
    'browser-type',
    'browser-scroll',
    'browser-navigate',
    'browser-screenshot',
    'browser-query-selector',
    'browser-wait-for',
    'browser-get-url',
    'browser-get-tabs',
    'browser-switch-tab',
    'browser-back',
    'browser-forward',
    'browser-press-key',
    'browser-get-storage',
    'context-update',
  ],

  model: 'qwen3:8b',

  async preloadContext(context: AgentContext): Promise<void> {
    const model = context.model ?? 'qwen3:8b';
    const budget = getContextBudget(model);
    // Identity: ~8% of context budget (in chars, ~0.3 tokens/char)
    const identityCharLimit = Math.floor(budget * 0.08 / 0.3);
    // Topic files: ~12% of budget, split evenly
    const topicCharLimit = Math.floor(budget * 0.12 / 0.3);

    const parts: string[] = [];

    // Always load identity (main.md)
    try {
      let identity = contextManager.getMainContext();
      if (identity) {
        if (identity.length > identityCharLimit) identity = identity.slice(0, identityCharLimit);
        parts.push('## Identity\n' + identity);
      }
    } catch { /* ignore */ }

    // Select and load relevant topic files
    try {
      const query = context._userQuery ?? '';
      const { fileIds } = await selectTopicFiles(query);
      if (fileIds.length > 0) {
        const perFileLimit = Math.floor(topicCharLimit / fileIds.length);
        for (const fileId of fileIds) {
          let content = contextManager.readContextFile(fileId);
          if (content) {
            if (content.length > perFileLimit) content = content.slice(0, perFileLimit);
            parts.push(`## Topic: ${fileId}\n` + content);
          }
        }
      }
    } catch (err: any) {
      console.debug('[research-assistant] Topic file loading failed:', err?.message ?? err);
    }

    if (parts.length > 0) {
      context.contextDocument = parts.join('\n\n');
    }
  },

  buildSystemPrompt(context: AgentContext): string {
    const dateStr = `CURRENT DATE AND TIME: ${getCurrentDateString()} (local time). Always use this date/time for any time-relative requests.\n\n`;
    const hasDom = !!context.browserDom;
    const browserDesc = buildBrowserToolsDescription(hasDom);

    let pageCtx = '';
    if (context.toolsEnabled !== false && context.pageUrl) {
      pageCtx = `\n\nThe user is currently viewing: "${context.pageTitle ?? ''}" (${context.pageUrl}). Use this when they refer to "this page", "this paper", etc.`;
    }

    // Build document context section — use ~40% of model context for doc text
    const model = context.model ?? this.model ?? 'default';
    const budget = getContextBudget(model);
    const docCharLimit = Math.floor(budget * 0.4 / 0.3);
    const truncatedDoc = context.documentText
      ? context.documentText.slice(0, docCharLimit)
      : '';

    // Living context — use preloaded contextDocument (identity + topic files)
    const livingCtx = context.contextDocument
      ? '\n\n--- USER CONTEXT ---\n' + context.contextDocument + '\n--- END USER CONTEXT ---'
      : '';

    const contextToolNote = context.toolsEnabled !== false
      ? ' You have a context-update tool to remember information across conversations — use it when the user asks you to remember something or when you learn important facts.'
      : '';

    if (truncatedDoc && context.toolsEnabled !== false) {
      // With document + tools
      return (
        dateStr +
        'You are the AI assistant inside Netrun, a desktop research app with a built-in ' +
        'browser, feed reader, calendar, and workspace. The user is reading a ' +
        'document. Answer their questions based on the document text below when relevant. ' +
        'You have tools that perform real actions in the app. IMPORTANT: You MUST actually ' +
        'call the tools to perform actions — never pretend you performed an action or describe ' +
        'the result without calling the tool first. Never say you ' +
        'cannot open tabs or navigate — you can, using your tools.' +
        contextToolNote + ' ' +
        browserDesc + pageCtx + livingCtx + '\n\n' +
        '--- DOCUMENT TEXT ---\n' + truncatedDoc + '\n--- END ---'
      );
    }

    if (truncatedDoc) {
      // With document, no tools
      return (
        dateStr +
        'You are a helpful research assistant. The user is reading a document. ' +
        'Answer their questions based ONLY on the document text below. ' +
        'Do not make up information that is not in the document.' + livingCtx + '\n\n' +
        '--- DOCUMENT TEXT ---\n' + truncatedDoc + '\n--- END ---'
      );
    }

    if (context.toolsEnabled !== false) {
      // No document, with tools
      return (
        dateStr +
        'You are the AI assistant inside Netrun, a desktop research app with a built-in ' +
        'browser, feed reader, calendar, and workspace. You have tools that ' +
        'perform real actions in the app. IMPORTANT: You MUST actually call the tools to ' +
        'perform actions — never pretend you performed an action or describe the result ' +
        'without calling the tool first. Never say you cannot open tabs or ' +
        'navigate — you can, using your tools. Available tools: web-search, paper-search, ' +
        'extract-text, save-to-reading-list, navigate, ' +
        'create-calendar-event, open-tab, context-update.' +
        contextToolNote + ' ' +
        browserDesc + pageCtx + livingCtx
      );
    }

    // No document, no tools
    return dateStr + 'You are a helpful assistant.' + livingCtx;
  },
};
