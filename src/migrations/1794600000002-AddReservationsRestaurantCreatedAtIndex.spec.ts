import type { QueryRunner } from 'typeorm';
import { AddReservationsRestaurantCreatedAtIndex1794600000002 } from './1794600000002-AddReservationsRestaurantCreatedAtIndex.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new AddReservationsRestaurantCreatedAtIndex1794600000002()[direction](
    queryRunner,
  );
  return queries;
}

describe('AddReservationsRestaurantCreatedAtIndex migration', () => {
  it('creates the named index on (restaurant_id, created_at)', async () => {
    expect(await queriesOf('up')).toEqual([
      `CREATE INDEX "IDX_reservations_restaurant_id_created_at" ON "reservations" ("restaurant_id", "created_at") `,
    ]);
  });

  it('down drops it', async () => {
    expect(await queriesOf('down')).toEqual([
      `DROP INDEX "public"."IDX_reservations_restaurant_id_created_at"`,
    ]);
  });
});
