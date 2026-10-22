import { readFileSync } from 'node:fs';
import { RESTAURANT_CATEGORIES } from '../modules/restaurant-operations/restaurants/restaurant.entity.js';
import {
  isInsideBogota,
  roundCoordinate,
} from '../modules/restaurant-operations/shared/bogota-location.js';
import { TABLE_STATUSES } from '../modules/restaurant-operations/tables/table.entity.js';
import type {
  Availability,
  RestaurantSnapshot,
  TableStatusSnapshot,
} from '../modules/search-availability/availability/availability.types.js';
import { computeAvailability } from '../modules/search-availability/availability/compute-availability.js';

// Checks restaurants.json (the 15 real restaurants of the Sprint 2 seed)
// against the criteria of the Sprint 2 plan, section 9, "Santiago (C)", and
// the format agreed in AVISOS.md.

interface SeedSchedule {
  dayOfWeek: number;
  isOpen24h: boolean;
  opensAt?: string;
  closesAt?: string;
}

interface SeedTable {
  identifier: string;
  capacity: number;
  status: string;
  isActive: boolean;
}

interface SeedRestaurant {
  name: string;
  category: string;
  address: string;
  // null until someone copies them by hand from Google Maps.
  latitude: number | null;
  longitude: number | null;
  isOpen: boolean;
  ownerEmail: string;
  schedules: SeedSchedule[];
  tables: SeedTable[];
}

const restaurants = JSON.parse(
  readFileSync(new URL('./restaurants.json', import.meta.url), 'utf8'),
) as SeedRestaurant[];

// Assumed demo (agreed with Santiago on 2026-10-22): a weekday between 9:00
// and 11:00 in Bogotá. If the demo moves, change it here.
const DEMO_WINDOW = { from: '09:00', to: '11:00' };
const WEEKDAYS = [1, 2, 3, 4, 5];

// Same limits as RestaurantFieldsDto and the tables DTOs.
const NAME_MAX_LENGTH = 120;
const ADDRESS_MAX_LENGTH = 255;
const IDENTIFIER_MAX_LENGTH = 10;
const MIN_TABLES = 4;
const MAX_TABLES = 12;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TEST_OWNER_EMAIL = /^restaurante-(0[1-9]|1[0-5])@dinno\.test$/;

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Monday 2026-10-26 ... Friday 2026-10-30. Bogotá is UTC-5 all year.
function bogotaInstant(dayOfWeek: number, minuteOfDay: number): Date {
  return new Date(Date.UTC(2026, 9, 25 + dayOfWeek, 5, minuteOfDay));
}

// First and last minute of the window on every weekday.
const DEMO_INSTANTS = WEEKDAYS.flatMap((day) => [
  bogotaInstant(day, minutesOf(DEMO_WINDOW.from)),
  bogotaInstant(day, minutesOf(DEMO_WINDOW.to) - 1),
]);

function toSnapshot(restaurant: SeedRestaurant): RestaurantSnapshot {
  return {
    isOpen: restaurant.isOpen,
    // Coordinates are checked on their own: here only the hours and tables.
    hasLocation: true,
    schedules: restaurant.schedules.map((schedule) => ({
      dayOfWeek: schedule.dayOfWeek,
      isOpen24h: schedule.isOpen24h,
      opensAt: schedule.opensAt ?? null,
      closesAt: schedule.closesAt ?? null,
    })),
    tables: restaurant.tables.map((table) => ({
      capacity: table.capacity,
      status: table.status as TableStatusSnapshot,
      isActive: table.isActive,
    })),
  };
}

function availabilityDuringDemo(restaurant: SeedRestaurant): Availability[] {
  const snapshot = toSnapshot(restaurant);
  return DEMO_INSTANTS.map(
    (instant) => computeAvailability(snapshot, instant).availability,
  );
}

function scheduleProblems({ name, schedules }: SeedRestaurant): string[] {
  const problems: string[] = [];
  const days = schedules.map((schedule) => schedule.dayOfWeek);
  if (schedules.length === 0) problems.push(`${name}: no open day`);
  if (new Set(days).size !== days.length) {
    problems.push(`${name}: repeated day`);
  }
  for (const { dayOfWeek, isOpen24h, opensAt, closesAt } of schedules) {
    const day = `${name}, day ${dayOfWeek}`;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      problems.push(`${day}: dayOfWeek must be 1 (Monday) to 7 (Sunday)`);
    }
    if (isOpen24h) {
      if (opensAt !== undefined || closesAt !== undefined) {
        problems.push(`${day}: a 24-hour day has no hours`);
      }
    } else if (!TIME.test(opensAt ?? '') || !TIME.test(closesAt ?? '')) {
      problems.push(`${day}: hours must be HH:MM`);
    } else if (opensAt === closesAt) {
      problems.push(`${day}: opening and closing are the same`);
    }
  }
  return problems;
}

