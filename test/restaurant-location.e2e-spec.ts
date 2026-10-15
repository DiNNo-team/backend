import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import {
  UserRole,
  UsersService,
} from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const NEW_RESTAURANT_ID = '6e5d4c3b-2a19-4807-b6a5-948372615049';

const users = [
  {
    id: OWNER_ID,
    role: UserRole.RESTAURANT_ADMIN,
    restaurantId: RESTAURANT_ID,
  },
  { id: NEWCOMER_ID, role: UserRole.RESTAURANT_ADMIN, restaurantId: null },
];

const CASA_72 = { latitude: 4.655671, longitude: -74.057006 };

const REGISTRATION = {
  name: 'La Esquina de Ana',
  category: 'colombian',
  address: 'Calle 72 # 10-34, Bogotá',
  schedules: [{ dayOfWeek: 6, isOpen24h: true }],
};

const SATURDAY_24H = {
  dayOfWeek: 6,
  isOpen24h: true,
  opensAt: null,
  closesAt: null,
};

const LOCATION_MESSAGES = {
  latitude:
    'Ubica el restaurante dentro de Bogotá: la latitud debe ser un número entre 4.45 y 4.85.',
  longitude:
    'Ubica el restaurante dentro de Bogotá: la longitud debe ser un número entre -74.25 y -73.95.',
  incomplete: 'Envía la latitud y la longitud juntas, o ninguna de las dos.',
};

// Prueba latitude y longitude en POST /v1/restaurants, PATCH y GET
// /v1/restaurants/me sin PostgreSQL. La base simulada guarda un restaurante
// en memoria, como lo devolvería TypeORM (coordenadas number | null).
describe('Restaurant location (e2e)', () => {
  let app: INestApplication<App>;
  let stored: Partial<Restaurant>;
  let manager: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    stored = {
      id: RESTAURANT_ID,
      name: 'Casa 72',
      category: 'colombian',
      address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
      latitude: null,
      longitude: null,
    };
    manager = {
      findOne: vi.fn(() => Promise.resolve({ ...stored })),
      merge: vi.fn((_entity: unknown, target: object, ...sources: object[]) =>
        Object.assign(target, ...sources),
      ),
      create: vi.fn((_entity: unknown, data: object) => ({ ...data })),
      save: vi.fn((entity: object | object[]) => {
        if (Array.isArray(entity)) {
          return Promise.resolve(entity);
        }
        const saved = { id: NEW_RESTAURANT_ID, ...entity };
        stored = saved;
        return Promise.resolve({ ...saved });
      }),
      find: vi.fn(() => Promise.resolve([SATURDAY_24H])),
    };
    const restaurants = {
      findOneBy: vi.fn(() => Promise.resolve({ ...stored })),
      manager: {
        transaction: vi.fn((work: (m: unknown) => unknown) => work(manager)),
      },
    };

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
      .useValue({ find: vi.fn().mockResolvedValue([SATURDAY_24H]) })
      .overrideProvider(getRepositoryToken(Table))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(UsersService)
      .useValue({ assignRestaurantIfNone: vi.fn().mockResolvedValue(true) })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const register = (body: object) =>
    request(app.getHttpServer())
      .post('/v1/restaurants')
      .set('x-dev-user-id', NEWCOMER_ID)
      .send(body);
  const patch = (body: object) =>
    request(app.getHttpServer()).patch('/v1/restaurants/me').send(body);

  describe('POST /v1/restaurants', () => {
    it('returns 201 with the coordinates it saved', async () => {
      const res = await register({ ...REGISTRATION, ...CASA_72 }).expect(201);

      expect(res.body).toMatchObject(CASA_72);
      expect(manager.create).toHaveBeenCalledWith(
        Restaurant,
        expect.objectContaining(CASA_72),
      );
    });

    it('returns 201 with null coordinates when none are sent, as today', async () => {
      const res = await register(REGISTRATION).expect(201);

      expect(res.body).toMatchObject({ latitude: null, longitude: null });
    });

    it('returns 400 for only the latitude and creates nothing', async () => {
      const res = await register({
        ...REGISTRATION,
        latitude: CASA_72.latitude,
      }).expect(400);

      expect(res.body.message).toEqual([LOCATION_MESSAGES.incomplete]);
      expect(manager.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /v1/restaurants/me', () => {
    it('accepts only the coordinates as an edit', async () => {
      const res = await patch(CASA_72).expect(200);

      expect(res.body).toEqual({
        id: RESTAURANT_ID,
        name: 'Casa 72',
        category: 'colombian',
        address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
        ...CASA_72,
        schedules: [SATURDAY_24H],
      });
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: RESTAURANT_ID, ...CASA_72 }),
      );
    });

    it('saves and returns many decimals rounded to 6', async () => {
      const res = await patch({
        latitude: 4.65567149999,
        longitude: -74.05700651234,
      }).expect(200);

      expect(res.body).toMatchObject({
        latitude: 4.655671,
        longitude: -74.057007,
      });
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: 4.655671, longitude: -74.057007 }),
      );
    });

    it.each([
      [
        'only the latitude',
        { latitude: 4.655671 },
        [LOCATION_MESSAGES.incomplete],
      ],
      [
        'a point outside Bogotá (Medellín)',
        { latitude: 6.244203, longitude: -75.581212 },
        [LOCATION_MESSAGES.latitude, LOCATION_MESSAGES.longitude],
      ],
      [
        'null coordinates',
        { latitude: null, longitude: null },
        [LOCATION_MESSAGES.latitude, LOCATION_MESSAGES.longitude],
      ],
    ])(
      'returns 400 for %s and updates nothing',
      async (_case, body, messages) => {
        const res = await patch(body).expect(400);

        expect(res.body.message).toEqual(messages);
        expect(manager.save).not.toHaveBeenCalled();
      },
    );

    it('keeps the stored coordinates when only the name changes', async () => {
      stored = { ...stored, ...CASA_72 };

      const res = await patch({ name: 'Casa 72 Chapinero' }).expect(200);

      expect(res.body).toMatchObject({ name: 'Casa 72 Chapinero', ...CASA_72 });
    });
  });

  describe('GET /v1/restaurants/me', () => {
    it('includes the coordinates', async () => {
      stored = { ...stored, ...CASA_72 };

      const res = await request(app.getHttpServer())
        .get('/v1/restaurants/me')
        .expect(200);

      expect(res.body).toMatchObject(CASA_72);
    });

    it('answers null coordinates for a restaurant without location («Completa tu ubicación»)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/restaurants/me')
        .expect(200);

      expect(res.body).toMatchObject({ latitude: null, longitude: null });
    });
  });

  it('documents the coordinates in Swagger', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const { schemas } = res.body.components;

    for (const dto of ['RegisterRestaurantDto', 'UpdateRestaurantDto']) {
      expect(schemas[dto].properties).toMatchObject({
        latitude: { type: 'number', minimum: 4.45, maximum: 4.85 },
        longitude: { type: 'number', minimum: -74.25, maximum: -73.95 },
      });
      expect(schemas[dto].required ?? []).not.toContain('latitude');
      expect(schemas[dto].required ?? []).not.toContain('longitude');
    }
    expect(schemas.RestaurantProfileResponseDto.required).toEqual(
      expect.arrayContaining(['latitude', 'longitude']),
    );
  });
});
