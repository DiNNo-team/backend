import type { Reservation } from '../reservations/reservation.entity.js';
import type { RestaurantReservationResponseDto } from './dto/restaurant-reservation-response.dto.js';
import type { ReservationLabel } from './reservation-labels.reader.js';

// Lo que hace falta de la reserva. Sin code a propósito: el restaurante nunca lo
// ve (§12.6), así que este tipo ni siquiera lo deja pasar.
export type RestaurantReservationRow = Pick<
  Reservation,
  'id' | 'status' | 'partySize' | 'tableId' | 'createdAt' | 'expiresAt'
>;

// RestaurantReservation (§12.8) tal como la ve el restaurante. serverTime lo pone
// quien responde (Clock).
export function toRestaurantReservation(
  reservation: RestaurantReservationRow,
  label: ReservationLabel,
  serverTime: Date,
): RestaurantReservationResponseDto {
  return {
    id: reservation.id,
    status: reservation.status,
    partySize: reservation.partySize,
    dinerName: label.dinerName,
    tableId: reservation.tableId,
    tableIdentifier: label.tableIdentifier,
    createdAt: reservation.createdAt.toISOString(),
    expiresAt: reservation.expiresAt.toISOString(),
    serverTime: serverTime.toISOString(),
  };
}
