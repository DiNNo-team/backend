import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity-access/index.js';
import { CreateReservationService } from '../../src/modules/reservations-checkin/reservations/create-reservation.service.js';
import { RandomCodeGenerator } from '../../src/modules/reservations-checkin/reservations/reservation-code.js';
import { ReservationExpirationService } from '../../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { ReservationsForTables } from '../../src/modules/reservations-checkin/reservations/reservations-for-tables.js';
import { TableReservationsAccess } from '../../src/modules/restaurant-operations/index.js';
import { Restaurant } from '../../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantStatusService } from '../../src/modules/restaurant-operations/restaurants/restaurant-status.service.js';
import { DbTableStatusLog } from '../../src/modules/restaurant-operations/table-logs/table-logs.recorder.js';
import { Table } from '../../src/modules/restaurant-operations/tables/table.entity.js';
import { TablesService } from '../../src/modules/restaurant-operations/tables/tables.service.js';
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

// Protección de las mesas con reserva DiNNo activa y activeReservationsCount
// (Sprint 3, tarea 4; CLAUDE.md §12.2) contra Postgres REAL, con los servicios
// reales (mesas, reservas y el puerto que las une). Commits reales (sin
// ROLLBACK): cada prueba crea sus datos con ids únicos y borra SOLO lo que creó,
// en orden de FK, aunque falle (ver support/scenario.ts).

// Viernes 2026-11-06 12:00 en Bogotá. Todo (reservas, puerto, vencimiento) usa
// este reloj; las reservas se insertan relativas a él.
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

function buildServices() {
  const statusLog = new DbTableStatusLog();
  const events = new EventEmitter2();
  const expiration = new ReservationExpirationService(
    dataSource,
    statusLog,
    events,
    CLOCK,
  );
  const port = new ReservationsForTables(dataSource, expiration, CLOCK);
  // El acceso real de restaurant-operations, con el puerto de reservations-checkin.
  const access = new TableReservationsAccess({
    get: () => port,
  } as unknown as ModuleRef);
  const tables = new TablesService(
    dataSource.getRepository(Table),
    statusLog,
    events,
    access,
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
  const restaurantStatus = new RestaurantStatusService(
    dataSource.getRepository(Restaurant),
    events,
  );
  return { tables, creation, access, port, restaurantStatus };
}

// El usuario del restaurante en las acciones de mesa. La bitácora exige un
// usuario real (FK): se usa uno de los creados por el escenario.
const asOwner = (s: Scenario, userId: string) => ({
  userId,
  restaurantId: s.restaurantId,
  role: UserRole.RESTAURANT_ADMIN,
});
const asDiner = (userId: string) => ({
  userId,
  restaurantId: null,
  role: UserRole.DINER,
});

const errorCodeOf = (error: unknown) =>
  (error as { response?: { errorCode?: string } }).response?.errorCode;
const errorOf = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);

// ----------------------------------------------------------------- datos ----

async function insertReservation(
  s: Scenario,
  options: {
    dinerId: string;
    tableIdentifier: string;
    status?: string;
    expiresAt: Date;
    partySize?: number;
  },
): Promise<string> {
  const [{ id }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      // Aleatorio: el código es único entre TODAS las reservas activas de la base.
      new RandomCodeGenerator().generate(),
      options.status ?? 'active',
      options.partySize ?? 2,
      options.dinerId,
      s.restaurantId,
      s.tableIds.get(options.tableIdentifier),
      options.expiresAt,
    ],
  );
  return id;
}

interface TableRow {
  status: string;
  is_active: boolean;
  capacity: number;
}

