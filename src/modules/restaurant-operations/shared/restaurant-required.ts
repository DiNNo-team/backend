import { ForbiddenException } from '@nestjs/common';

// 403 for a session user who has not registered a restaurant yet. Shared by
// every restaurant-operations feature: same text and same errorCode
// everywhere, because the front branches on the code to send the user to
// the restaurant registration.
export const RESTAURANT_REQUIRED_MESSAGE = 'Primero registra tu restaurante.';
export const RESTAURANT_REQUIRED_CODE = 'RESTAURANT_REQUIRED';

// Returns the session user's restaurant id, or throws the 403 above.
export function requireRestaurant(restaurantId: string | null): string {
  if (!restaurantId) {
    throw new ForbiddenException(RESTAURANT_REQUIRED_MESSAGE, {
      errorCode: RESTAURANT_REQUIRED_CODE,
    });
  }
  return restaurantId;
}
