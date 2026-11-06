import { ConflictException, NotFoundException } from '@nestjs/common';
import { formatBogotaClock } from '../../search-availability/index.js';

// Errores del check-in (§12.6, §12.9). El mismo 404 cuando el código no existe,
// no tiene el formato o es de otro restaurante: no se revela que existe.
export const RESERVATION_CODE_NOT_FOUND_CODE = 'RESERVATION_CODE_NOT_FOUND';
export const RESERVATION_CODE_NOT_FOUND_MESSAGE =
  'No encontramos una reserva con ese código en tu restaurante.';

export const RESERVATION_EXPIRED_CODE = 'RESERVATION_EXPIRED';
export const RESERVATION_ALREADY_USED_CODE = 'RESERVATION_ALREADY_USED';

export const RESERVATION_CANCELLED_CODE = 'RESERVATION_CANCELLED';
export const RESERVATION_CANCELLED_MESSAGE =
  'El comensal canceló esta reserva.';

export const reservationCodeNotFound = (): NotFoundException =>
  new NotFoundException(RESERVATION_CODE_NOT_FOUND_MESSAGE, {
    errorCode: RESERVATION_CODE_NOT_FOUND_CODE,
  });

// Única excepción a "cada cliente elige su texto" (§12.6): estos dos llevan la
// hora de Bogotá en el message, y la web lo muestra tal cual. La de vencida sale
// de expires_at, no de expired_at: expired_at es la hora en que se barrió.
export const reservationExpired = (expiresAt: Date): ConflictException =>
  new ConflictException(
    `Esta reserva se venció a las ${formatBogotaClock(expiresAt)}. La mesa ya se liberó.`,
    { errorCode: RESERVATION_EXPIRED_CODE },
  );

export const reservationAlreadyUsed = (checkedInAt: Date): ConflictException =>
  new ConflictException(
    `Este código ya se usó a las ${formatBogotaClock(checkedInAt)}.`,
    { errorCode: RESERVATION_ALREADY_USED_CODE },
  );

export const reservationCancelled = (): ConflictException =>
  new ConflictException(RESERVATION_CANCELLED_MESSAGE, {
    errorCode: RESERVATION_CANCELLED_CODE,
  });
