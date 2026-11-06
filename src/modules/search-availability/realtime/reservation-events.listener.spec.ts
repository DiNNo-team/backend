import { Logger } from '@nestjs/common';
import type { AvailabilityGateway } from './availability.gateway.js';
import { ReservationEventsListener } from './reservation-events.listener.js';
import type { ReservationEndedEvent } from './reservation-events.js';

const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';
const DINER_ID = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const TABLE_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const RESERVATION_ID = '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const AT = '2026-11-06T17:00:00.000Z';

function setup(emitToRooms = vi.fn()) {
  return {
    emitToRooms,
    listener: new ReservationEventsListener({
      emitToRooms,
    } as unknown as AvailabilityGateway),
  };
}

const ended = (
  status: ReservationEndedEvent['status'],
): ReservationEndedEvent => ({
  restaurantId: RESTAURANT_ID,
  dinerId: DINER_ID,
  reservationId: RESERVATION_ID,
  status,
  tableId: TABLE_ID,
  at: AT,
});

describe('ReservationEventsListener', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reservation.created va solo a la sala del restaurante, con la RestaurantReservation tal cual', () => {
    const { listener, emitToRooms } = setup();
    const reservation = {
      id: RESERVATION_ID,
      status: 'active',
      partySize: 2,
      dinerName: null,
      tableId: TABLE_ID,
      tableIdentifier: '04',
      createdAt: AT,
      expiresAt: AT,
      serverTime: AT,
    };

    listener.onCreated({ restaurantId: RESTAURANT_ID, reservation });

    expect(emitToRooms).toHaveBeenCalledTimes(1);
    expect(emitToRooms).toHaveBeenCalledWith(
      [`restaurant:${RESTAURANT_ID}`],
      'reservation.created',
      reservation,
    );
  });

  it.each([
    ['onCancelled', 'reservation.cancelled', 'cancelled'],
    ['onExpired', 'reservation.expired', 'expired'],
    ['onCheckedIn', 'reservation.checked_in', 'completed'],
  ] as const)(
    '%s envía %s al restaurante y al comensal, sin los campos internos',
    (method, socketEvent, status) => {
      const { listener, emitToRooms } = setup();

      listener[method](ended(status));

      expect(emitToRooms).toHaveBeenCalledTimes(1);
      expect(emitToRooms).toHaveBeenCalledWith(
        [`restaurant:${RESTAURANT_ID}`, `diner:${DINER_ID}`],
        socketEvent,
        { reservationId: RESERVATION_ID, status, tableId: TABLE_ID, at: AT },
      );
    },
  );

  it("table.status_changed va solo a la sala del restaurante, también con 'inactive'", () => {
    const { listener, emitToRooms } = setup();

    listener.onTableStatusChanged({
      restaurantId: RESTAURANT_ID,
      tableId: TABLE_ID,
      previousStatus: 'available',
      status: 'inactive',
      source: 'manual',
    });

    expect(emitToRooms).toHaveBeenCalledWith(
      [`restaurant:${RESTAURANT_ID}`],
      'table.status_changed',
      {
        tableId: TABLE_ID,
        previousStatus: 'available',
        status: 'inactive',
        source: 'manual',
      },
    );
  });

  it('si el socket falla, lo registra sin los ids y no lanza', () => {
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { listener } = setup(
      vi.fn(() => {
        throw Object.assign(new Error(`sala restaurant:${RESTAURANT_ID}`), {
          name: 'SocketFailure',
        });
      }),
    );

    expect(() => listener.onExpired(ended('expired'))).not.toThrow();

    expect(logged).toHaveBeenCalledWith(
      'No se pudo enviar reservation.expired por el WebSocket: SocketFailure',
    );
  });
});
