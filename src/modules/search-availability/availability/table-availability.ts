import type { AvailabilityLevel, TableSnapshot } from './availability.types.js';

// Free = active and Disponible. An inactive table counts for nothing, not
// even as one of the restaurant's tables.
export function isFree(table: TableSnapshot): boolean {
  return table.isActive && table.status === 'available';
}

// Level of the availability indicator. More than 30 % free is available;
// compared with integers (free * 10 > active * 3) so exactly 30 % is "few".
// Without active tables it is "none" (isSearchable leaves it out anyway).
export function availabilityLevel(tables: TableSnapshot[]): AvailabilityLevel {
  const active = tables.filter((table) => table.isActive).length;
  const free = tables.filter(isFree).length;
  if (free === 0) {
    return 'none';
  }
  return free * 10 > active * 3 ? 'available' : 'few';
}

// One table can seat the whole party: free and big enough. The rule shared by
// the search filter and the table assignment of the micro-reservation
// (reservations-checkin), so both always agree.
export function canSeatParty(table: TableSnapshot, partySize: number): boolean {
  return isFree(table) && table.capacity >= partySize;
}

// There is a free table for the whole party (search filter).
export function hasTableFor(
  tables: TableSnapshot[],
  partySize: number,
): boolean {
  return tables.some((table) => canSeatParty(table, partySize));
}

// At least one active table: a condition to appear in the search.
export function hasActiveTable(tables: TableSnapshot[]): boolean {
  return tables.some((table) => table.isActive);
}
