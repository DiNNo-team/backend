import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { runExport } from '../../src/scripts/export-data/run-export.js';
import { inTransaction } from '../../src/scripts/shared/sql-runner.js';
import {
  closeTestDataSource,
  openTestDataSource,
  withScenario,
} from './support/scenario.js';
import {
  insertAdmin,
  insertCheckIn,
  insertReservation,
  insertTableLog,
} from './support/script-data.js';

// export:data contra Postgres REAL (la base de pruebas). La base es una copia
// de datos reales: cada prueba mira solo las filas de su propio restaurante.
// Solo lee; lo único que escribe es la carpeta temporal de cada prueba.
let dataSource: DataSource;
const folders: string[] = [];

beforeAll(async () => {
  dataSource = await openTestDataSource();
});

afterAll(async () => {
  await Promise.all(
    folders.map((folder) => rm(folder, { recursive: true, force: true })),
  );
  await closeTestDataSource(dataSource);
});

async function exportToTemp(
  now: Date,
  salt?: Buffer,
): Promise<{ directory: string; files: Record<string, string> }> {
  const root = await mkdtemp(join(tmpdir(), 'dinno-export-'));
  folders.push(root);
  const { directory } = await runExport(dataSource, root, now, salt);
  const files: Record<string, string> = {};
  for (const name of await readdir(directory)) {
    files[name] = await readFile(join(directory, name), 'utf8');
  }
  return { directory, files };
}

// Líneas de un CSV que mencionan alguno de los ids. Los datos de estas pruebas
// no llevan comas ni comillas, así que separar por "," alcanza.
function rowsWith(csv: string, ...ids: string[]): string[][] {
  return csv
    .split('\n')
    .filter((line) => ids.some((id) => line.includes(id)))
    .map((line) => line.split(','));
}

