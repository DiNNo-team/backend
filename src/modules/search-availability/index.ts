// Public surface of search-availability: other modules import only from here.
export { SearchAvailabilityModule } from './search-availability.module.js';
export {
  AvailabilityService,
  type GetForRestaurantsOptions,
} from './availability/availability.service.js';
// To fix the time in the tests: .overrideProvider(Clock).useValue(...).
export { Clock } from './availability/clock.js';
// The time shown in the check-in messages (HH:mm in Bogotá).
export { formatBogotaClock } from './availability/bogota-time.js';
// The 404 of the public detail, reused by the reservation (same visibility rule).
export {
  RESTAURANT_NOT_FOUND_CODE,
  RESTAURANT_NOT_FOUND_MESSAGE,
  restaurantNotFound,
} from './public-restaurant/restaurant-not-found.js';
// Rule of "free table" shared with the reservation's table assignment.
export { canSeatParty, isFree } from './availability/table-availability.js';
export type {
  Availability,
  AvailabilityLevel,
  AvailabilityResult,
  TableSnapshot,
} from './availability/availability.types.js';
