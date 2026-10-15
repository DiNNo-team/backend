import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
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

const CASA_72 = 'a4765bce-fc28-496c-bdbc-68bd1599f1d9';
const PARQUE_93 = '55bb0482-be1e-490b-9ba8-7533335d958b';
const CERRADO = '6c1f3e2a-8b7d-4c5e-9f0a-1b2c3d4e5f60';
const SIN_UBICACION = '7d2e4f3b-9c8e-4d6f-a01b-2c3d4e5f6071';
const KENNEDY = '8e3f5a4c-0d9f-4e7a-b12c-3d4e5f607182';
// Usaquén, more than 5 km from Casa 72: the party size cases.
const PAREJAS = '9f4a6b5d-1e0a-4f8b-823d-4e5f60718293';
const GRANDE_OCUPADA = 'a05b7c6e-2f1b-4a9c-934e-5f60718293a4';
const GRANDE_INACTIVA = 'b16c8d7f-3a2c-4b0d-a45f-60718293a4b5';
const GRANDE_LIBRE = 'c27d9e8a-4b3d-4c1e-b56a-718293a4b5c6';

// Rows of the restaurant-operations tables, with the entity property names.
const RESTAURANTS = [
  {
    id: CASA_72,
    name: 'Casa 72',
    category: 'colombian',
    address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
    isOpen: true,
    latitude: 4.655671,
    longitude: -74.057006,
  },
  {
    id: PARQUE_93,
    name: 'Parque 93 Grill',
    category: 'grill',
    address: 'Cra. 13 # 93-40, Bogotá',
    isOpen: true,
    latitude: 4.6766,
    longitude: -74.0486,
  },
  // Near Casa 72 but switched to Cerrado: never in the search.
  {
    id: CERRADO,
    name: 'Cerrado',
    category: 'cafe',
    address: 'Calle 71 # 9-10, Bogotá',
    isOpen: false,
    latitude: 4.6551,
    longitude: -74.0575,
  },
  // Without coordinates: never in the search.
  {
    id: SIN_UBICACION,
    name: 'Sin ubicación',
    category: 'other',
    address: null,
    isOpen: true,
    latitude: null,
    longitude: null,
  },
  {
    id: KENNEDY,
    name: 'Kennedy',
    category: 'mexican',
    address: 'Av. Primero de Mayo # 70-20, Bogotá',
    isOpen: true,
    latitude: 4.6285,
    longitude: -74.1525,
  },
  {
    id: PAREJAS,
    name: 'Parejas',
    category: 'italian',
    address: 'Calle 119 # 6-10, Bogotá',
    isOpen: true,
    latitude: 4.6995,
    longitude: -74.0305,
  },
  {
    id: GRANDE_OCUPADA,
    name: 'Mesa grande ocupada',
    category: 'colombian',
    address: 'Calle 120 # 6-20, Bogotá',
    isOpen: true,
    latitude: 4.7,
    longitude: -74.03,
  },
  {
    id: GRANDE_INACTIVA,
    name: 'Mesa grande inactiva',
    category: 'colombian',
    address: 'Calle 120 # 5-30, Bogotá',
    isOpen: true,
    latitude: 4.7005,
    longitude: -74.0295,
  },
  {
    id: GRANDE_LIBRE,
    name: 'Mesa grande libre',
    category: 'colombian',
    address: 'Calle 121 # 5-40, Bogotá',
    isOpen: true,
    latitude: 4.701,
    longitude: -74.029,
  },
];

// Every restaurant opens Friday 12:00-22:00.
const SCHEDULES = RESTAURANTS.map(({ id }) => ({
  restaurantId: id,
  dayOfWeek: 5,
  isOpen24h: false,
  opensAt: '12:00:00',
  closesAt: '22:00:00',
}));