describe('export:data', () => {
  it('exporta los tres CSV con valores correctos y sin ningún dato sensible', async () => {
    await withScenario(
      dataSource,
      [
        { identifier: 'A1', capacity: 4 },
        { identifier: 'A2', capacity: 2 },
      ],
      2,
      async (scenario) => {
        const [diner1, diner2] = scenario.dinerIds;
        const tableA1 = scenario.tableIds.get('A1')!;
        const tableA2 = scenario.tableIds.get('A2')!;
        const displayName = `Zoe Fabulosa ${randomUUID()}`;
        await dataSource.query(
          `UPDATE users SET display_name = $2 WHERE id = $1`,
          [diner1, displayName],
        );
        const [{ email: dinerEmail }] = await dataSource.query<
          { email: string }[]
        >(`SELECT email FROM users WHERE id = $1`, [diner1]);
        const admin = await insertAdmin(dataSource, scenario);

        const active = await insertReservation(dataSource, scenario, {
          dinerId: diner1,
          tableId: tableA1,
          state: 'active',
        });
        const cancelled = await insertReservation(dataSource, scenario, {
          dinerId: diner1,
          tableId: tableA1,
          state: 'cancelled',
        });
        const expired = await insertReservation(dataSource, scenario, {
          dinerId: diner2,
          tableId: tableA2,
          state: 'expired',
        });
        const completed = await insertReservation(dataSource, scenario, {
          dinerId: diner2,
          tableId: tableA2,
          state: 'completed',
        });
        const checkInId = await insertCheckIn(
          dataSource,
          scenario,
          completed.id,
        );
        await insertTableLog(dataSource, tableA1, {
          previous: 'available',
          next: 'occupied',
          source: 'manual',
          userId: admin.id,
        });
        await insertTableLog(dataSource, tableA1, {
          previous: 'available',
          next: 'reserved',
          source: 'reservation',
          userId: diner1,
        });
        await insertTableLog(dataSource, tableA2, {
          previous: 'reserved',
          next: 'available',
          source: 'system',
          userId: null,
        });

        const { directory, files } = await exportToTemp(new Date());

        expect(Object.keys(files).sort()).toEqual([
          'LEEME.md',
          'check_ins.csv',
          'reservations.csv',
          'table_logs.csv',
        ]);
        expect(directory).toContain('dinno-export-');

        // reservations.csv: 4 filas del escenario, con su estado y cierre.
        const reservationRows = rowsWith(
          files['reservations.csv'],
          scenario.restaurantId,
        );
        expect(reservationRows).toHaveLength(4);
        const header = files['reservations.csv'].split('\n')[0].split(',');
        const byId = new Map(
          reservationRows.map((row) => [
            row[header.indexOf('reservation_id')],
            Object.fromEntries(header.map((name, i) => [name, row[i]])),
          ]),
        );
        expect(byId.get(active.id)).toMatchObject({
          status: 'active',
          table_capacity: '4',
          party_size: '2',
          cancelled_at: '',
          seconds_to_expire_or_resolve: '',
          no_show: 'false',
        });
        expect(byId.get(cancelled.id)).toMatchObject({
          status: 'cancelled',
          seconds_to_expire_or_resolve: '120',
        });
        expect(byId.get(expired.id)).toMatchObject({
          status: 'expired',
          no_show: 'true',
          table_capacity: '2',
          seconds_to_expire_or_resolve: '900',
        });
        expect(byId.get(completed.id)).toMatchObject({
          status: 'completed',
          seconds_to_expire_or_resolve: '300',
        });
        // Mismo comensal, mismo seudónimo; comensales distintos, distinto.
        const pseudonym = (id: string) => byId.get(id)?.diner_pseudonym;
        expect(pseudonym(active.id)).toBe(pseudonym(cancelled.id));
        expect(pseudonym(expired.id)).toBe(pseudonym(completed.id));
        expect(pseudonym(active.id)).not.toBe(pseudonym(expired.id));
        expect(pseudonym(active.id)).toMatch(/^[0-9a-f]{16}$/);

        // check_ins.csv
        const checkInRows = rowsWith(files['check_ins.csv'], checkInId);
        expect(checkInRows).toHaveLength(1);
        expect(checkInRows[0].slice(0, 3)).toEqual([
          checkInId,
          completed.id,
          scenario.restaurantId,
        ]);

        // table_logs.csv: tipo de actor, nunca quién.
        const logRows = rowsWith(
          files['table_logs.csv'],
          scenario.restaurantId,
        );
        expect(logRows).toHaveLength(3);
        const actors = Object.fromEntries(
          logRows.map((row) => [row[5], row[7]]),
        );
        expect(actors).toEqual({
          manual: 'restaurant_admin',
          reservation: 'diner',
          system: 'system',
        });

        // Nada sensible en NINGÚN archivo, LEEME incluido.
        const sensitive = [
          dinerEmail,
          admin.email,
          displayName,
          'Zoe Fabulosa',
          diner1,
          diner2,
          admin.id,
          active.code,
          cancelled.code,
          expired.code,
          completed.code,
          'db-test-',
        ];
        for (const [name, content] of Object.entries(files)) {
          for (const text of sensitive) {
            expect(content, `${name} no debe contener ${text}`).not.toContain(
              text,
            );
          }
        }
      },
    );
  });

  it('la transacción es de solo lectura: una escritura dentro falla', async () => {
    await withScenario(
      dataSource,
      [{ identifier: 'A1', capacity: 2 }],
      0,
      async (scenario) => {
        await expect(
          inTransaction(dataSource, 'read-only', (runner) =>
            runner.query(`UPDATE restaurants SET name = name WHERE id = $1`, [
              scenario.restaurantId,
            ]),
          ),
        ).rejects.toThrow(/read-only/i);
      },
    );
  });

  it('dos exportaciones dan seudónimos distintos para el mismo comensal', async () => {
    await withScenario(
      dataSource,
      [{ identifier: 'A1', capacity: 2 }],
      1,
      async (scenario) => {
        await insertReservation(dataSource, scenario, {
          dinerId: scenario.dinerIds[0],
          tableId: scenario.tableIds.get('A1')!,
          state: 'cancelled',
        });
        const first = await exportToTemp(new Date('2026-11-06T10:00:00Z'));
        const second = await exportToTemp(new Date('2026-11-06T10:00:01Z'));
        const pseudonymIn = (csv: string) =>
          rowsWith(csv, scenario.restaurantId)[0][1];
        expect(pseudonymIn(first.files['reservations.csv'])).toMatch(
          /^[0-9a-f]{16}$/,
        );
        expect(pseudonymIn(first.files['reservations.csv'])).not.toBe(
          pseudonymIn(second.files['reservations.csv']),
        );
      },
    );
  });
});
