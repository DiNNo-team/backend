import { formatTableName } from '../../restaurant-operations/index.js';
import { formatBogotaClock } from '../../search-availability/index.js';
import type { PushMessage } from '../push/push-sender.js';

// The four reservation events that notify the diner (PBI 1.1). The value is
// what the app receives in data.type to decide where to go on tap.
export type ReservationNotificationType =
  'created' | 'cancelled' | 'expired' | 'checked_in';

// What a notification says, read from the reservation after the commit.
export interface ReservationFacts {
  reservationId: string;
  dinerId: string;
  restaurantName: string;
  tableIdentifier: string;
  expiresAt: Date;
}

/**
 * Texts of the notifications (Spanish, tú, glossary of the manual). They never
 * carry the code: a notification shows on the lock screen, and the code is what
 * proves the diner arrived (§12.6); it is only in the app. Times in Bogotá.
 */
export function reservationMessage(
  type: ReservationNotificationType,
  facts: ReservationFacts,
): PushMessage {
  const table = formatTableName(facts.tableIdentifier);
  const data = { type, reservationId: facts.reservationId };
  switch (type) {
    case 'created':
      return {
        title: `Mesa reservada en ${facts.restaurantName}`,
        body: `Te guardamos la ${table} hasta las ${formatBogotaClock(facts.expiresAt)}. Muestra tu código al llegar.`,
        data,
      };
    case 'cancelled':
      return {
        title: 'Cancelaste tu reserva',
        body: `La mesa en ${facts.restaurantName} quedó libre.`,
        data,
      };
    case 'expired':
      return {
        title: 'Tu reserva se venció',
        body: `Ya no tenemos tu mesa en ${facts.restaurantName}. Busca otra mesa cerca de ti.`,
        data,
      };
    case 'checked_in':
      return {
        title: 'Check-in confirmado',
        body: `Tu ${table} en ${facts.restaurantName} te espera. Buen provecho.`,
        data,
      };
  }
}
