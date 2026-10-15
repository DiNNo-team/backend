import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import {
  type RestaurantRow,
  type ScheduleRow,
  type TableRow,
  toSnapshots,
  toTable,
} from './availability-rows.js';
import type { AvailabilityResult } from './availability.types.js';
import { Clock } from './clock.js';
import { computeAvailability } from './compute-availability.js';
import { hasTableFor } from './table-availability.js';

// Availability of restaurants for the diner (search, public detail and
// WebSocket in Sprint 2; table assignment in Sprint 3). Reads the tables of
// restaurant-operations by entity name, read only (CLAUDE.md, section 11),
// and never writes. It knows nothing about HTTP or the WebSocket.
// Callers pass valid UUIDs: Postgres rejects a malformed one with an error.
export interface GetForRestaurantsOptions {
  // Search filter "personas" (1-20).
  partySize?: number;
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  // null when the restaurant does not exist.
  async getForRestaurant(
    restaurantId: string,
  ): Promise<AvailabilityResult | null> {
    const results = await this.getForRestaurants([restaurantId]);
    return results.get(restaurantId) ?? null;
  }

  // Three queries whatever the number of ids (no N+1). Unknown ids are left
  // out of the map. With partySize (the search filter), a restaurant is only
  // searchable if it also has a free, active table for the whole party,
  // checked on the tables already loaded.
  async getForRestaurants(
    restaurantIds: string[],
    options: GetForRestaurantsOptions = {},
  ): Promise<Map<string, AvailabilityResult>> {
    const ids = [...new Set(restaurantIds)];
    if (ids.length === 0) {
      return new Map();
    }
    const [restaurants, schedules, tables] = await Promise.all([
      this.dataSource.getRepository<RestaurantRow>('Restaurant').find({
        where: { id: In(ids) },
        select: { id: true, isOpen: true, latitude: true, longitude: true },
      }),
      this.dataSource.getRepository<ScheduleRow>('RestaurantSchedule').find({
        where: { restaurantId: In(ids) },
        select: {
          restaurantId: true,
          dayOfWeek: true,
          isOpen24h: true,
          opensAt: true,
          closesAt: true,
        },
      }),
      this.findTables(ids),
    ]);

    const now = this.clock.now();
    const results = new Map<string, AvailabilityResult>();
    const { partySize } = options;
    for (const [id, snapshot] of toSnapshots(restaurants, schedules, tables)) {
      const result = computeAvailability(snapshot, now);
      if (partySize !== undefined) {
        result.isSearchable =
          result.isSearchable && hasTableFor(snapshot.tables, partySize);
      }
      results.set(id, result);
    }
    return results;
  }

  // A free, active table for the whole party, for one restaurant (Sprint 3).
  // It only looks at the tables: to assign one, also check
  // getForRestaurant(id).isOpenNow. false for an unknown restaurant.
  async canSeat(restaurantId: string, partySize: number): Promise<boolean> {
    const tables = await this.findTables([restaurantId]);
    return hasTableFor(tables.map(toTable), partySize);
  }

  private findTables(restaurantIds: string[]): Promise<TableRow[]> {
    return this.dataSource.getRepository<TableRow>('Table').find({
      where: { restaurantId: In(restaurantIds) },
      select: {
        restaurantId: true,
        capacity: true,
        status: true,
        isActive: true,
      },
    });
  }
}
