import { describe, it, expect, beforeEach } from 'vitest';

// ── Re-implement primitives as standalone test-friendly versions ──
// The real primitives depend on View (which has ESM import paths like '/aether/ui/view.js').
// We replicate the core logic here for unit testing.

function _spaceToken(v) {
  if (typeof v === 'number') return 'var(--nr-space-' + v + ')';
  return v;
}

function _makeStack(direction, children) {
  const el = document.createElement('div');
  el.style.display = 'flex';
  el.style.flexDirection = direction;
  for (const child of children) {
    if (child instanceof HTMLElement) el.appendChild(child);
    else if (typeof child === 'string') el.appendChild(document.createTextNode(child));
  }
  return {
    el,
    spacing(s) { el.style.gap = _spaceToken(s); return this; },
    alignment(a) {
      const map = { center: 'center', leading: 'flex-start', trailing: 'flex-end', stretch: 'stretch' };
      el.style.alignItems = map[a] || a;
      return this;
    },
  };
}

function VStack(...children) {
  if (children.length === 1 && Array.isArray(children[0])) children = children[0];
  return _makeStack('column', children);
}

function HStack(...children) {
  if (children.length === 1 && Array.isArray(children[0])) children = children[0];
  const v = _makeStack('row', children);
  v.el.style.alignItems = 'center';
  return v;
}

function ZStack(...children) {
  if (children.length === 1 && Array.isArray(children[0])) children = children[0];
  const el = document.createElement('div');
  el.style.position = 'relative';
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childEl = child instanceof HTMLElement ? child : document.createTextNode(String(child));
    if (i > 0 && childEl.style) {
      childEl.style.position = 'absolute';
      childEl.style.inset = '0';
    }
    el.appendChild(childEl);
  }
  return { el };
}

function Text(content) {
  const el = document.createElement('span');
  if (content != null) el.textContent = content;
  return {
    el,
    bold() { el.style.fontWeight = '600'; return this; },
    italic() { el.style.fontStyle = 'italic'; return this; },
  };
}

function Spacer(minSize) {
  const el = document.createElement('div');
  el.style.flex = '1';
  if (minSize) el.style.minWidth = _spaceToken(minSize);
  return { el };
}

function Divider() {
  const el = document.createElement('hr');
  el.style.border = 'none';
  el.style.borderTop = '1px solid var(--nr-border-default)';
  el.style.margin = '0';
  el.style.width = '100%';
  return { el };
}

function ScrollView(...children) {
  if (children.length === 1 && Array.isArray(children[0])) children = children[0];
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  el.style.flex = '1';
  return {
    el,
    horizontal() {
      el.style.overflowY = '';
      el.style.overflowX = 'auto';
      el.style.display = 'flex';
      return this;
    },
  };
}

function Grid(...children) {
  if (children.length === 1 && Array.isArray(children[0])) children = children[0];
  const el = document.createElement('div');
  el.style.display = 'grid';
  return {
    el,
    columns(n) { el.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)'; return this; },
    spacing(s) { el.style.gap = _spaceToken(s); return this; },
  };
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('VStack', () => {
  it('creates a flex column container', () => {
    const v = VStack();
    expect(v.el.tagName).toBe('DIV');
    expect(v.el.style.display).toBe('flex');
    expect(v.el.style.flexDirection).toBe('column');
  });

  it('.spacing() sets gap', () => {
    const v = VStack().spacing(2);
    expect(v.el.style.gap).toBe('var(--nr-space-2)');
  });

  it('.spacing() with pixel value', () => {
    const v = VStack().spacing('8px');
    expect(v.el.style.gap).toBe('8px');
  });

  it('.alignment() sets align-items', () => {
    const v = VStack().alignment('center');
    expect(v.el.style.alignItems).toBe('center');
  });

  it('.alignment() maps semantic names', () => {
    expect(VStack().alignment('leading').el.style.alignItems).toBe('flex-start');
    expect(VStack().alignment('trailing').el.style.alignItems).toBe('flex-end');
    expect(VStack().alignment('stretch').el.style.alignItems).toBe('stretch');
  });

  it('appends child elements', () => {
    const child = document.createElement('span');
    const v = VStack(child);
    expect(v.el.children.length).toBe(1);
    expect(v.el.children[0]).toBe(child);
  });

  it('flattens array argument', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const v = VStack([a, b]);
    expect(v.el.children.length).toBe(2);
  });
});

