import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity-access/index.js';
import { CreateReservationService } from '../../src/modules/reservations-checkin/reservations/create-reservation.service.js';
import { RandomCodeGenerator } from '../../src/modules/reservations-checkin/reservations/reservation-code.js';
import { ReservationExpirationService } from '../../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
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
  reservationLabels,
  withScenario as withSharedScenario,
  type Scenario,
  type TableSeed,
} from './support/scenario.js';

// Vencimiento al leer y al crear (Sprint 3, tarea 3; CLAUDE.md §12.5) contra
// Postgres REAL, con los servicios reales. Commits reales (sin ROLLBACK): cada
// prueba crea sus propios datos con ids únicos y borra SOLO lo que creó, en
// orden de FK, aunque falle (ver support/scenario.ts).

// Viernes 2026-11-06 12:00 en Bogotá. Las reservas "debidas" se insertan con
// expires_at en el pasado respecto de este instante fijo.
const NOW = new Date('2026-11-06T17:00:00Z');
const CLOCK = { now: () => NOW } as Clock;
const DUE = new Date(NOW.getTime() - 60_000);
const NOT_DUE = new Date(NOW.getTime() + 10 * 60_000);

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await openTestDataSource();
});

afterAll(async () => {
  // Espera a las pruebas en curso, borra lo que haya quedado y cierra el pool.
  await closeTestDataSource(dataSource);
});

const withScenario = (
  tables: TableSeed[],
  dinerCount: number,
  work: (scenario: Scenario) => Promise<void>,
) => withSharedScenario(dataSource, tables, dinerCount, work);

// ------------------------------------------------------------- servicios ----

function buildServices() {
  const statusLog = new DbTableStatusLog();
  const events = new EventEmitter2();
  const expiration = new ReservationExpirationService(
    dataSource,
    statusLog,
    events,
    CLOCK,
  );
  const queries = new ReservationQueryService(
    dataSource,
    expiration,
    new ReservationViewReader(dataSource),
    CLOCK,
  );
  const creation = new CreateReservationService(
    dataSource,
    new AvailabilityService(dataSource, CLOCK),
    statusLog,
    events,
    CLOCK,
    new RandomCodeGenerator(),
    { ttlMinutes: 15 },
    expiration,
    reservationLabels(dataSource),
  );
  return { expiration, queries, creation };
}

const asDiner = (userId: string) => ({
  userId,
  restaurantId: null,
  role: UserRole.DINER,
});

// ----------------------------------------------------------------- datos ----

