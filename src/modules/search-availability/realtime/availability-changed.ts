import type { Availability } from '../availability/availability.types.js';

// WebSocket contract of Sprint 2 ("Tiempo real"): the server event, the room
// every accepted diner joins and the exact payload. Never a count of tables.
export const AVAILABILITY_CHANGED_EVENT = 'availability.changed';
export const DINERS_ROOM = 'diners';

export interface AvailabilityChangedPayload {
  restaurantId: string;
  availability: Availability;
  isOpenNow: boolean;
  isSearchable: boolean;
}
