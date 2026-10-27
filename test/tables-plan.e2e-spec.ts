import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
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
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import { UserRole } from './../src/modules/identity-access/index.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0f9e8d7c6b5a';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const OTHER_TABLE_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const FOREIGN_TABLE_ID = '7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

const users = [
  {
    id: OWNER_ID,
    role: UserRole.RESTAURANT_ADMIN,
    restaurantId: RESTAURANT_ID,
  },
  { id: NEWCOMER_ID, role: UserRole.RESTAURANT_ADMIN, restaurantId: null },
];

function storedTable(overrides: Partial<Table>): Table {
  return {
    id: TABLE_ID,
    restaurantId: RESTAURANT_ID,
    identifier: '04',
    capacity: 4,
    status: 'reserved',
    isActive: true,
    planX: null,
    planY: null,
    planShape: null,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
    ...overrides,
  };
}

// HTTP contract of PUT /v1/tables/plan without PostgreSQL: a fake transaction
// over the tables of two restaurants.
describe('Tables · floor plan (e2e)', () => {
  let app: INestApplication<App>;
  let rows: Table[];
  let txManager: {
    find: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let statusLog: { record: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    rows = [
      storedTable({}),
      storedTable({
        id: OTHER_TABLE_ID,
        identifier: 'T1',
        capacity: 8,
        planX: 10,
        planY: 6,
      }),
      storedTable({
        id: FOREIGN_TABLE_ID,
        restaurantId: OTHER_RESTAURANT_ID,
        identifier: '9',
      }),
    ];
    txManager = {
      find: vi.fn(
        (_entity: unknown, { where }: { where: { restaurantId: string } }) =>
          Promise.resolve(
            rows
              .filter((row) => row.restaurantId === where.restaurantId)
              .map((row) => ({ ...row })),
          ),
      ),
      update: vi.fn(
        (_entity: unknown, where: { id: string }, changes: Partial<Table>) => {
          const row = rows.find((item) => item.id === where.id);
          if (row) Object.assign(row, changes);
          return Promise.resolve({ affected: row ? 1 : 0 });
        },
      ),
    };
    statusLog = { record: vi.fn(() => Promise.resolve()) };

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DEV_USER_ENABLED: 'true',
              DEV_USER_ID: OWNER_ID,
              FIREBASE_PROJECT_ID: 'firebase-project-example',
            }),
          ],
        }),
        EventEmitterModule.forRoot(),
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
      .useValue({
        manager: {
          transaction: vi.fn(
            (work: (manager: typeof txManager) => Promise<unknown>) =>
              work(txManager),
          ),
        },
      })
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(TableStatusLog)
      .useValue(statusLog)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const put = (body: unknown) =>
    request(app.getHttpServer())
      .put('/v1/tables/plan')
      .send(body as object);

  it('returns 200 with every table of the restaurant and its new place', async () => {
    const res = await put({
      tables: [{ id: TABLE_ID, x: 2, y: 3, shape: 'round' }],
    }).expect(200);

    expect(res.body).toEqual([
      {
        id: TABLE_ID,
        identifier: '04',
        capacity: 4,
        status: 'reserved',
        isActive: true,
        planX: 2,
        planY: 3,
        planShape: 'round',
      },
      {
        id: OTHER_TABLE_ID,
        identifier: 'T1',
        capacity: 8,
        status: 'reserved',
        isActive: true,
        planX: null,
        planY: null,
        planShape: null,
      },
    ]);
    expect(statusLog.record).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a column past the grid',
      { tables: [{ id: TABLE_ID, x: 20, y: 0 }] },
      'La columna de la mesa va de 0 a 19.',
    ],
    [
      'a row past the grid',
      { tables: [{ id: TABLE_ID, x: 0, y: 30 }] },
      'La fila de la mesa va de 0 a 29.',
    ],
    [
      'a decimal cell',
      { tables: [{ id: TABLE_ID, x: 1.5, y: 0 }] },
      'La columna de la mesa va de 0 a 19.',
    ],
    [
      'an unknown shape',
      { tables: [{ id: TABLE_ID, x: 0, y: 0, shape: 'oval' }] },
      'Elige la forma de la mesa: square (cuadrada), round (redonda) o rect (rectangular).',
    ],
    [
      'an id that is not a uuid',
      { tables: [{ id: '4', x: 0, y: 0 }] },
      'El id de la mesa no es un UUID válido.',
    ],
    [
      'no tables list',
      {},
      'Envía las mesas del plano en "tables", como una lista (vacía si no hay ninguna ubicada).',
    ],
    [
      'restaurantId in the body',
      { tables: [], restaurantId: OTHER_RESTAURANT_ID },
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
    ],
    [
      'status inside a table',
      { tables: [{ id: TABLE_ID, x: 0, y: 0, status: 'available' }] },
      'El campo "status" no se permite. Quítalo de la solicitud.',
    ],
    [
      'two tables on top of each other',
      {
        tables: [
          { id: TABLE_ID, x: 0, y: 0 },
          { id: OTHER_TABLE_ID, x: 1, y: 1 },
        ],
      },
      'Dos mesas quedaron una encima de otra. Sepáralas e intenta de nuevo.',
    ],
    [
      'a big table that leaves the grid',
      { tables: [{ id: OTHER_TABLE_ID, x: 17, y: 0 }] },
      'Una mesa se sale del plano. Muévela hacia adentro e intenta de nuevo.',
    ],
  ])('returns 400 for %s and writes nothing', async (_case, body, message) => {
    const res = await put(body).expect(400);

    expect(res.body.message).toContain(message);
    expect(txManager.update).not.toHaveBeenCalled();
  });

  it("returns 404 for another restaurant's table and leaves it untouched", async () => {
    const res = await put({
      tables: [{ id: FOREIGN_TABLE_ID, x: 0, y: 0 }],
    }).expect(404);

    expect(res.body.message).toBe(
      'No encontramos esta mesa. Actualiza la lista de mesas e intenta de nuevo.',
    );
    expect(rows.find((row) => row.id === FOREIGN_TABLE_ID)?.planX).toBeNull();
  });

  it('returns 403 with errorCode RESTAURANT_REQUIRED for a user without a restaurant', async () => {
    const res = await put({ tables: [] })
      .set('x-dev-user-id', NEWCOMER_ID)
      .expect(403);

    expect(res.body.errorCode).toBe('RESTAURANT_REQUIRED');
    expect(txManager.find).not.toHaveBeenCalled();
  });
});
