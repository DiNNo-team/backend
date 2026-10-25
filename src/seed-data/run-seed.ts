import { Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { UserRole } from '../modules/identity-access/roles/user-role.js';
import type { User } from '../modules/identity-access/users/user.entity.js';
import type { Restaurant } from '../modules/restaurant-operations/restaurants/restaurant.entity.js';
import type { RestaurantSchedule } from '../modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { toScheduleRow } from '../modules/restaurant-operations/restaurants/restaurant-schedule-rows.js';
import type { Table } from '../modules/restaurant-operations/tables/table.entity.js';
import type { RealRestaurant } from './real-restaurants.js';

// Development data only: `npm run seed` (src/seed.ts) runs this in one
// transaction, never as a migration. Repositories are looked up by entity
// name so the seed shares the class instances loaded by the data source
// entity glob. Idempotent, one rule per kind of row:
// - Users are found by email and never changed (a different role only warns),
//   except the owner of Casa 72 moving to its new email (ensureCasa72Owner).
// - Casa 72: its profile and opening hours are reset on every run; its name
//   and its tables are never touched (the team changes them while testing).
// - The real restaurants of restaurants.json: the file is their source of
//   truth. Every run puts back their profile, Abierto switch, opening hours
//   and the capacity, status and active flag of their tables. Tables that are
//   not in the file are left as they are.
// Nothing else is touched (team accounts, other restaurants).

export const ONBOARDING_USER_EMAIL = 'onboarding@example.com';
// Reserved for the Day 7 demo, whose walkthrough starts with a user that has
// not registered a restaurant yet. Team agreement: nobody uses it to test. If
// it gets a restaurant there is no spare; use ONBOARDING_USER_EMAIL instead.
export const DEMO_USER_EMAIL = 'demo@example.com';
// The only real email enabled as a restaurant (Sprint 2). The seed never
// assigns it a restaurant: its owner registers one from the web.
export const TEAM_RESTAURANT_EMAIL = 'dinnoteam2026@gmail.com';
export const DINER_USER_EMAIL = 'comensal@example.com';
const DINER_DISPLAY_NAME = 'Comensal de prueba';

// An address the team can verify: the mail arrives at TEAM_RESTAURANT_EMAIL.
export const CASA72_OWNER_EMAIL = 'dinnoteam2026+casa72@gmail.com';
// Owner of Casa 72 until 2026-10-24 (it cannot receive mail).
export const PREVIOUS_CASA72_OWNER_EMAIL = 'casa72@example.com';

// The team's test restaurant (demo, Sprint 1 regression, dev user): a
// fictitious name at a real corner. Its tables change live, so it is not one
// of the real restaurants of restaurants.json.
export const CASA72_NAME = 'Casa 72';
const CASA72_PROFILE: Pick<
  Restaurant,
  'category' | 'address' | 'latitude' | 'longitude'
> = {
  category: 'colombian',
  address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
  // Calle 72 with Carrera 9, from Google Maps.
  latitude: 4.655671,
  longitude: -74.057006,
};

// Wide on purpose, so it is open during the tests and the weekday morning
// demo (8:00 on weekdays). Friday and Saturday close the next day
// (closesAt < opensAt). 1 = Monday ... 7 = Sunday.
const CASA72_SCHEDULES: RealRestaurant['schedules'] = [
  { dayOfWeek: 1, isOpen24h: false, opensAt: '08:00', closesAt: '23:00' },
  { dayOfWeek: 2, isOpen24h: false, opensAt: '08:00', closesAt: '23:00' },
  { dayOfWeek: 3, isOpen24h: false, opensAt: '08:00', closesAt: '23:00' },
  { dayOfWeek: 4, isOpen24h: false, opensAt: '08:00', closesAt: '23:00' },
  { dayOfWeek: 5, isOpen24h: false, opensAt: '08:00', closesAt: '02:00' },
  { dayOfWeek: 6, isOpen24h: false, opensAt: '11:00', closesAt: '02:00' },
  { dayOfWeek: 7, isOpen24h: false, opensAt: '11:00', closesAt: '21:00' },
];

// Existing identifiers ("Mesa N") stay as they are so Neon gets no
// duplicates; the real restaurants use short ones ("01").
const CASA72_TABLES: RealRestaurant['tables'] = [
  { identifier: 'Mesa 1', capacity: 2, status: 'available', isActive: true },
  { identifier: 'Mesa 2', capacity: 2, status: 'occupied', isActive: true },
  { identifier: 'Mesa 3', capacity: 4, status: 'reserved', isActive: true },
  { identifier: 'Mesa 4', capacity: 4, status: 'available', isActive: true },
  { identifier: 'Mesa 5', capacity: 4, status: 'occupied', isActive: true },
  { identifier: 'Mesa 6', capacity: 6, status: 'reserved', isActive: true },
  { identifier: 'Mesa 7', capacity: 6, status: 'available', isActive: true },
  { identifier: 'Mesa 8', capacity: 8, status: 'available', isActive: false },
];

export interface SeedSummary {
  onboardingUser: User;
  demoUser: User;
  casa72Owner: User;
  // The owner moved from PREVIOUS_CASA72_OWNER_EMAIL in this run.
  casa72OwnerMoved: boolean;
  dinerUser: User;
  casa72RestaurantId: string;
  casa72NewTables: number;
  realRestaurantsCreated: number;
  realRestaurantsReset: number;
  realRestaurantsNewTables: number;
}

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

// Casa 72 changes owner email, never owner: the same user id keeps the dev
// user of Casa 72 working. firebase_uid goes back to null so the first
// Firebase sign-in with the verified new email links it (FirebaseUserResolver).
// `moved` tells the log, printed after the commit.
async function ensureCasa72Owner(
  manager: EntityManager,
): Promise<{ owner: User; moved: boolean }> {
  const users = manager.getRepository<User>('User');
  const previous = await users.findOneBy({
    email: PREVIOUS_CASA72_OWNER_EMAIL,
  });
  if (!previous) {
    const owner = await findOrCreateUser(
      manager,
      CASA72_OWNER_EMAIL,
      UserRole.RESTAURANT_ADMIN,
    );
    return { owner, moved: false };
  }
  if (await users.existsBy({ email: CASA72_OWNER_EMAIL })) {
    throw new Error(
      `${PREVIOUS_CASA72_OWNER_EMAIL} y ${CASA72_OWNER_EMAIL} existen a la vez: deja solo al dueño de ${CASA72_NAME} y vuelve a correr el seed.`,
    );
  }
  await users.update(previous.id, {
    email: CASA72_OWNER_EMAIL,
    firebaseUid: null,
  });
  return {
    owner: { ...previous, email: CASA72_OWNER_EMAIL, firebaseUid: null },
    moved: true,
  };
}

async function ensureRestaurant(
  manager: EntityManager,
  owner: User,
  name: string,
): Promise<string> {
  if (owner.restaurantId !== null) {
    return owner.restaurantId;
  }
  const restaurants = manager.getRepository<Restaurant>('Restaurant');
  const restaurant = await restaurants.save(restaurants.create({ name }));
  await manager
    .getRepository<User>('User')
    .update(owner.id, { restaurantId: restaurant.id });
  return restaurant.id;
}

async function replaceSchedules(
  manager: EntityManager,
  restaurantId: string,
  days: RealRestaurant['schedules'],
): Promise<void> {
  const schedules =
    manager.getRepository<RestaurantSchedule>('RestaurantSchedule');
  await schedules.delete({ restaurantId });
  await schedules.save(
    days.map((day) => schedules.create(toScheduleRow(restaurantId, day))),
  );
}

// Creates the missing tables, matched by identifier. With resetExisting, the
// ones that exist go back to the values of the seed.
async function ensureTables(
  manager: EntityManager,
  restaurantId: string,
  seedTables: RealRestaurant['tables'],
  { resetExisting }: { resetExisting: boolean },
): Promise<number> {
  const tables = manager.getRepository<Table>('Table');
  let created = 0;
  for (const { identifier, capacity, status, isActive } of seedTables) {
    const existing = await tables.findOneBy({ restaurantId, identifier });
    if (!existing) {
      await tables.save(
        tables.create({ restaurantId, identifier, capacity, status, isActive }),
      );
      created += 1;
    } else if (resetExisting) {
      await tables.update(existing.id, { capacity, status, isActive });
    }
  }
  return created;
}

async function seedCasa72(
  manager: EntityManager,
  owner: User,
): Promise<{ restaurantId: string; newTables: number }> {
  const restaurantId = await ensureRestaurant(manager, owner, CASA72_NAME);
  await manager
    .getRepository<Restaurant>('Restaurant')
    .update(restaurantId, CASA72_PROFILE);
  await replaceSchedules(manager, restaurantId, CASA72_SCHEDULES);
  const newTables = await ensureTables(manager, restaurantId, CASA72_TABLES, {
    resetExisting: false,
  });
  return { restaurantId, newTables };
}

// A wrong role in the file's email aborts the whole seed: giving a
// restaurant to a diner would break that account.
async function seedRealRestaurant(
  manager: EntityManager,
  restaurant: RealRestaurant,
): Promise<{ created: boolean; newTables: number }> {
  const { ownerEmail, name, category, address, latitude, longitude, isOpen } =
    restaurant;
  const owner = await findOrCreateUser(
    manager,
    ownerEmail,
    UserRole.RESTAURANT_ADMIN,
  );
  if (owner.role !== UserRole.RESTAURANT_ADMIN) {
    throw new Error(
      `${ownerEmail} no es una cuenta de restaurante: no puede ser dueño de ${name}.`,
    );
  }
  const created = owner.restaurantId === null;
  const restaurantId = await ensureRestaurant(manager, owner, name);
  await manager.getRepository<Restaurant>('Restaurant').update(restaurantId, {
    name,
    category,
    address,
    latitude,
    longitude,
    isOpen,
  });
  await replaceSchedules(manager, restaurantId, restaurant.schedules);
  const newTables = await ensureTables(
    manager,
    restaurantId,
    restaurant.tables,
    { resetExisting: true },
  );
  return { created, newTables };
}

export async function runSeed(
  manager: EntityManager,
  realRestaurants: RealRestaurant[],
): Promise<SeedSummary> {
  const admin = UserRole.RESTAURANT_ADMIN;
  const onboardingUser = await findOrCreateUser(
    manager,
    ONBOARDING_USER_EMAIL,
    admin,
  );
  const demoUser = await findOrCreateUser(manager, DEMO_USER_EMAIL, admin);
  await findOrCreateUser(manager, TEAM_RESTAURANT_EMAIL, admin);
  const dinerUser = await findOrCreateUser(
    manager,
    DINER_USER_EMAIL,
    UserRole.DINER,
    DINER_DISPLAY_NAME,
  );

  const { owner: casa72Owner, moved: casa72OwnerMoved } =
    await ensureCasa72Owner(manager);
  const casa72 = await seedCasa72(manager, casa72Owner);

  let realRestaurantsCreated = 0;
  let realRestaurantsNewTables = 0;
  for (const restaurant of realRestaurants) {
    const { created, newTables } = await seedRealRestaurant(
      manager,
      restaurant,
    );
    realRestaurantsCreated += created ? 1 : 0;
    realRestaurantsNewTables += newTables;
  }

  return {
    onboardingUser,
    demoUser,
    casa72Owner,
    casa72OwnerMoved,
    dinerUser,
    casa72RestaurantId: casa72.restaurantId,
    casa72NewTables: casa72.newTables,
    realRestaurantsCreated,
    realRestaurantsReset: realRestaurants.length - realRestaurantsCreated,
    realRestaurantsNewTables,
  };
}
