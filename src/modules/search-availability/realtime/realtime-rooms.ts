import { type CurrentUserData, UserRole } from '../../identity-access/index.js';
import { DINERS_ROOM } from './availability-changed.js';

// Salas del WebSocket (CLAUDE.md §12.7). Las asigna el servidor al conectar; el
// cliente no elige ninguna. Viven en la memoria del proceso.
export const dinerRoom = (userId: string) => `diner:${userId}`;
export const restaurantRoom = (restaurantId: string) =>
  `restaurant:${restaurantId}`;

// El comensal: la sala de disponibilidad y la suya. El restaurante: solo la suya.
// SocketAuthenticator ya rechazó al admin sin restaurante.
export function roomsFor(user: CurrentUserData): string[] {
  if (user.role === UserRole.DINER) {
    return [DINERS_ROOM, dinerRoom(user.userId)];
  }
  return user.restaurantId === null ? [] : [restaurantRoom(user.restaurantId)];
}
