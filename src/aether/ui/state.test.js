import { describe, it, expect, vi } from 'vitest';

// ── Import from state.js exports ──
import {
  State, Computed, Effect, Binding, Store,
  batch, untrack, Context, isSignal, isBinding, resolve
} from './state.js';

// ═══════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════

describe('State', () => {
  it('reads initial value', () => {
    const s = State(42);
    expect(s.value).toBe(42);
  });

  it('writes and reads new value', () => {
    const s = State('hello');
    s.value = 'world';
    expect(s.value).toBe('world');
  });

  it('peek() returns value without tracking', () => {
    const s = State(10);
    const calls = [];
    const c = Computed(() => {
      calls.push('computed');
      return untrack(() => s.value) * 2;
    });
    // Initial computation
    expect(c.value).toBe(20);
    calls.length = 0;

    // peek should not create subscription
    const s2 = State(0);
    Effect(() => {
      s2.value; // subscribe to s2
      s.peek(); // should NOT subscribe to s
    });
    calls.length = 0;
    s.value = 99;
    // The effect should NOT have re-run because it only subscribed to s2
    // This is a bit indirect — let's test peek more directly
    expect(s.peek()).toBe(99);
  });

  it('peek() returns value without triggering effects', () => {
    const s = State(5);
    let effectCount = 0;
    Effect(() => {
      s.peek(); // should not subscribe
      effectCount++;
    });
    expect(effectCount).toBe(1); // initial run
    s.value = 10;
    expect(effectCount).toBe(1); // should NOT re-run
  });

  it('no-op when setting same value (===)', () => {
    const s = State(7);
    let effectCount = 0;
    Effect(() => {
      s.value;
      effectCount++;
    });
    expect(effectCount).toBe(1);
    s.value = 7;
    expect(effectCount).toBe(1); // no change
  });

  it('custom equals function', () => {
    const s = State({ x: 1 }, { equals: (a, b) => a.x === b.x });
    let effectCount = 0;
    Effect(() => {
      s.value;
      effectCount++;
    });
    expect(effectCount).toBe(1);
    s.value = { x: 1 }; // same by custom equals
    expect(effectCount).toBe(1);
    s.value = { x: 2 }; // different
    expect(effectCount).toBe(2);
  });

  it('binding() returns a Binding', () => {
    const s = State(42);
    const b = s.binding();
    expect(isBinding(b)).toBe(true);
    expect(b.value).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════
// Computed
// ═══════════════════════════════════════════════════════════════

describe('Computed', () => {
  it('derives value from State', () => {
    const a = State(3);
    const b = State(4);
    const sum = Computed(() => a.value + b.value);
    expect(sum.value).toBe(7);
  });

  it('recomputes on dependency change', () => {
    const s = State(10);
    const doubled = Computed(() => s.value * 2);
    expect(doubled.value).toBe(20);
    s.value = 5;
    expect(doubled.value).toBe(10);
  });

  it('is lazy — does not recompute until read', () => {
    const s = State(1);
    let computeCount = 0;
    const c = Computed(() => {
      computeCount++;
      return s.value * 2;
    });
    expect(computeCount).toBe(1); // initial
    s.value = 2;
    expect(computeCount).toBe(1); // still 1 — lazy
    expect(c.value).toBe(4);
    expect(computeCount).toBe(2); // now recomputed
  });

  it('dispose() stops tracking', () => {
    const s = State(1);
    let computeCount = 0;
    const c = Computed(() => {
      computeCount++;
      return s.value;
    });
    expect(computeCount).toBe(1);
    c.dispose();
    s.value = 2;
    // After dispose, reading value should still work but won't re-subscribe
    expect(c.peek()).toBe(1); // stale value from before dispose
  });

  it('chains through multiple computed values', () => {
    const a = State(2);
    const b = Computed(() => a.value * 3);
    const c = Computed(() => b.value + 1);
    expect(c.value).toBe(7);
    a.value = 10;
    expect(c.value).toBe(31);
  });
});

// ═══════════════════════════════════════════════════════════════
// Effect
// ═══════════════════════════════════════════════════════════════

describe('Effect', () => {
  it('runs immediately', () => {
    let ran = false;
    Effect(() => { ran = true; });
    expect(ran).toBe(true);
  });

  it('re-runs on dependency change', () => {
    const s = State('a');
    const values = [];
    Effect(() => { values.push(s.value); });
    expect(values).toEqual(['a']);
    s.value = 'b';
    expect(values).toEqual(['a', 'b']);
    s.value = 'c';
    expect(values).toEqual(['a', 'b', 'c']);
  });

  it('dispose() stops tracking', () => {
    const s = State(0);
    let count = 0;
    const e = Effect(() => {
      s.value;
      count++;
    });
    expect(count).toBe(1);
    e.dispose();
    s.value = 1;
    expect(count).toBe(1); // no re-run
  });

  it('tracks dynamic dependencies', () => {
    const toggle = State(true);
    const a = State('A');
    const b = State('B');
    const values = [];
    Effect(() => {
      values.push(toggle.value ? a.value : b.value);
    });
    expect(values).toEqual(['A']);
    a.value = 'A2';
    expect(values).toEqual(['A', 'A2']);
    toggle.value = false;
    expect(values).toEqual(['A', 'A2', 'B']);
    // Now changing 'a' should NOT re-run effect (no longer tracked)
    a.value = 'A3';
    expect(values).toEqual(['A', 'A2', 'B']);
    b.value = 'B2';
    expect(values).toEqual(['A', 'A2', 'B', 'B2']);
  });
});

// ═══════════════════════════════════════════════════════════════
// Binding
// ═══════════════════════════════════════════════════════════════

describe('Binding', () => {
  it('reads from source', () => {
    const s = State(10);
    const b = Binding(s);
    expect(b.value).toBe(10);
  });

  it('writes to source', () => {
    const s = State(10);
    const b = Binding(s);
    b.value = 20;
    expect(s.value).toBe(20);
  });

  it('applies transform on read', () => {
    const s = State(5);
    const b = Binding(s, v => v * 10);
    expect(b.value).toBe(50);
  });

  it('applies inverse on write', () => {
    const s = State(50);
    const b = Binding(s, v => v / 10, v => v * 10);
    expect(b.value).toBe(5);
    b.value = 3;
    expect(s.value).toBe(30);
  });

  it('get() and set() work as aliases', () => {
    const s = State(1);
    const b = Binding(s);
    expect(b.get()).toBe(1);
    b.set(2);
    expect(s.value).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// batch
// ═══════════════════════════════════════════════════════════════

describe('batch', () => {
  it('defers notifications until after batch', () => {
    const a = State(1);
    const b = State(2);
    const values = [];
    Effect(() => { values.push(a.value + b.value); });
    expect(values).toEqual([3]);

    batch(() => {
      a.value = 10;
      b.value = 20;
      // Effect should NOT have re-run yet
      expect(values).toEqual([3]);
    });
    // After batch, effect runs once with both updates
    expect(values).toEqual([3, 30]);
  });

  it('nested batches flush only at outermost', () => {
    const s = State(0);
    const values = [];
    Effect(() => { values.push(s.value); });
    expect(values).toEqual([0]);

    batch(() => {
      s.value = 1;
      batch(() => {
        s.value = 2;
      });
      // Inner batch should NOT flush
      expect(values).toEqual([0]);
    });
    // Outer batch flushes
    expect(values[values.length - 1]).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// untrack
// ═══════════════════════════════════════════════════════════════

describe('untrack', () => {
  it('reads signal without subscribing', () => {
    const s = State(10);
    let count = 0;
    Effect(() => {
      untrack(() => s.value);
      count++;
    });
    expect(count).toBe(1);
    s.value = 20;
    expect(count).toBe(1); // effect did not re-run
  });

  it('returns the value from the callback', () => {
    const s = State(42);
    const val = untrack(() => s.value);
    expect(val).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════════

describe('Store', () => {
  it('get/set with path notation', () => {
    const store = Store({ user: { name: 'Alice', age: 30 } });
    expect(store.get('user.name')).toBe('Alice');
    store.set('user.name', 'Bob');
    expect(store.get('user.name')).toBe('Bob');
  });

  it('update with path and function', () => {
    const store = Store({ count: 5 });
    store.update('count', v => v + 1);
    expect(store.get('count')).toBe(6);
  });

  it('delete removes a key', () => {
    const store = Store({ a: 1, b: 2 });
    store.delete('b');
    expect(store.get('b')).toBeUndefined();
    expect(store.get('a')).toBe(1);
  });

  it('array index paths work with [n] syntax', () => {
    const store = Store({ items: ['x', 'y', 'z'] });
    expect(store.get('items[0]')).toBe('x');
    store.set('items[1]', 'Y');
    expect(store.get('items[1]')).toBe('Y');
  });

  it('.value returns entire object', () => {
    const store = Store({ x: 1, y: 2 });
    const v = store.value;
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
  });

  it('.value = obj replaces entire object', () => {
    const store = Store({ a: 1 });
    store.value = { b: 2 };
    expect(store.get('b')).toBe(2);
    expect(store.get('a')).toBeUndefined();
  });

  it('peek() returns data without tracking', () => {
    const store = Store({ val: 10 });
    let count = 0;
    Effect(() => {
      store.peek();
      count++;
    });
    expect(count).toBe(1);
    store.set('val', 20);
    expect(count).toBe(1); // no re-run
  });

  it('fine-grained path reactivity', () => {
    const store = Store({ a: 1, b: 2 });
    const aValues = [];
    Effect(() => { aValues.push(store.get('a')); });
    expect(aValues).toEqual([1]);

    store.set('b', 99); // change b, should NOT trigger a's effect
    expect(aValues).toEqual([1]);

    store.set('a', 10);
    expect(aValues).toEqual([1, 10]);
  });

  it('root signal notification on any set', () => {
    const store = Store({ x: 1 });
    let count = 0;
    Effect(() => {
      store.value; // root-level subscription
      count++;
    });
    expect(count).toBe(1);
    store.set('x', 2);
    expect(count).toBe(2);
  });

  it('no-op when setting same value', () => {
    const store = Store({ v: 42 });
    let count = 0;
    Effect(() => {
      store.get('v');
      count++;
    });
    expect(count).toBe(1);
    store.set('v', 42); // same value
    expect(count).toBe(1);
  });

  it('creates intermediate objects for deep set', () => {
    const store = Store({});
    store.set('a.b.c', 'deep');
    expect(store.get('a.b.c')).toBe('deep');
  });
});

// ═══════════════════════════════════════════════════════════════
// Context
// ═══════════════════════════════════════════════════════════════

describe('Context', () => {
  it('returns default value when empty', () => {
    const ctx = Context('fallback');
    expect(ctx.use()).toBe('fallback');
  });

  it('provide/use returns provided value', () => {
    const ctx = Context(null);
    let captured;
    ctx.provide('hello', () => {
      captured = ctx.use();
    });
    expect(captured).toBe('hello');
  });

  it('restores after provide completes', () => {
    const ctx = Context('default');
    ctx.provide('inner', () => {
      expect(ctx.use()).toBe('inner');
    });
    expect(ctx.use()).toBe('default');
  });

  it('nested provides stack correctly', () => {
    const ctx = Context('base');
    ctx.provide('level1', () => {
      expect(ctx.use()).toBe('level1');
      ctx.provide('level2', () => {
        expect(ctx.use()).toBe('level2');
      });
      expect(ctx.use()).toBe('level1');
    });
    expect(ctx.use()).toBe('base');
  });
});

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

describe('isSignal', () => {
  it('returns true for State', () => {
    expect(isSignal(State(1))).toBe(true);
  });

  it('returns true for Computed', () => {
    expect(isSignal(Computed(() => 1))).toBe(true);
  });

  it('returns true for Store', () => {
    expect(isSignal(Store({}))).toBe(true);
  });

  it('returns false for plain values', () => {
    expect(isSignal(42)).toBe(false);
    expect(isSignal(null)).toBe(false);
    expect(isSignal(undefined)).toBe(false);
    expect(isSignal('hello')).toBe(false);
    expect(isSignal({})).toBe(false);
  });
});

describe('isBinding', () => {
  it('returns true for Binding', () => {
    expect(isBinding(Binding(State(1)))).toBe(true);
  });

  it('returns false for State', () => {
    expect(isBinding(State(1))).toBe(false);
  });

  it('returns false for plain values', () => {
    expect(isBinding(null)).toBe(false);
    expect(isBinding(42)).toBe(false);
  });
});

describe('resolve', () => {
  it('resolves State to its value', () => {
    const s = State(99);
    expect(resolve(s)).toBe(99);
  });

  it('resolves Binding to its value', () => {
    const b = Binding(State(5));
    expect(resolve(b)).toBe(5);
  });

  it('passes through plain values', () => {
    expect(resolve(42)).toBe(42);
    expect(resolve('hello')).toBe('hello');
    expect(resolve(null)).toBe(null);
    expect(resolve(undefined)).toBe(undefined);
  });
});
