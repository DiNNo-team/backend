import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { FindOperator } from 'typeorm';
import { configureApp } from './../src/app.setup.js';
import { RestaurantApprovalReader } from './../src/modules/identity-access/approval/restaurant-approval.reader.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import {
  ACCOUNT_ERROR_MESSAGES,
  type AccountErrorCode,
  type RestaurantApprovalStatus,
  UserRole,
} from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { CheckIn } from './../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { ReservationsCheckinModule } from './../src/modules/reservations-checkin/index.js';
import { ReservationExpirationService } from './../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { Reservation } from './../src/modules/reservations-checkin/reservations/reservation.entity.js';
import {
  RESTAURANT_AVAILABILITY_AFFECTED,
  TableReservations,
} from './../src/modules/restaurant-operations/index.js';
import { REJECTION_REASON_INVALID } from './../src/modules/restaurant-operations/restaurant-review/dto/reject-restaurant.dto.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableArea } from './../src/modules/restaurant-operations/table-areas/table-area.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import { Clock } from './../src/modules/search-availability/index.js';
import {
  FakeDatabaseModule,
  fakeRepository,
  type Row,
} from './support/fake-database.js';
import {
  approvalTestUsers,
  fakeFirebaseAuth,
  PENDING_RESTAURANT_ID,
  REJECTED_RESTAURANT_ID,
  testUsers,
} from './support/test-accounts.js';

// Viernes 13:00 en Bogotá: todos los restaurantes están en horario.
const FRIDAY_13H = new Date('2026-10-16T18:00:00Z');
const CASA_72 = '55bb0482-be1e-490b-9ba8-7533335d958b';
const SECOND_PENDING = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const ADMIN_ID = 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f708192a3';
const REASON = 'La dirección no coincide con el local.';

function forbidden(code: AccountErrorCode) {
  return {
    statusCode: 403,
    message: ACCOUNT_ERROR_MESSAGES[code],
    error: 'Forbidden',
    errorCode: code,
  };
}

const NOT_FOUND = {
  statusCode: 404,
  message: 'Este restaurante ya no está disponible.',
  error: 'Not Found',
  errorCode: 'RESTAURANT_NOT_FOUND',
};

const NOT_PENDING = {
  statusCode: 409,
  message: 'Esta solicitud ya fue revisada.',
  error: 'Conflict',
  errorCode: 'RESTAURANT_NOT_PENDING',
};

function restaurantRow(
  id: string,
  name: string,
  approvalStatus: RestaurantApprovalStatus,
  submittedAt: string,
  extra: Row = {},
): Row {
  return {
    id,
    name,
    category: 'colombian',
    address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
    isOpen: true,
    latitude: 4.655671,
    longitude: -74.057006,
    approvalStatus,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    contactPhone: '+573001234567',
    submittedAt: new Date(submittedAt),
    createdAt: new Date(submittedAt),
    updatedAt: new Date(submittedAt),
    ...extra,
  };
}

const users = (): Row[] =>
  [
    ...testUsers(CASA_72),
    ...approvalTestUsers(),
    {
      id: 'c9d0e1f2-a3b4-4c5d-8e6f-708192a3b4c5',
      email: 'otra.duena@example.com',
      firebaseUid: 'uid-second',
      role: UserRole.RESTAURANT_ADMIN,
      displayName: null,
      restaurantId: SECOND_PENDING,
    },
  ].map((user, index) => ({
    ...user,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
  }));

// Lo que Postgres hace con lo que envían UsersService y el panel: igualdad, In
// y orden por columnas.
function where(row: Row, conditions: Row): boolean {
  return Object.entries(conditions).every(([key, value]) =>
    value instanceof FindOperator
      ? (value.value as unknown as unknown[]).includes(row[key])
      : row[key] === value,
  );
}

type Order = Record<
  string,
  'ASC' | 'DESC' | { direction: string; nulls: string }
>;

function sortBy(rows: Row[], order: Order): Row[] {
  return [...rows].sort((a, b) => {
    for (const [key, rule] of Object.entries(order)) {
      const direction = typeof rule === 'string' ? rule : rule.direction;
      const [x, y] = [a[key], b[key]];
      if (x === y) continue;
      if (x === null) return 1; // NULLS LAST
      if (y === null) return -1;
      const less =
        (x as number | Date | string) < (y as number | Date | string);
      return (less ? -1 : 1) * (direction === 'ASC' ? 1 : -1);
    }
    return 0;
  });
}

