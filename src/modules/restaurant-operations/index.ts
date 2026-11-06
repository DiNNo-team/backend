// Public surface of restaurant-operations: other modules import only from here.
export { RestaurantOperationsModule } from './restaurant-operations.module.js';
export {
  RESTAURANT_CATEGORIES,
  type RestaurantCategory,
} from './restaurants/restaurant.entity.js';
// Port of the table log: whoever changes a table's status in its own
// transaction (the micro-reservations) writes the log entry through it.
export {
  TableStatusLog,
  type TableLogSource,
  type TableLogStatus,
} from './tables/table-status-log.js';
// Port of the reservations, seen from the tables: reservations-checkin
// implements it; AppModule requires it (RequireTableReservationsPort).
export {
  RequireTableReservationsPort,
  TableReservations,
  TableReservationsAccess,
  type ActiveTableReservation,
} from './shared/table-reservations.js';
// The 403 of a session user without a restaurant, for the restaurant routes of
// other modules (the check-in and the reservation list).
export {
  RESTAURANT_REQUIRED_CODE,
  RESTAURANT_REQUIRED_MESSAGE,
  requireRestaurant,
} from './shared/restaurant-required.js';
// Internal event emitted after a change that affects availability is saved.
export {
  RESTAURANT_AVAILABILITY_AFFECTED,
  type RestaurantAvailabilityAffectedEvent,
} from './shared/availability-affected.event.js';
