import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
import type { CurrentUserData } from '../../identity-access/index.js';
import { Table, type TableStatus } from './table.entity.js';
import type { TableStatusChange, TableStatusLog } from './table-status-log.js';
import {
  RESTAURANT_REQUIRED_CODE,
  TABLE_INACTIVE_MESSAGE,
  TABLE_NOT_FOUND_MESSAGE,
  TablesService,
} from './tables.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';
const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const INACTIVE_TABLE_ID = '5b4a3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';
const FOREIGN_TABLE_ID = '7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const UNKNOWN_TABLE_ID = '00000000-0000-4000-8000-000000000000';

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
    status: 'available',
    isActive: true,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
    ...overrides,
  };
}

interface FindOneCall {
  where: { id: string; restaurantId: string };
  lock?: { mode: string };
}

// In-memory stand-in for a database transaction: writes go to a copy that is
// committed only if the callback resolves, like a real rollback on error.
function createStore() {
  let committed = new Map<string, Table>(
    [
      row({}),
      row({ id: INACTIVE_TABLE_ID, identifier: 'Mesa 9', isActive: false }),
      row({ id: FOREIGN_TABLE_ID, restaurantId: OTHER_RESTAURANT_ID }),
    ].map((table) => [table.id, table]),
  );
  const managers: EntityManager[] = [];

  const transaction = vi.fn(
    async <T>(work: (manager: EntityManager) => Promise<T>): Promise<T> => {
      const staged = new Map(
        [...committed].map(([id, table]) => [id, { ...table }]),
      );
      const manager = {
        findOne: vi.fn((_entity: unknown, { where }: FindOneCall) => {
          const found = staged.get(where.id);
          return Promise.resolve(
            found && found.restaurantId === where.restaurantId
              ? { ...found }
              : null,
          );
        }),
        save: vi.fn((table: Table) => {
          const saved = { ...table, updatedAt: new Date() };
          staged.set(table.id, saved);
          return Promise.resolve({ ...saved });
        }),
      };
      managers.push(manager as unknown as EntityManager);
      const result = await work(manager as unknown as EntityManager);
      committed = staged;
      return result;
    },
  );

  return {
    repository: { manager: { transaction } } as unknown as Repository<Table>,
    stored: (id: string) => committed.get(id),
    managers,
    transaction,
  };
}

function createService(record = vi.fn(() => Promise.resolve())) {
  const store = createStore();
  const statusLog = { record } as unknown as TableStatusLog;
  const service = new TablesService(store.repository, statusLog);
  return { service, store, record };
}

describe('TablesService.updateStatus', () => {
  it('changes the status and returns the updated table', async () => {
    const { service, store } = createService();

    const table = await service.updateStatus(owner, TABLE_ID, 'occupied');

    expect(table).toMatchObject({ id: TABLE_ID, status: 'occupied' });
    expect(store.stored(TABLE_ID)?.status).toBe('occupied');
  });

  it('records the five fields of the change, inside the same transaction', async () => {
    const { service, store, record } = createService();
    const before = Date.now();

    await service.updateStatus(owner, TABLE_ID, 'reserved');

    expect(record).toHaveBeenCalledTimes(1);
    const [change, manager] = record.mock.calls[0] as unknown as [
      TableStatusChange,
      EntityManager,
    ];
    expect(change).toEqual({
      tableId: TABLE_ID,
      previousStatus: 'available',
      newStatus: 'reserved',
      userId: USER_ID,
      changedAt: expect.any(Date),
    });
    expect(change.changedAt.getTime()).toBeGreaterThanOrEqual(before);
    // The log writes through the transaction manager, not on its own.
    expect(manager).toBe(store.managers[0]);
  });

  it('keeps the previous status when the log fails (rollback)', async () => {
    const failingLog = vi.fn(() => Promise.reject(new Error('log down')));
    const { service, store } = createService(failingLog);

    await expect(
      service.updateStatus(owner, TABLE_ID, 'occupied'),
    ).rejects.toThrow('log down');

    expect(failingLog).toHaveBeenCalledTimes(1);
    expect(store.stored(TABLE_ID)?.status).toBe('available');
  });

  it('accepts the same status: 200, nothing written and nothing logged', async () => {
    const { service, store, record } = createService();

    const table = await service.updateStatus(owner, TABLE_ID, 'available');

    expect(table.status).toBe('available');
    expect(store.managers[0].save).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('locks the row and scopes the lookup to the user restaurant', async () => {
    const { service, store } = createService();

    await service.updateStatus(owner, TABLE_ID, 'occupied');

    expect(store.managers[0].findOne).toHaveBeenCalledWith(Table, {
      where: { id: TABLE_ID, restaurantId: RESTAURANT_ID },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('rejects an inactive table with 409 and leaves it unchanged', async () => {
    const { service, store, record } = createService();

    const result = service.updateStatus(owner, INACTIVE_TABLE_ID, 'occupied');

    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(result).rejects.toThrow(TABLE_INACTIVE_MESSAGE);
    expect(store.stored(INACTIVE_TABLE_ID)?.status).toBe('available');
    expect(record).not.toHaveBeenCalled();
  });

  it.each<[string, string]>([
    ['does not exist', UNKNOWN_TABLE_ID],
    ['belongs to another restaurant', FOREIGN_TABLE_ID],
  ])(
    'answers 404 with the same message when the table %s',
    async (_case, id) => {
      const { service, store, record } = createService();

      const result = service.updateStatus(owner, id, 'occupied');

      await expect(result).rejects.toBeInstanceOf(NotFoundException);
      await expect(result).rejects.toThrow(TABLE_NOT_FOUND_MESSAGE);
      expect(store.stored(FOREIGN_TABLE_ID)?.status).toBe('available');
      expect(record).not.toHaveBeenCalled();
    },
  );

  it('rejects a user without a restaurant with 403 RESTAURANT_REQUIRED', async () => {
    const { service, store } = createService();

    const result = service.updateStatus(
      { ...owner, restaurantId: null },
      TABLE_ID,
      'occupied' satisfies TableStatus,
    );

    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.toMatchObject({
      response: { errorCode: RESTAURANT_REQUIRED_CODE },
    });
    expect(store.transaction).not.toHaveBeenCalled();
  });
});
