import { ConfigService } from '@nestjs/config';
import {
  parseReservationTtl,
  ReservationConfig,
  reservationConfigProvider,
} from './reservation.config.js';

describe('parseReservationTtl', () => {
  it('sin definir usa 15', () => {
    expect(parseReservationTtl(undefined)).toBe(15);
  });

  it.each([
    ['2', 2],
    ['3', 3],
    ['15', 15],
    [' 10 ', 10],
  ])('acepta "%s"', (raw, minutes) => {
    expect(parseReservationTtl(raw)).toBe(minutes);
  });

  it.each([
    '1',
    '0',
    '16',
    '100',
    '-3',
    '2.5',
    '3,5',
    'abc',
    '1e1',
    '0x10',
    '',
    '  ',
  ])('rechaza "%s" con un mensaje claro', (raw) => {
    expect(() => parseReservationTtl(raw)).toThrow(
      /RESERVATION_TTL_MINUTES debe ser un número entero de minutos entre 2 y 15/,
    );
  });
});

describe('reservationConfigProvider', () => {
  const build = (value: string | undefined) => {
    const provider = reservationConfigProvider as {
      provide: unknown;
      useFactory: (config: ConfigService) => ReservationConfig;
    };
    const config = { get: () => value } as unknown as ConfigService;
    return provider.useFactory(config);
  };

  it('entrega el TTL tipado', () => {
    expect(build('3')).toEqual({ ttlMinutes: 3 });
    expect(build(undefined)).toEqual({ ttlMinutes: 15 });
  });

  it('lanza al crearse con un valor inválido: la app no arranca', () => {
    expect(() => build('abc')).toThrow(/RESERVATION_TTL_MINUTES/);
  });
});
