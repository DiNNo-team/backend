import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { UsersService } from './../src/modules/identity-access/index.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const NEW_RESTAURANT_ID = '6e5d4c3b-2a19-4807-b6a5-948372615049';

const users = [
  { id: OWNER_ID, role: 'restaurant_admin', restaurantId: RESTAURANT_ID },
  { id: NEWCOMER_ID, role: 'restaurant_admin', restaurantId: null },
];

const REGISTRATION = {
  name: '  La Esquina de Ana ',
  category: 'colombian',
  address: 'Calle 72 # 10-34, Bogotá',
  schedules: [
    { dayOfWeek: 6, isOpen24h: true },
    { dayOfWeek: 1, isOpen24h: false, opensAt: '18:00', closesAt: '02:00' },
  ],
};

// Prueba el contrato HTTP de POST /v1/restaurants y GET /v1/restaurants/me sin PostgreSQL.
describe('Restaurant registration (e2e)', () => {
  let app: INestApplication<App>;
  let restaurants: {
    findOneBy: ReturnType<typeof vi.fn>;
    manager: { transaction: ReturnType<typeof vi.fn> };
  };
  let schedules: { find: ReturnType<typeof vi.fn> };
  let txManager: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let usersService: { assignRestaurantIfNone: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    txManager = {
      create: vi.fn((_target: unknown, data: object) => ({ ...data })),
      save: vi.fn((entity: object | object[]) =>
        Promise.resolve(
          Array.isArray(entity) ? entity : { id: NEW_RESTAURANT_ID, ...entity },
        ),
      ),
    };
    restaurants = {
      findOneBy: vi.fn(({ id }: { id: string }) =>
        Promise.resolve({
          id,
          name: 'Casa 72',
          category: 'grill',
          address: 'Carrera 7 # 72-10',
          createdAt: new Date('2026-10-04T12:00:00Z'),
          updatedAt: new Date('2026-10-04T12:00:00Z'),
        }),
      ),
      manager: {
        transaction: vi.fn((work: (manager: unknown) => unknown) =>
          work(txManager),
        ),
      },
    };
    // As PostgreSQL returns time columns: HH:MM:SS.
    schedules = {
      find: vi.fn().mockResolvedValue([
        {
          dayOfWeek: 2,
          isOpen24h: false,
          opensAt: '12:00:00',
          closesAt: '22:30:00',
        },
      ]),
    };
    usersService = { assignRestaurantIfNone: vi.fn().mockResolvedValue(true) };

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
      .useValue(restaurants)
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue(schedules)
      .overrideProvider(getRepositoryToken(Table))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(UsersService)
      .useValue(usersService)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /v1/restaurants', () => {
    it('returns 201 with the restaurant and its schedules from Monday to Sunday', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/restaurants')
        .set('x-dev-user-id', NEWCOMER_ID)
        .send(REGISTRATION)
        .expect(201);

      expect(res.body).toEqual({
        id: NEW_RESTAURANT_ID,
        name: 'La Esquina de Ana',
        category: 'colombian',
        address: 'Calle 72 # 10-34, Bogotá',
        schedules: [
          {
            dayOfWeek: 1,
            isOpen24h: false,
            opensAt: '18:00',
            closesAt: '02:00',
          },
          { dayOfWeek: 6, isOpen24h: true, opensAt: null, closesAt: null },
        ],
      });
      expect(usersService.assignRestaurantIfNone).toHaveBeenCalledWith(
        NEWCOMER_ID,
        NEW_RESTAURANT_ID,
        txManager,
      );
    });

    it('returns 409 for a user who already has a restaurant, and saves nothing', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/restaurants')
        .send(REGISTRATION)
        .expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message:
          'Ya registraste tu restaurante. Para cambiar sus datos, entra a Restaurante.',
      });
      expect(restaurants.manager.transaction).not.toHaveBeenCalled();
    });

    it('returns 409 when the user got a restaurant in the meantime', async () => {
      usersService.assignRestaurantIfNone.mockResolvedValue(false);

      await request(app.getHttpServer())
        .post('/v1/restaurants')
        .set('x-dev-user-id', NEWCOMER_ID)
        .send(REGISTRATION)
        .expect(409);
    });

    it('returns 400 with one message per problem, and saves nothing', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/restaurants')
        .set('x-dev-user-id', NEWCOMER_ID)
        .send({
          ...REGISTRATION,
          address: '',
          schedules: [
            {
              dayOfWeek: 3,
              isOpen24h: false,
              opensAt: '10:00',
              closesAt: '10:00',
            },
          ],
        })
        .expect(400);

      // schedules (declared in the subclass) is validated before the inherited fields.
      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: [
          'El miércoles: la hora de cierre debe ser distinta de la de apertura. Si abres todo el día, marca Abierto 24 horas.',
          'Escribe la dirección de tu restaurante.',
        ],
      });
      expect(restaurants.manager.transaction).not.toHaveBeenCalled();
    });

    it('rejects a restaurantId in the body: the restaurant always comes from the session', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/restaurants')
        .set('x-dev-user-id', NEWCOMER_ID)
        .send({ ...REGISTRATION, restaurantId: RESTAURANT_ID })
        .expect(400);

      expect(res.body.message).toEqual([
        'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
      ]);
      expect(restaurants.manager.transaction).not.toHaveBeenCalled();
    });

    it('answers the generic 500 if the restaurant cannot be linked to the user', async () => {
      usersService.assignRestaurantIfNone.mockRejectedValue(
        new Error('assign failed'),
      );

      const res = await request(app.getHttpServer())
        .post('/v1/restaurants')
        .set('x-dev-user-id', NEWCOMER_ID)
        .send(REGISTRATION)
        .expect(500);

      expect(res.body.message).toBe(
        'No pudimos completar la acción. Intenta de nuevo en un momento.',
      );
    });
  });

  describe('GET /v1/restaurants/me', () => {
    it('returns 200 with the restaurant and its schedules in HH:MM', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/restaurants/me')
        .expect(200);

      expect(res.body).toEqual({
        id: RESTAURANT_ID,
        name: 'Casa 72',
        category: 'grill',
        address: 'Carrera 7 # 72-10',
        schedules: [
          {
            dayOfWeek: 2,
            isOpen24h: false,
            opensAt: '12:00',
            closesAt: '22:30',
          },
        ],
      });
      expect(restaurants.findOneBy).toHaveBeenCalledWith({ id: RESTAURANT_ID });
    });

    it('returns 403 with errorCode RESTAURANT_REQUIRED for a user without a restaurant', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/restaurants/me')
        .set('x-dev-user-id', NEWCOMER_ID)
        .expect(403);

      expect(res.body).toEqual({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Primero registra tu restaurante.',
        errorCode: 'RESTAURANT_REQUIRED',
      });
    });
  });

  it('documents both routes in Swagger', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(
      Object.keys(res.body.paths['/v1/restaurants'].post.responses).sort(),
    ).toEqual(['201', '400', '401', '409']);
    expect(
      Object.keys(res.body.paths['/v1/restaurants/me'].get.responses).sort(),
    ).toEqual(['200', '401', '403']);
    expect(res.body.components.schemas.RegisterRestaurantDto.required).toEqual([
      'name',
      'category',
      'address',
      'schedules',
    ]);
  });
});
