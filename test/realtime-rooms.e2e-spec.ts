import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { AddressInfo, Server } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  FindOperator,
  UpdateQueryBuilder,
  type DataSource,
  type FindOptionsWhere,
} from 'typeorm';
import { configureApp } from './../src/app.setup.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import { UserRole } from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { CheckIn } from './../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { ReservationsCheckinModule } from './../src/modules/reservations-checkin/index.js';
import { ReservationExpirationService } from './../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { Reservation } from './../src/modules/reservations-checkin/reservations/reservation.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import {
  Clock,
  SearchAvailabilityModule,
} from './../src/modules/search-availability/index.js';
import { AvailabilityGateway } from './../src/modules/search-availability/realtime/availability.gateway.js';
import { FakeDatabaseModule, type Row } from './support/fake-database.js';
import { usersRepository } from './support/test-accounts.js';
import { createMetadataOnlyDataSource } from './support/typeorm-metadata.js';

// Salas y eventos del WebSocket (Sprint 3, §12.7 y §12.8) de punta a punta sin
// PostgreSQL ni Firebase: servidor real, socket.io-client, los servicios reales y
// una base en memoria. El comportamiento real del SQL y del commit lo cubre
// test/db/realtime-events.db-spec.ts.

// Viernes 2026-10-16 13:00 en Bogotá (los dos restaurantes abren 24 horas).
const START = new Date('2026-10-16T18:00:00Z');
const AFTER_TTL = new Date('2026-10-16T18:16:00Z');

const RESTAURANT_A = 'a4765bce-fc28-496c-bdbc-68bd1599f1d9';
const RESTAURANT_B = '66cc1593-cf2f-4a1c-8ca9-8644446e069c';
const TABLE_A1 = '11111111-1111-4111-8111-111111111111';
const TABLE_A2 = '22222222-2222-4222-8222-222222222222';
const TABLE_B1 = '33333333-3333-4333-8333-333333333333';
const DINER_1 = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const DINER_2 = '8e7d6c5b-4a3f-4e2d-9c1b-0a9f8e7d6c5b';
const OWNER_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OWNER_B = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const OWNER_BARE = 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f';

const account = (
  token: string,
  id: string,
  role: UserRole,
  restaurantId: string | null,
  displayName: string | null,
) =>
  ({
    id,
    email: `${token}@example.com`,
    firebaseUid: `uid-${token}`,
    role,
    displayName,
    restaurantId,
  }) as User;

const USERS = [
  account('diner1', DINER_1, UserRole.DINER, null, 'Ana'),
  account('diner2', DINER_2, UserRole.DINER, null, 'Luis'),
  account('ownerA', OWNER_A, UserRole.RESTAURANT_ADMIN, RESTAURANT_A, null),
  account('ownerB', OWNER_B, UserRole.RESTAURANT_ADMIN, RESTAURANT_B, null),
  account('ownerBare', OWNER_BARE, UserRole.RESTAURANT_ADMIN, null, null),
];

// Lo que hacen las opciones de find de los servicios sobre una fila.
function rowMatches(row: Row, where: FindOptionsWhere<Row>): boolean {
  return Object.entries(where).every(([column, condition]) => {
    const value = row[column];
    if (!(condition instanceof FindOperator)) {
      return value === condition;
    }
    if (condition.type === 'in') {
      return (condition.value as unknown as unknown[]).includes(value);
    }
    if (condition.type === 'moreThan') {
      return (value as Date) > (condition.value as unknown as Date);
    }
    throw new Error(`Operador no simulado: ${condition.type}`);
  });
}

interface Query {
  where: FindOptionsWhere<Row>;
  select?: Record<string, true>;
}

// Repositorio en memoria: lee y escribe las mismas filas desde todos los lados.
function memoryRepository(rows: Row[]) {
  const pick = (row: Row, select?: Record<string, true>) =>
    select
      ? Object.fromEntries(Object.keys(select).map((c) => [c, row[c]]))
      : { ...row };
  return {
    rows,
    find: ({ where, select }: Query) =>
      Promise.resolve(
        rows
          .filter((row) => rowMatches(row, where))
          .map((r) => pick(r, select)),
      ),
    findOne: ({ where, select }: Query) => {
      const found = rows.find((row) => rowMatches(row, where));
      return Promise.resolve(found ? pick(found, select) : null);
    },
    exists: ({ where }: Query) =>
      Promise.resolve(rows.some((row) => rowMatches(row, where))),
    count: ({ where }: Query) =>
      Promise.resolve(rows.filter((row) => rowMatches(row, where)).length),
    update: (where: FindOptionsWhere<Row>, changes: Row) => {
      const hits = rows.filter((row) => rowMatches(row, where));
      hits.forEach((row) => Object.assign(row, changes));
      return Promise.resolve({ affected: hits.length });
    },
    insert: (row: Row) => {
      rows.push({ ...row });
      return Promise.resolve({});
    },
    save: (row: Row) => {
      const saved = { ...row, id: randomUUID(), createdAt: START };
      rows.push(saved);
      return Promise.resolve({ ...saved });
    },
  };
}

