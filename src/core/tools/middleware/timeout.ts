import type { ToolMiddleware } from '../registry.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Wraps non-sequential tools with a 30s timeout. Sequential tools are skipped. */
export const timeoutMiddleware: ToolMiddleware = async (tool, _input, _context, next) => {
  // Sequential tools (browser/system actions) manage their own timeouts via waitForResult
  if (tool.sequential) {
    return next();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const result = await Promise.race([
      next(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`Tool "${tool.name}" timed out after ${DEFAULT_TIMEOUT_MS}ms`))
        );
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
};
