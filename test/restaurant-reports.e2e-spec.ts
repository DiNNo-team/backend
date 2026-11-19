import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { RestaurantApprovalReader } from './../src/modules/identity-access/approval/restaurant-approval.reader.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import {
  ACCOUNT_ERROR_MESSAGES,
  type AccountErrorCode,
} from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { CheckInFeeConfig } from './../src/modules/reservations-checkin/billing/checkin-fee.config.js';
import { CheckIn } from './../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { ReservationsCheckinModule } from './../src/modules/reservations-checkin/index.js';
import { REPORT_PERIOD_MESSAGES as M } from './../src/modules/reservations-checkin/reports/report-period.js';
import { ReservationExpirationService } from './../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { Reservation } from './../src/modules/reservations-checkin/reservations/reservation.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableArea } from './../src/modules/restaurant-operations/table-areas/table-area.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import { Clock } from './../src/modules/search-availability/index.js';
import { FakeDatabaseModule } from './support/fake-database.js';
import {
  approvalReader,
  approvalTestUsers,
  fakeFirebaseAuth,
  TEST_APPROVALS,
  testUsers,
  usersRepository,
} from './support/test-accounts.js';

// Reportes del restaurante (CLAUDE.md §11, "Cobro por check-in"): la forma de
// la respuesta, el periodo, los roles y la aprobación. Sin Postgres: la base
// simulada responde según la consulta y guarda los parámetros que recibió.

const OWNER_RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
// Domingo 2026-11-15 09:30 en Bogotá.
const NOW = new Date('2026-11-15T14:30:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function forbidden(code: AccountErrorCode) {
  return {
    statusCode: 403,
    message: ACCOUNT_ERROR_MESSAGES[code],
    error: 'Forbidden',
    errorCode: code,
  };
}

interface QueryCall {
  sql: string;
  params: unknown[];
}

const BILLING_ROWS = [
  {
    check_in_id: '11111111-1111-4111-8111-111111111111',
    reservation_id: '22222222-2222-4222-8222-222222222222',
    checked_in_at: new Date('2026-11-14T22:05:00Z'),
    fee_cop: 6000,
    party_size: 4,
    table_identifier: '04',
  },
  {
    check_in_id: '33333333-3333-4333-8333-333333333333',
    reservation_id: '44444444-4444-4444-8444-444444444444',
    checked_in_at: new Date('2026-11-02T17:00:00Z'),
    fee_cop: 2000,
    party_size: 2,
    table_identifier: 'T1',
  },
];

const DAILY_ROWS = [
  {
    date: '2026-11-14',
    reservations_created: 3,
    check_ins: 1,
    guests: 2,
    cancelled: 1,
    expired: 0,
  },
  {
    date: '2026-11-15',
    reservations_created: 0,
    check_ins: 0,
    guests: 0,
    cancelled: 0,
    expired: 0,
  },
];

const MONTHLY_ROWS = [
  { month: '2026-10', guests: 9, check_ins: 4 },
  { month: '2026-11', guests: 13, check_ins: 6 },
];

// Lo que responde Postgres a las agregaciones del resumen.
const WITH_DATA = {
  counts: {
    created: 8,
    completed: 4,
    cancelled: 2,
    expired: 1,
    active: 1,
    average_party_size: 2.875,
  },
  hours: [
    { hour: 19, reservations: 2 },
    { hour: 13, reservations: 3 },
    { hour: 12, reservations: 2 },
    { hour: 20, reservations: 1 },
  ],
  days: [
    { dayOfWeek: 5, reservations: 5 },
    { dayOfWeek: 6, reservations: 3 },
  ],
  totals: { check_ins: 2, amount_cop: '5500' },
  dayHours: [{ dayOfWeek: 5, hour: 13, reservations: 3 }],
};