function tableProblems({ name, tables }: SeedRestaurant): string[] {
  const problems: string[] = [];
  if (tables.length < MIN_TABLES || tables.length > MAX_TABLES) {
    problems.push(`${name}: ${tables.length} tables, not 4 to 12`);
  }
  // "4", "04" and "Mesa 4" are the same table: compare the trimmed text.
  const identifiers = tables.map((table) => table.identifier.trim());
  if (
    new Set(identifiers.map((id) => id.toLowerCase())).size !== tables.length
  ) {
    problems.push(`${name}: repeated table identifier`);
  }
  for (const { identifier, capacity, status, isActive } of tables) {
    const table = `${name}, table ${identifier}`;
    if (!identifier.trim() || identifier.length > IDENTIFIER_MAX_LENGTH) {
      problems.push(`${table}: identifier must have 1 to 10 characters`);
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) {
      problems.push(`${table}: capacity must be 1 to 20`);
    }
    if (!(TABLE_STATUSES as readonly string[]).includes(status)) {
      problems.push(`${table}: unknown status ${status}`);
    }
    if (typeof isActive !== 'boolean') {
      problems.push(`${table}: isActive must be true or false`);
    }
  }
  return problems;
}

describe('restaurants.json (Sprint 2 seed data)', () => {
  it('has 15 restaurants with unique names, without Casa 72', () => {
    const names = restaurants.map((restaurant) => restaurant.name.trim());

    expect(restaurants).toHaveLength(15);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(15);
    expect(names).not.toContain('Casa 72');
  });

  it('keeps names and addresses within the API limits', () => {
    const problems = restaurants.flatMap(({ name, address }) => [
      ...(name.trim() && name.length <= NAME_MAX_LENGTH
        ? []
        : [`name: ${name}`]),
      ...(address.trim() && address.length <= ADDRESS_MAX_LENGTH
        ? []
        : [`address: ${name}`]),
    ]);

    expect(problems).toEqual([]);
  });

  it('uses only contract categories, at least 6 different ones', () => {
    const categories = restaurants.map((restaurant) => restaurant.category);

    expect(
      categories.filter(
        (category) =>
          !(RESTAURANT_CATEGORIES as readonly string[]).includes(category),
      ),
    ).toEqual([]);
    expect(new Set(categories).size).toBeGreaterThanOrEqual(6);
  });

  it('has coordinates inside Bogotá with at most 6 decimals', () => {
    const problems = restaurants
      .filter(({ latitude, longitude }) => {
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
          return true;
        }
        return (
          !isInsideBogota({ latitude, longitude }) ||
          roundCoordinate(latitude) !== latitude ||
          roundCoordinate(longitude) !== longitude
        );
      })
      .map((restaurant) => restaurant.name);

    // Missing coordinates are copied by hand from Google Maps.
    expect(problems).toEqual([]);
  });

  it('has valid opening hours', () => {
    expect(restaurants.flatMap(scheduleProblems)).toEqual([]);
  });

  it('has between 4 and 12 valid tables per restaurant', () => {
    expect(restaurants.flatMap(tableProblems)).toEqual([]);
  });

  it('uses unique test owner emails', () => {
    const emails = restaurants.map((restaurant) => restaurant.ownerEmail);

    expect(emails.filter((email) => !TEST_OWNER_EMAIL.test(email))).toEqual([]);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('has exactly 2 restaurants closed by hand', () => {
    expect(restaurants.filter((restaurant) => !restaurant.isOpen)).toHaveLength(
      2,
    );
  });

  it('has a 24-hour day and a schedule that closes the next day', () => {
    const schedules = restaurants.flatMap((restaurant) => restaurant.schedules);
    // "00:00" closes at midnight: nothing is left for the next day.
    const closesNextDay = schedules.some(
      ({ opensAt, closesAt }) =>
        opensAt !== undefined &&
        closesAt !== undefined &&
        closesAt !== '00:00' &&
        minutesOf(closesAt) < minutesOf(opensAt),
    );

    expect(schedules.some((schedule) => schedule.isOpen24h)).toBe(true);
    expect(closesNextDay).toBe(true);
  });

  it('shows the three levels during the demo window', () => {
    const levels = restaurants
      .map(availabilityDuringDemo)
      .filter((during) => during.every((level) => level === during[0]))
      .map((during) => during[0]);

    expect(levels).toEqual(
      expect.arrayContaining(['available', 'few', 'none']),
    );
  });

  it('keeps an open restaurant out of hours during the demo window', () => {
    const outOfHours = restaurants.filter(
      (restaurant) =>
        restaurant.isOpen &&
        availabilityDuringDemo(restaurant).every((level) => level === 'closed'),
    );

    expect(outOfHours.length).toBeGreaterThanOrEqual(1);
  });
});
