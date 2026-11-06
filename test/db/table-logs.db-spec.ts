import type { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { User } from '../../src/modules/identity-access/users/user.entity.js';
import { UsersService } from '../../src/modules/identity-access/users/users.service.js';
import { TableLog } from '../../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { TableLogsService } from '../../src/modules/restaurant-operations/table-logs/table-logs.service.js';
import {
  closeTestDataSource,
  openTestDataSource,
  withScenario,
} from './support/scenario.js';
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

// La lectura con el servicio real: el filtro por rol solo se comprueba de verdad
// con SQL. Commits reales con datos propios (support/scenario.ts), no ROLLBACK:
// el servicio lee por otra conexión.
describe('GET /v1/table-logs: qué autor conserva su correo (§12.3)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
  });

  afterAll(async () => {
    await closeTestDataSource(dataSource);
  });

  it('comensal y system salen con userEmail null; el admin conserva su correo, en manual y en el check-in', () =>
    withScenario(
      dataSource,
      [{ identifier: '01', capacity: 4 }],
      2,
      async (s) => {
        const [diner, admin] = s.dinerIds;
        await dataSource.query(
          `UPDATE users SET role = 'restaurant_admin', restaurant_id = $2 WHERE id = $1`,
          [admin, s.restaurantId],
        );
        const tableId = s.tableIds.get('01');
        const entries: [string | null, string, string][] = [
          [diner, 'reservation', '2026-11-06T17:00:00Z'],
          [admin, 'reservation', '2026-11-06T17:01:00Z'],
          [admin, 'manual', '2026-11-06T17:02:00Z'],
          [null, 'system', '2026-11-06T17:03:00Z'],
        ];
        for (const [userId, source, changedAt] of entries) {
          await dataSource.query(
            `INSERT INTO table_logs (table_id, previous_status, new_status, user_id, source, changed_at)
             VALUES ($1, 'available', 'reserved', $2, $3, $4)`,
            [tableId, userId, source, changedAt],
          );
        }
        const [{ email: adminEmail }] = await dataSource.query<
          { email: string }[]
        >(`SELECT email FROM users WHERE id = $1`, [admin]);
        const [{ email: dinerEmail }] = await dataSource.query<
          { email: string }[]
        >(`SELECT email FROM users WHERE id = $1`, [diner]);
        const service = new TableLogsService(
          dataSource.getRepository(TableLog),
          new UsersService(dataSource.getRepository(User)),
        );

        const rows = await service.findForRestaurant(s.restaurantId);

        expect(rows.map((r) => [r.source, r.userEmail])).toEqual([
          ['system', null],
          ['manual', adminEmail],
          ['reservation', adminEmail],
          ['reservation', null],
        ]);
        const json = JSON.stringify(rows);
        expect(json).not.toContain(dinerEmail);
        expect(json).not.toContain(dinerEmail.split('@')[0]);
      },
    ));
});
