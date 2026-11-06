import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity-access/index.js';
import { User } from '../../src/modules/identity-access/users/user.entity.js';
import { UsersService } from '../../src/modules/identity-access/users/users.service.js';
import { CheckInService } from '../../src/modules/reservations-checkin/check-ins/check-in.service.js';
import { ReservationLabelsReader } from '../../src/modules/reservations-checkin/check-ins/reservation-labels.reader.js';
import { RestaurantReservationsService } from '../../src/modules/reservations-checkin/check-ins/restaurant-reservations.service.js';
import { RandomCodeGenerator } from '../../src/modules/reservations-checkin/reservations/reservation-code.js';
import { ReservationCancellationService } from '../../src/modules/reservations-checkin/reservations/reservation-cancellation.service.js';
import { ReservationExpirationService } from '../../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { ReservationViewReader } from '../../src/modules/reservations-checkin/reservations/reservation-view.reader.js';
import { DbTableStatusLog } from '../../src/modules/restaurant-operations/table-logs/table-logs.recorder.js';
import type { Clock } from '../../src/modules/search-availability/index.js';
import {
  closeTestDataSource,
  openTestDataSource,
  withScenario as withSharedScenario,
  type Scenario,
  type TableSeed,
} from './support/scenario.js';

// Check-in y lista de reservas del restaurante (Sprint 3, tarea 7; CLAUDE.md
// §12.3 y §12.6) contra Postgres REAL, con los servicios reales. Commits reales
// (sin ROLLBACK): cada prueba crea sus datos con ids únicos y borra SOLO lo que
// creó, en orden de FK, aunque falle (ver support/scenario.ts).

// Viernes 2026-11-06 12:00 en Bogotá. El barrido global de auto-expiry corre con
// el reloj en 2020 y en otro archivo (fileParallelism: false): no toca estos datos.
const NOW = new Date('2026-11-06T17:00:00Z');
const CLOCK = { now: () => NOW } as Clock;
// Un segundo atrás: para las carreras, la reserva sigue viva para este reloj.
const BEHIND = { now: () => new Date(NOW.getTime() - 1000) } as Clock;
const DUE = new Date(NOW.getTime() - 60_000);
const NOT_DUE = new Date(NOW.getTime() + 10 * 60_000);

// Las carreras hacen muchas consultas contra una base remota.
const RACE_TIMEOUT_MS = 180_000;
const RACE_ROUNDS = 12;
// Desfase en ms del segundo competidor una vez los dos llegan a la barrera, para
// recorrer los entrelazados de los dos lados y no solo el más probable.
const RACE_OFFSETS_MS = [-30, -15, -5, 0, 0, 5, 15, 30];

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

function buildServices(clock: Clock = CLOCK, source: DataSource = dataSource) {
  const statusLog = new DbTableStatusLog();
  const events = new EventEmitter2();
  const expiration = new ReservationExpirationService(
    dataSource,
    statusLog,
    events,
    clock,
  );
  const labels = new ReservationLabelsReader(
    dataSource,
    new UsersService(dataSource.getRepository(User)),
  );
  return {
    checkIns: new CheckInService(source, expiration, statusLog, labels, clock),
    list: new RestaurantReservationsService(
      dataSource,
      expiration,
      labels,
      clock,
    ),
    cancellation: new ReservationCancellationService(
      source,
      expiration,
      statusLog,
      events,
      new ReservationViewReader(dataSource),
      clock,
    ),
  };
}

const errorCodeOf = (error: unknown) =>
  (error as { response?: { errorCode?: string } }).response?.errorCode;
const errorOf = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Dos competidores: nadie abre su transacción hasta que los dos están listos para
// abrirla. Lanzarlos a la vez no basta: leen y comprueban por caminos de distinto
// largo y uno llegaba siempre primero.
function raceBarrier() {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === 2) {
      open();
    }
    await opened;
  };
}

