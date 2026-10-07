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
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';

const users = [
  { id: OWNER_ID, role: 'restaurant_admin', restaurantId: RESTAURANT_ID },
  { id: NEWCOMER_ID, role: 'restaurant_admin', restaurantId: null },
];

// Prueba el contrato HTTP de PATCH /v1/restaurants/me sin PostgreSQL.
describe('Restaurant edit (e2e)', () => {
  let app: INestApplication<App>;
  let restaurants: {
    findOneBy: ReturnType<typeof vi.fn>;
    merge: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    restaurants = {
      findOneBy: vi.fn(({ id }: { id: string }) =>
        Promise.resolve({
          id,
          name: 'Nombre anterior',
          createdAt: new Date('2026-10-04T12:00:00Z'),
          updatedAt: new Date('2026-10-04T12:00:00Z'),
        }),
      ),
      merge: vi.fn((target: Restaurant, ...sources: Partial<Restaurant>[]) =>
        Object.assign(target, ...sources),
      ),
      save: vi.fn((restaurant: Restaurant) =>
        Promise.resolve({ ...restaurant }),
      ),
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
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with the restaurant and its trimmed name', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({ name: '  La Esquina de Ana  ' })
      .expect(200);

    expect(res.body).toEqual({
      id: RESTAURANT_ID,
      name: 'La Esquina de Ana',
    });
    expect(restaurants.findOneBy).toHaveBeenCalledWith({ id: RESTAURANT_ID });
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
    expect(restaurants.save).not.toHaveBeenCalled();
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
    expect(restaurants.save).not.toHaveBeenCalled();
  });

  it('rejects a restaurantId in the body and updates nothing', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me')
      .send({ name: 'Otro nombre', restaurantId: OTHER_RESTAURANT_ID })
      .expect(400);

    expect(res.body.message).toEqual([
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
    ]);
    expect(restaurants.findOneBy).not.toHaveBeenCalled();
    expect(restaurants.save).not.toHaveBeenCalled();
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
    expect(restaurants.save).not.toHaveBeenCalled();
  });

  it('documents the route in Swagger, and there is no GET of its own', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const route = res.body.paths['/v1/restaurants/me'];

    expect(Object.keys(route)).toEqual(['patch']);
    expect(Object.keys(route.patch.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
    ]);
    expect(
      Object.keys(res.body.components.schemas.UpdateRestaurantDto.properties),
    ).toEqual(['name']);
    expect(
      res.body.components.schemas.UpdateRestaurantDto.required ?? [],
    ).toEqual([]);
  });
});
