import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/index.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import {
  Clock,
  SearchAvailabilityModule,
} from './../src/modules/search-availability/index.js';
import { FakeDatabaseModule, fakeRepository } from './support/fake-database.js';
import {
  fakeFirebaseAuth,
  testUsers,
  usersRepository,
} from './support/test-accounts.js';

// Friday 2026-10-16 13:00 in Bogotá.
const FRIDAY_13H = new Date('2026-10-16T18:00:00Z');

const CASA_72 = '55bb0482-be1e-490b-9ba8-7533335d958b';
const CIERRA_EN_LA_TARDE = '6c1f3e2a-8b7d-4c5e-9f0a-1b2c3d4e5f60';
const SWITCH_CERRADO = '7d2e4f3b-9c8e-4d6f-a01b-2c3d4e5f6071';
const SIN_UBICACION = '8e3f5a4c-0d9f-4e7a-b12c-3d4e5f607182';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const ADDRESS = 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá';

// Rows of the restaurant-operations tables, with the entity property names.
const RESTAURANTS = [
  {
    id: CASA_72,
    name: 'Casa 72',
    category: 'colombian',
    address: ADDRESS,
    isOpen: true,
    latitude: 4.655671,
    longitude: -74.057006,
  },
  {
    id: CIERRA_EN_LA_TARDE,
    name: 'Solo noches',
    category: 'italian',
    address: 'Calle 71 # 9-10, Bogotá',
    isOpen: true,
    latitude: 4.6551,
    longitude: -74.0575,
  },
  {
    id: SWITCH_CERRADO,
    name: 'Cerrado hoy',
    category: null,
    address: null,
    isOpen: false,
    latitude: 4.656,
    longitude: -74.058,
  },
  {
    id: SIN_UBICACION,
    name: 'Sin ubicación',
    category: 'other',
    address: null,
    isOpen: true,
    latitude: null,
    longitude: null,
  },
];

const schedule = (
  restaurantId: string,
  dayOfWeek: number,
  opensAt: string | null,
  closesAt: string | null,
) => ({
  restaurantId,
  dayOfWeek,
  isOpen24h: opensAt === null,
  opensAt,
  closesAt,
});

// Stored unsorted, with seconds, as pg returns time columns.
const SCHEDULES = [
  schedule(CASA_72, 6, null, null),
  schedule(CASA_72, 5, '11:00:00', '02:00:00'),
  schedule(CASA_72, 1, '11:00:00', '23:00:00'),
  // Friday only from 18:00: closed at 13:00.
  schedule(CIERRA_EN_LA_TARDE, 5, '18:00:00', '23:00:00'),
  schedule(SWITCH_CERRADO, 5, '11:00:00', '22:00:00'),
  schedule(SIN_UBICACION, 5, '11:00:00', '22:00:00'),
];

// Casa 72: 1 of 2 free (available, 50 %).
const TABLES = [CASA_72, CIERRA_EN_LA_TARDE, SWITCH_CERRADO, SIN_UBICACION]
  .map((restaurantId) => ({
    restaurantId,
    capacity: 4,
    status: 'available',
    isActive: true,
  }))
  .concat({
    restaurantId: CASA_72,
    capacity: 2,
    status: 'occupied',
    isActive: true,
  });

const database = {
  Restaurant: fakeRepository(RESTAURANTS),
  RestaurantSchedule: fakeRepository(SCHEDULES),
  Table: fakeRepository(TABLES),
};

const USERS = testUsers(CASA_72);

// The owner's restaurant as the restaurant-operations repositories return it.
const OWNER_RESTAURANT = {
  id: CASA_72,
  name: 'Casa 72',
  category: 'colombian',
  address: ADDRESS,
  isOpen: true,
  latitude: 4.655671,
  longitude: -74.057006,
};
const OWNER_SCHEDULES = [
  {
    dayOfWeek: 1,
    isOpen24h: false,
    opensAt: '11:00:00',
    closesAt: '23:00:00',
  },
  {
    dayOfWeek: 5,
    isOpen24h: false,
    opensAt: '11:00:00',
    closesAt: '02:00:00',
  },
  { dayOfWeek: 6, isOpen24h: true, opensAt: null, closesAt: null },
];

const NOT_FOUND = {
  statusCode: 404,
  message: 'Este restaurante ya no está disponible.',
  error: 'Not Found',
  errorCode: 'RESTAURANT_NOT_FOUND',
};

