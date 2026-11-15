import type { CurrentUserData } from '../current-user/current-user-data.js';
import { UserRole } from '../roles/user-role.js';
import { APPROVED, PENDING } from './restaurant-approval-status.js';

export type UnapprovedCode = 'ACCOUNT_PENDING_APPROVAL' | 'ACCOUNT_REJECTED';

// The approval code of a restaurant_admin whose restaurant is pending or
// rejected; null for every other account (also a restaurant_admin without a
// restaurant, who gets RESTAURANT_REQUIRED instead). Single source for HTTP
// (RolesGuard) and the WebSocket handshake (SocketAuthenticator).
export function unapprovedCode(user: CurrentUserData): UnapprovedCode | null {
  if (
    user.role !== UserRole.RESTAURANT_ADMIN ||
    user.restaurantApproval === null ||
    user.restaurantApproval === APPROVED
  ) {
    return null;
  }
  return user.restaurantApproval === PENDING
    ? 'ACCOUNT_PENDING_APPROVAL'
    : 'ACCOUNT_REJECTED';
}
