# Testing Documentation

## Overview

This directory contains Python backend tests for the alpha project. Tests are organized into:

- **unit/** - Fast, isolated unit tests
- **integration/** - Tests that involve multiple components or external dependencies
- **fixtures/** - Shared test data and mock responses

## Setup

1. **Install test dependencies:**

```bash
pip install -r requirements.txt
```

This installs:
- pytest
- pytest-flask
- pytest-cov
- pytest-mock
- pytest-watch

2. **Verify installation:**

```bash
pytest --version
```

## Running Tests

### Run all tests
```bash
npm run test:backend
# or
pytest src/tests -v
```

### Run only unit tests (fast)
```bash
npm run test:backend:unit
# or
pytest src/tests/unit -v
```

### Run only integration tests
```bash
npm run test:backend:integration
# or
pytest src/tests/integration -v -m integration
```

### Watch mode (auto-rerun on file changes)
```bash
npm run test:watch:backend
# or
ptw src/tests
```

### Run specific test file
```bash
pytest src/tests/unit/test_persistence.py -v
```

### Run specific test
```bash
pytest src/tests/unit/test_persistence.py::TestUserManagement::test_create_user -v
```

### Run tests matching a pattern
```bash
pytest src/tests -k "user" -v  # Runs all tests with "user" in name
```

## Test Coverage

### Generate coverage report
```bash
npm run test:coverage:backend
# or
pytest src/tests --cov=src --cov-report=html --cov-report=term
```

This generates:
- Terminal summary
- HTML report in `htmlcov/` directory

### View HTML coverage report
```bash
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
```

### Current Coverage Goals

| Phase | Timeframe | Python | JS | Overall |
|-------|-----------|--------|-----|---------|
| Phase 1 | 1 month | 60% | 40% | 30% |
| Phase 2 | 3 months | 75% | 60% | 50% |
| Phase 3 | 6 months | 85% | 70% | 65% |

## Test Organization

```
src/tests/
├── conftest.py           # Pytest fixtures and configuration
├── setup.js              # Vitest setup (for JS tests)
│
├── unit/                 # Unit tests (fast, no external deps)
│   ├── test_persistence.py     # Database layer tests
│   ├── test_feed_parser.py     # Feed parsing tests
│   ├── test_helpers.py         # Helper function tests
│   └── test_kernels.py         # Jupyter kernel tests
│
├── integration/          # Integration tests (slower, more complex)
│   ├── test_api_auth.py        # Auth endpoint tests
│   ├── test_api_feeds.py       # Feed endpoint tests
│   ├── test_api_content.py     # Content endpoint tests
│   └── test_api_social.py      # Social endpoint tests
│
└── fixtures/             # Test data
    ├── sample_feeds.json       # Sample RSS/Atom feeds
    ├── sample_papers.json      # Sample paper data
    └── mock_responses.py       # Mock API responses
```

## Writing Tests

### Basic Test Structure

```python
import pytest

def test_something():
    """Test that something works."""
    # Arrange
    input_value = 42

    # Act
    result = function_to_test(input_value)

    # Assert
    assert result == expected_value
```

### Using Fixtures

```python
def test_with_database(init_db):
    """Test using the database fixture."""
    # init_db is provided by conftest.py
    cursor = init_db.cursor()
    cursor.execute('SELECT * FROM users')
    rows = cursor.fetchall()
    assert len(rows) >= 0
```

### Testing Flask Endpoints

```python
def test_api_endpoint(client):
    """Test a Flask API endpoint."""
    response = client.get('/api/endpoint')

    assert response.status_code == 200
    assert response.json['key'] == 'value'
```

### Mocking External APIs

```python
@patch('requests.get')
def test_with_mock_api(mock_get):
    """Test with mocked external API."""
    mock_get.return_value = Mock(
        status_code=200,
        json=lambda: {'data': 'test'}
    )

    result = function_that_calls_api()
    assert result['data'] == 'test'
```

## Test Markers

Tests can be marked with decorators to categorize them:

```python
@pytest.mark.unit
def test_pure_function():
    """Fast unit test."""
    pass

@pytest.mark.integration
def test_api_workflow():
    """Integration test."""
    pass

@pytest.mark.slow
def test_performance():
    """Slow test."""
    pass

@pytest.mark.requires_ollama
def test_with_ollama():
    """Test requiring Ollama."""
    pass
```

Run specific markers:
```bash
pytest -m unit          # Only unit tests
pytest -m integration   # Only integration tests
pytest -m "not slow"    # Skip slow tests
```

## Common Fixtures

Available in `conftest.py`:

- `app` - Flask app instance
- `client` - Test client for API requests
- `test_db` - Temporary test database
- `init_db` - Initialized test database with schema
- `test_user` - Pre-created test user
- `authenticated_client` - Client with auth token
- `mock_ollama` - Mocked Ollama API
- `mock_semantic_scholar` - Mocked Semantic Scholar API
- `mock_arxiv` - Mocked arXiv API
- `sample_papers` - Sample paper data
- `sample_feed_items` - Sample feed item data

## Best Practices

### ✅ DO:

1. **Write descriptive test names**
   ```python
   def test_user_can_save_paper_to_reading_list():  # Good
   def test_save():  # Bad
   ```

2. **Test one thing per test**
   ```python
   def test_create_user():
       """Test creating a user."""
       # Only test user creation

   def test_get_user():
       """Test retrieving a user."""
       # Only test retrieval
   ```

3. **Use fixtures for common setup**
   ```python
   def test_something(test_user):  # Good
       # test_user is set up once
   ```

4. **Test edge cases**
   ```python
   def test_parse_empty_feed():
   def test_parse_malformed_feed():
   def test_parse_very_large_feed():
   ```

5. **Mock external dependencies**
   ```python
   @patch('requests.get')  # Good
   def test_fetch_feed(mock_get):
       # Don't make real API calls in tests
   ```

### ❌ DON'T:

1. **Don't test implementation details**
   ```python
   # Bad - tests internal implementation
   def test_uses_specific_algorithm():
       assert function._internal_method() == 'SHA256'

   # Good - tests behavior
   def test_hashes_password_securely():
       result = hash_password('test')
       assert result != 'test'  # Not plaintext
       assert len(result) > 20  # Reasonable length
   ```

2. **Don't write flaky tests**
   ```python
   # Bad - timing-dependent
   def test_async_operation():
       start_operation()
       time.sleep(0.1)  # Might not be enough
       assert is_complete()

   # Good - wait explicitly
   def test_async_operation():
       start_operation()
       wait_until(lambda: is_complete(), timeout=5)
   ```

3. **Don't make tests depend on each other**
   ```python
   # Bad - test order matters
   def test_1_create():
       global user_id
       user_id = create_user()

   def test_2_update():
       update_user(user_id)  # Depends on test_1

   # Good - independent tests
   def test_create(init_db):
       user_id = create_user()
       assert user_id > 0

   def test_update(init_db, test_user):
       update_user(test_user['id'])
       # ...
   ```

4. **Don't test external libraries**
   ```python
   # Bad - tests Flask, not your code
   def test_flask_returns_json():
       assert isinstance(jsonify({}), Response)

   # Good - tests your endpoint
   def test_api_returns_user_data(client):
       response = client.get('/api/user/1')
       assert response.json['username'] == 'test'
   ```

## Debugging Tests

### Run with verbose output
```bash
pytest src/tests -vv
```

### Show print statements
```bash
pytest src/tests -s
```

### Drop into debugger on failure
```bash
pytest src/tests --pdb
```

### Run last failed tests only
```bash
pytest src/tests --lf
```

### Show slowest tests
```bash
pytest src/tests --durations=10
```

## Continuous Integration

Tests run automatically on:
- Pre-commit (if hook is enabled)
- Pull requests
- Main branch pushes

CI command:
```bash
npm run test:ci
```

This runs:
1. Electron tests (node:test)
2. Frontend unit tests (vitest)
3. Backend tests (pytest)

## Troubleshooting

### "ModuleNotFoundError"
```bash
# Make sure src/ is in Python path
export PYTHONPATH="${PYTHONPATH}:$(pwd)/src"
```

### "pytest: command not found"
```bash
# Install pytest in venv
venv/bin/pip install pytest
```

### "Database locked"
```bash
# Tests use temporary databases, but if you see this:
# - Make sure no other processes are using aether.db
# - Tests should use init_db fixture, not real database
```

### "Slow tests"
```bash
# Run only fast unit tests
pytest src/tests/unit -v

# Skip slow tests
pytest src/tests -m "not slow" -v
```

## Next Steps

1. ✅ Install pytest dependencies
2. ✅ Write first 10 backend tests
3. ⏳ Expand test coverage to 60%
4. ⏳ Add integration tests for all API routes
5. ⏳ Set up CI/CD pipeline
6. ⏳ Add pre-commit hooks

## Resources

- [Pytest documentation](https://docs.pytest.org/)
- [pytest-flask documentation](https://pytest-flask.readthedocs.io/)
- [Testing Best Practices](https://docs.python-guide.org/writing/tests/)
- [Coverage.py documentation](https://coverage.readthedocs.io/)
