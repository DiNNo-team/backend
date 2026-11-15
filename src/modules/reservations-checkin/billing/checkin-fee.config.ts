import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Tarifa fija por check-in, en pesos colombianos (CLAUDE.md §11, "Cobro por
// check-in"): entero de 0 a 1.000.000; sin definir, 2000. Cada check-in guarda la
// tarifa vigente en ese momento (check_ins.fee_cop): cambiar la variable no
// altera el historial.
export const CHECKIN_FEE_MIN_COP = 0;
export const CHECKIN_FEE_MAX_COP = 1_000_000;
export const CHECKIN_FEE_DEFAULT_COP = 2000;

// Configuración tipada del cobro: nadie lee process.env suelto.
export abstract class CheckInFeeConfig {
  abstract readonly feeCop: number;
}

// Sin definir: 2000. Definida pero vacía, con texto, decimales, signo, puntos de
// miles o fuera de rango: la app no arranca. Un valor mal escrito en Render no
// debe pasar callado a 2000.
export function parseCheckInFee(raw: string | undefined): number {
  if (raw === undefined) {
    return CHECKIN_FEE_DEFAULT_COP;
  }
  const text = raw.trim();
  const fee = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (
    !Number.isSafeInteger(fee) ||
    fee < CHECKIN_FEE_MIN_COP ||
    fee > CHECKIN_FEE_MAX_COP
  ) {
    throw new Error(
      `CHECKIN_FEE_COP debe ser un número entero de pesos entre ${CHECKIN_FEE_MIN_COP} y ${CHECKIN_FEE_MAX_COP}, sin puntos ni signos (o quitarla para usar ${CHECKIN_FEE_DEFAULT_COP}). Corrígela en la configuración del servicio.`,
    );
  }
  return fee;
}

// La factory corre al crear el módulo: con un valor inválido la app no arranca.
export const checkInFeeConfigProvider: Provider = {
  provide: CheckInFeeConfig,
  inject: [ConfigService],
  useFactory: (config: ConfigService): CheckInFeeConfig => ({
    feeCop: parseCheckInFee(config.get<string>('CHECKIN_FEE_COP')),
  }),
};
