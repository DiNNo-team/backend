import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import { ACCOUNT_ERROR_MESSAGES } from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { CheckIn } from './../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { ReservationsCheckinModule } from './../src/modules/reservations-checkin/index.js';
import { ReservationExpirationService } from './../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { Reservation } from './../src/modules/reservations-checkin/reservations/reservation.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import { Clock } from './../src/modules/search-availability/index.js';
import {
  FakeDatabaseModule,
  fakeRepository,
  matches,
  type Row,
} from './support/fake-database.js';
import {
  fakeFirebaseAuth,
  testUsers,
  usersRepository,
} from './support/test-accounts.js';

// Friday 2026-10-16 13:00 en Bogotá.
const FRIDAY_13H = new Date('2026-10-16T18:00:00Z');

const OPEN = '55bb0482-be1e-490b-9ba8-7533335d958b';
const SWITCH_CERRADO = '7d2e4f3b-9c8e-4d6f-a01b-2c3d4e5f6071';
const SIN_UBICACION = '8e3f5a4c-0d9f-4e7a-b12c-3d4e5f607182';
const SIN_MESAS_GRANDES = '9f4a6b5d-1e0a-4f8b-823d-4e5f60718293';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const DINER_ID = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';

const restaurant = (id: string, overrides: Row = {}): Row => ({
  id,
  name: 'Casa 72',
  category: 'colombian',
  address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
  isOpen: true,
  latitude: 4.655671,
  longitude: -74.057006,
  ...overrides,
});

const RESTAURANTS = [
  restaurant(OPEN),
  restaurant(SWITCH_CERRADO, { name: 'Cerrado hoy', isOpen: false }),
  restaurant(SIN_UBICACION, { latitude: null, longitude: null }),
  restaurant(SIN_MESAS_GRANDES),
];

// Abiertos los viernes de 11:00 a 23:00 (13:00 está dentro).
const SCHEDULES = RESTAURANTS.map(({ id }) => ({
  restaurantId: id,
  dayOfWeek: 5,
  isOpen24h: false,
  opensAt: '11:00:00',
  closesAt: '23:00:00',
}));

const table = (
  id: string,
  restaurantId: string,
  identifier: string,
  capacity: number,
  overrides: Row = {},
): Row => ({
  id,
  restaurantId,
  identifier,
  capacity,
  status: 'available',
  isActive: true,
  ...overrides,
});

const CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

