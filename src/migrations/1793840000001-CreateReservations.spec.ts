import type { QueryRunner } from 'typeorm';
import {
  RESERVATION_CODE_ALPHABET,
  RESERVATION_CODE_LENGTH,
  RESERVATION_MAX_PARTY_SIZE,
  RESERVATION_MIN_PARTY_SIZE,
  RESERVATION_STATUSES,
} from '../modules/reservations-checkin/reservations/reservation.constants.js';
import { CreateReservations1793840000001 } from './1793840000001-CreateReservations.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new CreateReservations1793840000001()[direction](queryRunner);
  return queries;
}

const createTable = async () => (await queriesOf('up'))[0];

describe('CreateReservations migration', () => {
  it('checks status against exactly RESERVATION_STATUSES', async () => {
    const match =
      /CHK_reservations_status" CHECK \("status" IN \(([^)]*)\)\)/.exec(
        await createTable(),
      );

    expect(match).not.toBeNull();
    expect(
      match![1].split(',').map((value) => value.trim().replace(/'/g, '')),
    ).toEqual([...RESERVATION_STATUSES]);
  });

  it('bounds party_size with the limits of the constants', async () => {
    expect(await createTable()).toContain(
      `CONSTRAINT "CHK_reservations_party_size" CHECK ("party_size" BETWEEN ${RESERVATION_MIN_PARTY_SIZE} AND ${RESERVATION_MAX_PARTY_SIZE})`,
    );
  });

  it('checks the code against exactly the alphabet and the length of the constants', async () => {
    const sql = await createTable();

    expect(sql).toContain(
      `CONSTRAINT "CHK_reservations_code" CHECK ("code" ~ '^[${RESERVATION_CODE_ALPHABET}]{${RESERVATION_CODE_LENGTH}}$')`,
    );
    expect(sql).toContain(
      `"code" character varying(${RESERVATION_CODE_LENGTH}) NOT NULL`,
    );
  });

  it('creates the table with nullable dates and no_show false by default', async () => {
    const sql = await createTable();

    for (const column of ['cancelled_at', 'expired_at', 'checked_in_at']) {
      expect(sql).toContain(`"${column}" TIMESTAMP WITH TIME ZONE,`);
    }
    expect(sql).toContain(`"expires_at" TIMESTAMP WITH TIME ZONE NOT NULL`);
    expect(sql).toContain(`"no_show" boolean NOT NULL DEFAULT false`);
  });

  it.each([
    ['UQ_reservations_active_table', 'table_id'],
    ['UQ_reservations_active_diner', 'diner_id'],
    ['UQ_reservations_active_code', 'code'],
  ])(
    '%s is a unique index on %s only for active reservations',
    async (name, column) => {
      expect(await queriesOf('up')).toContain(
        `CREATE UNIQUE INDEX "${name}" ON "reservations" ("${column}") WHERE "status" = 'active'`,
      );
    },
  );

  it('creates the support indexes for the restaurant list and the diner history', async () => {
    const queries = await queriesOf('up');

    expect(queries).toContainEqual(
      expect.stringContaining(
        'CREATE INDEX "IDX_reservations_restaurant_status_expires_at" ON "reservations" ("restaurant_id", "status", "expires_at")',
      ),
    );
    expect(queries).toContainEqual(
      expect.stringContaining(
        'CREATE INDEX "IDX_reservations_diner_id_created_at" ON "reservations" ("diner_id", "created_at")',
      ),
    );
  });

  it.each([
    ['diner_id', 'users'],
    ['restaurant_id', 'restaurants'],
    ['table_id', 'tables'],
  ])('%s references %s with NO ACTION', async (column, target) => {
    expect(await queriesOf('up')).toContainEqual(
      expect.stringContaining(
        `FOREIGN KEY ("${column}") REFERENCES "${target}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      ),
    );
  });

  it('down undoes everything and drops the table last', async () => {
    const down = await queriesOf('down');

    expect(down.filter((sql) => sql.includes('DROP CONSTRAINT'))).toHaveLength(
      3,
    );
    expect(down.filter((sql) => sql.startsWith('DROP INDEX'))).toHaveLength(5);
    expect(down.at(-1)).toBe('DROP TABLE "reservations"');
  });
});
