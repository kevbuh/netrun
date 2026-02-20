import { spawn, type ChildProcess } from 'child_process';

/**
 * Persistent Python worker for PDF text extraction.
 * Uses a long-running process with JSON-line protocol instead of
 * spawning a new python3 process per PDF.
 */

const WORKER_SCRIPT = `
import sys, json, fitz

# JSON-line protocol: read one JSON object per line from stdin,
# write one JSON object per line to stdout.
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        path = req.get("path", "")
        doc = fitz.open(path)
        pages = [doc[i].get_text() for i in range(len(doc))]
        doc.close()
        resp = {"ok": True, "id": req.get("id"), "pages": pages}
    except Exception as e:
        resp = {"ok": False, "id": req.get("id", ""), "error": str(e)}
    sys.stdout.write(json.dumps(resp) + "\\n")
    sys.stdout.flush()
`;

let worker: ChildProcess | null = null;
let pendingRequests = new Map<string, {
  resolve: (pages: string[]) => void;
  reject: (err: Error) => void;
}>();
let buffer = '';
let requestId = 0;

function ensureWorker(): ChildProcess {
  if (worker && !worker.killed) return worker;

  worker = spawn('python3', ['-u', '-c', WORKER_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  worker.stdout!.on('data', (data: Buffer) => {
    buffer += data.toString();
    // Process complete JSON lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const resp = JSON.parse(line);
        const pending = pendingRequests.get(resp.id);
        if (pending) {
          pendingRequests.delete(resp.id);
          if (resp.ok) {
            pending.resolve(resp.pages);
          } else {
            pending.reject(new Error(resp.error || 'PDF extraction failed'));
          }
        }
      } catch {
        // Ignore malformed lines
      }
    }
  });

  worker.on('exit', () => {
    // Reject all pending requests
    for (const [id, pending] of pendingRequests) {
      pending.reject(new Error('PDF worker exited unexpectedly'));
      pendingRequests.delete(id);
    }
    worker = null;
    buffer = '';
  });

  worker.on('error', () => {
    worker = null;
  });

  return worker;
}

/**
 * Extract text from a PDF file using the persistent worker.
 * Falls back to one-shot spawn if the worker fails to start.
 */
export function extractPdfViaWorker(tmpPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const id = `pdf_${++requestId}`;
    const proc = ensureWorker();

    if (!proc.stdin?.writable) {
      // Worker not available, fall back
      reject(new Error('PDF worker stdin not writable'));
      return;
    }

    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('PDF extraction timed out'));
    }, 30000);

    pendingRequests.set(id, {
      resolve: (pages) => {
        clearTimeout(timeout);
        resolve(pages.join('\n\n---\n\n'));
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    proc.stdin!.write(JSON.stringify({ id, path: tmpPath }) + '\n');
  });
}

/** Shut down the persistent worker */
export function shutdownPdfWorker(): void {
  if (worker && !worker.killed) {
    worker.kill();
    worker = null;
  }
}
