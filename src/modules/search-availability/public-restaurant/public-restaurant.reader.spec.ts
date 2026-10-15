import type { DataSource } from 'typeorm';
import {
  PublicRestaurantReader,
  toProfile,
  toPublicSchedules,
  type ProfileRow,
  type ScheduleRow,
} from './public-restaurant.reader.js';

const ID = '55bb0482-be1e-490b-9ba8-7533335d958b';

const ROW: ProfileRow = {
  id: ID,
  name: 'Casa 72',
  category: 'colombian',
  address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
  latitude: '4.655671',
  longitude: '-74.057006',
};

const day = (
  dayOfWeek: number,
  opensAt: string | null,
  closesAt: string | null,
): ScheduleRow => ({
  dayOfWeek,
  isOpen24h: opensAt === null,
  opensAt,
  closesAt,
});

describe('toPublicSchedules', () => {
  it('sorts Monday to Sunday and cuts the times to HH:MM', () => {
    expect(
      toPublicSchedules([
        day(7, '11:00:00', '21:00:00'),
        day(1, '11:00:00', '23:00:00'),
        day(5, '11:00:00', '02:00:00'),
      ]),
    ).toStrictEqual([
      { dayOfWeek: 1, isOpen24h: false, opensAt: '11:00', closesAt: '23:00' },
      // Closes the next day: closesAt < opensAt, as in GET /restaurants/me.
      { dayOfWeek: 5, isOpen24h: false, opensAt: '11:00', closesAt: '02:00' },
      { dayOfWeek: 7, isOpen24h: false, opensAt: '11:00', closesAt: '21:00' },
    ]);
  });

  it('keeps a 24-hour day without times', () => {
    expect(toPublicSchedules([day(6, null, null)])).toStrictEqual([
      { dayOfWeek: 6, isOpen24h: true, opensAt: null, closesAt: null },
    ]);
  });

  it('does not reorder the rows it receives', () => {
    const rows = [
      day(3, '09:00:00', '18:00:00'),
      day(2, '09:00:00', '18:00:00'),
    ];
    toPublicSchedules(rows);
    expect(rows[0].dayOfWeek).toBe(3);
  });
});

describe('toProfile', () => {
  it('turns the numeric text of pg into numbers', () => {
    expect(toProfile(ROW, []).location).toStrictEqual({
      latitude: 4.655671,
      longitude: -74.057006,
    });
  });

  it('has no location without coordinates', () => {
    expect(
      toProfile({ ...ROW, latitude: null, longitude: null }, []).location,
    ).toBeNull();
  });
});

describe('PublicRestaurantReader', () => {
  function setup(row: ProfileRow | null, schedules: ScheduleRow[] = []) {
    const restaurants = { findOne: vi.fn().mockResolvedValue(row) };
    const schedulesRepo = { find: vi.fn().mockResolvedValue(schedules) };
    const getRepository = vi.fn((name: string) =>
      name === 'Restaurant' ? restaurants : schedulesRepo,
    );
    const reader = new PublicRestaurantReader({
      getRepository,
    } as unknown as DataSource);
    return { reader, restaurants, schedulesRepo, getRepository };
  }

  it('reads the restaurant and its schedules by entity name, only the columns it needs', async () => {
    const { reader, restaurants, schedulesRepo, getRepository } = setup(ROW, [
      day(1, '11:00:00', '23:00:00'),
    ]);

    const profile = await reader.findProfile(ID);

    expect(getRepository).toHaveBeenCalledWith('Restaurant');
    expect(getRepository).toHaveBeenCalledWith('RestaurantSchedule');
    expect(restaurants.findOne).toHaveBeenCalledWith({
      where: { id: ID },
      select: {
        id: true,
        name: true,
        category: true,
        address: true,
        latitude: true,
        longitude: true,
      },
    });
    expect(schedulesRepo.find).toHaveBeenCalledWith({
      where: { restaurantId: ID },
      select: {
        dayOfWeek: true,
        isOpen24h: true,
        opensAt: true,
        closesAt: true,
      },
    });
    expect(profile?.schedules).toStrictEqual([
      { dayOfWeek: 1, isOpen24h: false, opensAt: '11:00', closesAt: '23:00' },
    ]);
  });

  it('answers null for an unknown restaurant', async () => {
    const { reader } = setup(null);

    await expect(reader.findProfile(ID)).resolves.toBeNull();
  });
});
