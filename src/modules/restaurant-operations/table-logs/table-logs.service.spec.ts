import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { RESTAURANT_REQUIRED_CODE } from '../shared/restaurant-required.js';
import { Table } from '../tables/table.entity.js';
import type { TableLog } from './table-log.entity.js';
import {
  TABLE_LOGS_LIMIT,
  TableLogsService,
  type TableLogRow,
} from './table-logs.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';

const BUILDER_METHODS = [
  'innerJoin',
  'select',
  'addSelect',
  'where',
  'andWhere',
  'orderBy',
  'addOrderBy',
  'limit',
] as const;

// Chainable stand-in for SelectQueryBuilder that records every call, so the
// tests pin the query (join, restaurant filter, order and limit).
function createService(rows: TableLogRow[] = []) {
  const calls: [string, unknown[]][] = [];
  const builder: Record<string, unknown> = {
    getRawMany: vi.fn(() => Promise.resolve(rows)),
  };
  for (const method of BUILDER_METHODS) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    });
  }
  const logs = { createQueryBuilder: vi.fn(() => builder) };
  const service = new TableLogsService(logs as unknown as Repository<TableLog>);
  const callsOf = (method: string) =>
    calls.filter(([name]) => name === method).map(([, args]) => args);
  return { service, logs, callsOf };
}

describe('TableLogsService', () => {
  it('rejects a user without a restaurant with 403 RESTAURANT_REQUIRED and does not query', async () => {
    const { service, logs } = createService();

    const result = service.findForRestaurant(null);

    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.toMatchObject({
      response: { errorCode: RESTAURANT_REQUIRED_CODE },
    });
    expect(logs.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('filters by the session restaurant through the join to tables', async () => {
    const { service, logs, callsOf } = createService();

    await service.findForRestaurant(RESTAURANT_ID);

    expect(logs.createQueryBuilder).toHaveBeenCalledWith('log');
    expect(callsOf('innerJoin')).toEqual([
      [Table, 'loggedTable', 'loggedTable.id = log.tableId'],
      ['User', 'author', 'author.id = log.userId'],
    ]);
    expect(callsOf('where')).toEqual([
      [
        'loggedTable.restaurantId = :restaurantId',
        { restaurantId: RESTAURANT_ID },
      ],
    ]);
  });

  it('selects only the columns of the response', async () => {
    const { service, callsOf } = createService();

    await service.findForRestaurant(RESTAURANT_ID);

    expect([...callsOf('select'), ...callsOf('addSelect')]).toEqual([
      ['log.id', 'id'],
      ['log.tableId', 'tableId'],
      ['loggedTable.identifier', 'tableIdentifier'],
      ['log.previousStatus', 'previousStatus'],
      ['log.newStatus', 'newStatus'],
      ['log.changedAt', 'changedAt'],
      ['author.email', 'userEmail'],
    ]);
  });

  it('orders newest first, with the id as tie-breaker, and keeps 200 rows at most', async () => {
    const { service, callsOf } = createService();

    await service.findForRestaurant(RESTAURANT_ID);

    expect(callsOf('orderBy')).toEqual([['log.changedAt', 'DESC']]);
    expect(callsOf('addOrderBy')).toEqual([['log.id', 'DESC']]);
    expect(TABLE_LOGS_LIMIT).toBe(200);
    expect(callsOf('limit')).toEqual([[200]]);
  });

  it('without tableId does not add a table filter', async () => {
    const { service, callsOf } = createService();

    await service.findForRestaurant(RESTAURANT_ID);

    expect(callsOf('andWhere')).toEqual([]);
  });

  it('with tableId also filters by that table, keeping the restaurant filter', async () => {
    const { service, callsOf } = createService();

    await service.findForRestaurant(RESTAURANT_ID, TABLE_ID);

    expect(callsOf('where')).toEqual([
      [
        'loggedTable.restaurantId = :restaurantId',
        { restaurantId: RESTAURANT_ID },
      ],
    ]);
    expect(callsOf('andWhere')).toEqual([
      ['log.tableId = :tableId', { tableId: TABLE_ID }],
    ]);
  });

  it('returns the rows of the query as they come', async () => {
    const row: TableLogRow = {
      id: '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
      tableId: TABLE_ID,
      tableIdentifier: '04',
      previousStatus: 'available',
      newStatus: 'occupied',
      changedAt: new Date('2026-10-08T19:30:00Z'),
      userEmail: 'admin@casa72.co',
    };
    const { service } = createService([row]);

    await expect(service.findForRestaurant(RESTAURANT_ID)).resolves.toEqual([
      row,
    ]);
  });
});
