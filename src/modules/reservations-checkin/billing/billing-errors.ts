import { ConflictException } from '@nestjs/common';

// 409 del estado de cobro (panel del administrador, Sprint 4). Llevan errorCode
// porque la web muestra un texto distinto para cada uno.
export const BILLING_ERRORS = {
  PERIOD_NOT_CLOSED:
    'Este mes todavía no termina. Podrás marcarlo como cobrado desde el día 1 del mes siguiente.',
  NOTHING_TO_BILL:
    'Este restaurante no tiene check-ins en ese mes: no hay nada que cobrar.',
  PERIOD_ALREADY_PAID: 'Este mes ya está marcado como cobrado.',
  PERIOD_NOT_PAID: 'Este mes no está marcado como cobrado.',
} as const;

export type BillingErrorCode = keyof typeof BILLING_ERRORS;

export function billingConflict(code: BillingErrorCode): ConflictException {
  return new ConflictException(BILLING_ERRORS[code], { errorCode: code });
}
