import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Pruebas contra un PostgreSQL REAL (la base de pruebas, nunca la de
// desarrollo). No forman parte de `npm test` ni de `npm run test:e2e`: se
// corren aparte con `npm run test:db`. Ver test/db/support/test-db.ts.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/db/**/*.db-spec.ts'],
    // Una sola base compartida: los archivos corren uno tras otro.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
