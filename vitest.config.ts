import { defineConfig } from 'vitest/config';

// Ein Vitest-Lauf für das ganze Monorepo (`pnpm test`). Tests liegen je Paket unter test/.
export default defineConfig({
  test: {
    include: ['{apps,packages,tools,infra,spikes}/**/test/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Powertools-Logger in Tests stumm schalten.
    env: { POWERTOOLS_LOG_LEVEL: 'SILENT' },
  },
});
