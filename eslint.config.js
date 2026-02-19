import globals from 'globals'

export default [
  {
    // Frontend JS — loaded via <script> tags, not modules
    files: ['src/js/**/*.js'],
    ignores: ['**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        electronAPI: 'readonly',
      },
    },
    rules: {
      // Bug detection
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'warn',
      'no-self-assign': 'error',
      'no-self-compare': 'warn',
      'no-template-curly-in-string': 'warn',
      'use-isnan': 'error',
      'valid-typeof': 'error',

      // Style — match existing conventions
      'no-var': 'warn',
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'smart'],
    },
  },
  {
    // Frontend JS files already converted to ES modules
    files: [
      'src/js/core/core-settings.js',
      'src/js/core/core-state.js',
      'src/js/core/icons.js',
      'src/js/core/core-context-intake.js',
      'src/js/core/core-sidebar.js',
      'src/js/core/core-sounds.js',
      'src/js/logger.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        electronAPI: 'readonly',
      },
    },
    rules: {
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'warn',
      'no-self-assign': 'error',
      'no-self-compare': 'warn',
      'no-template-curly-in-string': 'warn',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'smart'],
    },
  },
  {
    // Aether design system — loaded via <script> tags, not modules
    files: ['src/aether/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        AetherTokens: 'readonly',
        Motion: 'readonly',
      },
    },
    rules: {
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'warn',
      'no-self-assign': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'smart'],
    },
  },
  {
    // Aether JS files already converted to ES modules
    files: [
      'src/aether/tokens.js',
      'src/aether/materials.js',
      'src/aether/motion.js',
      'src/aether/ambient.js',
      'src/aether/aether.js',
      'src/aether/ui/state.js',
      'src/aether/ui/view.js',
      'src/aether/ui/primitives.js',
      'src/aether/ui/controls.js',
      'src/aether/ui/containers.js',
      'src/aether/ui/overlay.js',
      'src/aether/ui/component.js',
      'src/aether/ui/aether-ui.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        AetherTokens: 'readonly',
        Motion: 'readonly',
      },
    },
    rules: {
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'warn',
      'no-self-assign': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'smart'],
    },
  },
  {
    // Electron main process — Node modules, can check undef/unused
    files: ['electron/**/*.js'],
    ignores: ['**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'warn',
      'no-self-assign': 'error',
      'no-self-compare': 'warn',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'smart'],
    },
  },
  {
    // Test files get vitest globals
    files: ['**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
]
