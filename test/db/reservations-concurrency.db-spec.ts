import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity-access/index.js';
import { User } from '../../src/modules/identity-access/users/user.entity.js';
import { CheckIn } from '../../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { CreateReservationService } from '../../src/modules/reservations-checkin/reservations/create-reservation.service.js';
import {
  RandomCodeGenerator,
  type CodeGenerator,
} from '../../src/modules/reservations-checkin/reservations/reservation-code.js';
import { Reservation } from '../../src/modules/reservations-checkin/reservations/reservation.entity.js';
import { Restaurant } from '../../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from '../../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from '../../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { DbTableStatusLog } from '../../src/modules/restaurant-operations/table-logs/table-logs.recorder.js';
import { Table } from '../../src/modules/restaurant-operations/tables/table.entity.js';
import {
  TableStatusLog,
  type TableStatusChange,
} from '../../src/modules/restaurant-operations/tables/table-status-log.js';
import {
  AvailabilityService,
  type Clock,
} from '../../src/modules/search-availability/index.js';
import {
  assertMigrationsApplied,
  connectTestDatabase,
  loadTestDatabaseUrl,
  testDatabaseSsl,
} from './support/test-db.js';

// Concurrencia de POST /v1/reservations contra Postgres REAL (Sprint 3,
// tarea 2; CLAUDE.md §12.4). Llama al servicio REAL con peticiones en
// paralelo por conexiones distintas del pool: el bloqueo SKIP LOCKED, la
// revalidación y los índices únicos parciales son los de verdad.
//
// A diferencia del resto de test/db, aquí NO hay ROLLBACK: la concurrencia
// necesita transacciones que se confirmen. Por eso cada prueba crea sus
// propios datos (restaurante, mesas, comensales, con ids únicos) y borra
// SOLO lo que creó, en orden de FK, aunque la prueba falle. La base de
// pruebas es una copia de datos reales: no se toca nada que esta suite no
// haya creado.

// Viernes 2026-11-06 12:00 en Bogotá; el restaurante abre las 24 h, así que
// está abierto a cualquier hora.
const NOW = new Date('2026-11-06T17:00:00Z');
const CLOCK = { now: () => NOW } as Clock;

let dataSource: DataSource;

