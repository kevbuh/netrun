import { describe, it, expect } from 'vitest';
import { navigate, openTab, saveToReadingList, createExperiment, createCalendarEvent } from '../system/index';

describe('system tools', () => {
  describe('navigate', () => {
    it('has correct metadata', () => {
      expect(navigate.name).toBe('navigate');
      expect(navigate.category).toBe('system');
    });

    it('returns success', async () => {
      const result = await navigate.execute({ view: 'settings' }, {});
      expect(result.success).toBe(true);
      expect(result.data!.message).toContain('settings');
    });
  });

  describe('open-tab', () => {
    it('returns success with URL', async () => {
      const result = await openTab.execute({ url: 'https://example.com' }, {});
      expect(result.success).toBe(true);
      expect(result.data!.message).toContain('example.com');
    });

    it('returns success without URL', async () => {
      const result = await openTab.execute({}, {});
      expect(result.success).toBe(true);
      expect(result.data!.message).toContain('new tab');
    });
  });

  describe('save-to-reading-list', () => {
    it('returns bookmarked status', async () => {
      const result = await saveToReadingList.execute(
        { url: 'https://example.com', title: 'Test' },
        {}
      );
      expect(result.success).toBe(true);
      expect(result.data!.message).toContain('bookmarked');
    });
  });

  describe('create-experiment', () => {
    it('requires title', async () => {
      const result = await createExperiment.execute({ title: '' }, {});
      expect(result.success).toBe(false);
    });

    it('requires authentication', async () => {
      const result = await createExperiment.execute({ title: 'Test' }, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('authenticated');
    });

    it('creates experiment with auth', async () => {
      const result = await createExperiment.execute(
        { title: 'My Experiment' },
        { googleId: 'user123' }
      );
      expect(result.success).toBe(true);
      expect(result.data!.title).toBe('My Experiment');
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
