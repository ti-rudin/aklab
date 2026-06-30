import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'lib/**/__tests__/**/*.test.ts',
      'services/**/__tests__/**/*.test.ts',
      'api/src/services/**/__tests__/**/*.test.ts',
    ],
    exclude: [
      '**/e2e/**',
      '**/*.spec.ts',
      '**/node_modules/**',
      'app/**',
      // Controller tests need Strapi runtime — skip until proper test harness
      'api/src/api/**',
    ],
    environment: 'node',
    testTimeout: 30_000,
  },
});
