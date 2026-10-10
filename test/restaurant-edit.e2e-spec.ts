import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const INVALID_ROLE_USER_ID = '00000000-0000-4000-8000-000000000001';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';

const users = [
  { id: OWNER_ID, role: 'restaurant_admin', restaurantId: RESTAURANT_ID },
  { id: NEWCOMER_ID, role: 'restaurant_admin', restaurantId: null },
  {
    id: INVALID_ROLE_USER_ID,
    role: 'unknown-role',
    restaurantId: RESTAURANT_ID,
  },
];

type ScheduleRow = Partial<RestaurantSchedule>;

// Stored as the database returns them (time columns as HH:MM:SS).
function scheduleRow(restaurantId: string, dayOfWeek: number): ScheduleRow {
  return {
    restaurantId,
    dayOfWeek,
    isOpen24h: false,
    opensAt: '09:00:00',
    closesAt: '22:00:00',
  };
}

// Prueba el contrato HTTP de PATCH /v1/restaurants/me sin PostgreSQL: un
// EntityManager simulado guarda horarios de dos restaurantes en memoria.
describe('Restaurant edit (e2e)', () => {
  let app: INestApplication<App>;
  let scheduleRows: ScheduleRow[];
  let restaurants: { manager: { transaction: ReturnType<typeof vi.fn> } };
  let storedRestaurant: Partial<Restaurant> | null;
  let manager: {
    findOne: ReturnType<typeof vi.fn>;
    merge: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    storedRestaurant = null;
    scheduleRows = [
      scheduleRow(RESTAURANT_ID, 1),
      scheduleRow(OTHER_RESTAURANT_ID, 1),
      scheduleRow(OTHER_RESTAURANT_ID, 2),
    ];
    manager = {
      findOne: vi.fn((_entity: unknown, options: { where: { id: string } }) =>
        Promise.resolve(
          storedRestaurant ?? {
            id: options.where.id,
            name: 'Nombre anterior',
            createdAt: new Date('2026-10-04T12:00:00Z'),
            updatedAt: new Date('2026-10-04T12:00:00Z'),
          },
        ),
      ),
      merge: vi.fn(
        (
          _entity: unknown,
          target: Restaurant,
          ...sources: Partial<Restaurant>[]
        ) => Object.assign(target, ...sources),
      ),
      save: vi.fn((entity: ScheduleRow[] | Restaurant) => {
        if (Array.isArray(entity)) {
          scheduleRows.push(...entity);
          return Promise.resolve(entity.map((row) => ({ ...row })));
        }
        return Promise.resolve({ ...entity });
      }),
      create: vi.fn((_entity: unknown, data: ScheduleRow) => ({ ...data })),
      delete: vi.fn((_entity: unknown, criteria: { restaurantId: string }) => {
        scheduleRows = scheduleRows.filter(
          (row) => row.restaurantId !== criteria.restaurantId,
        );
        return Promise.resolve({ affected: 1 });
      }),
      find: vi.fn(
        (_entity: unknown, options: { where: { restaurantId: string } }) =>
          Promise.resolve(
            scheduleRows.filter(
              (row) => row.restaurantId === options.where.restaurantId,
            ),
          ),
      ),
    };
    restaurants = {
      manager: {
        transaction: vi.fn((work: (transactionManager: unknown) => unknown) =>
          work(manager),
        ),
      },
    };

    await createApp();
  });

  // devUserEnabled 'false' turns on the Firebase resolver, so a request
  // without a Bearer token gets the 401.
  async function createApp(devUserEnabled = 'true') {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DEV_USER_ENABLED: devUserEnabled,
              DEV_USER_ID: OWNER_ID,
              FIREBASE_PROJECT_ID: 'firebase-project-example',
            }),
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
      .useValue(restaurants)
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({})
      .overrideProvider(getRepositoryToken(Table))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }

  afterEach(async () => {
    await app.close();
  });

  const savedMonday = {
    dayOfWeek: 1,
    isOpen24h: false,
    opensAt: '09:00',
    closesAt: '22:00',
  };

  it('returns 200 with the restaurant and its trimmed name', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({ name: '  La Esquina de Ana  ' })
      .expect(200);

    expect(res.body).toEqual({
      id: RESTAURANT_ID,
      name: 'La Esquina de Ana',
      schedules: [savedMonday],
    });
    expect(manager.findOne).toHaveBeenCalledWith(Restaurant, {
      where: { id: RESTAURANT_ID },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('saves and returns the category and the trimmed address', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({ category: 'italian', address: '  Calle 72 # 10-34, Bogotá ' })
      .expect(200);

    expect(res.body).toEqual({
      id: RESTAURANT_ID,
      name: 'Nombre anterior',
      category: 'italian',
      address: 'Calle 72 # 10-34, Bogotá',
      schedules: [savedMonday],
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: RESTAURANT_ID,
        category: 'italian',
        address: 'Calle 72 # 10-34, Bogotá',
      }),
    );
  });

  it('keeps the category and the address when only the name is sent', async () => {
    storedRestaurant = {
      id: RESTAURANT_ID,
      name: 'Nombre anterior',
      category: 'grill',
      address: 'Carrera 7 # 72-10',
      createdAt: new Date('2026-10-04T12:00:00Z'),
      updatedAt: new Date('2026-10-04T12:00:00Z'),
    };

    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({ name: 'La Esquina de Ana' })
      .expect(200);

    expect(res.body).toEqual({
      id: RESTAURANT_ID,
      name: 'La Esquina de Ana',
      category: 'grill',
      address: 'Carrera 7 # 72-10',
      schedules: [savedMonday],
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'grill',
        address: 'Carrera 7 # 72-10',
      }),
    );
  });

  it('replaces the schedules and returns them ordered from Monday to Sunday', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({
        schedules: [
          { dayOfWeek: 7, isOpen24h: true },
          {
            dayOfWeek: 5,
            isOpen24h: false,
            opensAt: '18:00',
            closesAt: '02:00',
          },
        ],
      })
      .expect(200);

    expect(res.body).toEqual({
      id: RESTAURANT_ID,
      name: 'Nombre anterior',
      schedules: [
        { dayOfWeek: 5, isOpen24h: false, opensAt: '18:00', closesAt: '02:00' },
        { dayOfWeek: 7, isOpen24h: true, opensAt: null, closesAt: null },
      ],
    });
    expect(manager.delete).toHaveBeenCalledWith(RestaurantSchedule, {
      restaurantId: RESTAURANT_ID,
    });
  });

  it('leaves the schedules of another restaurant unchanged', async () => {
    const otherBefore = scheduleRows.filter(
      (row) => row.restaurantId === OTHER_RESTAURANT_ID,
    );

    await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({ schedules: [{ dayOfWeek: 3, isOpen24h: true }] })
      .expect(200);

    expect(
      scheduleRows.filter((row) => row.restaurantId === OTHER_RESTAURANT_ID),
    ).toEqual(otherBefore);
    expect(
      scheduleRows.filter((row) => row.restaurantId === RESTAURANT_ID),
    ).toEqual([
      {
        restaurantId: RESTAURANT_ID,
        dayOfWeek: 3,
        isOpen24h: true,
        opensAt: null,
        closesAt: null,
      },
    ]);
  });

  it.each([
    ['a category outside the list', { category: 'pizza' }],
    ['a null category', { category: null }],
    ['an empty address', { address: '   ' }],
    ['a null address', { address: null }],
    ['an empty schedules list', { schedules: [] }],
    ['null schedules', { schedules: null }],
    [
      'a repeated day',
      { schedules: [savedMonday, { ...savedMonday, opensAt: '10:00' }] },
    ],
  ])('returns 400 for %s and updates nothing', async (_case, body) => {
    await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send(body)
      .expect(400);
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty body, with a clear message', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({})
      .expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: [
        'No hay cambios para guardar. Cambia al menos un dato del restaurante.',
      ],
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['longer than 120 characters', 'x'.repeat(121)],
  ])('returns 400 for a name that is %s', async (_case, name) => {
    await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({ name })
      .expect(400);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects a restaurantId in the body and updates nothing', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({ name: 'Otro nombre', restaurantId: OTHER_RESTAURANT_ID })
      .expect(400);

    expect(res.body.message).toEqual([
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
    ]);
    expect(manager.findOne).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects a restaurantId next to the schedules and touches no schedule', async () => {
    await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({
        restaurantId: OTHER_RESTAURANT_ID,
        schedules: [{ dayOfWeek: 1, isOpen24h: true }],
      })
      .expect(400);

    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('returns 403 with errorCode RESTAURANT_REQUIRED for a user without a restaurant', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .set('x-dev-user-id', NEWCOMER_ID)
      .send({ name: 'La Esquina de Ana' })
      .expect(403);

    expect(res.body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Primero registra tu restaurante.',
      errorCode: 'RESTAURANT_REQUIRED',
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('returns 403 without errorCode for an invalid role and touches nothing', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .set('x-dev-user-id', INVALID_ROLE_USER_ID)
      .send({ name: 'Otro nombre', schedules: [savedMonday] })
      .expect(403);

    expect(res.body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'No tienes acceso a esta sección.',
    });
    expect(restaurants.manager.transaction).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('returns 401 without a session (development user turned off)', async () => {
    await app.close();
    await createApp('false');

    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({ name: 'Otro nombre' })
      .expect(401);

    expect(res.body).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Tu sesión terminó. Inicia sesión de nuevo.',
    });
    expect(restaurants.manager.transaction).not.toHaveBeenCalled();
  });

  it('documents the route in Swagger, next to the GET of the registration', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const route = res.body.paths['/v1/restaurants/me'];

    expect(Object.keys(route).sort()).toEqual(['get', 'patch']);
    expect(Object.keys(route.patch.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
    ]);
    expect(
      route.patch.responses['200'].content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/RestaurantProfileResponseDto');
    expect(
      Object.keys(res.body.components.schemas.UpdateRestaurantDto.properties),
    ).toEqual(['name', 'category', 'address', 'schedules']);
    expect(
      res.body.components.schemas.UpdateRestaurantDto.required ?? [],
    ).toEqual([]);
  });
});