describe('POST /v1/reservations (e2e)', () => {
  let app: INestApplication<App>;
  let tables: Row[];
  let reservations: Row[];
  let statusLog: { record: ReturnType<typeof vi.fn> };

  // Base en memoria con lo justo: lecturas por nombre de entidad, la
  // transacción y los repositorios que usa el servicio de creación.
  function createDatabase() {
    const pick = (row: Row, select?: Record<string, true>) =>
      select
        ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))
        : { ...row };
    const tablesRepository = {
      find: vi.fn(
        ({
          where,
          select,
        }: {
          where: Record<string, unknown>;
          select?: Record<string, true>;
        }) =>
          Promise.resolve(
            tables
              .filter((row) => matches(row, where))
              .map((r) => pick(r, select)),
          ),
      ),
      findOne: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          tables
            .filter((row) => matches(row, where))
            .map((row) => ({ ...row }))[0] ?? null,
        ),
      ),
      update: vi.fn(
        (where: Record<string, unknown>, values: Record<string, unknown>) => {
          for (const row of tables.filter((r) => matches(r, where))) {
            Object.assign(row, values);
          }
          return Promise.resolve({});
        },
      ),
    };
    const reservationsRepository = {
      exists: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(reservations.some((row) => matches(row, where))),
      ),
      save: vi.fn((data: Row) => {
        const saved = {
          ...data,
          id: '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
          createdAt: FRIDAY_13H,
          updatedAt: FRIDAY_13H,
        };
        reservations.push(saved);
        return Promise.resolve(saved);
      }),
    };
    const manager = {
      getRepository: (target: unknown) =>
        target === Reservation ? reservationsRepository : tablesRepository,
    };
    const readOnly = fakeRepository(tables as Row[]);
    return {
      repositories: {
        Restaurant: fakeRepository(RESTAURANTS),
        RestaurantSchedule: fakeRepository(SCHEDULES),
        Table: { ...readOnly, find: tablesRepository.find },
      },
      extras: {
        transaction: (work: (m: unknown) => Promise<unknown>) => work(manager),
      },
    };
  }

  beforeEach(async () => {
    tables = [
      table('t-2', OPEN, '02', 2),
      table('t-4', OPEN, '04', 4),
      table('t-8', OPEN, '08', 8),
      table('c-4', SWITCH_CERRADO, '01', 4),
      table('p-2', SIN_MESAS_GRANDES, '01', 2),
    ];
    reservations = [];
    statusLog = { record: vi.fn() };
    const database = createDatabase();

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DEV_USER_ENABLED: 'false',
              FIREBASE_PROJECT_ID: 'firebase-project-example',
              RESERVATION_TTL_MINUTES: '3',
            }),
          ],
        }),
        FakeDatabaseModule.with(database.repositories, database.extras),
        EventEmitterModule.forRoot(),
        ReservationsCheckinModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => fakeFirebaseAuth)
      .overrideProvider(getRepositoryToken(User))
      .useValue(usersRepository(testUsers(OPEN)))
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue({})
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({})
      .overrideProvider(getRepositoryToken(Table))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(Reservation))
      .useValue({})
      .overrideProvider(getRepositoryToken(CheckIn))
      .useValue({})
      .overrideProvider(ReservationExpirationService)
      .useValue({
        expireDueForDiner: vi.fn().mockResolvedValue(0),
        expireDueForRestaurant: vi.fn().mockResolvedValue(0),
      })
      .overrideProvider(TableStatusLog)
      .useValue(statusLog)
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

  const post = (body: unknown, token = 'diner') =>
    request(app.getHttpServer())
      .post('/v1/reservations')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  describe('201', () => {
    it('devuelve la forma exacta de Reservation con la mesa más pequeña que alcanza', async () => {
      const res = await post({ restaurantId: OPEN, partySize: 3 }).expect(201);

      expect(Object.keys(res.body).sort()).toEqual(
        [
          'id',
          'code',
          'status',
          'partySize',
          'createdAt',
          'expiresAt',
          'serverTime',
          'cancelledAt',
          'expiredAt',
          'checkedInAt',
          'restaurant',
          'table',
        ].sort(),
      );
      expect(res.body).toMatchObject({
        id: '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
        status: 'active',
        partySize: 3,
        createdAt: '2026-10-16T18:00:00.000Z',
        // RESERVATION_TTL_MINUTES = 3.
        expiresAt: '2026-10-16T18:03:00.000Z',
        serverTime: '2026-10-16T18:00:00.000Z',
        cancelledAt: null,
        expiredAt: null,
        checkedInAt: null,
        restaurant: {
          id: OPEN,
          name: 'Casa 72',
          address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
          latitude: 4.655671,
          longitude: -74.057006,
        },
        table: { identifier: '04', capacity: 4 },
      });
      expect(res.body.code).toMatch(CODE_PATTERN);
      expect(Object.keys(res.body.restaurant).sort()).toEqual(
        ['id', 'name', 'address', 'latitude', 'longitude'].sort(),
      );
    });

    it('pasa la mesa a reserved y escribe la bitácora del comensal con source reservation', async () => {
      await post({ restaurantId: OPEN, partySize: 3 }).expect(201);

      expect(tables.find((row) => row.id === 't-4')?.status).toBe('reserved');
      expect(statusLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tableId: 't-4',
          previousStatus: 'available',
          newStatus: 'reserved',
          userId: DINER_ID,
          source: 'reservation',
        }),
        expect.anything(),
      );
    });
  });

  describe('400', () => {
    it.each([
      ['partySize 0', { restaurantId: OPEN, partySize: 0 }],
      ['partySize 21', { restaurantId: OPEN, partySize: 21 }],
      ['partySize como texto', { restaurantId: OPEN, partySize: '2' }],
      ['partySize decimal', { restaurantId: OPEN, partySize: 2.5 }],
      ['sin partySize', { restaurantId: OPEN }],
    ])('rechaza %s con el mensaje en español', async (_label, body) => {
      const res = await post(body).expect(400);

      expect(res.body.message).toEqual(['Las personas van de 1 a 20.']);
      expect(res.body.error).toBe('Bad Request');
    });

    it.each([
      ['no es un uuid', { restaurantId: 'abc', partySize: 2 }],
      ['falta', { partySize: 2 }],
    ])('rechaza un restaurantId que %s', async (_label, body) => {
      const res = await post(body).expect(400);

      expect(res.body.message).toEqual([
        'El restaurante no es válido. Elígelo de nuevo desde la búsqueda.',
      ]);
    });

    it('rechaza un campo que no existe (el comensal sale de la sesión, no del body)', async () => {
      const res = await post({
        restaurantId: OPEN,
        partySize: 2,
        dinerId: DINER_ID,
      }).expect(400);

      expect(Array.isArray(res.body.message)).toBe(true);
      expect(reservations).toHaveLength(0);
    });
  });

  describe('401 y 403', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .send({ restaurantId: OPEN, partySize: 2 })
        .expect(401);
    });

    it('401 con un token inválido', async () => {
      await post({ restaurantId: OPEN, partySize: 2 }, 'malo').expect(401);
    });

    it('403 RESTAURANT_ACCOUNT si quien llama es un restaurante', async () => {
      const res = await post(
        { restaurantId: OPEN, partySize: 2 },
        'owner',
      ).expect(403);

      expect(res.body).toEqual({
        statusCode: 403,
        message: ACCOUNT_ERROR_MESSAGES.RESTAURANT_ACCOUNT,
        error: 'Forbidden',
        errorCode: 'RESTAURANT_ACCOUNT',
      });
    });

    it('403 PROFILE_REQUIRED si la cuenta todavía no tiene perfil', async () => {
      const res = await post(
        { restaurantId: OPEN, partySize: 2 },
        'noProfile',
      ).expect(403);

      expect(res.body.errorCode).toBe('PROFILE_REQUIRED');
    });
  });

  describe('404', () => {
    it.each([
      ['no existe', UNKNOWN],
      ['no tiene ubicación', SIN_UBICACION],
    ])('el restaurante %s', async (_label, restaurantId) => {
      const res = await post({ restaurantId, partySize: 2 }).expect(404);

      expect(res.body).toEqual({
        statusCode: 404,
        message: 'Este restaurante ya no está disponible.',
        error: 'Not Found',
        errorCode: 'RESTAURANT_NOT_FOUND',
      });
    });
  });

  describe('409', () => {
    const conflict = (message: string, errorCode: string) => ({
      statusCode: 409,
      message,
      error: 'Conflict',
      errorCode,
    });

    it('RESTAURANT_CLOSED si el restaurante está cerrado', async () => {
      const res = await post({
        restaurantId: SWITCH_CERRADO,
        partySize: 2,
      }).expect(409);

      expect(res.body).toEqual(
        conflict('Este restaurante acaba de cerrar.', 'RESTAURANT_CLOSED'),
      );
    });

    it('ACTIVE_RESERVATION_EXISTS si el comensal ya tiene una activa', async () => {
      reservations.push({ dinerId: DINER_ID, status: 'active' });

      const res = await post({ restaurantId: OPEN, partySize: 2 }).expect(409);

      expect(res.body).toEqual(
        conflict('Ya tienes una reserva activa', 'ACTIVE_RESERVATION_EXISTS'),
      );
    });

    it('NO_TABLE_AVAILABLE si ninguna mesa alcanza para el grupo', async () => {
      const res = await post({
        restaurantId: SIN_MESAS_GRANDES,
        partySize: 5,
      }).expect(409);

      expect(res.body).toEqual(
        conflict(
          'Alguien acaba de tomar la última mesa. Prueba con otro restaurante.',
          'NO_TABLE_AVAILABLE',
        ),
      );
    });

    it('NO_TABLE_AVAILABLE si las mesas están reservadas o inactivas', async () => {
      tables = tables.map((row) =>
        row.restaurantId === OPEN ? { ...row, status: 'reserved' } : row,
      );

      await post({ restaurantId: OPEN, partySize: 2 }).expect(409);
      expect(reservations).toHaveLength(0);
    });

    it('un error de la base responde 500 con el mensaje genérico, sin detalles', async () => {
      statusLog.record.mockRejectedValueOnce(new Error('connection lost'));

      const res = await post({ restaurantId: OPEN, partySize: 2 }).expect(500);

      expect(JSON.stringify(res.body)).not.toContain('connection lost');
      expect(res.body.message).toBe(
        'No pudimos completar la acción. Intenta de nuevo en un momento.',
      );
    });
  });
});
