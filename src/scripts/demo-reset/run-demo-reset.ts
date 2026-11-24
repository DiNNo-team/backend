import type { DataSource } from 'typeorm';
import {
  type DatabaseTarget,
  formatDatabaseTarget,
} from '../shared/database-target.js';
import { inTransaction, type SqlRunner } from '../shared/sql-runner.js';
import { type DemoResetFlags, resolveMode } from './flags.js';
import {
  type CurrentTable,
  type InitialTable,
  planTableChanges,
} from './plan.js';
import {
  type DemoResetSummary,
  formatSummary,
  type HistoryPurge,
} from './demo-reset-summary.js';

// demo:reset: deja la demo lista. Solo SQL en una transacción, sin los
// servicios de la app: no emite eventos de WebSocket, así que los clientes
// conectados verán el cambio cuando refresquen (la web consulta cada 30 s; la
// app al volver al primer plano).

export class DemoResetError extends Error {}

// Qué restaurante y qué estado inicial: parámetros, para que las pruebas usen
// un restaurante propio y nunca toquen Casa 72.
export interface DemoResetTarget {
  restaurantName: string;
  initialTables: readonly InitialTable[];
}

export interface DemoResetIo {
  log(message: string): void;
  // Lo que escribió la persona al pedirle el nombre de la base; null si no hay
  // quien responda.
  askConfirmation(): Promise<string | null>;
}

export type DemoResetOutcome =
  | { kind: 'dry-run'; summary: DemoResetSummary }
  | { kind: 'applied'; summary: DemoResetSummary }
  | { kind: 'aborted'; reason: string };

// Orígenes que la purga borra de la bitácora; los 'manual' se conservan.
const PURGED_LOG_SOURCES = ['reservation', 'system'];

async function findRestaurant(
  runner: SqlRunner,
  name: string,
): Promise<{ id: string; name: string }> {
  const { rows } = await runner.query<{ id: string; name: string }>(
    'SELECT id, name FROM restaurants WHERE name = $1',
    [name],
  );
  if (rows.length === 0) {
    throw new DemoResetError(`No existe un restaurante llamado "${name}".`);
  }
  if (rows.length > 1) {
    throw new DemoResetError(
      `Hay ${rows.length} restaurantes llamados "${name}": el script no sabe cuál usar.`,
    );
  }
  return rows[0];
}

async function count(
  runner: SqlRunner,
  sql: string,
  params: unknown[],
): Promise<number> {
  const { rows } = await runner.query<{ n: number }>(sql, params);
  return rows[0].n;
}

async function countPurge(
  runner: SqlRunner,
  restaurantId: string,
): Promise<HistoryPurge> {
  return {
    checkIns: await count(
      runner,
      'SELECT count(*)::int AS n FROM check_ins WHERE restaurant_id = $1',
      [restaurantId],
    ),
    reservations: await count(
      runner,
      'SELECT count(*)::int AS n FROM reservations WHERE restaurant_id = $1',
      [restaurantId],
    ),
    tableLogs: await count(
      runner,
      `SELECT count(*)::int AS n FROM table_logs
        WHERE source = ANY($2::text[])
          AND table_id IN (SELECT id FROM tables WHERE restaurant_id = $1)`,
      [restaurantId, PURGED_LOG_SOURCES],
    ),
  };
}

// Lee el restaurante y arma el resumen. Con `lock`, bloquea las mesas (solo en
// la transacción de escritura: una de solo lectura no puede bloquear).
async function buildSummary(
  runner: SqlRunner,
  target: DemoResetTarget,
  purgeHistory: boolean,
  lock: boolean,
): Promise<DemoResetSummary> {
  const restaurant = await findRestaurant(runner, target.restaurantName);
  const tables = await runner.query<CurrentTable>(
    `SELECT id, identifier, capacity, status, is_active AS "isActive"
       FROM tables WHERE restaurant_id = $1 ORDER BY identifier${lock ? ' FOR UPDATE' : ''}`,
    [restaurant.id],
  );
  const plan = planTableChanges(tables.rows, target.initialTables);
  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    activeReservations: await count(
      runner,
      `SELECT count(*)::int AS n FROM reservations WHERE restaurant_id = $1 AND status = 'active'`,
      [restaurant.id],
    ),
    tableChanges: plan.changes,
    unchangedTables: plan.unchanged,
    missingTables: plan.missing,
    purge: purgeHistory ? await countPurge(runner, restaurant.id) : null,
  };
}

