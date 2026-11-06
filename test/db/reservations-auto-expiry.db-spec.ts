import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity-access/index.js';
import { CreateReservationService } from '../../src/modules/reservations-checkin/reservations/create-reservation.service.js';
import { ReservationCancellationService } from '../../src/modules/reservations-checkin/reservations/reservation-cancellation.service.js';
import { RandomCodeGenerator } from '../../src/modules/reservations-checkin/reservations/reservation-code.js';
import { ReservationExpirationService } from '../../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { ReservationExpiryScheduler } from '../../src/modules/reservations-checkin/reservations/reservation-expiry.scheduler.js';
import { ReservationQueryService } from '../../src/modules/reservations-checkin/reservations/reservation-query.service.js';
import { ReservationViewReader } from '../../src/modules/reservations-checkin/reservations/reservation-view.reader.js';
import { DbTableStatusLog } from '../../src/modules/restaurant-operations/table-logs/table-logs.recorder.js';
import {
  AvailabilityService,
  type Clock,
} from '../../src/modules/search-availability/index.js';
import {
  closeTestDataSource,
  openTestDataSource,
  withScenario as withSharedScenario,
  type Scenario,
  type TableSeed,
} from './support/scenario.js';

// El barrido de reservas vencidas (Sprint 3, tarea 6; CLAUDE.md §12.5) contra
// Postgres REAL, con los servicios reales. Commits reales (sin ROLLBACK): cada
// prueba crea sus datos y borra SOLO lo que creó (ver support/scenario.ts).
//
// expireAllDue es GLOBAL: vence todo lo debido en la base. Por eso el reloj de
// esta suite está en 2020: solo son debidas las reservas con expires_at anterior
// a esa fecha, es decir, las que crea esta suite. Con el reloj real o con el de
// las otras suites vencería reservas ajenas de la rama de pruebas.
const NOW = new Date('2020-03-06T17:00:00Z'); // viernes, 12:00 en Bogotá
const CLOCK = { now: () => NOW } as Clock;
const DUE = new Date(NOW.getTime() - 60_000);
const NOT_DUE = new Date(NOW.getTime() + 10 * 60_000);

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await openTestDataSource();
});

afterAll(async () => {
  await closeTestDataSource(dataSource);
});

const withScenario = (
  tables: TableSeed[],
  dinerCount: number,
  work: (scenario: Scenario) => Promise<void>,
) => withSharedScenario(dataSource, tables, dinerCount, work);

// ------------------------------------------------------------- servicios ----

function buildServices(clock: Clock = CLOCK) {
  const statusLog = new DbTableStatusLog();
  const events = new EventEmitter2();
  const expiration = new ReservationExpirationService(
    dataSource,
    statusLog,
    events,
    clock,
  );
  const view = new ReservationViewReader(dataSource);
  return {
    expiration,
    events,
    cancellation: new ReservationCancellationService(
      dataSource,
      expiration,
      statusLog,
      events,
      view,
      clock,
    ),
    queries: new ReservationQueryService(dataSource, expiration, view, clock),
    creation: new CreateReservationService(
      dataSource,
      new AvailabilityService(dataSource, clock),
      statusLog,
      events,
      clock,
      new RandomCodeGenerator(),
      { ttlMinutes: 15 },
      expiration,
    ),
  };
}

const asDiner = (userId: string) => ({
  userId,
  restaurantId: null,
  role: UserRole.DINER,
});

const errorCodeOf = (error: unknown) =>
  (error as { response?: { errorCode?: string } }).response?.errorCode;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ----------------------------------------------------------------- datos ----

