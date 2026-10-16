import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { AddressInfo, Server } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
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

// Friday 2026-10-16 13:00 in Bogotá (the restaurant opens 24 hours anyway).
const FRIDAY_13H = new Date('2026-10-16T18:00:00Z');

const CASA_72 = 'a4765bce-fc28-496c-bdbc-68bd1599f1d9';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const T4 = '44444444-4444-4444-8444-444444444444';

// How long to wait for an event that must arrive.
const EVENT_TIMEOUT_MS = 3_000;

type TableRow = Pick<
  Table,
  'id' | 'restaurantId' | 'identifier' | 'capacity' | 'status' | 'isActive'
>;

// One in-memory database shared by both sides, as in production: the HTTP
// writes of restaurant-operations and the reads of AvailabilityService.
function createDatabase() {
  const restaurant = {
    id: CASA_72,
    name: 'Casa 72',
    isOpen: true,
    latitude: 4.655671,
    longitude: -74.057006,
  };
  // 1 of 4 active tables free: "few" (25 %).
  const tables: TableRow[] = [
    { id: T1, status: 'available' },
    { id: T2, status: 'occupied' },
    { id: T3, status: 'occupied' },
    { id: T4, status: 'reserved' },
  ].map((table, index) => ({
    ...table,
    restaurantId: CASA_72,
    identifier: `0${index + 1}`,
    capacity: 4,
    isActive: true,
  })) as TableRow[];
  const schedules = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
    restaurantId: CASA_72,
    dayOfWeek,
    isOpen24h: true,
    opensAt: null,
    closesAt: null,
  }));

  // The repositories of restaurant-operations (HTTP side): a transaction
  // whose manager writes straight into the shared rows.
  const manager = {
    findOne: (_entity: unknown, { where }: { where: Partial<TableRow> }) => {
      const found = tables.find(
        (t) => t.id === where.id && t.restaurantId === where.restaurantId,
      );
      return Promise.resolve(found ? { ...found } : null);
    },
    save: (table: TableRow) => {
      Object.assign(tables.find((t) => t.id === table.id) ?? {}, table);
      return Promise.resolve({ ...table });
    },
  };
  const tablesRepository = {
    manager: {
      transaction: (work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
    },
  };
  const restaurantsRepository = {
    findOneBy: () => Promise.resolve({ ...restaurant }),
    update: (_where: unknown, changes: Partial<typeof restaurant>) => {
      Object.assign(restaurant, changes);
      return Promise.resolve({ affected: 1 });
    },
  };

  return {
    tables,
    tablesRepository,
    restaurantsRepository,
    // The read side (AvailabilityService) sees the same row objects.
    readOnly: {
      Restaurant: fakeRepository([restaurant]),
      RestaurantSchedule: fakeRepository(schedules),
      Table: fakeRepository(tables),
    },
  };
}

interface AvailabilityChanged {
  restaurantId: string;
  availability: string;
  isOpenNow: boolean;
  isSearchable: boolean;
}

// Prueba el tiempo real de punta a punta sin PostgreSQL ni Firebase: un
// servidor real en un puerto libre, socket.io-client y una base simulada.
describe('Real time: availability.changed (e2e)', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let db: ReturnType<typeof createDatabase>;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    db = createDatabase();
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
        FakeDatabaseModule.with(db.readOnly),
        EventEmitterModule.forRoot(),
        RestaurantOperationsModule,
        SearchAvailabilityModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => fakeFirebaseAuth)
      .overrideProvider(getRepositoryToken(User))
      .useValue(usersRepository(testUsers(CASA_72)))
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue(db.restaurantsRepository)
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({})
      .overrideProvider(getRepositoryToken(Table))
      .useValue(db.tablesRepository)
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(TableStatusLog)
      .useValue({ record: vi.fn().mockResolvedValue(undefined) })
      .overrideProvider(Clock)
      .useValue({ now: () => FRIDAY_13H })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as unknown as Server;
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
    await app.close();
  });

  // No reconnection and its own connection, so nothing outlives the test.
  function connect(auth: Record<string, string>): Promise<Socket> {
    const socket = io(baseUrl, {
      auth,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  function nextEvent(socket: Socket): Promise<AvailabilityChanged> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('availability.changed did not arrive')),
        EVENT_TIMEOUT_MS,
      );
      socket.once('availability.changed', (payload: AvailabilityChanged) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  const asOwner = () => request(app.getHttpServer());
  const OWNER = { Authorization: 'Bearer owner' };

  it('sends a diner the new level when a table status changes, without counts', async () => {
    const socket = await connect({ token: 'diner' });
    const event = nextEvent(socket);

    // 1 → 2 free of 4: from "few" to "available".
    await asOwner()
      .patch(`/v1/tables/${T2}/status`)
      .set(OWNER)
      .send({ status: 'available' })
      .expect(200);

    const payload = await event;
    expect(payload).toEqual({
      restaurantId: CASA_72,
      availability: 'available',
      isOpenNow: true,
      isSearchable: true,
    });
    expect(Object.keys(payload).sort()).toEqual([
      'availability',
      'isOpenNow',
      'isSearchable',
      'restaurantId',
    ]);
  });

  it('sends closed when the restaurant is closed', async () => {
    const socket = await connect({ token: 'diner' });
    const event = nextEvent(socket);

    await asOwner()
      .patch('/v1/restaurants/me/status')
      .set(OWNER)
      .send({ isOpen: false })
      .expect(200);

    await expect(event).resolves.toEqual({
      restaurantId: CASA_72,
      availability: 'closed',
      isOpenNow: false,
      isSearchable: false,
    });
  });

  it('sends isSearchable false when the last active table is deactivated', async () => {
    for (const table of db.tables.filter((t) => t.id !== T1)) {
      table.isActive = false;
    }
    const socket = await connect({ token: 'diner' });
    const event = nextEvent(socket);

    await asOwner().post(`/v1/tables/${T1}/deactivate`).set(OWNER).expect(200);

    await expect(event).resolves.toMatchObject({
      restaurantId: CASA_72,
      isOpenNow: true,
      isSearchable: false,
    });
  });

  // Without a fixed wait: a real change follows the no-op one, and the first
  // event must be the real one. An event from the no-op would arrive first
  // and say "few" (still 1 of 4 free) instead of "available".
  it('sends nothing when the table already had that status', async () => {
    const socket = await connect({ token: 'diner' });
    const event = nextEvent(socket);

    await asOwner()
      .patch(`/v1/tables/${T2}/status`)
      .set(OWNER)
      .send({ status: 'occupied' })
      .expect(200);
    await asOwner()
      .patch(`/v1/tables/${T2}/status`)
      .set(OWNER)
      .send({ status: 'available' })
      .expect(200);

    await expect(event).resolves.toMatchObject({
      restaurantId: CASA_72,
      availability: 'available',
    });
  });

  it.each([
    ['a restaurant account', { token: 'owner' }, 'RESTAURANT_ACCOUNT'],
    ['an account without profile', { token: 'noProfile' }, 'PROFILE_REQUIRED'],
    ['no token', {}, 'UNAUTHORIZED'],
    ['an invalid token', { token: 'not-a-token' }, 'UNAUTHORIZED'],
  ])('rejects %s with connect_error %s', async (_case, auth, code) => {
    await expect(connect(auth)).rejects.toMatchObject({ message: code });
  });
});
