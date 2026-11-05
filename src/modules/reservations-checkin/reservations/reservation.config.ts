import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Vigencia de la microreserva (CLAUDE.md §12.1): entre 2 y 15 minutos.
export const RESERVATION_TTL_MIN_MINUTES = 2;
export const RESERVATION_TTL_MAX_MINUTES = 15;
export const RESERVATION_TTL_DEFAULT_MINUTES = 15;

// Configuración tipada de las reservas: nadie lee process.env suelto.
export abstract class ReservationConfig {
  abstract readonly ttlMinutes: number;
}

// Sin definir: 15. Definida pero vacía, con texto, decimal o fuera de 2 a 15:
// la app no arranca. Un valor mal escrito en Render no debe pasar callado a 15.
export function parseReservationTtl(raw: string | undefined): number {
  if (raw === undefined) {
    return RESERVATION_TTL_DEFAULT_MINUTES;
  }
  const text = raw.trim();
  const minutes = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (
    !Number.isInteger(minutes) ||
    minutes < RESERVATION_TTL_MIN_MINUTES ||
    minutes > RESERVATION_TTL_MAX_MINUTES
  ) {
    throw new Error(
      `RESERVATION_TTL_MINUTES debe ser un número entero de minutos entre ${RESERVATION_TTL_MIN_MINUTES} y ${RESERVATION_TTL_MAX_MINUTES} (o quitarla para usar ${RESERVATION_TTL_DEFAULT_MINUTES}). Corrígela en la configuración del servicio.`,
    );
  }
  return minutes;
}

// La factory corre al crear el módulo: con un valor inválido la app no arranca.
export const reservationConfigProvider: Provider = {
  provide: ReservationConfig,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ReservationConfig => ({
    ttlMinutes: parseReservationTtl(
      config.get<string>('RESERVATION_TTL_MINUTES'),
    ),
  }),
};
