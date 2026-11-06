// Estados de la microreserva (CLAUDE.md §12.1). Solo se pasa de 'active' a uno
// de los otros tres; nunca al revés. Los usa el check CHK_reservations_status
// y su migración (el spec de la migración falla si se desalinean).
export const RESERVATION_STATUSES = [
  'active',
  'cancelled',
  'expired',
  'completed',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

// Alfabeto del código de la reserva (§12.1): mayúsculas y números sin los que
// se confunden (0, O, 1, I, L). 31 caracteres.
export const RESERVATION_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const RESERVATION_CODE_LENGTH = 6;

// Personas por reserva (§12.1), igual que el filtro del Sprint 2.
export const RESERVATION_MIN_PARTY_SIZE = 1;
export const RESERVATION_MAX_PARTY_SIZE = 20;
