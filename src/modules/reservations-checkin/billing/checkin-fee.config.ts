import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Tarifa por comensal de cada check-in, en pesos colombianos (CLAUDE.md §11,
// "Cobro por check-in"): entero de 0 a 1.000.000; sin definir, 1500. El cobro de
// un check-in es personas × esta tarifa (`checkInFeeCop`) y queda guardado en
// check_ins.fee_cop: cambiar la variable no altera el historial.
export const CHECKIN_FEE_PER_GUEST_MIN_COP = 0;
export const CHECKIN_FEE_PER_GUEST_MAX_COP = 1_000_000;
export const CHECKIN_FEE_PER_GUEST_DEFAULT_COP = 1500;

// Configuración tipada del cobro: nadie lee process.env suelto.
export abstract class CheckInFeeConfig {
  abstract readonly feePerGuestCop: number;
}

// Sin definir: 1500. Definida pero vacía, con texto, decimales, signo, puntos de
// miles o fuera de rango: la app no arranca. Un valor mal escrito en Azure no
// debe pasar callado al valor por defecto.
export function parseCheckInFeePerGuest(raw: string | undefined): number {
  if (raw === undefined) {
    return CHECKIN_FEE_PER_GUEST_DEFAULT_COP;
  }
  const text = raw.trim();
  const fee = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (
    !Number.isSafeInteger(fee) ||
    fee < CHECKIN_FEE_PER_GUEST_MIN_COP ||
    fee > CHECKIN_FEE_PER_GUEST_MAX_COP
  ) {
    throw new Error(
      `CHECKIN_FEE_PER_GUEST_COP debe ser un número entero de pesos entre ${CHECKIN_FEE_PER_GUEST_MIN_COP} y ${CHECKIN_FEE_PER_GUEST_MAX_COP}, sin puntos ni signos (o quitarla para usar ${CHECKIN_FEE_PER_GUEST_DEFAULT_COP}). Corrígela en la configuración del servicio.`,
    );
  }
  return fee;
}

// La factory corre al crear el módulo: con un valor inválido la app no arranca.
export const checkInFeeConfigProvider: Provider = {
  provide: CheckInFeeConfig,
  inject: [ConfigService],
  useFactory: (config: ConfigService): CheckInFeeConfig => ({
    feePerGuestCop: parseCheckInFeePerGuest(
      config.get<string>('CHECKIN_FEE_PER_GUEST_COP'),
    ),
  }),
};
