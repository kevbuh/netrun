/**
 * LLM Activity Tracker — broadcasts all LLM calls to the renderer
 * so the UI can show what the model is doing at any time.
 */
import { BrowserWindow } from 'electron';

let activeCount = 0;
let nextId = 1;

export interface LLMActivity {
  id: number;
  model: string;
  /** Short label for the pill, e.g. "Compacting context", "Analyzing page" */
  label: string;
  status: 'start' | 'done' | 'error';
}

/** Infer a human-readable label from the system/user messages */
function inferLabel(messages: Array<{ role: string; content?: string | null }>): string {
  const sys = messages.find(m => m.role === 'system')?.content ?? '';
  const user = messages.find(m => m.role === 'user')?.content ?? '';

  // Context compaction
  if (sys.includes('Summarize this context document') || sys.includes('Compact this identity')) {
    return 'Compacting context';
  }
  // Insight / annotation pipeline
  if (sys.includes('ambient intelligence') || sys.includes('emit_insight') || sys.includes('add_annotation')) {
    return 'Analyzing page';
  }
  // Context selector
  if (sys.includes('select which context files')) {
    return 'Selecting context';
  }
  // Panel suggest
  if (sys.includes('suggest ONE short question')) {
    return 'Suggesting question';
  }
  // Search suggest
  if (sys.includes('search autocomplete')) {
    return 'Search autocomplete';
  }
  // Doc-chat / general chat
  if (sys.includes('doc-chat') || sys.includes('document assistant') || sys.includes('vault-chat')) {
    return 'Chatting';
  }
  // Agent
  if (sys.includes('agent') || sys.includes('research')) {
    return 'Agent thinking';
  }
  // OCR
  if (sys.includes('OCR') || sys.includes('extract text from') || user.includes('Extract all visible text')) {
    return 'OCR extract';
  }
  return 'Thinking';
}

function broadcast(activity: LLMActivity): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('llm:activity', activity);
    }
  }
}

/**
 * Call before an LLM request. Returns a finish function to call when done.
 */
export function trackLLMCall(
  model: string,
  messages: Array<{ role: string; content?: string | null }>,
): { done: () => void; error: () => void } {
  const id = nextId++;
  const label = inferLabel(messages);
  activeCount++;

  broadcast({ id, model, label, status: 'start' });
  console.log(`[llm] ${label} (${model})…`);

  let finished = false;
  return {
    done() {
      if (finished) return;
      finished = true;
      activeCount--;
      broadcast({ id, model, label, status: 'done' });
    },
    error() {
      if (finished) return;
      finished = true;
      activeCount--;
      broadcast({ id, model, label, status: 'error' });
    },
  };
}

export function getActiveCount(): number {
  return activeCount;
}
