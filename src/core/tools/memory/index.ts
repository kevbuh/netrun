import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';
import { providerRegistry } from '../../providers/registry.js';

const embedContentParams = z.object({
  text: z.string().describe('Text content to embed'),
  title: z.string().describe('Title for the embedding'),
  link: z.string().describe('Source link/URL'),
  source: z.string().optional().describe('Source identifier'),
  contentType: z.string().optional().describe('Content type (e.g., paper, note, feed)'),
});

export const memoryEmbedContent: Tool<z.infer<typeof embedContentParams>, any> = {
  name: 'memory-embed-content',
  description: 'Generate and store an embedding for text content.',
  category: 'memory',
  access: ['agent', 'mcp', 'ui'],
  parameters: embedContentParams,
  async execute(input): Promise<ToolResult> {
    const provider = providerRegistry.getDefault();
    if (!provider) return { success: false, error: 'No LLM provider configured' };

    try {
      const vec = await provider.embed(input.text);
      const { storeEmbedding } = await import('../../db/queries/embeddings.js');
      const stored = storeEmbedding(
        input.text,
        input.title,
        input.link,
        input.source ?? '',
        input.contentType ?? 'general',
        vec
      );
      return { success: true, data: { stored, dimensions: vec.length } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const semanticSearchParams = z.object({
  query: z.string().describe('Search query'),
  contentType: z.string().optional().describe('Filter by content type'),
  limit: z.number().optional().describe('Max results'),
});

export const memorySemanticSearch: Tool<z.infer<typeof semanticSearchParams>, any> = {
  name: 'memory-semantic-search',
  description: 'Search stored content using semantic similarity.',
  category: 'memory',
  access: ['agent', 'mcp', 'ui'],
  parameters: semanticSearchParams,
  async execute(input): Promise<ToolResult> {
    const provider = providerRegistry.getDefault();
    if (!provider) return { success: false, error: 'No LLM provider configured' };

    try {
      const queryVec = await provider.embed(input.query);
      const { searchEmbeddings } = await import('../../db/queries/embeddings.js');
      const results = searchEmbeddings(queryVec, input.contentType, input.limit ?? 5);
      return { success: true, data: { results } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const saveChatMemoryParams = z.object({
  summary: z.string().describe('Conversation summary'),
  topics: z.string().optional().describe('Comma-separated topic keywords'),
  pageUrl: z.string().optional().describe('URL of page being discussed'),
  pageTitle: z.string().optional().describe('Title of page being discussed'),
  messageCount: z.number().optional().describe('Number of messages in conversation'),
});

export const memorySaveChatMemory: Tool<z.infer<typeof saveChatMemoryParams>, any> = {
  name: 'memory-save-chat',
  description: 'Save a chat conversation summary to memory.',
  category: 'memory',
  access: ['agent', 'ui'],
  parameters: saveChatMemoryParams,
  async execute(input): Promise<ToolResult> {
    const provider = providerRegistry.getDefault();
    try {
      let vec: number[] | undefined;
      if (provider) {
        vec = await provider.embed(input.summary);
      }
      const { storeChatMemory } = await import('../../db/queries/embeddings.js');
      storeChatMemory(
        input.summary,
        input.topics ?? '',
        input.pageUrl ?? '',
        input.pageTitle ?? '',
        input.messageCount ?? 0,
        vec
      );
      return { success: true, data: { saved: true } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const recallMemoriesParams = z.object({
  query: z.string().describe('Query to find relevant past conversations'),
  limit: z.number().optional().describe('Max memories to return'),
});

export const memoryRecallChat: Tool<z.infer<typeof recallMemoriesParams>, any> = {
  name: 'memory-recall-chat',
  description: 'Recall past chat conversations relevant to a query.',
  category: 'memory',
  access: ['agent', 'ui'],
  parameters: recallMemoriesParams,
  async execute(input): Promise<ToolResult> {
    const provider = providerRegistry.getDefault();
    if (!provider) return { success: false, error: 'No LLM provider configured' };

    try {
      const queryVec = await provider.embed(input.query);
      const { searchChatMemories } = await import('../../db/queries/embeddings.js');
      const memories = searchChatMemories(queryVec, input.limit ?? 3);
      return { success: true, data: { memories } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
