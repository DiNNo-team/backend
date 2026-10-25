import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
// Not in the module's index.ts: same criterion as the seed.
import { isOpenNow } from '../modules/search-availability/availability/opening-hours.js';
import type { ScheduleSnapshot } from '../modules/search-availability/availability/availability.types.js';
import {
  loadRealRestaurants,
  type RealRestaurant,
} from './real-restaurants.js';
import {
  CASA72_NAME,
  CASA72_OWNER_EMAIL,
  PREVIOUS_CASA72_OWNER_EMAIL,
  TEAM_RESTAURANT_EMAIL,
  runSeed,
} from './run-seed.js';

// The seed against an in-memory database: each entity is a list of rows and
// the repository methods the seed uses filter by plain equality, like the
// SQL it sends. test/support/fake-database.ts only reads (find, findOne).

type Row = Record<string, unknown> & { id?: string };

function matches(where: Row) {
  return (row: Row) =>
    Object.entries(where).every(([column, value]) => row[column] === value);
}

function byIdOrWhere(criteria: string | Row): Row {
  return typeof criteria === 'string' ? { id: criteria } : criteria;
}

class InMemoryRepository {
  rows: Row[] = [];

  constructor(private readonly defaults: Row = {}) {}

  create(data: Row): Row {
    return { ...this.defaults, ...data };
  }

  save<T extends Row | Row[]>(entity: T): Promise<T> {
    for (const row of Array.isArray(entity) ? entity : [entity]) {
      row.id ??= randomUUID();
      this.rows = [...this.rows.filter((r) => r.id !== row.id), { ...row }];
    }
    return Promise.resolve(entity);
  }

  findOneBy(where: Row): Promise<Row | null> {
    const row = this.rows.find(matches(where));
    return Promise.resolve(row ? { ...row } : null);
  }

  existsBy(where: Row): Promise<boolean> {
    return Promise.resolve(this.rows.some(matches(where)));
  }

  update(criteria: string | Row, changes: Row): Promise<void> {
    const isTarget = matches(byIdOrWhere(criteria));
    this.rows = this.rows.map((row) =>
      isTarget(row) ? { ...row, ...changes } : row,
    );
    return Promise.resolve();
  }

  delete(where: Row): Promise<void> {
    const isTarget = matches(where);
    this.rows = this.rows.filter((row) => !isTarget(row));
    return Promise.resolve();
  }
}

function inMemoryDatabase() {
  const repositories = {
    User: new InMemoryRepository({ firebaseUid: null }),
    Restaurant: new InMemoryRepository({
      category: null,
      address: null,
      latitude: null,
      longitude: null,
      isOpen: true,
    }),
    RestaurantSchedule: new InMemoryRepository(),
    Table: new InMemoryRepository(),
  };
  const manager = {
    getRepository: (name: keyof typeof repositories) => repositories[name],
  } as unknown as EntityManager;
  // Every row of every table, to compare two runs. Opening hours are deleted
  // and inserted again on every run, so only their id changes (nothing points
  // to it).
  const snapshot = () => ({
    User: structuredClone(repositories.User.rows),
    Restaurant: structuredClone(repositories.Restaurant.rows),
    RestaurantSchedule: repositories.RestaurantSchedule.rows.map(
      ({ id: _id, ...day }) => day,
    ),
    Table: structuredClone(repositories.Table.rows),
  });
  return { ...repositories, manager, snapshot };
}

const realRestaurants = loadRealRestaurants();

