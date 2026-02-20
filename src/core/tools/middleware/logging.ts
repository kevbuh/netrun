import type { ToolMiddleware } from '../registry.js';

/** Logs tool name, input keys, duration, and success/failure */
export const loggingMiddleware: ToolMiddleware = async (tool, input, _context, next) => {
  const inputKeys = input && typeof input === 'object' ? Object.keys(input) : [];
  console.debug(`[tool:start] ${tool.name} [${inputKeys.join(', ')}]`);
  const start = performance.now();
  try {
    const result = await next();
    const ms = Math.round(performance.now() - start);
    console.debug(`[tool:end] ${tool.name} ${result.success ? 'ok' : 'fail'} (${ms}ms)`);
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    console.debug(`[tool:end] ${tool.name} error (${ms}ms)`);
    throw err;
  }
};
