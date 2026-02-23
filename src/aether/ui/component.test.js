import { describe, it, expect } from 'vitest';
import { State, Effect, Computed, runWithScope } from './state.js';

// ═══════════════════════════════════════════════════════════════
// runWithScope (disposal scope primitive)
// ═══════════════════════════════════════════════════════════════

describe('runWithScope', () => {
  it('captures State created inside scope', () => {
    const { result, disposables } = runWithScope(() => {
      const s = State(42);
      return s;
    });
    expect(result.value).toBe(42);
    expect(disposables).toHaveLength(1);
    expect(disposables[0]).toBe(result);
  });

  it('captures Effect created inside scope', () => {
    const log = [];
    const { disposables } = runWithScope(() => {
      Effect(() => { log.push('ran'); });
      return 'done';
    });
    expect(log).toEqual(['ran']);
    expect(disposables).toHaveLength(1);
    expect(disposables[0]._isEffect).toBe(true);
  });

  it('captures Computed created inside scope', () => {
    const { disposables } = runWithScope(() => {
      const s = State(1);
      const c = Computed(() => s.value * 2);
      return c;
    });
    // State + Computed = 2 disposables
    expect(disposables).toHaveLength(2);
    expect(disposables[1]._isComputed).toBe(true);
  });

  it('captures multiple State + Effect + Computed', () => {
    const { disposables } = runWithScope(() => {
      const a = State(1);
      const b = State(2);
      const c = Computed(() => a.value + b.value);
      Effect(() => { c.value; });
      return 'done';
    });
    // 2 State + 1 Computed + 1 Effect = 4
    expect(disposables).toHaveLength(4);
  });

  it('does not capture State created outside scope', () => {
    const outer = State(0);
    const { disposables } = runWithScope(() => {
      const inner = State(1);
      return inner;
    });
    expect(disposables).toHaveLength(1);
    expect(disposables[0]).not.toBe(outer);
  });

  it('restores previous scope after nesting', () => {
    const { disposables: outer } = runWithScope(() => {
      const a = State(1);
      const { disposables: inner } = runWithScope(() => {
        const b = State(2);
        return b;
      });
      expect(inner).toHaveLength(1);
      const c = State(3);
      return 'done';
    });
    // outer scope should have a and c (2 items), not b
    expect(outer).toHaveLength(2);
  });

  it('restores scope even if fn throws', () => {
    let caught = false;
    try {
      runWithScope(() => { throw new Error('boom'); });
    } catch { caught = true; }
    expect(caught).toBe(true);
    // After the throw, scope should be restored to null —
    // State created outside should not be captured
    const s = State(0);
    // If scope leaked, this would add to a stale scope and eventually cause issues
    // We verify by running another scope cleanly
    const { disposables } = runWithScope(() => {
      return State(1);
    });
    expect(disposables).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Disposal scope: Effect cleanup on dispose
// ═══════════════════════════════════════════════════════════════

describe('disposal scope: effect lifecycle', () => {
  it('scoped Effect fires on signal change', () => {
    const trigger = State(0);
    const log = [];

    const { disposables } = runWithScope(() => {
      Effect(() => { log.push('val:' + trigger.value); });
      return 'done';
    });

    expect(log).toEqual(['val:0']);

    trigger.value = 1;
    expect(log).toEqual(['val:0', 'val:1']);

    // Dispose all scoped disposables
    disposables.forEach(d => { if (d.dispose) d.dispose(); });

    // Effect should no longer fire
    trigger.value = 2;
    expect(log).toEqual(['val:0', 'val:1']);
  });

  it('scoped Computed stops updating after dispose', () => {
    const s = State(5);

    const { result, disposables } = runWithScope(() => {
      return Computed(() => s.value * 10);
    });

    expect(result.value).toBe(50);

    s.value = 6;
    expect(result.value).toBe(60);

    // Dispose
    disposables.forEach(d => { if (d.dispose) d.dispose(); });

    // Computed should be disconnected from the source signal
    s.value = 7;
    // After dispose, the computed's subscribers are cleared,
    // so it won't be notified. Its cached value remains stale.
    expect(result.peek()).toBe(60);
  });

  it('scoped State can be disposed to clear subscribers', () => {
    const log = [];
    const { disposables } = runWithScope(() => {
      const s = State(0);
      Effect(() => { log.push(s.value); });
      return s;
    });

    expect(log).toEqual([0]);
    disposables[0].value = 1; // the State
    expect(log).toEqual([0, 1]);

    // Dispose everything
    disposables.forEach(d => { if (d.dispose) d.dispose(); });

    // State subscribers cleared, effect disposed — no more updates
    // (setting value on a disposed state won't trigger anything)
  });
});
