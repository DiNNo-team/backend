import type { QueryRunner } from 'typeorm';
import { USER_ROLES } from '../modules/identity-access/roles/user-role.js';
import { AddDinerRoleAndRestaurantLocation1792087341885 } from './1792087341885-AddDinerRoleAndRestaurantLocation.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new AddDinerRoleAndRestaurantLocation1792087341885()[direction](
    queryRunner,
  );
  return queries;
}

describe('AddDinerRoleAndRestaurantLocation migration', () => {
  it('checks users.role against exactly UserRole', async () => {
    const roleCheck = (await queriesOf('up')).find((sql) =>
      sql.includes('"CHK_users_role"'),
    );
    const values = /CHECK \("role" IN \(([^)]*)\)\)/
      .exec(roleCheck ?? '')?.[1]
      .split(',')
      .map((value) => value.trim().replace(/'/g, ''));

    expect(values).toEqual(USER_ROLES);
  });

  it('adds both coordinates as numeric(9,6), nullable', async () => {
    const queries = await queriesOf('up');

    for (const column of ['latitude', 'longitude']) {
      expect(queries).toContain(
        `ALTER TABLE "restaurants" ADD "${column}" numeric(9,6)`,
      );
    }
  });

  it('adds every named check of the contract', async () => {
    const queries = (await queriesOf('up')).join('\n');

    for (const check of [
      'CHK_restaurants_location_pair',
      'CHK_restaurants_latitude',
      'CHK_restaurants_longitude',
      'CHK_users_role',
      'CHK_users_email_normalized',
    ]) {
      expect(queries).toContain(`ADD CONSTRAINT "${check}"`);
    }
    expect(queries).toContain(`CHECK ("email" = lower(trim("email")))`);
  });

  it('down drops everything up adds', async () => {
    const down = (await queriesOf('down')).join('\n');

    for (const dropped of [
      'DROP CONSTRAINT "CHK_users_email_normalized"',
      'DROP CONSTRAINT "CHK_users_role"',
      'DROP COLUMN "display_name"',
      'DROP CONSTRAINT "CHK_restaurants_longitude"',
      'DROP CONSTRAINT "CHK_restaurants_latitude"',
      'DROP CONSTRAINT "CHK_restaurants_location_pair"',
      'DROP COLUMN "longitude"',
      'DROP COLUMN "latitude"',
    ]) {
      expect(down).toContain(dropped);
    }
  });
});
