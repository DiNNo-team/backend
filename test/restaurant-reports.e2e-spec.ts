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
    fee_cop: 3500,
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

async function createApp(config: Record<string, string> = {}) {
  const queries: QueryCall[] = [];
  const query = (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    if (sql.includes('SUM("fee_cop")')) {
      return Promise.resolve([{ check_ins: 2, amount_cop: '5500' }]);
    }
    if (sql.includes('LIMIT')) {
      return Promise.resolve(BILLING_ROWS);
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

  beforeEach(async () => {
    ({ app, queries } = await createApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (path: string, token: string | null) => {
    const req = request(app.getHttpServer()).get(path);
    return token === null ? req : req.set('Authorization', `Bearer ${token}`);
  };

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
            feeCop: 3500,
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

describe('CHECKIN_FEE_COP al arrancar', () => {
  it.each([
    [undefined, 2000],
    ['0', 0],
    ['3500', 3500],
  ])('con %s la tarifa es %i', async (value, fee) => {
    const { app } = await createApp(
      value === undefined ? {} : { CHECKIN_FEE_COP: value },
    );
    expect(app.get(CheckInFeeConfig)).toEqual({ feeCop: fee });
    await app.close();
  });

  it.each(['', 'dos mil', '-1', '2.000', '1000001'])(
    'con %j la app no arranca',
    async (value) => {
      await expect(createApp({ CHECKIN_FEE_COP: value })).rejects.toThrow(
        /CHECKIN_FEE_COP/,
      );
    },
  );
});
