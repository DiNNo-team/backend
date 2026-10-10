import { Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import dataSource from './data-source.js';
import type { User } from './modules/identity-access/users/user.entity.js';
import type { Restaurant } from './modules/restaurant-operations/restaurants/restaurant.entity.js';
import type {
  Table,
  TableStatus,
} from './modules/restaurant-operations/tables/table.entity.js';

// Development data only: run with `npm run seed`, never as a migration.
// Repositories are looked up by entity name so this script shares the class
// instances loaded by the data source entity glob.

// Same role the Firebase login gives to new users (restaurant_admin).
const SEED_ROLE = 'restaurant_admin';
const ONBOARDING_USER_EMAIL = 'onboarding@example.com';
const OWNER_USER_EMAIL = 'casa72@example.com';
// Reserved for the Day 7 demo, whose walkthrough starts with a user that has
// not registered a restaurant yet. Team agreement: nobody uses it to test. If
// it gets a restaurant there is no spare; use ONBOARDING_USER_EMAIL instead.
const DEMO_USER_EMAIL = 'demo@example.com';

const RESTAURANT_NAME = 'Casa 72';

const SEED_TABLES: {
  identifier: string;
  capacity: number;
  status: TableStatus;
  isActive: boolean;
}[] = [
  { identifier: 'Mesa 1', capacity: 2, status: 'available', isActive: true },
  { identifier: 'Mesa 2', capacity: 2, status: 'occupied', isActive: true },
  { identifier: 'Mesa 3', capacity: 4, status: 'reserved', isActive: true },
  { identifier: 'Mesa 4', capacity: 4, status: 'available', isActive: true },
  { identifier: 'Mesa 5', capacity: 4, status: 'occupied', isActive: true },
  { identifier: 'Mesa 6', capacity: 6, status: 'reserved', isActive: true },
  { identifier: 'Mesa 7', capacity: 6, status: 'available', isActive: true },
  { identifier: 'Mesa 8', capacity: 8, status: 'available', isActive: false },
];

const logger = new Logger('Seed');

async function findOrCreateUser(
  manager: EntityManager,
  email: string,
): Promise<User> {
  const users = manager.getRepository<User>('User');
  const existing = await users.findOneBy({ email });
  if (existing) {
    return existing;
  }
  return users.save(
    users.create({ email, role: SEED_ROLE, restaurantId: null }),
  );
}

async function ensureRestaurant(
  manager: EntityManager,
  owner: User,
): Promise<string> {
  if (owner.restaurantId !== null) {
    return owner.restaurantId;
  }
  const restaurants = manager.getRepository<Restaurant>('Restaurant');
  const restaurant = await restaurants.save(
    restaurants.create({ name: RESTAURANT_NAME }),
  );
  await manager
    .getRepository<User>('User')
    .update(owner.id, { restaurantId: restaurant.id });
  return restaurant.id;
}

async function ensureTables(
  manager: EntityManager,
  restaurantId: string,
): Promise<number> {
  const tables = manager.getRepository<Table>('Table');
  let created = 0;
  for (const seedTable of SEED_TABLES) {
    const exists = await tables.existsBy({
      restaurantId,
      identifier: seedTable.identifier,
    });
    if (!exists) {
      await tables.save(tables.create({ ...seedTable, restaurantId }));
      created += 1;
    }
  }
  return created;
}

async function seed(): Promise<void> {
  await dataSource.initialize();
  try {
    await dataSource.transaction(async (manager) => {
      const onboardingUser = await findOrCreateUser(
        manager,
        ONBOARDING_USER_EMAIL,
      );
      const demoUser = await findOrCreateUser(manager, DEMO_USER_EMAIL);
      const owner = await findOrCreateUser(manager, OWNER_USER_EMAIL);
      const restaurantId = await ensureRestaurant(manager, owner);
      const createdTables = await ensureTables(manager, restaurantId);

      logger.log(
        `Mesas nuevas en ${RESTAURANT_NAME} (id ${restaurantId}): ${createdTables}`,
      );
      logger.log(
        `Usuario SIN restaurante (onboarding): DEV_USER_ID=${onboardingUser.id} (${ONBOARDING_USER_EMAIL})`,
      );
      logger.log(
        `Usuario de la DEMO, no usar para pruebas: DEV_USER_ID=${demoUser.id} (${DEMO_USER_EMAIL})`,
      );
      if (demoUser.restaurantId !== null) {
        logger.warn(
          `${DEMO_USER_EMAIL} ya tiene restaurante: dejó de servir para la demo.`,
        );
      }
      logger.log(
        `Usuario CON ${RESTAURANT_NAME}: DEV_USER_ID=${owner.id} (${OWNER_USER_EMAIL})`,
      );
    });
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
