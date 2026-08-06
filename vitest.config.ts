import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { TZ: 'UTC' },
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/lib/**'],
      exclude: ['**/*.d.ts'],
      thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 }
    }
  }
});
