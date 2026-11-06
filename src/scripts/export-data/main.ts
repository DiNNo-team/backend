import { Logger } from '@nestjs/common';
import dataSource from '../../data-source.js';
import {
  describeDatabaseTarget,
  formatDatabaseTarget,
} from '../shared/database-target.js';
import { runExport } from './run-export.js';

// Exportación anónima para la definición de la IA: `npm run export:data`.
// Solo lectura; la carpeta exports/ está en .gitignore. Ver docs/export-datos.md.

const logger = new Logger('ExportData');
const OUTPUT_ROOT = 'exports';

async function main(): Promise<void> {
  // data-source.ts ya exigió DATABASE_URL al importarse.
  const target = describeDatabaseTarget(process.env.DATABASE_URL ?? '');
  logger.log(formatDatabaseTarget(target));
  await dataSource.initialize();
  try {
    const { directory, counts } = await runExport(dataSource, OUTPUT_ROOT);
    logger.log(`reservations.csv: ${counts.reservations} filas`);
    logger.log(`check_ins.csv: ${counts.checkIns} filas`);
    logger.log(`table_logs.csv: ${counts.tableLogs} filas`);
    logger.log(`Carpeta: ${directory}`);
  } finally {
    await dataSource.destroy();
  }
}

try {
  await main();
} catch (error) {
  logger.error(
    'No se pudo exportar.',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
}
