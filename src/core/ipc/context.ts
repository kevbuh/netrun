import { ipcMain } from 'electron';
import * as fs from 'fs';
import { contextManager } from '../context/manager.js';
import { runCompaction } from '../context/compaction.js';
import { contextIntake } from '../context/intake.js';
import type { IntakeEntry } from '../context/intake.js';
import { insightPipeline } from '../ambient/index.js';
import { DEFAULT_ANNOTATION_PROMPT } from '../ambient/annotation-prompt.js';
import { ANNOTATION_PROMPT_FILE, readAnnotationPrompt } from './shared.js';

export function registerContextIPC(): void {
  ipcMain.handle('db:context-read', (_event, file: string) => {
    return { content: contextManager.readContextFile(file || 'main.md') };
  });

  ipcMain.handle('db:context-list', () => {
    return { files: contextManager.listContextFiles(), dir: contextManager.getContextDir() };
  });

  ipcMain.handle('db:context-update', (_event, body: { file?: string; section?: string; content: string; action?: 'append' | 'replace' }) => {
    const file = body.file || 'main.md';
    if (body.section) {
      if (body.action === 'replace') {
        contextManager.replaceSection(file, body.section, body.content);
      } else {
        contextManager.appendContext(file, body.section, body.content);
      }
    } else {
      contextManager.writeContextFile(file, body.content);
    }
    return { ok: true, charCount: contextManager.getContextSize(file) };
  });

  ipcMain.handle('db:context-compact', async (_event, file?: string) => {
    await runCompaction(file || 'main.md');
    return { ok: true, charCount: contextManager.getContextSize(file || 'main.md') };
  });

  ipcMain.handle('db:context-delete', (_event, file: string) => {
    contextManager.deleteContextFile(file);
    return { ok: true };
  });

  ipcMain.handle('db:context-create', (_event, file: string) => {
    contextManager.writeContextFile(file, `# ${file.replace('.md', '')}\n\n`);
    return { ok: true };
  });

  ipcMain.handle('db:context-ingest', (_event, entry: IntakeEntry) => {
    contextIntake.ingest(entry);
    return { ok: true };
  });

  ipcMain.handle('db:context-topic-index', () => {
    return { topics: contextManager.listTopicIndex() };
  });

  ipcMain.handle('db:context-create-topic', (_event, name: string, description: string) => {
    const fileId = contextManager.createTopicFile(name, description || '');
    return { ok: true, fileId };
  });

  ipcMain.handle('db:context-update-description', (_event, fileId: string, description: string) => {
    contextManager.updateFileDescription(fileId, description);
    return { ok: true };
  });

  // ── Insight (unified ambient + annotations) ──
  ipcMain.handle('insight:page-loaded', (event, data) => {
    insightPipeline.onPageLoaded(data, event.sender);
  });

  ipcMain.handle('insight:analyze', (event, data) => {
    return insightPipeline.processPage(data, event.sender, { manual: true });
  });

  ipcMain.handle('insight:stop', (_event, tabId: string) => {
    insightPipeline.stopTab(tabId);
  });

  ipcMain.handle('insight:set-enabled', (_event, enabled: boolean) => {
    insightPipeline.setEnabled(enabled);
  });

  // ── Annotation prompt get/set ──
  ipcMain.handle('db:annotation-prompt-get', () => {
    const custom = readAnnotationPrompt();
    const defaultPrompt = DEFAULT_ANNOTATION_PROMPT;
    let mtime: number | null = null;
    try { if (fs.existsSync(ANNOTATION_PROMPT_FILE)) mtime = fs.statSync(ANNOTATION_PROMPT_FILE).mtimeMs / 1000; } catch {}
    return { prompt: custom ?? defaultPrompt, default: defaultPrompt, isCustom: custom !== null, updatedAt: mtime };
  });

  ipcMain.handle('db:annotation-prompt-set', (_event, prompt: string | null) => {
    if (!prompt?.trim()) {
      try { if (fs.existsSync(ANNOTATION_PROMPT_FILE)) fs.unlinkSync(ANNOTATION_PROMPT_FILE); } catch {}
    } else {
      fs.writeFileSync(ANNOTATION_PROMPT_FILE, prompt.trim());
    }
    return { ok: true };
  });
}
