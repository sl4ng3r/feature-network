import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts', 'demo/tests/**/*.test.ts'] },
});
