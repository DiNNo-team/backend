import { In, type DataSource } from 'typeorm';
import type {
  RestaurantRow,
  ScheduleRow,
  TableRow,
} from './availability-rows.js';
import { AvailabilityService } from './availability.service.js';
import type { Clock } from './clock.js';

const CASA = 'a4765bce-fc28-496c-bdbc-68bd1599f1d9';
const PAREJAS = '55bb0482-be1e-490b-9ba8-7533335d958b';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

// Friday 2026-10-16 13:00 in Bogotá.
const FRIDAY_13H = new Date('2026-10-16T18:00:00Z');

function restaurant(id: string): RestaurantRow {
  return { id, isOpen: true, latitude: 4.655671, longitude: -74.057006 };
}

// Friday 12:00-22:00.
function fridayLunch(restaurantId: string): ScheduleRow {
  return {
    restaurantId,
    dayOfWeek: 5,
    isOpen24h: false,
    opensAt: '12:00:00',
    closesAt: '22:00:00',
  };
}

function table(
  restaurantId: string,
  capacity: number,
  status = 'available',
): TableRow {
  return { restaurantId, capacity, status, isActive: true };
}

// Both open on Friday at 13:00. Casa: free table of 4 and occupied table of 2.
// Parejas: only free tables of 2.
const DEFAULT_ROWS = {
  restaurants: [restaurant(CASA), restaurant(PAREJAS)],
  schedules: [fridayLunch(CASA), fridayLunch(PAREJAS)],
  tables: [
    table(CASA, 4),
    table(CASA, 2, 'occupied'),
    table(PAREJAS, 2),
    table(PAREJAS, 2),
  ],
};

// DataSource stand-in: each repository answers with fixed rows (the query
// filtering is the database's job); the tests check the query it receives.
function createService(
  rows: Partial<typeof DEFAULT_ROWS> = {},
  now = FRIDAY_13H,
) {
  const { restaurants, schedules, tables } = { ...DEFAULT_ROWS, ...rows };
  const repositories = {
    Restaurant: { find: vi.fn().mockResolvedValue(restaurants) },
    RestaurantSchedule: { find: vi.fn().mockResolvedValue(schedules) },
    Table: { find: vi.fn().mockResolvedValue(tables) },
  };
  const dataSource = {
    getRepository: (name: keyof typeof repositories) => repositories[name],
  };
  const clock: Clock = { now: () => now };
  const service = new AvailabilityService(
    dataSource as unknown as DataSource,
    clock,
  );
  const queries = () =>
    Object.values(repositories).reduce(
      (total, repository) => total + repository.find.mock.calls.length,
      0,
    );
  return { service, repositories, queries };
}

describe('AvailabilityService', () => {
  describe('getForRestaurant', () => {
    it('computes the availability of an existing restaurant at the clock time', async () => {
      const { service } = createService();

      // Casa: open, 1 of 2 active tables free (50 %).
      await expect(service.getForRestaurant(CASA)).resolves.toEqual({
        isOpenNow: true,
        availability: 'available',
        isSearchable: true,
      });
    });

    it('uses the injected clock, not the real time', async () => {
      // Friday 23:00 in Bogotá: after closing.
      const { service } = createService({}, new Date('2026-10-17T04:00:00Z'));

      await expect(service.getForRestaurant(CASA)).resolves.toEqual({
        isOpenNow: false,
        availability: 'closed',
        isSearchable: false,
      });
    });

    it('is null for a restaurant that does not exist', async () => {
      const { service } = createService({
        restaurants: [],
        schedules: [],
        tables: [],
      });

      await expect(service.getForRestaurant(UNKNOWN)).resolves.toBeNull();
    });
  });

  describe('getForRestaurants', () => {
    it('asks the three queries for the distinct ids, whatever their number', async () => {
      const { service, repositories, queries } = createService();

      await service.getForRestaurants([CASA, PAREJAS, UNKNOWN, CASA]);

      const ids = In([CASA, PAREJAS, UNKNOWN]);
      expect(queries()).toBe(3);
      expect(repositories.Restaurant.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ids } }),
      );
      expect(repositories.RestaurantSchedule.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { restaurantId: ids } }),
      );
      expect(repositories.Table.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { restaurantId: ids } }),
      );
    });

    it('answers one result per restaurant found', async () => {
      const { service } = createService();

      const results = await service.getForRestaurants([CASA, PAREJAS]);

      expect([...results.keys()].sort()).toEqual([CASA, PAREJAS].sort());
      // Parejas: open, 2 of 2 tables free.
      expect(results.get(PAREJAS)).toEqual({
        isOpenNow: true,
        availability: 'available',
        isSearchable: true,
      });
    });

    it('does not query for an empty list', async () => {
      const { service, queries } = createService();

      await expect(service.getForRestaurants([])).resolves.toEqual(new Map());
      expect(queries()).toBe(0);
    });

    describe('with partySize (search filter)', () => {
      it('keeps searchable only the restaurants with a free table for the party', async () => {
        const { service } = createService();

        const results = await service.getForRestaurants([CASA, PAREJAS], {
          partySize: 4,
        });

        // Casa has a free table of 4; Parejas only free tables of 2.
        expect(results.get(CASA)?.isSearchable).toBe(true);
        expect(results.get(PAREJAS)).toEqual({
          isOpenNow: true,
          availability: 'available',
          isSearchable: false,
        });
      });

      it('still makes three queries', async () => {
        const { service, queries } = createService();

        await service.getForRestaurants([CASA, PAREJAS], { partySize: 4 });

        expect(queries()).toBe(3);
      });

      it('never makes a closed restaurant searchable', async () => {
        // Friday 23:00: closed, though Casa has a free table of 4.
        const { service } = createService({}, new Date('2026-10-17T04:00:00Z'));

        const results = await service.getForRestaurants([CASA], {
          partySize: 4,
        });

        expect(results.get(CASA)?.isSearchable).toBe(false);
      });

      it('keeps the three keys of the result, without counts', async () => {
        const { service } = createService();

        const results = await service.getForRestaurants([CASA], {
          partySize: 4,
        });

        expect(Object.keys(results.get(CASA) ?? {}).sort()).toEqual([
          'availability',
          'isOpenNow',
          'isSearchable',
        ]);
      });
    });

    it('without partySize answers exactly what it answered before', async () => {
      const withoutOptions = await createService().service.getForRestaurants([
        CASA,
        PAREJAS,
      ]);
      const withEmptyOptions = await createService().service.getForRestaurants(
        [CASA, PAREJAS],
        {},
      );

      expect(withEmptyOptions).toEqual(withoutOptions);
      expect(withoutOptions.get(PAREJAS)?.isSearchable).toBe(true);
    });
  });

  describe('canSeat', () => {
    it('is true when a free, active table fits the party', async () => {
      const { service } = createService({ tables: [table(CASA, 4)] });

      await expect(service.canSeat(CASA, 4)).resolves.toBe(true);
    });

    it('is false when the only table big enough is occupied', async () => {
      const { service } = createService({
        tables: [table(CASA, 2), table(CASA, 6, 'occupied')],
      });

      await expect(service.canSeat(CASA, 4)).resolves.toBe(false);
    });

    it('asks one query for the tables of that restaurant only', async () => {
      const { service, repositories, queries } = createService({ tables: [] });

      await expect(service.canSeat(UNKNOWN, 1)).resolves.toBe(false);
      expect(queries()).toBe(1);
      expect(repositories.Table.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { restaurantId: In([UNKNOWN]) } }),
      );
    });
  });
});
