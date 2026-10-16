// Public surface of restaurant-operations: other modules import only from here.
export { RestaurantOperationsModule } from './restaurant-operations.module.js';
export {
  RESTAURANT_CATEGORIES,
  type RestaurantCategory,
} from './restaurants/restaurant.entity.js';
// Internal event emitted after a change that affects availability is saved.
export {
  RESTAURANT_AVAILABILITY_AFFECTED,
  type RestaurantAvailabilityAffectedEvent,
} from './shared/availability-affected.event.js';