const NO_DATA = {
  counts: {
    created: 0,
    completed: 0,
    cancelled: 0,
    expired: 0,
    active: 0,
    average_party_size: null,
  },
  hours: [],
  days: [],
  totals: { check_ins: 0, amount_cop: '0' },
  dayHours: [],
};

async function createApp(
  config: Record<string, string> = {},
  data: typeof WITH_DATA | typeof NO_DATA = WITH_DATA,
) {
  const queries: QueryCall[] = [];
  const query = (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    if (sql.includes('summary:totals')) {
      // El tramo anterior (octubre) y el periodo (noviembre).
      const previous =
        (params[1] as Date).getTime() < NOW.getTime() - 20 * DAY_MS;
      return Promise.resolve([
        previous
          ? {
              reservations_created: 15,
              check_ins: 4,
              guests: 9,
              amount_cop: '8000',
            }
          : {
              reservations_created: 18,
              check_ins: 6,
              guests: 13,
              amount_cop: '12000',
            },
      ]);
    }
    if (sql.includes('summary:daily')) {
      return Promise.resolve(DAILY_ROWS);
    }
    if (sql.includes('summary:monthly')) {
      return Promise.resolve(MONTHLY_ROWS);
    }
    if (sql.includes('billing_periods')) {
      return Promise.resolve([]);
    }
    if (sql.includes('"dayOfWeek"') && sql.includes('"hour"')) {
      return Promise.resolve(data.dayHours);
    }
    if (sql.includes('SUM("fee_cop")')) {
      return Promise.resolve([data.totals]);
    }
    if (sql.includes('LIMIT')) {
      return Promise.resolve(BILLING_ROWS);
    }
    if (sql.includes('FILTER')) {
      return Promise.resolve([data.counts]);
    }
    if (sql.includes('EXTRACT(HOUR')) {
      return Promise.resolve(data.hours);
    }
    if (sql.includes('EXTRACT(ISODOW')) {
      return Promise.resolve(data.days);
    }
    throw new Error(`Consulta no simulada: ${sql}`);
  };
  const expiration = {
    expireDueForRestaurant: vi.fn().mockResolvedValue(0),
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
            ...config,
          }),
        ],
      }),
      FakeDatabaseModule.with({}, { query }),
      EventEmitterModule.forRoot(),
      ReservationsCheckinModule,
    ],
  })
    .overrideProvider(FIREBASE_AUTH)
    .useValue(() => fakeFirebaseAuth)
    .overrideProvider(RestaurantApprovalReader)
    .useValue(
      approvalReader({
        [OWNER_RESTAURANT_ID]: 'approved',
        ...TEST_APPROVALS,
      }),
    )
    .overrideProvider(getRepositoryToken(User))
    .useValue(
      usersRepository([
        ...testUsers(OWNER_RESTAURANT_ID),
        ...approvalTestUsers(),
      ]),
    )
    .overrideProvider(getRepositoryToken(Restaurant))
    .useValue({})
    .overrideProvider(getRepositoryToken(RestaurantSchedule))
    .useValue({})
    .overrideProvider(getRepositoryToken(Table))
    .useValue({})
    .overrideProvider(getRepositoryToken(TableLog))
    .useValue({})
    .overrideProvider(getRepositoryToken(TableArea))
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

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return { app, queries, expiration };
}

