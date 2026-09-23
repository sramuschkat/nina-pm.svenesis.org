import { defineConfig } from 'tsup';

// Ein Bundle je Lambda (TK 3.1, CLAUDE.md Regel 11). AUTH_TEST_MODE darf nie ins Bundle (ab AP-04a).
export default defineConfig({
  entry: {
    api: 'src/handlers/api.ts',
    worker: 'src/handlers/worker.ts',
    migrate: 'src/handlers/migrate.ts',
    'ops-cli': 'src/handlers/ops-cli.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  loader: { '.sql': 'text' },
});
