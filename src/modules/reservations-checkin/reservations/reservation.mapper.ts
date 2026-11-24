import type { ReservationResponseDto } from './dto/reservation-response.dto.js';
import type { Reservation } from './reservation.entity.js';

// Lo que hace falta de las otras entidades para armar la respuesta.
export interface ReservationRestaurantView {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
}

export interface ReservationTableView {
  identifier: string;
  capacity: number;
}

const toIso = (date: Date | null): string | null =>
  date === null ? null : date.toISOString();

// Reservation (§12.8) tal como la ve el comensal. Reutilizable por todas las
// rutas de reserva del comensal. serverTime lo pone quien responde (Clock).
// El código solo sale mientras la reserva está activa.
export function toReservationResponse(
  reservation: Reservation,
  restaurant: ReservationRestaurantView,
  table: ReservationTableView,
  serverTime: Date,
): ReservationResponseDto {
  return {
    id: reservation.id,
    code: reservation.status === 'active' ? reservation.code : null,
    status: reservation.status,
    partySize: reservation.partySize,
    createdAt: reservation.createdAt.toISOString(),
    expiresAt: reservation.expiresAt.toISOString(),
    serverTime: serverTime.toISOString(),
    cancelledAt: toIso(reservation.cancelledAt),
    expiredAt: toIso(reservation.expiredAt),
    checkedInAt: toIso(reservation.checkedInAt),
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      address: restaurant.address,
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
    },
    table: { identifier: table.identifier, capacity: table.capacity },
  };
}
