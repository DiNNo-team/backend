import { ConflictException } from '@nestjs/common';

// 409 de las acciones de mesa por una reserva DiNNo activa (CLAUDE.md §12.2 y
// §12.9). Llevan errorCode porque la web decide qué mostrar según el motivo.
// Los demás 404 y 409 de mesas siguen sin errorCode.
export const TABLE_HAS_ACTIVE_RESERVATION_CODE = 'TABLE_HAS_ACTIVE_RESERVATION';
export const TABLE_HAS_ACTIVE_RESERVATION_MESSAGE =
  'Esta mesa tiene una reserva de DiNNo en curso. Se libera sola cuando el comensal llegue, cancele o se venza la reserva.';

export const TABLE_NOT_AVAILABLE_TO_DEACTIVATE_CODE =
  'TABLE_NOT_AVAILABLE_TO_DEACTIVATE';
export const TABLE_NOT_AVAILABLE_TO_DEACTIVATE_MESSAGE =
  'Para desactivar esta mesa, primero márcala como Disponible.';

export const tableHasActiveReservation = (): ConflictException =>
  new ConflictException(TABLE_HAS_ACTIVE_RESERVATION_MESSAGE, {
    errorCode: TABLE_HAS_ACTIVE_RESERVATION_CODE,
  });

export const tableNotAvailableToDeactivate = (): ConflictException =>
  new ConflictException(TABLE_NOT_AVAILABLE_TO_DEACTIVATE_MESSAGE, {
    errorCode: TABLE_NOT_AVAILABLE_TO_DEACTIVATE_CODE,
  });
