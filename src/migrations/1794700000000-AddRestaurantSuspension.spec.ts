import type { QueryRunner } from 'typeorm';
import { RESTAURANT_APPROVAL_STATUSES } from '../modules/identity-access/index.js';
import { SUSPENSION_REASON_MAX_LENGTH } from '../modules/restaurant-operations/restaurants/restaurant.entity.js';
import { AddRestaurantSuspension1794700000000 } from './1794700000000-AddRestaurantSuspension.js';

async function queriesOf(
  direction: 'up' | 'down',
  suspendedCount = 0,
): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve(
        sql.startsWith('SELECT') ? [{ count: suspendedCount }] : undefined,
      );
    },
  } as unknown as QueryRunner;
  await new AddRestaurantSuspension1794700000000()[direction](queryRunner);
  return queries;
}

function approvalValues(queries: string[]): string[] | undefined {
  const check = queries.find((sql) =>
    sql.includes('ADD CONSTRAINT "CHK_restaurants_approval_status"'),
  );
  return /CHECK \("approval_status" IN \(([^)]*)\)\)/
    .exec(check ?? '')?.[1]
    .split(',')
    .map((value) => value.trim().replace(/'/g, ''));
}

describe('AddRestaurantSuspension migration', () => {
  it('checks approval_status against exactly RESTAURANT_APPROVAL_STATUSES', async () => {
    expect(approvalValues(await queriesOf('up'))).toEqual([
      ...RESTAURANT_APPROVAL_STATUSES,
    ]);
  });

  it('adds the last suspension, sized like the entity, with a named FK to users', async () => {
    const queries = await queriesOf('up');

    expect(queries).toContain(
      `ALTER TABLE "restaurants" ADD "suspension_reason" character varying(${SUSPENSION_REASON_MAX_LENGTH})`,
    );
    expect(queries).toContain(
      `ALTER TABLE "restaurants" ADD "suspended_at" TIMESTAMP WITH TIME ZONE`,
    );
    expect(queries).toContain(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "FK_restaurants_suspended_by" FOREIGN KEY ("suspended_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    expect(queries.join('\n')).toContain('"CHK_restaurants_suspension"');
  });

  it('down goes back to the three original states and drops what up added', async () => {
    const queries = await queriesOf('down');

    expect(approvalValues(queries)).toEqual([
      'pending',
      'approved',
      'rejected',
    ]);
    for (const dropped of [
      'DROP CONSTRAINT "FK_restaurants_suspended_by"',
      'DROP CONSTRAINT "CHK_restaurants_suspension"',
      'DROP COLUMN "suspended_by"',
      'DROP COLUMN "suspended_at"',
      'DROP COLUMN "suspension_reason"',
    ]) {
      expect(queries.join('\n')).toContain(dropped);
    }
  });

  it('down stops before touching anything if a restaurant is still suspended', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: (sql: string) => {
        queries.push(sql);
        return Promise.resolve([{ count: 2 }]);
      },
    } as unknown as QueryRunner;

    await expect(
      new AddRestaurantSuspension1794700000000().down(queryRunner),
    ).rejects.toThrow('hay 2 restaurante(s) suspendido(s)');
    expect(queries).toHaveLength(1);
  });
});
