import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError, type EntityManager, type Repository } from 'typeorm';
import type { CurrentUserData } from '../../identity-access/index.js';
import type { Table } from './table.entity.js';
import type { TableStatusChange, TableStatusLog } from './table-status-log.js';
import {
  NO_TABLE_CHANGES_MESSAGE,
  TABLE_ALREADY_ACTIVE_MESSAGE,
  TABLE_ALREADY_INACTIVE_MESSAGE,
  TABLE_INACTIVE_MESSAGE,
  TABLE_NOT_FOUND_MESSAGE,
  TablesService,
} from './tables.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';
const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const OTHER_TABLE_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const INACTIVE_TABLE_ID = '5b4a3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';
const FOREIGN_TABLE_ID = '7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

const owner: CurrentUserData = {
  userId: USER_ID,
  restaurantId: RESTAURANT_ID,
  role: 'restaurant_admin',
};

function row(overrides: Partial<Table>): Table {
  return {
    id: TABLE_ID,
    restaurantId: RESTAURANT_ID,
    identifier: 'Mesa 4',
    capacity: 4,
    status: 'occupied',
    isActive: true,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
    ...overrides,
  };
}

interface Where {
  id?: string;
  restaurantId: string;
}

// In-memory tables of two restaurants. Transactions write to a copy that is
// committed only if the callback resolves, like a real rollback on error.
function createStore() {
  let committed = new Map<string, Table>(
    [
      row({}),
      row({ id: OTHER_TABLE_ID, identifier: 'T1', status: 'available' }),
      row({
        id: INACTIVE_TABLE_ID,
        identifier: '9',
        status: 'reserved',
        isActive: false,
      }),
      row({
        id: FOREIGN_TABLE_ID,
        restaurantId: OTHER_RESTAURANT_ID,
        identifier: '5',
      }),
    ].map((table) => [table.id, table]),
  );
  const managers: EntityManager[] = [];

  const matches = (table: Table, where: Where) =>
    table.restaurantId === where.restaurantId &&
    (where.id === undefined || table.id === where.id);

  const repository = {
    findOneBy: vi.fn((where: Where) => {
      const found = [...committed.values()].find((t) => matches(t, where));
      return Promise.resolve(found ? { ...found } : null);
    }),
    find: vi.fn(({ where }: { where: Where }) =>
      Promise.resolve(
        [...committed.values()]
          .filter((t) => matches(t, where))
          .map((t) => ({ ...t })),
      ),
    ),
    save: vi.fn((table: Table) => {
      committed.set(table.id, { ...table });
      return Promise.resolve({ ...table });
    }),
    manager: {
      transaction: vi.fn(
        async <T>(work: (manager: EntityManager) => Promise<T>): Promise<T> => {
          const staged = new Map(
            [...committed].map(([id, table]) => [id, { ...table }]),
          );
          const manager = {
            findOne: vi.fn(
              (_entity: unknown, options: { where: Where; lock?: unknown }) => {
                const found = [...staged.values()].find((t) =>
                  matches(t, options.where),
                );
                return Promise.resolve(found ? { ...found } : null);
              },
            ),
            save: vi.fn((table: Table) => {
              staged.set(table.id, { ...table });
              return Promise.resolve({ ...table });
            }),
          };
          managers.push(manager as unknown as EntityManager);
          const result = await work(manager as unknown as EntityManager);
          committed = staged;
          return result;
        },
      ),
    },
  };

  return {
    repository: repository as unknown as Repository<Table>,
    raw: repository,
    stored: (id: string) => committed.get(id),
    managers,
  };
}

function createService(record = vi.fn(() => Promise.resolve())) {
  const store = createStore();
  const statusLog = { record } as unknown as TableStatusLog;
  const service = new TablesService(store.repository, statusLog);
  return { service, store, record };
}

function loggedChange(record: ReturnType<typeof vi.fn>, call = 0) {
  return record.mock.calls[call] as unknown as [
    TableStatusChange,
    EntityManager,
  ];
}

