import type { QueryRunner } from 'typeorm';
import { AddRestaurantSubmittedAt1794600000000 } from './1794600000000-AddRestaurantSubmittedAt.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new AddRestaurantSubmittedAt1794600000000()[direction](queryRunner);
  return queries;
}

describe('AddRestaurantSubmittedAt migration', () => {
  it('adds the column, backfills it with created_at and only then makes it NOT NULL with now() as default', async () => {
    expect(await queriesOf('up')).toEqual([
      `ALTER TABLE "restaurants" ADD "submitted_at" TIMESTAMP WITH TIME ZONE`,
      `UPDATE "restaurants" SET "submitted_at" = "created_at"`,
      `ALTER TABLE "restaurants" ALTER COLUMN "submitted_at" SET NOT NULL`,
      `ALTER TABLE "restaurants" ALTER COLUMN "submitted_at" SET DEFAULT now()`,
    ]);
  });

  it('down drops the column', async () => {
    expect(await queriesOf('down')).toEqual([
      `ALTER TABLE "restaurants" DROP COLUMN "submitted_at"`,
    ]);
  });
});
