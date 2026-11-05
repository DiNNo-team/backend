import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { Client } from 'pg';

// Soporte de las pruebas contra Postgres real (`npm run test:db`).
//
// Seguridad: la URL sale SOLO de TEST_DATABASE_URL en `.env.test`. Si falta, o
// es igual a la DATABASE_URL de desarrollo (`.env` o el entorno), la prueba se
// niega a correr. Estas pruebas no aplican migraciones: asumen que ya se
// corrió `migration:run` contra la base de pruebas.

const TEST_ENV_FILE = '.env.test';
const DEV_ENV_FILE = '.env';

function readEnvFile(path: string): Record<string, string | undefined> {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}

export function resolveTestDatabaseUrl(
  testEnv: Record<string, string | undefined>,
  developmentUrls: (string | undefined)[],
): string {
  const url = testEnv.TEST_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      `Pruebas db canceladas: TEST_DATABASE_URL no está definida. Créala en ${TEST_ENV_FILE} apuntando a la base de PRUEBAS (nunca a la de desarrollo).`,
    );
  }
  if (developmentUrls.some((dev) => dev?.trim() === url)) {
    throw new Error(
      'Pruebas db canceladas: TEST_DATABASE_URL es igual a DATABASE_URL de desarrollo. Estas pruebas nunca deben tocar esa base; apunta TEST_DATABASE_URL a la base de pruebas.',
    );
  }
  return url;
}

// URL de la base de pruebas, con las protecciones de arriba. La usan tanto el
// cliente pg directo como las pruebas que arman un DataSource de TypeORM.
export function loadTestDatabaseUrl(): string {
  return resolveTestDatabaseUrl(readEnvFile(TEST_ENV_FILE), [
    readEnvFile(DEV_ENV_FILE).DATABASE_URL,
    process.env.DATABASE_URL,
  ]);
}

// Igual que data-source.ts: Neon exige TLS.
export function testDatabaseSsl(
  url: string,
): false | { rejectUnauthorized: boolean } {
  return url.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false;
}

export async function connectTestDatabase(): Promise<Client> {
  const url = loadTestDatabaseUrl();
  const client = new Client({
    connectionString: url,
    ssl: testDatabaseSsl(url),
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return client;
}

// Cada elemento: qué debe existir y qué migración lo crea.
const REQUIRED_SCHEMA = [
  {
    table: 'reservations',
    column: null,
    migration: '1793840000001-CreateReservations',
  },
  {
    table: 'check_ins',
    column: null,
    migration: '1793840000002-CreateCheckIns',
  },
  {
    table: 'table_logs',
    column: 'source',
    migration: '1793840000003-AddTableLogSource',
  },
] as const;

export async function assertMigrationsApplied(client: Client): Promise<void> {
  const missing: string[] = [];
  for (const { table, column, migration } of REQUIRED_SCHEMA) {
    const { rowCount } = column
      ? await client.query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
          [table, column],
        )
      : await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        );
    if (rowCount === 0) {
      missing.push(
        `${column ? `${table}.${column}` : table} (falta correr la migración ${migration})`,
      );
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `La base de pruebas no tiene el esquema esperado: ${missing.join('; ')}. Corre migration:run con --env-file=.env.test.`,
    );
  }
}

// Ejecuta `work` dentro de una transacción que siempre termina en ROLLBACK:
// la base de pruebas no queda con datos.
export async function inRolledBackTransaction(
  client: Client,
  work: () => Promise<void>,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await work();
  } finally {
    await client.query('ROLLBACK');
  }
}

// Un error de la base dentro de una transacción la deja abortada: la
// sentencia que se espera que falle va en un SAVEPOINT para poder seguir.
export async function expectDatabaseError(
  client: Client,
  sql: string,
  params: unknown[],
): Promise<{ code?: string; constraint?: string }> {
  await client.query('SAVEPOINT expected_failure');
  try {
    await client.query(sql, params);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    return error as { code?: string; constraint?: string };
  }
  await client.query('RELEASE SAVEPOINT expected_failure');
  throw new Error(
    `Se esperaba un error de la base y la sentencia pasó: ${sql}`,
  );
}

export const UNIQUE_VIOLATION = '23505';
export const CHECK_VIOLATION = '23514';

// Datos mínimos para colgar reservas y bitácora. Los correos y nombres son
// aleatorios para no chocar con datos que ya existan en la base de pruebas.
export async function insertUser(client: Client): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (email, role) VALUES ($1, 'diner') RETURNING id`,
    [`db-test-${randomUUID()}@example.com`],
  );
  return rows[0].id;
}

export async function insertRestaurant(client: Client): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO restaurants (name) VALUES ($1) RETURNING id`,
    [`db-test-${randomUUID()}`],
  );
  return rows[0].id;
}

export async function insertTable(
  client: Client,
  restaurantId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO tables (restaurant_id, identifier, capacity) VALUES ($1, $2, 4) RETURNING id`,
    [restaurantId, randomUUID().slice(0, 8)],
  );
  return rows[0].id;
}

export interface ReservationSeed {
  dinerId: string;
  restaurantId: string;
  tableId: string;
  code?: string;
  status?: string;
}

export async function insertReservation(
  client: Client,
  seed: ReservationSeed,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
     VALUES ($1, $2, 2, $3, $4, $5, now() + interval '15 minutes') RETURNING id`,
    [
      seed.code ?? 'K7M4QX',
      seed.status ?? 'active',
      seed.dinerId,
      seed.restaurantId,
      seed.tableId,
    ],
  );
  return rows[0].id;
}
