// Types of the availability rule (CLAUDE.md, section 10, "Disponibilidad").
// Own types on purpose: this module never imports restaurant-operations
// entities; availability-rows.ts maps the database rows to them.

// One open day of the week. Times as the database returns them: "HH:MM" or
// "HH:MM:SS". A 24-hour day has no times.
export interface ScheduleSnapshot {
  // ISO 8601: 1 = Monday ... 7 = Sunday.
  dayOfWeek: number;
  isOpen24h: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export type TableStatusSnapshot = 'available' | 'reserved' | 'occupied';

export interface TableSnapshot {
  capacity: number;
  status: TableStatusSnapshot;
  isActive: boolean;
}

// Everything the rule needs to know about one restaurant.
export interface RestaurantSnapshot {
  // The manual Abierto/Cerrado switch of the restaurant.
  isOpen: boolean;
  // Both coordinates set: without them it cannot appear in the search.
  hasLocation: boolean;
  schedules: ScheduleSnapshot[];
  tables: TableSnapshot[];
}

export type AvailabilityLevel = 'available' | 'few' | 'none';

export type Availability = AvailabilityLevel | 'closed';

// What the API and the WebSocket may show. Never a count of tables.
export interface AvailabilityResult {
  isOpenNow: boolean;
  availability: Availability;
  isSearchable: boolean;
}
