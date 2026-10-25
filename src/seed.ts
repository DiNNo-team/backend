import { Logger } from '@nestjs/common';
import dataSource from './data-source.js';
import { loadRealRestaurants } from './seed-data/real-restaurants.js';
import {
  CASA72_NAME,
  CASA72_OWNER_EMAIL,
  DEMO_USER_EMAIL,
  DINER_USER_EMAIL,
  ONBOARDING_USER_EMAIL,
  PREVIOUS_CASA72_OWNER_EMAIL,
  runSeed,
  type SeedSummary,
} from './seed-data/run-seed.js';

// Development data only: run with `npm run seed`, never as a migration. What
// it creates and what it resets on every run: seed-data/run-seed.ts. All in
// one transaction: an error leaves the database as it was.

const logger = new Logger('Seed');

function logSummary(summary: SeedSummary): void {
  const { onboardingUser, demoUser, casa72Owner, dinerUser } = summary;
  if (summary.casa72OwnerMoved) {
    logger.log(
      `Dueño de ${CASA72_NAME}: ${PREVIOUS_CASA72_OWNER_EMAIL} pasó a ${CASA72_OWNER_EMAIL} (mismo id, sin firebase_uid).`,
    );
  }
  logger.log(
    `${CASA72_NAME} (id ${summary.casa72RestaurantId}): datos de prueba restablecidos, mesas nuevas: ${summary.casa72NewTables}`,
  );
  logger.log(
    `Restaurantes reales: ${summary.realRestaurantsCreated} nuevos, ${summary.realRestaurantsReset} restablecidos, mesas nuevas: ${summary.realRestaurantsNewTables}`,
  );
  logger.log(
    `Usuario SIN restaurante (onboarding): DEV_USER_ID=${onboardingUser.id} (${ONBOARDING_USER_EMAIL})`,
  );
  if (onboardingUser.restaurantId !== null) {
    logger.warn(
      `${ONBOARDING_USER_EMAIL} ya tiene restaurante: reinícialo con el SQL de docs/database.md.`,
    );
  }
  logger.log(
    `Usuario de la DEMO, no usar para pruebas: DEV_USER_ID=${demoUser.id} (${DEMO_USER_EMAIL})`,
  );
  if (demoUser.restaurantId !== null) {
    logger.warn(
      `${DEMO_USER_EMAIL} ya tiene restaurante: dejó de servir para la demo.`,
    );
  }
  logger.log(
    `Usuario CON ${CASA72_NAME}: DEV_USER_ID=${casa72Owner.id} (${CASA72_OWNER_EMAIL})`,
  );
  logger.log(
    `Usuario COMENSAL: DEV_USER_ID=${dinerUser.id} (${DINER_USER_EMAIL})`,
  );
}

async function seed(): Promise<void> {
  // Read before connecting: a missing or broken file stops here.
  const realRestaurants = loadRealRestaurants();
  await dataSource.initialize();
  try {
    const summary = await dataSource.transaction((manager) =>
      runSeed(manager, realRestaurants),
    );
    logSummary(summary);
  } finally {
    await dataSource.destroy();
  }
}

try {
  await seed();
} catch (error) {
  logger.error(
    'No se pudieron crear los datos de prueba.',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
}
