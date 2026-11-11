import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User } from '../../../src/modules/identity-access/users/user.entity.js';
import { UsersService } from '../../../src/modules/identity-access/users/users.service.js';
import { CheckIn } from '../../../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { ReservationLabelsReader } from '../../../src/modules/reservations-checkin/check-ins/reservation-labels.reader.js';
import { Reservation } from '../../../src/modules/reservations-checkin/reservations/reservation.entity.js';
import { Restaurant } from '../../../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from '../../../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from '../../../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from '../../../src/modules/restaurant-operations/tables/table.entity.js';
import {
  assertMigrationsApplied,
  connectTestDatabase,
  loadTestDatabaseUrl,
  testDatabaseSsl,
} from './test-db.js';

// Montaje común de las pruebas de reservas contra Postgres REAL con commits
// (sin ROLLBACK): un DataSource propio y escenarios con datos propios.
//
// Cada escenario crea su restaurante (abierto las 24 h todos los días), mesas
// y comensales con ids únicos, y se borra SOLO lo que creó, en orden de FK,
// aunque la prueba falle. La base de pruebas es una copia de datos reales: no
// se toca nada que estas pruebas no hayan creado.

// Registro para que la limpieza no dependa de que la prueba termine bien:
//  - running: los escenarios en curso. Vitest NO cancela una prueba que vence
//    por timeout (su código sigue corriendo en segundo plano y su finally sigue
//    pendiente), así que closeTestDataSource los espera antes de cerrar el
//    pool; si no, el afterAll cerraba las conexiones con el borrado a medias.
//  - live: los escenarios creados y todavía no borrados. Si algo quedó (el
//    escenario se colgó o su borrado falló), closeTestDataSource lo borra.
const running = new Set<Promise<void>>();
const live = new Set<Scenario>();

// Cuánto espera closeTestDataSource a las pruebas en curso. Menor que el
// hookTimeout de vitest.config.db.ts.
const IN_FLIGHT_WAIT_MS = 30_000;

// DataSource contra TEST_DATABASE_URL (con las protecciones de test-db.ts),
// sin migrar: antes comprueba que las migraciones ya estén aplicadas.
export async function openTestDataSource(): Promise<DataSource> {
  const url = loadTestDatabaseUrl();
  const check = await connectTestDatabase();
  try {
    await assertMigrationsApplied(check);
  } finally {
    await check.end();
  }
  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: [
      Reservation,
      CheckIn,
      Restaurant,
      RestaurantSchedule,
      Table,
      TableLog,
      User,
    ],
    synchronize: false,
    uuidExtension: 'pgcrypto',
    installExtensions: false,
    ssl: testDatabaseSsl(url),
    connectTimeoutMS: 10_000,
    // Conexiones de sobra para las peticiones en paralelo.
    extra: { max: 20 },
  });
  await dataSource.initialize();
  return dataSource;
}

// Las etiquetas reales de una reserva (mesa y nombre público del comensal).
export function reservationLabels(
  dataSource: DataSource,
): ReservationLabelsReader {
  return new ReservationLabelsReader(
    dataSource,
    new UsersService(dataSource.getRepository(User)),
  );
}

export interface TableSeed {
  identifier: string;
  capacity: number;
  status?: 'available' | 'reserved' | 'occupied';
  isActive?: boolean;
}

export interface Scenario {
  restaurantId: string;
  dinerIds: string[];
  // identificador → id de la mesa
  tableIds: Map<string, string>;
}

