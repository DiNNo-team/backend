import type { ConfigService } from '@nestjs/config';
import {
  parseReservationExpiryEnabled,
  RESERVATION_EXPIRY_INTERVAL_MS,
  reservationExpiryConfigProvider,
  type ReservationExpiryConfig,
} from './reservation-expiry.config.js';

describe('parseReservationExpiryEnabled', () => {
  it('sin definir queda activo', () => {
    expect(parseReservationExpiryEnabled(undefined)).toBe(true);
  });

  it.each([
    ['true', true],
    ['false', false],
    [' true ', true],
    [' false ', false],
  ])('acepta %j', (raw, expected) => {
    expect(parseReservationExpiryEnabled(raw)).toBe(expected);
  });

  it.each(['', ' ', 'TRUE', 'False', '1', '0', 'yes', 'no', 'si'])(
    'rechaza %j con un mensaje en español',
    (raw) => {
      expect(() => parseReservationExpiryEnabled(raw)).toThrow(
        /RESERVATION_EXPIRY_ENABLED debe ser true o false/,
      );
    },
  );
});

describe('reservationExpiryConfigProvider', () => {
  const build = (raw: string | undefined): ReservationExpiryConfig => {
    const provider = reservationExpiryConfigProvider as unknown as {
      useFactory: (config: ConfigService) => ReservationExpiryConfig;
    };
    return provider.useFactory({
      get: () => raw,
    } as unknown as ConfigService);
  };

  it('el intervalo es la constante de 15 s', () => {
    expect(RESERVATION_EXPIRY_INTERVAL_MS).toBe(15_000);
    expect(build(undefined)).toEqual({ enabled: true, intervalMs: 15_000 });
  });

  it('lee la variable', () => {
    expect(build('false').enabled).toBe(false);
  });

  it('con un valor inválido, la factory lanza: la app no arranca', () => {
    expect(() => build('quizas')).toThrow(/RESERVATION_EXPIRY_ENABLED/);
  });
});
