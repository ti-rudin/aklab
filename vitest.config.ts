import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'lib/**/__tests__/**/*.test.ts',
      'services/**/__tests__/**/*.test.ts',
      'api/src/services/**/__tests__/**/*.test.ts',
      'api/src/cron/**/__tests__/**/*.test.ts',
      'api/src/api/**/__tests__/**/*.test.ts',
    ],
    exclude: [
      '**/e2e/**',
      '**/*.spec.ts',
      '**/node_modules/**',
      'app/**',
    ],
    environment: 'node',
    testTimeout: 30_000,
  },
});
