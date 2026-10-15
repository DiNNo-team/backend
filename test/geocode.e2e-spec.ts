import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import { UserRole } from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { Geocoder } from './../src/modules/restaurant-operations/geocoding/geocoder.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import {
  fakeFirebaseAuth,
  testUsers,
  usersRepository,
} from './support/test-accounts.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const ADDRESS = 'Cra. 11 #72-30';

const FOUND = {
  kind: 'found',
  latitude: 4.655671,
  longitude: -74.057006,
  formattedAddress: 'Cra. 11 #72-30, Bogotá, Colombia',
} as const;

// Users of the test accounts; the owner's restaurant is set per app, so the
// same token covers a restaurant with and without a registered restaurant.
function usersWithOwnerRestaurant(restaurantId: string | null): User[] {
  return testUsers(RESTAURANT_ID).map((user) =>
    user.role === UserRole.RESTAURANT_ADMIN ? { ...user, restaurantId } : user,
  );
}

// Prueba el contrato HTTP de GET /v1/geocode con un Geocoder falso: sin Google,
// sin llave y sin base de datos.
describe('Geocode (e2e)', () => {
  let app: INestApplication<App>;
  let geocoder: { geocode: ReturnType<typeof vi.fn> };

  async function createApp(ownerRestaurantId: string | null = RESTAURANT_ID) {
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
        RestaurantOperationsModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => fakeFirebaseAuth)
      .overrideProvider(getRepositoryToken(User))
      .useValue(usersRepository(usersWithOwnerRestaurant(ownerRestaurantId)))
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue({})
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({})
      .overrideProvider(getRepositoryToken(Table))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(Geocoder)
      .useValue(geocoder)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }

  beforeEach(async () => {
    geocoder = { geocode: vi.fn().mockResolvedValue(FOUND) };
    await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const geocode = (
    query: Record<string, string>,
    token: string | null = 'owner',
  ) => {
    const req = request(app.getHttpServer()).get('/v1/geocode').query(query);
    return token === null ? req : req.set('Authorization', `Bearer ${token}`);
  };

  it('returns 200 with the coordinates and the formatted address', async () => {
    const res = await geocode({ address: `  ${ADDRESS} ` }).expect(200);

    expect(res.body).toEqual({
      latitude: 4.655671,
      longitude: -74.057006,
      formattedAddress: 'Cra. 11 #72-30, Bogotá, Colombia',
    });
    // Trimmed, with the "#" intact.
    expect(geocoder.geocode).toHaveBeenCalledWith(ADDRESS);
  });

  it('returns 200 for a restaurant account without a registered restaurant (no RESTAURANT_REQUIRED)', async () => {
    await app.close();
    await createApp(null);

    const res = await geocode({ address: ADDRESS }).expect(200);

    expect(res.body.latitude).toBe(4.655671);
  });

  it('returns 404 ADDRESS_NOT_FOUND when there is no result in Bogotá', async () => {
    geocoder.geocode.mockResolvedValue({ kind: 'not_found' });

    const res = await geocode({ address: ADDRESS }).expect(404);

    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message:
        'No encontramos esa dirección en Bogotá. Mueve el pin al lugar correcto.',
      errorCode: 'ADDRESS_NOT_FOUND',
    });
  });

  it('returns 503 GEOCODING_UNAVAILABLE when the provider is not available', async () => {
    geocoder.geocode.mockResolvedValue({ kind: 'unavailable' });

    const res = await geocode({ address: ADDRESS }).expect(503);

    expect(res.body).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message:
        'No pudimos ubicar la dirección en este momento. Mueve el pin al lugar correcto.',
      errorCode: 'GEOCODING_UNAVAILABLE',
    });
  });

  it.each([
    ['missing', {}, 'Escribe la dirección que quieres ubicar.'],
    ['empty', { address: '' }, 'Escribe la dirección que quieres ubicar.'],
    [
      'only spaces',
      { address: '   ' },
      'Escribe la dirección que quieres ubicar.',
    ],
    [
      '2 characters',
      { address: '72' },
      'La dirección es muy corta. Escribe al menos 3 caracteres.',
    ],
    [
      '256 characters',
      { address: 'x'.repeat(256) },
      'La dirección es muy larga. Usa máximo 255 caracteres.',
    ],
    [
      'a line break',
      { address: 'Calle 72\n# 10-34' },
      'La dirección no puede incluir caracteres invisibles ni saltos de línea.',
    ],
  ])(
    'returns 400 for an address that is %s, without geocoding',
    async (_case, query, message) => {
      const res = await geocode(query).expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: [message],
      });
      expect(geocoder.geocode).not.toHaveBeenCalled();
    },
  );

  it('accepts exactly 3 and 255 characters', async () => {
    await geocode({ address: 'C72' }).expect(200);
    await geocode({ address: 'x'.repeat(255) }).expect(200);
  });

  it('returns 400 for a parameter that does not exist', async () => {
    const res = await geocode({
      address: ADDRESS,
      restaurantId: RESTAURANT_ID,
    }).expect(400);

    expect(res.body.message).toEqual([
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
    ]);
  });

  it('returns 403 DINER_ACCOUNT for a diner, without geocoding', async () => {
    const res = await geocode({ address: ADDRESS }, 'diner').expect(403);

    expect(res.body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message:
        'Esta es una cuenta de comensal. Para buscar mesa, usa la app DiNNo.',
      errorCode: 'DINER_ACCOUNT',
    });
    expect(geocoder.geocode).not.toHaveBeenCalled();
  });

  it('returns 403 ACCOUNT_NOT_ENABLED for an account without profile', async () => {
    const res = await geocode({ address: ADDRESS }, 'noProfile').expect(403);

    expect(res.body.errorCode).toBe('ACCOUNT_NOT_ENABLED');
    expect(geocoder.geocode).not.toHaveBeenCalled();
  });

  it.each([
    ['without a token', null],
    ['with an invalid token', 'not-a-token'],
  ])('returns 401 %s', async (_case, token) => {
    const res = await geocode({ address: ADDRESS }, token).expect(401);

    expect(res.body).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Tu sesión terminó. Inicia sesión de nuevo.',
    });
    expect(geocoder.geocode).not.toHaveBeenCalled();
  });

  it('documents the route in Swagger', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const route = res.body.paths['/v1/geocode'];

    expect(Object.keys(route)).toEqual(['get']);
    expect(Object.keys(route.get.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '503',
    ]);
    expect(route.get.security).toBeDefined();
    expect(route.get.parameters).toEqual([
      expect.objectContaining({ name: 'address', in: 'query', required: true }),
    ]);
    expect(
      route.get.responses['200'].content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/GeocodeResponseDto');
    expect(
      Object.keys(res.body.components.schemas.GeocodeResponseDto.properties),
    ).toEqual(['latitude', 'longitude', 'formattedAddress']);
    expect(
      res.body.components.schemas.ErrorResponseDto.properties.errorCode.enum,
    ).toEqual(
      expect.arrayContaining(['ADDRESS_NOT_FOUND', 'GEOCODING_UNAVAILABLE']),
    );
  });
});
