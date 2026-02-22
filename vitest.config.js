import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use happy-dom for lightweight DOM simulation
    environment: 'happy-dom',

    // Make describe, it, expect, etc. available globally
    globals: true,

    // Test file patterns
    include: ['src/**/*.{test,spec}.{js,ts}'],

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
      include: ['src/js/**/*.js', 'src/core/**/*.ts'],
      exclude: [
        'src/js/**/*.{test,spec}.js',
        'src/core/**/*.{test,spec}.ts',
        'src/core/**/__tests__/**',
        'src/dist/**',
        'node_modules/**'
      ],
      thresholds: {
        lines: 20,
        functions: 20,
        branches: 15,
        statements: 20
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
      '@core': '/src/core',
    },
  },
});
