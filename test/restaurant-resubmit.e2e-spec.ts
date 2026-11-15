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
import { TableReservations } from './../src/modules/restaurant-operations/index.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { CONTACT_PHONE_INVALID } from './../src/modules/restaurant-operations/restaurants/dto/contact-phone-field.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableArea } from './../src/modules/restaurant-operations/table-areas/table-area.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import { Clock } from './../src/modules/search-availability/index.js';
import {
  approvalTestUsers,
  fakeFirebaseAuth,
  PENDING_RESTAURANT_ID,
  REJECTED_RESTAURANT_ID,
  testUsers,
  usersRepository,
} from './support/test-accounts.js';

// Lado del restaurante de la aprobación (CLAUDE.md §11): un pendiente o un
// rechazado edita sus datos y consulta su estado; el rechazado reenvía.

const OWNER_RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const ADMIN_ID = 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f708192a3';
const NOW = new Date('2026-11-15T14:30:00Z');
const REASON = 'La dirección no coincide con el local.';

type Row = Record<string, unknown>;

function forbidden(code: AccountErrorCode) {
  return {
    statusCode: 403,
    message: ACCOUNT_ERROR_MESSAGES[code],
    error: 'Forbidden',
    errorCode: code,
  };
}

const NOT_REJECTED = {
  statusCode: 409,
  message: 'Tu solicitud no está rechazada.',
  error: 'Conflict',
  errorCode: 'RESTAURANT_NOT_REJECTED',
};

function restaurant(id: string, approvalStatus: string, extra: Row = {}): Row {
  return {
    id,
    name: 'La Esquina de Ana',
    category: 'colombian',
    address: 'Calle 72 # 10-34, Bogotá',
    isOpen: true,
    latitude: 4.655671,
    longitude: -74.057006,
    approvalStatus,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    contactPhone: '+573001234567',
    submittedAt: new Date('2026-11-10T12:00:00Z'),
    createdAt: new Date('2026-11-10T12:00:00Z'),
    updatedAt: new Date('2026-11-10T12:00:00Z'),
    ...extra,
  };
}

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) => row[key] === value);

