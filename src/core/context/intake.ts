import { contextManager } from './manager.js';
import { scheduleCompaction } from './compaction.js';

export type ContextSource = 'chat' | 'search' | 'feed' | 'browse' | 'notebook' | 'dashboard' | 'agent';

export interface IntakeEntry {
  source: ContextSource;
  section: string;
  content: string;
  file?: string;
  dedupeKey?: string;
}

const FLUSH_INTERVAL_MS = 10_000;
const DEDUPE_WINDOW_MS = 5 * 60_000;

class ContextIntake {
  private queue: IntakeEntry[] = [];
  private seen = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  /** Queue an entry for batched writing to context */
  ingest(entry: IntakeEntry): void {
    // Deduplication check
    if (entry.dedupeKey) {
      const lastSeen = this.seen.get(entry.dedupeKey);
      if (lastSeen && Date.now() - lastSeen < DEDUPE_WINDOW_MS) return;
      this.seen.set(entry.dedupeKey, Date.now());
    }

    this.queue.push(entry);
  }

  /** Flush queued entries to context files */
  flush(): void {
    if (this.queue.length === 0) return;

    // Group entries by file + section
    const groups = new Map<string, { file: string; section: string; lines: string[]; source: ContextSource }>();

    for (const entry of this.queue) {
      const file = entry.file || 'main.md';
      const key = `${file}::${entry.section}`;
      let group = groups.get(key);
      if (!group) {
        group = { file, section: entry.section, lines: [], source: entry.source };
        groups.set(key, group);
      }
      const tag = `<!-- ctx:${entry.source} t:${Math.floor(Date.now() / 1000)} -->`;
      group.lines.push(entry.content + ' ' + tag);
    }

    this.queue = [];

    // Write each group as a single appendContext call
    for (const group of groups.values()) {
      try {
        contextManager.appendContext(group.file, group.section, group.lines.join('\n') + '\n');
        scheduleCompaction(group.file);
      } catch (err: any) {
        console.debug('[context-intake] Write failed:', err?.message ?? err);
      }
    }

    // Prune old dedupe entries
    const now = Date.now();
    for (const [key, ts] of this.seen) {
      if (now - ts > DEDUPE_WINDOW_MS) this.seen.delete(key);
    }
  }

  /** Flush and stop the timer (for shutdown) */
  shutdown(): void {
    this.flush();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const contextIntake = new ContextIntake();
