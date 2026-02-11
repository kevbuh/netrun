# Testing Improvement Plan

## Current State (Feb 2026)

### JavaScript Tests
- ✅ 4 test files: password-store, utils, storage, quality.helpers
- ✅ 88 tests total (all passing)
- ❌ **0% coverage** on main application files
- ✅ Vitest + node:test configured
- ✅ Coverage reporting configured

### Python Tests
- ❌ **No tests at all**
- ❌ pytest not installed
- ❌ ~79KB persistence.py with 0 tests
- ❌ Multiple Flask routes with 0 tests

### What's Missing
1. Backend API tests (Flask routes)
2. Frontend integration tests
3. E2E tests for Electron app
4. Database layer tests
5. Feed parser tests
6. Quality filter tests
7. Authentication tests

---

## Priority Levels

### 🔴 CRITICAL (Implement First)
**Backend API Tests** - No coverage of Flask routes

**Why critical:**
- Backend handles auth, data persistence, AI quality filtering
- Bugs here affect all users immediately
- Easier to test than frontend (no DOM, no Electron)

### 🟡 HIGH (Implement Second)
**Core utility function tests** - Expand existing coverage

**Why high:**
- Shared utilities used everywhere
- Easy to test (pure functions)
- High ROI

### 🟢 MEDIUM (Implement Later)
**Frontend integration tests** - Component-level testing

**Why medium:**
- Vanilla JS makes testing harder (no module boundaries)
- Require more complex mocking
- Lower ROI than backend tests

### 🔵 LOW (Future Enhancement)
**E2E tests** - Full application flow testing

**Why low:**
- Expensive to write and maintain
- Requires Playwright/Puppeteer setup
- Better to have good unit/integration coverage first

---

## Phase 1: Backend Foundation (Week 1)

### 1.1 Setup Python Testing Infrastructure

**Add to requirements.txt:**
```
pytest>=7.4.0
pytest-flask>=1.2.0
pytest-cov>=4.1.0
pytest-mock>=3.11.0
```

**Files to create:**
- `src/tests/conftest.py` - Pytest fixtures
- `src/tests/test_persistence.py` - Database tests
- `src/tests/test_feed_parser.py` - Feed parsing tests
- `src/tests/test_helpers.py` - Helper function tests
- `pytest.ini` - Pytest configuration

**Coverage goal:** 60% of Python backend

### 1.2 Critical Backend Tests

**Priority order:**
1. **Authentication** (`test_auth.py`)
   - Login/logout flows
   - Token validation
   - Session management
   - User registration

2. **Persistence Layer** (`test_persistence.py`)
   - Database CRUD operations
   - get_db() context manager
   - Table creation
   - Data integrity

3. **Feed System** (`test_feeds.py`)
   - Feed fetching (`/api/feed-items`)
   - RSS proxy (`/api/rss-proxy`)
   - Feed polling daemon
   - Custom feeds

4. **Quality Filter** (`test_quality.py`)
   - Verdict endpoint (`/api/quality-filter`)
   - Prompt testing
   - Score calculation
   - Cache behavior

---

## Phase 2: Frontend Core (Week 2)

### 2.1 Expand Utility Test Coverage

**Files to test:**
- `src/utils.js` ✅ (already has tests)
- `src/storage.js` ✅ (already has tests)
- `js/core.js` - Core utilities (extract testable functions)
- `js/quality.js` - Quality filter logic
- `js/feed.js` - Feed rendering logic

**Coverage goal:** 40% of testable JS utilities

### 2.2 Extract and Test Pure Functions

**Problem:** Vanilla JS with global functions makes testing hard

**Solution:** Don't refactor! Instead:
1. Identify pure functions (no DOM, no side effects)
2. Copy function to test helper file
3. Test the logic pattern
4. Document tested behavior

**Example targets:**
- `computeInterestProfile()` in quality.js
- `parseArxivId()` in utils.js ✅ (already tested)
- `formatRelativeTime()` in utils.js ✅ (already tested)
- Feed catalog manipulation functions

---

## Phase 3: Integration Tests (Week 3-4)

### 3.1 API Integration Tests

**Test Flask routes end-to-end:**

```python
# src/tests/integration/test_api_integration.py

def test_feed_workflow(client):
    """Test complete feed workflow: fetch → filter → save"""
    # 1. Get feed items
    resp = client.get('/api/feed-items?sources=arxiv')
    assert resp.status_code == 200
    items = resp.json

    # 2. Filter with quality
    resp = client.post('/api/quality-filter', json={
        'titles': [items[0]['title']]
    })
    assert resp.status_code == 200

    # 3. Save post (requires auth)
    # ...

def test_doc_chat_sse(client):
    """Test doc-chat SSE streaming"""
    # Test SSE endpoint with mock Ollama
    # ...
```

### 3.2 Database Integration Tests

**Test with real SQLite:**
```python
def test_user_workflow_e2e(app, db):
    """Test user registration → login → sync workflow"""
    # Complete user lifecycle test
```

---

## Phase 4: Specialized Tests (Week 5+)

### 4.1 Feed Parser Tests

**High value - complex parsing logic:**
```python
# src/tests/test_feed_parser.py

def test_parse_arxiv_rss():
    """Test arXiv RSS parsing"""
    # Mock RSS feed response
    # Verify parsing logic
    # Test edge cases (missing fields, malformed dates)

def test_parse_hn_json():
    """Test HN API JSON parsing"""
    # ...

def test_parse_polymarket():
    """Test Polymarket API parsing"""
    # ...
```

### 4.2 Quality Filter End-to-End

