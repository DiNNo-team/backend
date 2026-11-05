import type { QueryRunner } from 'typeorm';
import { CreateCheckIns1793840000002 } from './1793840000002-CreateCheckIns.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new CreateCheckIns1793840000002()[direction](queryRunner);
  return queries;
}

describe('CreateCheckIns migration', () => {
  it('allows one check-in per reservation, so it is never billed twice', async () => {
    expect((await queriesOf('up'))[0]).toContain(
      'CONSTRAINT "UQ_check_ins_reservation_id" UNIQUE ("reservation_id")',
    );
  });

  it('requires the reservation, the restaurant and the check-in date', async () => {
    const sql = (await queriesOf('up'))[0];

    expect(sql).toContain('"reservation_id" uuid NOT NULL');
    expect(sql).toContain('"restaurant_id" uuid NOT NULL');
    expect(sql).toContain('"checked_in_at" TIMESTAMP WITH TIME ZONE NOT NULL');
  });

  it.each([
    ['reservation_id', 'reservations'],
    ['restaurant_id', 'restaurants'],
  ])('%s references %s with NO ACTION', async (column, target) => {
    expect(await queriesOf('up')).toContainEqual(
      expect.stringContaining(
        `FOREIGN KEY ("${column}") REFERENCES "${target}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      ),
    );
  });

  it('down drops both foreign keys and then the table', async () => {
    const down = await queriesOf('down');

    expect(down).toHaveLength(3);
    expect(down.at(-1)).toBe('DROP TABLE "check_ins"');
  });
});
