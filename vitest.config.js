import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use happy-dom for lightweight DOM simulation
    environment: 'happy-dom',

    // Make describe, it, expect, etc. available globally
    globals: true,

    // Test file patterns
    include: ['src/**/*.{test,spec}.js'],

    // Files to exclude
    exclude: [
      'node_modules',
      'dist',
      'electron',
      'tests', // Keep electron tests separate
      'venv',
      'experiments'
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/js/**/*.js'],
      exclude: [
        'src/js/**/*.{test,spec}.js',
        'src/dist/**',
        'node_modules/**'
      ],
      thresholds: {
        lines: 0,      // Start at 0, increase as you add tests
        functions: 0,
        branches: 0,
        statements: 0
      }
    },

    // Setup files for global mocks
    setupFiles: ['./src/tests/setup.js'],

    // Test timeout
    testTimeout: 10000,
  },

  // Resolve configuration (helps with module resolution)
  resolve: {
    alias: {
      '@': '/src/js',
    },
  },
});
