import type { Client } from 'pg';
import {
  assertMigrationsApplied,
  CHECK_VIOLATION,
  connectTestDatabase,
  expectDatabaseError,
  inRolledBackTransaction,
  insertRestaurant,
  insertTable,
  insertUser,
} from './support/test-db.js';

// Bitácora con origen y usuario opcional (Sprint 3, CLAUDE.md §12.3) contra
// Postgres REAL. Cada prueba corre en una transacción que termina en ROLLBACK.
let client: Client;

beforeAll(async () => {
  client = await connectTestDatabase();
  await assertMigrationsApplied(client);
});

afterAll(async () => {
  await client?.end();
});

const INSERT_LOG = `INSERT INTO table_logs (table_id, previous_status, new_status, user_id, source, changed_at)
                    VALUES ($1, 'reserved', 'available', $2, $3, now())`;

async function aTable() {
  const restaurantId = await insertRestaurant(client);
  return {
    tableId: await insertTable(client, restaurantId),
    userId: await insertUser(client),
  };
}

describe('table_logs: source y user_id', () => {
  it("acepta user_id null con source 'system'", () =>
    inRolledBackTransaction(client, async () => {
      const { tableId } = await aTable();

      await client.query(INSERT_LOG, [tableId, null, 'system']);

      const { rows } = await client.query(
        `SELECT user_id, source FROM table_logs WHERE table_id = $1`,
        [tableId],
      );
      expect(rows).toEqual([{ user_id: null, source: 'system' }]);
    }));

  it.each(['manual', 'reservation'])(
    "rechaza user_id null con source '%s'",
    (source) =>
      inRolledBackTransaction(client, async () => {
        const { tableId } = await aTable();

        const error = await expectDatabaseError(client, INSERT_LOG, [
          tableId,
          null,
          source,
        ]);

        expect(error.code).toBe(CHECK_VIOLATION);
        expect(error.constraint).toBe(
          'CHK_table_logs_user_required_unless_system',
        );
      }),
  );

  it.each(['manual', 'reservation', 'system'])(
    "acepta un usuario con source '%s'",
    (source) =>
      inRolledBackTransaction(client, async () => {
        const { tableId, userId } = await aTable();

        await client.query(INSERT_LOG, [tableId, userId, source]);

        const { rowCount } = await client.query(
          `SELECT 1 FROM table_logs WHERE table_id = $1`,
          [tableId],
        );
        expect(rowCount).toBe(1);
      }),
  );

  it('rechaza un source inválido', () =>
    inRolledBackTransaction(client, async () => {
      const { tableId, userId } = await aTable();

      const error = await expectDatabaseError(client, INSERT_LOG, [
        tableId,
        userId,
        'robot',
      ]);

      expect(error.code).toBe(CHECK_VIOLATION);
      expect(error.constraint).toBe('CHK_table_logs_source');
    }));

  it("un registro escrito sin source (como antes del Sprint 3) queda 'manual'", () =>
    inRolledBackTransaction(client, async () => {
      const { tableId, userId } = await aTable();

      await client.query(
        `INSERT INTO table_logs (table_id, previous_status, new_status, user_id, changed_at)
         VALUES ($1, 'available', 'occupied', $2, now())`,
        [tableId, userId],
      );

      const { rows } = await client.query<{ source: string }>(
        `SELECT source FROM table_logs WHERE table_id = $1`,
        [tableId],
      );
      expect(rows).toEqual([{ source: 'manual' }]);
    }));

  it('mantiene los checks de estado: rechaza un estado inválido', () =>
    inRolledBackTransaction(client, async () => {
      const { tableId, userId } = await aTable();

      const error = await expectDatabaseError(
        client,
        `INSERT INTO table_logs (table_id, previous_status, new_status, user_id, changed_at)
         VALUES ($1, 'broken', 'available', $2, now())`,
        [tableId, userId],
      );

      expect(error.constraint).toBe('CHK_table_logs_previous_status');
    }));
});
