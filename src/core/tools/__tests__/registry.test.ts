import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../registry';
import type { ToolMiddleware } from '../registry';
import type { Tool } from '../types';

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'test-tool',
    description: 'A test tool',
    category: 'test',
    access: ['agent', 'ui'],
    parameters: z.object({ input: z.string() }),
    execute: async (params: any) => ({ success: true, data: params }),
    ...overrides,
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and retrieves a tool', () => {
    const tool = makeTool();
    registry.register(tool);
    expect(registry.get('test-tool')).toBe(tool);
  });

  it('throws on duplicate registration', () => {
    registry.register(makeTool());
    expect(() => registry.register(makeTool())).toThrow('already registered');
  });

  it('returns undefined for unknown tool', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists all tool names', () => {
    registry.register(makeTool({ name: 'a' }));
    registry.register(makeTool({ name: 'b' }));
    expect(registry.names()).toEqual(['a', 'b']);
  });

  it('filters by category', () => {
    registry.register(makeTool({ name: 'a', category: 'search' }));
    registry.register(makeTool({ name: 'b', category: 'content' }));
    registry.register(makeTool({ name: 'c', category: 'search' }));
    const searchTools = registry.getByCategory('search');
    expect(searchTools.map(t => t.name)).toEqual(['a', 'c']);
  });

  it('filters by access level', () => {
    registry.register(makeTool({ name: 'a', access: ['agent', 'mcp'] }));
    registry.register(makeTool({ name: 'b', access: ['ui'] }));
    registry.register(makeTool({ name: 'c', access: ['agent'] }));
    const agentTools = registry.getByAccess('agent');
    expect(agentTools.map(t => t.name)).toEqual(['a', 'c']);
  });

  it('lists unique categories', () => {
    registry.register(makeTool({ name: 'a', category: 'search' }));
    registry.register(makeTool({ name: 'b', category: 'content' }));
    registry.register(makeTool({ name: 'c', category: 'search' }));
    expect(registry.categories().sort()).toEqual(['content', 'search']);
  });

  it('executes a tool with valid input', async () => {
    registry.register(makeTool());
    const result = await registry.execute('test-tool', { input: 'hello' }, {});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ input: 'hello' });
  });

  it('returns error for unknown tool execution', async () => {
    const result = await registry.execute('nonexistent', {}, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('returns error for invalid input', async () => {
    registry.register(makeTool());
    const result = await registry.execute('test-tool', { input: 123 }, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid input');
  });

  it('catches execution errors', async () => {
    registry.register(makeTool({
      execute: async () => { throw new Error('boom'); },
    }));
    const result = await registry.execute('test-tool', { input: 'x' }, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('generates tool definitions', () => {
    registry.register(makeTool({ access: ['agent'] }));
    const defs = registry.toToolDefinitions('agent');
    expect(defs).toHaveLength(1);
    expect(defs[0].type).toBe('function');
    expect(defs[0].function.name).toBe('test-tool');
    expect(defs[0].function.parameters.type).toBe('object');
    expect(defs[0].function.parameters.properties).toHaveProperty('input');
  });

  it('runs middleware during execute', async () => {
    let middlewareCalled = false;
    const mw: ToolMiddleware = async (_tool, _input, _ctx, next) => {
      middlewareCalled = true;
      return next();
    };

    registry.register(makeTool());
    registry.use(mw);

    const result = await registry.execute('test-tool', { input: 'x' }, {});
    expect(result.success).toBe(true);
    expect(middlewareCalled).toBe(true);
  });

  it('middleware can modify result', async () => {
    const mw: ToolMiddleware = async (_tool, _input, _ctx, next) => {
      const result = await next();
      return { ...result, data: { modified: true } };
    };

    registry.register(makeTool());
    registry.use(mw);

    const result = await registry.execute('test-tool', { input: 'x' }, {});
    expect(result.data).toEqual({ modified: true });
  });

  it('validation runs before middleware', async () => {
    let middlewareCalled = false;
    const mw: ToolMiddleware = async (_tool, _input, _ctx, next) => {
      middlewareCalled = true;
      return next();
    };

    registry.register(makeTool());
    registry.use(mw);

    // Invalid input — middleware should NOT run
    const result = await registry.execute('test-tool', { input: 123 }, {});
    expect(result.success).toBe(false);
    expect(middlewareCalled).toBe(false);
  });
});