beforeAll(async () => {
  const url = loadTestDatabaseUrl();
  const check = await connectTestDatabase();
  try {
    await assertMigrationsApplied(check);
  } finally {
    await check.end();
  }
  dataSource = new DataSource({
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
});

afterAll(async () => {
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
  }
});

// ---------------------------------------------------------------- datos ----

interface TableSeed {
  identifier: string;
  capacity: number;
  status?: 'available' | 'reserved' | 'occupied';
  isActive?: boolean;
}

interface Scenario {
  restaurantId: string;
  dinerIds: string[];
  // identificador → id de la mesa
  tableIds: Map<string, string>;
}

async function createScenario(
  tables: TableSeed[],
  dinerCount: number,
): Promise<Scenario> {
  const [{ id: restaurantId }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO restaurants (name, is_open, latitude, longitude) VALUES ($1, true, 4.655671, -74.057006) RETURNING id`,
    [`db-test-${randomUUID()}`],
  );
  const scenario: Scenario = {
    restaurantId,
    dinerIds: [],
    tableIds: new Map(),
  };
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
    await deleteScenario(scenario);
    throw error;
  }
  return scenario;
}

// Borra solo lo que creó el escenario, en orden de FK. Cada paso se intenta
// aunque otro falle; el primer error se relanza al final.
async function deleteScenario(scenario: Scenario): Promise<void> {
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
}

async function withScenario(
  tables: TableSeed[],
  dinerCount: number,
  work: (scenario: Scenario) => Promise<void>,
): Promise<void> {
  const scenario = await createScenario(tables, dinerCount);
  try {
    await work(scenario);
  } finally {
    await deleteScenario(scenario);
  }
}

// ------------------------------------------------------------- servicio ----

function buildService(
  overrides: { statusLog?: TableStatusLog; codes?: CodeGenerator } = {},
): CreateReservationService {
  return new CreateReservationService(
    dataSource,
    new AvailabilityService(dataSource, CLOCK),
    overrides.statusLog ?? new DbTableStatusLog(),
    new EventEmitter2(),
    CLOCK,
    overrides.codes ?? new RandomCodeGenerator(),
    { ttlMinutes: 15 },
  );
}

type Outcome = { ok: true; table: string } | { ok: false; code: string };

async function attempt(
  service: CreateReservationService,
  dinerId: string,
  restaurantId: string,
  partySize: number,
): Promise<Outcome> {
  try {
    const response = await service.create(
      { userId: dinerId, restaurantId: null, role: UserRole.DINER },
      { restaurantId, partySize },
    );
    return { ok: true, table: response.table.identifier };
  } catch (error) {
    const code = (error as { response?: { errorCode?: string } }).response
      ?.errorCode;
    // Cualquier otro error se muestra completo: no debe pasar.
    return { ok: false, code: code ?? `ERROR: ${String(error)}` };
  }
}

const successes = (outcomes: Outcome[]) =>
  outcomes.filter((outcome) => outcome.ok);
const failureCodes = (outcomes: Outcome[]) =>
  outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.code]));

// -------------------------------------------------------- verificaciones ----

interface DbState {
  activeReservations: { table_id: string; diner_id: string }[];
  tables: Map<string, string>; // identificador → estado
  reservationLogs: number;
}

async function readState(scenario: Scenario): Promise<DbState> {
  const activeReservations = await dataSource.query<
    { table_id: string; diner_id: string }[]
  >(
    `SELECT table_id, diner_id FROM reservations WHERE restaurant_id = $1 AND status = 'active'`,
    [scenario.restaurantId],
  );
  const tables = await dataSource.query<
    { identifier: string; status: string }[]
  >(`SELECT identifier, status FROM tables WHERE restaurant_id = $1`, [
    scenario.restaurantId,
  ]);
  const [{ count }] = await dataSource.query<{ count: string }[]>(
    `SELECT count(*) FROM table_logs
      WHERE source = 'reservation' AND previous_status = 'available' AND new_status = 'reserved'
        AND table_id IN (SELECT id FROM tables WHERE restaurant_id = $1)`,
    [scenario.restaurantId],
  );
  return {
    activeReservations,
    tables: new Map(tables.map((row) => [row.identifier, row.status])),
    reservationLogs: Number(count),
  };
}

// Lo que debe cumplirse siempre al terminar: una reserva activa por cada
// éxito, cada una con su mesa en reserved, ninguna mesa reserved sin reserva y
// una fila de bitácora con source 'reservation' por cada reserva creada.
async function expectConsistent(
  scenario: Scenario,
  expectedSuccesses: number,
  initiallyReserved = 0,
): Promise<DbState> {
  const state = await readState(scenario);
  expect(state.activeReservations).toHaveLength(expectedSuccesses);
  expect(
    new Set(state.activeReservations.map((row) => row.table_id)).size,
  ).toBe(expectedSuccesses);
  expect(
    new Set(state.activeReservations.map((row) => row.diner_id)).size,
  ).toBe(expectedSuccesses);
  const reservedTables = [...state.tables.values()].filter(
    (status) => status === 'reserved',
  );
  expect(reservedTables).toHaveLength(expectedSuccesses + initiallyReserved);
  expect(state.reservationLogs).toBe(expectedSuccesses);
  return state;
}

// ----------------------------------------------------------------- casos ----

describe('POST /reservations: concurrencia contra Postgres real', () => {
  describe('1. una sola mesa libre y varios comensales a la vez', () => {
    it.each([5, 10])(
      'con %i comensales: exactamente 1 éxito y el resto NO_TABLE_AVAILABLE',
      (diners) =>
        withScenario([{ identifier: '01', capacity: 4 }], diners, async (s) => {
          const service = buildService();

          const outcomes = await Promise.all(
            s.dinerIds.map((id) => attempt(service, id, s.restaurantId, 2)),
          );

          expect(successes(outcomes)).toHaveLength(1);
          expect(failureCodes(outcomes)).toEqual(
            Array(diners - 1).fill('NO_TABLE_AVAILABLE'),
          );
          await expectConsistent(s, 1);
        }),
    );

    it('se repite 5 veces para dar más oportunidad a la carrera', async () => {
      for (let round = 0; round < 5; round++) {
        await withScenario(
          [{ identifier: '01', capacity: 4 }],
          6,
          async (s) => {
            const service = buildService();

            const outcomes = await Promise.all(
              s.dinerIds.map((id) => attempt(service, id, s.restaurantId, 2)),
            );

            expect(successes(outcomes)).toHaveLength(1);
            expect(new Set(failureCodes(outcomes))).toEqual(
              new Set(['NO_TABLE_AVAILABLE']),
            );
            await expectConsistent(s, 1);
          },
        );
      }
    });
  });

  describe('2. varias mesas libres', () => {
    const THREE = [
      { identifier: '01', capacity: 2 },
      { identifier: '02', capacity: 4 },
      { identifier: '03', capacity: 6 },
    ];

    it('3 mesas y 3 comensales a la vez: cada uno recibe una mesa distinta', () =>
      withScenario(THREE, 3, async (s) => {
        const service = buildService();

        const outcomes = await Promise.all(
          s.dinerIds.map((id) => attempt(service, id, s.restaurantId, 2)),
        );

        expect(failureCodes(outcomes)).toEqual([]);
        const tables = successes(outcomes).map((o) => (o.ok ? o.table : ''));
        expect(new Set(tables)).toEqual(new Set(['01', '02', '03']));
        await expectConsistent(s, 3);
      }));

    it('3 mesas y 5 comensales a la vez: 3 éxitos y 2 NO_TABLE_AVAILABLE', () =>
      withScenario(THREE, 5, async (s) => {
        const service = buildService();

        const outcomes = await Promise.all(
          s.dinerIds.map((id) => attempt(service, id, s.restaurantId, 2)),
        );

        expect(successes(outcomes)).toHaveLength(3);
        expect(failureCodes(outcomes)).toEqual([
          'NO_TABLE_AVAILABLE',
          'NO_TABLE_AVAILABLE',
        ]);
        await expectConsistent(s, 3);
      }));

    it('3 mesas de la MISMA capacidad y 3 comensales a la vez: 3 mesas distintas, ninguno recibe NO_TABLE_AVAILABLE por error', async () => {
      for (let round = 0; round < 5; round++) {
        await withScenario(
          [
            { identifier: '01', capacity: 4 },
            { identifier: '02', capacity: 4 },
            { identifier: '03', capacity: 4 },
          ],
          3,
          async (s) => {
            const service = buildService();

            const outcomes = await Promise.all(
              s.dinerIds.map((id) => attempt(service, id, s.restaurantId, 4)),
            );

            expect(failureCodes(outcomes)).toEqual([]);
            expect(
              new Set(successes(outcomes).map((o) => (o.ok ? o.table : ''))),
            ).toEqual(new Set(['01', '02', '03']));
            await expectConsistent(s, 3);
          },
        );
      }
    });
  });

  describe('3. el mismo comensal lanza varias solicitudes a la vez', () => {
    it('3 solicitudes con 4 mesas libres: 1 éxito, 2 ACTIVE_RESERVATION_EXISTS y ninguna mesa reserved sin reserva', async () => {
      for (let round = 0; round < 3; round++) {
        await withScenario(
          [
            { identifier: '01', capacity: 4 },
            { identifier: '02', capacity: 4 },
            { identifier: '03', capacity: 4 },
            { identifier: '04', capacity: 4 },
          ],
          1,
          async (s) => {
            const service = buildService();
            const [diner] = s.dinerIds;

            const outcomes = await Promise.all(
              [1, 2, 3].map(() => attempt(service, diner, s.restaurantId, 2)),
            );

            expect(successes(outcomes)).toHaveLength(1);
            expect(failureCodes(outcomes)).toEqual([
              'ACTIVE_RESERVATION_EXISTS',
              'ACTIVE_RESERVATION_EXISTS',
            ]);
            await expectConsistent(s, 1);
          },
        );
      }
    });
  });

  describe('4 y 5. reglas de asignación con la base real', () => {
    it('asigna la mesa más pequeña que alcanza (2, 4 y 8 pidiendo 3 personas: la de 4)', () =>
      withScenario(
        [
          { identifier: '01', capacity: 8 },
          { identifier: '02', capacity: 2 },
          { identifier: '03', capacity: 4 },
        ],
        1,
        async (s) => {
          const outcome = await attempt(
            buildService(),
            s.dinerIds[0],
            s.restaurantId,
            3,
          );

          expect(outcome).toEqual({ ok: true, table: '03' });
          const state = await expectConsistent(s, 1);
          expect(state.tables.get('03')).toBe('reserved');
          expect(state.tables.get('01')).toBe('available');
          expect(state.tables.get('02')).toBe('available');
        },
      ));

    it('una mesa reserved a mano nunca se asigna', () =>
      withScenario(
        [
          { identifier: '01', capacity: 2, status: 'reserved' },
          { identifier: '02', capacity: 4 },
        ],
        2,
        async (s) => {
          const service = buildService();

          const first = await attempt(
            service,
            s.dinerIds[0],
            s.restaurantId,
            2,
          );
          const second = await attempt(
            service,
            s.dinerIds[1],
            s.restaurantId,
            2,
          );

          // La de 2 está reserved a mano: solo se puede dar la de 4, una vez.
          expect(first).toEqual({ ok: true, table: '02' });
          expect(second).toEqual({ ok: false, code: 'NO_TABLE_AVAILABLE' });
          const state = await expectConsistent(s, 1, 1);
          expect(state.tables.get('01')).toBe('reserved');
        },
      ));

    it('las mesas occupied o inactivas tampoco se asignan', () =>
      withScenario(
        [
          { identifier: '01', capacity: 2, status: 'occupied' },
          { identifier: '02', capacity: 2, isActive: false },
        ],
        1,
        async (s) => {
          const outcome = await attempt(
            buildService(),
            s.dinerIds[0],
            s.restaurantId,
            2,
          );

          expect(outcome).toEqual({ ok: false, code: 'NO_TABLE_AVAILABLE' });
          await expectConsistent(s, 0);
        },
      ));
  });

  describe('orden numérico del identificador', () => {
    const TWO_AND_TEN = [
      { identifier: '10', capacity: 4 },
      { identifier: '2', capacity: 4 },
    ];

    it('"2" se asigna antes que "10" (de uno en uno)', () =>
      withScenario(TWO_AND_TEN, 2, async (s) => {
        const service = buildService();

        const first = await attempt(service, s.dinerIds[0], s.restaurantId, 4);
        const second = await attempt(service, s.dinerIds[1], s.restaurantId, 4);

        expect(first).toEqual({ ok: true, table: '2' });
        expect(second).toEqual({ ok: true, table: '10' });
        await expectConsistent(s, 2);
      }));

    it('a la vez, las dos mesas se reparten sin error', () =>
      withScenario(TWO_AND_TEN, 2, async (s) => {
        const service = buildService();

        const outcomes = await Promise.all(
          s.dinerIds.map((id) => attempt(service, id, s.restaurantId, 4)),
        );

        expect(failureCodes(outcomes)).toEqual([]);
        expect(
          new Set(successes(outcomes).map((o) => (o.ok ? o.table : ''))),
        ).toEqual(new Set(['2', '10']));
        await expectConsistent(s, 2);
      }));
  });

  describe('6. atomicidad', () => {
    it('con una bitácora que falla no queda reserva ni mesa cambiada', () =>
      withScenario([{ identifier: '01', capacity: 4 }], 1, async (s) => {
        class FailingLog extends TableStatusLog {
          record(_change: TableStatusChange): Promise<void> {
            return Promise.reject(new Error('bitácora rota a propósito'));
          }
        }
        const service = buildService({ statusLog: new FailingLog() });

        const outcome = await attempt(
          service,
          s.dinerIds[0],
          s.restaurantId,
          2,
        );

        expect(outcome).toEqual({
          ok: false,
          code: 'ERROR: Error: bitácora rota a propósito',
        });
        const state = await expectConsistent(s, 0);
        expect(state.tables.get('01')).toBe('available');
        const [{ count }] = await dataSource.query<{ count: string }[]>(
          `SELECT count(*) FROM reservations WHERE restaurant_id = $1`,
          [s.restaurantId],
        );
        expect(Number(count)).toBe(0);
      }));
  });

  describe('código repetido', () => {
    it('si el código ya está en uso por otra reserva activa, reintenta con otro y termina bien', () =>
      withScenario(
        [
          { identifier: '01', capacity: 4 },
          { identifier: '02', capacity: 4 },
        ],
        2,
        async (s) => {
          // Los dos comensales reciben primero el mismo código: el segundo
          // choca con UQ_reservations_active_code y reintenta con otro.
          const sequence = ['AAAAAA', 'AAAAAA', 'BBBBBB'];
          const codes: CodeGenerator = {
            generate: () => sequence.shift() ?? 'CCCCCC',
          };
          const service = buildService({ codes });

          const first = await attempt(
            service,
            s.dinerIds[0],
            s.restaurantId,
            2,
          );
          const second = await attempt(
            service,
            s.dinerIds[1],
            s.restaurantId,
            2,
          );

          expect(first.ok).toBe(true);
          expect(second.ok).toBe(true);
          await expectConsistent(s, 2);
          const rows = await dataSource.query<{ code: string }[]>(
            `SELECT code FROM reservations WHERE restaurant_id = $1 ORDER BY code`,
            [s.restaurantId],
          );
          expect(rows.map((row) => row.code)).toEqual(['AAAAAA', 'BBBBBB']);
        },
      ));
  });
});
