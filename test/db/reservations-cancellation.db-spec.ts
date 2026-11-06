import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity-access/index.js';
import { CreateReservationService } from '../../src/modules/reservations-checkin/reservations/create-reservation.service.js';
import { RandomCodeGenerator } from '../../src/modules/reservations-checkin/reservations/reservation-code.js';
import { ReservationCancellationService } from '../../src/modules/reservations-checkin/reservations/reservation-cancellation.service.js';
import { ReservationExpirationService } from '../../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { ReservationViewReader } from '../../src/modules/reservations-checkin/reservations/reservation-view.reader.js';
import { DbTableStatusLog } from '../../src/modules/restaurant-operations/table-logs/table-logs.recorder.js';
import {
  AvailabilityService,
  type Clock,
} from '../../src/modules/search-availability/index.js';
import {
  closeTestDataSource,
  openTestDataSource,
  reservationLabels,
  withScenario as withSharedScenario,
  type Scenario,
  type TableSeed,
} from './support/scenario.js';

// Cancelación de la microreserva (Sprint 3, tarea 5; CLAUDE.md §12.3 y §12.5)
// contra Postgres REAL, con los servicios reales. Commits reales (sin
// ROLLBACK): cada prueba crea sus datos con ids únicos y borra SOLO lo que creó,
// en orden de FK, aunque falle (ver support/scenario.ts).

// Viernes 2026-11-06 12:00 en Bogotá. Las reservas se insertan relativas a este
// instante fijo.
const NOW = new Date('2026-11-06T17:00:00Z');
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

// clock: el reloj del cancelador y de su vencimiento previo. El resto usa CLOCK.
// cancellationDataSource: solo para la carrera, un DataSource con un gancho en
// transaction() que dispara el vencimiento justo cuando la cancelación abre la suya.
function buildServices(
  clock: Clock = CLOCK,
  cancellationDataSource: DataSource = dataSource,
) {
  const statusLog = new DbTableStatusLog();
  const events = new EventEmitter2();
  const expiration = new ReservationExpirationService(
    dataSource,
    statusLog,
    events,
    clock,
  );
  const cancellation = new ReservationCancellationService(
    cancellationDataSource,
    expiration,
    statusLog,
    events,
    new ReservationViewReader(dataSource),
    clock,
  );
  const creation = new CreateReservationService(
    dataSource,
    new AvailabilityService(dataSource, CLOCK),
    statusLog,
    events,
    CLOCK,
    new RandomCodeGenerator(),
    { ttlMinutes: 15 },
    new ReservationExpirationService(dataSource, statusLog, events, CLOCK),
    reservationLabels(dataSource),
  );
  return { cancellation, creation, expiration, events };
}

const asDiner = (userId: string) => ({
  userId,
  restaurantId: null,
  role: UserRole.DINER,
});

const errorCodeOf = (error: unknown) =>
  (error as { response?: { errorCode?: string } }).response?.errorCode;
