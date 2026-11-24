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

// 409 de suspender un restaurante que no está aprobado (pendiente, rechazado o
// ya suspendido, también si otro administrador se adelantó).
export const RESTAURANT_NOT_APPROVED_CODE = 'RESTAURANT_NOT_APPROVED';
export const RESTAURANT_NOT_APPROVED_MESSAGE =
  'Solo puedes suspender un restaurante aprobado.';

export function restaurantNotApproved(): ConflictException {
  return new ConflictException(RESTAURANT_NOT_APPROVED_MESSAGE, {
    errorCode: RESTAURANT_NOT_APPROVED_CODE,
  });
}

// 409 de reactivar un restaurante que no está suspendido.
export const RESTAURANT_NOT_SUSPENDED_CODE = 'RESTAURANT_NOT_SUSPENDED';
export const RESTAURANT_NOT_SUSPENDED_MESSAGE =
  'Este restaurante no está suspendido.';

export function restaurantNotSuspended(): ConflictException {
  return new ConflictException(RESTAURANT_NOT_SUSPENDED_MESSAGE, {
    errorCode: RESTAURANT_NOT_SUSPENDED_CODE,
  });
}
