import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
import type { Table } from './table.entity.js';
import type { TableStatusLog } from './table-status-log.js';
import {
  PLAN_PROBLEM_MESSAGES,
  PLAN_TABLE_REPEATED_MESSAGE,
  TABLE_NOT_FOUND_MESSAGE,
  TablesService,
} from './tables.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0f9e8d7c6b5a';
const SMALL_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const BIG_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const PLACED_ID = '5b4a3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';
const FOREIGN_ID = '7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

function row(overrides: Partial<Table>): Table {
  return {
    id: SMALL_ID,
    restaurantId: RESTAURANT_ID,
    identifier: '01',
    capacity: 2,
    status: 'occupied',
    isActive: true,
    planX: null,
    planY: null,
    planShape: null,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
    ...overrides,
  };
}

// Three tables of the restaurant (one already on the plan) and one of another
// restaurant. Writes go to a copy that is committed only if the transaction
// resolves, like a real rollback.
function createStore() {
  let committed = [
    row({}),
    row({ id: BIG_ID, identifier: '02', capacity: 12, isActive: false }),
    row({
      id: PLACED_ID,
      identifier: '03',
      capacity: 4,
      planX: 10,
      planY: 4,
      planShape: 'square',
    }),
    row({ id: FOREIGN_ID, restaurantId: OTHER_RESTAURANT_ID, identifier: '9' }),
  ];
  const finds: unknown[] = [];
  const updates: { id: string; changes: Partial<Table> }[] = [];

  const repository = {
    manager: {
      transaction: async (
        work: (manager: EntityManager) => Promise<unknown>,
      ) => {
        const draft = committed.map((table) => ({ ...table }));
        const manager = {
          find: (
            _entity: unknown,
            options: { where: { restaurantId: string } },
          ) => {
            finds.push(options);
            return Promise.resolve(
              draft
                .filter(
                  (table) => table.restaurantId === options.where.restaurantId,
                )
                .map((table) => ({ ...table })),
            );
          },
          update: (
            _entity: unknown,
            where: { id: string; restaurantId: string },
            changes: Partial<Table>,
          ) => {
            updates.push({ id: where.id, changes });
            const target = draft.find(
              (table) =>
                table.id === where.id &&
                table.restaurantId === where.restaurantId,
            );
            if (target) Object.assign(target, changes);
            return Promise.resolve({ affected: target ? 1 : 0 });
          },
        } as unknown as EntityManager;
        const result = await work(manager);
        committed = draft;
        return result;
      },
    },
  };

  return {
    repository: repository as unknown as Repository<Table>,
    finds,
    updates,
    stored: (id: string) => committed.find((table) => table.id === id),
  };
}

describe('TablesService.savePlan', () => {
  let store: ReturnType<typeof createStore>;
  let statusLog: { record: ReturnType<typeof vi.fn> };
  let events: { emit: ReturnType<typeof vi.fn> };
  let service: TablesService;

  beforeEach(() => {
    store = createStore();
    statusLog = { record: vi.fn() };
    events = { emit: vi.fn() };
    service = new TablesService(
      store.repository,
      statusLog as unknown as TableStatusLog,
      events as unknown as EventEmitter2,
    );
  });

  it('places the tables, unplaces the missing ones and answers the whole list in order', async () => {
    const tables = await service.savePlan(RESTAURANT_ID, [
      { id: SMALL_ID, x: 0, y: 0 },
      { id: BIG_ID, x: 4, y: 0, shape: 'round' },
    ]);

    expect(
      tables.map((table) => [
        table.id,
        table.planX,
        table.planY,
        table.planShape,
      ]),
    ).toEqual([
      [SMALL_ID, 0, 0, null],
      [BIG_ID, 4, 0, 'round'],
      [PLACED_ID, null, null, null],
    ]);
    expect(store.stored(PLACED_ID)).toMatchObject({
      planX: null,
      planY: null,
      planShape: null,
    });
    expect(store.stored(BIG_ID)).toMatchObject({
      planX: 4,
      planY: 0,
      planShape: 'round',
    });
  });

  it('locks every table of the restaurant, in the order of the list', async () => {
    await service.savePlan(RESTAURANT_ID, []);

    expect(store.finds).toEqual([
      {
        where: { restaurantId: RESTAURANT_ID },
        order: { createdAt: 'ASC', id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      },
    ]);
  });

  it('writes only the plan columns, and only of the tables that moved', async () => {
    await service.savePlan(RESTAURANT_ID, [
      { id: PLACED_ID, x: 10, y: 4, shape: 'square' },
      { id: SMALL_ID, x: 0, y: 0 },
    ]);

    expect(store.updates).toEqual([
      { id: SMALL_ID, changes: { planX: 0, planY: 0, planShape: null } },
    ]);
    expect(store.stored(SMALL_ID)?.status).toBe('occupied');
  });

  it('keeps the status, logs nothing and emits no availability event', async () => {
    await service.savePlan(RESTAURANT_ID, [{ id: SMALL_ID, x: 0, y: 0 }]);

    expect(statusLog.record).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('accepts an empty list: the whole plan is cleared', async () => {
    const tables = await service.savePlan(RESTAURANT_ID, []);

    expect(tables.every((table) => table.planX === null)).toBe(true);
  });

  it('answers 400 for a table sent twice, before opening the transaction', async () => {
    const save = service.savePlan(RESTAURANT_ID, [
      { id: SMALL_ID, x: 0, y: 0 },
      { id: SMALL_ID, x: 5, y: 5 },
    ]);

    await expect(save).rejects.toThrow(BadRequestException);
    await expect(save).rejects.toMatchObject({
      response: { message: [PLAN_TABLE_REPEATED_MESSAGE] },
    });
    expect(store.finds).toHaveLength(0);
  });

  it.each([
    ['another restaurant', FOREIGN_ID],
    ['nobody', '00000000-0000-4000-8000-000000000000'],
  ])('answers 404 for a table of %s and writes nothing', async (_case, id) => {
    const save = service.savePlan(RESTAURANT_ID, [
      { id: SMALL_ID, x: 0, y: 0 },
      { id, x: 5, y: 5 },
    ]);

    await expect(save).rejects.toThrow(
      new NotFoundException(TABLE_NOT_FOUND_MESSAGE),
    );
    expect(store.stored(SMALL_ID)?.planX).toBeNull();
    expect(store.stored(FOREIGN_ID)?.planX).toBeNull();
  });

  it('answers 400 when two tables overlap and writes nothing', async () => {
    const save = service.savePlan(RESTAURANT_ID, [
      { id: SMALL_ID, x: 0, y: 0 },
      { id: PLACED_ID, x: 2, y: 1 },
    ]);

    await expect(save).rejects.toMatchObject({
      response: { message: [PLAN_PROBLEM_MESSAGES.overlap] },
    });
    expect(store.updates).toHaveLength(0);
  });

  it('sizes each table by its stored capacity: a table of 12 at column 16 leaves the grid', async () => {
    const save = service.savePlan(RESTAURANT_ID, [{ id: BIG_ID, x: 16, y: 0 }]);

    await expect(save).rejects.toMatchObject({
      response: { message: [PLAN_PROBLEM_MESSAGES['out-of-bounds']] },
    });
    expect(store.stored(BIG_ID)?.planX).toBeNull();
  });

  it('answers 403 RESTAURANT_REQUIRED for a user without a restaurant', async () => {
    await expect(service.savePlan(null, [])).rejects.toThrow(
      ForbiddenException,
    );
    expect(store.finds).toHaveLength(0);
  });
});
