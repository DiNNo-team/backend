import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import type { TableLogStatus } from './../src/modules/restaurant-operations/tables/table-status-log.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_OWNER_ID = '7c6b5a49-3827-4615-a4b3-c2d1e0f9a8b7';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const INVALID_ROLE_USER_ID = '00000000-0000-4000-8000-000000000001';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';
const TABLE_01 = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const TABLE_02 = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const OTHER_TABLE = '8e7d6c5b-4a39-4281-b7c6-d5e4f3a2b1c0';
const UNKNOWN_TABLE = '00000000-0000-4000-8000-000000000000';

const TABLE_ID_INVALID = 'El id de la mesa no es un UUID válido.';

const users = [
  {
    id: OWNER_ID,
    email: 'admin@casa72.co',
    role: 'restaurant_admin',
    restaurantId: RESTAURANT_ID,
  },
  {
    id: OTHER_OWNER_ID,
    email: 'otro@example.com',
    role: 'restaurant_admin',
    restaurantId: OTHER_RESTAURANT_ID,
  },
  {
    id: NEWCOMER_ID,
    email: 'nuevo@example.com',
    role: 'restaurant_admin',
    restaurantId: null,
  },
  {
    id: INVALID_ROLE_USER_ID,
    email: 'rol@example.com',
    role: 'unknown-role',
    restaurantId: RESTAURANT_ID,
  },
];

// Same identifier "01" in both restaurants: only the join decides whose it is.
const tables = [
  { id: TABLE_01, restaurantId: RESTAURANT_ID, identifier: '01' },
  { id: TABLE_02, restaurantId: RESTAURANT_ID, identifier: '02' },
  { id: OTHER_TABLE, restaurantId: OTHER_RESTAURANT_ID, identifier: '01' },
];

interface StoredLog {
  id: string;
  tableId: string;
  previousStatus: TableLogStatus;
  newStatus: TableLogStatus;
  userId: string;
  changedAt: Date;
}

function log(
  n: number,
  tableId: string,
  userId: string,
  changedAt: string,
): StoredLog {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    tableId,
    previousStatus: 'available',
    newStatus: 'occupied',
    userId,
    changedAt: new Date(changedAt),
  };
}

// The query the service must build (pinned by table-logs.service.spec.ts).
const RESTAURANT_FILTER = 'loggedTable.restaurantId = :restaurantId';
const TABLE_FILTER = 'log.tableId = :tableId';

// Stand-in for the TableLog repository without PostgreSQL: its query builder
// records what the service asks for and applies it to rows of two
// restaurants, the way the SQL would. An unexpected filter fails the test.
function createLogsRepository(stored: () => StoredLog[]) {
  const requested: { restaurantIds: unknown[]; limits: unknown[] } = {
    restaurantIds: [],
    limits: [],
  };

  function createQueryBuilder() {
    const state: {
      restaurantId?: string;
      tableId?: string;
      ordered: boolean;
      limit?: number;
    } = { ordered: false };
    const builder = {
      innerJoin: () => builder,
      select: () => builder,
      addSelect: () => builder,
      where: (condition: string, params: { restaurantId: string }) => {
        if (condition !== RESTAURANT_FILTER) {
          throw new Error(`Unexpected filter: ${condition}`);
        }
        state.restaurantId = params.restaurantId;
        requested.restaurantIds.push(params.restaurantId);
        return builder;
      },
      andWhere: (condition: string, params: { tableId: string }) => {
        if (condition !== TABLE_FILTER) {
          throw new Error(`Unexpected filter: ${condition}`);
        }
        state.tableId = params.tableId;
        return builder;
      },
      orderBy: (sort: string, order: string) => {
        state.ordered = sort === 'log.changedAt' && order === 'DESC';
        return builder;
      },
      addOrderBy: () => builder,
      limit: (limit: number) => {
        state.limit = limit;
        requested.limits.push(limit);
        return builder;
      },
      getRawMany: () => {
        if (state.restaurantId === undefined) {
          throw new Error('Query without the restaurant filter');
        }
        const rows = stored()
          .filter((entry) => {
            const table = tables.find(({ id }) => id === entry.tableId);
            return (
              table?.restaurantId === state.restaurantId &&
              (state.tableId === undefined || entry.tableId === state.tableId)
            );
          })
          .sort((a, b) =>
            state.ordered
              ? b.changedAt.getTime() - a.changedAt.getTime() ||
                b.id.localeCompare(a.id)
              : 0,
          )
          .slice(0, state.limit)
          .map((entry) => ({
            id: entry.id,
            tableId: entry.tableId,
            tableIdentifier: tables.find(({ id }) => id === entry.tableId)
              ?.identifier,
            previousStatus: entry.previousStatus,
            newStatus: entry.newStatus,
            changedAt: entry.changedAt,
            userEmail: users.find(({ id }) => id === entry.userId)?.email,
          }));
        return Promise.resolve(rows);
      },
    };
    return builder;
  }

  return {
    repository: { createQueryBuilder: vi.fn(createQueryBuilder) },
    requested,
  };
}

