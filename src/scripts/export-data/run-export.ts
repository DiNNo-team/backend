import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { inTransaction } from '../shared/sql-runner.js';
import { toCsv } from './csv.js';
import { readExportData } from './export-queries.js';
import { createPseudonymizer, newSalt } from './pseudonym.js';
import { buildReadme, type ExportCounts } from './readme.js';
import {
  CHECK_INS_HEADER,
  checkInRow,
  RESERVATIONS_HEADER,
  reservationRow,
  TABLE_LOGS_HEADER,
  tableLogRow,
} from './rows.js';

export interface ExportResult {
  directory: string;
  counts: ExportCounts;
}

// 2026-11-06T15:30:00Z → "2026-11-06_15-30-00" (UTC, sin ":" para que sirva
// como nombre de carpeta en Windows).
export function exportFolderName(instant: Date): string {
  return instant
    .toISOString()
    .slice(0, 19)
    .replace('T', '_')
    .replaceAll(':', '-');
}

// Lee en UNA transacción de solo lectura (la base rechaza cualquier escritura)
// y escribe exports/<fecha-hora>/ con los tres CSV y el LEEME. No escribe nada
// en la base. `salt` solo se pasa en pruebas.
export async function runExport(
  dataSource: DataSource,
  outputRoot: string,
  now: Date = new Date(),
  salt: Buffer = newSalt(),
): Promise<ExportResult> {
  const data = await inTransaction(dataSource, 'read-only', readExportData);
  const pseudonymize = createPseudonymizer(salt);
  const counts: ExportCounts = {
    reservations: data.reservations.length,
    checkIns: data.checkIns.length,
    tableLogs: data.tableLogs.length,
  };

  const directory = join(outputRoot, exportFolderName(now));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, 'reservations.csv'),
      toCsv(
        RESERVATIONS_HEADER,
        data.reservations.map((row) => reservationRow(row, pseudonymize)),
      ),
      'utf8',
    ),
    writeFile(
      join(directory, 'check_ins.csv'),
      toCsv(CHECK_INS_HEADER, data.checkIns.map(checkInRow)),
      'utf8',
    ),
    writeFile(
      join(directory, 'table_logs.csv'),
      toCsv(TABLE_LOGS_HEADER, data.tableLogs.map(tableLogRow)),
      'utf8',
    ),
    writeFile(join(directory, 'LEEME.md'), buildReadme(now, counts), 'utf8'),
  ]);
  return { directory, counts };
}
