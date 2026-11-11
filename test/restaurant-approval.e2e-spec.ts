import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, type Socket } from 'socket.io-client';
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
import { CheckIn } from './../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { ReservationsCheckinModule } from './../src/modules/reservations-checkin/index.js';
import { ReservationExpirationService } from './../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { Reservation } from './../src/modules/reservations-checkin/reservations/reservation.entity.js';
import {
  RESTAURANT_AVAILABILITY_AFFECTED,
  TableReservations,
} from './../src/modules/restaurant-operations/index.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableArea } from './../src/modules/restaurant-operations/table-areas/table-area.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import {
  AvailabilityService,
  Clock,
} from './../src/modules/search-availability/index.js';
import { AvailabilityGateway } from './../src/modules/search-availability/realtime/availability.gateway.js';
import {
  FakeDatabaseModule,
  fakeRepository,
  type Row,
} from './support/fake-database.js';
import {
  approvalReader,
  approvalTestUsers,
  fakeFirebaseAuth,
  PENDING_RESTAURANT_ID,
  REJECTED_RESTAURANT_ID,
  TEST_APPROVALS,
  testUsers,
  usersRepository,
} from './support/test-accounts.js';

// Viernes 13:00 en Bogotá: los tres restaurantes están en horario.
const FRIDAY_13H = new Date('2026-10-16T18:00:00Z');
const CASA_72 = '55bb0482-be1e-490b-9ba8-7533335d958b';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const CODE = 'K7M4QX';
const REJECTION_REASON = 'La dirección no coincide con el local.';

// Tres restaurantes en el mismo lugar, abiertos y con mesas libres: solo
// cambia la aprobación (CLAUDE.md §11, "Aprobación de restaurantes").
const restaurant = (
  id: string,
  name: string,
  approvalStatus: string,
  rejectionReason: string | null = null,
): Row => ({
  id,
  name,
  category: 'colombian',
  address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
  isOpen: true,
  latitude: 4.655671,
  longitude: -74.057006,
  approvalStatus,
  rejectionReason,
  contactPhone: '+573001234567',
});

const RESTAURANTS = [
  restaurant(CASA_72, 'Casa 72', 'approved'),
  restaurant(PENDING_RESTAURANT_ID, 'Pendiente', 'pending'),
  restaurant(REJECTED_RESTAURANT_ID, 'Rechazado', 'rejected', REJECTION_REASON),
];

const SCHEDULES = RESTAURANTS.map(({ id }) => ({
  restaurantId: id,
  dayOfWeek: 5,
  isOpen24h: false,
  opensAt: '11:00:00',
  closesAt: '23:00:00',
}));

const TABLES = RESTAURANTS.map(({ id }, index) => ({
  id: `t-${index}`,
  restaurantId: id,
  identifier: '01',
  capacity: 4,
  status: 'available',
  isActive: true,
}));

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

// Every route of a restaurant that a pending or rejected one must not use.
const BLOCKED_RESTAURANT_ROUTES: [string, string, object?][] = [
  ['get', '/v1/tables'],
  ['post', '/v1/tables', { identifier: '04', capacity: 4 }],
  ['patch', `/v1/tables/${TABLE_ID}/status`, { status: 'occupied' }],
  ['patch', `/v1/tables/${TABLE_ID}`, { capacity: 2 }],
  ['post', `/v1/tables/${TABLE_ID}/deactivate`],
  ['post', `/v1/tables/${TABLE_ID}/reactivate`],
  ['put', '/v1/tables/plan', { tables: [] }],
  ['get', '/v1/table-areas'],
  ['post', '/v1/table-areas', { name: 'Terraza' }],
  ['post', '/v1/restaurants', { name: 'Nuevo' }],
  // Edición y reenvío: llegan en la tarea 2; por ahora, bloqueados.
  ['patch', '/v1/restaurants/me', { name: 'Otro' }],
  ['get', '/v1/restaurants/me/status'],
  ['patch', '/v1/restaurants/me/status', { isOpen: false }],
  ['get', '/v1/table-logs'],
  ['get', '/v1/restaurants/me/reservations'],
  ['post', '/v1/restaurants/me/check-ins', { code: CODE }],
];

type Method = 'get' | 'post' | 'patch' | 'put';

