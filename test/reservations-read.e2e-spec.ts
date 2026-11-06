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

// Viernes 2026-10-16 13:00 en Bogotá.
const NOW = new Date('2026-10-16T18:00:00Z');

const DINER_ID = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const OTHER_DINER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';
const TABLE_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const ACTIVE_ID = '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const CANCELLED_ID = '11111111-1111-4111-8111-111111111111';
const EXPIRED_ID = '22222222-2222-4222-8222-222222222222';
const COMPLETED_ID = '33333333-3333-4333-8333-333333333333';
const STALE_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

const NOT_FOUND = {
  statusCode: 404,
  message: 'No encontramos esa reserva.',
  error: 'Not Found',
  errorCode: 'RESERVATION_NOT_FOUND',
};

const at = (iso: string) => new Date(iso);

const reservation = (id: string, status: string, overrides: Row = {}): Row => ({
  id,
  code: 'K7M4QX',
  status,
  partySize: 2,
  dinerId: DINER_ID,
  restaurantId: RESTAURANT_ID,
  tableId: TABLE_ID,
  createdAt: at('2026-10-16T17:50:00Z'),
  // Vigente: vence 5 minutos después de NOW.
  expiresAt: at('2026-10-16T18:05:00Z'),
  cancelledAt: null,
  expiredAt: null,
  checkedInAt: null,
  noShow: false,
  ...overrides,
});

