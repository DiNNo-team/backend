import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { QueryFailedError } from 'typeorm';
import { configureApp } from './../src/app.setup.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';

// The front branches on errorCode, not on the route or the message text.
const RESTAURANT_REQUIRED_BODY = {
  statusCode: 403,
  error: 'Forbidden',
  message: 'Primero registra tu restaurante para poder usar tus mesas.',
  errorCode: 'RESTAURANT_REQUIRED',
};

const users = [
  { id: OWNER_ID, role: 'restaurant_admin', restaurantId: RESTAURANT_ID },
  { id: NEWCOMER_ID, role: 'restaurant_admin', restaurantId: null },
];

function storedTable(overrides: Partial<Table>): Table {
  return {
    id: TABLE_ID,
    restaurantId: RESTAURANT_ID,
    identifier: 'Mesa 1',
    capacity: 4,
    status: 'available',
    isActive: true,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
    ...overrides,
  };
}

// Prueba el contrato HTTP de /v1/tables sin PostgreSQL.
describe('Tables (e2e)', () => {
  let app: INestApplication<App>;
  let tables: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    tables = {
      create: vi.fn((data: Partial<Table>) => ({ ...data })),
      save: vi.fn((table: Partial<Table>) =>
        Promise.resolve(storedTable({ ...table })),
      ),
      find: vi.fn(() => Promise.resolve([])),
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ DEV_USER_ENABLED: 'true', DEV_USER_ID: OWNER_ID })],
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
      .overrideProvider(getRepositoryToken(Table))
      .useValue(tables)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /v1/tables', () => {
    it('returns 201 with the created table in camelCase', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/tables')
        .send({ identifier: '  Mesa 4  ', capacity: 4 })
        .expect(201);

      expect(res.body).toEqual({
        id: TABLE_ID,
        identifier: 'Mesa 4',
        capacity: 4,
        status: 'available',
        isActive: true,
      });
      expect(tables.save).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: RESTAURANT_ID }),
      );
    });

    it('returns 400 and saves nothing when restaurantId, status or isActive are sent', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/tables')
        .send({
          identifier: 'Mesa 4',
          capacity: 4,
          restaurantId: '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f',
          status: 'occupied',
          isActive: false,
        })
        .expect(400);

      expect(res.body.message).toContain(
        'El campo "status" no se permite. Quítalo de la solicitud.',
      );
      expect(tables.save).not.toHaveBeenCalled();
    });

    it.each([0, 21, 'cuatro'])(
      'returns 400 for capacity %j',
      async (capacity) => {
        const res = await request(app.getHttpServer())
          .post('/v1/tables')
          .send({ identifier: 'Mesa 4', capacity })
          .expect(400);

        expect(res.body).toEqual({
          statusCode: 400,
          error: 'Bad Request',
          message: ['Escribe cuántas personas caben en la mesa, entre 1 y 20.'],
        });
      },
    );

    it('returns 409 with a clear message for a repeated identifier', async () => {
      tables.save.mockRejectedValueOnce(
        new QueryFailedError(
          'INSERT INTO "tables" ...',
          [],
          Object.assign(new Error('duplicate key value'), {
            code: '23505',
            constraint: 'UQ_tables_restaurant_id_identifier',
          }),
        ),
      );

      const res = await request(app.getHttpServer())
        .post('/v1/tables')
        .send({ identifier: 'mesa 4', capacity: 4 })
        .expect(409);

      expect(res.body.message).toBe(
        'Ya tienes una mesa con ese nombre. Usa uno diferente.',
      );
    });

    it('returns 403 with errorCode RESTAURANT_REQUIRED for a user without a restaurant', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/tables')
        .set('x-dev-user-id', NEWCOMER_ID)
        .send({ identifier: 'Mesa 4', capacity: 4 })
        .expect(403);

      expect(res.body).toEqual(RESTAURANT_REQUIRED_BODY);
      expect(tables.save).not.toHaveBeenCalled();
    });

    it('does not add errorCode to errors the front only displays', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/tables')
        .send({ identifier: '', capacity: 4 })
        .expect(400);

      expect(res.body).not.toHaveProperty('errorCode');
    });
  });

  describe('GET /v1/tables', () => {
    it('returns active and inactive tables in the repository order', async () => {
      tables.find.mockResolvedValueOnce([
        storedTable({ id: TABLE_ID, identifier: 'Mesa 2' }),
        storedTable({
          id: '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d',
          identifier: 'Mesa 10',
          capacity: 6,
          isActive: false,
        }),
      ]);

      const res = await request(app.getHttpServer())
        .get('/v1/tables')
        .expect(200);

      expect(res.body).toEqual([
        {
          id: TABLE_ID,
          identifier: 'Mesa 2',
          capacity: 4,
          status: 'available',
          isActive: true,
        },
        {
          id: '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d',
          identifier: 'Mesa 10',
          capacity: 6,
          status: 'available',
          isActive: false,
        },
      ]);
      expect(tables.find).toHaveBeenCalledWith({
        where: { restaurantId: RESTAURANT_ID },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    });

    it('returns 403 with errorCode RESTAURANT_REQUIRED for a user without a restaurant', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/tables')
        .set('x-dev-user-id', NEWCOMER_ID)
        .expect(403);

      expect(res.body).toEqual(RESTAURANT_REQUIRED_BODY);
      expect(tables.find).not.toHaveBeenCalled();
    });
  });

  it('documents both routes in Swagger', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const route = res.body.paths['/v1/tables'];

    expect(Object.keys(route.post.responses).sort()).toEqual([
      '201',
      '400',
      '401',
      '403',
      '409',
    ]);
    expect(Object.keys(route.get.responses).sort()).toEqual([
      '200',
      '401',
      '403',
    ]);
    expect(
      Object.keys(res.body.components.schemas.CreateTableDto.properties),
    ).toEqual(['identifier', 'capacity']);
    for (const operation of [route.post, route.get]) {
      expect(
        operation.responses['403'].content['application/json'].example,
      ).toEqual(RESTAURANT_REQUIRED_BODY);
    }
    const errorSchema = res.body.components.schemas.ErrorResponseDto;
    expect(errorSchema.properties).toHaveProperty('errorCode');
    expect(errorSchema.properties).not.toHaveProperty('code');
    expect(errorSchema.required).not.toContain('errorCode');
  });
});
