import { toSnapshots } from './availability-rows.js';

const CASA = 'a4765bce-fc28-496c-bdbc-68bd1599f1d9';
const OTRO = '55bb0482-be1e-490b-9ba8-7533335d958b';

describe('toSnapshots', () => {
  it('groups schedules and tables under their restaurant', () => {
    const snapshots = toSnapshots(
      [
        { id: CASA, isOpen: true, latitude: 4.655671, longitude: -74.057006 },
        { id: OTRO, isOpen: false, latitude: null, longitude: null },
      ],
      [
        {
          restaurantId: CASA,
          dayOfWeek: 5,
          isOpen24h: false,
          opensAt: '12:00:00',
          closesAt: '22:00:00',
        },
      ],
      [
        {
          restaurantId: CASA,
          capacity: 4,
          status: 'available',
          isActive: true,
        },
        {
          restaurantId: OTRO,
          capacity: 2,
          status: 'occupied',
          isActive: false,
        },
      ],
    );

    expect(snapshots.get(CASA)).toEqual({
      isOpen: true,
      hasLocation: true,
      schedules: [
        {
          dayOfWeek: 5,
          isOpen24h: false,
          opensAt: '12:00:00',
          closesAt: '22:00:00',
        },
      ],
      tables: [{ capacity: 4, status: 'available', isActive: true }],
    });
    expect(snapshots.get(OTRO)).toEqual({
      isOpen: false,
      hasLocation: false,
      schedules: [],
      tables: [{ capacity: 2, status: 'occupied', isActive: false }],
    });
  });

  it('ignores rows of restaurants that were not found', () => {
    const snapshots = toSnapshots(
      [],
      [],
      [
        {
          restaurantId: CASA,
          capacity: 4,
          status: 'available',
          isActive: true,
        },
      ],
    );

    expect(snapshots.size).toBe(0);
  });
});