describe('GET /v1/reservations/active y /v1/reservations/:id (e2e)', () => {
  let app: INestApplication<App>;
  let stored: Row[];

  // Doble del vencimiento: vence en memoria las activas debidas, como haría el
  // UPDATE real (que cubren la unitaria y la suite db).
  const expire = (row: Row) => {
    Object.assign(row, {
      status: 'expired',
      expiredAt: NOW,
      noShow: true,
    });
  };
  const isDue = (row: Row) =>
    row.status === 'active' && (row.expiresAt as Date) <= NOW;
  const expiration = {
    expireIfDue: vi.fn((id: string) => {
      stored.filter((row) => row.id === id && isDue(row)).forEach(expire);
      return Promise.resolve(0);
    }),
    expireDueForDiner: vi.fn((dinerId: string) => {
      stored
        .filter((row) => row.dinerId === dinerId && isDue(row))
        .forEach(expire);
      return Promise.resolve(0);
    }),
  };

  beforeEach(async () => {
    stored = [
      reservation(ACTIVE_ID, 'active'),
      reservation(CANCELLED_ID, 'cancelled', {
        cancelledAt: at('2026-10-16T17:55:00Z'),
      }),
      reservation(EXPIRED_ID, 'expired', {
        expiredAt: at('2026-10-16T17:46:00Z'),
        noShow: true,
      }),
      reservation(COMPLETED_ID, 'completed', {
        checkedInAt: at('2026-10-16T17:57:00Z'),
      }),
      reservation(OTHER_ID, 'active', { dinerId: OTHER_DINER_ID }),
    ];
    expiration.expireIfDue.mockClear();
    expiration.expireDueForDiner.mockClear();

    const reservations = {
      findOne: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(stored.find((row) => matches(row, where)) ?? null),
      ),
    };
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
        FakeDatabaseModule.with({
          Reservation: reservations as never,
          Restaurant: fakeRepository([
            {
              id: RESTAURANT_ID,
              name: 'Casa 72',
              address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
              latitude: 4.655671,
              longitude: -74.057006,
            },
          ]),
          Table: fakeRepository([
            { id: TABLE_ID, identifier: '04', capacity: 4 },
          ]),
        }),
        EventEmitterModule.forRoot(),
        ReservationsCheckinModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => fakeFirebaseAuth)
      .overrideProvider(getRepositoryToken(User))
      .useValue(usersRepository(testUsers(RESTAURANT_ID)))
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
      .useValue(expiration)
      .overrideProvider(TableStatusLog)
      .useValue({ record: vi.fn() })
      .overrideProvider(Clock)
      .useValue({ now: () => NOW })
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

  describe('GET /v1/reservations/active', () => {
    it('200 con la reserva activa: forma exacta de §12.8 y el mismo serverTime dentro y fuera', async () => {
      const res = await get('/v1/reservations/active').expect(200);

      expect(Object.keys(res.body).sort()).toEqual([
        'reservation',
        'serverTime',
      ]);
      expect(res.body.serverTime).toBe('2026-10-16T18:00:00.000Z');
      expect(Object.keys(res.body.reservation).sort()).toEqual(
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
      expect(res.body.reservation).toEqual({
        id: ACTIVE_ID,
        code: 'K7M4QX',
        status: 'active',
        partySize: 2,
        createdAt: '2026-10-16T17:50:00.000Z',
        expiresAt: '2026-10-16T18:05:00.000Z',
        serverTime: '2026-10-16T18:00:00.000Z',
        cancelledAt: null,
        expiredAt: null,
        checkedInAt: null,
        restaurant: {
          id: RESTAURANT_ID,
          name: 'Casa 72',
          address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
          latitude: 4.655671,
          longitude: -74.057006,
        },
        table: { identifier: '04', capacity: 4 },
      });
      expect(res.body.reservation.code).toMatch(CODE_PATTERN);
    });

    it('200 con reservation null si no tiene reserva activa (nunca 404)', async () => {
      stored = stored.filter((row) => row.dinerId !== DINER_ID);

      const res = await get('/v1/reservations/active').expect(200);

      expect(res.body).toEqual({
        reservation: null,
        serverTime: '2026-10-16T18:00:00.000Z',
      });
    });

    it('una reserva activa que ya venció se vence al leer y responde reservation null', async () => {
      stored = [
        reservation(STALE_ID, 'active', {
          expiresAt: at('2026-10-16T17:59:00Z'),
        }),
      ];

      const res = await get('/v1/reservations/active').expect(200);

      expect(res.body.reservation).toBeNull();
      expect(expiration.expireDueForDiner).toHaveBeenCalledWith(DINER_ID);
      expect(stored[0].status).toBe('expired');
    });

    it('no devuelve la reserva activa de otro comensal', async () => {
      stored = stored.filter((row) => row.id === OTHER_ID);

      const res = await get('/v1/reservations/active').expect(200);

      expect(res.body.reservation).toBeNull();
    });
  });

  describe('GET /v1/reservations/:id', () => {
    it('200 con la reserva activa y su código', async () => {
      const res = await get(`/v1/reservations/${ACTIVE_ID}`).expect(200);

      expect(res.body).toMatchObject({
        id: ACTIVE_ID,
        status: 'active',
        code: 'K7M4QX',
        serverTime: '2026-10-16T18:00:00.000Z',
        table: { identifier: '04', capacity: 4 },
        restaurant: { id: RESTAURANT_ID, name: 'Casa 72' },
      });
    });

    it.each([
      [
        'cancelled',
        CANCELLED_ID,
        {
          cancelledAt: '2026-10-16T17:55:00.000Z',
          expiredAt: null,
          checkedInAt: null,
        },
      ],
      [
        'expired',
        EXPIRED_ID,
        {
          cancelledAt: null,
          expiredAt: '2026-10-16T17:46:00.000Z',
          checkedInAt: null,
        },
      ],
      [
        'completed',
        COMPLETED_ID,
        {
          cancelledAt: null,
          expiredAt: null,
          checkedInAt: '2026-10-16T17:57:00.000Z',
        },
      ],
    ])(
      '200 con la reserva %s, con code null y sus fechas',
      async (status, id, dates) => {
        const res = await get(`/v1/reservations/${id}`).expect(200);

        expect(res.body).toMatchObject({ id, status, code: null, ...dates });
        expect(expiration.expireIfDue).not.toHaveBeenCalled();
      },
    );

    it('una reserva activa que ya venció se vence al leer y se devuelve como expired, sin código', async () => {
      stored.push(
        reservation(STALE_ID, 'active', {
          expiresAt: at('2026-10-16T17:59:00Z'),
        }),
      );

      const res = await get(`/v1/reservations/${STALE_ID}`).expect(200);

      expect(res.body).toMatchObject({
        id: STALE_ID,
        status: 'expired',
        code: null,
        expiredAt: '2026-10-16T18:00:00.000Z',
      });
    });

    it('404 RESERVATION_NOT_FOUND si es de otro comensal', async () => {
      const res = await get(`/v1/reservations/${OTHER_ID}`).expect(404);

      expect(res.body).toEqual(NOT_FOUND);
    });

    it('404 idéntico si no existe: no se revela que la de otro existe', async () => {
      const ofOther = await get(`/v1/reservations/${OTHER_ID}`).expect(404);
      const unknown = await get(`/v1/reservations/${UNKNOWN_ID}`).expect(404);

      expect(unknown.body).toEqual(NOT_FOUND);
      expect(unknown.body).toEqual(ofOther.body);
    });

    it('400 con un mensaje en español si el id no es un UUID', async () => {
      const res = await get('/v1/reservations/no-es-uuid').expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        message: ['El id de la reserva no es un UUID válido.'],
        error: 'Bad Request',
      });
    });
  });

  describe.each([
    ['/v1/reservations/active'],
    [`/v1/reservations/${ACTIVE_ID}`],
  ])('%s: cuentas', (path) => {
    it('401 sin token', async () => {
      await request(app.getHttpServer()).get(path).expect(401);
    });

    it('401 con un token inválido', async () => {
      await get(path, 'malo').expect(401);
    });

    it('403 RESTAURANT_ACCOUNT si quien llama es un restaurante', async () => {
      const res = await get(path, 'owner').expect(403);

      expect(res.body).toEqual({
        statusCode: 403,
        message: ACCOUNT_ERROR_MESSAGES.RESTAURANT_ACCOUNT,
        error: 'Forbidden',
        errorCode: 'RESTAURANT_ACCOUNT',
      });
    });

    it('403 PROFILE_REQUIRED si la cuenta todavía no tiene perfil', async () => {
      const res = await get(path, 'noProfile').expect(403);

      expect(res.body.errorCode).toBe('PROFILE_REQUIRED');
    });
  });
});
