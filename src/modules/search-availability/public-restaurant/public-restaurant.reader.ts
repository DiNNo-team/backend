import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { RestaurantCategory } from '../../restaurant-operations/index.js';
import type { GeoPoint } from '../search/geo.js';

// One open day, in the format of GET /restaurants/me.
export interface PublicSchedule {
  dayOfWeek: number;
  isOpen24h: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export interface PublicRestaurantProfile {
  id: string;
  name: string;
  category: RestaurantCategory | null;
  address: string | null;
  // null when the restaurant has no coordinates.
  location: GeoPoint | null;
  schedules: PublicSchedule[];
}

// Columns read from the Restaurant and RestaurantSchedule entities of
// restaurant-operations (by entity name, read only). numeric comes as text
// from pg; time as "HH:MM:SS".
export interface ProfileRow {
  id: string;
  name: string;
  category: RestaurantCategory | null;
  address: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

export interface ScheduleRow {
  dayOfWeek: number;
  isOpen24h: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

// "HH:MM:SS" → "HH:MM", like GET /restaurants/me (its helper is internal to
// restaurant-operations, so the one line is repeated here).
const toHourMinute = (time: string | null) =>
  time === null ? null : time.slice(0, 5);

// Monday to Sunday; closed days have no row, so they never appear.
export function toPublicSchedules(rows: ScheduleRow[]): PublicSchedule[] {
  return [...rows]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map((row) => ({
      dayOfWeek: row.dayOfWeek,
      isOpen24h: row.isOpen24h,
      opensAt: toHourMinute(row.opensAt),
      closesAt: toHourMinute(row.closesAt),
    }));
}

export function toProfile(
  row: ProfileRow,
  schedules: ScheduleRow[],
): PublicRestaurantProfile {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address,
    location:
      row.latitude === null || row.longitude === null
        ? null
        : { latitude: Number(row.latitude), longitude: Number(row.longitude) },
    schedules: toPublicSchedules(schedules),
  };
}

// What the diner may see of one restaurant: profile and opening hours. Read
// only; the availability comes from AvailabilityService. The id must be a
// valid UUID (the controller checks it).
@Injectable()
export class PublicRestaurantReader {
  constructor(private readonly dataSource: DataSource) {}

  async findProfile(id: string): Promise<PublicRestaurantProfile | null> {
    const [row, schedules] = await Promise.all([
      this.dataSource.getRepository<ProfileRow>('Restaurant').findOne({
        where: { id },
        select: {
          id: true,
          name: true,
          category: true,
          address: true,
          latitude: true,
          longitude: true,
        },
      }),
      this.dataSource
        .getRepository<ScheduleRow & { restaurantId: string }>(
          'RestaurantSchedule',
        )
        .find({
          where: { restaurantId: id },
          select: {
            dayOfWeek: true,
            isOpen24h: true,
            opensAt: true,
            closesAt: true,
          },
        }),
    ]);
    return row ? toProfile(row, schedules) : null;
  }
}