describe('Editar y reenviar la solicitud (e2e)', () => {
  let app: INestApplication<App>;
  let restaurants: Row[];

  beforeEach(async () => {
    restaurants = [
      restaurant(OWNER_RESTAURANT_ID, 'approved'),
      restaurant(PENDING_RESTAURANT_ID, 'pending'),
      restaurant(REJECTED_RESTAURANT_ID, 'rejected', {
        rejectionReason: REASON,
        reviewedBy: ADMIN_ID,
        reviewedAt: new Date('2026-11-11T12:00:00Z'),
      }),
    ];
    const schedules: Row[] = restaurants.map(({ id }) => ({
      id: `s-${String(id)}`,
      restaurantId: id,
      dayOfWeek: 1,
      isOpen24h: true,
      opensAt: null,
      closesAt: null,
    }));
    // Lo que usan la edición (transacción), el reenvío y las lecturas.
    const manager = {
      findOne: (_entity: unknown, { where }: { where: Row }) =>
        Promise.resolve(restaurants.find((row) => matches(row, where)) ?? null),
      merge: (_entity: unknown, target: Row, ...sources: Row[]) =>
        Object.assign(target, ...sources),
      save: (row: Row) => Promise.resolve(row),
      find: (_entity: unknown, { where }: { where: Row }) =>
        Promise.resolve(schedules.filter((row) => matches(row, where))),
    };
    const restaurantsRepository = {
      manager: {
        transaction: (work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
      },
      findOneBy: (where: Row) =>
        Promise.resolve(restaurants.find((row) => matches(row, where)) ?? null),
      update: (where: Row, changes: Row) => {
        const found = restaurants.filter((row) => matches(row, where));
        for (const row of found) Object.assign(row, changes);
        return Promise.resolve({ affected: found.length });
      },
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
        EventEmitterModule.forRoot(),
        RestaurantOperationsModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => fakeFirebaseAuth)
      // La aprobación de la sesión sale de la misma tabla en memoria: después
      // de reenviar, la sesión ya es pendiente.
      .overrideProvider(RestaurantApprovalReader)
      .useValue({
        statusOf: (id: string) =>
          Promise.resolve(
            restaurants.find((row) => row.id === id)?.approvalStatus,
          ),
      })
      .overrideProvider(getRepositoryToken(User))
      .useValue(
        usersRepository([
          ...testUsers(OWNER_RESTAURANT_ID),
          ...approvalTestUsers(),
        ]),
      )
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue(restaurantsRepository)
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({
        find: ({ where }: { where: Row }) =>
          Promise.resolve(schedules.filter((row) => matches(row, where))),
      })
      .overrideProvider(getRepositoryToken(Table))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableArea))
      .useValue({})
      .overrideProvider(TableReservations)
      .useValue({ countActive: vi.fn().mockResolvedValue(0) })
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

  const send = (
    method: 'get' | 'post' | 'patch',
    path: string,
    token: string,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };
  const row = (id: string) => restaurants.find((r) => r.id === id);

  describe('PATCH /v1/restaurants/me', () => {
    it('un pendiente edita sus datos y su teléfono, y sigue pendiente', async () => {
      const res = await send('patch', '/v1/restaurants/me', 'pendingOwner', {
        name: 'Nuevo nombre',
        contactPhone: '+57 (601) 234-5678',
      }).expect(200);

      expect(res.body).toMatchObject({
        id: PENDING_RESTAURANT_ID,
        name: 'Nuevo nombre',
        contactPhone: '+576012345678',
        approvalStatus: 'pending',
        rejectionReason: null,
      });
      expect(row(PENDING_RESTAURANT_ID)?.approvalStatus).toBe('pending');
    });

    it('un rechazado edita sus datos, sigue rechazado y ve el motivo', async () => {
      const res = await send('patch', '/v1/restaurants/me', 'rejectedOwner', {
        address: 'Calle 73 # 10-10, Bogotá',
      }).expect(200);

      expect(res.body).toMatchObject({
        address: 'Calle 73 # 10-10, Bogotá',
        approvalStatus: 'rejected',
        rejectionReason: REASON,
      });
    });

    it('un aprobado también edita su teléfono', async () => {
      const res = await send('patch', '/v1/restaurants/me', 'owner', {
        contactPhone: '300 765 4321',
      }).expect(200);

      expect(res.body.contactPhone).toBe('3007654321');
      expect(res.body.approvalStatus).toBe('approved');
    });

    it.each([null, '12', 'no es un teléfono'])(
      'rechaza el teléfono %j con el mensaje del registro',
      async (contactPhone) => {
        const res = await send('patch', '/v1/restaurants/me', 'pendingOwner', {
          contactPhone,
        }).expect(400);

        expect(res.body.message).toEqual([CONTACT_PHONE_INVALID]);
      },
    );

    it('approvalStatus no se puede enviar', async () => {
      await send('patch', '/v1/restaurants/me', 'rejectedOwner', {
        approvalStatus: 'approved',
      }).expect(400);
      expect(row(REJECTED_RESTAURANT_ID)?.approvalStatus).toBe('rejected');
    });
  });

  describe('estado abierto/cerrado de un pendiente', () => {
    it('lo consulta (200) pero no lo cambia (403)', async () => {
      const get = await send(
        'get',
        '/v1/restaurants/me/status',
        'pendingOwner',
      ).expect(200);
      expect(get.body).toEqual({ isOpen: true });

      const patch = await send(
        'patch',
        '/v1/restaurants/me/status',
        'pendingOwner',
        { isOpen: false },
      ).expect(403);
      expect(patch.body).toEqual(forbidden('ACCOUNT_PENDING_APPROVAL'));
    });
  });

  describe('POST /v1/restaurants/me/resubmit', () => {
    it('un rechazado vuelve a pendiente, sin motivo ni revisión y con fecha de envío nueva', async () => {
      const res = await send(
        'post',
        '/v1/restaurants/me/resubmit',
        'rejectedOwner',
      ).expect(200);

      expect(res.body).toMatchObject({
        id: REJECTED_RESTAURANT_ID,
        approvalStatus: 'pending',
        rejectionReason: null,
        activeReservationsCount: 0,
      });
      expect(row(REJECTED_RESTAURANT_ID)).toMatchObject({
        approvalStatus: 'pending',
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
        submittedAt: NOW,
      });
      // La sesión ya es de un pendiente: sigue sin operar.
      const blocked = await send('get', '/v1/tables', 'rejectedOwner').expect(
        403,
      );
      expect(blocked.body).toEqual(forbidden('ACCOUNT_PENDING_APPROVAL'));
    });

    it('reenviar dos veces: la segunda recibe 409', async () => {
      await send('post', '/v1/restaurants/me/resubmit', 'rejectedOwner').expect(
        200,
      );
      const res = await send(
        'post',
        '/v1/restaurants/me/resubmit',
        'rejectedOwner',
      ).expect(409);
      expect(res.body).toEqual(NOT_REJECTED);
    });

    it.each([
      ['pendingOwner', PENDING_RESTAURANT_ID],
      ['owner', OWNER_RESTAURANT_ID],
    ])(
      '%s (no rechazado) recibe 409 RESTAURANT_NOT_REJECTED sin cambios',
      async (token, id) => {
        const before = { ...row(id) };
        const res = await send(
          'post',
          '/v1/restaurants/me/resubmit',
          token,
        ).expect(409);
        expect(res.body).toEqual(NOT_REJECTED);
        expect(row(id)).toEqual(before);
      },
    );

    it.each([
      ['diner', 'DINER_ACCOUNT'],
      ['platformAdmin', 'ADMIN_ACCOUNT'],
      ['noProfile', 'ACCOUNT_NOT_ENABLED'],
    ] as const)('%s recibe 403 %s', async (token, code) => {
      const res = await send(
        'post',
        '/v1/restaurants/me/resubmit',
        token,
      ).expect(403);
      expect(res.body).toEqual(forbidden(code));
    });

    it('sin sesión: 401', async () => {
      await request(app.getHttpServer())
        .post('/v1/restaurants/me/resubmit')
        .expect(401);
    });
  });
});
