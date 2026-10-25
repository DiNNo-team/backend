import { readFileSync } from 'node:fs';
import type { RestaurantCategory } from '../modules/restaurant-operations/index.js';
import type { TableStatus } from '../modules/restaurant-operations/tables/table.entity.js';

// One element of restaurants.json, the 15 real restaurants of the Sprint 2
// seed, in the format agreed with Santiago (AVISOS.md). restaurants.spec.ts
// checks the file against these rules; the seed trusts it.
export interface RealRestaurant {
  name: string;
  category: RestaurantCategory;
  address: string;
  latitude: number;
  longitude: number;
  isOpen: boolean;
  ownerEmail: string;
  // Only the open days. A 24-hour day has no hours.
  schedules: {
    dayOfWeek: number;
    isOpen24h: boolean;
    opensAt?: string;
    closesAt?: string;
  }[];
  tables: {
    identifier: string;
    capacity: number;
    status: TableStatus;
    isActive: boolean;
  }[];
}

// Next to this module: in src/ for the tests and in dist/ for `npm run seed`
// (nest-cli.json copies it as an asset).
const REAL_RESTAURANTS_FILE = new URL('./restaurants.json', import.meta.url);

export function loadRealRestaurants(): RealRestaurant[] {
  return JSON.parse(
    readFileSync(REAL_RESTAURANTS_FILE, 'utf8'),
  ) as RealRestaurant[];
}
