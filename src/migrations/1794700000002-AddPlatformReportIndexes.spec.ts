import type { QueryRunner } from 'typeorm';
import { AddPlatformReportIndexes1794700000002 } from './1794700000002-AddPlatformReportIndexes.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new AddPlatformReportIndexes1794700000002()[direction](queryRunner);
  return queries;
}

describe('AddPlatformReportIndexes migration', () => {
  it('indexes the dates alone, without restaurant_id first', async () => {
    expect(await queriesOf('up')).toEqual([
      'CREATE INDEX "IDX_check_ins_checked_in_at" ON "check_ins" ("checked_in_at")',
      'CREATE INDEX "IDX_reservations_created_at" ON "reservations" ("created_at")',
    ]);
  });

  it('down drops only those two indexes', async () => {
    expect(await queriesOf('down')).toEqual([
      'DROP INDEX "public"."IDX_reservations_created_at"',
      'DROP INDEX "public"."IDX_check_ins_checked_in_at"',
    ]);
  });
});
