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
import { BILLING_ERRORS } from './../src/modules/reservations-checkin/billing/billing-errors.js';
import { BILLING_MONTH_MESSAGES as MONTH } from './../src/modules/reservations-checkin/billing/billing-month.js';
import { CheckIn } from './../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { ReservationsCheckinModule } from './../src/modules/reservations-checkin/index.js';
import { REPORT_PERIOD_MESSAGES } from './../src/modules/reservations-checkin/reports/report-period.js';
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
import { expectNoPersonalData } from './support/forbidden-keys.js';
import {
  approvalReader,
  approvalTestUsers,
  fakeFirebaseAuth,
  TEST_APPROVALS,
  testUsers,
  usersRepository,
} from './support/test-accounts.js';

// Panel del administrador de DiNNo: resumen, cobro, directorio y métricas de
// toda la plataforma (Sprint 4). Sin Postgres: la base simulada responde según
// la consulta y guarda el estado de cobro en memoria; el SQL real lo prueban
// test/db/admin-billing.db-spec.ts y test/db/admin-suspension.db-spec.ts. Aquí:
// roles, validación, forma de las respuestas, reglas de cobro y que ninguna
// respuesta traiga datos personales.

// 2026-11-17 10:00 en Bogotá: noviembre está en curso y octubre cerró.
const NOW = new Date('2026-11-17T15:00:00Z');
const OWNER_RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const QUIET_RESTAURANT_ID = '2b3c4d5e-6f70-4182-93a4-b5c6d7e8f901';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

function forbidden(code: AccountErrorCode) {
  return {
    statusCode: 403,
    message: ACCOUNT_ERROR_MESSAGES[code],
    error: 'Forbidden',
    errorCode: code,
  };
}

function conflict(code: keyof typeof BILLING_ERRORS) {
  return {
    statusCode: 409,
    message: BILLING_ERRORS[code],
    error: 'Conflict',
    errorCode: code,
  };
}

const NOT_FOUND = {
  statusCode: 404,
  message: 'Este restaurante ya no está disponible.',
  error: 'Not Found',
  errorCode: 'RESTAURANT_NOT_FOUND',
};

interface PeriodState {
  status: 'pending' | 'paid';
  amount_cop_snapshot: number | null;
  check_ins_snapshot: number | null;
  marked_paid_at: Date | null;
}

