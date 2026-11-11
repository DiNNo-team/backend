import type { QueryRunner } from 'typeorm';
import { USER_ROLES } from '../modules/identity-access/roles/user-role.js';
import { PLATFORM_ADMIN_DOWN_BLOCKED } from '../modules/identity-access/roles/platform-admin-rollback.js';
import { AddPlatformAdminRole1794400000001 } from './1794400000001-AddPlatformAdminRole.js';

// platformAdmins: what the count query of the down returns.
async function queriesOf(
  direction: 'up' | 'down',
  platformAdmins = 0,
): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve(
        sql.startsWith('SELECT') ? [{ count: platformAdmins }] : undefined,
      );
    },
  } as unknown as QueryRunner;
  await new AddPlatformAdminRole1794400000001()[direction](queryRunner);
  return queries;
}

function roleValues(sql: string | undefined): string[] | undefined {
  return /CHECK \("role" IN \(([^)]*)\)\)/
    .exec(sql ?? '')?.[1]
    .split(',')
    .map((value) => value.trim().replace(/'/g, ''));
}

describe('AddPlatformAdminRole migration', () => {
  it('recreates users.role with exactly UserRole', async () => {
    const queries = await queriesOf('up');

    expect(queries[0]).toBe(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`,
    );
    expect(roleValues(queries[1])).toEqual(USER_ROLES);
    expect(USER_ROLES).toContain('platform_admin');
  });

  it('down goes back to the two Sprint 2 roles when nobody is platform_admin', async () => {
    const queries = await queriesOf('down');

    expect(queries).toContain(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`,
    );
    expect(roleValues(queries.at(-1))).toEqual(['restaurant_admin', 'diner']);
  });

  it('down stops before touching anything when there are platform_admin users', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: (sql: string) => {
        queries.push(sql);
        return Promise.resolve(sql.startsWith('SELECT') ? [{ count: 2 }] : []);
      },
    } as unknown as QueryRunner;

    await expect(
      new AddPlatformAdminRole1794400000001().down(queryRunner),
    ).rejects.toThrow(PLATFORM_ADMIN_DOWN_BLOCKED(2));
    expect(queries).toHaveLength(1);
  });

  it('the blocked message is the Spanish text of the contract', () => {
    expect(PLATFORM_ADMIN_DOWN_BLOCKED(3)).toBe(
      'No se puede revertir AddPlatformAdminRole: hay 3 usuario(s) con el rol platform_admin. Cámbiales el rol o bórralos a mano y vuelve a intentarlo.',
    );
  });
});