async function purgeHistoryRows(
  runner: SqlRunner,
  restaurantId: string,
): Promise<void> {
  // Orden de FK: check_ins → reservations → table_logs.
  await runner.query('DELETE FROM check_ins WHERE restaurant_id = $1', [
    restaurantId,
  ]);
  await runner.query('DELETE FROM reservations WHERE restaurant_id = $1', [
    restaurantId,
  ]);
  await runner.query(
    `DELETE FROM table_logs
      WHERE source = ANY($2::text[])
        AND table_id IN (SELECT id FROM tables WHERE restaurant_id = $1)`,
    [restaurantId, PURGED_LOG_SOURCES],
  );
}

// Dentro de la transacción de escritura, en este orden: (1) cancela las
// reservas activas (sin borrarlas y sin tocar check_ins) o, con la purga, borra
// el historial; (2) devuelve las mesas a su estado inicial con una fila de
// bitácora 'system' (sin usuario) por cada paso. Las mesas ya iguales no se
// tocan. Con la purga, la bitácora se limpia ANTES de escribir los pasos de
// este reset: queda como único registro de lo que hizo.
async function applyReset(
  runner: SqlRunner,
  target: DemoResetTarget,
  purgeHistory: boolean,
  now: Date,
): Promise<DemoResetSummary> {
  const summary = await buildSummary(runner, target, purgeHistory, true);
  if (purgeHistory) {
    await purgeHistoryRows(runner, summary.restaurantId);
  } else {
    await runner.query(
      `UPDATE reservations SET status = 'cancelled', cancelled_at = $2, updated_at = $2
        WHERE restaurant_id = $1 AND status = 'active'`,
      [summary.restaurantId, now],
    );
  }
  for (const change of summary.tableChanges) {
    await runner.query(
      `UPDATE tables SET capacity = $2, status = $3, is_active = $4, updated_at = $5
        WHERE id = $1`,
      [
        change.tableId,
        change.to.capacity,
        change.to.status,
        change.to.isActive,
        now,
      ],
    );
    for (const [index, step] of change.logSteps.entries()) {
      await runner.query(
        // +1 ms por paso para que el orden de la bitácora sea el de los pasos.
        `INSERT INTO table_logs (table_id, previous_status, new_status, user_id, source, changed_at)
         VALUES ($1, $2, $3, NULL, 'system', $4)`,
        [
          change.tableId,
          step.previousStatus,
          step.newStatus,
          new Date(now.getTime() + index),
        ],
      );
    }
  }
  return summary;
}

export async function runDemoReset(
  dataSource: DataSource,
  target: DemoResetTarget,
  databaseTarget: DatabaseTarget,
  flags: DemoResetFlags,
  io: DemoResetIo,
  now: Date = new Date(),
): Promise<DemoResetOutcome> {
  io.log(formatDatabaseTarget(databaseTarget));
  const preview = await inTransaction(dataSource, 'read-only', (runner) =>
    buildSummary(runner, target, flags.purgeHistory, false),
  );
  for (const line of formatSummary(preview, false)) {
    io.log(line);
  }

  const mode = await resolveMode(
    flags,
    databaseTarget.database,
    io.askConfirmation,
  );
  if (mode.kind === 'dry-run') {
    io.log('DRY-RUN: no se escribió nada. Para ejecutar, agrega --apply.');
    return { kind: 'dry-run', summary: preview };
  }
  if (mode.kind === 'abort') {
    io.log(mode.reason);
    return { kind: 'aborted', reason: mode.reason };
  }

  const done = await inTransaction(dataSource, 'read-write', (runner) =>
    applyReset(runner, target, flags.purgeHistory, now),
  );
  io.log('Hecho (en una sola transacción):');
  for (const line of formatSummary(done, true)) {
    io.log(line);
  }
  io.log(
    'Aviso: no se emitieron eventos de WebSocket; los clientes conectados verán el cambio al refrescar.',
  );
  return { kind: 'applied', summary: done };
}
