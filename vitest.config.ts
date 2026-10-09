import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'demo/tests/**/*.test.ts'],
    // Build one shared offline bundle before workers start; individual suites
    // must not compete to publish identical artifacts into plugin/dist.
    globalSetup: ['./tests/helpers/build.ts'],
    // The exported full benchmark saturates CPU/memory. Serial files keep it
    // from delaying independent MCP/Git/transaction fixtures on hosted runners.
    maxWorkers: 1,
  },
});