**Test AI quality filtering with mock Ollama:**
```python
def test_quality_filter_verdicts(client, mock_ollama):
    """Test verdict phase (KEEP/SKIP)"""
    mock_ollama.return_value = {'response': 'KEEP'}
    # Test prompt, parsing, caching

def test_quality_filter_scoring(client, mock_ollama):
    """Test scoring phase (0-100)"""
    mock_ollama.return_value = {'response': '85'}
    # Test scoring, threshold, interest_context
```

### 4.3 Semantic Search Tests

```python
def test_semantic_embedding(client, mock_ollama):
    """Test content embedding workflow"""
    # Mock nomic-embed-text
    # Test /api/embed-content
    # Verify database storage

def test_semantic_search(client, db):
    """Test cosine similarity search"""
    # Insert test embeddings
    # Test /api/semantic-search
    # Verify results ranking
```

---

## Phase 5: E2E Tests (Future)

### 5.1 Playwright Setup

**Not urgent, but nice to have:**
```javascript
// tests/e2e/feed-workflow.spec.js

test('user can browse and save posts', async ({ page }) => {
  await page.goto('app://localhost#feed');
  await page.click('.paper-card');
  await page.click('.save-button');
  // Verify saved in localStorage
});
```

---

## Test Organization Structure

```
netrun/
├── tests/                     # Electron tests (node:test)
│   └── password-store.test.js
│
├── src/
│   ├── tests/                 # Python backend tests
│   │   ├── conftest.py       # Pytest fixtures
│   │   ├── setup.js          # Vitest setup ✅
│   │   │
│   │   ├── unit/             # Unit tests
│   │   │   ├── test_persistence.py
│   │   │   ├── test_helpers.py
│   │   │   ├── test_feed_parser.py
│   │   │   └── test_kernels.py
│   │   │
│   │   ├── integration/      # Integration tests
│   │   │   ├── test_api_feeds.py
│   │   │   ├── test_api_content.py
│   │   │   ├── test_api_auth.py
│   │   │   └── test_api_social.py
│   │   │
│   │   └── fixtures/         # Test data
│   │       ├── sample_feeds.json
│   │       ├── sample_papers.json
│   │       └── mock_responses.py
│   │
│   ├── js/
│   │   ├── quality.helpers.test.js ✅
│   │   └── [more test files...]
│   │
│   ├── utils.test.js ✅
│   └── storage.test.js ✅
│
└── pytest.ini
```

---

## npm Scripts to Add

```json
{
  "scripts": {
    "test": "npm run test:electron && npm run test:unit && npm run test:backend",
    "test:electron": "node --test 'tests/**/*.test.js'",
    "test:unit": "vitest run",
    "test:backend": "pytest src/tests -v",
    "test:watch": "vitest",
    "test:watch:backend": "pytest-watch src/tests",
    "test:coverage": "vitest run --coverage",
    "test:coverage:backend": "pytest src/tests --cov=src --cov-report=html",
    "test:all": "npm run test:electron && npm run test:unit && npm run test:backend",
    "test:ci": "npm run test:all"
  }
}
```

---

## Coverage Goals

### Phase 1 (1 month)
- Python backend: **60%**
- JS utilities: **40%**
- Overall: **30%**

### Phase 2 (3 months)
- Python backend: **75%**
- JS utilities: **60%**
- Overall: **50%**

### Phase 3 (6 months)
- Python backend: **85%**
- JS utilities: **70%**
- Overall: **65%**

---

## Testing Principles for Vanilla JS Codebase

### ✅ DO:
1. **Test pure functions** - Extract and test logic without DOM
2. **Test utilities first** - High ROI, easy to test
3. **Test backend thoroughly** - Backend is easier to test
4. **Mock external dependencies** - Ollama, Semantic Scholar, arXiv
5. **Test edge cases** - Empty feeds, malformed data, network errors
6. **Test error handling** - Failed API calls, quota errors, timeouts

### ❌ DON'T:
1. **Don't refactor for testability** - Keep vanilla JS architecture
2. **Don't test DOM manipulation** - Hard to test, low ROI
3. **Don't aim for 100% coverage** - 70% is excellent for this codebase
4. **Don't test third-party code** - Focus on your code
5. **Don't write brittle tests** - Test behavior, not implementation

---

## Quick Wins (Do Today)

1. ✅ Install pytest: `pip install pytest pytest-flask pytest-cov`
2. ✅ Create `src/tests/conftest.py` with Flask app fixture
3. ✅ Write 5 tests for `test_persistence.py`:
   - Test get_db() returns connection
   - Test user creation
   - Test session CRUD
   - Test feed_items table
   - Test embeddings table
4. ✅ Run `pytest src/tests -v` to verify
5. ✅ Add backend coverage report

**Estimated time:** 2-3 hours for immediate impact

---

## Long-term Maintenance

### Pre-commit Hooks
```bash
# .git/hooks/pre-commit
#!/bin/bash
npm run test:electron || exit 1
npm run test:unit || exit 1
pytest src/tests --maxfail=1 || exit 1
```

### CI/CD Integration
```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm install
      - run: npm run test:electron
      - run: npm run test:unit
      - run: pip install -r requirements.txt
      - run: pytest src/tests --cov
```

---

## Resources

- **Vitest docs:** https://vitest.dev
- **Pytest docs:** https://docs.pytest.org
- **pytest-flask:** https://pytest-flask.readthedocs.io
- **Testing vanilla JS:** https://github.com/testing-library/dom-testing-library

---

## Next Steps

1. **Review this plan** with team
2. **Choose Phase 1 priorities** (backend tests)
3. **Set up pytest** (30 minutes)
4. **Write first 10 backend tests** (2-3 hours)
5. **Run tests in CI** (1 hour)
6. **Track coverage over time**

**Remember:** Testing is an investment. Start small, build incrementally, focus on high-value tests first.
