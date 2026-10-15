import { Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import dataSource from './data-source.js';
import { UserRole } from './modules/identity-access/roles/user-role.js';
import type { User } from './modules/identity-access/users/user.entity.js';
import type { Restaurant } from './modules/restaurant-operations/restaurants/restaurant.entity.js';
import type { RestaurantSchedule } from './modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import type {
  Table,
  TableStatus,
} from './modules/restaurant-operations/tables/table.entity.js';

// Development data only: run with `npm run seed`, never as a migration.
// Repositories are looked up by entity name so this script shares the class
// instances loaded by the data source entity glob. Idempotent: it creates
// what is missing and never changes existing users or tables; the profile
// and opening hours of Casa 72 are reset to the values below on every run.

const ONBOARDING_USER_EMAIL = 'onboarding@example.com';
const OWNER_USER_EMAIL = 'casa72@example.com';
// Reserved for the Day 7 demo, whose walkthrough starts with a user that has
// not registered a restaurant yet. Team agreement: nobody uses it to test. If
// it gets a restaurant there is no spare; use ONBOARDING_USER_EMAIL instead.
const DEMO_USER_EMAIL = 'demo@example.com';
// The only real email enabled as a restaurant (Sprint 2). The seed never
// assigns it a restaurant: its owner registers one from the web.
const TEAM_RESTAURANT_EMAIL = 'dinnoteam2026@gmail.com';
const DINER_USER_EMAIL = 'comensal@example.com';
const DINER_DISPLAY_NAME = 'Comensal de prueba';

// The team's test restaurant (demo, Sprint 1 regression, dev user): a
// fictitious name at a real corner. Its tables change live, so it is not one
// of the real restaurants of the Sprint 2 data.
const RESTAURANT_NAME = 'Casa 72';
const RESTAURANT_PROFILE: Pick<
  Restaurant,
  'category' | 'address' | 'latitude' | 'longitude'
> = {
  category: 'colombian',
  address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
  // Calle 72 with Carrera 9, from Google Maps.
  latitude: 4.655671,
  longitude: -74.057006,
};

// Wide on purpose, so it is open during the tests. Friday and Saturday close
// the next day (closesAt < opensAt). 1 = Monday ... 7 = Sunday.
const RESTAURANT_SCHEDULES: Pick<
  RestaurantSchedule,
  'dayOfWeek' | 'opensAt' | 'closesAt'
>[] = [
  { dayOfWeek: 1, opensAt: '11:00', closesAt: '23:00' },
  { dayOfWeek: 2, opensAt: '11:00', closesAt: '23:00' },
  { dayOfWeek: 3, opensAt: '11:00', closesAt: '23:00' },
  { dayOfWeek: 4, opensAt: '11:00', closesAt: '23:00' },
  { dayOfWeek: 5, opensAt: '11:00', closesAt: '02:00' },
  { dayOfWeek: 6, opensAt: '11:00', closesAt: '02:00' },
  { dayOfWeek: 7, opensAt: '11:00', closesAt: '21:00' },
];

// Existing identifiers ("Mesa N") stay as they are so Neon gets no
// duplicates; new seed restaurants use short ones ("01", "T1").
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

// Never changes an existing row: a different role only leaves a warning.
async function findOrCreateUser(
  manager: EntityManager,
  email: string,
  role: UserRole,
  displayName: string | null = null,
): Promise<User> {
  const users = manager.getRepository<User>('User');
  const existing = await users.findOneBy({ email });
  if (existing) {
    if (existing.role !== role) {
      logger.warn(
        `${email} ya existe con el rol ${existing.role}, no ${role}: no se cambia.`,
      );
    }
    return existing;
  }
  return users.save(
    users.create({ email, role, restaurantId: null, displayName }),
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

// The seed is the source of truth of Casa 72: every run puts back its
// profile and its opening hours, whatever the team changed while testing.
// Its name and its tables are never touched. Runs in the seed transaction.
async function resetRestaurantProfile(
  manager: EntityManager,
  restaurantId: string,
): Promise<void> {
  await manager
    .getRepository<Restaurant>('Restaurant')
    .update({ id: restaurantId }, RESTAURANT_PROFILE);

  const schedules =
    manager.getRepository<RestaurantSchedule>('RestaurantSchedule');
  await schedules.delete({ restaurantId });
  await schedules.save(
    RESTAURANT_SCHEDULES.map((day) =>
      schedules.create({ ...day, restaurantId, isOpen24h: false }),
    ),
  );
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
      const admin = UserRole.RESTAURANT_ADMIN;
      const onboardingUser = await findOrCreateUser(
        manager,
        ONBOARDING_USER_EMAIL,
        admin,
      );
      const demoUser = await findOrCreateUser(manager, DEMO_USER_EMAIL, admin);
      const owner = await findOrCreateUser(manager, OWNER_USER_EMAIL, admin);
      await findOrCreateUser(manager, TEAM_RESTAURANT_EMAIL, admin);
      const dinerUser = await findOrCreateUser(
        manager,
        DINER_USER_EMAIL,
        UserRole.DINER,
        DINER_DISPLAY_NAME,
      );
      const restaurantId = await ensureRestaurant(manager, owner);
      await resetRestaurantProfile(manager, restaurantId);
      const createdTables = await ensureTables(manager, restaurantId);

      logger.log(`${RESTAURANT_NAME}: datos de prueba restablecidos`);
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
      logger.log(
        `Usuario COMENSAL: DEV_USER_ID=${dinerUser.id} (${DINER_USER_EMAIL})`,
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
