import { QueryFailedError, type EntityManager } from 'typeorm';
import type { TableStatusChange } from '../tables/table-status-log.js';
import { TableLog } from './table-log.entity.js';
import { DbTableStatusLog } from './table-logs.recorder.js';

const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const CHANGED_AT = new Date('2026-10-07T00:30:00Z');

function change(overrides: Partial<TableStatusChange> = {}): TableStatusChange {
  return {
    tableId: TABLE_ID,
    previousStatus: 'available',
    newStatus: 'occupied',
    userId: USER_ID,
    changedAt: CHANGED_AT,
    ...overrides,
  };
}

type Insert = (row: Partial<TableLog>) => Promise<unknown>;

// The transaction manager the tables service passes in.
function transactionManager(insert = vi.fn<Insert>(() => Promise.resolve({}))) {
  const getRepository = vi.fn(() => ({ insert }));
  const manager = { getRepository } as unknown as EntityManager;
  return { manager, getRepository, insert };
}

describe('DbTableStatusLog.record', () => {
  it('inserts one row with the five fields through the received manager', async () => {
    const { manager, getRepository, insert } = transactionManager();

    await new DbTableStatusLog().record(change(), manager);

    expect(getRepository).toHaveBeenCalledWith(TableLog);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      tableId: TABLE_ID,
      previousStatus: 'available',
      newStatus: 'occupied',
      userId: USER_ID,
      changedAt: CHANGED_AT,
    });
  });

  it.each([
    ['deactivate', 'reserved', 'inactive'],
    ['reactivate', 'inactive', 'available'],
  ] as const)(
    'stores inactive as a status (%s: %s → %s)',
    async (_action, previousStatus, newStatus) => {
      const { manager, insert } = transactionManager();

      await new DbTableStatusLog().record(
        change({ previousStatus, newStatus }),
        manager,
      );

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ previousStatus, newStatus }),
      );
    },
  );

  it('never writes fields that are not in the change', async () => {
    const { manager, insert } = transactionManager();
    const withExtra = { ...change(), restaurantId: 'x' } as TableStatusChange;

    await new DbTableStatusLog().record(withExtra, manager);

    expect(Object.keys(insert.mock.calls[0][0]).sort()).toEqual([
      'changedAt',
      'newStatus',
      'previousStatus',
      'tableId',
      'userId',
    ]);
  });

  it('lets an insert error propagate, so the table change is rolled back', async () => {
    const failure = new QueryFailedError('INSERT', [], new Error('check'));
    const { manager } = transactionManager(
      vi.fn<Insert>(() => Promise.reject(failure)),
    );

    await expect(new DbTableStatusLog().record(change(), manager)).rejects.toBe(
      failure,
    );
  });
});