// El mismo DataSource, pero antes de abrir una transacción ejecuta y espera un gancho.
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

// El gancho de cada competidor: espera la barrera y luego su parte del desfase.
function synchronizedSources(offsetMs: number): [DataSource, DataSource] {
  const barrier = raceBarrier();
  const hooked = (delayMs: number) =>
    withTransactionHook(dataSource, async () => {
      await barrier();
      await sleep(delayMs);
    });
  return [hooked(Math.max(-offsetMs, 0)), hooked(Math.max(offsetMs, 0))];
}

// ----------------------------------------------------------------- datos ----

// El admin es un usuario más del escenario (se borra con él), con su rol real.
// Toma el último de los "comensales" que crea createScenario.
async function adminOf(s: Scenario) {
  const userId = s.dinerIds[s.dinerIds.length - 1];
  await dataSource.query(
    `UPDATE users SET role = 'restaurant_admin', restaurant_id = $2 WHERE id = $1`,
    [userId, s.restaurantId],
  );
  return {
    userId,
    restaurantId: s.restaurantId,
    role: UserRole.RESTAURANT_ADMIN,
  };
}

interface InsertedReservation {
  id: string;
  code: string;
}

async function insertReservation(
  s: Scenario,
  options: {
    dinerId: string;
    tableIdentifier: string;
    status?: string;
    expiresAt: Date;
    code?: string;
    createdAt?: Date;
  },
): Promise<InsertedReservation> {
  // Aleatorio: el código es único entre TODAS las reservas activas de la base.
  const code = options.code ?? new RandomCodeGenerator().generate();
  const [{ id }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at, created_at)
     VALUES ($1, $2, 2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      code,
      options.status ?? 'active',
      options.dinerId,
      s.restaurantId,
      s.tableIds.get(options.tableIdentifier),
      options.expiresAt,
      options.createdAt ?? NOW,
    ],
  );
  return { id, code };
}

interface ReservationRow {
  status: string;
  checked_in_at: Date | null;
  no_show: boolean;
}

