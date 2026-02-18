import { listTopicIndex } from './manager.js';
import { providerRegistry } from '../providers/registry.js';
import type { TopicIndexEntry } from './manager.js';

const MAX_SELECTED = 3;

/**
 * Select which topic files are relevant to a user query.
 * If ≤3 topic files exist, returns all (skips LLM).
 * Otherwise calls the LLM with a compact index to pick up to 3.
 * Falls back to most recently updated files on error.
 */
export async function selectTopicFiles(
  userQuery: string,
  signal?: AbortSignal,
): Promise<{ fileIds: string[] }> {
  const index = listTopicIndex();
  if (index.length === 0) return { fileIds: [] };

  // If few enough files, return all — no LLM needed
  if (index.length <= MAX_SELECTED) {
    return { fileIds: index.map(e => e.fileId) };
  }

  // Build compact index string for the LLM
  const indexStr = index
    .map(e => `- ${e.fileId}: ${e.description || '(no description)'} (${e.charCount} chars, updated ${new Date(e.updatedAt * 1000).toLocaleDateString()})`)
    .join('\n');

  const provider = providerRegistry.getDefault();
  if (!provider) {
    return fallback(index);
  }

  try {
    const response = await provider.chat({
      messages: [
        {
          role: 'system',
          content:
            'You select which context files are relevant to a user query. ' +
            'Return ONLY a JSON array of up to 3 file_id strings. No explanation.',
        },
        {
          role: 'user',
          content: `Topic files:\n${indexStr}\n\nUser query: "${userQuery}"\n\nReturn JSON array of relevant file_ids:`,
        },
      ],
      temperature: 0,
      maxTokens: 100,
      signal,
    });

    const text = response.message.content?.trim() ?? '';
    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as string[];
      const validIds = new Set(index.map(e => e.fileId));
      const selected = parsed.filter(id => validIds.has(id)).slice(0, MAX_SELECTED);
      if (selected.length > 0) {
        console.debug('[context-selector] Selected:', selected);
        return { fileIds: selected };
      }
    }
  } catch (err: any) {
    console.debug('[context-selector] LLM selection failed:', err?.message ?? err);
  }

  return fallback(index);
}

/** Fallback: return the 3 most recently updated topic files */
function fallback(index: TopicIndexEntry[]): { fileIds: string[] } {
  const fileIds = index
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SELECTED)
    .map(e => e.fileId);
  console.debug('[context-selector] Fallback selection:', fileIds);
  return { fileIds };
}
