import type { TableSnapshot } from './availability.types.js';
import {
  availabilityLevel,
  hasActiveTable,
  hasTableFor,
} from './table-availability.js';

function table(overrides: Partial<TableSnapshot> = {}): TableSnapshot {
  return { capacity: 4, status: 'available', isActive: true, ...overrides };
}

// `active` active tables, of which `free` are Disponible (the rest Ocupada).
function tables(active: number, free: number): TableSnapshot[] {
  return Array.from({ length: active }, (_, index) =>
    table({ status: index < free ? 'available' : 'occupied' }),
  );
}

describe('availabilityLevel', () => {
  it.each<[string, string, TableSnapshot[]]>([
    ['no active tables', 'none', []],
    ['10 active, 0 free', 'none', tables(10, 0)],
    ['3 of 10 free (exactly 30 %)', 'few', tables(10, 3)],
    ['4 of 10 free', 'available', tables(10, 4)],
    ['1 of 4 free (25 %)', 'few', tables(4, 1)],
    ['1 of 3 free (33 %)', 'available', tables(3, 1)],
    ['1 of 1 free', 'available', tables(1, 1)],
  ])('%s → %s', (_case, expected, input) => {
    expect(availabilityLevel(input)).toBe(expected);
  });

  it('does not count inactive tables, not even when their status is available', () => {
    // 1 free of 4 active (few); 6 inactive "available" tables must not
    // turn it into 7 of 10 (available).
    const withInactive = [
      ...tables(4, 1),
      ...Array.from({ length: 6 }, () => table({ isActive: false })),
    ];

    expect(availabilityLevel(withInactive)).toBe('few');
  });

  it('is none when the only "available" tables are inactive', () => {
    expect(
      availabilityLevel([
        table({ isActive: false }),
        table({ status: 'occupied' }),
      ]),
    ).toBe('none');
  });

  it('does not count reserved or occupied tables as free', () => {
    expect(
      availabilityLevel([
        table({ status: 'reserved' }),
        table({ status: 'occupied' }),
      ]),
    ).toBe('none');
  });
});

describe('hasTableFor', () => {
  it('is false for 4 people with only free tables of 2', () => {
    expect(
      hasTableFor([table({ capacity: 2 }), table({ capacity: 2 })], 4),
    ).toBe(false);
  });

  it('is true for 4 people with a free table of 4', () => {
    expect(
      hasTableFor([table({ capacity: 2 }), table({ capacity: 4 })], 4),
    ).toBe(true);
  });

  it('is false for 4 people when the table of 6 is occupied', () => {
    expect(hasTableFor([table({ capacity: 6, status: 'occupied' })], 4)).toBe(
      false,
    );
  });

  it('ignores an inactive table even if it is big enough', () => {
    expect(hasTableFor([table({ capacity: 6, isActive: false })], 4)).toBe(
      false,
    );
  });
});

describe('hasActiveTable', () => {
  it('is true with one active table, whatever its status', () => {
    expect(hasActiveTable([table({ status: 'occupied' })])).toBe(true);
  });

  it('is false with only inactive tables or none', () => {
    expect(hasActiveTable([table({ isActive: false })])).toBe(false);
    expect(hasActiveTable([])).toBe(false);
  });
});
