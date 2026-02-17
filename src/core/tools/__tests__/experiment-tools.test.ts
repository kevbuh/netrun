import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  experimentList, experimentCreate, experimentListFiles,
  experimentGetFile, experimentWriteFile, experimentDelete,
} from '../experiment/index';

const testDir = join(tmpdir(), `netrun-exp-test-${Date.now()}`);

describe('experiment tools', () => {
  beforeEach(() => {
    process.env.HOME = join(testDir, 'home');
    mkdirSync(join(testDir, 'home', 'Desktop', 'netrun', 'test-user'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('lists empty projects', async () => {
    const result = await experimentList.execute({}, { googleId: 'test-user' });
    expect(result.success).toBe(true);
    expect(result.data.projects).toEqual([]);
  });

  it('creates a project', async () => {
    const result = await experimentCreate.execute(
      { title: 'My Experiment' },
      { googleId: 'test-user' }
    );
    expect(result.success).toBe(true);
    expect(result.data.title).toBe('My Experiment');

    const listResult = await experimentList.execute({}, { googleId: 'test-user' });
    expect(listResult.data.projects.length).toBe(1);
  });

  it('creates and reads files', async () => {
    await experimentCreate.execute({ title: 'File Test' }, { googleId: 'test-user' });

    const writeResult = await experimentWriteFile.execute(
      { project_id: 'file-test', path: 'main.py', content: 'print("hello")' },
      { googleId: 'test-user' }
    );
    expect(writeResult.success).toBe(true);

    const readResult = await experimentGetFile.execute(
      { project_id: 'file-test', path: 'main.py' },
      { googleId: 'test-user' }
    );
    expect(readResult.success).toBe(true);
    expect(readResult.data.content).toBe('print("hello")');
  });

  it('lists files recursively', async () => {
    await experimentCreate.execute({ title: 'File List' }, { googleId: 'test-user' });
    await experimentWriteFile.execute(
      { project_id: 'file-list', path: 'a.py', content: '# a' },
      { googleId: 'test-user' }
    );
    await experimentWriteFile.execute(
      { project_id: 'file-list', path: 'sub/b.py', content: '# b' },
      { googleId: 'test-user' }
    );

    const result = await experimentListFiles.execute(
      { project_id: 'file-list' },
      { googleId: 'test-user' }
    );
    expect(result.success).toBe(true);
    const paths = result.data.files.map((f: any) => f.path);
    expect(paths).toContain('a.py');
    expect(paths).toContain('sub/b.py');
  });

  it('deletes a project', async () => {
    await experimentCreate.execute({ title: 'Delete Me' }, { googleId: 'test-user' });
    const result = await experimentDelete.execute(
      { project_id: 'delete-me' },
      { googleId: 'test-user' }
    );
    expect(result.success).toBe(true);

    const list = await experimentList.execute({}, { googleId: 'test-user' });
    expect(list.data.projects.length).toBe(0);
  });

  it('requires auth', async () => {
    const result = await experimentCreate.execute({ title: 'test' }, {});
    expect(result.success).toBe(false);
  });
});