const forbidden = (errorCode: string, message: string) => ({
  statusCode: 403,
  message,
  error: 'Forbidden',
  errorCode,
});

describe('Public restaurant detail (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    for (const repo of Object.values(database)) {
      repo.find.mockClear();
      repo.findOne.mockClear();
    }
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DEV_USER_ENABLED: 'false',
              FIREBASE_PROJECT_ID: 'firebase-project-example',
            }),
          ],
        }),
        FakeDatabaseModule.with(database),
        // Both modules declare routes under /restaurants.
        RestaurantOperationsModule,
        SearchAvailabilityModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => fakeFirebaseAuth)
      .overrideProvider(getRepositoryToken(User))
      .useValue(usersRepository(USERS))
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue({ findOneBy: vi.fn().mockResolvedValue(OWNER_RESTAURANT) })
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({ find: vi.fn().mockResolvedValue(OWNER_SCHEDULES) })
      .overrideProvider(getRepositoryToken(Table))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(TableStatusLog)
      .useValue({ record: vi.fn() })
      .overrideProvider(Clock)
      .useValue({ now: () => FRIDAY_13H })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (path: string, token = 'diner') =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);

  describe('200', () => {
    it('an open restaurant: contract shape, sorted HH:MM schedules, no distanceKm', async () => {
      const res = await get(`/v1/restaurants/${CASA_72}/public`).expect(200);

      expect(res.body).toStrictEqual({
        id: CASA_72,
        name: 'Casa 72',
        category: 'colombian',
        address: ADDRESS,
        latitude: 4.655671,
        longitude: -74.057006,
        schedules: [
          {
            dayOfWeek: 1,
            isOpen24h: false,
            opensAt: '11:00',
            closesAt: '23:00',
          },
          {
            dayOfWeek: 5,
            isOpen24h: false,
            opensAt: '11:00',
            closesAt: '02:00',
          },
          { dayOfWeek: 6, isOpen24h: true, opensAt: null, closesAt: null },
        ],
        isOpenNow: true,
        availability: 'available',
      });
    });

    it('the schedules are the same as GET /v1/restaurants/me gives the owner', async () => {
      const [detail, mine] = await Promise.all([
        get(`/v1/restaurants/${CASA_72}/public`),
        get('/v1/restaurants/me', 'owner'),
      ]);

      expect(detail.body.schedules).toStrictEqual(mine.body.schedules);
    });

    it.each([
      ['closed by schedule', CIERRA_EN_LA_TARDE],
      ['switched to Cerrado', SWITCH_CERRADO],
    ])('%s: isOpenNow false and closed', async (_case, id) => {
      const res = await get(`/v1/restaurants/${id}/public`).expect(200);

      expect(res.body.isOpenNow).toBe(false);
      expect(res.body.availability).toBe('closed');
    });

    it('a restaurant without category nor address answers null in both', async () => {
      const res = await get(`/v1/restaurants/${SWITCH_CERRADO}/public`).expect(
        200,
      );

      expect(res.body.category).toBeNull();
      expect(res.body.address).toBeNull();
    });

    it.each([
      ['4.655671', '-74.057006', 0],
      ['4.6766', '-74.0486', 2.51],
    ])('with lat=%s and lng=%s: distanceKm %f', async (lat, lng, km) => {
      const res = await get(
        `/v1/restaurants/${CASA_72}/public?lat=${lat}&lng=${lng}`,
      ).expect(200);

      expect(res.body.distanceKm).toBe(km);
    });
  });

  describe('404 RESTAURANT_NOT_FOUND', () => {
    it.each([
      ['a valid but unknown UUID', UNKNOWN],
      ['abc', 'abc'],
      ['me', 'me'],
      ['a restaurant without coordinates', SIN_UBICACION],
    ])('%s', async (_case, id) => {
      const res = await get(`/v1/restaurants/${id}/public`).expect(404);

      expect(res.body).toEqual(NOT_FOUND);
    });

    it('a malformed id never reaches the database', async () => {
      await get('/v1/restaurants/abc/public').expect(404);

      expect(database.Restaurant.findOne).not.toHaveBeenCalled();
      expect(database.Restaurant.find).not.toHaveBeenCalled();
    });
  });

  describe('400', () => {
    it.each([
      ['only lat', 'lat=4.65', ['Envía lat y lng juntas.']],
      [
        'empty lat',
        'lat=&lng=-74.05',
        ['La latitud (lat) debe ser un número entre -90 y 90.'],
      ],
      [
        'lat=0x10',
        'lat=0x10&lng=-74.05',
        ['La latitud (lat) debe ser un número entre -90 y 90.'],
      ],
      [
        'an unknown parameter',
        'zone=calle-72',
        ['El campo "zone" no se permite. Quítalo de la solicitud.'],
      ],
    ])('%s', async (_case, query, message) => {
      const res = await get(
        `/v1/restaurants/${CASA_72}/public?${query}`,
      ).expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        message,
        error: 'Bad Request',
      });
    });
  });

  describe('accounts', () => {
    it('a restaurant gets 403 RESTAURANT_ACCOUNT', async () => {
      const res = await get(
        `/v1/restaurants/${CASA_72}/public`,
        'owner',
      ).expect(403);

      expect(res.body).toEqual(
        forbidden(
          'RESTAURANT_ACCOUNT',
          'Esta es una cuenta de restaurante. Administra tu restaurante desde la web.',
        ),
      );
    });

    it('an account without profile gets 403 PROFILE_REQUIRED', async () => {
      const res = await get(
        `/v1/restaurants/${CASA_72}/public`,
        'noProfile',
      ).expect(403);

      expect(res.body).toEqual(
        forbidden('PROFILE_REQUIRED', 'Completa tu perfil para continuar.'),
      );
    });

    it('without a session gets 401', async () => {
      await request(app.getHttpServer())
        .get(`/v1/restaurants/${CASA_72}/public`)
        .expect(401);
    });
  });

  describe('routes of restaurant-operations under /restaurants still work', () => {
    it('GET /v1/restaurants/me for the restaurant, unchanged', async () => {
      await get('/v1/restaurants/me', 'owner')
        .expect(200)
        .expect({
          id: CASA_72,
          name: 'Casa 72',
          category: 'colombian',
          address: ADDRESS,
          latitude: 4.655671,
          longitude: -74.057006,
          schedules: [
            {
              dayOfWeek: 1,
              isOpen24h: false,
              opensAt: '11:00',
              closesAt: '23:00',
            },
            {
              dayOfWeek: 5,
              isOpen24h: false,
              opensAt: '11:00',
              closesAt: '02:00',
            },
            { dayOfWeek: 6, isOpen24h: true, opensAt: null, closesAt: null },
          ],
        });
    });

    it('GET /v1/restaurants/me/status for the restaurant, unchanged', async () => {
      await get('/v1/restaurants/me/status', 'owner')
        .expect(200)
        .expect({ isOpen: true });
    });

    it('GET /v1/restaurants/me is still a restaurant route: a diner gets 403 DINER_ACCOUNT', async () => {
      const res = await get('/v1/restaurants/me').expect(403);

      expect(res.body.errorCode).toBe('DINER_ACCOUNT');
    });

    it('GET /v1/restaurants/me/public is the public detail: 404 for a diner, not a restaurant route', async () => {
      const res = await get('/v1/restaurants/me/public').expect(404);

      expect(res.body).toEqual(NOT_FOUND);
    });
  });

  it('documents the route in Swagger', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const route = res.body.paths['/v1/restaurants/{id}/public'];
    const schema = res.body.components.schemas.PublicRestaurantResponseDto;

    expect(Object.keys(route)).toEqual(['get']);
    expect(Object.keys(route.get.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
    ]);
    expect(route.get.security).toEqual([{ bearer: [] }]);
    expect(
      route.get.parameters.map((p: { name: string; in: string }) => [
        p.name,
        p.in,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['id', 'path'],
        ['lat', 'query'],
        ['lng', 'query'],
      ]),
    );
    expect(Object.keys(schema.properties)).toEqual([
      'id',
      'name',
      'category',
      'address',
      'latitude',
      'longitude',
      'schedules',
      'isOpenNow',
      'availability',
      'distanceKm',
    ]);
    expect(schema.required).not.toContain('distanceKm');
    expect(schema.properties.availability.enum).toEqual([
      'available',
      'few',
      'none',
      'closed',
    ]);
    expect(schema.properties.category.nullable).toBe(true);
    expect(schema.properties.category.enum).toContain('colombian');
    expect(
      res.body.components.schemas.ErrorResponseDto.properties.errorCode.enum,
    ).toContain('RESTAURANT_NOT_FOUND');
    // The paths of restaurant-operations are still there.
    expect(res.body.paths).toHaveProperty(['/v1/restaurants/me']);
    expect(res.body.paths).toHaveProperty(['/v1/restaurants/me/status']);
  });
});