async function insertReservation(
  scenario: Scenario,
  options: { dinerId: string; tableIdentifier: string; expiresAt: Date },
): Promise<string> {
  const [{ id }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
     VALUES ($1, 'active', 2, $2, $3, $4, $5) RETURNING id`,
    [
      new RandomCodeGenerator().generate(),
      options.dinerId,
      scenario.restaurantId,
      scenario.tableIds.get(options.tableIdentifier),
      options.expiresAt,
    ],
  );
  return id;
}

interface ReservationRow {
  status: string;
  no_show: boolean;
  expired_at: Date | null;
}

async function readReservation(id: string): Promise<ReservationRow> {
  const [row] = await dataSource.query<ReservationRow[]>(
    `SELECT status, no_show, expired_at FROM reservations WHERE id = $1`,
    [id],
  );
  return row;
}

async function readTableStatus(
  scenario: Scenario,
  identifier: string,
): Promise<string> {
  const [row] = await dataSource.query<{ status: string }[]>(
    `SELECT status FROM tables WHERE id = $1`,
    [scenario.tableIds.get(identifier)],
  );
  return row.status;
}

interface LogRow {
  previous_status: string;
  new_status: string;
  user_id: string | null;
  source: string;
}

async function readLogs(
  scenario: Scenario,
  identifier: string,
): Promise<LogRow[]> {
  return dataSource.query<LogRow[]>(
    `SELECT previous_status, new_status, user_id, source FROM table_logs
      WHERE table_id = $1 ORDER BY changed_at, created_at`,
    [scenario.tableIds.get(identifier)],
  );
}

const SYSTEM_RELEASE: LogRow = {
  previous_status: 'reserved',
  new_status: 'available',
  user_id: null,
  source: 'system',
};

// Un escenario con n mesas reservadas, n comensales y n reservas debidas: una sola
// sentencia por tabla, para no hacer cientos de viajes a la base. Lo creado queda
// en el escenario, así que withScenario lo borra igual que lo demás.
async function bulkDueReservations(
  scenario: Scenario,
  count: number,
): Promise<void> {
  const tables = await dataSource.query<{ id: string }[]>(
    `INSERT INTO tables (restaurant_id, identifier, capacity, status, is_active)
     SELECT $1, 'B' || n, 4, 'reserved', true FROM generate_series(1, $2::int) AS n
     RETURNING id`,
    [scenario.restaurantId, count],
  );
  const diners = await dataSource.query<{ id: string }[]>(
    `INSERT INTO users (email, role, display_name)
     SELECT 'db-test-' || gen_random_uuid() || '@example.com', 'diner', 'Comensal'
       FROM generate_series(1, $1::int)
     RETURNING id`,
    [count],
  );
  scenario.dinerIds.push(...diners.map(({ id }) => id));
  const generator = new RandomCodeGenerator();
  await dataSource.query(
    `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
     SELECT code, 'active', 2, diner, $1, tbl, $2
       FROM unnest($3::text[], $4::uuid[], $5::uuid[]) AS row(code, diner, tbl)`,
    [
      scenario.restaurantId,
      DUE,
      Array.from({ length: count }, () => generator.generate()),
      diners.map(({ id }) => id),
      tables.map(({ id }) => id),
    ],
  );
}

// ----------------------------------------------------------------- casos ----

describe('barrido de reservas vencidas: Postgres real', () => {
  describe('1. un barrido sobre varios restaurantes y mesas', () => {
    it('vence todas las debidas, con una bitácora system por mesa, y no toca las vigentes', () =>
      withScenario(
        [
          { identifier: '01', capacity: 4, status: 'reserved' },
          { identifier: '02', capacity: 4, status: 'reserved' },
          { identifier: '03', capacity: 4, status: 'reserved' },
        ],
        3,
        (first) =>
          withScenario(
            [
              { identifier: '01', capacity: 2, status: 'reserved' },
              { identifier: '02', capacity: 2, status: 'reserved' },
            ],
            2,
            async (second) => {
              const due = [
                await insertReservation(first, {
                  dinerId: first.dinerIds[0],
                  tableIdentifier: '01',
                  expiresAt: DUE,
                }),
                await insertReservation(first, {
                  dinerId: first.dinerIds[1],
                  tableIdentifier: '02',
                  expiresAt: DUE,
                }),
                await insertReservation(second, {
                  dinerId: second.dinerIds[0],
                  tableIdentifier: '01',
                  expiresAt: DUE,
                }),
              ];
              const current = [
                await insertReservation(first, {
                  dinerId: first.dinerIds[2],
                  tableIdentifier: '03',
                  expiresAt: NOT_DUE,
                }),
                await insertReservation(second, {
                  dinerId: second.dinerIds[1],
                  tableIdentifier: '02',
                  expiresAt: NOT_DUE,
                }),
              ];
              const { expiration, events } = buildServices();
              const emit = vi.spyOn(events, 'emit');

              const expired = await expiration.expireAllDue();

              expect(expired).toBe(3);
              for (const id of due) {
                const row = await readReservation(id);
                expect(row.status).toBe('expired');
                expect(row.no_show).toBe(true);
                expect(row.expired_at?.toISOString()).toBe(NOW.toISOString());
              }
              expect(await readTableStatus(first, '01')).toBe('available');
              expect(await readTableStatus(first, '02')).toBe('available');
              expect(await readTableStatus(second, '01')).toBe('available');
              expect(await readLogs(first, '01')).toEqual([SYSTEM_RELEASE]);
              expect(await readLogs(first, '02')).toEqual([SYSTEM_RELEASE]);
              expect(await readLogs(second, '01')).toEqual([SYSTEM_RELEASE]);

              for (const id of current) {
                const row = await readReservation(id);
                expect(row.status).toBe('active');
                expect(row.no_show).toBe(false);
                expect(row.expired_at).toBeNull();
              }
              expect(await readTableStatus(first, '03')).toBe('reserved');
              expect(await readTableStatus(second, '02')).toBe('reserved');
              expect(await readLogs(first, '03')).toEqual([]);
              expect(await readLogs(second, '02')).toEqual([]);

              // Un evento por restaurante, no por mesa.
              const notified = emit.mock.calls.map(
                ([, event]) => (event as { restaurantId: string }).restaurantId,
              );
              expect(notified.sort()).toEqual(
                [first.restaurantId, second.restaurantId].sort(),
              );
            },
          ),
      ));
  });

  describe('2. recuperación tras un reinicio', () => {
    it('arrancar el scheduler vence lo que quedó pendiente, sin que nadie lea la reserva', () =>
      withScenario(
        [
          { identifier: '01', capacity: 4, status: 'reserved' },
          { identifier: '02', capacity: 4, status: 'reserved' },
        ],
        2,
        async (s) => {
          const ids = [
            await insertReservation(s, {
              dinerId: s.dinerIds[0],
              tableIdentifier: '01',
              expiresAt: DUE,
            }),
            await insertReservation(s, {
              dinerId: s.dinerIds[1],
              tableIdentifier: '02',
              expiresAt: DUE,
            }),
          ];
          const scheduler = new ReservationExpiryScheduler(
            buildServices().expiration,
            // Un intervalo que no llega a pasar: solo cuenta el barrido inicial.
            { enabled: true, intervalMs: 3_600_000 },
          );

          scheduler.onApplicationBootstrap();
          // El apagado espera la ejecución en curso: aquí, el barrido inicial.
          await scheduler.beforeApplicationShutdown();

          for (const id of ids) {
            expect((await readReservation(id)).status).toBe('expired');
          }
          expect(await readTableStatus(s, '01')).toBe('available');
          expect(await readTableStatus(s, '02')).toBe('available');
        },
      ));
  });

  describe('3. dos barridos simultáneos (dos instancias)', () => {
    it('varias rondas: cada reserva se vence una vez, sin doble bitácora ni error', async () => {
      const COUNT = 5;
      const identifiers = Array.from({ length: COUNT }, (_, i) => `0${i + 1}`);
      for (let round = 0; round < 6; round++) {
        await withScenario(
          identifiers.map((identifier) => ({
            identifier,
            capacity: 4,
            status: 'reserved' as const,
          })),
          COUNT,
          async (s) => {
            const ids: string[] = [];
            for (const [i, identifier] of identifiers.entries()) {
              ids.push(
                await insertReservation(s, {
                  dinerId: s.dinerIds[i],
                  tableIdentifier: identifier,
                  expiresAt: DUE,
                }),
              );
            }

            const counts = await Promise.all([
              buildServices().expiration.expireAllDue(),
              buildServices().expiration.expireAllDue(),
            ]);

            expect(counts[0] + counts[1]).toBe(COUNT);
            for (const id of ids) {
              expect((await readReservation(id)).status).toBe('expired');
            }
            for (const identifier of identifiers) {
              expect(await readLogs(s, identifier)).toEqual([SYSTEM_RELEASE]);
            }
          },
        );
      }
    });
  });

  describe('4. barrido a la vez que una cancelación y una lectura de la misma reserva', () => {
    // Igual que la carrera de cancelar contra vencer: el barrido ve la reserva
    // vencida (reloj en NOW) y el cancelador aún viva (reloj 1 s atrás), así que
    // los dos UPDATE pueden aplicarse y decide el bloqueo de fila. El barrido y la
    // lectura se sueltan cuando la cancelación termina su vencimiento previo, justo
    // antes de abrir su transacción: si salen todos a la vez, gana casi siempre el
    // barrido porque la cancelación hace antes dos viajes a la base.
    it('varias rondas: un único estado final, una sola transición y una sola bitácora', async () => {
      const BEHIND = { now: () => new Date(NOW.getTime() - 1000) } as Clock;
      // Negativo = la cancelación se retrasa; así se recorren los dos órdenes.
      const OFFSETS_MS = [-400, -300, -200, -150, -100, -50, 0, 50];
      const finals = { cancelled: 0, expired: 0 };

      for (const offset of OFFSETS_MS) {
        await withScenario(
          [{ identifier: '01', capacity: 4, status: 'reserved' }],
          1,
          async (s) => {
            const [diner] = s.dinerIds;
            const id = await insertReservation(s, {
              dinerId: diner,
              tableIdentifier: '01',
              expiresAt: NOW,
            });
            const canceller = buildServices(BEHIND);
            const expireFirst = canceller.expiration.expireIfDue.bind(
              canceller.expiration,
            );
            let others:
              | Promise<
                  [PromiseSettledResult<number>, PromiseSettledResult<unknown>]
                >
              | undefined;
            const startOthers = () =>
              Promise.allSettled([
                sleep(Math.max(offset, 0)).then(() =>
                  buildServices().expiration.expireAllDue(),
                ),
                sleep(Math.max(offset, 0)).then(() =>
                  buildServices().queries.findOne(asDiner(diner), id),
                ),
              ]);
            canceller.expiration.expireIfDue = async (reservationId) => {
              const expired = await expireFirst(reservationId);
              others ??= startOthers();
              await sleep(Math.max(-offset, 0));
              return expired;
            };

            const [cancel] = await Promise.allSettled([
              canceller.cancellation.cancel(asDiner(diner), id),
            ]);
            // Si la cancelación no llegó a ese punto, igual se corren los otros.
            const [sweep, read] = await (others ?? startOthers());

            const row = await readReservation(id);
            expect(['cancelled', 'expired']).toContain(row.status);
            expect(row.status).toBe(
              row.no_show && row.expired_at ? 'expired' : 'cancelled',
            );
            finals[row.status as 'cancelled' | 'expired'] += 1;

            expect(sweep.status).toBe('fulfilled');
            expect(read.status).toBe('fulfilled');
            // Lo único que puede rechazar la cancelación es el 409.
            if (cancel.status === 'rejected') {
              expect(errorCodeOf(cancel.reason)).toBe('RESERVATION_NOT_ACTIVE');
              expect(row.status).toBe('expired');
            }
            expect(await readLogs(s, '01')).toHaveLength(1);
            expect(await readTableStatus(s, '01')).toBe('available');
          },
        );
      }
      process.stdout.write(
        `[carrera barrido vs cancelar] rondas=${OFFSETS_MS.length} cancelled=${finals.cancelled} expired=${finals.expired}\n`,
      );
      expect(finals.cancelled + finals.expired).toBe(OFFSETS_MS.length);
    });
  });

  describe('5. lotes', () => {
    it('más reservas que el tamaño del lote se vencen todas en un solo expireAllDue', () =>
      withScenario([], 0, async (s) => {
        const COUNT = 105;
        await bulkDueReservations(s, COUNT);
        const { expiration } = buildServices();

        const transaction = vi.spyOn(dataSource, 'transaction');
        const expired = await expiration.expireAllDue();
        const batches = transaction.mock.calls.length;
        transaction.mockRestore();

        expect(expired).toBe(COUNT);
        // 100 + 5: dos transacciones, una por lote.
        expect(batches).toBe(2);
        const [counts] = await dataSource.query<
          {
            expired: string;
            active: string;
            logs: string;
            available: string;
          }[]
        >(
          `SELECT
             (SELECT count(*) FROM reservations WHERE restaurant_id = $1 AND status = 'expired' AND no_show) AS expired,
             (SELECT count(*) FROM reservations WHERE restaurant_id = $1 AND status = 'active') AS active,
             (SELECT count(*) FROM table_logs l JOIN tables t ON t.id = l.table_id
               WHERE t.restaurant_id = $1 AND l.source = 'system' AND l.user_id IS NULL) AS logs,
             (SELECT count(*) FROM tables WHERE restaurant_id = $1 AND status = 'available') AS available`,
          [s.restaurantId],
        );
        expect(counts).toEqual({
          expired: String(COUNT),
          active: '0',
          logs: String(COUNT),
          available: String(COUNT),
        });
      }));
  });

  describe('6. mesa cambiada a mano antes del barrido', () => {
    it('la reserva queda expired, la mesa occupied no se pisa y no hay bitácora', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'occupied' }],
        1,
        async (s) => {
          const id = await insertReservation(s, {
            dinerId: s.dinerIds[0],
            tableIdentifier: '01',
            expiresAt: DUE,
          });
          const { expiration, events } = buildServices();
          const emit = vi.spyOn(events, 'emit');

          await expect(expiration.expireAllDue()).resolves.toBe(1);

          const row = await readReservation(id);
          expect(row.status).toBe('expired');
          expect(row.no_show).toBe(true);
          expect(await readTableStatus(s, '01')).toBe('occupied');
          expect(await readLogs(s, '01')).toEqual([]);
          expect(emit).not.toHaveBeenCalled();
        },
      ));
  });

  describe('7. restaurante lleno solo por reservas vencidas ajenas', () => {
    it('un comensal nuevo crea su reserva y recibe mesa, sin NO_TABLE_AVAILABLE', () =>
      withScenario(
        [
          { identifier: '01', capacity: 4, status: 'reserved' },
          { identifier: '02', capacity: 4, status: 'reserved' },
        ],
        3,
        async (s) => {
          const [firstDiner, secondDiner, newcomer] = s.dinerIds;
          const stale = [
            await insertReservation(s, {
              dinerId: firstDiner,
              tableIdentifier: '01',
              expiresAt: DUE,
            }),
            await insertReservation(s, {
              dinerId: secondDiner,
              tableIdentifier: '02',
              expiresAt: DUE,
            }),
          ];
          const { creation } = buildServices();

          const created = await creation.create(asDiner(newcomer), {
            restaurantId: s.restaurantId,
            partySize: 2,
          });

          expect(created.status).toBe('active');
          expect(created.table.identifier).toBe('01');
          for (const id of stale) {
            expect((await readReservation(id)).status).toBe('expired');
          }
          expect(await readTableStatus(s, '01')).toBe('reserved');
          expect(await readTableStatus(s, '02')).toBe('available');
        },
      ));
  });

  describe('8. barrido a la vez que creaciones en el mismo restaurante', () => {
    // 3 mesas con reservas vencidas ajenas y 1 libre, y 5 comensales nuevos: todas
    // las mesas quedan libres antes de asignar (cada creación vence las debidas
    // del restaurante), así que exactamente 4 reciben mesa y 1 NO_TABLE_AVAILABLE.
    //
    // Para que la carrera sea real, todas las creaciones se detienen justo antes
    // de vencer las reservas del restaurante y se sueltan juntas, con el barrido
    // desfasado respecto a ellas. Si salen todos a la vez, el barrido gana siempre
    // (medido: venció las 3 en 10 de 10 rondas), porque cada creación hace antes
    // varios viajes a la base. Desfase negativo = el barrido sale primero.
    const OFFSETS_MS = [-100, -60, -40, -30, -20, -10, 0, 10, 30, 200];
    const STALE = ['01', '02', '03'];
    const NEWCOMERS = 5;
    const sweptByRound: number[] = [];

    afterAll(() => {
      process.stdout.write(
        `[carrera barrido vs crear] vencidas por el barrido en cada ronda=${sweptByRound.join(',')}\n`,
      );
    });

    it.each(OFFSETS_MS.map((offset, round) => ({ offset, round: round + 1 })))(
      'ronda $round (desfase $offset ms): sin deadlock ni error inesperado, cada vencida se vence una vez y cada creación recibe mesa o NO_TABLE_AVAILABLE',
      ({ offset }) =>
        withScenario(
          [
            ...STALE.map((identifier) => ({
              identifier,
              capacity: 4,
              status: 'reserved' as const,
            })),
            { identifier: '04', capacity: 4 },
          ],
          STALE.length + NEWCOMERS,
          async (s) => {
            const stale: string[] = [];
            for (const [i, identifier] of STALE.entries()) {
              stale.push(
                await insertReservation(s, {
                  dinerId: s.dinerIds[i],
                  tableIdentifier: identifier,
                  expiresAt: DUE,
                }),
              );
            }
            const newcomers = s.dinerIds.slice(STALE.length);

            // La barrera: cuando llega la última creación, arrancan los dos lados.
            let arrived = 0;
            let release = () => {};
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            let sweeping: Promise<number> | undefined;
            const startRace = () => {
              sweeping = sleep(Math.max(offset, 0)).then(() =>
                buildServices().expiration.expireAllDue(),
              );
              void sleep(Math.max(-offset, 0)).then(release);
            };
            const scopedCounts: number[] = [];
            const creators = newcomers.map(() => buildServices());
            for (const { expiration } of creators) {
              const expireScoped =
                expiration.expireDueForRestaurant.bind(expiration);
              expiration.expireDueForRestaurant = async (restaurantId) => {
                arrived += 1;
                if (arrived === NEWCOMERS) {
                  startRace();
                }
                await gate;
                const expired = await expireScoped(restaurantId);
                scopedCounts.push(expired);
                return expired;
              };
            }

            const creations = await Promise.allSettled(
              creators.map(({ creation }, i) =>
                creation.create(asDiner(newcomers[i]), {
                  restaurantId: s.restaurantId,
                  partySize: 2,
                }),
              ),
            );
            const [sweep] = await Promise.allSettled([sweeping]);

            expect(sweep.status).toBe('fulfilled');
            const swept = sweep.status === 'fulfilled' ? (sweep.value ?? 0) : 0;
            sweptByRound.push(swept);

            const created = creations.filter((r) => r.status === 'fulfilled');
            const rejected = creations.filter((r) => r.status === 'rejected');
            // Cualquier otro error (un deadlock 40P01, por ejemplo) falla aquí.
            expect(rejected.map((r) => errorCodeOf(r.reason))).toEqual([
              'NO_TABLE_AVAILABLE',
            ]);
            expect(created).toHaveLength(4);
            const assigned = created.map((r) => r.value.table.identifier);
            expect(new Set(assigned).size).toBe(4);

            // Cada vencida, una sola vez, la haya vencido quien la haya vencido.
            const total = scopedCounts.reduce((sum, n) => sum + n, swept);
            expect(total).toBe(STALE.length);
            for (const id of stale) {
              expect((await readReservation(id)).status).toBe('expired');
            }
            for (const identifier of STALE) {
              const systemLogs = (await readLogs(s, identifier)).filter(
                ({ source }) => source === 'system',
              );
              expect(systemLogs).toEqual([SYSTEM_RELEASE]);
            }
            const [{ count }] = await dataSource.query<{ count: string }[]>(
              `SELECT count(*) FROM reservations WHERE restaurant_id = $1 AND status = 'active'`,
              [s.restaurantId],
            );
            expect(Number(count)).toBe(4);
          },
        ),
    );
  });
});
