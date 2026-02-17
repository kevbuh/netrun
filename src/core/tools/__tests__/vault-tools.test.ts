import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { vaultListNotes, vaultGetNote, vaultCreateNote, vaultUpdateNote, vaultDeleteNote, vaultSearch } from '../vault/index';

// Use a temp dir for vault tests
const testVaultDir = join(tmpdir(), `netrun-vault-test-${Date.now()}`);

describe('vault tools', () => {
  beforeEach(() => {
    // Set HOME to use our test vault path
    process.env.HOME = join(testVaultDir, 'home');
    mkdirSync(join(testVaultDir, 'home', 'Desktop', 'netrun', 'test-user'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testVaultDir)) {
      rmSync(testVaultDir, { recursive: true, force: true });
    }
  });

  it('lists empty vault', async () => {
    const result = await vaultListNotes.execute({}, { googleId: 'test-user' });
    expect(result.success).toBe(true);
    expect(result.data.notes).toEqual([]);
  });

  it('creates and retrieves a note', async () => {
    const createResult = await vaultCreateNote.execute(
      { title: 'Test Note', content: 'Hello world' },
      { googleId: 'test-user' }
    );
    expect(createResult.success).toBe(true);
    expect(createResult.data.title).toBe('Test Note');

    const noteId = createResult.data.id;
    const getResult = await vaultGetNote.execute({ id: noteId }, { googleId: 'test-user' });
    expect(getResult.success).toBe(true);
    expect(getResult.data.content).toBe('Hello world');
  });

  it('updates a note', async () => {
    const createResult = await vaultCreateNote.execute(
      { title: 'Original', content: 'v1' },
      { googleId: 'test-user' }
    );
    const noteId = createResult.data!.id;

    const updateResult = await vaultUpdateNote.execute(
      { id: noteId, content: 'v2' },
      { googleId: 'test-user' }
    );
    expect(updateResult.success).toBe(true);

    const getResult = await vaultGetNote.execute({ id: noteId }, { googleId: 'test-user' });
    expect(getResult.data.content).toBe('v2');
  });

  it('deletes a note', async () => {
    const createResult = await vaultCreateNote.execute(
      { title: 'Temp Note', content: 'delete me' },
      { googleId: 'test-user' }
    );
    const noteId = createResult.data!.id;

    const deleteResult = await vaultDeleteNote.execute({ id: noteId }, { googleId: 'test-user' });
    expect(deleteResult.success).toBe(true);

    const getResult = await vaultGetNote.execute({ id: noteId }, { googleId: 'test-user' });
    expect(getResult.success).toBe(false);
  });

  it('searches notes by content', async () => {
    await vaultCreateNote.execute(
      { title: 'ML Paper', content: 'transformer attention mechanism' },
      { googleId: 'test-user' }
    );
    await vaultCreateNote.execute(
      { title: 'Recipe', content: 'chocolate cake ingredients' },
      { googleId: 'test-user' }
    );

    const result = await vaultSearch.execute({ query: 'transformer' }, { googleId: 'test-user' });
    expect(result.success).toBe(true);
    expect(result.data.results.length).toBe(1);
    expect(result.data.results[0].title).toBe('ML Paper');
  });

  it('requires auth for create', async () => {
    const result = await vaultCreateNote.execute({ title: 'test' }, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('authenticated');
  });
});
