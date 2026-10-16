// Internal event (EventEmitter2): something that changes a restaurant's
// availability for the diner was saved. Emitted only after the operation is
// committed, never inside its transaction. restaurant-operations knows nothing
// about who listens (search-availability recalculates and sends it by the
// WebSocket); the payload is only the id.
export const RESTAURANT_AVAILABILITY_AFFECTED =
  'restaurant.availability-affected';

export interface RestaurantAvailabilityAffectedEvent {
  restaurantId: string;
}

// Emitted by: a table status change (only when it changes), creating a
// table, deactivating or reactivating one, opening or closing the restaurant
// (only when it changes) and editing its hours or location. Not by editing a
// table's identifier or capacity, nor by registering a restaurant.
export function availabilityAffected(
  restaurantId: string,
): RestaurantAvailabilityAffectedEvent {
  return { restaurantId };
}