async function createApp() {
  // billing_periods en memoria: clave "restaurante|AAAA-MM-01".
  const periods = new Map<string, PeriodState>();
  // Check-ins por restaurante en octubre (el mes cerrado de las pruebas).
  const octoberTotals: Record<string, { check_ins: number; amount: number }> = {
    [OWNER_RESTAURANT_ID]: { check_ins: 3, amount: 5500 },
    [QUIET_RESTAURANT_ID]: { check_ins: 0, amount: 0 },
  };
  const headers: Record<string, { name: string; approval_status: string }> = {
    [OWNER_RESTAURANT_ID]: { name: 'Casa 72', approval_status: 'approved' },
    [QUIET_RESTAURANT_ID]: { name: 'Tranquilo', approval_status: 'suspended' },
  };
  const isOctober = (start: unknown) =>
    start instanceof Date && start.toISOString() === '2026-10-01T05:00:00.000Z';

  const query = vi.fn((sql: string, params: unknown[] = []) => {
    if (sql.startsWith('INSERT INTO "billing_periods"')) {
      const key = `${params[0] as string}|${params[1] as string}`;
      const current = periods.get(key);
      if (current?.status === 'paid') {
        return Promise.resolve([]);
      }
      periods.set(key, {
        status: 'paid',
        amount_cop_snapshot: params[2] as number,
        check_ins_snapshot: params[3] as number,
        marked_paid_at: params[4] as Date,
      });
      return Promise.resolve([{ id: 'bp-1' }]);
    }
    if (sql.trimStart().startsWith('UPDATE "billing_periods"')) {
      const key = `${params[0] as string}|${params[1] as string}`;
      if (periods.get(key)?.status !== 'paid') {
        return Promise.resolve([[], 0]);
      }
      periods.set(key, {
        status: 'pending',
        amount_cop_snapshot: null,
        check_ins_snapshot: null,
        marked_paid_at: null,
      });
      return Promise.resolve([[], 1]);
    }
    if (sql.includes('generate_series')) {
      return Promise.resolve(
        Array.from({ length: 12 }, (_, index) => {
          const month = new Date(Date.UTC(2025, 11 + index, 1))
            .toISOString()
            .slice(0, 7);
          const revenue =
            month === '2026-10' ? 5500 : month === '2026-11' ? 4000 : 0;
          return {
            month,
            revenue_cop: String(revenue),
            check_ins: revenue / 2000,
          };
        }),
      );
    }
    if (sql.includes('GROUP BY "approval_status"')) {
      return Promise.resolve([
        { approval_status: 'approved', count: 15 },
        { approval_status: 'pending', count: 2 },
        { approval_status: 'suspended', count: 1 },
      ]);
    }
    if (sql.includes('bp."period_month" < $1::date')) {
      return Promise.resolve([{ amount: '2000' }]);
    }
    if (sql.includes('WHERE bp."id" IS NULL')) {
      return Promise.resolve([{ amount: '5500' }]);
    }
    if (sql.includes('"paid_cop"')) {
      return Promise.resolve([{ paid_cop: '0', pending_cop: '5500' }]);
    }
    if (sql.includes('"last_table_activity_at"')) {
      return Promise.resolve([
        {
          id: OWNER_RESTAURANT_ID,
          name: 'Casa 72',
          category: 'colombian',
          approval_status: 'approved',
          is_open: true,
          reviewed_at: null,
          created_at: new Date('2026-09-01T12:00:00Z'),
          check_ins: 3,
          amount_cop: '5500',
          last_table_activity_at: new Date('2026-11-16T23:10:00Z'),
          total: 2,
        },
        {
          id: QUIET_RESTAURANT_ID,
          name: 'Tranquilo',
          category: null,
          approval_status: 'suspended',
          is_open: false,
          reviewed_at: new Date('2026-10-02T15:00:00Z'),
          created_at: new Date('2026-10-01T12:00:00Z'),
          check_ins: 0,
          amount_cop: '0',
          last_table_activity_at: null,
          total: 2,
        },
      ]);
    }
    if (sql.includes('COUNT(*) OVER ()')) {
      const october = isOctober(params[0]);
      return Promise.resolve(
        [OWNER_RESTAURANT_ID, QUIET_RESTAURANT_ID].map((id) => ({
          restaurant_id: id,
          name: headers[id].name,
          approval_status: headers[id].approval_status,
          check_ins: october ? octoberTotals[id].check_ins : 0,
          amount_cop: String(october ? octoberTotals[id].amount : 0),
          period_status:
            periods.get(`${id}|${params[2] as string}`)?.status ?? null,
          marked_paid_at:
            periods.get(`${id}|${params[2] as string}`)?.marked_paid_at ?? null,
          total: 2,
        })),
      );
    }
    if (sql.includes('FROM "restaurants" WHERE "id" = $1')) {
      const header = headers[params[0] as string];
      return Promise.resolve(header ? [{ id: params[0], ...header }] : []);
    }
    if (sql.includes('FROM "billing_periods"')) {
      const row = periods.get(`${params[0] as string}|${params[1] as string}`);
      return Promise.resolve(row ? [row] : []);
    }
    if (sql.includes('SUM("fee_cop")') && !sql.includes('LIMIT')) {
      // Con restaurante: $1 es el id; sin él, toda la plataforma.
      if (params.length === 3) {
        const totals = isOctober(params[1])
          ? octoberTotals[params[0] as string]
          : { check_ins: 0, amount: 0 };
        return Promise.resolve([
          { check_ins: totals.check_ins, amount_cop: String(totals.amount) },
        ]);
      }
      return Promise.resolve([{ check_ins: 2, amount_cop: '4000' }]);
    }
    if (sql.includes('LIMIT')) {
      return Promise.resolve([
        {
          check_in_id: '11111111-1111-4111-8111-111111111111',
          reservation_id: '22222222-2222-4222-8222-222222222222',
          checked_in_at: new Date('2026-10-14T22:05:00Z'),
          fee_cop: 2000,
          party_size: 4,
          table_identifier: '04',
        },
      ]);
    }
    if (sql.includes('FILTER')) {
      return Promise.resolve([
        {
          created: 10,
          completed: 4,
          cancelled: 3,
          expired: 2,
          active: 1,
          average_party_size: 2.875,
        },
      ]);
    }
    if (sql.includes('EXTRACT(HOUR')) {
      return Promise.resolve([
        { hour: 13, reservations: 6 },
        { hour: 20, reservations: 4 },
      ]);
    }
    if (sql.includes('EXTRACT(ISODOW')) {
      return Promise.resolve([{ dayOfWeek: 5, reservations: 10 }]);
    }
    throw new Error(`Consulta no simulada: ${sql}`);
  });
  const expiration = {
    expireAllDue: vi.fn().mockResolvedValue(0),
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
  return { app, query, expiration, periods };
}

describe('Panel del administrador: plataforma (e2e)', () => {
  let app: INestApplication<App>;
  let query: ReturnType<typeof vi.fn>;
  let expiration: { expireAllDue: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ({ app, query, expiration } = await createApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (method: 'get' | 'post', path: string, token: string | null) => {
    const req = request(app.getHttpServer())[method](path);
    return token === null ? req : req.set('Authorization', `Bearer ${token}`);
  };

  const MARK_PAID = `/v1/admin/billing/${OWNER_RESTAURANT_ID}/2026-10/mark-paid`;
  const MARK_PENDING = `/v1/admin/billing/${OWNER_RESTAURANT_ID}/2026-10/mark-pending`;
  const ROUTES: ['get' | 'post', string][] = [
    ['get', '/v1/admin/overview'],
    ['get', '/v1/admin/billing'],
    ['get', `/v1/admin/billing/${OWNER_RESTAURANT_ID}`],
    ['post', MARK_PAID],
    ['post', MARK_PENDING],
    ['get', '/v1/admin/activity'],
    ['get', '/v1/admin/platform/metrics'],
  ];

  describe('acceso', () => {
    it.each(ROUTES)('%s %s sin sesión → 401', async (method, path) => {
      await call(method, path, null).expect(401);
    });

    it.each([
      ['diner', 'DINER_ACCOUNT'],
      ['owner', 'RESTAURANT_ACCOUNT'],
      ['pendingOwner', 'RESTAURANT_ACCOUNT'],
      ['rejectedOwner', 'RESTAURANT_ACCOUNT'],
      ['suspendedOwner', 'RESTAURANT_ACCOUNT'],
      ['noProfile', 'ACCOUNT_NOT_ENABLED'],
    ] as const)(
      'una cuenta %s recibe 403 %s en todas las rutas, sin consultar la base',
      async (token, code) => {
        for (const [method, path] of ROUTES) {
          const res = await call(method, path, token).expect(403);
          expect(res.body).toEqual(forbidden(code));
        }
        expect(query).not.toHaveBeenCalled();
      },
    );

    it.each(ROUTES.filter(([, path]) => path !== MARK_PENDING))(
      'el administrador: %s %s → 200 sin datos personales',
      async (method, path) => {
        const res = await call(method, path, 'platformAdmin').expect(200);
        expectNoPersonalData(res.body);
      },
    );
  });

  describe('GET /v1/admin/overview', () => {
    it('la forma exacta: el mes, el anterior, 12 meses, cobrado, pendiente y los restaurantes por estado', async () => {
      const res = await call(
        'get',
        '/v1/admin/overview',
        'platformAdmin',
      ).expect(200);

      expect(res.body).toEqual({
        month: '2026-11',
        monthStatus: 'in_progress',
        revenueCop: 4000,
        checkIns: 2,
        previousMonth: '2026-10',
        previousRevenueCop: 5500,
        monthly: expect.any(Array),
        collectedCop: 2000,
        pendingCop: 5500,
        restaurants: { pending: 2, approved: 15, suspended: 1, rejected: 0 },
        currentFeeCop: 2000,
        serverTime: NOW.toISOString(),
      });
      expect(res.body.monthly).toHaveLength(12);
      expect(res.body.monthly[0]).toEqual({
        month: '2025-12',
        revenueCop: 0,
        checkIns: 0,
      });
      expect(res.body.monthly[11].month).toBe('2026-11');
    });

    it('acepta un mes cerrado', async () => {
      const res = await call(
        'get',
        '/v1/admin/overview?month=2026-10',
        'platformAdmin',
      ).expect(200);

      expect(res.body).toMatchObject({
        month: '2026-10',
        monthStatus: 'closed',
        revenueCop: 5500,
        previousMonth: '2026-09',
      });
    });
  });

  describe('validación', () => {
    it.each([
      ['/v1/admin/overview?month=2026-13', MONTH.INVALID],
      ['/v1/admin/overview?month=2026-12', MONTH.IN_FUTURE],
      ['/v1/admin/overview?month=2025-12', MONTH.BEFORE_MIN],
      ['/v1/admin/billing?month=noviembre', MONTH.INVALID],
      ['/v1/admin/activity?month=2027-01', MONTH.IN_FUTURE],
      [`/v1/admin/billing/${OWNER_RESTAURANT_ID}?month=2026-1`, MONTH.INVALID],
      [
        '/v1/admin/billing?pageSize=101',
        'El tamaño de página (pageSize) debe ser un número entero entre 1 y 100.',
      ],
      [
        '/v1/admin/activity?page=0',
        'La página (page) debe ser un número entero mayor o igual a 1.',
      ],
      [
        `/v1/admin/billing/${OWNER_RESTAURANT_ID}?pageSize=201`,
        'El tamaño de página (pageSize) debe ser un número entero entre 1 y 200.',
      ],
      [
        '/v1/admin/overview?restaurantId=x',
        'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
      ],
      [
        '/v1/admin/platform/metrics?from=2026-11-10&to=2026-11-01',
        REPORT_PERIOD_MESSAGES.FROM_AFTER_TO,
      ],
      [
        '/v1/admin/platform/metrics?to=2026-11-18',
        REPORT_PERIOD_MESSAGES.TO_IN_FUTURE,
      ],
    ])('400 en %s', async (path, message) => {
      const res = await call('get', path, 'platformAdmin').expect(400);
      expect(res.body).toEqual({
        statusCode: 400,
        message: [message],
        error: 'Bad Request',
      });
    });

    it.each([
      ['post', `/v1/admin/billing/${OWNER_RESTAURANT_ID}/2026-13/mark-paid`],
      ['post', `/v1/admin/billing/${OWNER_RESTAURANT_ID}/2026-12/mark-pending`],
    ] as const)(
      '400 con un mes inválido o futuro en la ruta: %s %s',
      async (method, path) => {
        await call(method, path, 'platformAdmin').expect(400);
      },
    );

    it.each([
      ['get', '/v1/admin/billing/no-es-uuid'],
      ['get', `/v1/admin/billing/${UNKNOWN_ID}`],
      ['post', '/v1/admin/billing/no-es-uuid/2026-10/mark-paid'],
      ['post', `/v1/admin/billing/${UNKNOWN_ID}/2026-10/mark-paid`],
      ['post', `/v1/admin/billing/${UNKNOWN_ID}/2026-10/mark-pending`],
    ] as const)('404 RESTAURANT_NOT_FOUND en %s %s', async (method, path) => {
      const res = await call(method, path, 'platformAdmin').expect(404);
      expect(res.body).toEqual(NOT_FOUND);
    });
  });

  describe('GET /v1/admin/billing', () => {
    it('el mes en curso: todo in_progress, de mayor a menor monto, con los totales del mes', async () => {
      const res = await call(
        'get',
        '/v1/admin/billing',
        'platformAdmin',
      ).expect(200);

      expect(res.body).toMatchObject({
        month: '2026-11',
        monthStatus: 'in_progress',
        period: {
          from: '2026-11-01',
          to: '2026-11-17',
          timezone: 'America/Bogota',
        },
        totals: { checkIns: 2, amountCop: 4000, paidCop: 0, pendingCop: 0 },
        total: 2,
        page: 1,
        pageSize: 20,
      });
      expect(
        res.body.items.map((item: { status: string }) => item.status),
      ).toEqual(['in_progress', 'in_progress']);
    });

    it('un mes cerrado: pending sin marcar y paid con su fecha después de marcarlo', async () => {
      const before = await call(
        'get',
        '/v1/admin/billing?month=2026-10',
        'platformAdmin',
      ).expect(200);
      expect(before.body.items[0]).toEqual({
        restaurantId: OWNER_RESTAURANT_ID,
        name: 'Casa 72',
        approvalStatus: 'approved',
        checkIns: 3,
        amountCop: 5500,
        status: 'pending',
        paidAt: null,
      });
      // Los restaurantes sin check-ins también salen, en 0.
      expect(before.body.items[1]).toMatchObject({
        restaurantId: QUIET_RESTAURANT_ID,
        approvalStatus: 'suspended',
        checkIns: 0,
        amountCop: 0,
        status: 'pending',
      });

      await call('post', MARK_PAID, 'platformAdmin').expect(200);

      const after = await call(
        'get',
        '/v1/admin/billing?month=2026-10',
        'platformAdmin',
      ).expect(200);
      expect(after.body.items[0]).toMatchObject({
        status: 'paid',
        paidAt: NOW.toISOString(),
      });
    });
  });

  describe('cobro de un restaurante', () => {
    it('el detalle: estado, monto recalculado y check-ins sin datos del comensal ni de la reserva', async () => {
      const res = await call(
        'get',
        `/v1/admin/billing/${OWNER_RESTAURANT_ID}?month=2026-10`,
        'platformAdmin',
      ).expect(200);

      expect(res.body).toEqual({
        restaurant: {
          id: OWNER_RESTAURANT_ID,
          name: 'Casa 72',
          approvalStatus: 'approved',
        },
        month: '2026-10',
        period: {
          from: '2026-10-01',
          to: '2026-10-31',
          timezone: 'America/Bogota',
        },
        status: 'pending',
        totalCheckIns: 3,
        amountCop: 5500,
        paidAt: null,
        snapshot: null,
        amountMismatch: false,
        items: [
          {
            checkInId: '11111111-1111-4111-8111-111111111111',
            checkedInAt: '2026-10-14T22:05:00.000Z',
            partySize: 4,
            feeCop: 2000,
          },
        ],
        page: 1,
        pageSize: 50,
        serverTime: NOW.toISOString(),
      });
    });

    it('marcar como cobrado guarda el snapshot; marcar de nuevo da 409 PERIOD_ALREADY_PAID', async () => {
      const paid = await call('post', MARK_PAID, 'platformAdmin').expect(200);
      expect(paid.body).toMatchObject({
        status: 'paid',
        paidAt: NOW.toISOString(),
        snapshot: { amountCop: 5500, checkIns: 3 },
        amountMismatch: false,
      });

      const again = await call('post', MARK_PAID, 'platformAdmin').expect(409);
      expect(again.body).toEqual(conflict('PERIOD_ALREADY_PAID'));
    });

    it('deshacer vuelve a pending y limpia el snapshot; deshacer otra vez da 409 PERIOD_NOT_PAID', async () => {
      await call('post', MARK_PAID, 'platformAdmin').expect(200);

      const pending = await call('post', MARK_PENDING, 'platformAdmin').expect(
        200,
      );
      expect(pending.body).toMatchObject({
        status: 'pending',
        paidAt: null,
        snapshot: null,
      });

      const again = await call('post', MARK_PENDING, 'platformAdmin').expect(
        409,
      );
      expect(again.body).toEqual(conflict('PERIOD_NOT_PAID'));
    });

    it('409 PERIOD_NOT_CLOSED con el mes en curso', async () => {
      const res = await call(
        'post',
        `/v1/admin/billing/${OWNER_RESTAURANT_ID}/2026-11/mark-paid`,
        'platformAdmin',
      ).expect(409);
      expect(res.body).toEqual(conflict('PERIOD_NOT_CLOSED'));
    });

    it('409 NOTHING_TO_BILL con un mes cerrado sin check-ins', async () => {
      const res = await call(
        'post',
        `/v1/admin/billing/${QUIET_RESTAURANT_ID}/2026-10/mark-paid`,
        'platformAdmin',
      ).expect(409);
      expect(res.body).toEqual(conflict('NOTHING_TO_BILL'));
    });
  });

  describe('GET /v1/admin/activity', () => {
    it('el directorio: estado, abierto, aprobación, actividad del mes y último cambio de mesas', async () => {
      const res = await call(
        'get',
        '/v1/admin/activity',
        'platformAdmin',
      ).expect(200);

      expect(res.body).toMatchObject({
        month: '2026-11',
        total: 2,
        page: 1,
        pageSize: 20,
      });
      expect(res.body.items).toEqual([
        {
          id: OWNER_RESTAURANT_ID,
          name: 'Casa 72',
          category: 'colombian',
          approvalStatus: 'approved',
          isOpen: true,
          approvedAt: null,
          createdAt: '2026-09-01T12:00:00.000Z',
          checkIns: 3,
          amountCop: 5500,
          lastTableActivityAt: '2026-11-16T23:10:00.000Z',
        },
        {
          id: QUIET_RESTAURANT_ID,
          name: 'Tranquilo',
          category: null,
          approvalStatus: 'suspended',
          isOpen: false,
          approvedAt: '2026-10-02T15:00:00.000Z',
          createdAt: '2026-10-01T12:00:00.000Z',
          checkIns: 0,
          amountCop: 0,
          lastTableActivityAt: null,
        },
      ]);
    });
  });

  describe('GET /v1/admin/platform/metrics', () => {
    it('vence las debidas y responde las métricas de toda la plataforma, con las 24 horas', async () => {
      const res = await call(
        'get',
        '/v1/admin/platform/metrics',
        'platformAdmin',
      ).expect(200);

      expect(expiration.expireAllDue).toHaveBeenCalledTimes(1);
      expect(res.body).toMatchObject({
        period: {
          from: '2026-11-01',
          to: '2026-11-17',
          timezone: 'America/Bogota',
        },
        basis: 'reservations_created_at',
        reservations: {
          created: 10,
          completed: 4,
          cancelled: 3,
          expired: 2,
          active: 1,
        },
        rates: { conversion: 0.4, noShow: 0.3333, cancellation: 0.3 },
        averagePartySize: 2.88,
      });
      expect(res.body.peakHours).toHaveLength(24);
      expect(res.body.peakHours[13]).toEqual({ hour: 13, reservations: 6 });
      expect(res.body.peakHours[0]).toEqual({ hour: 0, reservations: 0 });
      expect(res.body.byDayOfWeek).toHaveLength(7);
      // Sin filtro de restaurante: toda la plataforma.
      for (const [sql] of query.mock.calls as [string][]) {
        expect(sql).not.toContain('"restaurant_id" = $1');
      }
    });
  });

  describe('los endpoints del restaurante no cambian', () => {
    it('GET /v1/restaurants/me/summary sigue filtrando por el restaurante de la sesión', async () => {
      await call('get', '/v1/restaurants/me/summary', 'owner').expect(200);

      const scoped = (query.mock.calls as [string, unknown[]][]).filter(
        ([sql]) =>
          sql.includes('"reservations"') || sql.includes('"check_ins"'),
      );
      expect(scoped.length).toBeGreaterThan(0);
      for (const [sql, params] of scoped) {
        expect(sql).toContain('"restaurant_id" = $1');
        expect(params[0]).toBe(OWNER_RESTAURANT_ID);
      }
    });
  });
});