const errorOf = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// El mismo DataSource, pero antes de abrir una transacción con él ejecuta (y
// espera) un gancho. Se le pasa solo a la cancelación (su vencimiento previo usa
// el normal), para sincronizar el vencimiento con el momento en que la cancelación
// abre la suya.
function withTransactionHook(
  source: DataSource,
  beforeTransaction: () => Promise<void>,
): DataSource {
  return new Proxy(source, {
    get(target, property) {
      if (property === 'transaction') {
        return async (...args: unknown[]) => {
          await beforeTransaction();
          return (target.transaction as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

// ----------------------------------------------------------------- datos ----

async function insertReservation(
  s: Scenario,
  options: {
    dinerId: string;
    tableIdentifier: string;
    status?: string;
    expiresAt: Date;
  },
): Promise<string> {
  const [{ id }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
     VALUES ($1, $2, 2, $3, $4, $5, $6) RETURNING id`,
    [
      // Aleatorio: el código es único entre TODAS las reservas activas de la base.
      new RandomCodeGenerator().generate(),
      options.status ?? 'active',
      options.dinerId,
      s.restaurantId,
      s.tableIds.get(options.tableIdentifier),
      options.expiresAt,
    ],
  );
  return id;
}

interface ReservationRow {
  status: string;
  no_show: boolean;
  cancelled_at: Date | null;
  expired_at: Date | null;
}

async function readReservation(id: string): Promise<ReservationRow> {
  const [row] = await dataSource.query<ReservationRow[]>(
    `SELECT status, no_show, cancelled_at, expired_at FROM reservations WHERE id = $1`,
    [id],
  );
  return row;
}

async function readTableStatus(s: Scenario, identifier: string) {
  const [row] = await dataSource.query<{ status: string }[]>(
    `SELECT status FROM tables WHERE id = $1`,
    [s.tableIds.get(identifier)],
  );
  return row.status;
}

interface LogRow {
  previous_status: string;
  new_status: string;
  user_id: string | null;
  source: string;
}

async function readLogs(s: Scenario, identifier: string): Promise<LogRow[]> {
  return dataSource.query<LogRow[]>(
    `SELECT previous_status, new_status, user_id, source FROM table_logs
      WHERE table_id = $1 ORDER BY created_at`,
    [s.tableIds.get(identifier)],
  );
}

// ----------------------------------------------------------------- casos ----

describe('cancelación de la reserva: Postgres real', () => {
  describe('1. cancelar libera la mesa', () => {
    it('reserva cancelled con cancelled_at, mesa available y UNA fila de bitácora source reservation del comensal', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        1,
        async (s) => {
          const [diner] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
          });
          const { cancellation } = buildServices();

          const response = await cancellation.cancel(asDiner(diner), id);

          expect(response.status).toBe('cancelled');
          expect(response.code).toBeNull();
          expect(response.cancelledAt).toBe(NOW.toISOString());
          expect(response.expiredAt).toBeNull();
          expect(response.checkedInAt).toBeNull();
          const row = await readReservation(id);
          expect(row.status).toBe('cancelled');
          expect(row.no_show).toBe(false);
          expect(row.cancelled_at?.toISOString()).toBe(NOW.toISOString());
          expect(await readTableStatus(s, '01')).toBe('available');
          expect(await readLogs(s, '01')).toEqual([
            {
              previous_status: 'reserved',
              new_status: 'available',
              user_id: diner,
              source: 'reservation',
            },
          ]);
        },
      ));
  });

  describe('2. cancelaciones simultáneas de la misma reserva', () => {
    it('5 a la vez: exactamente 1 éxito y 4 con 409 RESERVATION_NOT_ACTIVE; una sola bitácora y una sola liberación', async () => {
      for (let round = 0; round < 3; round++) {
        await withScenario(
          [{ identifier: '01', capacity: 4, status: 'reserved' }],
          1,
          async (s) => {
            const [diner] = s.dinerIds;
            const id = await insertReservation(s, {
              dinerId: diner,
              tableIdentifier: '01',
              expiresAt: NOT_DUE,
            });
            const { cancellation } = buildServices();

            const results = await Promise.allSettled(
              Array.from({ length: 5 }, () =>
                cancellation.cancel(asDiner(diner), id),
              ),
            );

            const fulfilled = results.filter((r) => r.status === 'fulfilled');
            const rejected = results.flatMap((r) =>
              r.status === 'rejected' ? [r.reason] : [],
            );
            expect(fulfilled).toHaveLength(1);
            // Sin errores inesperados (ningún 500): todo lo demás es el 409.
            expect(rejected.map(errorCodeOf)).toEqual(
              Array(4).fill('RESERVATION_NOT_ACTIVE'),
            );
            expect((await readReservation(id)).status).toBe('cancelled');
            expect(await readTableStatus(s, '01')).toBe('available');
            expect(await readLogs(s, '01')).toHaveLength(1);
          },
        );
      }
    });
  });

  describe('3. carrera: cancelar contra vencer', () => {
    // Para que la carrera sea real, la reserva vence justo en el límite y los
    // dos relojes la dejan "viva" para uno y "vencida" para el otro: el cancelador
    // ve expires_at > ahora (reloj 1 s atrás) y el vencimiento ve expires_at <=
    // ahora (reloj en NOW). Los dos UPDATE pueden aplicarse; decide el bloqueo
    // de fila. Además el vencimiento se dispara en el momento en que la
    // cancelación abre su transacción (con un retraso distinto en cada ronda):
    // sin eso, la cancelación llega siempre tarde (lee la reserva y hace su
    // vencimiento previo antes de transaccionar) y gana siempre el vencimiento.
    it('varias rondas: una sola transición, una sola bitácora, la mesa available y un único estado final', async () => {
      const BEHIND = { now: () => new Date(NOW.getTime() - 1000) } as Clock;
      const ROUNDS = 16;
      // Desfase del vencimiento respecto a la cancelación, en ms: negativo = el
      // vencimiento se adelanta (la cancelación espera antes de abrir su
      // transacción); positivo = el vencimiento se retrasa. Así se recorren
      // entrelazados de los dos lados y no solo el más probable.
      const OFFSETS_MS = [-80, -40, -20, -10, 0, 10, 20, 40];
      let cancelledCount = 0;
      let expiredCount = 0;

      for (let round = 0; round < ROUNDS; round++) {
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
            const expirer = buildServices(CLOCK).expiration;
            const offset = OFFSETS_MS[round % OFFSETS_MS.length];
            let expiring: Promise<number> | undefined;
            const canceller = buildServices(
              BEHIND,
              withTransactionHook(dataSource, async () => {
                expiring ??= sleep(Math.max(offset, 0)).then(() =>
                  expirer.expireIfDue(id),
                );
                await sleep(Math.max(-offset, 0));
              }),
            ).cancellation;

            const cancel = await Promise.allSettled([
              canceller.cancel(asDiner(diner), id),
            ]).then(([result]) => result);
            // Si la cancelación ni llegó a transaccionar, igual se corre el
            // vencimiento para comprobar el estado final.
            expiring ??= expirer.expireIfDue(id);
            const [expire] = await Promise.allSettled([expiring]);

            const row = await readReservation(id);
            const logs = await readLogs(s, '01');
            // Un único estado final, una única bitácora y la mesa libre.
            expect(['cancelled', 'expired']).toContain(row.status);
            expect(logs).toHaveLength(1);
            expect(await readTableStatus(s, '01')).toBe('available');
            // Ningún 500: lo único que puede rechazar la cancelación es el 409.
            if (cancel.status === 'rejected') {
              expect(errorCodeOf(cancel.reason)).toBe('RESERVATION_NOT_ACTIVE');
            }
            expect(expire.status).toBe('fulfilled');
            const expiredBy = expire.status === 'fulfilled' ? expire.value : -1;

            if (row.status === 'cancelled') {
              cancelledCount++;
              expect(cancel.status).toBe('fulfilled');
              expect(expiredBy).toBe(0);
              expect(row.no_show).toBe(false);
              expect(row.expired_at).toBeNull();
              expect(logs[0]).toMatchObject({
                source: 'reservation',
                user_id: diner,
              });
            } else {
              expiredCount++;
              expect(cancel.status).toBe('rejected');
              expect(expiredBy).toBe(1);
              expect(row.no_show).toBe(true);
              expect(row.cancelled_at).toBeNull();
              expect(logs[0]).toMatchObject({
                source: 'system',
                user_id: null,
              });
            }
          },
        );
      }
      process.stdout.write(
        `[carrera cancelar vs vencer] rondas=${ROUNDS} cancelled=${cancelledCount} expired=${expiredCount}\n`,
      );
    });
  });

  describe('4. reserva de otro comensal', () => {
    it('responde 404 RESERVATION_NOT_FOUND y no cambia nada', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        2,
        async (s) => {
          const [owner, intruder] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: owner,
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
          });
          const { cancellation } = buildServices();

          const error = await errorOf(
            cancellation.cancel(asDiner(intruder), id),
          );

          expect(errorCodeOf(error)).toBe('RESERVATION_NOT_FOUND');
          expect((await readReservation(id)).status).toBe('active');
          expect(await readTableStatus(s, '01')).toBe('reserved');
          expect(await readLogs(s, '01')).toEqual([]);
        },
      ));

    it('el 404 es idéntico al de un id que no existe', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        2,
        async (s) => {
          const [owner, intruder] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: owner,
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
          });
          const { cancellation } = buildServices();

          const ofOther = await errorOf(
            cancellation.cancel(asDiner(intruder), id),
          );
          const unknown = await errorOf(
            cancellation.cancel(
              asDiner(intruder),
              '00000000-0000-4000-8000-000000000000',
            ),
          );

          expect(unknown).toEqual(ofOther);
        },
      ));
  });

  describe('5. reserva activa ya vencida sin barrer', () => {
    it('responde 409, queda expired y la mesa se libera (bitácora del sistema)', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        1,
        async (s) => {
          const [diner] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: DUE,
          });
          const { cancellation } = buildServices();

          const error = await errorOf(cancellation.cancel(asDiner(diner), id));

          expect(errorCodeOf(error)).toBe('RESERVATION_NOT_ACTIVE');
          const row = await readReservation(id);
          expect(row.status).toBe('expired');
          expect(row.no_show).toBe(true);
          expect(row.cancelled_at).toBeNull();
          expect(await readTableStatus(s, '01')).toBe('available');
          expect(await readLogs(s, '01')).toEqual([
            {
              previous_status: 'reserved',
              new_status: 'available',
              user_id: null,
              source: 'system',
            },
          ]);
        },
      ));
  });

  describe('6. la mesa ya no estaba reserved', () => {
    it('la reserva queda cancelled pero la mesa occupied NO se pisa y no hay bitácora', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'occupied' }],
        1,
        async (s) => {
          const [diner] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
          });
          const { cancellation } = buildServices();

          const response = await cancellation.cancel(asDiner(diner), id);

          expect(response.status).toBe('cancelled');
          expect((await readReservation(id)).status).toBe('cancelled');
          expect(await readTableStatus(s, '01')).toBe('occupied');
          expect(await readLogs(s, '01')).toEqual([]);
        },
      ));
  });

  describe('7. después de cancelar', () => {
    it('el mismo comensal puede crear otra reserva y otro comensal puede reservar esa misma mesa', () =>
      withScenario([{ identifier: '01', capacity: 4 }], 2, async (s) => {
        const [first, second] = s.dinerIds;
        const { cancellation, creation } = buildServices();
        const request = { restaurantId: s.restaurantId, partySize: 2 };

        const created = await creation.create(asDiner(first), request);
        await cancellation.cancel(asDiner(first), created.id);

        // Se liberó el índice único parcial por comensal: puede reservar otra vez.
        const again = await creation.create(asDiner(first), request);
        expect(again.status).toBe('active');
        expect(again.id).not.toBe(created.id);
        await cancellation.cancel(asDiner(first), again.id);

        // Y se liberó el de la mesa: otro comensal toma esa misma mesa.
        const other = await creation.create(asDiner(second), request);
        expect(other.status).toBe('active');
        expect(other.table.identifier).toBe('01');
        expect(await readTableStatus(s, '01')).toBe('reserved');
      }));
  });

  describe('8. reservas ya resueltas', () => {
    it.each([
      ['completed', 'occupied'],
      ['cancelled', 'available'],
    ])(
      'una reserva %s responde 409 y no se toca nada (la mesa queda %s)',
      (status, tableStatus) =>
        withScenario(
          [
            {
              identifier: '01',
              capacity: 4,
              status: tableStatus as 'occupied' | 'available',
            },
          ],
          1,
          async (s) => {
            const [diner] = s.dinerIds;
            const id = await insertReservation(s, {
              dinerId: diner,
              tableIdentifier: '01',
              status,
              expiresAt: NOT_DUE,
            });
            const { cancellation } = buildServices();

            const error = await errorOf(
              cancellation.cancel(asDiner(diner), id),
            );

            expect(errorCodeOf(error)).toBe('RESERVATION_NOT_ACTIVE');
            const row = await readReservation(id);
            expect(row.status).toBe(status);
            expect(row.cancelled_at).toBeNull();
            expect(row.expired_at).toBeNull();
            expect(await readTableStatus(s, '01')).toBe(tableStatus);
            expect(await readLogs(s, '01')).toEqual([]);
          },
        ),
    );
  });
});