// Prueba el contrato HTTP de GET /v1/table-logs sin PostgreSQL.
describe('Table logs (e2e)', () => {
  let app: INestApplication<App>;
  let stored: StoredLog[];
  let logs: ReturnType<typeof createLogsRepository>;

  async function createApp(devUserEnabled: boolean) {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DEV_USER_ENABLED: String(devUserEnabled),
              DEV_USER_ID: OWNER_ID,
              FIREBASE_PROJECT_ID: 'firebase-project-example',
            }),
          ],
        }),
        RestaurantOperationsModule,
      ],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue({
        findOneBy: ({ id }: { id: string }) =>
          Promise.resolve(users.find((user) => user.id === id) ?? null),
      })
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue({})
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({})
      .overrideProvider(getRepositoryToken(Table))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue(logs.repository)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }

  beforeEach(async () => {
    // Stored out of order on purpose.
    stored = [
      log(1, TABLE_01, OWNER_ID, '2026-10-08T15:00:00Z'),
      log(2, OTHER_TABLE, OTHER_OWNER_ID, '2026-10-08T18:00:00Z'),
      log(3, TABLE_02, OWNER_ID, '2026-10-08T17:00:00Z'),
      log(4, TABLE_01, OWNER_ID, '2026-10-08T16:00:00Z'),
    ];
    logs = createLogsRepository(() => stored);
    await createApp(true);
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (query = '') =>
    request(app.getHttpServer()).get(`/v1/table-logs${query}`);
  const ids = (body: { id: string }[]) => body.map((row) => row.id);

  it('returns 200 with the logs of the session restaurant, newest first', async () => {
    const res = await get().expect(200);

    expect(ids(res.body)).toEqual([stored[2].id, stored[3].id, stored[0].id]);
    expect(res.body[0]).toEqual({
      id: stored[2].id,
      tableId: TABLE_02,
      tableIdentifier: '02',
      previousStatus: 'available',
      newStatus: 'occupied',
      changedAt: '2026-10-08T17:00:00.000Z',
      userEmail: 'admin@casa72.co',
    });
  });

  it('returns [] when the restaurant has no logs', async () => {
    stored = [log(2, OTHER_TABLE, OTHER_OWNER_ID, '2026-10-08T18:00:00Z')];

    const res = await get().expect(200);

    expect(res.body).toEqual([]);
  });

  it('keeps 200 rows at most, the newest ones', async () => {
    stored = Array.from({ length: 205 }, (_, n) =>
      log(
        n + 1,
        TABLE_01,
        OWNER_ID,
        new Date(Date.UTC(2026, 9, 8, 0, n)).toISOString(),
      ),
    );

    const res = await get().expect(200);

    expect(res.body).toHaveLength(200);
    expect(res.body[0].id).toBe(stored[204].id);
    expect(res.body[199].id).toBe(stored[5].id);
    expect(logs.requested.limits).toEqual([200]);
  });

  it('filters by table with ?tableId', async () => {
    const res = await get(`?tableId=${TABLE_01}`).expect(200);

    expect(ids(res.body)).toEqual([stored[3].id, stored[0].id]);
    expect(
      res.body.every((row: { tableId: string }) => row.tableId === TABLE_01),
    ).toBe(true);
  });

  it('returns [] for a table that does not exist', async () => {
    const res = await get(`?tableId=${UNKNOWN_TABLE}`).expect(200);

    expect(res.body).toEqual([]);
  });

  describe('isolation between restaurants', () => {
    it('each owner only sees the logs of their own tables', async () => {
      const own = await get().expect(200);
      const other = await get()
        .set('x-dev-user-id', OTHER_OWNER_ID)
        .expect(200);

      expect(ids(own.body)).not.toContain(stored[1].id);
      expect(ids(other.body)).toEqual([stored[1].id]);
      expect(other.body[0]).toMatchObject({
        tableIdentifier: '01',
        userEmail: 'otro@example.com',
      });
      // The restaurant of the query is always the session one.
      expect(logs.requested.restaurantIds).toEqual([
        RESTAURANT_ID,
        OTHER_RESTAURANT_ID,
      ]);
    });

    it('a tableId of another restaurant returns [] (same as a table that does not exist)', async () => {
      const res = await get(`?tableId=${OTHER_TABLE}`).expect(200);

      expect(res.body).toEqual([]);
      expect(logs.requested.restaurantIds).toEqual([RESTAURANT_ID]);
    });

    it('rejects a restaurantId sent by the client and does not query', async () => {
      const res = await get(`?restaurantId=${OTHER_RESTAURANT_ID}`).expect(400);

      expect(res.body.message).toEqual([
        'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
      ]);
      expect(logs.repository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['not a uuid', '?tableId=abc'],
    ['empty', '?tableId='],
    ['repeated', `?tableId=${TABLE_01}&tableId=${TABLE_02}`],
  ])('returns 400 when tableId is %s', async (_case, query) => {
    const res = await get(query).expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: [TABLE_ID_INVALID],
    });
    expect(logs.repository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns 403 with errorCode RESTAURANT_REQUIRED for a user without a restaurant', async () => {
    const res = await get().set('x-dev-user-id', NEWCOMER_ID).expect(403);

    expect(res.body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Primero registra tu restaurante.',
      errorCode: 'RESTAURANT_REQUIRED',
    });
    expect(logs.repository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns 403 without errorCode for an invalid role', async () => {
    const res = await get()
      .set('x-dev-user-id', INVALID_ROLE_USER_ID)
      .expect(403);

    expect(res.body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'No tienes acceso a esta sección.',
    });
    expect(logs.repository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns 401 without a session (development user turned off)', async () => {
    await app.close();
    await createApp(false);

    await get().expect(401);
    expect(logs.repository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('documents the route in Swagger', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const route = res.body.paths['/v1/table-logs'];

    expect(Object.keys(route)).toEqual(['get']);
    expect(Object.keys(route.get.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
    ]);
    expect(route.get.security).toEqual([{ bearer: [] }]);
    expect(route.get.parameters).toEqual([
      expect.objectContaining({
        name: 'tableId',
        in: 'query',
        required: false,
      }),
    ]);
    expect(
      Object.keys(res.body.components.schemas.TableLogResponseDto.properties),
    ).toEqual([
      'id',
      'tableId',
      'tableIdentifier',
      'previousStatus',
      'newStatus',
      'changedAt',
      'userEmail',
    ]);
  });
});
