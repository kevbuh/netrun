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

/** Route map: source → default topic file + description */
const SOURCE_ROUTES: Record<string, { file: string; description: string }> = {
  search: { file: 'research.md', description: 'Web search results and research findings' },
  browse: { file: 'browsing.md', description: 'Browsing history and page notes' },
  feed: { file: 'reading.md', description: 'Feed articles and reading notes' },
  notebook: { file: 'notebooks.md', description: 'Notebook outputs and results' },
  dashboard: { file: 'stats.md', description: 'Dashboard snapshots and statistics' },
};

/** Identity sections that should stay in main.md */
const IDENTITY_SECTIONS = ['## Preferences', '## Goals', '## About Me', '## Identity'];

/** Determine which file an entry should be routed to */
function routeToFile(entry: IntakeEntry): string {
  // Explicit file always wins
  if (entry.file) return entry.file;

  // Identity-relevant sections stay in main.md
  if (IDENTITY_SECTIONS.some(s => entry.section.startsWith(s))) return 'main.md';

  // Chat source often has identity-relevant content
  if (entry.source === 'chat') return 'main.md';

  // Agent source: default to main.md (agent can specify file explicitly)
  if (entry.source === 'agent') return 'main.md';

  // Route by source to topic files
  const route = SOURCE_ROUTES[entry.source];
  if (route) {
    // Auto-create the topic file if it doesn't exist
    const size = contextManager.getContextSize(route.file);
    if (size === 0) {
      contextManager.createTopicFile(
        route.file.replace('.md', ''),
        route.description,
      );
    }
    return route.file;
  }

  return 'main.md';
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
      const file = routeToFile(entry);
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
