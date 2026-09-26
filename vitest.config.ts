import { defineConfig } from 'vitest/config';

// Ein Vitest-Lauf für das ganze Monorepo (`pnpm test`). Tests liegen je Paket unter test/;
// Web-Bausteine zusätzlich neben der Komponente (specs/ui/components.md §1), Umgebung jsdom per Docblock.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  // Wie in apps/web/vite.config.ts; Tests laufen ohne Build-ID.
  define: { __BUILD_ID__: JSON.stringify('test') },
  test: {
    include: [
      '{apps,packages,tools,infra,spikes}/**/test/**/*.{test,spec}.{ts,tsx}',
      'apps/web/src/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    // Powertools-Logger in Tests stumm schalten.
    env: { POWERTOOLS_LOG_LEVEL: 'SILENT' },
  },
});
