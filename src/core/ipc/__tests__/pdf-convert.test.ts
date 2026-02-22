import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import { EventEmitter } from 'events';

const { _existsSync, _spawn } = vi.hoisted(() => ({
  _existsSync: vi.fn(),
  _spawn: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: _existsSync };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: _spawn };
});

import { getScriptPath, runPdfConvert } from '../pdf-convert.js';

describe('getScriptPath', () => {
  beforeEach(() => {
    _existsSync.mockReset();
  });

  it('returns SCRIPT_PATH when it exists', () => {
    _existsSync.mockReturnValueOnce(true);
    const result = getScriptPath();
    expect(result).toContain('pdf-convert.py');
  });

  it('falls back to dev path when SCRIPT_PATH does not exist', () => {
    _existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const result = getScriptPath();
    expect(result).toContain('pdf-convert.py');
    expect(result).toContain('src');
  });

  it('falls back to cwd path when neither exists', () => {
    _existsSync.mockReturnValue(false);
    const result = getScriptPath();
    expect(result).toContain('pdf-convert.py');
    expect(result).toContain(path.join('src', 'core', 'python', 'pdf-convert.py'));
  });
});

describe('runPdfConvert', () => {
  function createMockProcess() {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    return proc;
  }

  beforeEach(() => {
    _existsSync.mockReturnValue(true);
    _spawn.mockReset();
  });

  it('resolves with parsed JSON on success', async () => {
    const proc = createMockProcess();
    _spawn.mockReturnValue(proc);

    const promise = runPdfConvert({ command: 'parse', input: '/test.pdf' });

    proc.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true, text: 'hello' })));
    proc.emit('close', 0);

    const result = await promise;
    expect(result).toEqual({ ok: true, text: 'hello' });
  });

  it('rejects on non-zero exit code', async () => {
    const proc = createMockProcess();
    _spawn.mockReturnValue(proc);

    const promise = runPdfConvert({ command: 'parse', input: '/test.pdf' });

    proc.stderr.emit('data', Buffer.from('file not found'));
    proc.emit('close', 1);

    await expect(promise).rejects.toThrow('PDF convert failed: file not found');
  });

  it('rejects when result.ok is false', async () => {
    const proc = createMockProcess();
    _spawn.mockReturnValue(proc);

    const promise = runPdfConvert({ command: 'parse', input: '/test.pdf' });

    proc.stdout.emit('data', Buffer.from(JSON.stringify({ ok: false, error: 'corrupt PDF' })));
    proc.emit('close', 0);

    await expect(promise).rejects.toThrow('corrupt PDF');
  });

  it('rejects on invalid JSON stdout', async () => {
    const proc = createMockProcess();
    _spawn.mockReturnValue(proc);

    const promise = runPdfConvert({ command: 'parse', input: '/test.pdf' });

    proc.stdout.emit('data', Buffer.from('not json'));
    proc.emit('close', 0);

    await expect(promise).rejects.toThrow('Failed to parse output');
  });

  it('rejects on spawn error', async () => {
    const proc = createMockProcess();
    _spawn.mockReturnValue(proc);

    const promise = runPdfConvert({ command: 'parse', input: '/test.pdf' });

    proc.emit('error', new Error('ENOENT'));

    await expect(promise).rejects.toThrow('Failed to spawn python3: ENOENT');
  });

  it('passes command as JSON argument to python3', async () => {
    const proc = createMockProcess();
    _spawn.mockReturnValue(proc);

    const promise = runPdfConvert({ command: 'to-png', input: '/file.pdf', output: '/out' });

    expect(_spawn).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([expect.stringContaining('pdf-convert.py')]),
      expect.any(Object),
    );
    const spawnArgs = _spawn.mock.calls[0][1];
    const jsonArg = JSON.parse(spawnArgs[1]);
    expect(jsonArg).toEqual({ command: 'to-png', input: '/file.pdf', output: '/out' });

    // Clean up: resolve the pending promise
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true })));
    proc.emit('close', 0);
    await promise;
  });
});