function createDatabase() {
  const table = (
    id: string,
    restaurantId: string,
    identifier: string,
    capacity: number,
  ): Row => ({
    id,
    restaurantId,
    identifier,
    capacity,
    status: 'available',
    isActive: true,
  });
  const restaurant = (id: string, name: string): Row => ({
    id,
    name,
    address: 'Calle 72',
    isOpen: true,
    latitude: 4.655671,
    longitude: -74.057006,
  });
  const repositories = {
    Restaurant: memoryRepository([
      restaurant(RESTAURANT_A, 'Casa 72'),
      restaurant(RESTAURANT_B, 'Otro'),
    ]),
    RestaurantSchedule: memoryRepository(
      [RESTAURANT_A, RESTAURANT_B].flatMap((restaurantId) =>
        [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
          restaurantId,
          dayOfWeek,
          isOpen24h: true,
          opensAt: null,
          closesAt: null,
        })),
      ),
    ),
    Table: memoryRepository([
      table(TABLE_A1, RESTAURANT_A, '01', 2),
      table(TABLE_A2, RESTAURANT_A, '02', 4),
      table(TABLE_B1, RESTAURANT_B, '01', 2),
    ]),
    Reservation: memoryRepository([]),
    CheckIn: memoryRepository([]),
  };
  return repositories;
}

const DONE = 'test.done';

