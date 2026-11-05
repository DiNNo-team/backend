import { ConflictException, NotFoundException } from '@nestjs/common';

// errorCode de los 409 de POST /v1/reservations y su texto (CLAUDE.md §12.9).
// Cada cliente decide qué mostrar según el errorCode; el message es el texto
// del contrato.
export const NO_TABLE_AVAILABLE_CODE = 'NO_TABLE_AVAILABLE';
export const NO_TABLE_AVAILABLE_MESSAGE =
  'Alguien acaba de tomar la última mesa. Prueba con otro restaurante.';

export const ACTIVE_RESERVATION_EXISTS_CODE = 'ACTIVE_RESERVATION_EXISTS';
export const ACTIVE_RESERVATION_EXISTS_MESSAGE = 'Ya tienes una reserva activa';

export const RESTAURANT_CLOSED_CODE = 'RESTAURANT_CLOSED';
export const RESTAURANT_CLOSED_MESSAGE = 'Este restaurante acaba de cerrar.';

export const noTableAvailable = (): ConflictException =>
  new ConflictException(NO_TABLE_AVAILABLE_MESSAGE, {
    errorCode: NO_TABLE_AVAILABLE_CODE,
  });

export const activeReservationExists = (): ConflictException =>
  new ConflictException(ACTIVE_RESERVATION_EXISTS_MESSAGE, {
    errorCode: ACTIVE_RESERVATION_EXISTS_CODE,
  });

export const restaurantClosed = (): ConflictException =>
  new ConflictException(RESTAURANT_CLOSED_MESSAGE, {
    errorCode: RESTAURANT_CLOSED_CODE,
  });

// 404 de las rutas de lectura y cancelación (§12.9). El mismo mensaje cuando la
// reserva no existe y cuando es de otro comensal: no se revela que existe.
export const RESERVATION_NOT_FOUND_CODE = 'RESERVATION_NOT_FOUND';
export const RESERVATION_NOT_FOUND_MESSAGE = 'No encontramos esa reserva.';

export const reservationNotFound = (): NotFoundException =>
  new NotFoundException(RESERVATION_NOT_FOUND_MESSAGE, {
    errorCode: RESERVATION_NOT_FOUND_CODE,
  });

// 409 de la cancelación (§12.9): la reserva ya no está activa (cancelada, vencida
// o cumplida). La app consulta GET /reservations/:id y muestra el estado real.
export const RESERVATION_NOT_ACTIVE_CODE = 'RESERVATION_NOT_ACTIVE';
export const RESERVATION_NOT_ACTIVE_MESSAGE = 'Esta reserva ya no está activa.';

export const reservationNotActive = (): ConflictException =>
  new ConflictException(RESERVATION_NOT_ACTIVE_MESSAGE, {
    errorCode: RESERVATION_NOT_ACTIVE_CODE,
  });
