import { NotFoundException } from '@nestjs/common';

// The only 404 of the public detail: malformed id, unknown restaurant or a
// restaurant without location. The app shows the message with a way back.
export const RESTAURANT_NOT_FOUND_CODE = 'RESTAURANT_NOT_FOUND';
export const RESTAURANT_NOT_FOUND_MESSAGE =
  'Este restaurante ya no está disponible.';

export function restaurantNotFound(): NotFoundException {
  return new NotFoundException(RESTAURANT_NOT_FOUND_MESSAGE, {
    errorCode: RESTAURANT_NOT_FOUND_CODE,
  });
}
