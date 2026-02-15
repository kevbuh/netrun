import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../db/connection.js';

const CONTEXT_DIR = path.join(process.env.HOME ?? '/tmp', '.netrun', 'context');
const ARCHIVE_DIR = path.join(CONTEXT_DIR, 'archive');

/** Ensure the context directories exist */
function ensureDirs(): void {
  fs.mkdirSync(CONTEXT_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

export interface ContextFile {
  fileId: string;
  filePath: string;
  createdAt: number;
  updatedAt: number;
  compactedAt: number | null;
  charCount: number;
}

/** Read the main context file */
export function getMainContext(): string {
  ensureDirs();
  const p = path.join(CONTEXT_DIR, 'main.md');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf-8');
}

/** Read a task-specific context file */
export function getTaskContext(taskId: string): string {
  ensureDirs();
  const p = path.join(CONTEXT_DIR, `task-${taskId}.md`);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf-8');
}

/** List all context files with metadata */
export function listContextFiles(): ContextFile[] {
  ensureDirs();
  try {
    const db = getDb();
    return db.prepare(
      'SELECT file_id, file_path, created_at, updated_at, compacted_at, char_count FROM context_meta ORDER BY updated_at DESC'
    ).all() as ContextFile[];
  } catch {
    return [];
  }
}

/** Append content to a section in a context file */
export function appendContext(file: string, section: string, content: string): void {
  ensureDirs();
  const p = path.join(CONTEXT_DIR, file);
  let existing = '';
  if (fs.existsSync(p)) {
    existing = fs.readFileSync(p, 'utf-8');
  }

  // Find section or append at end
  const sectionIdx = existing.indexOf(section);
  let updated: string;
  if (sectionIdx !== -1) {
    // Find the next section heading (## or end of file)
    const afterSection = existing.indexOf('\n## ', sectionIdx + section.length);
    const insertAt = afterSection !== -1 ? afterSection : existing.length;
    updated = existing.slice(0, insertAt).trimEnd() + '\n' + content + '\n' +
      (afterSection !== -1 ? existing.slice(afterSection) : '');
  } else {
    // Section doesn't exist, create it
    updated = existing.trimEnd() + '\n\n' + section + '\n' + content + '\n';
  }

  fs.writeFileSync(p, updated.trimStart());
  _updateMeta(file, updated.length);
}

/** Replace a section's content in a context file */
export function replaceSection(file: string, section: string, content: string): void {
  ensureDirs();
  const p = path.join(CONTEXT_DIR, file);
  let existing = '';
  if (fs.existsSync(p)) {
    existing = fs.readFileSync(p, 'utf-8');
  }

  const sectionIdx = existing.indexOf(section);
  if (sectionIdx !== -1) {
    const afterSection = existing.indexOf('\n## ', sectionIdx + section.length);
    const before = existing.slice(0, sectionIdx);
    const after = afterSection !== -1 ? existing.slice(afterSection) : '';
    const updated = before + section + '\n' + content + '\n' + after;
    fs.writeFileSync(p, updated.trimStart());
    _updateMeta(file, updated.length);
  } else {
    // Section doesn't exist, create it
    appendContext(file, section, content);
  }
}

/** Get the character count of a context file */
export function getContextSize(file: string): number {
  const p = path.join(CONTEXT_DIR, file);
  if (!fs.existsSync(p)) return 0;
  return fs.readFileSync(p, 'utf-8').length;
}

/** Check if a context file needs compaction */
export function needsCompaction(file: string, threshold = 8000): boolean {
  return getContextSize(file) > threshold;
}

/** Archive the current version of a context file */
export function archiveVersion(file: string): void {
  ensureDirs();
  const p = path.join(CONTEXT_DIR, file);
  if (!fs.existsSync(p)) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = path.basename(file, '.md');
  const archivePath = path.join(ARCHIVE_DIR, `${baseName}-${timestamp}.md`);
  fs.copyFileSync(p, archivePath);
}

/** Read a context file's raw content */
export function readContextFile(file: string): string {
  ensureDirs();
  const p = path.join(CONTEXT_DIR, file);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf-8');
}

/** Write a context file's raw content */
export function writeContextFile(file: string, content: string): void {
  ensureDirs();
  const p = path.join(CONTEXT_DIR, file);
  fs.writeFileSync(p, content);
  _updateMeta(file, content.length);
}

/** Delete a context file */
export function deleteContextFile(file: string): void {
  const p = path.join(CONTEXT_DIR, file);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  try {
    const db = getDb();
    db.prepare('DELETE FROM context_meta WHERE file_id = ?').run(file);
  } catch { /* ignore */ }
}

/** Update metadata tracking for a context file */
function _updateMeta(file: string, charCount: number): void {
  try {
    const db = getDb();
    const now = Date.now() / 1000;
    const existing = db.prepare('SELECT 1 FROM context_meta WHERE file_id = ?').get(file);
    if (existing) {
      db.prepare('UPDATE context_meta SET updated_at = ?, char_count = ? WHERE file_id = ?')
        .run(now, charCount, file);
    } else {
      const filePath = path.join(CONTEXT_DIR, file);
      db.prepare(
        'INSERT INTO context_meta (file_id, file_path, created_at, updated_at, char_count) VALUES (?, ?, ?, ?, ?)'
      ).run(file, filePath, now, now, charCount);
    }
  } catch { /* DB not ready yet, continue */ }
}

/** Get the context directory path */
export function getContextDir(): string {
  ensureDirs();
  return CONTEXT_DIR;
}

/** Singleton for convenient imports */
export const contextManager = {
  getMainContext,
  getTaskContext,
  listContextFiles,
  appendContext,
  replaceSection,
  getContextSize,
  needsCompaction,
  archiveVersion,
  readContextFile,
  writeContextFile,
  deleteContextFile,
  getContextDir,
};
