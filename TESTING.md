# Testing Guide

## Test Setup

This project uses **Vitest** for frontend unit tests and **node:test** for Electron main process tests.

### Test Structure

```
tests/              # Electron main process tests (node:test)
  └── password-store.test.js
src/
  ├── utils.js      # Testable utility functions
  ├── utils.test.js # Unit tests for utils
  ├── storage.js    # localStorage wrappers
  ├── storage.test.js
  └── tests/
      └── setup.js  # Global test setup (mocks, helpers)
```

## Running Tests

```bash
# Run all tests (Electron + unit tests)
npm test

# Run only Electron main process tests
npm run test:electron

# Run only unit tests
npm run test:unit

# Watch mode (auto-rerun on file changes)
npm run test:watch

# Interactive UI mode
npm run test:ui

# Generate coverage report
npm run test:coverage
```

## Writing Tests

### 1. Pure Functions (Easiest)

Test pure functions with no dependencies:

```javascript
// utils.js
export function calculateScore(value) {
  return value * 2;
}

// utils.test.js
import { describe, it, expect } from 'vitest';
import { calculateScore } from './utils.js';

describe('calculateScore', () => {
  it('should double the value', () => {
    expect(calculateScore(5)).toBe(10);
  });
});
```

### 2. Functions with localStorage

Use happy-dom's built-in localStorage mock:

```javascript
// storage.test.js
import { beforeEach } from 'vitest';

describe('localStorage functions', () => {
  beforeEach(() => {
    localStorage.clear(); // Reset before each test
  });

  it('should store and retrieve', () => {
    localStorage.setItem('key', 'value');
    expect(localStorage.getItem('key')).toBe('value');
  });
});
```

### 3. Functions with DOM

happy-dom provides a full DOM environment:

```javascript
it('should manipulate DOM', () => {
  document.body.innerHTML = '<div id="test">Hello</div>';
  const el = document.getElementById('test');
  expect(el.textContent).toBe('Hello');
});
```

### 4. Async Functions

Use async/await or done callbacks:

```javascript
it('should handle async operations', async () => {
  const result = await fetchData();
  expect(result).toBeDefined();
});
```

### 5. Mocking with vi

Vitest provides `vi` for mocking:

```javascript
import { vi } from 'vitest';

it('should mock a function', () => {
  const fn = vi.fn();
  fn('arg');
  expect(fn).toHaveBeenCalledWith('arg');
});

it('should mock fetch', async () => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: 'test' })
    })
  );

  const result = await myApiCall();
  expect(result.data).toBe('test');
});
```

## Test Patterns

### Testing Edge Cases

Always test:
- ✅ Happy path (normal input)
- ✅ Empty values (`''`, `[]`, `{}`)
- ✅ Null/undefined
- ✅ Boundary conditions (min/max values)
- ✅ Invalid input (wrong types, malformed data)

Example:

```javascript
describe('parseNumber', () => {
  it('should parse valid number', () => {
    expect(parseNumber('42')).toBe(42);
  });

  it('should handle empty string', () => {
    expect(parseNumber('')).toBe(0);
  });

  it('should handle null/undefined', () => {
    expect(parseNumber(null)).toBe(0);
    expect(parseNumber(undefined)).toBe(0);
  });

  it('should handle invalid input', () => {
    expect(parseNumber('not a number')).toBe(NaN);
  });
});
```

### Testing Error Handling

```javascript
it('should throw on invalid input', () => {
  expect(() => riskyFunction(null)).toThrow('Invalid input');
});

it('should handle errors gracefully', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  functionThatLogsErrors();

  expect(consoleError).toHaveBeenCalled();
  consoleError.mockRestore();
});
```

### Testing with Timers

```javascript
it('should debounce', async () => {
  const fn = vi.fn();
  const debounced = debounce(fn, 100);

  debounced();
  expect(fn).not.toHaveBeenCalled();

  await new Promise(resolve => setTimeout(resolve, 150));
  expect(fn).toHaveBeenCalledTimes(1);
});
```

## Refactoring Strategy

When adding tests to existing code:

### Step 1: Extract Pure Functions

Move logic into testable pure functions:

```javascript
// Before (hard to test)
function processData() {
  const data = localStorage.getItem('data');
  const parsed = JSON.parse(data || '[]');
  return parsed.map(x => x * 2);
}

// After (easy to test)
export function doubleValues(values) {
  return values.map(x => x * 2);
}

function processData() {
  const data = getStorageItem('data', []);
  return doubleValues(data);
}
```

Now you can test `doubleValues` without mocking localStorage.

### Step 2: Add Tests for Extracted Functions

Write comprehensive tests for the pure functions:

```javascript
describe('doubleValues', () => {
  it('should double all values', () => {
    expect(doubleValues([1, 2, 3])).toEqual([2, 4, 6]);
  });

  it('should handle empty array', () => {
    expect(doubleValues([])).toEqual([]);
  });
});
```

### Step 3: Test Integration Points

Mock dependencies for integration tests:

```javascript
describe('processData', () => {
  it('should process stored data', () => {
    localStorage.setItem('data', JSON.stringify([1, 2, 3]));
    expect(processData()).toEqual([2, 4, 6]);
  });
});
```

## Coverage Goals

Current coverage is 0% on existing code (all vanilla JS files). As you refactor:

1. **Extract testable utilities** → aim for 80%+ coverage
2. **Add integration tests** for key features → 50%+
3. **Focus on critical paths** first (quality filter, feed processing, etc.)

View coverage report:
```bash
npm run test:coverage
# Opens coverage/index.html in browser
```

## Next Steps

### High-Priority Test Targets

1. **Quality filter logic** (`quality.js`)
   - `computeInterestProfile()` - personalization scoring
   - `getSourceAffinity()` - engagement calculation
   - `buildInterestContext()` - context string generation

2. **Feed processing** (`feed.js`)
   - Feed item filtering
   - Sorting algorithms
   - Trend detection

3. **Storage helpers**
   - Already covered in `storage.test.js`
   - Can be integrated into existing code

4. **Browse utilities** (Tier 1 modules)
   - URL parsing
   - Tab management logic
   - Session storage

### Low-Priority (Integration/E2E)

- Full UI flows
- API integration tests
- Electron IPC tests

## Tips

- **Start small** - test pure functions first
- **Refactor incrementally** - extract logic, test it, integrate
- **Mock sparingly** - prefer testing real behavior when possible
- **Use descriptive test names** - `it('should X when Y')`
- **One assertion per concept** - multiple related assertions are OK
- **Run tests in watch mode** while developing - instant feedback

## Resources

- [Vitest Docs](https://vitest.dev/)
- [Vitest API](https://vitest.dev/api/)
- [happy-dom](https://github.com/capricorn86/happy-dom)
- [Testing Library](https://testing-library.com/) - optional, for DOM testing patterns
