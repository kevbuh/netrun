import { describe, it, expect, vi } from 'vitest';
import {
  browserReadPage,
  browserClick,
  browserType,
  browserScroll,
  browserNavigate,
  browserScreenshot,
  browserPressKey,
  browserGetStorage,
  browserQuerySelector,
  browserWaitFor,
  browserGetUrl,
  browserGetTabs,
  browserSwitchTab,
  browserBack,
  browserForward,
} from '../browser/index';

describe('browser tools', () => {
  it('all have browser category and sequential flag', () => {
    const tools = [
      browserReadPage, browserClick, browserType, browserScroll, browserNavigate, browserScreenshot,
      browserPressKey, browserGetStorage, browserQuerySelector, browserWaitFor, browserGetUrl,
      browserGetTabs, browserSwitchTab, browserBack, browserForward,
    ];
    for (const tool of tools) {
      expect(tool.category).toBe('browser');
      expect(tool.access).toContain('agent');
      expect(tool.sequential).toBe(true);
    }
  });

  it('browser-read-page returns DOM from context', async () => {
    const result = await browserReadPage.execute({}, { browserDom: '<div>test</div>' });
    expect(result.success).toBe(true);
    expect((result.data as any).dom).toBe('<div>test</div>');
  });

  it('browser-read-page returns message when no DOM in context', async () => {
    const result = await browserReadPage.execute({}, {});
    expect(result.success).toBe(true);
    expect((result.data as any).message).toContain('system context');
  });

  it('browser-click calls emitAction', async () => {
    const emitAction = vi.fn();
    const result = await browserClick.execute({ element_id: 5 }, { emitAction });
    expect(result.success).toBe(true);
    expect(result.data!.message).toContain('5');
    expect(emitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_click', element_id: 5 })
    );
  });

  it('browser-type calls emitAction with text', async () => {
    const emitAction = vi.fn();
    await browserType.execute({ element_id: 3, text: 'hello' }, { emitAction });
    expect(emitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_type', element_id: 3, text: 'hello' })
    );
  });

  it('browser-scroll calls emitAction', async () => {
    const emitAction = vi.fn();
    const resultDown = await browserScroll.execute({ direction: 'down' }, { emitAction });
    expect(resultDown.success).toBe(true);
    expect(resultDown.data!.message).toContain('down');
    expect(emitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_scroll', direction: 'down' })
    );
  });

  it('browser-navigate calls emitAction', async () => {
    const emitAction = vi.fn();
    const result = await browserNavigate.execute({ url: 'https://example.com' }, { emitAction });
    expect(result.success).toBe(true);
    expect(result.data!.message).toContain('example.com');
    expect(emitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_navigate', url: 'https://example.com' })
    );
  });

  it('browser-screenshot calls emitAction', async () => {
    const emitAction = vi.fn();
    const result = await browserScreenshot.execute({}, { emitAction });
    expect(result.success).toBe(true);
    expect(result.data!.status).toBe('pending');
    expect(emitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_screenshot' })
    );
  });

  it('browser-press-key calls emitAction with key and modifiers', async () => {
    const emitAction = vi.fn();
    const result = await browserPressKey.execute({ key: 'a', modifiers: ['ctrl'] }, { emitAction });
    expect(result.success).toBe(true);
    expect(result.data!.message).toContain('ctrl');
    expect(emitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_press_key', key: 'a', modifiers: ['ctrl'] })
    );
  });

  it('browser-query-selector uses waitForResult when available', async () => {
    const emitAction = vi.fn();
    const waitForResult = vi.fn().mockResolvedValue({ elements: [{ id: 1, tag: 'div' }] });
    const result = await browserQuerySelector.execute(
      { selector: '.btn' },
      { emitAction, waitForResult },
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ elements: [{ id: 1, tag: 'div' }] });
    expect(emitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_query_selector', selector: '.btn' })
    );
    expect(waitForResult).toHaveBeenCalled();
  });

  it('browser-query-selector returns pending without waitForResult', async () => {
    const emitAction = vi.fn();
    const result = await browserQuerySelector.execute(
      { selector: '.btn' },
      { emitAction },
    );
    expect(result.success).toBe(true);
    expect((result.data as any).status).toBe('pending');
  });

  it('browser-get-storage calls emitAction with storage type', async () => {
    const emitAction = vi.fn();
    const waitForResult = vi.fn().mockResolvedValue({ items: [] });
    const result = await browserGetStorage.execute(
      { type: 'localStorage' },
      { emitAction, waitForResult },
    );
    expect(result.success).toBe(true);
    expect(emitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_get_storage', storage_type: 'localStorage' })
    );
  });

  it('browser-wait-for uses dynamic timeout', async () => {
    const emitAction = vi.fn();
    const waitForResult = vi.fn().mockResolvedValue({ found: true });
    await browserWaitFor.execute(
      { selector: '.modal', timeout_ms: 3000 },
      { emitAction, waitForResult },
    );
    // Should call waitForResult with (timeout_ms + 5000) = 8000
    expect(waitForResult).toHaveBeenCalledWith(expect.any(String), 8000);
  });

  it('browser-get-url uses waitForResult', async () => {
    const emitAction = vi.fn();
    const waitForResult = vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example' });
    const result = await browserGetUrl.execute({}, { emitAction, waitForResult });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ url: 'https://example.com', title: 'Example' });
  });

  it('browser-press-key has correct tool name', () => {
    expect(browserPressKey.name).toBe('browser-press-key');
  });

  it('browser-get-storage has correct tool name', () => {
    expect(browserGetStorage.name).toBe('browser-get-storage');
  });
});