export async function createScenario(
  dataSource: DataSource,
  tables: TableSeed[],
  dinerCount: number,
): Promise<Scenario> {
  const [{ id: restaurantId }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO restaurants (name, is_open, latitude, longitude, approval_status) VALUES ($1, true, 4.655671, -74.057006, 'approved') RETURNING id`,
    [`db-test-${randomUUID()}`],
  );
  const scenario: Scenario = {
    restaurantId,
    dinerIds: [],
    tableIds: new Map(),
  };
  // Registrado desde el primer insert: lo que se cree después siempre se borra.
  live.add(scenario);
  // Se devuelve ya registrado: si algo falla a mitad, el finally limpia lo creado.
  try {
    for (let day = 1; day <= 7; day++) {
      await dataSource.query(
        `INSERT INTO restaurant_schedules (restaurant_id, day_of_week, is_open_24h) VALUES ($1, $2, true)`,
        [restaurantId, day],
      );
    }
    for (const seed of tables) {
      const [{ id }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO tables (restaurant_id, identifier, capacity, status, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          restaurantId,
          seed.identifier,
          seed.capacity,
          seed.status ?? 'available',
          seed.isActive ?? true,
        ],
      );
      scenario.tableIds.set(seed.identifier, id);
    }
    for (let i = 0; i < dinerCount; i++) {
      const [{ id }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO users (email, role, display_name) VALUES ($1, 'diner', $2) RETURNING id`,
        [`db-test-${randomUUID()}@example.com`, `Comensal ${i + 1}`],
      );
      scenario.dinerIds.push(id);
    }
  } catch (error) {
    await deleteScenario(dataSource, scenario);
    throw error;
  }
  return scenario;
}

// Borra solo lo que creó el escenario, en orden de FK. Cada paso se intenta
// aunque otro falle; el primer error se relanza al final.
export async function deleteScenario(
  dataSource: DataSource,
  scenario: Scenario,
): Promise<void> {
  const { restaurantId, dinerIds } = scenario;
  const steps: [string, unknown[]][] = [
    [`DELETE FROM check_ins WHERE restaurant_id = $1`, [restaurantId]],
    [`DELETE FROM reservations WHERE restaurant_id = $1`, [restaurantId]],
    [
      `DELETE FROM table_logs WHERE table_id IN (SELECT id FROM tables WHERE restaurant_id = $1)`,
      [restaurantId],
    ],
    [`DELETE FROM tables WHERE restaurant_id = $1`, [restaurantId]],
    [
      `DELETE FROM restaurant_schedules WHERE restaurant_id = $1`,
      [restaurantId],
    ],
    [`DELETE FROM users WHERE id = ANY($1::uuid[])`, [dinerIds]],
    [`DELETE FROM restaurants WHERE id = $1`, [restaurantId]],
  ];
  let firstError: unknown;
  for (const [sql, params] of steps) {
    try {
      await dataSource.query(sql, params);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) {
    throw firstError;
  }
  // Solo si se borró todo: si algo falló, sigue registrado para reintentarlo.
  live.delete(scenario);
}

export async function withScenario(
  dataSource: DataSource,
  tables: TableSeed[],
  dinerCount: number,
  work: (scenario: Scenario) => Promise<void>,
): Promise<void> {
  const run = (async () => {
    const scenario = await createScenario(dataSource, tables, dinerCount);
    try {
      await work(scenario);
    } finally {
      await deleteScenario(dataSource, scenario);
    }
  })();
  running.add(run);
  try {
    await run;
  } finally {
    running.delete(run);
  }
}

// Para el afterAll de cada suite. Garantiza, en este orden:
//  1. espera a las pruebas en curso (también las que vencieron por timeout y
//     siguen corriendo), hasta IN_FLIGHT_WAIT_MS;
//  2. borra cualquier escenario que haya quedado sin borrar;
//  3. cierra el pool, pase lo que pase en los pasos anteriores.
// Si algún borrado falla, lo relanza al final: no se da por buena una limpieza
// incompleta.
export async function closeTestDataSource(
  dataSource: DataSource | undefined,
): Promise<void> {
  if (!dataSource?.isInitialized) {
    return;
  }
  let firstError: unknown;
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, IN_FLIGHT_WAIT_MS);
    });
    try {
      await Promise.race([Promise.allSettled(running), timeout]);
    } finally {
      clearTimeout(timer);
    }
    for (const scenario of live) {
      try {
        await deleteScenario(dataSource, scenario);
      } catch (error) {
        firstError ??= error;
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (firstError) {
    throw firstError;
  }
}
