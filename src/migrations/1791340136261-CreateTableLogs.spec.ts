import type { QueryRunner } from 'typeorm';
import { TABLE_LOG_STATUSES } from '../modules/restaurant-operations/tables/table-status-log.js';
import { CreateTableLogs1791340136261 } from './1791340136261-CreateTableLogs.js';

// Values inside a CHECK ... IN (...) of the given column.
function checkedValues(sql: string, column: string): string[] {
  const match = new RegExp(`CHECK \\("${column}" IN \\(([^)]*)\\)\\)`).exec(
    sql,
  );
  if (!match) {
    throw new Error(`No CHECK found for ${column}`);
  }
  return match[1].split(',').map((value) => value.trim().replace(/'/g, ''));
}

async function upQueries(): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new CreateTableLogs1791340136261().up(queryRunner);
  return queries;
}

describe('CreateTableLogs migration', () => {
  it.each(['previous_status', 'new_status'])(
    'checks %s against exactly TABLE_LOG_STATUSES, inactive included',
    async (column) => {
      const createTable = (await upQueries())[0];

      expect(checkedValues(createTable, column)).toEqual([
        ...TABLE_LOG_STATUSES,
      ]);
      expect(checkedValues(createTable, column)).toContain('inactive');
    },
  );

  it('creates the index for the per-table, most-recent-first lookup', async () => {
    const queries = await upQueries();

    expect(queries).toContainEqual(
      expect.stringContaining(
        'CREATE INDEX "IDX_table_logs_table_id_changed_at" ON "table_logs" ("table_id", "changed_at")',
      ),
    );
  });
});
