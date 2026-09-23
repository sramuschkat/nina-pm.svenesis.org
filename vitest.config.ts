import { defineConfig } from 'vitest/config';

// Ein Vitest-Lauf für das ganze Monorepo (`pnpm test`). Tests liegen je Paket unter test/.
export default defineConfig({
  test: {
    include: ['{apps,packages,tools,infra,spikes}/**/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
