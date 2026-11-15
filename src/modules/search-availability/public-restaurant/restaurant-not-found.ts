// The only 404 of the public detail: malformed id, unknown restaurant, a
// restaurant without location or not approved. It lives in restaurant-operations
// (shared/restaurant-not-found.ts) because the DiNNo administrator panel answers
// the same 404 and that module cannot import this one; re-exported here.
export {
  RESTAURANT_NOT_FOUND_CODE,
  RESTAURANT_NOT_FOUND_MESSAGE,
  restaurantNotFound,
} from '../../restaurant-operations/index.js';