describe('runSeed', () => {
  it('creates the 15 real restaurants, each with its owner, opening hours and tables', async () => {
    const db = inMemoryDatabase();

    const summary = await runSeed(db.manager, realRestaurants);

    expect(summary.realRestaurantsCreated).toBe(15);
    for (const restaurant of realRestaurants) {
      const owner = db.User.rows.find(
        (user) => user.email === restaurant.ownerEmail,
      );
      expect(owner).toMatchObject({ role: 'restaurant_admin' });
      const restaurantId = owner?.restaurantId;
      expect(
        db.Restaurant.rows.find((row) => row.id === restaurantId),
      ).toMatchObject({
        name: restaurant.name,
        category: restaurant.category,
        address: restaurant.address,
        latitude: restaurant.latitude,
        longitude: restaurant.longitude,
        isOpen: restaurant.isOpen,
      });
      expect(
        db.RestaurantSchedule.rows.filter(
          (row) => row.restaurantId === restaurantId,
        ),
      ).toHaveLength(restaurant.schedules.length);
      expect(
        db.Table.rows
          .filter((row) => row.restaurantId === restaurantId)
          .map(({ identifier, capacity, status, isActive }) => ({
            identifier,
            capacity,
            status,
            isActive,
          })),
      ).toEqual(restaurant.tables);
    }
  });

  it('stores a 24-hour day without hours and the others with their hours', async () => {
    const db = inMemoryDatabase();
    const fullDay: RealRestaurant['schedules'][number] = {
      dayOfWeek: 6,
      isOpen24h: true,
    };
    const lateNight: RealRestaurant['schedules'][number] = {
      dayOfWeek: 5,
      isOpen24h: false,
      opensAt: '18:00',
      closesAt: '02:00',
    };
    const restaurant = {
      ...realRestaurants[0],
      schedules: [lateNight, fullDay],
    };

    await runSeed(db.manager, [restaurant]);

    const owner = db.User.rows.find((u) => u.email === restaurant.ownerEmail);
    expect(
      db.RestaurantSchedule.rows
        .filter((row) => row.restaurantId === owner?.restaurantId)
        .map(({ dayOfWeek, isOpen24h, opensAt, closesAt }) => ({
          dayOfWeek,
          isOpen24h,
          opensAt,
          closesAt,
        })),
    ).toEqual([
      { dayOfWeek: 5, isOpen24h: false, opensAt: '18:00', closesAt: '02:00' },
      { dayOfWeek: 6, isOpen24h: true, opensAt: null, closesAt: null },
    ]);
  });

  it('creates Casa 72 once, owned by its new email, and none of the real restaurants is Casa 72', async () => {
    const db = inMemoryDatabase();

    const summary = await runSeed(db.manager, realRestaurants);

    const casa72 = db.Restaurant.rows.filter((r) => r.name === CASA72_NAME);
    expect(casa72).toHaveLength(1);
    expect(
      db.User.rows.find((u) => u.id === summary.casa72Owner.id),
    ).toMatchObject({ email: CASA72_OWNER_EMAIL, restaurantId: casa72[0].id });
    expect(summary.casa72NewTables).toBe(8);
    expect(realRestaurants.map((r) => r.name)).not.toContain(CASA72_NAME);
    // 15 real restaurants + Casa 72; 15 owners + 5 accounts of the seed.
    expect(db.Restaurant.rows).toHaveLength(16);
    expect(db.User.rows).toHaveLength(20);
    expect(summary.casa72OwnerMoved).toBe(false);
  });

  it('opens Casa 72 at 8:00 on weekdays, so it is open during the morning demo', async () => {
    const db = inMemoryDatabase();
    const { casa72RestaurantId } = await runSeed(db.manager, []);
    const casa72 = {
      isOpen: true,
      schedules: db.RestaurantSchedule.rows.filter(
        (row) => row.restaurantId === casa72RestaurantId,
      ) as unknown as ScheduleSnapshot[],
    };

    // Tuesday 2026-10-27 10:00 in Bogotá.
    expect(isOpenNow(casa72, new Date('2026-10-27T15:00:00Z'))).toBe(true);
    // Tuesday 07:59 in Bogotá: not open yet.
    expect(isOpenNow(casa72, new Date('2026-10-27T12:59:00Z'))).toBe(false);
    // Saturday 2026-10-31 10:00 in Bogotá: the weekend still opens at 11:00.
    expect(isOpenNow(casa72, new Date('2026-10-31T15:00:00Z'))).toBe(false);
    // Saturday 01:30 in Bogotá: Friday closes at 02:00 the next day.
    expect(isOpenNow(casa72, new Date('2026-10-31T06:30:00Z'))).toBe(true);
  });

  it('leaves exactly the same rows when it runs twice', async () => {
    const db = inMemoryDatabase();
    await runSeed(db.manager, realRestaurants);
    const afterFirstRun = db.snapshot();

    const summary = await runSeed(db.manager, realRestaurants);

    expect(db.snapshot()).toEqual(afterFirstRun);
    expect(summary).toMatchObject({
      realRestaurantsCreated: 0,
      realRestaurantsReset: 15,
      realRestaurantsNewTables: 0,
      casa72NewTables: 0,
      casa72OwnerMoved: false,
    });
  });

  it('puts the real restaurants back as the file says, and keeps the tables that are not in it', async () => {
    const db = inMemoryDatabase();
    await runSeed(db.manager, realRestaurants);
    const [first] = realRestaurants;
    const ownerId = db.User.rows.find((u) => u.email === first.ownerEmail)
      ?.restaurantId as string;
    await db.Restaurant.update(ownerId, { isOpen: !first.isOpen, name: 'X' });
    await db.Table.update(
      { restaurantId: ownerId, identifier: first.tables[0].identifier },
      { status: 'occupied', isActive: false, capacity: 20 },
    );
    await db.RestaurantSchedule.delete({ restaurantId: ownerId });
    await db.Table.save({
      restaurantId: ownerId,
      identifier: 'T9',
      capacity: 2,
      status: 'available',
      isActive: true,
    });

    await runSeed(db.manager, realRestaurants);

    expect(db.Restaurant.rows.find((r) => r.id === ownerId)).toMatchObject({
      name: first.name,
      isOpen: first.isOpen,
    });
    expect(
      db.Table.rows.find(
        (t) =>
          t.restaurantId === ownerId &&
          t.identifier === first.tables[0].identifier,
      ),
    ).toMatchObject(first.tables[0]);
    expect(
      db.RestaurantSchedule.rows.filter((s) => s.restaurantId === ownerId),
    ).toHaveLength(first.schedules.length);
    expect(
      db.Table.rows.some(
        (t) => t.restaurantId === ownerId && t.identifier === 'T9',
      ),
    ).toBe(true);
  });

  describe('owner of Casa 72', () => {
    const OWNER_ID = 'ecea2d74-26da-4941-943f-b095b341da68';
    const CASA72_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';

    // A database seeded before 2026-10-24, with a table changed while testing.
    function databaseWithPreviousOwner() {
      const db = inMemoryDatabase();
      db.User.rows.push({
        id: OWNER_ID,
        email: PREVIOUS_CASA72_OWNER_EMAIL,
        role: 'restaurant_admin',
        restaurantId: CASA72_ID,
        firebaseUid: 'uid-previous',
        displayName: null,
      });
      db.Restaurant.rows.push({ id: CASA72_ID, name: CASA72_NAME });
      db.Table.rows.push({
        id: randomUUID(),
        restaurantId: CASA72_ID,
        identifier: 'Mesa 1',
        capacity: 2,
        status: 'occupied',
        isActive: true,
      });
      return db;
    }

    it('moves to the new email with the same id, unlinked from Firebase, and keeps its restaurant and tables', async () => {
      const db = databaseWithPreviousOwner();

      const summary = await runSeed(db.manager, []);

      expect(db.User.rows.find((u) => u.id === OWNER_ID)).toMatchObject({
        email: CASA72_OWNER_EMAIL,
        firebaseUid: null,
        restaurantId: CASA72_ID,
      });
      expect(
        db.User.rows.some((u) => u.email === PREVIOUS_CASA72_OWNER_EMAIL),
      ).toBe(false);
      expect(summary.casa72Owner.id).toBe(OWNER_ID);
      expect(summary.casa72OwnerMoved).toBe(true);
      expect(summary.casa72RestaurantId).toBe(CASA72_ID);
      expect(db.Restaurant.rows).toHaveLength(1);
      // Its table keeps the state the team left; the 7 missing ones are created.
      expect(
        db.Table.rows.find((t) => t.identifier === 'Mesa 1'),
      ).toMatchObject({ status: 'occupied' });
      expect(summary.casa72NewTables).toBe(7);
    });

    it('does not unlink it again once the team signed in with the new email', async () => {
      const db = databaseWithPreviousOwner();
      await runSeed(db.manager, []);
      await db.User.update(OWNER_ID, { firebaseUid: 'uid-new' });

      await runSeed(db.manager, []);

      expect(db.User.rows.find((u) => u.id === OWNER_ID)).toMatchObject({
        email: CASA72_OWNER_EMAIL,
        firebaseUid: 'uid-new',
      });
    });

    it('refuses to choose when the previous and the new email both exist', async () => {
      const db = databaseWithPreviousOwner();
      db.User.rows.push({
        id: randomUUID(),
        email: CASA72_OWNER_EMAIL,
        role: 'restaurant_admin',
        restaurantId: null,
        firebaseUid: null,
        displayName: null,
      });

      await expect(runSeed(db.manager, [])).rejects.toThrow(
        PREVIOUS_CASA72_OWNER_EMAIL,
      );
    });
  });

  it('does not touch accounts and restaurants that are not in the seed', async () => {
    const db = inMemoryDatabase();
    const teamAccount = {
      id: randomUUID(),
      email: TEAM_RESTAURANT_EMAIL,
      role: 'restaurant_admin',
      restaurantId: 'casa16',
      firebaseUid: 'uid-team',
      displayName: null,
    };
    const casa16 = { id: 'casa16', name: 'Casa16', isOpen: false };
    const casa16Table = {
      id: randomUUID(),
      restaurantId: 'casa16',
      identifier: '01',
      capacity: 4,
      status: 'reserved',
      isActive: true,
    };
    db.User.rows.push({ ...teamAccount });
    db.Restaurant.rows.push({ ...casa16 });
    db.Table.rows.push({ ...casa16Table });

    await runSeed(db.manager, realRestaurants);

    expect(db.User.rows.find((u) => u.id === teamAccount.id)).toEqual(
      teamAccount,
    );
    expect(db.Restaurant.rows.find((r) => r.id === 'casa16')).toEqual(casa16);
    expect(db.Table.rows.filter((t) => t.restaurantId === 'casa16')).toEqual([
      casa16Table,
    ]);
  });

  it('refuses an owner email of the file that belongs to a diner', async () => {
    const db = inMemoryDatabase();
    const [first] = realRestaurants;
    db.User.rows.push({
      id: randomUUID(),
      email: first.ownerEmail,
      role: 'diner',
      restaurantId: null,
    });

    await expect(runSeed(db.manager, [first])).rejects.toThrow(
      first.ownerEmail,
    );
    expect(db.Restaurant.rows.some((r) => r.name === first.name)).toBe(false);
  });
});
