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
// Internal event emitted after a change that affects availability is saved.
export {
  RESTAURANT_AVAILABILITY_AFFECTED,
  type RestaurantAvailabilityAffectedEvent,
} from './shared/availability-affected.event.js';
