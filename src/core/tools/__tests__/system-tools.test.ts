import { describe, it, expect, vi } from 'vitest';
import { navigate, openTab, saveToReadingList, createCalendarEvent } from '../system/index';

describe('system tools', () => {
  describe('navigate', () => {
    it('has correct metadata', () => {
      expect(navigate.name).toBe('navigate');
      expect(navigate.category).toBe('system');
      expect(navigate.sequential).toBe(true);
    });

    it('returns success and emits action', async () => {
      const emitAction = vi.fn();
      const result = await navigate.execute({ view: 'settings' }, { emitAction });
      expect(result.success).toBe(true);
      expect(result.data!.message).toContain('settings');
      expect(emitAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'navigate', view: 'settings' })
      );
    });
  });

  describe('open-tab', () => {
    it('returns success with URL and emits action', async () => {
      const emitAction = vi.fn();
      const result = await openTab.execute({ url: 'https://example.com' }, { emitAction });
      expect(result.success).toBe(true);
      expect(result.data!.message).toContain('example.com');
      expect(emitAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'open_tab', url: 'https://example.com' })
      );
    });

    it('returns success without URL', async () => {
      const emitAction = vi.fn();
      const result = await openTab.execute({}, { emitAction });
      expect(result.success).toBe(true);
      expect(result.data!.message).toContain('new tab');
      expect(emitAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'open_tab', url: '' })
      );
    });
  });

  describe('save-to-reading-list', () => {
    it('returns bookmarked status and emits action', async () => {
      const emitAction = vi.fn();
      const result = await saveToReadingList.execute(
        { url: 'https://example.com', title: 'Test' },
        { emitAction }
      );
      expect(result.success).toBe(true);
      expect(result.data!.message).toContain('bookmarked');
      expect(emitAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'bookmark', url: 'https://example.com', title: 'Test' })
      );
    });
  });

  describe('create-calendar-event', () => {
    it('requires title and date', async () => {
      const result = await createCalendarEvent.execute(
        { title: '', date: '' },
        { googleId: 'user123' }
      );
      expect(result.success).toBe(false);
    });

    it('requires auth', async () => {
      const result = await createCalendarEvent.execute(
        { title: 'Meeting', date: '2025-01-01' },
        {}
      );
      expect(result.success).toBe(false);
    });

    it('creates event with auth', async () => {
      const result = await createCalendarEvent.execute(
        { title: 'Meeting', date: '2025-01-01' },
        { googleId: 'user123' }
      );
      expect(result.success).toBe(true);
      expect(result.data!.message).toContain('Meeting');
    });
  });
});
