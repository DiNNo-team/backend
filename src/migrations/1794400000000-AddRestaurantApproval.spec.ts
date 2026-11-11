import type { QueryRunner } from 'typeorm';
import { RESTAURANT_APPROVAL_STATUSES } from '../modules/identity-access/index.js';
import {
  CONTACT_PHONE_MAX_LENGTH,
  REJECTION_REASON_MAX_LENGTH,
} from '../modules/restaurant-operations/restaurants/restaurant.entity.js';
import { AddRestaurantApproval1794400000000 } from './1794400000000-AddRestaurantApproval.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new AddRestaurantApproval1794400000000()[direction](queryRunner);
  return queries;
}

describe('AddRestaurantApproval migration', () => {
  it('checks approval_status against exactly RESTAURANT_APPROVAL_STATUSES', async () => {
    const check = (await queriesOf('up')).find((sql) =>
      sql.includes('"CHK_restaurants_approval_status"'),
    );
    const values = /CHECK \("approval_status" IN \(([^)]*)\)\)/
      .exec(check ?? '')?.[1]
      .split(',')
      .map((value) => value.trim().replace(/'/g, ''));

    expect(values).toEqual([...RESTAURANT_APPROVAL_STATUSES]);
  });

  it('approves every existing restaurant and then drops the default', async () => {
    const queries = await queriesOf('up');
    const add = queries.indexOf(
      `ALTER TABLE "restaurants" ADD "approval_status" character varying(20) NOT NULL DEFAULT 'approved'`,
    );
    const dropDefault = queries.indexOf(
      `ALTER TABLE "restaurants" ALTER COLUMN "approval_status" DROP DEFAULT`,
    );

    expect(add).toBeGreaterThanOrEqual(0);
    // Without a default, a new restaurant can never be born approved by accident.
    expect(dropDefault).toBe(add + 1);
  });

  it('sizes the text columns like the entity and leaves them nullable', async () => {
    const queries = await queriesOf('up');

    expect(queries).toContain(
      `ALTER TABLE "restaurants" ADD "rejection_reason" character varying(${REJECTION_REASON_MAX_LENGTH})`,
    );
    expect(queries).toContain(
      `ALTER TABLE "restaurants" ADD "contact_phone" character varying(${CONTACT_PHONE_MAX_LENGTH})`,
    );
    expect(queries).toContain(
      `ALTER TABLE "restaurants" ADD "reviewed_at" TIMESTAMP WITH TIME ZONE`,
    );
  });

  it('links reviewed_by to users with a named foreign key', async () => {
    expect(await queriesOf('up')).toContain(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "FK_restaurants_reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  });

  it('down drops everything up adds', async () => {
    const down = (await queriesOf('down')).join('\n');

    for (const dropped of [
      'DROP CONSTRAINT "FK_restaurants_reviewed_by"',
      'DROP COLUMN "contact_phone"',
      'DROP COLUMN "reviewed_at"',
      'DROP COLUMN "reviewed_by"',
      'DROP COLUMN "rejection_reason"',
      'DROP CONSTRAINT "CHK_restaurants_approval_status"',
      'DROP COLUMN "approval_status"',
    ]) {
      expect(down).toContain(dropped);
    }
  });
});