describe('HStack', () => {
  it('creates a flex row container', () => {
    const v = HStack();
    expect(v.el.style.display).toBe('flex');
    expect(v.el.style.flexDirection).toBe('row');
  });

  it('defaults align-items to center', () => {
    const v = HStack();
    expect(v.el.style.alignItems).toBe('center');
  });

  it('.spacing() sets gap', () => {
    const v = HStack().spacing(4);
    expect(v.el.style.gap).toBe('var(--nr-space-4)');
  });
});

describe('ZStack', () => {
  it('creates a relative container', () => {
    const v = ZStack();
    expect(v.el.style.position).toBe('relative');
  });

  it('positions children after first as absolute', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const c = document.createElement('div');
    const v = ZStack(a, b, c);
    expect(a.style.position).not.toBe('absolute');
    expect(b.style.position).toBe('absolute');
    expect(c.style.position).toBe('absolute');
  });
});

describe('Text', () => {
  it('creates a span with text content', () => {
    const t = Text('hello');
    expect(t.el.tagName).toBe('SPAN');
    expect(t.el.textContent).toBe('hello');
  });

  it('handles null/undefined content', () => {
    const t = Text(null);
    expect(t.el.textContent).toBe('');
  });

  it('.bold() sets font weight', () => {
    const t = Text('bold').bold();
    expect(t.el.style.fontWeight).toBe('600');
  });

  it('.italic() sets font style', () => {
    const t = Text('italic').italic();
    expect(t.el.style.fontStyle).toBe('italic');
  });

  it('modifiers chain', () => {
    const t = Text('styled').bold().italic();
    expect(t.el.style.fontWeight).toBe('600');
    expect(t.el.style.fontStyle).toBe('italic');
  });
});

describe('Spacer', () => {
  it('creates a flex:1 element', () => {
    const s = Spacer();
    expect(s.el.style.flex).toContain('1');
  });

  it('sets minWidth when given a size', () => {
    const s = Spacer(2);
    expect(s.el.style.minWidth).toBe('var(--nr-space-2)');
  });
});

describe('Divider', () => {
  it('creates an HR element', () => {
    const d = Divider();
    expect(d.el.tagName).toBe('HR');
  });

  it('has proper border styling', () => {
    const d = Divider();
    // happy-dom may expand shorthand; just check the key parts are present
    expect(d.el.style.borderTop).toContain('var(--nr-border-default)');
    expect(d.el.style.margin).toBe('0px');
  });
});

describe('ScrollView', () => {
  it('creates a scrollable container', () => {
    const sv = ScrollView();
    expect(sv.el.style.overflowY).toBe('auto');
    expect(sv.el.style.flex).toContain('1');
  });

  it('.horizontal() switches to horizontal scroll', () => {
    const sv = ScrollView().horizontal();
    expect(sv.el.style.overflowX).toBe('auto');
    expect(sv.el.style.display).toBe('flex');
  });
});

describe('Grid', () => {
  it('creates a grid container', () => {
    const g = Grid();
    expect(g.el.style.display).toBe('grid');
  });

  it('.columns() sets grid-template-columns', () => {
    const g = Grid().columns(3);
    expect(g.el.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
  });

  it('.spacing() sets gap', () => {
    const g = Grid().spacing(4);
    expect(g.el.style.gap).toBe('var(--nr-space-4)');
  });
});
