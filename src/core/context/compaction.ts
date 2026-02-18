import { contextManager } from './manager.js';
import { providerRegistry } from '../providers/registry.js';

const COMPACTION_DEBOUNCE_MS = 30_000;
const pendingCompactions = new Map<string, ReturnType<typeof setTimeout>>();

/** Per-type compaction thresholds */
const TYPE_THRESHOLDS: Record<string, number> = {
  identity: 16000,
  topic: 8000,
  task: 6000,
};

const COMPACTION_PROMPT_DEFAULT =
  'Summarize this context document, preserving all key facts, decisions, and active tasks. ' +
  'Remove redundancy. Be concise. Keep the markdown section structure (## headings). ' +
  'Content has provenance tags like <!-- ctx:SOURCE t:TIMESTAMP -->. Use them to prioritize:\n' +
  '- KEEP: Chat Insights, Research results, Notebook Results (these are high-value)\n' +
  '- COMPRESS: Browsing links (keep only notable pages with annotations, drop plain link lists)\n' +
  '- LATEST ONLY: Stats snapshots (keep only the most recent)\n' +
  '- PRESERVE: Section headings and source markers on retained content\n' +
  'Output only the compacted markdown, nothing else.';

const COMPACTION_PROMPT_IDENTITY =
  'Compact this identity/context document. You MUST preserve ALL personal facts, preferences, ' +
  'goals, and user identity information — these are irreplaceable. ' +
  'Remove redundancy and compress ephemeral data (browsing links, stats snapshots). ' +
  'Keep the markdown section structure (## headings). ' +
  'Output only the compacted markdown, nothing else.';

/** Schedule compaction for a file if it exceeds the threshold. Debounced to avoid thrashing. */
export function scheduleCompaction(file: string, threshold?: number): void {
  // Use per-type threshold if not explicitly provided
  if (threshold === undefined) {
    const fileType = contextManager.getFileType(file);
    threshold = TYPE_THRESHOLDS[fileType] ?? 8000;
  }
  if (!contextManager.needsCompaction(file, threshold)) return;

  // Cancel any pending compaction for this file
  const existing = pendingCompactions.get(file);
  if (existing) clearTimeout(existing);

  pendingCompactions.set(file, setTimeout(() => {
    pendingCompactions.delete(file);
    runCompaction(file).catch(err => {
      console.debug('[context] Compaction failed for', file, err?.message ?? err);
    });
  }, COMPACTION_DEBOUNCE_MS));
}

/** Run compaction on a context file: archive, summarize via LLM, write back. */
export async function runCompaction(file: string): Promise<void> {
  const content = contextManager.readContextFile(file);
  if (!content || content.length < 1000) return;

  const provider = providerRegistry.getDefault();
  if (!provider) {
    console.debug('[context] No LLM provider for compaction');
    return;
  }

  // Archive current version before compacting
  contextManager.archiveVersion(file);

  // Use identity-preserving prompt for main.md
  const fileType = contextManager.getFileType(file);
  const prompt = fileType === 'identity' ? COMPACTION_PROMPT_IDENTITY : COMPACTION_PROMPT_DEFAULT;

  try {
    const response = await provider.chat({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content },
      ],
      temperature: 0.1,
      maxTokens: 2000,
    });

    const compacted = response.message.content?.trim();
    if (compacted && compacted.length > 100 && compacted.length < content.length) {
      contextManager.writeContextFile(file, compacted);
    }
  } catch (err: any) {
    console.debug('[context] Compaction LLM call failed:', err?.message ?? err);
  }
}
