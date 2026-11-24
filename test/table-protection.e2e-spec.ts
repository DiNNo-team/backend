import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { UserRole } from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { TableReservationsAccess } from './../src/modules/restaurant-operations/index.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableArea } from './../src/modules/restaurant-operations/table-areas/table-area.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import { RestaurantApprovalReader } from './../src/modules/identity-access/approval/restaurant-approval.reader.js';
import { approvalReader } from './support/test-accounts.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const FOREIGN_TABLE_ID = '7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const HAS_ACTIVE_RESERVATION = {
  statusCode: 409,
  message:
    'Esta mesa tiene una reserva de DiNNo en curso. Se libera sola cuando el comensal llegue, cancele o se venza la reserva.',
  error: 'Conflict',
  errorCode: 'TABLE_HAS_ACTIVE_RESERVATION',
};
const NOT_AVAILABLE_TO_DEACTIVATE = {
  statusCode: 409,
  message: 'Para desactivar esta mesa, primero márcala como Disponible.',
  error: 'Conflict',
  errorCode: 'TABLE_NOT_AVAILABLE_TO_DEACTIVATE',
};
const NOT_FOUND = {
  statusCode: 404,
  message:
    'No encontramos esta mesa. Actualiza la lista de mesas e intenta de nuevo.',
  error: 'Not Found',
};

function storedTable(overrides: Partial<Table> = {}): Table {
  return {
    id: TABLE_ID,
    restaurantId: RESTAURANT_ID,
    areaId: null,
    identifier: '04',
    capacity: 4,
    status: 'available',
    isActive: true,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
    planX: null,
    planY: null,
    planShape: null,
    ...overrides,
  };
}

