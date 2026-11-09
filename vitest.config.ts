import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@hst/shared': path.join(root, 'packages/shared/src/index.ts'),
      '@hst/core': path.join(root, 'packages/core/src/index.ts'),
      '@hst/fixture': path.join(root, 'packages/fixture/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
  },
});
