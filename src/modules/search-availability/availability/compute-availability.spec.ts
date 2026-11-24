import type {
  RestaurantSnapshot,
  TableSnapshot,
} from './availability.types.js';
import { computeAvailability } from './compute-availability.js';

// Friday 2026-10-16 13:00 in Bogotá.
const FRIDAY_13H = new Date('2026-10-16T18:00:00Z');
// Friday 2026-10-16 23:00 in Bogotá, after closing.
const FRIDAY_23H = new Date('2026-10-17T04:00:00Z');

const FREE: TableSnapshot = {
  capacity: 4,
  status: 'available',
  isActive: true,
};
const OCCUPIED: TableSnapshot = { ...FREE, status: 'occupied' };

function snapshot(
  overrides: Partial<RestaurantSnapshot> = {},
): RestaurantSnapshot {
  return {
    isOpen: true,
    hasLocation: true,
    schedules: [
      { dayOfWeek: 5, isOpen24h: false, opensAt: '12:00', closesAt: '22:00' },
    ],
    tables: [FREE, FREE, OCCUPIED],
    ...overrides,
  };
}

describe('computeAvailability', () => {
  it('open with free tables: its level, and searchable', () => {
    expect(computeAvailability(snapshot(), FRIDAY_13H)).toEqual({
      isOpenNow: true,
      availability: 'available',
      isSearchable: true,
    });
  });

  it('outside its hours: closed and not searchable', () => {
    expect(computeAvailability(snapshot(), FRIDAY_23H)).toEqual({
      isOpenNow: false,
      availability: 'closed',
      isSearchable: false,
    });
  });

  it('switched to Cerrado inside its hours: closed and not searchable', () => {
    expect(
      computeAvailability(snapshot({ isOpen: false }), FRIDAY_13H),
    ).toEqual({
      isOpenNow: false,
      availability: 'closed',
      isSearchable: false,
    });
  });

  it('without coordinates: not searchable even if open with tables', () => {
    expect(
      computeAvailability(snapshot({ hasLocation: false }), FRIDAY_13H),
    ).toEqual({
      isOpenNow: true,
      availability: 'available',
      isSearchable: false,
    });
  });

  it('open without active tables: none and not searchable', () => {
    expect(
      computeAvailability(
        snapshot({ tables: [{ ...FREE, isActive: false }] }),
        FRIDAY_13H,
      ),
    ).toEqual({
      isOpenNow: true,
      availability: 'none',
      isSearchable: false,
    });
  });

  it('open with active tables all taken: none but still searchable', () => {
    expect(
      computeAvailability(snapshot({ tables: [OCCUPIED] }), FRIDAY_13H),
    ).toEqual({
      isOpenNow: true,
      availability: 'none',
      isSearchable: true,
    });
  });

  it('never returns how many tables there are or how many are free', () => {
    const result = computeAvailability(snapshot(), FRIDAY_13H);

    expect(Object.keys(result).sort()).toEqual([
      'availability',
      'isOpenNow',
      'isSearchable',
    ]);
    expect(
      Object.values(result).some((value) => typeof value === 'number'),
    ).toBe(false);
  });
});