describe('Reportes del restaurante (e2e)', () => {
  let app: INestApplication<App>;
  let queries: QueryCall[];
  let expiration: { expireDueForRestaurant: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ({ app, queries, expiration } = await createApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (path: string, token: string | null) => {
    const req = request(app.getHttpServer()).get(path);
    return token === null ? req : req.set('Authorization', `Bearer ${token}`);
  };

  describe('GET /v1/restaurants/me/summary', () => {
    const PATH = '/v1/restaurants/me/summary';

    it('la forma exacta: cobro, reservas, tasas, promedio, horas pico y días', async () => {
      const res = await get(PATH, 'owner').expect(200);

      expect(res.body).toEqual({
        period: {
          from: '2026-11-01',
          to: '2026-11-15',
          timezone: 'America/Bogota',
        },
        billing: {
          checkIns: 2,
          amountCop: 5500,
          guests: 13,
          currentFeePerGuestCop: 1500,
        },
        previousComparable: {
          period: {
            from: '2026-10-01',
            to: '2026-10-15',
            timezone: 'America/Bogota',
          },
          reservationsCreated: 15,
          checkIns: 4,
          guests: 9,
          amountCop: 8000,
        },
        reservations: {
          created: 8,
          completed: 4,
          cancelled: 2,
          expired: 1,
          active: 1,
        },
        rates: { conversion: 0.5, noShow: 0.2, cancellation: 0.25 },
        averagePartySize: 2.88,
        peakHours: [
          { hour: 13, reservations: 3 },
          { hour: 12, reservations: 2 },
          { hour: 19, reservations: 2 },
        ],
        byDayOfWeek: [
          { dayOfWeek: 1, reservations: 0 },
          { dayOfWeek: 2, reservations: 0 },
          { dayOfWeek: 3, reservations: 0 },
          { dayOfWeek: 4, reservations: 0 },
          { dayOfWeek: 5, reservations: 5 },
          { dayOfWeek: 6, reservations: 3 },
          { dayOfWeek: 7, reservations: 0 },
        ],
        byDate: [
          {
            date: '2026-11-14',
            reservationsCreated: 3,
            checkIns: 1,
            guests: 2,
            cancelled: 1,
            expired: 0,
          },
          {
            date: '2026-11-15',
            reservationsCreated: 0,
            checkIns: 0,
            guests: 0,
            cancelled: 0,
            expired: 0,
          },
        ],
        byDayHour: expect.any(Array),
        monthly: [
          { month: '2026-10', guests: 9, checkIns: 4, inProgress: false },
          { month: '2026-11', guests: 13, checkIns: 6, inProgress: true },
        ],
        payment: {
          period: {
            month: '2026-11',
            status: 'in_progress',
            checkIns: 2,
            amountCop: 5500,
          },
          previousMonth: {
            month: '2026-10',
            status: 'pending',
            checkIns: 2,
            amountCop: 5500,
          },
        },
        serverTime: NOW.toISOString(),
      });
      // El mapa de calor trae siempre las 168 celdas, con la reserva sembrada.
      expect(res.body.byDayHour).toHaveLength(168);
      expect(
        res.body.byDayHour.find(
          (cell: { dayOfWeek: number; hour: number }) =>
            cell.dayOfWeek === 5 && cell.hour === 13,
        ),
      ).toEqual({ dayOfWeek: 5, hour: 13, reservations: 3 });
    });

    it('un restaurante suspendido ve su resumen (solo lectura)', async () => {
      await get(PATH, 'suspendedOwner').expect(200);
    });

    it('vence las reservas debidas del restaurante antes de contar', async () => {
      await get(PATH, 'owner').expect(200);

      expect(expiration.expireDueForRestaurant).toHaveBeenCalledExactlyOnceWith(
        OWNER_RESTAURANT_ID,
      );
      const [first] =
        expiration.expireDueForRestaurant.mock.invocationCallOrder;
      expect(first).toBeGreaterThan(0);
      // Trece consultas (métricas, mapa de calor, días, totales del periodo y
      // del tramo anterior, meses y estado de pago), todas del restaurante de la
      // sesión: ninguna lleva otro id.
      expect(queries).toHaveLength(13);
      for (const { params } of queries) {
        expect(params).toContain(OWNER_RESTAURANT_ID);
      }
    });

    it('con la tarifa por comensal vigente de CHECKIN_FEE_PER_GUEST_COP', async () => {
      const other = await createApp({ CHECKIN_FEE_PER_GUEST_COP: '3500' });
      const res = await request(other.app.getHttpServer())
        .get(PATH)
        .set('Authorization', 'Bearer owner')
        .expect(200);
      expect(res.body.billing.currentFeePerGuestCop).toBe(3500);
      await other.app.close();
    });

    it('un restaurante sin datos: ceros, null y listas vacías', async () => {
      const empty = await createApp({}, NO_DATA);
      const res = await request(empty.app.getHttpServer())
        .get(`${PATH}?from=2026-10-01&to=2026-10-31`)
        .set('Authorization', 'Bearer owner')
        .expect(200);

      expect(res.body).toMatchObject({
        period: { from: '2026-10-01', to: '2026-10-31' },
        billing: { checkIns: 0, amountCop: 0, currentFeePerGuestCop: 1500 },
        reservations: {
          created: 0,
          completed: 0,
          cancelled: 0,
          expired: 0,
          active: 0,
        },
        rates: { conversion: null, noShow: null, cancellation: null },
        averagePartySize: null,
        peakHours: [],
      });
      expect(res.body.byDayOfWeek).toHaveLength(7);
      await empty.app.close();
    });

    it.each([
      ['from=2026-11-10&to=2026-11-09', [M.FROM_AFTER_TO]],
      ['to=2026-11-16', [M.TO_IN_FUTURE]],
      ['from=2025-11-14&to=2026-11-15', [M.TOO_LONG]],
      ['to=15-11-2026', [M.TO_INVALID]],
    ])('400 con %s, sin vencer ni consultar', async (query, message) => {
      const res = await get(`${PATH}?${query}`, 'owner').expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        message,
        error: 'Bad Request',
      });
      expect(queries).toEqual([]);
      expect(expiration.expireDueForRestaurant).not.toHaveBeenCalled();
    });

    it('400 con page (el resumen no pagina)', async () => {
      await get(`${PATH}?page=1`, 'owner').expect(400);
    });

    it.each([
      ['pendingOwner', 'ACCOUNT_PENDING_APPROVAL'],
      ['rejectedOwner', 'ACCOUNT_REJECTED'],
      ['diner', 'DINER_ACCOUNT'],
      ['platformAdmin', 'ADMIN_ACCOUNT'],
      ['noProfile', 'ACCOUNT_NOT_ENABLED'],
    ] as const)('%s recibe 403 %s, sin vencer nada', async (token, code) => {
      const res = await get(PATH, token).expect(403);
      expect(res.body).toEqual(forbidden(code));
      expect(expiration.expireDueForRestaurant).not.toHaveBeenCalled();
    });

    it('sin sesión: 401', async () => {
      await get(PATH, null).expect(401);
    });
  });

  describe('GET /v1/restaurants/me/billing/check-ins', () => {
    const PATH = '/v1/restaurants/me/billing/check-ins';

    it('sin parámetros: del día 1 del mes hasta hoy, con la forma exacta y sin datos del comensal', async () => {
      const res = await get(PATH, 'owner').expect(200);

      expect(res.body).toEqual({
        period: {
          from: '2026-11-01',
          to: '2026-11-15',
          timezone: 'America/Bogota',
        },
        totalCheckIns: 2,
        amountCop: 5500,
        items: [
          {
            checkInId: '11111111-1111-4111-8111-111111111111',
            reservationId: '22222222-2222-4222-8222-222222222222',
            checkedInAt: '2026-11-14T22:05:00.000Z',
            partySize: 4,
            tableIdentifier: '04',
            feeCop: 6000,
          },
          {
            checkInId: '33333333-3333-4333-8333-333333333333',
            reservationId: '44444444-4444-4444-8444-444444444444',
            checkedInAt: '2026-11-02T17:00:00.000Z',
            partySize: 2,
            tableIdentifier: 'T1',
            feeCop: 2000,
          },
        ],
        page: 1,
        pageSize: 50,
        serverTime: NOW.toISOString(),
      });
    });

    it('filtra por el restaurante de la sesión y por el rango en hora de Bogotá, con la página pedida', async () => {
      await get(
        `${PATH}?from=2026-10-01&to=2026-10-31&page=3&pageSize=10`,
        'owner',
      ).expect(200);

      const totals = queries.find((q) => q.sql.includes('SUM("fee_cop")'));
      const page = queries.find((q) => q.sql.includes('LIMIT'));
      // 2026-10-01 00:00 y 2026-11-01 00:00 en Bogotá (UTC-5).
      const range = [
        OWNER_RESTAURANT_ID,
        new Date('2026-10-01T05:00:00Z'),
        new Date('2026-11-01T05:00:00Z'),
      ];
      expect(totals?.params).toEqual(range);
      expect(page?.params).toEqual([...range, 10, 20]);
      expect(page?.sql).toContain('ORDER BY c."checked_in_at" DESC');
    });

    it.each([
      ['from=2026-11-10&to=2026-11-09', [M.FROM_AFTER_TO]],
      ['to=2026-11-16', [M.TO_IN_FUTURE]],
      ['from=2025-11-14&to=2026-11-15', [M.TOO_LONG]],
      ['from=2026-02-30', [M.FROM_INVALID]],
      ['from=ayer&to=hoy', [M.FROM_INVALID, M.TO_INVALID]],
      [
        'pageSize=201',
        [
          'El tamaño de página (pageSize) debe ser un número entero entre 1 y 200.',
        ],
      ],
      [
        'page=0',
        ['La página (page) debe ser un número entero mayor o igual a 1.'],
      ],
    ])('400 con %s, sin consultar la base', async (query, message) => {
      const res = await get(`${PATH}?${query}`, 'owner').expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        message,
        error: 'Bad Request',
      });
      expect(queries).toEqual([]);
    });

    it('400 con un parámetro que no existe (el restaurante sale de la sesión)', async () => {
      await get(`${PATH}?restaurantId=${OWNER_RESTAURANT_ID}`, 'owner').expect(
        400,
      );
      expect(queries).toEqual([]);
    });

    it.each([
      ['pendingOwner', 'ACCOUNT_PENDING_APPROVAL'],
      ['rejectedOwner', 'ACCOUNT_REJECTED'],
      ['diner', 'DINER_ACCOUNT'],
      ['platformAdmin', 'ADMIN_ACCOUNT'],
      ['noProfile', 'ACCOUNT_NOT_ENABLED'],
    ] as const)('%s recibe 403 %s', async (token, code) => {
      const res = await get(PATH, token).expect(403);
      expect(res.body).toEqual(forbidden(code));
      expect(queries).toEqual([]);
    });

    it('sin sesión: 401', async () => {
      await get(PATH, null).expect(401);
    });
  });
});

describe('CHECKIN_FEE_PER_GUEST_COP al arrancar', () => {
  it.each([
    [undefined, 1500],
    ['0', 0],
    ['3500', 3500],
  ])('con %s la tarifa por comensal es %i', async (value, fee) => {
    const { app } = await createApp(
      value === undefined ? {} : { CHECKIN_FEE_PER_GUEST_COP: value },
    );
    expect(app.get(CheckInFeeConfig)).toEqual({ feePerGuestCop: fee });
    await app.close();
  });

  it('ya no lee la variable anterior CHECKIN_FEE_COP', async () => {
    const { app } = await createApp({ CHECKIN_FEE_COP: '3500' });
    expect(app.get(CheckInFeeConfig)).toEqual({ feePerGuestCop: 1500 });
    await app.close();
  });

  it.each(['', 'mil quinientos', '-1', '1.500', '1000001'])(
    'con %j la app no arranca',
    async (value) => {
      await expect(
        createApp({ CHECKIN_FEE_PER_GUEST_COP: value }),
      ).rejects.toThrow(/CHECKIN_FEE_PER_GUEST_COP/);
    },
  );
});