function select(row: Row, columns?: Record<string, true>): Row {
  return columns
    ? Object.fromEntries(Object.keys(columns).map((key) => [key, row[key]]))
    : row;
}

describe('Panel del administrador de DiNNo (e2e)', () => {
  let app: INestApplication<App>;
  let restaurants: Row[];
  let emitted: unknown[][];

  beforeEach(async () => {
    restaurants = [
      restaurantRow(CASA_72, 'Casa 72', 'approved', '2026-09-01T12:00:00Z'),
      restaurantRow(
        PENDING_RESTAURANT_ID,
        'Pendiente',
        'pending',
        '2026-10-15T12:00:00Z',
      ),
      restaurantRow(
        SECOND_PENDING,
        'Segundo pendiente',
        'pending',
        '2026-10-14T12:00:00Z',
      ),
      restaurantRow(
        REJECTED_RESTAURANT_ID,
        'Rechazado',
        'rejected',
        '2026-10-10T12:00:00Z',
        {
          rejectionReason: 'Motivo anterior.',
          reviewedBy: ADMIN_ID,
          reviewedAt: new Date('2026-10-11T12:00:00Z'),
        },
      ),
    ];
    const userRows = users();
    const schedules = restaurants.map(({ id }) => ({
      restaurantId: id,
      dayOfWeek: 5,
      isOpen24h: false,
      opensAt: '11:00:00',
      closesAt: '23:00:00',
    }));
    const tables = restaurants.map(({ id }, index) => ({
      id: `t-${index}`,
      restaurantId: id,
      identifier: '01',
      capacity: 4,
      status: 'available',
      isActive: true,
    }));

    // La tabla restaurants, compartida por el panel (repositorio de
    // restaurant-operations) y por la búsqueda (lectura por nombre de entidad).
    const restaurantsRepository = {
      findAndCount: vi.fn(
        (options: { where: Row; order: Order; skip: number; take: number }) => {
          const matching = sortBy(
            restaurants.filter((row) => where(row, options.where)),
            options.order,
          );
          return Promise.resolve([
            matching.slice(options.skip, options.skip + options.take),
            matching.length,
          ]);
        },
      ),
      findOneBy: vi.fn((conditions: Row) =>
        Promise.resolve(
          restaurants.find((row) => where(row, conditions)) ?? null,
        ),
      ),
      existsBy: vi.fn((conditions: Row) =>
        Promise.resolve(restaurants.some((row) => where(row, conditions))),
      ),
      // UPDATE condicional: una sola sentencia.
      update: vi.fn((conditions: Row, changes: Row) => {
        const matching = restaurants.filter((row) => where(row, conditions));
        for (const row of matching) Object.assign(row, changes);
        return Promise.resolve({ affected: matching.length });
      }),
    };
    const usersRepository = {
      findOneBy: (conditions: Row) =>
        Promise.resolve(userRows.find((row) => where(row, conditions)) ?? null),
      find: (options: {
        where: Row;
        select?: Record<string, true>;
        order?: Order;
      }) =>
        Promise.resolve(
          sortBy(
            userRows.filter((row) => where(row, options.where)),
            options.order ?? {},
          ).map((row) => select(row, options.select)),
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
          Restaurant: fakeRepository(restaurants),
          RestaurantSchedule: fakeRepository(schedules),
          Table: fakeRepository(tables),
        }),
        EventEmitterModule.forRoot(),
        ReservationsCheckinModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => fakeFirebaseAuth)
      // La aprobación de la sesión sale de la misma tabla en memoria.
      .overrideProvider(RestaurantApprovalReader)
      .useValue({
        statusOf: (id: string) =>
          Promise.resolve(
            restaurants.find((row) => row.id === id)?.approvalStatus,
          ),
      })
      .overrideProvider(getRepositoryToken(User))
      .useValue(usersRepository)
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue(restaurantsRepository)
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({
        find: ({ where: conditions }: { where: Row }) =>
          Promise.resolve(schedules.filter((row) => where(row, conditions))),
      })
      .overrideProvider(getRepositoryToken(Table))
      .useValue({ find: vi.fn().mockResolvedValue([]) })
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableArea))
      .useValue({ find: vi.fn().mockResolvedValue([]) })
      .overrideProvider(getRepositoryToken(Reservation))
      .useValue({})
      .overrideProvider(getRepositoryToken(CheckIn))
      .useValue({})
      .overrideProvider(TableReservations)
      .useValue({
        expireDueForTable: vi.fn(),
        findActiveForTable: vi.fn(),
        countActive: vi.fn().mockResolvedValue(0),
      })
      .overrideProvider(ReservationExpirationService)
      .useValue({
        expireDueForDiner: vi.fn().mockResolvedValue(0),
        expireDueForRestaurant: vi.fn().mockResolvedValue(0),
      })
      .overrideProvider(TableStatusLog)
      .useValue({ record: vi.fn() })
      .overrideProvider(Clock)
      .useValue({ now: () => FRIDAY_13H })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    emitted = [];
    const events = app.get(EventEmitter2);
    vi.spyOn(events, 'emit').mockImplementation((...args: unknown[]) => {
      emitted.push(args);
      return true;
    });
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const call = (
    method: 'get' | 'post',
    path: string,
    token: string | null,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())[method](path);
    if (body) req.send(body);
    return token === null ? req : req.set('Authorization', `Bearer ${token}`);
  };

  const ADMIN_ROUTES: ['get' | 'post', string, object?][] = [
    ['get', '/v1/admin/restaurants'],
    ['get', `/v1/admin/restaurants/${PENDING_RESTAURANT_ID}`],
    ['post', `/v1/admin/restaurants/${PENDING_RESTAURANT_ID}/approve`],
    [
      'post',
      `/v1/admin/restaurants/${PENDING_RESTAURANT_ID}/reject`,
      { reason: REASON },
    ],
  ];

  describe('acceso', () => {
    it.each(ADMIN_ROUTES)(
      '%s %s sin sesión → 401',
      async (method, path, body) => {
        await call(method, path, null, body).expect(401);
      },
    );

    it.each([
      ['owner', 'RESTAURANT_ACCOUNT'],
      // El rol va antes que la aprobación: un pendiente es una cuenta de restaurante.
      ['pendingOwner', 'RESTAURANT_ACCOUNT'],
      ['rejectedOwner', 'RESTAURANT_ACCOUNT'],
      ['diner', 'DINER_ACCOUNT'],
      ['noProfile', 'ACCOUNT_NOT_ENABLED'],
    ] as const)(
      'una cuenta %s recibe 403 %s en todas las rutas, sin cambiar nada',
      async (token, code) => {
        for (const [method, path, body] of ADMIN_ROUTES) {
          const res = await call(method, path, token, body).expect(403);
          expect(res.body).toEqual(forbidden(code));
        }
        expect(
          restaurants.find((row) => row.id === PENDING_RESTAURANT_ID)
            ?.approvalStatus,
        ).toBe('pending');
      },
    );
  });

  describe('GET /v1/admin/restaurants', () => {
    it('por defecto, las pendientes: la que más lleva esperando primero, con el correo del dueño', async () => {
      const res = await call(
        'get',
        '/v1/admin/restaurants',
        'platformAdmin',
      ).expect(200);

      expect(res.body).toEqual({
        items: [
          {
            id: SECOND_PENDING,
            name: 'Segundo pendiente',
            category: 'colombian',
            address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
            contactPhone: '+573001234567',
            approvalStatus: 'pending',
            submittedAt: '2026-10-14T12:00:00.000Z',
            reviewedAt: null,
            ownerEmail: 'otra.duena@example.com',
          },
          expect.objectContaining({
            id: PENDING_RESTAURANT_ID,
            ownerEmail: 'pendiente@example.com',
          }),
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
    });

    it('pagina con page y pageSize', async () => {
      const res = await call(
        'get',
        '/v1/admin/restaurants?status=pending&page=2&pageSize=1',
        'platformAdmin',
      ).expect(200);

      expect(res.body.items.map((item: Row) => item.id)).toEqual([
        PENDING_RESTAURANT_ID,
      ]);
      expect(res.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    });

    it('las aprobadas: la última revisión primero', async () => {
      await call(
        'post',
        `/v1/admin/restaurants/${PENDING_RESTAURANT_ID}/approve`,
        'platformAdmin',
      ).expect(200);

      const res = await call(
        'get',
        '/v1/admin/restaurants?status=approved',
        'platformAdmin',
      ).expect(200);

      // Casa 72 nunca se revisó (aprobada por la migración): al final.
      expect(res.body.items.map((item: Row) => item.id)).toEqual([
        PENDING_RESTAURANT_ID,
        CASA_72,
      ]);
    });

    it.each([
      [
        'status=suspended',
        'El estado de la solicitud (status) debe ser uno de estos: pending, approved, rejected.',
      ],
      [
        'page=0',
        'La página (page) debe ser un número entero mayor o igual a 1.',
      ],
      [
        'pageSize=101',
        'El tamaño de página (pageSize) debe ser un número entero entre 1 y 100.',
      ],
      ['restaurantId=x', 'property restaurantId should not exist'],
    ])('400 con %s', async (query, message) => {
      const res = await call(
        'get',
        `/v1/admin/restaurants?${query}`,
        'platformAdmin',
      ).expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain(
        message.startsWith('property') ? 'restaurantId' : message,
      );
    });
  });

  describe('GET /v1/admin/restaurants/:id', () => {
    it('el detalle de un rechazado trae el motivo, el revisor y los horarios', async () => {
      const res = await call(
        'get',
        `/v1/admin/restaurants/${REJECTED_RESTAURANT_ID}`,
        'platformAdmin',
      ).expect(200);

      expect(res.body).toEqual({
        id: REJECTED_RESTAURANT_ID,
        name: 'Rechazado',
        category: 'colombian',
        address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
        contactPhone: '+573001234567',
        approvalStatus: 'rejected',
        submittedAt: '2026-10-10T12:00:00.000Z',
        reviewedAt: '2026-10-11T12:00:00.000Z',
        ownerEmail: 'rechazado@example.com',
        latitude: 4.655671,
        longitude: -74.057006,
        schedules: [
          {
            dayOfWeek: 5,
            isOpen24h: false,
            opensAt: '11:00',
            closesAt: '23:00',
          },
        ],
        rejectionReason: 'Motivo anterior.',
        reviewedByEmail: 'admin@example.com',
        createdAt: '2026-10-10T12:00:00.000Z',
      });
    });

    it.each([UNKNOWN, 'no-es-uuid'])(
      '404 RESTAURANT_NOT_FOUND con %s',
      async (id) => {
        const res = await call(
          'get',
          `/v1/admin/restaurants/${id}`,
          'platformAdmin',
        ).expect(404);
        expect(res.body).toEqual(NOT_FOUND);
      },
    );
  });

  describe('POST /v1/admin/restaurants/:id/approve', () => {
    it('aprueba, guarda la auditoría y responde el detalle', async () => {
      const res = await call(
        'post',
        `/v1/admin/restaurants/${PENDING_RESTAURANT_ID}/approve`,
        'platformAdmin',
      ).expect(200);

      expect(res.body).toMatchObject({
        id: PENDING_RESTAURANT_ID,
        approvalStatus: 'approved',
        rejectionReason: null,
        reviewedAt: FRIDAY_13H.toISOString(),
        reviewedByEmail: 'admin@example.com',
      });
      expect(
        restaurants.find((row) => row.id === PENDING_RESTAURANT_ID),
      ).toMatchObject({
        approvalStatus: 'approved',
        reviewedBy: ADMIN_ID,
        reviewedAt: FRIDAY_13H,
      });
      expect(emitted).toContainEqual([
        RESTAURANT_AVAILABILITY_AFFECTED,
        { restaurantId: PENDING_RESTAURANT_ID },
      ]);
    });

    it('el restaurante aprobado aparece después en la búsqueda y ya opera', async () => {
      const search = () =>
        call(
          'get',
          '/v1/search/restaurants?lat=4.655671&lng=-74.057006',
          'diner',
        ).expect(200);
      const before = (await search()).body.map((row: Row) => row.id);
      expect(before).not.toContain(PENDING_RESTAURANT_ID);
      await call('get', '/v1/tables', 'pendingOwner').expect(403);

      await call(
        'post',
        `/v1/admin/restaurants/${PENDING_RESTAURANT_ID}/approve`,
        'platformAdmin',
      ).expect(200);

      const after = (await search()).body.map((row: Row) => row.id);
      expect(after).toContain(PENDING_RESTAURANT_ID);
      await call('get', '/v1/tables', 'pendingOwner').expect(200);
    });

    it('409 RESTAURANT_NOT_PENDING desde rejected y desde approved, sin cambios', async () => {
      for (const id of [REJECTED_RESTAURANT_ID, CASA_72]) {
        const before = { ...restaurants.find((row) => row.id === id) };
        const res = await call(
          'post',
          `/v1/admin/restaurants/${id}/approve`,
          'platformAdmin',
        ).expect(409);
        expect(res.body).toEqual(NOT_PENDING);
        expect(restaurants.find((row) => row.id === id)).toEqual(before);
      }
      expect(emitted).toEqual([]);
    });

    it('la segunda aprobación de la misma solicitud recibe 409', async () => {
      const path = `/v1/admin/restaurants/${PENDING_RESTAURANT_ID}/approve`;
      await call('post', path, 'platformAdmin').expect(200);
      const res = await call('post', path, 'platformAdmin').expect(409);
      expect(res.body).toEqual(NOT_PENDING);
    });

    it('404 con un id inexistente o que no es UUID', async () => {
      for (const id of [UNKNOWN, 'x']) {
        const res = await call(
          'post',
          `/v1/admin/restaurants/${id}/approve`,
          'platformAdmin',
        ).expect(404);
        expect(res.body).toEqual(NOT_FOUND);
      }
    });
  });

  describe('POST /v1/admin/restaurants/:id/reject', () => {
    it('rechaza con el motivo recortado y el restaurante lo ve', async () => {
      const res = await call(
        'post',
        `/v1/admin/restaurants/${PENDING_RESTAURANT_ID}/reject`,
        'platformAdmin',
        { reason: `   ${REASON}  ` },
      ).expect(200);

      expect(res.body).toMatchObject({
        approvalStatus: 'rejected',
        rejectionReason: REASON,
        reviewedAt: FRIDAY_13H.toISOString(),
        reviewedByEmail: 'admin@example.com',
      });
      expect(emitted).toEqual([]);
      const mine = await call(
        'get',
        '/v1/restaurants/me',
        'pendingOwner',
      ).expect(200);
      expect(mine.body).toMatchObject({
        approvalStatus: 'rejected',
        rejectionReason: REASON,
      });
      const blocked = await call('get', '/v1/tables', 'pendingOwner').expect(
        403,
      );
      expect(blocked.body).toEqual(forbidden('ACCOUNT_REJECTED'));
    });

    it.each([
      ['sin motivo', {}],
      ['solo espacios', { reason: '            ' }],
      ['muy corto', { reason: 'Corto' }],
      ['muy largo', { reason: 'a'.repeat(301) }],
    ])('400 %s, en español y sin cambios', async (_, body) => {
      const res = await call(
        'post',
        `/v1/admin/restaurants/${PENDING_RESTAURANT_ID}/reject`,
        'platformAdmin',
        body,
      ).expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        message: [REJECTION_REASON_INVALID],
        error: 'Bad Request',
      });
      expect(
        restaurants.find((row) => row.id === PENDING_RESTAURANT_ID)
          ?.approvalStatus,
      ).toBe('pending');
    });

    it('400 con un campo de más', async () => {
      await call(
        'post',
        `/v1/admin/restaurants/${PENDING_RESTAURANT_ID}/reject`,
        'platformAdmin',
        { reason: REASON, approvalStatus: 'approved' },
      ).expect(400);
    });

    it('409 desde approved y 404 con un id inexistente', async () => {
      const conflict = await call(
        'post',
        `/v1/admin/restaurants/${CASA_72}/reject`,
        'platformAdmin',
        { reason: REASON },
      ).expect(409);
      expect(conflict.body).toEqual(NOT_PENDING);

      const missing = await call(
        'post',
        `/v1/admin/restaurants/${UNKNOWN}/reject`,
        'platformAdmin',
        { reason: REASON },
      ).expect(404);
      expect(missing.body).toEqual(NOT_FOUND);
    });
  });
});
