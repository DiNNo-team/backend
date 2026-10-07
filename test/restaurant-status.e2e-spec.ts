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
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_OWNER_ID = '7c6b5a49-3827-4615-a4b3-c2d1e0f9a8b7';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';

const users = [
  { id: OWNER_ID, role: 'restaurant_admin', restaurantId: RESTAURANT_ID },
  {
    id: OTHER_OWNER_ID,
    role: 'restaurant_admin',
    restaurantId: OTHER_RESTAURANT_ID,
  },
  { id: NEWCOMER_ID, role: 'restaurant_admin', restaurantId: null },
];

const IS_OPEN_MESSAGE = 'Elige si el restaurante está Abierto o Cerrado.';

// Prueba el contrato HTTP de GET y PATCH /v1/restaurants/me/status sin PostgreSQL.
describe('Restaurant status (e2e)', () => {
  let app: INestApplication<App>;
  let stored: Map<string, Restaurant>;
  let restaurants: {
    findOneBy: ReturnType<typeof vi.fn>;
    merge: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };

  async function createApp(devUserEnabled: boolean) {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DEV_USER_ENABLED: String(devUserEnabled),
              DEV_USER_ID: OWNER_ID,
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
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }

  beforeEach(async () => {
    const restaurant = (id: string, name: string): Restaurant => ({
      id,
      name,
      category: null,
      address: null,
      isOpen: true,
      createdAt: new Date('2026-10-04T12:00:00Z'),
      updatedAt: new Date('2026-10-04T12:00:00Z'),
    });
    stored = new Map([
      [RESTAURANT_ID, restaurant(RESTAURANT_ID, 'La Esquina de Ana')],
      [OTHER_RESTAURANT_ID, restaurant(OTHER_RESTAURANT_ID, 'Otro')],
    ]);
    // In-memory repository: a PATCH followed by a GET sees the saved value.
    restaurants = {
      findOneBy: vi.fn(({ id }: { id: string }) => {
        const found = stored.get(id);
        return Promise.resolve(found ? { ...found } : null);
      }),
      merge: vi.fn((target: Restaurant, ...sources: Partial<Restaurant>[]) =>
        Object.assign(target, ...sources),
      ),
      save: vi.fn((restaurant: Restaurant) => {
        stored.set(restaurant.id, { ...restaurant });
        return Promise.resolve({ ...restaurant });
      }),
    };

    await createApp(true);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with the state of the session restaurant, open by default', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/restaurants/me/status')
      .expect(200);

    expect(res.body).toEqual({ isOpen: true });
    expect(restaurants.findOneBy).toHaveBeenCalledWith({ id: RESTAURANT_ID });
  });

  it('closes the restaurant and a later GET returns it closed', async () => {
    const patch = await request(app.getHttpServer())
      .patch('/v1/restaurants/me/status')
      .send({ isOpen: false })
      .expect(200);
    expect(patch.body).toEqual({ isOpen: false });

    const get = await request(app.getHttpServer())
      .get('/v1/restaurants/me/status')
      .expect(200);
    expect(get.body).toEqual({ isOpen: false });
  });

  it('opens it again', async () => {
    await request(app.getHttpServer())
      .patch('/v1/restaurants/me/status')
      .send({ isOpen: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me/status')
      .send({ isOpen: true })
      .expect(200);

    expect(res.body).toEqual({ isOpen: true });
  });

  it('does not change the restaurant of another user', async () => {
    await request(app.getHttpServer())
      .patch('/v1/restaurants/me/status')
      .send({ isOpen: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/v1/restaurants/me/status')
      .set('x-dev-user-id', OTHER_OWNER_ID)
      .expect(200);

    expect(res.body).toEqual({ isOpen: true });
    expect(stored.get(OTHER_RESTAURANT_ID)?.isOpen).toBe(true);
    expect(restaurants.save).toHaveBeenCalledTimes(1);
    expect(restaurants.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: RESTAURANT_ID }),
    );
  });

  it.each([
    ['missing', {}],
    ['text instead of a boolean', { isOpen: 'true' }],
    ['a number', { isOpen: 0 }],
    ['null', { isOpen: null }],
  ])('returns 400 when isOpen is %s', async (_case, body) => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me/status')
      .send(body)
      .expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: [IS_OPEN_MESSAGE],
    });
    expect(restaurants.save).not.toHaveBeenCalled();
  });

  it('rejects extra fields, such as a restaurantId, and changes nothing', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/restaurants/me/status')
      .send({ isOpen: false, restaurantId: OTHER_RESTAURANT_ID })
      .expect(400);

    expect(res.body.message).toEqual([
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
    ]);
    expect(restaurants.findOneBy).not.toHaveBeenCalled();
    expect(restaurants.save).not.toHaveBeenCalled();
  });

  it.each([
    [
      'GET',
      () => request(app.getHttpServer()).get('/v1/restaurants/me/status'),
    ],
    [
      'PATCH',
      () =>
        request(app.getHttpServer())
          .patch('/v1/restaurants/me/status')
          .send({ isOpen: false }),
    ],
  ])(
    '%s returns 403 with errorCode RESTAURANT_REQUIRED for a user without a restaurant',
    async (_method, send) => {
      const res = await send().set('x-dev-user-id', NEWCOMER_ID).expect(403);

      expect(res.body).toEqual({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Primero registra tu restaurante.',
        errorCode: 'RESTAURANT_REQUIRED',
      });
      expect(restaurants.save).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'GET',
      () => request(app.getHttpServer()).get('/v1/restaurants/me/status'),
    ],
    [
      'PATCH',
      () =>
        request(app.getHttpServer())
          .patch('/v1/restaurants/me/status')
          .send({ isOpen: false }),
    ],
  ])(
    '%s returns 401 without a session (development user turned off)',
    async (_method, send) => {
      await app.close();
      await createApp(false);

      await send().expect(401);
      expect(restaurants.findOneBy).not.toHaveBeenCalled();
      expect(restaurants.save).not.toHaveBeenCalled();
    },
  );

  it('documents both routes in Swagger', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const route = res.body.paths['/v1/restaurants/me/status'];

    expect(Object.keys(route).sort()).toEqual(['get', 'patch']);
    expect(Object.keys(route.get.responses).sort()).toEqual([
      '200',
      '401',
      '403',
    ]);
    expect(Object.keys(route.patch.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
    ]);
    expect(
      Object.keys(
        res.body.components.schemas.UpdateRestaurantStatusDto.properties,
      ),
    ).toEqual(['isOpen']);
    expect(
      res.body.components.schemas.UpdateRestaurantStatusDto.required,
    ).toEqual(['isOpen']);
  });
});
