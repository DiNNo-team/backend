import { createInterface } from 'node:readline/promises';
import { Logger } from '@nestjs/common';
import dataSource from '../../data-source.js';
import { describeDatabaseTarget } from '../shared/database-target.js';
import { parseDemoResetArgs, UsageError } from './flags.js';
import { DEMO_INITIAL_TABLES, DEMO_RESTAURANT_NAME } from './initial-state.js';
import { DemoResetError, runDemoReset } from './run-demo-reset.js';

// `npm run demo:reset`: por defecto solo muestra qué haría (DRY-RUN). Para
// escribir hacen falta --apply y confirmar el nombre de la base. Solo el
// restaurante DEMO_RESTAURANT_NAME. Ver CLAUDE.md §11, "Scripts de datos".

const logger = new Logger('DemoReset');

async function askConfirmation(): Promise<string | null> {
  if (!process.stdin.isTTY) {
    return null;
  }
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await readline.question(
      'Para ejecutar, escribe el nombre de la base de datos: ',
    );
  } finally {
    readline.close();
  }
}

async function main(): Promise<void> {
  const flags = parseDemoResetArgs(process.argv.slice(2));
  // data-source.ts ya exigió DATABASE_URL al importarse.
  const databaseTarget = describeDatabaseTarget(process.env.DATABASE_URL ?? '');
  await dataSource.initialize();
  try {
    const outcome = await runDemoReset(
      dataSource,
      {
        restaurantName: DEMO_RESTAURANT_NAME,
        initialTables: DEMO_INITIAL_TABLES,
      },
      databaseTarget,
      flags,
      { log: (message) => logger.log(message), askConfirmation },
    );
    if (outcome.kind === 'aborted') {
      process.exitCode = 1;
    }
  } finally {
    await dataSource.destroy();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof UsageError || error instanceof DemoResetError) {
    logger.error(error.message);
  } else {
    logger.error(
      'No se pudo ejecutar demo:reset; no se escribió nada.',
      error instanceof Error ? error.message : String(error),
    );
  }
  process.exitCode = 1;
}
