import type { Reservation } from './reservation.entity.js';
import { toReservationResponse } from './reservation.mapper.js';

const reservation = (overrides: Partial<Reservation> = {}): Reservation =>
  ({
    id: 'res-1',
    code: 'K7M4QX',
    status: 'active',
    partySize: 2,
    createdAt: new Date('2026-11-05T17:00:00Z'),
    expiresAt: new Date('2026-11-05T17:15:00Z'),
    cancelledAt: null,
    expiredAt: null,
    checkedInAt: null,
    ...overrides,
  }) as Reservation;

const RESTAURANT = {
  id: 'rest-1',
  name: 'Casa 72',
  address: 'Calle 72',
  latitude: 4.655671,
  longitude: -74.057006,
};
const TABLE = { identifier: '04', capacity: 4 };
const SERVER_TIME = new Date('2026-11-05T17:00:00.412Z');

describe('toReservationResponse', () => {
  it('arma la forma exacta de Reservation (§12.8), con fechas ISO en UTC', () => {
    expect(
      toReservationResponse(reservation(), RESTAURANT, TABLE, SERVER_TIME),
    ).toEqual({
      id: 'res-1',
      code: 'K7M4QX',
      status: 'active',
      partySize: 2,
      createdAt: '2026-11-05T17:00:00.000Z',
      expiresAt: '2026-11-05T17:15:00.000Z',
      serverTime: '2026-11-05T17:00:00.412Z',
      cancelledAt: null,
      expiredAt: null,
      checkedInAt: null,
      restaurant: RESTAURANT,
      table: { identifier: '04', capacity: 4 },
    });
  });

  it.each(['cancelled', 'expired', 'completed'] as const)(
    'el código es null cuando la reserva está %s',
    (status) => {
      const response = toReservationResponse(
        reservation({ status }),
        RESTAURANT,
        TABLE,
        SERVER_TIME,
      );

      expect(response.code).toBeNull();
    },
  );

  it('convierte las fechas de cierre cuando existen', () => {
    const response = toReservationResponse(
      reservation({
        status: 'cancelled',
        cancelledAt: new Date('2026-11-05T17:05:00Z'),
      }),
      RESTAURANT,
      TABLE,
      SERVER_TIME,
    );

    expect(response.cancelledAt).toBe('2026-11-05T17:05:00.000Z');
  });

  it('una reserva vencida lleva expiredAt, sin código ni otras fechas de cierre', () => {
    const response = toReservationResponse(
      reservation({
        status: 'expired',
        expiredAt: new Date('2026-11-05T17:15:03Z'),
      }),
      RESTAURANT,
      TABLE,
      SERVER_TIME,
    );

    expect(response).toMatchObject({
      status: 'expired',
      code: null,
      expiredAt: '2026-11-05T17:15:03.000Z',
      cancelledAt: null,
      checkedInAt: null,
    });
  });

  it('una reserva cumplida lleva checkedInAt, sin código', () => {
    const response = toReservationResponse(
      reservation({
        status: 'completed',
        checkedInAt: new Date('2026-11-05T17:08:00Z'),
      }),
      RESTAURANT,
      TABLE,
      SERVER_TIME,
    );

    expect(response).toMatchObject({
      status: 'completed',
      code: null,
      checkedInAt: '2026-11-05T17:08:00.000Z',
      expiredAt: null,
      cancelledAt: null,
    });
  });
});
