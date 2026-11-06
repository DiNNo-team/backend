import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Cada cuánto corre el barrido de reservas vencidas (CLAUDE.md §12.5).
export const RESERVATION_EXPIRY_INTERVAL_MS = 15_000;

// Configuración del proceso periódico. intervalMs no es una variable de entorno:
// las pruebas lo cambian reemplazando este proveedor.
export abstract class ReservationExpiryConfig {
  abstract readonly enabled: boolean;
  abstract readonly intervalMs: number;
}

// Sin definir: activo. Definida con otro valor que true o false (también vacía):
// la app no arranca. Un valor mal escrito no debe apagar el barrido en silencio.
export function parseReservationExpiryEnabled(
  raw: string | undefined,
): boolean {
  if (raw === undefined) {
    return true;
  }
  const text = raw.trim();
  if (text === 'true') {
    return true;
  }
  if (text === 'false') {
    return false;
  }
  throw new Error(
    'RESERVATION_EXPIRY_ENABLED debe ser true o false (o quitarla para usar true). Corrígela en la configuración del servicio.',
  );
}

// La factory corre al crear el módulo: con un valor inválido la app no arranca.
export const reservationExpiryConfigProvider: Provider = {
  provide: ReservationExpiryConfig,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ReservationExpiryConfig => ({
    enabled: parseReservationExpiryEnabled(
      config.get<string>('RESERVATION_EXPIRY_ENABLED'),
    ),
    intervalMs: RESERVATION_EXPIRY_INTERVAL_MS,
  }),
};
