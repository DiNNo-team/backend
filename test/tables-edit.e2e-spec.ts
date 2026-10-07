import { INestApplication, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const OTHER_TABLE_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const users = [
  { id: OWNER_ID, role: 'restaurant_admin', restaurantId: RESTAURANT_ID },
  { id: NEWCOMER_ID, role: 'restaurant_admin', restaurantId: null },
];

function storedTable(overrides: Partial<Table>): Table {
  return {
    id: TABLE_ID,
    restaurantId: RESTAURANT_ID,
    identifier: 'Mesa 4',
    capacity: 4,
    status: 'occupied',
    isActive: true,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
    ...overrides,
  };
}

// HTTP contract of the PBI 7 routes (edit, deactivate, reactivate) without PostgreSQL.
describe('Tables · edit and deactivate (e2e)', () => {
  let app: INestApplication<App>;
  let current: Table;
  let tables: {
    findOneBy: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    manager: { transaction: ReturnType<typeof vi.fn> };
  };
  let statusLog: { record: ReturnType<typeof vi.fn> };

  async function createApp(devUserEnabled = 'true') {
    const findOwnTable = (where: { id: string; restaurantId: string }) =>
      Promise.resolve(
        where.id === current.id && where.restaurantId === current.restaurantId
          ? { ...current }
          : null,
      );
    const txManager = {
      findOne: vi.fn(
        (
          _entity: unknown,
          { where }: { where: { id: string; restaurantId: string } },
        ) => findOwnTable(where),
      ),
      save: vi.fn((table: Table) => Promise.resolve({ ...table })),
    };
    tables = {
      findOneBy: vi.fn(findOwnTable),
      find: vi.fn(() =>
        Promise.resolve([
          { ...current },
          storedTable({ id: OTHER_TABLE_ID, identifier: 'T1' }),
        ]),
      ),
      save: vi.fn((table: Table) => Promise.resolve({ ...table })),
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
            () => ({ DEV_USER_ENABLED: devUserEnabled, DEV_USER_ID: OWNER_ID }),
          ],
        }),
        RestaurantOperationsModule,
      ],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue({
        findOneBy: ({ id }: { id: string }) =>
          Promise.resolve(users.find((user) => user.id === id) ?? null),
      })
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue({})
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({})
      .overrideProvider(getRepositoryToken(Table))
      .useValue(tables)
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(TableStatusLog)
      .useValue(statusLog)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }

  beforeEach(async () => {
    current = storedTable({});
    await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('PATCH /v1/tables/:id', () => {
    it('returns 200 with the edited table, same shape as the list', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/tables/${TABLE_ID}`)
        .send({ identifier: ' 12 ', capacity: 6 })
        .expect(200);

      expect(res.body).toEqual({
        id: TABLE_ID,
        identifier: '12',
        capacity: 6,
        status: 'occupied',
        isActive: true,
      });
      expect(statusLog.record).not.toHaveBeenCalled();
    });

    it.each([
      ['capacity 0', { capacity: 0 }, 'La capacidad va de 1 a 20 personas.'],
      ['capacity 21', { capacity: 21 }, 'La capacidad va de 1 a 20 personas.'],
      [
        'an empty body',
        {},
        'No hay cambios para guardar. Cambia el identificador o la capacidad de la mesa.',
      ],
      [
        'an identifier of 11 characters',
        { identifier: '12345678901' },
        'Usa máximo 10 caracteres en el identificador de la mesa.',
      ],
      [
        'status in the body',
        { status: 'available' },
        'El campo "status" no se permite. Quítalo de la solicitud.',
      ],
      [
        'isActive in the body',
        { isActive: false },
        'El campo "isActive" no se permite. Quítalo de la solicitud.',
      ],
    ])('returns 400 for %s and saves nothing', async (_case, body, message) => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/tables/${TABLE_ID}`)
        .send(body)
        .expect(400);

      expect(res.body.message).toContain(message);
      expect(tables.save).not.toHaveBeenCalled();
    });

    it('returns 400 in Spanish for a null identifier and saves nothing', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/tables/${TABLE_ID}`)
        .send({ identifier: null })
        .expect(400);

      expect(res.body.message).toEqual([
        'Escribe el identificador de la mesa.',
      ]);
      expect(tables.save).not.toHaveBeenCalled();
    });

    it('returns 409 for a repeated identifier ("t1" against "T1")', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/tables/${TABLE_ID}`)
        .send({ identifier: 't1' })
        .expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        message: 'Ya tienes una Mesa t1. Usa otro identificador.',
        error: 'Conflict',
      });
    });

    it('returns 404 for a table that is not in the user restaurant', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/tables/${UNKNOWN_ID}`)
        .send({ capacity: 2 })
        .expect(404);

      expect(res.body.message).toBe(
        'No encontramos esta mesa. Actualiza la lista de mesas e intenta de nuevo.',
      );
    });

    it('returns 400 for an id that is not a UUID', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/tables/mesa-4')
        .send({ capacity: 2 })
        .expect(400);

      expect(res.body.message).toEqual([
        'El id de la mesa no es un UUID válido.',
      ]);
    });
  });

  describe('POST /v1/tables/:id/deactivate', () => {
    it('returns 200 with isActive false and the kept status, and logs it', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/tables/${TABLE_ID}/deactivate`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: TABLE_ID,
        isActive: false,
        status: 'occupied',
      });
      expect(statusLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tableId: TABLE_ID,
          previousStatus: 'occupied',
          newStatus: 'inactive',
          userId: OWNER_ID,
        }),
        expect.anything(),
      );
    });

    it('returns 404 for a table that is not in the user restaurant', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/tables/${UNKNOWN_ID}/deactivate`)
        .expect(404);

      expect(res.body.message).toBe(
        'No encontramos esta mesa. Actualiza la lista de mesas e intenta de nuevo.',
      );
      expect(statusLog.record).not.toHaveBeenCalled();
    });

    it('returns 409 for a table that is already inactive', async () => {
      current = storedTable({ isActive: false });

      const res = await request(app.getHttpServer())
        .post(`/v1/tables/${TABLE_ID}/deactivate`)
        .expect(409);

      expect(res.body.message).toBe(
        'Esta mesa ya está inactiva. Actualiza la lista de mesas.',
      );
      expect(statusLog.record).not.toHaveBeenCalled();
    });

    it('answers the Spanish 500 when the log fails', async () => {
      const silenced = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      statusLog.record.mockRejectedValueOnce(
        new Error('insert into table_logs failed'),
      );

      const res = await request(app.getHttpServer())
        .post(`/v1/tables/${TABLE_ID}/deactivate`)
        .expect(500);

      expect(res.body.message).toBe(
        'No pudimos completar la acción. Intenta de nuevo en un momento.',
      );
      expect(res.text).not.toContain('table_logs');
      silenced.mockRestore();
    });
  });

  describe('POST /v1/tables/:id/reactivate', () => {
    it('returns 200 as available and logs inactive → available', async () => {
      current = storedTable({ isActive: false, status: 'reserved' });

      const res = await request(app.getHttpServer())
        .post(`/v1/tables/${TABLE_ID}/reactivate`)
        .expect(200);

      expect(res.body).toMatchObject({ isActive: true, status: 'available' });
      expect(statusLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          previousStatus: 'inactive',
          newStatus: 'available',
        }),
        expect.anything(),
      );
    });

    it('returns 404 for a table that is not in the user restaurant', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/tables/${UNKNOWN_ID}/reactivate`)
        .expect(404);

      expect(res.body.message).toBe(
        'No encontramos esta mesa. Actualiza la lista de mesas e intenta de nuevo.',
      );
      expect(statusLog.record).not.toHaveBeenCalled();
    });

    it('returns 409 for a table that is already active', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/tables/${TABLE_ID}/reactivate`)
        .expect(409);

      expect(res.body.message).toBe(
        'Esta mesa ya está activa. Actualiza la lista de mesas.',
      );
    });
  });

  describe('access', () => {
    it.each([
      ['patch', `/v1/tables/${TABLE_ID}`],
      ['post', `/v1/tables/${TABLE_ID}/deactivate`],
      ['post', `/v1/tables/${TABLE_ID}/reactivate`],
    ] as const)(
      '%s %s returns 403 RESTAURANT_REQUIRED for a user without a restaurant',
      async (method, url) => {
        const res = await request(app.getHttpServer())
          [method](url)
          .set('x-dev-user-id', NEWCOMER_ID)
          .send({ capacity: 2 })
          .expect(403);

        expect(res.body.errorCode).toBe('RESTAURANT_REQUIRED');
      },
    );

    it('returns 401 without a session (development user turned off)', async () => {
      await app.close();
      await createApp('false');

      await request(app.getHttpServer())
        .post(`/v1/tables/${TABLE_ID}/deactivate`)
        .expect(401);
      expect(tables.manager.transaction).not.toHaveBeenCalled();
    });
  });

  it('documents the three routes in Swagger', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const paths = res.body.paths;

    expect(
      Object.keys(paths['/v1/tables/{id}'].patch.responses).sort(),
    ).toEqual(['200', '400', '401', '403', '404', '409']);
    for (const action of ['deactivate', 'reactivate']) {
      expect(
        Object.keys(paths[`/v1/tables/{id}/${action}`].post.responses).sort(),
      ).toEqual(['200', '401', '403', '404', '409']);
    }
    expect(
      Object.keys(res.body.components.schemas.UpdateTableDto.properties),
    ).toEqual(['identifier', 'capacity']);
  });
});
