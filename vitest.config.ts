import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/helpers/setup.ts'],
    include: ['test/**/*.test.{ts,mjs}'],
    exclude: ['node_modules', 'dist', 'build'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['server/**/*.{mjs,js}', 'src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules',
        'test',
        'dist',
        'build',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.ts',
        '**/types.ts'
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70
      }
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    isolate: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, './server')
    }
  }
});