// Contrato HTTP de la protección de las mesas con reserva DiNNo activa (§12.2),
// sin PostgreSQL: el puerto de las reservas es un doble que responde lo que
// cada prueba necesita.
describe('Tables · protección con reserva activa (e2e)', () => {
  let app: INestApplication<App>;
  let current: Table;
  let statusLog: { record: ReturnType<typeof vi.fn> };
  let txManager: {
    findOne: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  const reservations = {
    countActive: vi.fn(),
    expireDueForTable: vi.fn(),
    findActiveForTable: vi.fn(),
  };

  beforeEach(async () => {
    current = storedTable();
    reservations.countActive.mockReset().mockResolvedValue(0);
    reservations.expireDueForTable.mockReset().mockResolvedValue(undefined);
    reservations.findActiveForTable.mockReset().mockResolvedValue(null);

    txManager = {
      findOne: vi.fn(
        (
          _entity: unknown,
          { where }: { where: { id: string; restaurantId: string } },
        ) =>
          Promise.resolve(
            where.id === current.id &&
              where.restaurantId === current.restaurantId
              ? { ...current }
              : null,
          ),
      ),
      save: vi.fn((table: Table) => Promise.resolve({ ...table })),
      update: vi.fn(() => Promise.resolve({ affected: 1 })),
    };
    const tables = {
      find: vi.fn(() => Promise.resolve([{ ...current }])),
      manager: {
        transaction: vi.fn(
          (work: (manager: typeof txManager) => Promise<unknown>) =>
            work(txManager),
        ),
      },
    };
    statusLog = { record: vi.fn(() => Promise.resolve()) };

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DEV_USER_ENABLED: 'true',
              DEV_USER_ID: OWNER_ID,
              FIREBASE_PROJECT_ID: 'firebase-project-example',
            }),
          ],
        }),
        EventEmitterModule.forRoot(),
        RestaurantOperationsModule,
      ],
    })
      .overrideProvider(RestaurantApprovalReader)
      .useValue(approvalReader('approved'))
      .overrideProvider(getRepositoryToken(User))
      .useValue({
        findOneBy: ({ id }: { id: string }) =>
          Promise.resolve(
            id === OWNER_ID
              ? {
                  id: OWNER_ID,
                  role: UserRole.RESTAURANT_ADMIN,
                  restaurantId: RESTAURANT_ID,
                }
              : null,
          ),
      })
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue({})
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({})
      .overrideProvider(getRepositoryToken(Table))
      .useValue(tables)
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableArea))
      .useValue({})
      .overrideProvider(TableStatusLog)
      .useValue(statusLog)
      .overrideProvider(TableReservationsAccess)
      .useValue(reservations)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const patchStatus = (status: string, id = TABLE_ID) =>
    request(app.getHttpServer())
      .patch(`/v1/tables/${id}/status`)
      .send({ status });
  const patchTable = (body: object, id = TABLE_ID) =>
    request(app.getHttpServer()).patch(`/v1/tables/${id}`).send(body);
  const deactivate = (id = TABLE_ID) =>
    request(app.getHttpServer()).post(`/v1/tables/${id}/deactivate`);

  const withReservation = (partySize = 2) =>
    reservations.findActiveForTable.mockResolvedValue({ partySize });

  describe('PATCH /v1/tables/:id/status', () => {
    it('409 TABLE_HAS_ACTIVE_RESERVATION con el mensaje exacto, y no cambia nada', async () => {
      current = storedTable({ status: 'reserved' });
      withReservation();

      const res = await patchStatus('available').expect(409);

      expect(res.body).toEqual(HAS_ACTIVE_RESERVATION);
      expect(txManager.save).not.toHaveBeenCalled();
      expect(statusLog.record).not.toHaveBeenCalled();
    });

    it('el "Deshacer" sin cambio también es 409 con reserva activa', async () => {
      current = storedTable({ status: 'reserved' });
      withReservation();

      const res = await patchStatus('reserved').expect(409);

      expect(res.body).toEqual(HAS_ACTIVE_RESERVATION);
    });

    it.each(['reserved', 'occupied'] as const)(
      'una mesa %s a mano, sin reserva DiNNo, se cambia como siempre',
      async (status) => {
        current = storedTable({ status });

        const res = await patchStatus('available').expect(200);

        expect(res.body.status).toBe('available');
        expect(statusLog.record).toHaveBeenCalled();
      },
    );
  });

  describe('POST /v1/tables/:id/deactivate', () => {
    it('409 TABLE_HAS_ACTIVE_RESERVATION con la mesa reservada (tiene prioridad)', async () => {
      current = storedTable({ status: 'reserved' });
      withReservation();

      const res = await deactivate().expect(409);

      expect(res.body).toEqual(HAS_ACTIVE_RESERVATION);
    });

    it.each(['reserved', 'occupied'] as const)(
      '409 TABLE_NOT_AVAILABLE_TO_DEACTIVATE con la mesa %s a mano',
      async (status) => {
        current = storedTable({ status });

        const res = await deactivate().expect(409);

        expect(res.body).toEqual(NOT_AVAILABLE_TO_DEACTIVATE);
        expect(statusLog.record).not.toHaveBeenCalled();
      },
    );

    it('409 de "ya inactiva" sin errorCode, como hoy', async () => {
      current = storedTable({ isActive: false });

      const res = await deactivate().expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        message: 'Esta mesa ya está inactiva. Actualiza la lista de mesas.',
        error: 'Conflict',
      });
    });

    it('una mesa available sin reserva se desactiva y registra available → inactive', async () => {
      const res = await deactivate().expect(200);

      expect(res.body).toMatchObject({ isActive: false, status: 'available' });
      expect(statusLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          previousStatus: 'available',
          newStatus: 'inactive',
          source: 'manual',
        }),
        expect.anything(),
      );
    });

    it('reactivar no cambia: la mesa vuelve como available', async () => {
      current = storedTable({ isActive: false });

      const res = await request(app.getHttpServer())
        .post(`/v1/tables/${TABLE_ID}/reactivate`)
        .expect(200);

      expect(res.body).toMatchObject({ isActive: true, status: 'available' });
    });
  });

  describe('PATCH /v1/tables/:id', () => {
    it('409 TABLE_HAS_ACTIVE_RESERVATION si la capacidad queda por debajo de las personas de la reserva', async () => {
      current = storedTable({ capacity: 8, status: 'reserved' });
      withReservation(4);

      const res = await patchTable({ capacity: 3 }).expect(409);

      expect(res.body).toEqual(HAS_ACTIVE_RESERVATION);
      expect(txManager.update).not.toHaveBeenCalled();
    });

    it('con la capacidad igual a las personas de la reserva se permite', async () => {
      current = storedTable({ capacity: 8, status: 'reserved' });
      withReservation(4);

      const res = await patchTable({ capacity: 4 }).expect(200);

      expect(res.body.capacity).toBe(4);
    });

    it('cambiar solo el identificador siempre se permite, aunque haya reserva', async () => {
      withReservation(4);

      const res = await patchTable({ identifier: '12' }).expect(200);

      expect(res.body.identifier).toBe('12');
      expect(reservations.findActiveForTable).not.toHaveBeenCalled();
    });
  });

  describe('mesa de otro restaurante', () => {
    it.each([
      ['cambiar estado', () => patchStatus('available', FOREIGN_TABLE_ID)],
      ['desactivar', () => deactivate(FOREIGN_TABLE_ID)],
      [
        'editar la capacidad',
        () => patchTable({ capacity: 2 }, FOREIGN_TABLE_ID),
      ],
    ])(
      '%s: el mismo 404 que una mesa inexistente, aunque tenga una reserva',
      async (_action, call) => {
        current = storedTable({
          id: FOREIGN_TABLE_ID,
          restaurantId: OTHER_RESTAURANT_ID,
        });
        withReservation();

        const foreign = await call().expect(404);

        expect(foreign.body).toEqual(NOT_FOUND);
        expect(JSON.stringify(foreign.body)).not.toContain('reserva');
      },
    );

    it('el 404 de una mesa ajena es idéntico al de un id que no existe', async () => {
      current = storedTable({
        id: FOREIGN_TABLE_ID,
        restaurantId: OTHER_RESTAURANT_ID,
      });
      withReservation();

      const foreign = await deactivate(FOREIGN_TABLE_ID).expect(404);
      const unknown = await deactivate(UNKNOWN_ID).expect(404);

      expect(foreign.body).toEqual(unknown.body);
    });
  });
});