describe('Tiempo real: salas y eventos de reserva (e2e)', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let db: ReturnType<typeof createDatabase>;
  let metadataDataSource: DataSource;
  let now: Date;
  const sockets: Socket[] = [];
  const statusLog = { record: vi.fn(() => Promise.resolve()) };

  beforeAll(async () => {
    metadataDataSource = await createMetadataOnlyDataSource();
  });

  // Responde el UPDATE ... RETURNING del SQL real de TypeORM como Postgres.
  function runReservationUpdate(sql: string, params: unknown[]) {
    const rows = db.Reservation.rows;
    const [status, instant] = params as [string, Date];
    let hits: Row[];
    if (status === 'expired') {
      const scope = /AND "(id|diner_id|table_id|restaurant_id)" = \$5/.exec(
        sql,
      );
      const property = {
        id: 'id',
        diner_id: 'dinerId',
        table_id: 'tableId',
        restaurant_id: 'restaurantId',
      }[scope?.[1] ?? 'id'] as string;
      hits = rows.filter(
        (row) =>
          row.status === 'active' &&
          (row.expiresAt as Date) <= instant &&
          (!scope || row[property] === params[4]),
      );
      hits.forEach((row) =>
        Object.assign(row, { status, expiredAt: instant, noShow: true }),
      );
    } else {
      const owner = status === 'cancelled' ? 'dinerId' : 'restaurantId';
      hits = rows.filter(
        (row) =>
          row.id === params[2] &&
          row[owner] === params[3] &&
          row.status === 'active' &&
          (row.expiresAt as Date) > instant,
      );
      const stamp = status === 'cancelled' ? 'cancelledAt' : 'checkedInAt';
      hits.forEach((row) => Object.assign(row, { status, [stamp]: instant }));
    }
    const columns = (/RETURNING (.+)$/.exec(sql)?.[1] ?? '')
      .split(',')
      .map((c) => c.trim().replace(/"/g, ''));
    const record = (row: Row): Row => ({
      id: row.id,
      table_id: row.tableId,
      restaurant_id: row.restaurantId,
      diner_id: row.dinerId,
    });
    const raw = hits.map((row) =>
      Object.fromEntries(columns.map((c) => [c, record(row)[c]])),
    );
    return { raw, affected: raw.length, generatedMaps: [] };
  }

  beforeEach(async () => {
    db = createDatabase();
    now = START;
    statusLog.record.mockClear();
    statusLog.record.mockImplementation(() => Promise.resolve());

    vi.spyOn(UpdateQueryBuilder.prototype, 'execute').mockImplementation(
      function (this: UpdateQueryBuilder<Reservation>) {
        const [sql, params] = this.getQueryAndParameters();
        return Promise.resolve(runReservationUpdate(sql, params));
      } as never,
    );

    const byName = (target: string | { name: string }) =>
      db[
        (typeof target === 'string' ? target : target.name) as keyof typeof db
      ];
    const manager = {
      createQueryBuilder: () => metadataDataSource.createQueryBuilder(),
      getRepository: byName,
      // Lo que usa TablesService: la fila y su escritura completa.
      findOne: (_entity: unknown, query: Query) => db.Table.findOne(query),
      save: (table: Row) => {
        Object.assign(
          db.Table.rows.find((row) => row.id === table.id) ?? {},
          table,
        );
        return Promise.resolve({ ...table });
      },
    };
    const transaction = (work: (m: unknown) => Promise<unknown>) =>
      work(manager);

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
            Restaurant: db.Restaurant as never,
            RestaurantSchedule: db.RestaurantSchedule as never,
            Table: db.Table as never,
            Reservation: db.Reservation as never,
          },
          { transaction },
        ),
        EventEmitterModule.forRoot(),
        RestaurantOperationsModule,
        SearchAvailabilityModule,
        ReservationsCheckinModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => ({
        verifyIdToken: (token: string) => {
          const user = USERS.find((u) => u.firebaseUid === `uid-${token}`);
          return user
            ? Promise.resolve({
                uid: user.firebaseUid,
                email: user.email,
                email_verified: true,
              })
            : Promise.reject(
                Object.assign(new Error('bad token'), {
                  code: 'auth/argument-error',
                }),
              );
        },
      }))
      .overrideProvider(getRepositoryToken(User))
      .useValue({
        ...usersRepository(USERS),
        find: memoryRepository(USERS as unknown as Row[]).find,
      })
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue({})
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({})
      .overrideProvider(getRepositoryToken(Table))
      .useValue({ manager: { transaction } })
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(Reservation))
      .useValue({})
      .overrideProvider(getRepositoryToken(CheckIn))
      .useValue({})
      .overrideProvider(TableStatusLog)
      .useValue(statusLog)
      .overrideProvider(Clock)
      .useValue({ now: () => now })
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

  type Received = [string, Record<string, unknown>][];

  function connect(token: string): Promise<{
    socket: Socket;
    received: Received;
  }> {
    const socket = io(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    const received: Received = [];
    socket.onAny((name: string, payload: Record<string, unknown>) => {
      received.push([name, payload]);
    });
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve({ socket, received }));
      socket.once('connect_error', reject);
    });
  }

  // Los cuatro conectados: dos restaurantes y dos comensales.
  async function connectEveryone() {
    const [ownerA, ownerB, diner1, diner2] = await Promise.all([
      connect('ownerA'),
      connect('ownerB'),
      connect('diner1'),
      connect('diner2'),
    ]);
    return { ownerA, ownerB, diner1, diner2 };
  }

  type Everyone = Awaited<ReturnType<typeof connectEveryone>>;

  // Sin esperas a ciegas: un socket entrega en orden, así que cuando llega un
  // evento centinela a todos, ya llegó todo lo anterior. Los 50 ms son para el
  // listener de disponibilidad, que corre aparte (async: true).
  async function settle(everyone: Everyone): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const all = Object.values(everyone);
    const done = all.map(
      ({ socket }) =>
        new Promise<void>((resolve) => {
          socket.once(DONE, () => resolve());
        }),
    );
    app
      .get(AvailabilityGateway)
      .emitToRooms(
        ['diners', `restaurant:${RESTAURANT_A}`, `restaurant:${RESTAURANT_B}`],
        DONE,
        {},
      );
    await Promise.all(done);
  }

  // Los nombres que recibió cada socket desde la última vez, y se limpian.
  function take({ received }: { received: Received }): Received {
    return received.splice(0).filter(([name]) => name !== DONE);
  }
  const names = (events: Received) => events.map(([name]) => name);

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function reserve(token = 'diner1', restaurantId = RESTAURANT_A) {
    const res = await http()
      .post('/v1/reservations')
      .set(bearer(token))
      .send({ restaurantId, partySize: 2 })
      .expect(201);
    return res.body as { id: string; code: string };
  }

  describe('el handshake y las salas', () => {
    it('acepta a un restaurant_admin con restaurante', async () => {
      const { socket } = await connect('ownerA');

      expect(socket.connected).toBe(true);
    });

    it('rechaza con RESTAURANT_REQUIRED a un restaurant_admin sin restaurante', async () => {
      await expect(connect('ownerBare')).rejects.toMatchObject({
        message: 'RESTAURANT_REQUIRED',
      });
    });

    it('un comensal sigue recibiendo availability.changed; un restaurante, no', async () => {
      const everyone = await connectEveryone();

      await http()
        .patch(`/v1/tables/${TABLE_A1}/status`)
        .set(bearer('ownerA'))
        .send({ status: 'occupied' })
        .expect(200);
      await settle(everyone);

      expect(names(take(everyone.diner1))).toEqual(['availability.changed']);
      expect(names(take(everyone.diner2))).toEqual(['availability.changed']);
      expect(names(take(everyone.ownerA))).not.toContain(
        'availability.changed',
      );
      expect(names(take(everyone.ownerB))).toEqual([]);
    });
  });

  describe('crear', () => {
    it('el restaurante recibe reservation.created (sin código) y table.status_changed; los comensales, solo disponibilidad', async () => {
      const everyone = await connectEveryone();

      const created = await reserve();
      await settle(everyone);

      const owner = take(everyone.ownerA);
      expect(names(owner)).toEqual([
        'reservation.created',
        'table.status_changed',
      ]);
      const [, reservation] = owner[0];
      expect(reservation).toEqual({
        id: created.id,
        status: 'active',
        partySize: 2,
        dinerName: 'Ana',
        tableId: TABLE_A1,
        tableIdentifier: '01',
        createdAt: START.toISOString(),
        expiresAt: new Date(START.getTime() + 15 * 60_000).toISOString(),
        serverTime: START.toISOString(),
      });
      expect(JSON.stringify(reservation)).not.toContain(created.code);
      expect(reservation).not.toHaveProperty('code');
      expect(reservation).not.toHaveProperty('dinerId');
      expect(owner[1][1]).toEqual({
        tableId: TABLE_A1,
        previousStatus: 'available',
        status: 'reserved',
        source: 'reservation',
      });
      expect(names(take(everyone.diner1))).toEqual(['availability.changed']);
      expect(names(take(everyone.diner2))).toEqual(['availability.changed']);
      expect(names(take(everyone.ownerB))).toEqual([]);
    });

    it('si la transacción falla no sale ningún evento, a nadie', async () => {
      const everyone = await connectEveryone();
      statusLog.record.mockImplementationOnce(() =>
        Promise.reject(new Error('log roto')),
      );

      await http()
        .post('/v1/reservations')
        .set(bearer('diner1'))
        .send({ restaurantId: RESTAURANT_A, partySize: 2 })
        .expect(500);
      await settle(everyone);

      for (const socket of Object.values(everyone)) {
        expect(take(socket)).toEqual([]);
      }
    });

    it('si el socket falla, la operación HTTP responde igual', async () => {
      const everyone = await connectEveryone();
      vi.spyOn(app.get(AvailabilityGateway), 'emitToRooms').mockImplementation(
        () => {
          throw new Error('socket roto');
        },
      );

      await reserve();
      vi.mocked(app.get(AvailabilityGateway).emitToRooms).mockRestore();
      await settle(everyone);

      expect(db.Reservation.rows).toHaveLength(1);
    });
  });

  describe('cancelar', () => {
    it('restaurante y comensal reciben reservation.cancelled; el restaurante, table.status_changed', async () => {
      const { id } = await reserve();
      const everyone = await connectEveryone();

      await http()
        .post(`/v1/reservations/${id}/cancel`)
        .set(bearer('diner1'))
        .expect(200);
      await settle(everyone);

      const ended = {
        reservationId: id,
        status: 'cancelled',
        tableId: TABLE_A1,
        at: START.toISOString(),
      };
      expect(take(everyone.ownerA)).toEqual([
        ['reservation.cancelled', ended],
        [
          'table.status_changed',
          {
            tableId: TABLE_A1,
            previousStatus: 'reserved',
            status: 'available',
            source: 'reservation',
          },
        ],
      ]);
      expect(take(everyone.diner1)).toEqual([
        ['reservation.cancelled', ended],
        ['availability.changed', expect.anything()],
      ]);
      expect(names(take(everyone.diner2))).toEqual(['availability.changed']);
      expect(take(everyone.ownerB)).toEqual([]);
    });
  });

  describe('check-in', () => {
    it('restaurante y comensal reciben reservation.checked_in, y nadie availability.changed', async () => {
      const { id, code } = await reserve();
      const everyone = await connectEveryone();

      await http()
        .post('/v1/restaurants/me/check-ins')
        .set(bearer('ownerA'))
        .send({ code })
        .expect(200);
      await settle(everyone);

      const ended = {
        reservationId: id,
        status: 'completed',
        tableId: TABLE_A1,
        at: START.toISOString(),
      };
      expect(take(everyone.ownerA)).toEqual([
        ['reservation.checked_in', ended],
        [
          'table.status_changed',
          {
            tableId: TABLE_A1,
            previousStatus: 'reserved',
            status: 'occupied',
            source: 'reservation',
          },
        ],
      ]);
      expect(take(everyone.diner1)).toEqual([
        ['reservation.checked_in', ended],
      ]);
      expect(take(everyone.diner2)).toEqual([]);
      expect(take(everyone.ownerB)).toEqual([]);
    });
  });

  describe('vencer', () => {
    it('al leer: restaurante y comensal reciben reservation.expired, y table.status_changed con source system', async () => {
      const { id } = await reserve();
      const everyone = await connectEveryone();
      now = AFTER_TTL;

      await http()
        .get('/v1/reservations/active')
        .set(bearer('diner1'))
        .expect(200);
      await settle(everyone);

      const ended = {
        reservationId: id,
        status: 'expired',
        tableId: TABLE_A1,
        at: AFTER_TTL.toISOString(),
      };
      expect(take(everyone.ownerA)).toEqual([
        ['reservation.expired', ended],
        [
          'table.status_changed',
          {
            tableId: TABLE_A1,
            previousStatus: 'reserved',
            status: 'available',
            source: 'system',
          },
        ],
      ]);
      expect(take(everyone.diner1)).toEqual([
        ['reservation.expired', ended],
        ['availability.changed', expect.anything()],
      ]);
      expect(names(take(everyone.diner2))).toEqual(['availability.changed']);
      expect(take(everyone.ownerB)).toEqual([]);
    });

    it('el barrido: a cada restaurante solo lo suyo y a cada comensal solo lo suyo', async () => {
      const inA = await reserve('diner1', RESTAURANT_A);
      const inB = await reserve('diner2', RESTAURANT_B);
      const everyone = await connectEveryone();
      now = AFTER_TTL;

      await expect(
        app.get(ReservationExpirationService).expireAllDue(),
      ).resolves.toBe(2);
      await settle(everyone);

      const ownerA = take(everyone.ownerA);
      const ownerB = take(everyone.ownerB);
      expect(names(ownerA)).toEqual([
        'reservation.expired',
        'table.status_changed',
      ]);
      expect(ownerA[0][1]).toMatchObject({ reservationId: inA.id });
      expect(ownerA[1][1]).toMatchObject({ tableId: TABLE_A1 });
      expect(names(ownerB)).toEqual([
        'reservation.expired',
        'table.status_changed',
      ]);
      expect(ownerB[0][1]).toMatchObject({ reservationId: inB.id });
      expect(ownerB[1][1]).toMatchObject({ tableId: TABLE_B1 });

      const expiredOf = (events: Received) =>
        events
          .filter(([name]) => name === 'reservation.expired')
          .map(([, payload]) => payload.reservationId);
      expect(expiredOf(take(everyone.diner1))).toEqual([inA.id]);
      expect(expiredOf(take(everyone.diner2))).toEqual([inB.id]);
    });
  });

  describe('cambios manuales', () => {
    it("cambiar, desactivar y reactivar: table.status_changed con source manual, también con 'inactive'", async () => {
      const everyone = await connectEveryone();
      const owner = bearer('ownerA');

      await http()
        .patch(`/v1/tables/${TABLE_A1}/status`)
        .set(owner)
        .send({ status: 'occupied' })
        .expect(200);
      await http()
        .patch(`/v1/tables/${TABLE_A1}/status`)
        .set(owner)
        .send({ status: 'available' })
        .expect(200);
      await http()
        .post(`/v1/tables/${TABLE_A1}/deactivate`)
        .set(owner)
        .expect(200);
      await http()
        .post(`/v1/tables/${TABLE_A1}/reactivate`)
        .set(owner)
        .expect(200);
      await settle(everyone);

      const change = (previousStatus: string, status: string) => [
        'table.status_changed',
        { tableId: TABLE_A1, previousStatus, status, source: 'manual' },
      ];
      expect(take(everyone.ownerA)).toEqual([
        change('available', 'occupied'),
        change('occupied', 'available'),
        change('available', 'inactive'),
        change('inactive', 'available'),
      ]);
      expect(take(everyone.ownerB)).toEqual([]);
      expect(names(take(everyone.diner1))).not.toContain(
        'table.status_changed',
      );
    });

    it('pedir el estado que ya tiene no escribe en la bitácora ni emite', async () => {
      const everyone = await connectEveryone();

      await http()
        .patch(`/v1/tables/${TABLE_A1}/status`)
        .set(bearer('ownerA'))
        .send({ status: 'available' })
        .expect(200);
      await settle(everyone);

      expect(statusLog.record).not.toHaveBeenCalled();
      expect(take(everyone.ownerA)).toEqual([]);
    });
  });
});