describe('Restaurant approval (e2e)', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let sockets: Socket[];
  let writes: Record<string, ReturnType<typeof vi.fn>>;
  let readRestaurants: ReturnType<typeof fakeRepository>;

  beforeEach(async () => {
    sockets = [];
    writes = {
      transaction: vi.fn(() => Promise.reject(new Error('no debe escribir'))),
    };
    readRestaurants = fakeRepository(RESTAURANTS);
    // Lo que leen las rutas del restaurante (restaurant-operations).
    const ownRestaurants = {
      findOneBy: vi.fn(({ id }: { id: string }) =>
        Promise.resolve(RESTAURANTS.find((row) => row.id === id) ?? null),
      ),
      manager: { transaction: writes.transaction },
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
        FakeDatabaseModule.with(
          {
            Restaurant: readRestaurants,
            RestaurantSchedule: fakeRepository(SCHEDULES),
            Table: fakeRepository(TABLES),
          },
          { transaction: writes.transaction },
        ),
        EventEmitterModule.forRoot(),
        ReservationsCheckinModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => fakeFirebaseAuth)
      .overrideProvider(RestaurantApprovalReader)
      .useValue(approvalReader({ [CASA_72]: 'approved', ...TEST_APPROVALS }))
      .overrideProvider(getRepositoryToken(User))
      .useValue(
        usersRepository([...testUsers(CASA_72), ...approvalTestUsers()]),
      )
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue(ownRestaurants)
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({ find: vi.fn().mockResolvedValue([]) })
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
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as unknown as Server;
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
    await app.close();
    vi.restoreAllMocks();
  });

  const call = (method: Method, path: string, token: string, body?: object) => {
    const req = request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };

  describe('a pending or rejected restaurant does not operate', () => {
    it.each(BLOCKED_RESTAURANT_ROUTES)(
      'pending: %s %s → 403 ACCOUNT_PENDING_APPROVAL, without touching the data',
      async (method, path, body) => {
        const res = await call(
          method as Method,
          path,
          'pendingOwner',
          body,
        ).expect(403);

        expect(res.body).toEqual(forbidden('ACCOUNT_PENDING_APPROVAL'));
        expect(writes.transaction).not.toHaveBeenCalled();
      },
    );

    it.each(BLOCKED_RESTAURANT_ROUTES)(
      'rejected: %s %s → 403 ACCOUNT_REJECTED',
      async (method, path, body) => {
        const res = await call(
          method as Method,
          path,
          'rejectedOwner',
          body,
        ).expect(403);

        expect(res.body).toEqual(forbidden('ACCOUNT_REJECTED'));
      },
    );

    it('a pending restaurant on a diner route gets the role code first: RESTAURANT_ACCOUNT', async () => {
      const res = await call('get', '/v1/search/zones', 'pendingOwner').expect(
        403,
      );

      expect(res.body).toEqual(forbidden('RESTAURANT_ACCOUNT'));
    });
  });

  describe('a pending or rejected restaurant still sees its own status', () => {
    it('GET /v1/me answers the pending account', async () => {
      const res = await call('get', '/v1/me', 'pendingOwner').expect(200);

      expect(res.body).toEqual({
        id: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7081',
        email: 'pendiente@example.com',
        displayName: null,
        role: 'restaurant_admin',
        restaurantId: PENDING_RESTAURANT_ID,
      });
    });

    it('GET /v1/restaurants/me answers pending without a reason', async () => {
      const res = await call(
        'get',
        '/v1/restaurants/me',
        'pendingOwner',
      ).expect(200);

      expect(res.body).toMatchObject({
        id: PENDING_RESTAURANT_ID,
        approvalStatus: 'pending',
        rejectionReason: null,
        contactPhone: '+573001234567',
        activeReservationsCount: 0,
      });
    });

    it('GET /v1/restaurants/me answers rejected with its reason', async () => {
      const res = await call(
        'get',
        '/v1/restaurants/me',
        'rejectedOwner',
      ).expect(200);

      expect(res.body).toMatchObject({
        id: REJECTED_RESTAURANT_ID,
        approvalStatus: 'rejected',
        rejectionReason: REJECTION_REASON,
      });
    });

    it('an approved restaurant answers approved, without a reason', async () => {
      const res = await call('get', '/v1/restaurants/me', 'owner').expect(200);

      expect(res.body).toMatchObject({
        id: CASA_72,
        approvalStatus: 'approved',
        rejectionReason: null,
      });
    });
  });

  describe('a DiNNo admin (platform_admin)', () => {
    it.each<[Method, string, object?]>([
      ['get', '/v1/tables'],
      ['get', '/v1/restaurants/me'],
      ['get', '/v1/restaurants/me/reservations'],
      ['get', '/v1/search/zones'],
      ['get', `/v1/restaurants/${CASA_72}/public`],
      ['post', '/v1/reservations', { restaurantId: CASA_72, partySize: 2 }],
      ['get', '/v1/reservations/active'],
    ])('%s %s → 403 ADMIN_ACCOUNT', async (method, path, body) => {
      const res = await call(method, path, 'platformAdmin', body).expect(403);

      expect(res.body).toEqual(forbidden('ADMIN_ACCOUNT'));
    });

    it('GET /v1/me answers its account with the role platform_admin', async () => {
      const res = await call('get', '/v1/me', 'platformAdmin').expect(200);

      expect(res.body).toEqual({
        id: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f708192a3',
        email: 'admin@example.com',
        displayName: null,
        role: 'platform_admin',
        restaurantId: null,
      });
    });
  });

  describe('the diner never sees a restaurant that is not approved', () => {
    it('the search shows only the approved one', async () => {
      const res = await call(
        'get',
        '/v1/search/restaurants?lat=4.655671&lng=-74.057006',
        'diner',
      ).expect(200);

      expect(res.body.map((row: { id: string }) => row.id)).toEqual([CASA_72]);
    });

    it('the search asks the database only for approved restaurants', async () => {
      await call('get', '/v1/search/zones', 'diner').expect(200);
      await call(
        'get',
        '/v1/search/restaurants?zone=chapinero&radiusKm=10',
        'diner',
      ).expect(200);

      for (const [options] of readRestaurants.find.mock.calls) {
        expect(options.where).toMatchObject({ approvalStatus: 'approved' });
      }
    });

    it.each([
      ['pending', PENDING_RESTAURANT_ID],
      ['rejected', REJECTED_RESTAURANT_ID],
      ['unknown', UNKNOWN],
    ])(
      'the public detail of a %s restaurant → the same 404',
      async (_case, id) => {
        const res = await call(
          'get',
          `/v1/restaurants/${id}/public`,
          'diner',
        ).expect(404);

        expect(res.body).toEqual(NOT_FOUND);
      },
    );

    it('the public detail of the approved one is unchanged', async () => {
      const res = await call(
        'get',
        `/v1/restaurants/${CASA_72}/public`,
        'diner',
      ).expect(200);

      expect(res.body).toMatchObject({
        id: CASA_72,
        isOpenNow: true,
        availability: 'available',
      });
    });

    it.each([
      ['pending', PENDING_RESTAURANT_ID],
      ['rejected', REJECTED_RESTAURANT_ID],
      ['unknown', UNKNOWN],
    ])(
      'a reservation on a %s restaurant → the same 404, without a transaction',
      async (_case, id) => {
        const res = await call('post', '/v1/reservations', 'diner', {
          restaurantId: id,
          partySize: 2,
        }).expect(404);

        expect(res.body).toEqual(NOT_FOUND);
        expect(writes.transaction).not.toHaveBeenCalled();
      },
    );
  });

  describe('availability.changed', () => {
    // The listener runs apart (async: true): wait until its availability read
    // has finished, then until the next turn, before looking at the gateway.
    async function broadcastsFor(restaurantId: string) {
      const broadcast = vi
        .spyOn(app.get(AvailabilityGateway), 'broadcast')
        .mockImplementation(() => undefined);
      const read = vi.spyOn(app.get(AvailabilityService), 'getForRestaurant');
      app
        .get(EventEmitter2)
        .emit(RESTAURANT_AVAILABILITY_AFFECTED, { restaurantId });
      await vi.waitFor(() => expect(read).toHaveBeenCalledWith(restaurantId));
      await read.mock.results[0].value;
      await new Promise((resolve) => setImmediate(resolve));
      return broadcast;
    }

    it.each([
      ['pending', PENDING_RESTAURANT_ID],
      ['rejected', REJECTED_RESTAURANT_ID],
    ])('a %s restaurant sends nothing to the diners', async (_case, id) => {
      expect(await broadcastsFor(id)).not.toHaveBeenCalled();
    });

    it('an approved restaurant still sends it', async () => {
      expect(await broadcastsFor(CASA_72)).toHaveBeenCalledWith({
        restaurantId: CASA_72,
        availability: 'available',
        isOpenNow: true,
        isSearchable: true,
      });
    });
  });

  describe('WebSocket handshake', () => {
    function rejectionOf(token: string): Promise<string> {
      const socket = io(baseUrl, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);
      return new Promise((resolve, reject) => {
        socket.once('connect', () => reject(new Error('Se conectó')));
        socket.once('connect_error', (error: Error) => resolve(error.message));
      });
    }

    it.each([
      ['pendingOwner', 'ACCOUNT_PENDING_APPROVAL'],
      ['rejectedOwner', 'ACCOUNT_REJECTED'],
      ['platformAdmin', 'ADMIN_ACCOUNT'],
    ])('rejects %s with connect_error %s', async (token, code) => {
      await expect(rejectionOf(token)).resolves.toBe(code);
    });

    it('still accepts an approved restaurant', async () => {
      const socket = io(baseUrl, {
        auth: { token: 'owner' },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);

      await expect(
        new Promise((resolve, reject) => {
          socket.once('connect', () => resolve('connected'));
          socket.once('connect_error', reject);
        }),
      ).resolves.toBe('connected');
    });
  });
});