async function insertReservation(
  scenario: Scenario,
  options: {
    dinerId: string;
    tableIdentifier: string;
    status?: string;
    expiresAt: Date;
  },
): Promise<string> {
  const tableId = scenario.tableIds.get(options.tableIdentifier);
  const [{ id }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
     VALUES ($1, $2, 2, $3, $4, $5, $6) RETURNING id`,
    [
      // Aleatorio: el código es único entre TODAS las reservas activas de la base.
      new RandomCodeGenerator().generate(),
      options.status ?? 'active',
      options.dinerId,
      scenario.restaurantId,
      tableId,
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

const errorCodeOf = (error: unknown) =>
  (error as { response?: { errorCode?: string } }).response?.errorCode;

// ----------------------------------------------------------------- casos ----

describe('vencimiento al leer y al crear: Postgres real', () => {
  describe('1. una reserva activa vencida se vence al leerla', () => {
    it('queda expired con no_show y expired_at, la mesa vuelve a available y hay UNA fila de bitácora system sin usuario', () =>
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
          const { queries } = buildServices();

          const response = await queries.findOne(asDiner(diner), id);

          expect(response.status).toBe('expired');
          expect(response.code).toBeNull();
          expect(response.expiredAt).toBe(NOW.toISOString());
          const row = await readReservation(id);
          expect(row.status).toBe('expired');
          expect(row.no_show).toBe(true);
          expect(row.expired_at?.toISOString()).toBe(NOW.toISOString());
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

    it('GET active: una vencida responde reservation null y también libera la mesa', () =>
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
          const { queries } = buildServices();

          const result = await queries.findActive(asDiner(diner));

          expect(result.reservation).toBeNull();
          expect(result.serverTime).toBe(NOW.toISOString());
          expect((await readReservation(id)).status).toBe('expired');
          expect(await readTableStatus(s, '01')).toBe('available');
        },
      ));

    it('una reserva activa vigente no se toca', () =>
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
          const { queries } = buildServices();

          const result = await queries.findActive(asDiner(diner));

          expect(result.reservation?.status).toBe('active');
          expect((await readReservation(id)).status).toBe('active');
          expect(await readTableStatus(s, '01')).toBe('reserved');
          expect(await readLogs(s, '01')).toEqual([]);
        },
      ));
  });

  describe('2. lecturas simultáneas de la misma reserva vencida', () => {
    it('5 lecturas a la vez: una sola transición y una sola bitácora, y todas devuelven expired sin error', async () => {
      for (let round = 0; round < 3; round++) {
        await withScenario(
          [{ identifier: '01', capacity: 4, status: 'reserved' }],
          1,
          async (s) => {
            const [diner] = s.dinerIds;
            const id = await insertReservation(s, {
              dinerId: diner,
              tableIdentifier: '01',
              expiresAt: DUE,
            });
            const { queries } = buildServices();

            const results = await Promise.allSettled(
              Array.from({ length: 5 }, () =>
                queries.findOne(asDiner(diner), id),
              ),
            );

            expect(results.map((r) => r.status)).toEqual(
              Array(5).fill('fulfilled'),
            );
            for (const result of results) {
              expect(result.status === 'fulfilled' && result.value.status).toBe(
                'expired',
              );
            }
            expect((await readReservation(id)).status).toBe('expired');
            expect(await readTableStatus(s, '01')).toBe('available');
            expect(await readLogs(s, '01')).toHaveLength(1);
          },
        );
      }
    });

    it('la suma de reservas vencidas por 5 llamadas simultáneas es exactamente 1', () =>
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
          const { expiration } = buildServices();

          const counts = await Promise.all(
            Array.from({ length: 5 }, () => expiration.expireIfDue(id)),
          );

          expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
          expect(await readLogs(s, '01')).toHaveLength(1);
        },
      ));

    it('lecturas mezcladas (por id y la activa) a la vez tampoco duplican nada', () =>
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
          const { queries } = buildServices();

          const results = await Promise.allSettled([
            queries.findOne(asDiner(diner), id),
            queries.findActive(asDiner(diner)),
            queries.findOne(asDiner(diner), id),
            queries.findActive(asDiner(diner)),
          ]);

          expect(results.map((r) => r.status)).toEqual(
            Array(4).fill('fulfilled'),
          );
          expect(await readLogs(s, '01')).toHaveLength(1);
        },
      ));
  });

  describe('3. la mesa ya no estaba reserved', () => {
    it('la reserva queda expired pero la mesa occupied NO se pisa y no hay bitácora', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'occupied' }],
        1,
        async (s) => {
          const [diner] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: DUE,
          });
          const { queries } = buildServices();

          const response = await queries.findOne(asDiner(diner), id);

          expect(response.status).toBe('expired');
          expect((await readReservation(id)).status).toBe('expired');
          expect(await readTableStatus(s, '01')).toBe('occupied');
          expect(await readLogs(s, '01')).toEqual([]);
        },
      ));

    it('tampoco pisa una mesa que el restaurante ya dejó available', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'available' }],
        1,
        async (s) => {
          const [diner] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: DUE,
          });
          const { queries } = buildServices();

          await queries.findOne(asDiner(diner), id);

          expect(await readTableStatus(s, '01')).toBe('available');
          expect(await readLogs(s, '01')).toEqual([]);
        },
      ));
  });

  describe('4. reservas ya resueltas', () => {
    it.each([
      ['completed', 'occupied'],
      ['cancelled', 'available'],
    ])(
      'una reserva %s con expires_at pasado no se toca (la mesa queda %s)',
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
              expiresAt: DUE,
            });
            const { queries, expiration } = buildServices();

            const response = await queries.findOne(asDiner(diner), id);
            const swept = await expiration.expireIfDue(id);

            expect(response.status).toBe(status);
            expect(swept).toBe(0);
            const row = await readReservation(id);
            expect(row.status).toBe(status);
            expect(row.no_show).toBe(false);
            expect(row.expired_at).toBeNull();
            expect(await readTableStatus(s, '01')).toBe(tableStatus);
            expect(await readLogs(s, '01')).toEqual([]);
          },
        ),
    );
  });

  describe('5. vencer al crear', () => {
    it('un comensal con una reserva vencida sin barrer crea una nueva sin recibir ACTIVE_RESERVATION_EXISTS', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        1,
        async (s) => {
          const [diner] = s.dinerIds;
          const staleId = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: DUE,
          });
          const { creation } = buildServices();

          const created = await creation.create(asDiner(diner), {
            restaurantId: s.restaurantId,
            partySize: 2,
          });

          expect(created.status).toBe('active');
          expect(created.id).not.toBe(staleId);
          expect((await readReservation(staleId)).status).toBe('expired');
          const [{ count }] = await dataSource.query<{ count: string }[]>(
            `SELECT count(*) FROM reservations WHERE diner_id = $1 AND status = 'active'`,
            [diner],
          );
          expect(Number(count)).toBe(1);
          expect(await readTableStatus(s, '01')).toBe('reserved');
          // Primero el vencimiento automático, luego la reserva nueva.
          expect(await readLogs(s, '01')).toEqual([
            {
              previous_status: 'reserved',
              new_status: 'available',
              user_id: null,
              source: 'system',
            },
            {
              previous_status: 'available',
              new_status: 'reserved',
              user_id: diner,
              source: 'reservation',
            },
          ]);
        },
      ));

    it('una reserva activa vigente sigue dando ACTIVE_RESERVATION_EXISTS', () =>
      withScenario(
        [
          { identifier: '01', capacity: 4, status: 'reserved' },
          { identifier: '02', capacity: 4 },
        ],
        1,
        async (s) => {
          const [diner] = s.dinerIds;
          await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
          });
          const { creation } = buildServices();

          const error = await creation
            .create(asDiner(diner), {
              restaurantId: s.restaurantId,
              partySize: 2,
            })
            .catch((e: unknown) => e);

          expect(errorCodeOf(error)).toBe('ACTIVE_RESERVATION_EXISTS');
          expect(await readTableStatus(s, '02')).toBe('available');
        },
      ));
  });

  describe('6. el vencimiento libera el índice único parcial de la mesa', () => {
    it('restaurante lleno solo por una reserva vencida ajena: crear la vence y el comensal nuevo recibe esa mesa', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        2,
        async (s) => {
          const [first, second] = s.dinerIds;
          const staleId = await insertReservation(s, {
            dinerId: first,
            tableIdentifier: '01',
            expiresAt: DUE,
          });
          const { creation } = buildServices();
          const request = { restaurantId: s.restaurantId, partySize: 4 };

          const created = await creation.create(asDiner(second), request);

          expect(created.status).toBe('active');
          expect(created.table.identifier).toBe('01');
          const [{ count }] = await dataSource.query<{ count: string }[]>(
            `SELECT count(*) FROM reservations WHERE table_id = $1 AND status = 'active'`,
            [s.tableIds.get('01')],
          );
          expect(Number(count)).toBe(1);
          expect((await readReservation(staleId)).status).toBe('expired');
          expect((await readLogs(s, '01')).map(({ source }) => source)).toEqual(
            ['system', 'reservation'],
          );
        },
      ));

    it('una reserva vigente ajena sí ocupa la mesa: NO_TABLE_AVAILABLE, y al vencer se puede reservar', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        2,
        async (s) => {
          const [first, second] = s.dinerIds;
          await insertReservation(s, {
            dinerId: first,
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
          });
          const { creation } = buildServices();
          const request = { restaurantId: s.restaurantId, partySize: 4 };

          const error = await creation
            .create(asDiner(second), request)
            .catch((e: unknown) => e);

          expect(errorCodeOf(error)).toBe('NO_TABLE_AVAILABLE');
          expect(await readTableStatus(s, '01')).toBe('reserved');
        },
      ));
  });
});
