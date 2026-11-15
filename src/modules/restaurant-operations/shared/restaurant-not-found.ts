import { NotFoundException } from '@nestjs/common';

// El 404 de un restaurante que no existe o no se puede mostrar: el detalle
// público y la reserva del comensal (search-availability y reservations-checkin,
// que lo re-exportan) y el panel del administrador de DiNNo. Vive aquí porque
// restaurant-operations no puede importar de search-availability (ciclo) y las
// tres rutas deben responder exactamente lo mismo.
export const RESTAURANT_NOT_FOUND_CODE = 'RESTAURANT_NOT_FOUND';
export const RESTAURANT_NOT_FOUND_MESSAGE =
  'Este restaurante ya no está disponible.';

export function restaurantNotFound(): NotFoundException {
  return new NotFoundException(RESTAURANT_NOT_FOUND_MESSAGE, {
    errorCode: RESTAURANT_NOT_FOUND_CODE,
  });
}