// Casa 72: 1 of 4 free (few). Parque 93 and Kennedy: all free (available).
const TABLES = [
  { restaurantId: CASA_72, capacity: 4, status: 'available', isActive: true },
  { restaurantId: CASA_72, capacity: 4, status: 'occupied', isActive: true },
  { restaurantId: CASA_72, capacity: 2, status: 'occupied', isActive: true },
  { restaurantId: CASA_72, capacity: 2, status: 'reserved', isActive: true },
  { restaurantId: PARQUE_93, capacity: 4, status: 'available', isActive: true },
  { restaurantId: CERRADO, capacity: 4, status: 'available', isActive: true },
  {
    restaurantId: SIN_UBICACION,
    capacity: 4,
    status: 'available',
    isActive: true,
  },
  { restaurantId: KENNEDY, capacity: 4, status: 'available', isActive: true },
  // Usaquén. For a party of 6, only Mesa grande libre has a table: Parejas
  // only has small free tables, and the big table of the other two is
  // occupied or inactive.
  { restaurantId: PAREJAS, capacity: 2, status: 'available', isActive: true },
  { restaurantId: PAREJAS, capacity: 2, status: 'available', isActive: true },
  {
    restaurantId: GRANDE_OCUPADA,
    capacity: 8,
    status: 'occupied',
    isActive: true,
  },
  {
    restaurantId: GRANDE_OCUPADA,
    capacity: 2,
    status: 'available',
    isActive: true,
  },
  {
    restaurantId: GRANDE_INACTIVA,
    capacity: 8,
    status: 'available',
    isActive: false,
  },
  {
    restaurantId: GRANDE_INACTIVA,
    capacity: 2,
    status: 'available',
    isActive: true,
  },
  {
    restaurantId: GRANDE_LIBRE,
    capacity: 8,
    status: 'available',
    isActive: true,
  },
  {
    restaurantId: GRANDE_LIBRE,
    capacity: 2,
    status: 'occupied',
    isActive: true,
  },
];

const repositories = {
  Restaurant: fakeRepository(RESTAURANTS),
  RestaurantSchedule: fakeRepository(SCHEDULES),
  Table: fakeRepository(TABLES),
};

const USERS = testUsers(CASA_72);

const CATEGORY_INVALID =
  'La categoría (category) debe ser una de estas: colombian, italian, mexican, asian, grill, fast_food, healthy, seafood, cafe, other.';
const PARTY_SIZE_INVALID =
  'El número de personas (partySize) debe ser un número entero entre 1 y 20.';

const ACCOUNT_MESSAGES = {
  PROFILE_REQUIRED: 'Completa tu perfil para continuar.',
  RESTAURANT_ACCOUNT:
    'Esta es una cuenta de restaurante. Administra tu restaurante desde la web.',
};

