// Eventos internos (EventEmitter2) de las microreservas que el tiempo real
// traduce al WebSocket (CLAUDE.md §12.8). Viven aquí y no en reservations-checkin
// porque ese módulo ya depende de este: quien escucha declara lo que acepta, y el
// sentido contrario formaría un ciclo. Salen solo después del commit.
//
// El nombre interno es el mismo del evento del socket. restaurantId y dinerId
// sirven para elegir las salas; el listener no los envía.
export const RESERVATION_CREATED = 'reservation.created';
export const RESERVATION_CANCELLED = 'reservation.cancelled';
export const RESERVATION_EXPIRED = 'reservation.expired';
export const RESERVATION_CHECKED_IN = 'reservation.checked_in';

// RestaurantReservation (§12.8), tal como la ve el restaurante: nunca lleva el código.
export interface RestaurantReservationPayload {
  id: string;
  status: string;
  partySize: number;
  dinerName: string | null;
  tableId: string;
  tableIdentifier: string;
  createdAt: string;
  expiresAt: string;
  serverTime: string;
}

export interface ReservationCreatedEvent {
  restaurantId: string;
  reservation: RestaurantReservationPayload;
}

// Una reserva que terminó: cancelada, vencida o cumplida. at es el instante del
// cambio, en ISO UTC.
export interface ReservationEndedEvent {
  restaurantId: string;
  dinerId: string;
  reservationId: string;
  status: 'cancelled' | 'expired' | 'completed';
  tableId: string;
  at: string;
}
