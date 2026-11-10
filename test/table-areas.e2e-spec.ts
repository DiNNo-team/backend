import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { UserRole } from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { TableArea } from './../src/modules/restaurant-operations/table-areas/table-area.entity.js';
import {
  AREA_ID_INVALID,
  AREA_NAME_REQUIRED,
  AREA_NAME_TOO_LONG,
  AREA_NOT_FOUND_MESSAGE,
  areaNameTakenMessage,
} from './../src/modules/restaurant-operations/table-areas/table-area-rules.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0f9e8d7c6b5a';
const TERRACE_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const FOREIGN_AREA_ID = '5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9';

const users = [
  {
    id: OWNER_ID,
    role: UserRole.RESTAURANT_ADMIN,
    restaurantId: RESTAURANT_ID,
  },
  { id: NEWCOMER_ID, role: UserRole.RESTAURANT_ADMIN, restaurantId: null },
];

function area(overrides: Partial<TableArea>): TableArea {
  return {
    id: TERRACE_ID,
    restaurantId: RESTAURANT_ID,
    name: 'Terraza',
    createdAt: new Date('2026-11-10T12:00:00Z'),
    updatedAt: new Date('2026-11-10T12:00:00Z'),
    ...overrides,
  };
}

// HTTP contract of /v1/table-areas without PostgreSQL: an in-memory store of
// the zones of two restaurants.
describe('Table areas (e2e)', () => {
  let app: INestApplication<App>;
  let areas: TableArea[];
  let tableUpdates: { where: unknown; changes: unknown }[];
  let currentUserId: string;

  beforeEach(async () => {
    currentUserId = OWNER_ID;
    areas = [
      area({}),
      area({
        id: FOREIGN_AREA_ID,
        restaurantId: OTHER_RESTAURANT_ID,
        name: 'Bar',
      }),
    ];
    tableUpdates = [];
    const ofRestaurant = (where: { restaurantId: string; id?: string }) =>
      areas.filter(
        (row) =>
          row.restaurantId === where.restaurantId &&
          (where.id === undefined || row.id === where.id),
      );
    const manager = {
      findOne: (
        _entity: unknown,
        { where }: { where: { restaurantId: string; id: string } },
      ) => Promise.resolve(ofRestaurant(where)[0] ?? null),
      update: (_entity: unknown, where: unknown, changes: unknown) => {
        tableUpdates.push({ where, changes });
        return Promise.resolve({ affected: 1 });
      },
      delete: (_entity: unknown, where: { id: string }) => {
        areas = areas.filter((row) => row.id !== where.id);
        return Promise.resolve({ affected: 1 });
      },
    };
    const repository = {
      find: ({ where }: { where: { restaurantId: string } }) =>
        Promise.resolve(ofRestaurant(where).map((row) => ({ ...row }))),
      create: (values: Partial<TableArea>) => values,
      save: (values: Partial<TableArea>) => {
        const saved = area({
          ...values,
          id: '8c7b6a5f-4e3d-4c2b-a1a0-9f8e7d6c5b4a',
        });
        areas.push(saved);
        return Promise.resolve(saved);
      },
      update: (where: { id: string }, changes: Partial<TableArea>) => {
        const row = areas.find((item) => item.id === where.id);
        if (row) Object.assign(row, changes);
        return Promise.resolve({ affected: row ? 1 : 0 });
      },
      manager: {
        transaction: (work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
      },
    };

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
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableArea))
      .useValue(repository)
      .overrideProvider(TableStatusLog)
      .useValue({ record: vi.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const as = (req: request.Test) => req.set('x-dev-user-id', currentUserId);

  it('lists only the zones of the restaurant of the session', async () => {
    const res = await as(http().get('/v1/table-areas')).expect(200);

    expect(res.body).toEqual([{ id: TERRACE_ID, name: 'Terraza' }]);
  });

  it('creates a zone with the name trimmed', async () => {
    const res = await as(http().post('/v1/table-areas'))
      .send({ name: '  Piso 2  ' })
      .expect(201);

    expect(res.body).toEqual({ id: expect.any(String), name: 'Piso 2' });
  });

  it('rejects a repeated name, ignoring case and spaces', async () => {
    const res = await as(http().post('/v1/table-areas'))
      .send({ name: ' TERRAZA ' })
      .expect(409);

    expect(res.body.message).toBe(areaNameTakenMessage('TERRAZA'));
  });

  it('allows a name another restaurant already uses', async () => {
    await as(http().post('/v1/table-areas')).send({ name: 'Bar' }).expect(201);
  });

  it('validates the name and rejects extra fields', async () => {
    const empty = await as(http().post('/v1/table-areas'))
      .send({ name: '   ' })
      .expect(400);
    expect(empty.body.message).toEqual([AREA_NAME_REQUIRED]);

    const long = await as(http().post('/v1/table-areas'))
      .send({ name: 'x'.repeat(31) })
      .expect(400);
    expect(long.body.message).toEqual([AREA_NAME_TOO_LONG]);

    await as(http().post('/v1/table-areas'))
      .send({ name: 'Bar', restaurantId: OTHER_RESTAURANT_ID })
      .expect(400);
  });

  it('renames a zone, and keeping its own name is not a conflict', async () => {
    const res = await as(http().patch(`/v1/table-areas/${TERRACE_ID}`))
      .send({ name: 'terraza' })
      .expect(200);

    expect(res.body).toEqual({ id: TERRACE_ID, name: 'terraza' });
  });

  it('answers the same 404 for a zone of another restaurant', async () => {
    const rename = await as(http().patch(`/v1/table-areas/${FOREIGN_AREA_ID}`))
      .send({ name: 'Mío' })
      .expect(404);
    expect(rename.body.message).toBe(AREA_NOT_FOUND_MESSAGE);

    await as(http().delete(`/v1/table-areas/${FOREIGN_AREA_ID}`)).expect(404);
    expect(areas.map((row) => row.id)).toContain(FOREIGN_AREA_ID);
  });

  it('rejects an id that is not a uuid', async () => {
    const res = await as(http().delete('/v1/table-areas/terraza')).expect(400);

    expect(res.body.message).toEqual([AREA_ID_INVALID]);
  });

  it('deletes a zone and takes its tables out of the zone and off the plan', async () => {
    await as(http().delete(`/v1/table-areas/${TERRACE_ID}`)).expect(204);

    expect(areas.map((row) => row.id)).toEqual([FOREIGN_AREA_ID]);
    expect(tableUpdates).toEqual([
      {
        where: { restaurantId: RESTAURANT_ID, areaId: TERRACE_ID },
        changes: { areaId: null, planX: null, planY: null, planShape: null },
      },
    ]);
  });

  it('answers 403 RESTAURANT_REQUIRED to an admin without a restaurant', async () => {
    currentUserId = NEWCOMER_ID;

    const res = await as(http().get('/v1/table-areas')).expect(403);

    expect(res.body.errorCode).toBe('RESTAURANT_REQUIRED');
  });

  it('documents the four routes in Swagger', async () => {
    const res = await http().get('/docs-json').expect(200);

    expect(Object.keys(res.body.paths['/v1/table-areas'])).toEqual([
      'get',
      'post',
    ]);
    expect(Object.keys(res.body.paths['/v1/table-areas/{id}'])).toEqual([
      'patch',
      'delete',
    ]);
  });
});