describe('Search (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    for (const repo of Object.values(repositories)) {
      repo.find.mockClear();
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
        FakeDatabaseModule.with(repositories),
        SearchAvailabilityModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => fakeFirebaseAuth)
      .overrideProvider(getRepositoryToken(User))
      .useValue(usersRepository(USERS))
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

  describe('GET /v1/search/zones', () => {
    it('answers the 20 zones sorted by name, without querying the database', async () => {
      const res = await get('/v1/search/zones').expect(200);

      expect(res.body).toHaveLength(20);
      const names = res.body.map((zone: { name: string }) => zone.name);
      expect(names).toEqual(
        [...names].sort((a: string, b: string) => a.localeCompare(b, 'es')),
      );
      expect(res.body[0]).toStrictEqual({
        id: 'calle-72',
        name: 'Calle 72',
        latitude: 4.6557,
        longitude: -74.057,
      });
      expect(repositories.Restaurant.find).not.toHaveBeenCalled();
    });
  });

  describe('GET /v1/search/restaurants', () => {
    it('by location: the searchable restaurants in the radius, closest first', async () => {
      const res = await get(
        '/v1/search/restaurants?lat=4.655671&lng=-74.057006&radiusKm=5',
      ).expect(200);

      expect(res.body).toStrictEqual([
        {
          id: CASA_72,
          name: 'Casa 72',
          category: 'colombian',
          address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
          latitude: 4.655671,
          longitude: -74.057006,
          distanceKm: 0,
          availability: 'few',
        },
        {
          id: PARQUE_93,
          name: 'Parque 93 Grill',
          category: 'grill',
          address: 'Cra. 13 # 93-40, Bogotá',
          latitude: 4.6766,
          longitude: -74.0486,
          distanceKm: 2.51,
          availability: 'available',
        },
      ]);
    });

    it('by location: the default radius of 2 km leaves Parque 93 (2.51 km) out', async () => {
      const res = await get(
        '/v1/search/restaurants?lat=4.655671&lng=-74.057006',
      ).expect(200);

      expect(res.body.map((r: { id: string }) => r.id)).toEqual([CASA_72]);
    });

    it('by zone: searches around the centre of the zone', async () => {
      const res = await get('/v1/search/restaurants?zone=kennedy').expect(200);

      expect(res.body).toStrictEqual([
        expect.objectContaining({
          id: KENNEDY,
          availability: 'available',
          distanceKm: expect.any(Number),
        }),
      ]);
      expect(res.body[0].distanceKm).toBeLessThan(0.2);
    });

    it('answers [] far from every restaurant (a location outside Bogotá)', async () => {
      await get('/v1/search/restaurants?lat=6.2442&lng=-75.5812')
        .expect(200)
        .expect([]);
    });
  });

  describe('filters', () => {
    const ids = (res: { body: { id: string }[] }) =>
      res.body.map((restaurant) => restaurant.id);

    it('category=colombian: only the Colombian restaurants', async () => {
      const res = await get(
        '/v1/search/restaurants?zone=calle-72&radiusKm=5&category=colombian',
      ).expect(200);

      // Parque 93 (grill) is in the radius but not Colombian.
      expect(ids(res)).toEqual([CASA_72]);
      expect(res.body[0].category).toBe('colombian');
    });

    it('category=italian with no Italian restaurant around: []', async () => {
      await get(
        '/v1/search/restaurants?zone=calle-72&radiusKm=5&category=italian',
      )
        .expect(200)
        .expect([]);
    });

    it('without filters, Usaquén has the four restaurants', async () => {
      const res = await get('/v1/search/restaurants?zone=usaquen').expect(200);

      expect(ids(res).sort()).toEqual(
        [PAREJAS, GRANDE_OCUPADA, GRANDE_INACTIVA, GRANDE_LIBRE].sort(),
      );
    });

    it('partySize leaves out small free tables and big tables that are occupied or inactive', async () => {
      const res = await get(
        '/v1/search/restaurants?zone=usaquen&partySize=6',
      ).expect(200);

      expect(ids(res)).toEqual([GRANDE_LIBRE]);
    });

    it('partySize=2 keeps all four (each has a free active table for 2)', async () => {
      const res = await get(
        '/v1/search/restaurants?zone=usaquen&partySize=2',
      ).expect(200);

      expect(res.body).toHaveLength(4);
    });

    it.each([
      ['colombian', 6, [GRANDE_LIBRE]],
      ['italian', 2, [PAREJAS]],
      ['italian', 6, []],
    ])(
      'zone + category=%s + partySize=%i',
      async (category, partySize, expected) => {
        const res = await get(
          `/v1/search/restaurants?zone=usaquen&category=${category}&partySize=${partySize}`,
        ).expect(200);

        expect(ids(res)).toEqual(expected);
      },
    );
  });

  describe('accounts', () => {
    it.each(['/v1/search/zones', '/v1/search/restaurants?zone=calle-72'])(
      '%s: a restaurant gets 403 RESTAURANT_ACCOUNT',
      async (path) => {
        const res = await get(path, 'owner').expect(403);

        expect(res.body).toEqual({
          statusCode: 403,
          message: ACCOUNT_MESSAGES.RESTAURANT_ACCOUNT,
          error: 'Forbidden',
          errorCode: 'RESTAURANT_ACCOUNT',
        });
        expect(repositories.Restaurant.find).not.toHaveBeenCalled();
      },
    );

    it.each(['/v1/search/zones', '/v1/search/restaurants?zone=calle-72'])(
      '%s: an account without profile gets 403 PROFILE_REQUIRED',
      async (path) => {
        const res = await get(path, 'noProfile').expect(403);

        expect(res.body).toEqual({
          statusCode: 403,
          message: ACCOUNT_MESSAGES.PROFILE_REQUIRED,
          error: 'Forbidden',
          errorCode: 'PROFILE_REQUIRED',
        });
      },
    );

    it.each(['/v1/search/zones', '/v1/search/restaurants?zone=calle-72'])(
      '%s: without a session gets 401',
      async (path) => {
        const res = await request(app.getHttpServer()).get(path).expect(401);

        expect(res.body).toEqual({
          statusCode: 401,
          message: 'Tu sesión terminó. Inicia sesión de nuevo.',
          error: 'Unauthorized',
        });
        expect(repositories.Restaurant.find).not.toHaveBeenCalled();
      },
    );
  });

  describe('400', () => {
    it.each([
      [
        'location and zone',
        'lat=4.65&lng=-74.05&zone=calle-72',
        'Busca por tu ubicación o por una zona, no por las dos.',
      ],
      [
        'no origin',
        'radiusKm=2',
        'Envía tu ubicación (lat y lng) o una zona para buscar.',
      ],
      ['only lat', 'lat=4.65', 'Envía lat y lng juntas.'],
      [
        'unknown zone',
        'zone=bogota',
        'No conocemos esa zona. Usa una de las que da GET /v1/search/zones.',
      ],
      [
        'radiusKm=3',
        'zone=calle-72&radiusKm=3',
        'El radio (radiusKm) debe ser 1, 2, 5 o 10.',
      ],
      [
        'an unknown parameter',
        'zone=calle-72&restaurantId=x',
        'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
      ],
      ['category=pizza', 'zone=calle-72&category=pizza', CATEGORY_INVALID],
      [
        'category=Colombian (case matters)',
        'zone=calle-72&category=Colombian',
        CATEGORY_INVALID,
      ],
      ['partySize=0', 'zone=calle-72&partySize=0', PARTY_SIZE_INVALID],
      ['partySize=21', 'zone=calle-72&partySize=21', PARTY_SIZE_INVALID],
      ['partySize=2.5', 'zone=calle-72&partySize=2.5', PARTY_SIZE_INVALID],
      ['empty partySize', 'zone=calle-72&partySize=', PARTY_SIZE_INVALID],
      // Number('0x10') is 16: only plain decimals are numbers.
      ['partySize=0x10', 'zone=calle-72&partySize=0x10', PARTY_SIZE_INVALID],
    ])('%s', async (_case, query, message) => {
      const res = await get(`/v1/search/restaurants?${query}`).expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        message: [message],
        error: 'Bad Request',
      });
      expect(repositories.Restaurant.find).not.toHaveBeenCalled();
    });

    it('empty lat and lng (not a search at 0, 0)', async () => {
      const res = await get('/v1/search/restaurants?lat=&lng=').expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        message: [
          'La latitud (lat) debe ser un número entre -90 y 90.',
          'La longitud (lng) debe ser un número entre -180 y 180.',
        ],
        error: 'Bad Request',
      });
      expect(repositories.Restaurant.find).not.toHaveBeenCalled();
    });
  });

  it('documents both routes in Swagger', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const zones = res.body.paths['/v1/search/zones'];
    const search = res.body.paths['/v1/search/restaurants'];

    expect(Object.keys(zones.get.responses).sort()).toEqual([
      '200',
      '401',
      '403',
    ]);
    expect(Object.keys(search.get.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
    ]);
    expect(search.get.security).toEqual([{ bearer: [] }]);
    expect(
      search.get.parameters.map((p: { name: string }) => p.name).sort(),
    ).toEqual(['category', 'lat', 'lng', 'partySize', 'radiusKm', 'zone']);
    const param = (name: string) =>
      search.get.parameters.find((p: { name: string }) => p.name === name);
    const categories = [
      'colombian',
      'italian',
      'mexican',
      'asian',
      'grill',
      'fast_food',
      'healthy',
      'seafood',
      'cafe',
      'other',
    ];
    expect(param('category').schema.enum).toEqual(categories);
    expect(param('partySize').schema).toEqual(
      expect.objectContaining({ type: 'integer', minimum: 1, maximum: 20 }),
    );
    const resultCategory =
      res.body.components.schemas.SearchResultDto.properties.category;
    expect(resultCategory.enum).toEqual(categories);
    expect(resultCategory.nullable).toBe(true);
    expect(
      Object.keys(res.body.components.schemas.SearchResultDto.properties),
    ).toEqual([
      'id',
      'name',
      'category',
      'address',
      'latitude',
      'longitude',
      'distanceKm',
      'availability',
    ]);
  });
});