async function readTable(s: Scenario, identifier: string): Promise<TableRow> {
  const [row] = await dataSource.query<TableRow[]>(
    `SELECT status, is_active, capacity FROM tables WHERE id = $1`,
    [s.tableIds.get(identifier)],
  );
  return row;
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

async function readReservationStatus(id: string): Promise<string> {
  const [row] = await dataSource.query<{ status: string }[]>(
    `SELECT status FROM reservations WHERE id = $1`,
    [id],
  );
  return row.status;
}

// Lo que no puede pasar nunca, gane quien gane la carrera: una mesa inactiva con
// una reserva activa, una reserva activa cuya mesa no esté reserved, o una mesa
// reserved sin reserva activa (en estas pruebas ningún cambio manual la deja así).
async function expectConsistent(s: Scenario): Promise<void> {
  const inactiveWithReservation = await dataSource.query<{ count: string }[]>(
    `SELECT count(*) FROM reservations r JOIN tables t ON t.id = r.table_id
      WHERE r.restaurant_id = $1 AND r.status = 'active' AND t.is_active = false`,
    [s.restaurantId],
  );
  expect(Number(inactiveWithReservation[0].count)).toBe(0);

  const activeNotReserved = await dataSource.query<{ count: string }[]>(
    `SELECT count(*) FROM reservations r JOIN tables t ON t.id = r.table_id
      WHERE r.restaurant_id = $1 AND r.status = 'active' AND t.status <> 'reserved'`,
    [s.restaurantId],
  );
  expect(Number(activeNotReserved[0].count)).toBe(0);

  const reservedWithoutReservation = await dataSource.query<
    { count: string }[]
  >(
    `SELECT count(*) FROM tables t
      WHERE t.restaurant_id = $1 AND t.status = 'reserved'
        AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.table_id = t.id AND r.status = 'active')`,
    [s.restaurantId],
  );
  expect(Number(reservedWithoutReservation[0].count)).toBe(0);
}

// ----------------------------------------------------------------- casos ----

describe('mesas con reserva activa: Postgres real', () => {
  describe('1. reserva activa en la mesa', () => {
    it('cambiar estado, desactivar y bajar la capacidad por debajo del party_size responden TABLE_HAS_ACTIVE_RESERVATION y la mesa queda intacta', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        2,
        async (s) => {
          const [diner, ownerUser] = s.dinerIds;
          await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
            partySize: 3,
          });
          const { tables } = buildServices();
          const owner = asOwner(s, ownerUser);
          const tableId = s.tableIds.get('01')!;

          const statusError = await errorOf(
            tables.updateStatus(owner, tableId, 'available'),
          );
          const sameStatusError = await errorOf(
            tables.updateStatus(owner, tableId, 'reserved'),
          );
          const deactivateError = await errorOf(
            tables.deactivate(owner, tableId),
          );
          const capacityError = await errorOf(
            tables.update(s.restaurantId, tableId, { capacity: 2 }),
          );

          for (const error of [
            statusError,
            sameStatusError,
            deactivateError,
            capacityError,
          ]) {
            expect(errorCodeOf(error)).toBe('TABLE_HAS_ACTIVE_RESERVATION');
          }
          expect(await readTable(s, '01')).toEqual({
            status: 'reserved',
            is_active: true,
            capacity: 4,
          });
          expect(await readLogs(s, '01')).toEqual([]);
        },
      ));

    it('bajar la capacidad hasta el party_size se permite, y cambiar el identificador también', () =>
      withScenario(
        [{ identifier: '01', capacity: 6, status: 'reserved' }],
        2,
        async (s) => {
          const [diner] = s.dinerIds;
          await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
            partySize: 3,
          });
          const { tables } = buildServices();
          const tableId = s.tableIds.get('01')!;

          await tables.update(s.restaurantId, tableId, { capacity: 3 });
          await tables.update(s.restaurantId, tableId, { identifier: '77' });

          const [row] = await dataSource.query<
            { capacity: number; identifier: string }[]
          >(`SELECT capacity, identifier FROM tables WHERE id = $1`, [tableId]);
          expect(row).toEqual({ capacity: 3, identifier: '77' });
        },
      ));
  });

  describe('2. mesa reserved o occupied a mano (sin reserva DiNNo)', () => {
    it.each(['reserved', 'occupied'] as const)(
      'desactivar una mesa %s responde TABLE_NOT_AVAILABLE_TO_DEACTIVATE',
      (status) =>
        withScenario(
          [{ identifier: '01', capacity: 4, status }],
          2,
          async (s) => {
            const [, ownerUser] = s.dinerIds;
            const { tables } = buildServices();

            const error = await errorOf(
              tables.deactivate(asOwner(s, ownerUser), s.tableIds.get('01')!),
            );

            expect(errorCodeOf(error)).toBe(
              'TABLE_NOT_AVAILABLE_TO_DEACTIVATE',
            );
            expect(await readTable(s, '01')).toMatchObject({
              status,
              is_active: true,
            });
            expect(await readLogs(s, '01')).toEqual([]);
          },
        ),
    );

    it.each(['reserved', 'occupied'] as const)(
      'cambiar el estado de una mesa %s a mano se permite como siempre',
      (status) =>
        withScenario(
          [{ identifier: '01', capacity: 4, status }],
          2,
          async (s) => {
            const [, ownerUser] = s.dinerIds;
            const { tables } = buildServices();

            await tables.updateStatus(
              asOwner(s, ownerUser),
              s.tableIds.get('01')!,
              'available',
            );

            expect((await readTable(s, '01')).status).toBe('available');
          },
        ),
    );

    it('una mesa available se desactiva bien y registra available → inactive', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'available' }],
        2,
        async (s) => {
          const [, ownerUser] = s.dinerIds;
          const { tables } = buildServices();

          await tables.deactivate(asOwner(s, ownerUser), s.tableIds.get('01')!);

          expect(await readTable(s, '01')).toMatchObject({
            status: 'available',
            is_active: false,
          });
          expect(await readLogs(s, '01')).toEqual([
            {
              previous_status: 'available',
              new_status: 'inactive',
              user_id: ownerUser,
              source: 'manual',
            },
          ]);
        },
      ));
  });

  describe('3. reserva activa ya vencida sin barrer', () => {
    it('cambiar estado: primero la vence (la mesa vuelve a available) y el cambio funciona', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        2,
        async (s) => {
          const [diner, ownerUser] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: DUE,
          });
          const { tables } = buildServices();

          await tables.updateStatus(
            asOwner(s, ownerUser),
            s.tableIds.get('01')!,
            'occupied',
          );

          expect(await readReservationStatus(id)).toBe('expired');
          expect((await readTable(s, '01')).status).toBe('occupied');
          expect(await readLogs(s, '01')).toEqual([
            {
              previous_status: 'reserved',
              new_status: 'available',
              user_id: null,
              source: 'system',
            },
            {
              previous_status: 'available',
              new_status: 'occupied',
              user_id: ownerUser,
              source: 'manual',
            },
          ]);
        },
      ));

    it('desactivar: la vence, la mesa queda available y se desactiva', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        2,
        async (s) => {
          const [diner, ownerUser] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: DUE,
          });
          const { tables } = buildServices();

          await tables.deactivate(asOwner(s, ownerUser), s.tableIds.get('01')!);

          expect(await readReservationStatus(id)).toBe('expired');
          expect(await readTable(s, '01')).toMatchObject({
            status: 'available',
            is_active: false,
          });
        },
      ));

    it('bajar la capacidad: la vence y se permite aunque quede por debajo de las personas', () =>
      withScenario(
        [{ identifier: '01', capacity: 6, status: 'reserved' }],
        2,
        async (s) => {
          const [diner] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: DUE,
            partySize: 5,
          });
          const { tables } = buildServices();

          await tables.update(s.restaurantId, s.tableIds.get('01')!, {
            capacity: 1,
          });

          expect(await readReservationStatus(id)).toBe('expired');
          expect((await readTable(s, '01')).capacity).toBe(1);
        },
      ));

    it('una mesa de OTRO restaurante responde el mismo 404 que un id inexistente, aunque tenga una reserva vencida', () =>
      withScenario(
        [{ identifier: '01', capacity: 4, status: 'reserved' }],
        1,
        async (a) =>
          withScenario([{ identifier: '01', capacity: 4 }], 2, async (b) => {
            const [diner] = a.dinerIds;
            const [, ownerOfB] = b.dinerIds;
            await insertReservation(a, {
              dinerId: diner,
              tableIdentifier: '01',
              expiresAt: DUE,
            });
            const { tables } = buildServices();
            const foreignTable = a.tableIds.get('01')!;
            const unknownTable = '00000000-0000-4000-8000-000000000000';

            const foreign = await errorOf(
              tables.updateStatus(
                asOwner(b, ownerOfB),
                foreignTable,
                'available',
              ),
            );
            const unknown = await errorOf(
              tables.updateStatus(
                asOwner(b, ownerOfB),
                unknownTable,
                'available',
              ),
            );

            expect((foreign as Error).message).toBe((unknown as Error).message);
            expect(foreign).toMatchObject({ status: 404 });
            expect(JSON.stringify(foreign)).not.toContain('reserva');
            // La mesa ajena no se tocó (vencer una reserva ya vencida es inocuo).
            expect((await readTable(a, '01')).is_active).toBe(true);
          }),
      ));
  });

  describe('4. carrera: crear una reserva y desactivar la mesa a la vez', () => {
    it('una sola mesa: gana la reserva (y desactivar da 409) o gana desactivar (y la reserva da NO_TABLE_AVAILABLE); nunca queda una mesa inactiva con reserva', async () => {
      for (let round = 0; round < 8; round++) {
        await withScenario(
          [{ identifier: '01', capacity: 4 }],
          2,
          async (s) => {
            const [diner, ownerUser] = s.dinerIds;
            const { tables, creation } = buildServices();
            const tableId = s.tableIds.get('01')!;

            const [reserve, deactivate] = await Promise.allSettled([
              creation.create(asDiner(diner), {
                restaurantId: s.restaurantId,
                partySize: 2,
              }),
              tables.deactivate(asOwner(s, ownerUser), tableId),
            ]);

            if (reserve.status === 'fulfilled') {
              expect(deactivate.status).toBe('rejected');
              expect(
                deactivate.status === 'rejected' &&
                  errorCodeOf(deactivate.reason),
              ).toBe('TABLE_HAS_ACTIVE_RESERVATION');
            } else {
              expect(errorCodeOf(reserve.reason)).toBe('NO_TABLE_AVAILABLE');
              expect(deactivate.status).toBe('fulfilled');
            }
            await expectConsistent(s);
          },
        );
      }
    });

    it('dos mesas iguales: si desactivar gana la 01, la reserva toma la 02; nunca queda una mesa inactiva con reserva', async () => {
      for (let round = 0; round < 8; round++) {
        await withScenario(
          [
            { identifier: '01', capacity: 4 },
            { identifier: '02', capacity: 4 },
          ],
          2,
          async (s) => {
            const [diner, ownerUser] = s.dinerIds;
            const { tables, creation } = buildServices();

            const [reserve, deactivate] = await Promise.allSettled([
              creation.create(asDiner(diner), {
                restaurantId: s.restaurantId,
                partySize: 2,
              }),
              tables.deactivate(asOwner(s, ownerUser), s.tableIds.get('01')!),
            ]);

            // Con otra mesa libre, la reserva siempre sale.
            expect(reserve.status).toBe('fulfilled');
            if (deactivate.status === 'rejected') {
              expect(errorCodeOf(deactivate.reason)).toBe(
                'TABLE_HAS_ACTIVE_RESERVATION',
              );
            }
            await expectConsistent(s);
          },
        );
      }
    });
  });

  describe('5. carrera: crear una reserva y cambiar el estado a mano a la vez', () => {
    it('gana la reserva (cambiar da 409) o gana el cambio (la reserva da NO_TABLE_AVAILABLE); nunca un estado inconsistente', async () => {
      for (let round = 0; round < 8; round++) {
        await withScenario(
          [{ identifier: '01', capacity: 4 }],
          2,
          async (s) => {
            const [diner, ownerUser] = s.dinerIds;
            const { tables, creation } = buildServices();
            const tableId = s.tableIds.get('01')!;

            const [reserve, change] = await Promise.allSettled([
              creation.create(asDiner(diner), {
                restaurantId: s.restaurantId,
                partySize: 2,
              }),
              tables.updateStatus(asOwner(s, ownerUser), tableId, 'occupied'),
            ]);

            if (reserve.status === 'fulfilled') {
              expect(change.status).toBe('rejected');
              expect(
                change.status === 'rejected' && errorCodeOf(change.reason),
              ).toBe('TABLE_HAS_ACTIVE_RESERVATION');
              expect((await readTable(s, '01')).status).toBe('reserved');
            } else {
              expect(errorCodeOf(reserve.reason)).toBe('NO_TABLE_AVAILABLE');
              expect(change.status).toBe('fulfilled');
              expect((await readTable(s, '01')).status).toBe('occupied');
            }
            await expectConsistent(s);
          },
        );
      }
    });
  });

  describe('6. activeReservationsCount con datos reales', () => {
    it('cuenta solo las activas vigentes del restaurante: ignora vencidas sin barrer, cancelled, expired, completed y las de otro restaurante', () =>
      withScenario(
        [
          { identifier: '01', capacity: 4, status: 'reserved' },
          { identifier: '02', capacity: 4, status: 'reserved' },
          { identifier: '03', capacity: 4, status: 'reserved' },
          { identifier: '04', capacity: 4 },
        ],
        6,
        async (a) =>
          withScenario(
            [{ identifier: '01', capacity: 4, status: 'reserved' }],
            1,
            async (b) => {
              const [d1, d2, d3, d4, d5, d6] = a.dinerIds;
              const { port } = buildServices();
              expect(await port.countActive(a.restaurantId)).toBe(0);

              // Dos activas vigentes.
              await insertReservation(a, {
                dinerId: d1,
                tableIdentifier: '01',
                expiresAt: NOT_DUE,
              });
              await insertReservation(a, {
                dinerId: d2,
                tableIdentifier: '02',
                expiresAt: NOT_DUE,
              });
              // Activa ya vencida sin barrer: no cuenta.
              await insertReservation(a, {
                dinerId: d3,
                tableIdentifier: '03',
                expiresAt: DUE,
              });
              // Resueltas: no cuentan.
              for (const [dinerId, status] of [
                [d4, 'cancelled'],
                [d5, 'expired'],
                [d6, 'completed'],
              ] as const) {
                await insertReservation(a, {
                  dinerId,
                  tableIdentifier: '04',
                  status,
                  expiresAt: NOT_DUE,
                });
              }
              // Otro restaurante: no cuenta para el primero.
              await insertReservation(b, {
                dinerId: b.dinerIds[0],
                tableIdentifier: '01',
                expiresAt: NOT_DUE,
              });

              expect(await port.countActive(a.restaurantId)).toBe(2);
              expect(await port.countActive(b.restaurantId)).toBe(1);
            },
          ),
      ));
  });

  describe('7. cerrar el restaurante con una reserva activa', () => {
    it('no toca la reserva ni la mesa, el contador sigue igual y las nuevas reservas responden RESTAURANT_CLOSED', () =>
      withScenario(
        [
          { identifier: '01', capacity: 4, status: 'reserved' },
          { identifier: '02', capacity: 4 },
        ],
        2,
        async (s) => {
          const [diner, other] = s.dinerIds;
          const id = await insertReservation(s, {
            dinerId: diner,
            tableIdentifier: '01',
            expiresAt: NOT_DUE,
          });
          const { port, restaurantStatus, creation } = buildServices();
          expect(await port.countActive(s.restaurantId)).toBe(1);

          await restaurantStatus.update(s.restaurantId, false);

          expect(await readReservationStatus(id)).toBe('active');
          expect(await readTable(s, '01')).toMatchObject({
            status: 'reserved',
            is_active: true,
          });
          expect(await port.countActive(s.restaurantId)).toBe(1);
          const error = await errorOf(
            creation.create(asDiner(other), {
              restaurantId: s.restaurantId,
              partySize: 2,
            }),
          );
          expect(errorCodeOf(error)).toBe('RESTAURANT_CLOSED');
        },
      ));
  });
});
