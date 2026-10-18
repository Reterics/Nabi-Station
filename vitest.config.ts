import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/daemon/src/**/*.test.ts',
      'tests/unit/**/*.test.ts',
    ],
  },
});
