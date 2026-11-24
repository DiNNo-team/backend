// Public surface of search-availability: other modules import only from here.
export { SearchAvailabilityModule } from './search-availability.module.js';
export {
  AvailabilityService,
  type GetForRestaurantsOptions,
} from './availability/availability.service.js';
// To fix the time in the tests: .overrideProvider(Clock).useValue(...).
export { Clock } from './availability/clock.js';
// TTL of the micro-reservation (RESERVATION_TTL_MINUTES): owned here so the public
// detail can show it without depending on reservations-checkin.
export {
  ReservationConfig,
  parseReservationTtl,
  reservationConfigProvider,
  RESERVATION_TTL_DEFAULT_MINUTES,
  RESERVATION_TTL_MAX_MINUTES,
  RESERVATION_TTL_MIN_MINUTES,
} from './reservation-ttl/reservation-ttl.config.js';
// The time shown in the check-in messages (HH:mm in Bogotá).
export { formatBogotaClock } from './availability/bogota-time.js';
// Diner visibility of a restaurant (approved only, §11), reused by the
// reservation so the rule lives in one place.
export {
  DINER_VISIBLE_RESTAURANT,
  isVisibleToDiners,
  type VisibilityColumns,
} from './visibility/restaurant-visibility.js';
// The 404 of the public detail, reused by the reservation (same visibility rule).
export {
  RESTAURANT_NOT_FOUND_CODE,
  RESTAURANT_NOT_FOUND_MESSAGE,
  restaurantNotFound,
} from './public-restaurant/restaurant-not-found.js';
// Rule of "free table" shared with the reservation's table assignment.
export { canSeatParty, isFree } from './availability/table-availability.js';
// Internal events of the reservations that the WebSocket translates (§12.8).
export {
  RESERVATION_CANCELLED,
  RESERVATION_CHECKED_IN,
  RESERVATION_CREATED,
  RESERVATION_EXPIRED,
  type ReservationCreatedEvent,
  type ReservationEndedEvent,
} from './realtime/reservation-events.js';
export type {
  Availability,
  AvailabilityLevel,
  AvailabilityResult,
  TableSnapshot,
} from './availability/availability.types.js';
