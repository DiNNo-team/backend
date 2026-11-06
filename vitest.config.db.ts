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
    // Solo para estas pruebas (la config es exclusiva de test:db): hablan con
    // una base remota (Neon) y los casos con varias rondas hacen decenas de
    // consultas en serie; 20 s se quedaba corto (18,4 s medidos en una corrida
    // buena). afterAll espera hasta 30 s a las pruebas en curso (support/scenario.ts).
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