describe('TablesService.update', () => {
  it('edits identifier and capacity, trimmed, without touching status or isActive', async () => {
    const { service, store, record } = createService();

    const table = await service.update(RESTAURANT_ID, TABLE_ID, {
      identifier: '  12 ',
      capacity: 6,
    });

    expect(table).toMatchObject({
      id: TABLE_ID,
      identifier: '12',
      capacity: 6,
      status: 'occupied',
      isActive: true,
    });
    expect(store.stored(TABLE_ID)).toMatchObject({
      identifier: '12',
      capacity: 6,
    });
    // Editing is not a status change: nothing goes to the log.
    expect(record).not.toHaveBeenCalled();
  });

  it('edits only the capacity without checking identifiers', async () => {
    const { service, store } = createService();

    await service.update(RESTAURANT_ID, TABLE_ID, { capacity: 2 });

    expect(store.stored(TABLE_ID)).toMatchObject({
      identifier: 'Mesa 4',
      capacity: 2,
    });
    expect(store.raw.find).not.toHaveBeenCalled();
  });

  it('can edit an inactive table, which stays inactive', async () => {
    const { service, store } = createService();

    await service.update(RESTAURANT_ID, INACTIVE_TABLE_ID, { capacity: 8 });

    expect(store.stored(INACTIVE_TABLE_ID)).toMatchObject({
      capacity: 8,
      isActive: false,
      status: 'reserved',
    });
  });

  it.each([
    ['"04" against "Mesa 4"', OTHER_TABLE_ID, '04', 'Mesa 04'],
    ['"4" against "Mesa 4"', OTHER_TABLE_ID, '4', 'Mesa 04'],
    ['" t1 " against "T1"', TABLE_ID, ' t1 ', 'Mesa t1'],
    ['"09" against the inactive "9"', TABLE_ID, '09', 'Mesa 09'],
  ])(
    'rejects a repeated identifier: %s → 409',
    async (_case, editedId, identifier, shownName) => {
      const { service, store } = createService();

      const result = service.update(RESTAURANT_ID, editedId, { identifier });

      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(
        `Ya tienes una ${shownName}. Usa otro identificador.`,
      );
      expect(store.raw.save).not.toHaveBeenCalled();
    },
  );

  it('ignores the table itself when checking repeats ("4" on "Mesa 4")', async () => {
    const { service, store } = createService();

    await service.update(RESTAURANT_ID, TABLE_ID, { identifier: '4' });

    expect(store.stored(TABLE_ID)?.identifier).toBe('4');
  });

  it('does not count tables of another restaurant as repeats', async () => {
    const { service, store } = createService();

    await service.update(RESTAURANT_ID, TABLE_ID, { identifier: '5' });

    expect(store.stored(TABLE_ID)?.identifier).toBe('5');
  });

  it('turns a unique violation at save into the same 409', async () => {
    const { service, store } = createService();
    store.raw.save.mockRejectedValueOnce(
      new QueryFailedError(
        'UPDATE "tables" ...',
        [],
        Object.assign(new Error('duplicate key value'), {
          code: '23505',
          constraint: 'UQ_tables_restaurant_id_identifier',
        }),
      ),
    );

    await expect(
      service.update(RESTAURANT_ID, TABLE_ID, { identifier: '20' }),
    ).rejects.toThrow('Ya tienes una Mesa 20. Usa otro identificador.');
  });

  it('rejects an empty body with a 400 list', async () => {
    const { service } = createService();

    const result = service.update(RESTAURANT_ID, TABLE_ID, {});

    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toMatchObject({
      response: { message: [NO_TABLE_CHANGES_MESSAGE] },
    });
  });

  it('answers 404 for a table of another restaurant, with the not-found message', async () => {
    const { service, store } = createService();

    const result = service.update(RESTAURANT_ID, FOREIGN_TABLE_ID, {
      capacity: 2,
    });

    await expect(result).rejects.toBeInstanceOf(NotFoundException);
    await expect(result).rejects.toThrow(TABLE_NOT_FOUND_MESSAGE);
    expect(store.stored(FOREIGN_TABLE_ID)?.capacity).toBe(4);
  });

  it('rejects a user without a restaurant', async () => {
    const { service } = createService();

    await expect(
      service.update(null, TABLE_ID, { capacity: 2 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TablesService.deactivate', () => {
  it('deactivates keeping the status and logs status → inactive in the same transaction', async () => {
    const { service, store, record } = createService();

    const table = await service.deactivate(owner, TABLE_ID);

    expect(table).toMatchObject({ isActive: false, status: 'occupied' });
    expect(store.stored(TABLE_ID)).toMatchObject({
      isActive: false,
      status: 'occupied',
    });
    const [change, manager] = loggedChange(record);
    expect(change).toEqual({
      tableId: TABLE_ID,
      previousStatus: 'occupied',
      newStatus: 'inactive',
      userId: USER_ID,
      changedAt: expect.any(Date),
    });
    expect(manager).toBe(store.managers[0]);
  });

  it('locks the row while deactivating', async () => {
    const { service, store } = createService();

    await service.deactivate(owner, TABLE_ID);

    const manager = store.managers[0] as unknown as {
      findOne: ReturnType<typeof vi.fn>;
    };
    expect(manager.findOne.mock.calls[0][1]).toMatchObject({
      where: { id: TABLE_ID, restaurantId: RESTAURANT_ID },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('answers 409 the second time and logs nothing', async () => {
    const { service, record } = createService();
    await service.deactivate(owner, TABLE_ID);
    record.mockClear();

    const result = service.deactivate(owner, TABLE_ID);

    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(result).rejects.toThrow(TABLE_ALREADY_INACTIVE_MESSAGE);
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps the table active when the log fails (rollback)', async () => {
    const failingLog = vi.fn(() => Promise.reject(new Error('log down')));
    const { service, store } = createService(failingLog);

    await expect(service.deactivate(owner, TABLE_ID)).rejects.toThrow(
      'log down',
    );
    expect(store.stored(TABLE_ID)?.isActive).toBe(true);
  });

  it('answers 404 for a table of another restaurant', async () => {
    const { service, store } = createService();

    await expect(service.deactivate(owner, FOREIGN_TABLE_ID)).rejects.toThrow(
      TABLE_NOT_FOUND_MESSAGE,
    );
    expect(store.stored(FOREIGN_TABLE_ID)?.isActive).toBe(true);
  });

  it('a deactivated table still rejects status changes', async () => {
    const { service } = createService();
    await service.deactivate(owner, TABLE_ID);

    const result = service.updateStatus(owner, TABLE_ID, 'available');

    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(result).rejects.toThrow(TABLE_INACTIVE_MESSAGE);
  });
});

describe('TablesService.reactivate', () => {
  it('reactivates as available and logs inactive → available', async () => {
    const { service, store, record } = createService();

    const table = await service.reactivate(owner, INACTIVE_TABLE_ID);

    expect(table).toMatchObject({ isActive: true, status: 'available' });
    expect(store.stored(INACTIVE_TABLE_ID)).toMatchObject({
      isActive: true,
      status: 'available',
    });
    const [change, manager] = loggedChange(record);
    expect(change).toEqual({
      tableId: INACTIVE_TABLE_ID,
      previousStatus: 'inactive',
      newStatus: 'available',
      userId: USER_ID,
      changedAt: expect.any(Date),
    });
    expect(manager).toBe(store.managers[0]);
  });

  it('answers 409 for an active table and logs nothing', async () => {
    const { service, record } = createService();

    const result = service.reactivate(owner, TABLE_ID);

    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(result).rejects.toThrow(TABLE_ALREADY_ACTIVE_MESSAGE);
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps the table inactive when the log fails (rollback)', async () => {
    const failingLog = vi.fn(() => Promise.reject(new Error('log down')));
    const { service, store } = createService(failingLog);

    await expect(service.reactivate(owner, INACTIVE_TABLE_ID)).rejects.toThrow(
      'log down',
    );
    expect(store.stored(INACTIVE_TABLE_ID)).toMatchObject({
      isActive: false,
      status: 'reserved',
    });
  });

  it('rejects a user without a restaurant', async () => {
    const { service } = createService();

    await expect(
      service.reactivate({ ...owner, restaurantId: null }, INACTIVE_TABLE_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
