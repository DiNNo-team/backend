import type { QueryRunner } from 'typeorm';
import { CHECKIN_FEE_DEFAULT_COP } from '../modules/reservations-checkin/billing/checkin-fee.config.js';
import { AddCheckInFee1794600000001 } from './1794600000001-AddCheckInFee.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new AddCheckInFee1794600000001()[direction](queryRunner);
  return queries;
}

describe('AddCheckInFee migration', () => {
  it('backfills the existing check-ins with the default fee and then drops the default', async () => {
    const queries = await queriesOf('up');
    const add = queries.indexOf(
      `ALTER TABLE "check_ins" ADD "fee_cop" integer NOT NULL DEFAULT ${CHECKIN_FEE_DEFAULT_COP}`,
    );

    expect(add).toBe(0);
    expect(queries[add + 1]).toBe(
      `ALTER TABLE "check_ins" ALTER COLUMN "fee_cop" DROP DEFAULT`,
    );
  });

  it('never accepts a negative fee, with a named check', () => {
    return expect(queriesOf('up')).resolves.toContain(
      `ALTER TABLE "check_ins" ADD CONSTRAINT "CHK_check_ins_fee_cop" CHECK ("fee_cop" >= 0)`,
    );
  });

  it('indexes the check-ins of a restaurant by time', () => {
    return expect(queriesOf('up')).resolves.toContain(
      `CREATE INDEX "IDX_check_ins_restaurant_id_checked_in_at" ON "check_ins" ("restaurant_id", "checked_in_at") `,
    );
  });

  it('down drops everything up adds, in reverse order', async () => {
    expect(await queriesOf('down')).toEqual([
      `DROP INDEX "public"."IDX_check_ins_restaurant_id_checked_in_at"`,
      `ALTER TABLE "check_ins" DROP CONSTRAINT "CHK_check_ins_fee_cop"`,
      `ALTER TABLE "check_ins" DROP COLUMN "fee_cop"`,
    ]);
  });
});
