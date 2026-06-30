import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'lib/**/__tests__/**/*.test.ts',
      'services/**/__tests__/**/*.test.ts',
      'api/src/**/__tests__/**/*.test.ts',
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
