import { ConflictException } from '@nestjs/common';

// 409 de aprobar o rechazar una solicitud que ya no está pendiente (otro
// administrador se adelantó, o ya se había revisado).
export const RESTAURANT_NOT_PENDING_CODE = 'RESTAURANT_NOT_PENDING';
export const RESTAURANT_NOT_PENDING_MESSAGE = 'Esta solicitud ya fue revisada.';

export function restaurantNotPending(): ConflictException {
  return new ConflictException(RESTAURANT_NOT_PENDING_MESSAGE, {
    errorCode: RESTAURANT_NOT_PENDING_CODE,
  });
}
