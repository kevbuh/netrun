import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../registry';
import type { ToolMiddleware } from '../registry';
import type { Tool } from '../types';
import { loggingMiddleware } from '../middleware/logging';
import { timeoutMiddleware } from '../middleware/timeout';

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'test-tool',
    description: 'A test tool',
    category: 'test',
    access: ['agent'],
    parameters: z.object({ input: z.string() }),
    execute: async (params: any) => ({ success: true, data: params }),
    ...overrides,
  };
}

describe('Middleware Pipeline', () => {
  it('runs middleware in registration order (first = outermost)', async () => {
    const order: string[] = [];
    const mw1: ToolMiddleware = async (_tool, _input, _ctx, next) => {
      order.push('mw1-before');
      const result = await next();
      order.push('mw1-after');
      return result;
    };
    const mw2: ToolMiddleware = async (_tool, _input, _ctx, next) => {
      order.push('mw2-before');
      const result = await next();
      order.push('mw2-after');
      return result;
    };

    const registry = new ToolRegistry();
    registry.register(makeTool());
    registry.use(mw1);
    registry.use(mw2);

    await registry.execute('test-tool', { input: 'x' }, {});
    expect(order).toEqual(['mw1-before', 'mw2-before', 'mw2-after', 'mw1-after']);
  });

  it('middleware can short-circuit by not calling next', async () => {
    const shortCircuit: ToolMiddleware = async () => {
      return { success: false, error: 'blocked' };
    };

    const registry = new ToolRegistry();
    registry.register(makeTool());
    registry.use(shortCircuit);

    const result = await registry.execute('test-tool', { input: 'x' }, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('blocked');
  });

  it('middleware errors are caught by execute()', async () => {
    const failing: ToolMiddleware = async () => {
      throw new Error('middleware boom');
    };

    const registry = new ToolRegistry();
    registry.register(makeTool());
    registry.use(failing);

    const result = await registry.execute('test-tool', { input: 'x' }, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('middleware boom');
  });

  it('middleware receives correct tool and input', async () => {
    let receivedTool: Tool | undefined;
    let receivedInput: unknown;

    const spy: ToolMiddleware = async (tool, input, _ctx, next) => {
      receivedTool = tool;
      receivedInput = input;
      return next();
    };

    const registry = new ToolRegistry();
    const tool = makeTool();
    registry.register(tool);
    registry.use(spy);

    await registry.execute('test-tool', { input: 'hello' }, {});
    expect(receivedTool).toBe(tool);
    expect(receivedInput).toEqual({ input: 'hello' });
  });
});

describe('Logging Middleware', () => {
  it('logs start and end', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const registry = new ToolRegistry();
    registry.register(makeTool());
    registry.use(loggingMiddleware);

    await registry.execute('test-tool', { input: 'x' }, {});

    const calls = debugSpy.mock.calls.map(c => c[0] as string);
    expect(calls.some(c => c.includes('[tool:start] test-tool'))).toBe(true);
    expect(calls.some(c => c.includes('[tool:end] test-tool ok'))).toBe(true);

    debugSpy.mockRestore();
  });

  it('logs failure on error', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const registry = new ToolRegistry();
    registry.register(makeTool({
      execute: async () => ({ success: false, error: 'oops' }),
    }));
    registry.use(loggingMiddleware);

    await registry.execute('test-tool', { input: 'x' }, {});

    const calls = debugSpy.mock.calls.map(c => c[0] as string);
    expect(calls.some(c => c.includes('[tool:end] test-tool fail'))).toBe(true);

    debugSpy.mockRestore();
  });
});

describe('Timeout Middleware', () => {
  it('skips sequential tools', async () => {
    const registry = new ToolRegistry();
    const slowTool = makeTool({
      name: 'slow-sequential',
      sequential: true,
      execute: async () => {
        await new Promise(r => setTimeout(r, 50));
        return { success: true, data: 'done' };
      },
    });
    registry.register(slowTool);
    registry.use(timeoutMiddleware);

    const result = await registry.execute('slow-sequential', { input: 'x' }, {});
    expect(result.success).toBe(true);
  });

  it('allows fast non-sequential tools', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    registry.use(timeoutMiddleware);

    const result = await registry.execute('test-tool', { input: 'x' }, {});
    expect(result.success).toBe(true);
  });
});
