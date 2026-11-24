import type {
  RestaurantSnapshot,
  ScheduleSnapshot,
  TableSnapshot,
  TableStatusSnapshot,
} from './availability.types.js';

// The columns read from the entities of restaurant-operations (by entity
// name, read only). Property names are those of the entities.
export interface RestaurantRow {
  id: string;
  isOpen: boolean;
  latitude: number | null;
  longitude: number | null;
}

export interface ScheduleRow extends ScheduleSnapshot {
  restaurantId: string;
}

export interface TableRow {
  restaurantId: string;
  capacity: number;
  status: string;
  isActive: boolean;
}

function toSchedule(row: ScheduleRow): ScheduleSnapshot {
  return {
    dayOfWeek: row.dayOfWeek,
    isOpen24h: row.isOpen24h,
    opensAt: row.opensAt,
    closesAt: row.closesAt,
  };
}

// tables.status only allows these three values (CHK_tables_status).
export function toTable(row: TableRow): TableSnapshot {
  return {
    capacity: row.capacity,
    status: row.status as TableStatusSnapshot,
    isActive: row.isActive,
  };
}

function groupByRestaurant<Row extends { restaurantId: string }, Item>(
  rows: Row[],
  toItem: (row: Row) => Item,
): Map<string, Item[]> {
  const groups = new Map<string, Item[]>();
  for (const row of rows) {
    const group = groups.get(row.restaurantId) ?? [];
    group.push(toItem(row));
    groups.set(row.restaurantId, group);
  }
  return groups;
}

// One snapshot per restaurant found; schedules and tables of restaurants
// that were not found are ignored.
export function toSnapshots(
  restaurants: RestaurantRow[],
  schedules: ScheduleRow[],
  tables: TableRow[],
): Map<string, RestaurantSnapshot> {
  const schedulesBy = groupByRestaurant(schedules, toSchedule);
  const tablesBy = groupByRestaurant(tables, toTable);
  return new Map(
    restaurants.map((restaurant) => [
      restaurant.id,
      {
        isOpen: restaurant.isOpen,
        hasLocation:
          restaurant.latitude !== null && restaurant.longitude !== null,
        schedules: schedulesBy.get(restaurant.id) ?? [],
        tables: tablesBy.get(restaurant.id) ?? [],
      },
    ]),
  );
}
