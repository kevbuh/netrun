# Testing Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Install Dependencies (2 min)

```bash
# Install Python testing tools
pip install pytest pytest-flask pytest-cov pytest-mock

# Install JavaScript testing tools (already installed)
npm install
```

### Step 2: Run Tests (1 min)

```bash
# Run all tests
npm test

# Or run individually:
npm run test:electron      # Electron tests (11 tests)
npm run test:unit          # Frontend tests (77 tests)
npm run test:backend       # Backend tests (NEW!)
```

### Step 3: Check Coverage (1 min)

```bash
# Frontend coverage
npm run test:coverage

# Backend coverage
npm run test:coverage:backend
```

### Step 4: Start Writing Tests (1 min)

See `TESTING_PLAN.md` for detailed roadmap!

---

## 📊 Current Test Status

### JavaScript Tests ✅
- **11 tests** - Electron (password store)
- **77 tests** - Frontend utilities
- **0% coverage** on main app files (high-value targets identified)

### Python Tests 🆕
- **Ready to run** - Test infrastructure created
- **3 test files** - persistence, feed parser, auth API
- **Fixtures ready** - Database, mocks, sample data

---

## 🎯 Quick Wins (Do Today)

1. **Run existing tests** ✅
   ```bash
   npm test
   ```

2. **Run backend tests** 🆕
   ```bash
   npm run test:backend
   ```

3. **Add ONE new test** (5 minutes)

   Pick any function from `src/helpers.py` or `src/persistence.py` and write a test:

   ```python
   # src/tests/unit/test_helpers.py

   def test_something_simple():
       """Test a simple helper function."""
       result = my_function(input_value)
       assert result == expected
   ```

4. **Check your test passes**
   ```bash
   pytest src/tests/unit/test_helpers.py -v
   ```

---

## 📝 What We Built

### New Files Created

```
netrun/
├── pytest.ini                              # Pytest configuration
├── TESTING_PLAN.md                         # Comprehensive testing roadmap
├── TESTING_QUICKSTART.md                   # This file!
│
├── src/tests/
│   ├── README.md                           # Testing documentation
│   ├── conftest.py                         # Test fixtures
│   │
│   ├── unit/
│   │   ├── test_persistence.py             # 50+ database tests
│   │   └── test_feed_parser.py             # 30+ feed parsing tests
│   │
│   └── integration/
│       └── test_api_auth.py                # 40+ auth API tests
│
└── .github/workflows/
    └── test.yml                            # CI/CD pipeline
```

### Updated Files

- `requirements.txt` - Added pytest dependencies
- `package.json` - Added backend test scripts

---

## 🏃 Common Commands

### Run Tests

```bash
# Everything
npm test                                    # All tests

# By category
npm run test:electron                       # Electron only
npm run test:unit                           # Frontend only
npm run test:backend                        # Backend only

# By type
npm run test:backend:unit                   # Backend unit tests (fast)
npm run test:backend:integration            # Backend integration tests (slower)

# Specific file
pytest src/tests/unit/test_persistence.py   # One file
pytest src/tests -k "user"                  # Tests matching "user"
```

### Watch Mode

```bash
npm run test:watch                          # Frontend watch mode
npm run test:watch:backend                  # Backend watch mode (requires pytest-watch)
```

### Coverage

```bash
npm run test:coverage                       # Frontend coverage
npm run test:coverage:backend               # Backend coverage
open htmlcov/index.html                     # View backend coverage report
```

### Quick Tests

```bash
npm run test:quick                          # Fast unit tests only (no integration)
pytest src/tests/unit -v                    # Python unit tests only
pytest src/tests -m "not slow" -v           # Skip slow tests
```

---

## 📚 Next Steps

### Today (30 minutes)
1. ✅ Run all tests: `npm test`
2. ✅ Check coverage: `npm run test:coverage:backend`
3. ✅ Read `src/tests/README.md`
4. ⏳ Write 1 new test

### This Week (3 hours)
1. ⏳ Write 10 backend tests for `persistence.py`
2. ⏳ Write 5 tests for `feed_parser.py`
3. ⏳ Add tests for `helpers.py`
4. ⏳ Run coverage and aim for 30%

### This Month (ongoing)
1. ⏳ Follow `TESTING_PLAN.md` Phase 1
2. ⏳ Add integration tests for all API routes
3. ⏳ Expand frontend utility tests
4. ⏳ Set up pre-commit hooks

---

## 🎓 Learning Resources

### Quick Reference

- **Pytest basics:** https://docs.pytest.org/en/stable/getting-started.html
- **Vitest guide:** https://vitest.dev/guide/
- **Flask testing:** https://flask.palletsprojects.com/en/latest/testing/

### Test Examples

Look at existing tests for patterns:
- `tests/password-store.test.js` - Node.js test example
- `src/utils.test.js` - Vitest example
- `src/tests/unit/test_persistence.py` - Pytest example

---

## 🐛 Troubleshooting

### pytest not found
```bash
# Make sure you're using venv
source venv/bin/activate
pip install pytest
```

### Tests failing
```bash
# Run with verbose output
pytest src/tests -vv

# Show print statements
pytest src/tests -s

# Drop into debugger
pytest src/tests --pdb
```

### Import errors
```bash
# Add src to Python path
export PYTHONPATH="${PYTHONPATH}:$(pwd)/src"
```

---

## 💡 Pro Tips

1. **Start small** - Write simple tests first
2. **Test behavior, not implementation** - Focus on what, not how
3. **Use fixtures** - Don't repeat setup code
4. **Mock external APIs** - Don't make real network calls
5. **Run tests often** - Catch bugs early

---

## 🎉 Success Metrics

### Phase 1 Goals (1 month)
- ✅ Test infrastructure set up
- ⏳ 60% Python backend coverage
- ⏳ 40% JS utility coverage
- ⏳ All critical paths tested

### Long-term Goals (6 months)
- ⏳ 85% Python backend coverage
- ⏳ 70% JS utility coverage
- ⏳ Integration tests for all APIs
- ⏳ E2E tests for critical flows

---

## 📞 Get Help

- **Documentation:** See `src/tests/README.md`
- **Roadmap:** See `TESTING_PLAN.md`
- **Examples:** Look at existing test files

---

**Remember:** Testing is an investment. Start small, build incrementally, and focus on high-value tests first!

Good luck! 🚀
