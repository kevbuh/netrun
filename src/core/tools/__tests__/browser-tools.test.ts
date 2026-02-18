import { describe, it, expect } from 'vitest';
import {
  browserReadPage,
  browserClick,
  browserType,
  browserScroll,
  browserNavigate,
  browserScreenshot,
  browserPressKey,
  browserGetStorage,
} from '../browser/index';

describe('browser tools', () => {
  it('all have browser category', () => {
    const tools = [browserReadPage, browserClick, browserType, browserScroll, browserNavigate, browserScreenshot, browserPressKey, browserGetStorage];
    for (const tool of tools) {
      expect(tool.category).toBe('browser');
      expect(tool.access).toContain('agent');
    }
  });

  it('browser-read-page returns status', async () => {
    const result = await browserReadPage.execute({}, {});
    expect(result.success).toBe(true);
  });

  it('browser-click returns status with element ID', async () => {
    const result = await browserClick.execute({ element_id: 5 }, {});
    expect(result.success).toBe(true);
    expect(result.data!.message).toContain('5');
  });

  it('browser-type returns status', async () => {
    const result = await browserType.execute({ element_id: 3, text: 'hello' }, {});
    expect(result.success).toBe(true);
  });

  it('browser-scroll returns status', async () => {
    const resultDown = await browserScroll.execute({ direction: 'down' }, {});
    expect(resultDown.success).toBe(true);
    expect(resultDown.data!.message).toContain('down');

    const resultUp = await browserScroll.execute({ direction: 'up' }, {});
    expect(resultUp.data!.message).toContain('up');
  });

  it('browser-navigate returns status', async () => {
    const result = await browserNavigate.execute({ url: 'https://example.com' }, {});
    expect(result.success).toBe(true);
    expect(result.data!.message).toContain('example.com');
  });

  it('browser-screenshot returns pending status', async () => {
    const result = await browserScreenshot.execute({}, {});
    expect(result.success).toBe(true);
    expect(result.data!.status).toBe('pending');
  });

  it('browser-press-key returns status with key name', async () => {
    const result = await browserPressKey.execute({ key: 'Enter' }, {});
    expect(result.success).toBe(true);
    expect(result.data!.message).toContain('Enter');
  });

  it('browser-press-key includes modifiers in message', async () => {
    const result = await browserPressKey.execute({ key: 'a', modifiers: ['ctrl'] }, {});
    expect(result.success).toBe(true);
    expect(result.data!.message).toContain('ctrl');
  });

  it('browser-get-storage returns pending status', async () => {
    const result = await browserGetStorage.execute({ type: 'localStorage' }, {});
    expect(result.success).toBe(true);
    expect(result.data!.message).toContain('localStorage');
  });

  it('browser-press-key has correct tool name', () => {
    expect(browserPressKey.name).toBe('browser-press-key');
  });

  it('browser-get-storage has correct tool name', () => {
    expect(browserGetStorage.name).toBe('browser-get-storage');
  });
});
