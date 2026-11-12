import type { QueryRunner } from 'typeorm';
import { PUSH_TOKEN_MAX_LENGTH } from '../modules/notifications/devices/push-device.entity.js';
import { CreatePushDevices1794500000000 } from './1794500000000-CreatePushDevices.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new CreatePushDevices1794500000000()[direction](queryRunner);
  return queries;
}

describe('CreatePushDevices migration', () => {
  it('sizes the token with the rule of the DTO and allows only android and ios', async () => {
    const create = (await queriesOf('up')).find((sql) =>
      sql.startsWith('CREATE TABLE "push_devices"'),
    );

    expect(create).toContain(
      `"token" character varying(${PUSH_TOKEN_MAX_LENGTH}) NOT NULL`,
    );
    expect(create).toContain(`CHECK ("platform" IN ('android', 'ios'))`);
  });

  it('makes the token unique and deletes the phones with their user', async () => {
    const queries = (await queriesOf('up')).join('\n');

    expect(queries).toContain(
      'CREATE UNIQUE INDEX "UQ_push_devices_token" ON "push_devices" ("token")',
    );
    expect(queries).toContain('REFERENCES "users"("id") ON DELETE CASCADE');
  });

  it('down drops only what up created', async () => {
    expect(await queriesOf('down')).toEqual([
      'DROP INDEX "public"."IDX_push_devices_user_id"',
      'DROP INDEX "public"."UQ_push_devices_token"',
      'DROP TABLE "push_devices"',
    ]);
  });
});
