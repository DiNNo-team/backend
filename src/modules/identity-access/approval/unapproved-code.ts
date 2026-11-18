import type { CurrentUserData } from '../current-user/current-user-data.js';
import { UserRole } from '../roles/user-role.js';
import {
  APPROVED,
  type RestaurantApprovalStatus,
} from './restaurant-approval-status.js';

export type UnapprovedCode =
  'ACCOUNT_PENDING_APPROVAL' | 'ACCOUNT_REJECTED' | 'RESTAURANT_SUSPENDED';

type NotApproved = Exclude<RestaurantApprovalStatus, 'approved'>;

const CODE_BY_STATUS: Record<NotApproved, UnapprovedCode> = {
  pending: 'ACCOUNT_PENDING_APPROVAL',
  rejected: 'ACCOUNT_REJECTED',
  suspended: 'RESTAURANT_SUSPENDED',
};

// The approval code of a restaurant_admin whose restaurant is pending,
// rejected or suspended; null for every other account (also a restaurant_admin
// without a restaurant, who gets RESTAURANT_REQUIRED instead). Single source for
// HTTP (RolesGuard) and the WebSocket handshake (SocketAuthenticator).
export function unapprovedCode(user: CurrentUserData): UnapprovedCode | null {
  if (
    user.role !== UserRole.RESTAURANT_ADMIN ||
    user.restaurantApproval === null ||
    user.restaurantApproval === APPROVED
  ) {
    return null;
  }
  // Not approved here: the check above already returned for APPROVED.
  return CODE_BY_STATUS[user.restaurantApproval as NotApproved];
}
