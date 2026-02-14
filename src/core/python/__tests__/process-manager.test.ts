import { describe, it, expect } from 'vitest';
import { PythonProcessManager } from '../process-manager';

describe('PythonProcessManager', () => {
  const manager = new PythonProcessManager();

  it('runs inline Python code and gets JSON result', async () => {
    const result = await manager.runCode(`
import json
print(json.dumps({"result": 42}))
`) as any;
    expect(result.result).toBe(42);
  });

  it('runs Python code with args', async () => {
    const result = await manager.runCode(`
import sys, json
print(json.dumps({"arg": sys.argv[1]}))
`, ['hello']) as any;
    expect(result.arg).toBe('hello');
  });

  it('handles Python errors', async () => {
    await expect(
      manager.runCode('raise ValueError("test error")')
    ).rejects.toThrow('test error');
  });

  it('tracks daemon processes', () => {
    expect(manager.isRunning('nonexistent')).toBe(false);
  });
});
