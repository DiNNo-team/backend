import type { QueryRunner } from 'typeorm';
import { TABLE_LOG_SOURCES } from '../modules/restaurant-operations/tables/table-status-log.js';
import { AddTableLogSource1793840000003 } from './1793840000003-AddTableLogSource.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new AddTableLogSource1793840000003()[direction](queryRunner);
  return queries;
}

describe('AddTableLogSource migration', () => {
  it('adds source as NOT NULL with default manual, so existing rows stay manual', async () => {
    expect(await queriesOf('up')).toContain(
      `ALTER TABLE "table_logs" ADD "source" character varying(20) NOT NULL DEFAULT 'manual'`,
    );
  });

  it('checks source against exactly TABLE_LOG_SOURCES', async () => {
    const sql =
      (await queriesOf('up')).find((query) =>
        query.includes('"CHK_table_logs_source"'),
      ) ?? '';
    const match = /IN \(([^)]*)\)/.exec(sql);

    expect(match).not.toBeNull();
    expect(
      match![1].split(',').map((value) => value.trim().replace(/'/g, '')),
    ).toEqual([...TABLE_LOG_SOURCES]);
  });

  it('makes user_id nullable and only allows null when source is system', async () => {
    const queries = await queriesOf('up');

    expect(queries).toContain(
      `ALTER TABLE "table_logs" ALTER COLUMN "user_id" DROP NOT NULL`,
    );
    expect(queries).toContain(
      `ALTER TABLE "table_logs" ADD CONSTRAINT "CHK_table_logs_user_required_unless_system" CHECK ("user_id" IS NOT NULL OR "source" = 'system')`,
    );
  });

  it('does not touch the foreign key to users nor the status checks', async () => {
    for (const sql of await queriesOf('up')) {
      expect(sql).not.toContain('FOREIGN KEY');
      expect(sql).not.toContain('_status');
    }
  });

  it('down drops the user rule first, deletes rows without user, and restores NOT NULL before dropping source', async () => {
    const down = await queriesOf('down');
    const at = (text: string) => down.findIndex((sql) => sql.includes(text));

    expect(
      at('DROP CONSTRAINT "CHK_table_logs_user_required_unless_system"'),
    ).toBe(0);
    expect(at('DELETE FROM "table_logs" WHERE "user_id" IS NULL')).toBeLessThan(
      at('"user_id" SET NOT NULL'),
    );
    expect(at('DROP COLUMN "source"')).toBe(down.length - 1);
  });
});