async function readReservation(id: string): Promise<ReservationRow> {
  const [row] = await dataSource.query<ReservationRow[]>(
    `SELECT status, checked_in_at, no_show FROM reservations WHERE id = $1`,
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

function readLogs(s: Scenario, identifier: string): Promise<LogRow[]> {
  return dataSource.query<LogRow[]>(
    `SELECT previous_status, new_status, user_id, source FROM table_logs
      WHERE table_id = $1 ORDER BY created_at`,
    [s.tableIds.get(identifier)],
  );
}

interface CheckInRow {
  reservation_id: string;
  restaurant_id: string;
  checked_in_at: Date;
}

function readCheckIns(reservationId: string): Promise<CheckInRow[]> {
  return dataSource.query<CheckInRow[]>(
    `SELECT reservation_id, restaurant_id, checked_in_at FROM check_ins WHERE reservation_id = $1`,
    [reservationId],
  );
}

const RESERVED_TABLE: TableSeed = {
  identifier: '01',
  capacity: 4,
  status: 'reserved',
};

// ----------------------------------------------------------------- casos ----

describe('check-in: Postgres real', () => {
  describe('1. check-in válido', () => {
    it('reserva completed, mesa occupied, UNA bitácora del admin y UNA fila en check_ins con el mismo instante', () =>
      withScenario([RESERVED_TABLE], 2, async (s) => {
        const admin = await adminOf(s);
        const { id, code } = await insertReservation(s, {
          dinerId: s.dinerIds[0],
          tableIdentifier: '01',
          expiresAt: NOT_DUE,
        });
        const { checkIns } = buildServices();

        const response = await checkIns.checkIn(
          admin,
          ` ${code.slice(0, 3).toLowerCase()} ${code.slice(3)} `,
        );

        expect(response).toEqual({
          reservationId: id,
          tableIdentifier: '01',
          partySize: 2,
          dinerName: 'Comensal 1',
          checkedInAt: NOW.toISOString(),
        });
        const row = await readReservation(id);
        expect(row.status).toBe('completed');
        expect(row.checked_in_at?.toISOString()).toBe(NOW.toISOString());
        expect(row.no_show).toBe(false);
        expect(await readTableStatus(s, '01')).toBe('occupied');
        expect(await readLogs(s, '01')).toEqual([
          {
            previous_status: 'reserved',
            new_status: 'occupied',
            user_id: admin.userId,
            source: 'reservation',
          },
        ]);
        const checkInRows = await readCheckIns(id);
        expect(checkInRows).toHaveLength(1);
        expect(checkInRows[0].restaurant_id).toBe(s.restaurantId);
        expect(checkInRows[0].checked_in_at.toISOString()).toBe(
          NOW.toISOString(),
        );
      }));

    it('una mesa cambiada a mano no se pisa: reserva completed y check_ins, sin bitácora', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'occupied' }],
        2,
        async (s) => {
          const admin = await adminOf(s);
          const { id, code } = await insertReservation(s, {
            dinerId: s.dinerIds[0],
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
          });
          const { checkIns } = buildServices();

          await checkIns.checkIn(admin, code);

          expect((await readReservation(id)).status).toBe('completed');
          expect(await readTableStatus(s, '01')).toBe('occupied');
          expect(await readLogs(s, '01')).toEqual([]);
          expect(await readCheckIns(id)).toHaveLength(1);
        },
      ));
  });

  describe('2. check-ins simultáneos del mismo código', () => {
    it('5 a la vez: 1 éxito y 4 RESERVATION_ALREADY_USED, UN check_ins y UNA bitácora', () =>
      withScenario([RESERVED_TABLE], 2, async (s) => {
        const admin = await adminOf(s);
        const { id, code } = await insertReservation(s, {
          dinerId: s.dinerIds[0],
          tableIdentifier: '01',
          expiresAt: NOT_DUE,
        });
        const { checkIns } = buildServices();

        const results = await Promise.allSettled(
          Array.from({ length: 5 }, () => checkIns.checkIn(admin, code)),
        );

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.flatMap((r) =>
          r.status === 'rejected' ? [r.reason] : [],
        );
        expect(fulfilled).toHaveLength(1);
        // Sin errores inesperados (ningún 500): todo lo demás es el 409.
        expect(rejected.map(errorCodeOf)).toEqual(
          Array(4).fill('RESERVATION_ALREADY_USED'),
        );
        expect((await readReservation(id)).status).toBe('completed');
        expect(await readTableStatus(s, '01')).toBe('occupied');
        expect(await readCheckIns(id)).toHaveLength(1);
        expect(await readLogs(s, '01')).toHaveLength(1);
      }));
  });

  describe('3. carreras', () => {
    it(
      'check-in contra cancelar: un único estado final, una bitácora y check_ins solo si ganó el check-in',
      async () => {
        let checkInWins = 0;
        let cancelWins = 0;
        for (let round = 0; round < RACE_ROUNDS; round++) {
          await withScenario([RESERVED_TABLE], 2, async (s) => {
            const admin = await adminOf(s);
            const [diner] = s.dinerIds;
            const { id, code } = await insertReservation(s, {
              dinerId: diner,
              tableIdentifier: '01',
              expiresAt: NOT_DUE,
            });
            const [checkInSource, cancelSource] = synchronizedSources(
              RACE_OFFSETS_MS[round % RACE_OFFSETS_MS.length],
            );

            const [checkIn, cancel] = await Promise.allSettled([
              buildServices(CLOCK, checkInSource).checkIns.checkIn(admin, code),
              buildServices(CLOCK, cancelSource).cancellation.cancel(
                { userId: diner, restaurantId: null, role: UserRole.DINER },
                id,
              ),
            ]);

            const row = await readReservation(id);
            const logs = await readLogs(s, '01');
            const checkInRows = await readCheckIns(id);
            expect(logs).toHaveLength(1);
            if (row.status === 'completed') {
              checkInWins++;
              expect(checkIn.status).toBe('fulfilled');
              expect(cancel.status).toBe('rejected');
              expect(
                errorCodeOf((cancel as PromiseRejectedResult).reason),
              ).toBe('RESERVATION_NOT_ACTIVE');
              expect(await readTableStatus(s, '01')).toBe('occupied');
              expect(checkInRows).toHaveLength(1);
              expect(logs[0]).toMatchObject({
                new_status: 'occupied',
                user_id: admin.userId,
              });
            } else {
              cancelWins++;
              expect(row.status).toBe('cancelled');
              expect(cancel.status).toBe('fulfilled');
              expect(checkIn.status).toBe('rejected');
              expect(
                errorCodeOf((checkIn as PromiseRejectedResult).reason),
              ).toBe('RESERVATION_CANCELLED');
              expect(await readTableStatus(s, '01')).toBe('available');
              expect(checkInRows).toEqual([]);
              expect(logs[0]).toMatchObject({
                new_status: 'available',
                user_id: diner,
              });
            }
          });
        }
        process.stdout.write(
          `[carrera check-in vs cancelar] rondas=${RACE_ROUNDS} check-in=${checkInWins} cancelar=${cancelWins}\n`,
        );
        expect(checkInWins + cancelWins).toBe(RACE_ROUNDS);
      },
      RACE_TIMEOUT_MS,
    );

    // La reserva vence justo en el límite: viva para el reloj del check-in (1 s
    // atrás) y vencida para el del barrido. Los dos UPDATE pueden aplicarse y
    // decide el bloqueo de la fila.
    it(
      'check-in contra vencer: un único estado final, una bitácora y check_ins solo si ganó el check-in',
      async () => {
        let checkInWins = 0;
        let expireWins = 0;
        for (let round = 0; round < RACE_ROUNDS; round++) {
          await withScenario([RESERVED_TABLE], 2, async (s) => {
            const admin = await adminOf(s);
            const { id, code } = await insertReservation(s, {
              dinerId: s.dinerIds[0],
              tableIdentifier: '01',
              expiresAt: NOW,
            });
            const [checkInSource, expireSource] = synchronizedSources(
              RACE_OFFSETS_MS[round % RACE_OFFSETS_MS.length],
            );
            const statusLog = new DbTableStatusLog();
            const expirer = new ReservationExpirationService(
              expireSource,
              statusLog,
              new EventEmitter2(),
              CLOCK,
            );

            const [checkIn, expire] = await Promise.allSettled([
              buildServices(BEHIND, checkInSource).checkIns.checkIn(
                admin,
                code,
              ),
              expirer.expireIfDue(id),
            ]);

            expect(expire.status).toBe('fulfilled');
            const expiredBy = expire.status === 'fulfilled' ? expire.value : -1;
            const row = await readReservation(id);
            const logs = await readLogs(s, '01');
            const checkInRows = await readCheckIns(id);
            expect(logs).toHaveLength(1);
            if (row.status === 'completed') {
              checkInWins++;
              expect(checkIn.status).toBe('fulfilled');
              expect(expiredBy).toBe(0);
              expect(row.no_show).toBe(false);
              expect(await readTableStatus(s, '01')).toBe('occupied');
              expect(checkInRows).toHaveLength(1);
              expect(logs[0]).toMatchObject({ source: 'reservation' });
            } else {
              expireWins++;
              expect(row.status).toBe('expired');
              expect(expiredBy).toBe(1);
              expect(row.no_show).toBe(true);
              expect(checkIn.status).toBe('rejected');
              expect(
                errorCodeOf((checkIn as PromiseRejectedResult).reason),
              ).toBe('RESERVATION_EXPIRED');
              expect(await readTableStatus(s, '01')).toBe('available');
              expect(checkInRows).toEqual([]);
              expect(logs[0]).toMatchObject({
                source: 'system',
                user_id: null,
              });
            }
          });
        }
        process.stdout.write(
          `[carrera check-in vs vencer] rondas=${RACE_ROUNDS} check-in=${checkInWins} vencer=${expireWins}\n`,
        );
        expect(checkInWins + expireWins).toBe(RACE_ROUNDS);
      },
      RACE_TIMEOUT_MS,
    );
  });

  describe('4. código de otro restaurante', () => {
    it('404 idéntico al de un código inexistente y nada cambia, aunque la reserva ajena ya hubiera vencido', () =>
      withScenario([RESERVED_TABLE], 1, async (foreign) => {
        const { id, code } = await insertReservation(foreign, {
          dinerId: foreign.dinerIds[0],
          tableIdentifier: '01',
          expiresAt: DUE,
        });
        await withScenario([], 1, async (own) => {
          const admin = await adminOf(own);
          const { checkIns } = buildServices();

          const ofOther = await errorOf(checkIns.checkIn(admin, code));
          const unknown = await errorOf(checkIns.checkIn(admin, '222222'));

          expect(errorCodeOf(ofOther)).toBe('RESERVATION_CODE_NOT_FOUND');
          expect(unknown).toEqual(ofOther);
          expect((await readReservation(id)).status).toBe('active');
          expect(await readTableStatus(foreign, '01')).toBe('reserved');
          expect(await readLogs(foreign, '01')).toEqual([]);
          expect(await readCheckIns(id)).toEqual([]);
        });
      }));
  });

  describe('5. reserva activa ya vencida sin barrer', () => {
    it('responde RESERVATION_EXPIRED con la hora de expires_at, queda expired y la mesa available', () =>
      withScenario([RESERVED_TABLE], 2, async (s) => {
        const admin = await adminOf(s);
        const { id, code } = await insertReservation(s, {
          dinerId: s.dinerIds[0],
          tableIdentifier: '01',
          expiresAt: DUE,
        });
        const { checkIns } = buildServices();

        const error = await errorOf(checkIns.checkIn(admin, code));

        expect(errorCodeOf(error)).toBe('RESERVATION_EXPIRED');
        // DUE = 16:59Z = 11:59 en Bogotá.
        expect((error as Error).message).toBe(
          'Esta reserva se venció a las 11:59. La mesa ya se liberó.',
        );
        const row = await readReservation(id);
        expect(row.status).toBe('expired');
        expect(row.no_show).toBe(true);
        expect(row.checked_in_at).toBeNull();
        expect(await readTableStatus(s, '01')).toBe('available');
        expect(await readLogs(s, '01')).toEqual([
          {
            previous_status: 'reserved',
            new_status: 'available',
            user_id: null,
            source: 'system',
          },
        ]);
        expect(await readCheckIns(id)).toEqual([]);
      }));
  });

  describe('6. lista del restaurante', () => {
    it('solo las suyas, ordenadas por vencimiento, sin código, y vence las debidas antes de responder', () =>
      withScenario([RESERVED_TABLE], 1, async (foreign) => {
        const foreignActive = await insertReservation(foreign, {
          dinerId: foreign.dinerIds[0],
          tableIdentifier: '01',
          expiresAt: DUE,
        });
        await withScenario(
          [
            { identifier: '01', capacity: 4, status: 'reserved' },
            { identifier: '02', capacity: 4, status: 'reserved' },
            { identifier: '03', capacity: 4, status: 'reserved' },
          ],
          4,
          async (s) => {
            const admin = await adminOf(s);
            const later = await insertReservation(s, {
              dinerId: s.dinerIds[0],
              tableIdentifier: '01',
              expiresAt: new Date(NOW.getTime() + 10 * 60_000),
            });
            const sooner = await insertReservation(s, {
              dinerId: s.dinerIds[1],
              tableIdentifier: '02',
              expiresAt: new Date(NOW.getTime() + 2 * 60_000),
            });
            const due = await insertReservation(s, {
              dinerId: s.dinerIds[2],
              tableIdentifier: '03',
              expiresAt: DUE,
            });
            const { list } = buildServices();

            const active = await list.list(admin);

            expect(active.map((r) => r.id)).toEqual([sooner.id, later.id]);
            expect(active.map((r) => r.tableIdentifier)).toEqual(['02', '01']);
            expect(active.map((r) => r.dinerName)).toEqual([
              'Comensal 2',
              'Comensal 1',
            ]);
            expect(new Set(active.map((r) => r.serverTime))).toEqual(
              new Set([NOW.toISOString()]),
            );
            const json = JSON.stringify(active);
            expect(json).not.toContain('"code"');
            expect(json).not.toContain(sooner.code);
            expect(json).not.toContain(later.code);

            // La debida ya se venció, con su mesa libre.
            expect((await readReservation(due.id)).status).toBe('expired');
            expect(await readTableStatus(s, '03')).toBe('available');
            const expired = await list.list(admin, 'expired');
            expect(expired.map((r) => r.id)).toEqual([due.id]);

            // La de otro restaurante ni aparece ni se vence.
            expect(JSON.stringify([...active, ...expired])).not.toContain(
              foreignActive.id,
            );
            expect((await readReservation(foreignActive.id)).status).toBe(
              'active',
            );
          },
        );
      }));
  });

  describe('dinerName nunca revela el correo (§12.8)', () => {
    // Los correos del escenario son db-test-<uuid>@example.com.
    const expectNoEmail = (body: unknown) => {
      const json = JSON.stringify(body);
      expect(json).not.toContain('db-test');
      expect(json).not.toContain('example.com');
    };

    it.each([
      ['NULL', `NULL`],
      [
        'igual al correo antes de @ (el valor por defecto de POST /diners/me)',
        `split_part(email, '@', 1)`,
      ],
    ])(
      'con display_name %s: null en la lista y en el check-in',
      (_case, value) =>
        withScenario([RESERVED_TABLE], 2, async (s) => {
          const admin = await adminOf(s);
          const [diner] = s.dinerIds;
          await dataSource.query(
            `UPDATE users SET display_name = ${value} WHERE id = $1`,
            [diner],
          );
          const { code } = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
          });
          const { checkIns, list } = buildServices();

          const reservations = await list.list(admin);
          const response = await checkIns.checkIn(admin, code);

          expect(reservations.map((r) => r.dinerName)).toEqual([null]);
          expect(response.dinerName).toBeNull();
          expectNoEmail(reservations);
          expectNoEmail(response);
        }),
    );
  });

  describe('7. código reutilizado', () => {
    it('con una completed vieja y una active nueva del mismo código, se cumple la nueva', () =>
      withScenario(
        [
          { identifier: '01', capacity: 4, status: 'occupied' },
          { identifier: '02', capacity: 4, status: 'reserved' },
        ],
        3,
        async (s) => {
          const admin = await adminOf(s);
          const code = new RandomCodeGenerator().generate();
          const old = await insertReservation(s, {
            dinerId: s.dinerIds[0],
            tableIdentifier: '01',
            status: 'completed',
            code,
            expiresAt: new Date(NOW.getTime() - 3_600_000),
            createdAt: new Date(NOW.getTime() - 4_000_000),
          });
          const current = await insertReservation(s, {
            dinerId: s.dinerIds[1],
            tableIdentifier: '02',
            code,
            expiresAt: NOT_DUE,
          });
          const { checkIns } = buildServices();

          const response = await checkIns.checkIn(admin, code);

          expect(response.reservationId).toBe(current.id);
          expect(await readReservation(current.id)).toMatchObject({
            status: 'completed',
          });
          expect(await readCheckIns(current.id)).toHaveLength(1);
          expect(await readCheckIns(old.id)).toEqual([]);
          expect(await readTableStatus(s, '02')).toBe('occupied');
        },
      ));
  });
});
